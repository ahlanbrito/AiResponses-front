const API_BASE = 'https://apipreguntasai.runasp.net/api';
let ANON_LIMIT = 5;

// Version de la extension y control de actualizaciones
const EXTENSION_VERSION = chrome.runtime.getManifest().version;
const EXTENSION_OUTDATED_MSG = 'Hay una nueva version de la extension. Actualizala para seguir usando el servicio.';
let VERSION_INFO = null;
let lastVersionFetch = 0;

function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

function isOutdated(current, min) {
  return compareVersions(current, min) < 0;
}

async function fetchVersionInfo(force = false) {
  if (!force && VERSION_INFO && Date.now() - lastVersionFetch < 60000) return VERSION_INFO;
  try {
    const res = await fetch(`${API_BASE}/config/version`, {
      headers: { 'X-Extension-Version': EXTENSION_VERSION, 'X-Client': 'extension' },
      signal: AbortSignal.timeout(4000)
    });
    if (res.ok) {
      VERSION_INFO = await res.json();
      lastVersionFetch = Date.now();
    }
  } catch (e) {
    console.warn('No se pudo consultar la version de la extension:', e);
  }
  return VERSION_INFO;
}

async function getVersionState(force = false) {
  const info = await fetchVersionInfo(force);
  const min = info?.minVersion || '0.0.0';
  const outdated = isOutdated(EXTENSION_VERSION, min);
  // Si ya esta al dia, limpiamos el bloqueo guardado por un 426 anterior.
  if (!outdated) {
    try { await chrome.storage.local.remove('extensionOutdated'); } catch { /* noop */ }
  }
  return {
    currentVersion: EXTENSION_VERSION,
    latestVersion: info?.latestVersion || min,
    minVersion: min,
    updateUrl: info?.updateUrl || '',
    message: info?.message || EXTENSION_OUTDATED_MSG,
    outdated
  };
}

// Flags globales del servidor (imagenes habilitadas, control de sesiones)
let SERVER_FLAGS = { imagenesHabilitadas: true, controlSesionesSimultaneas: true, servicioHabilitado: true };
let lastFlagsFetch = 0;

async function refreshFlags(force = false) {
  if (!force && Date.now() - lastFlagsFetch < 120000) return SERVER_FLAGS;
  try {
    const res = await apiCall('GET', '/config/public', null, null);
    if (res && typeof res.imagenesHabilitadas === 'boolean') {
      SERVER_FLAGS = {
        imagenesHabilitadas: res.imagenesHabilitadas,
        controlSesionesSimultaneas: res.controlSesionesSimultaneas !== false,
        servicioHabilitado: res.servicioHabilitado !== false
      };
      lastFlagsFetch = Date.now();
    }
  } catch (e) {
    console.warn('No se pudieron refrescar los flags del servidor:', e);
  }
  return SERVER_FLAGS;
}

async function refreshAnonLimit() {
  try {
    const res = await apiCall('GET', '/config/public', null, null);
    if (res && res.anonLimit != null) ANON_LIMIT = res.anonLimit;
  } catch (e) {
    console.warn('No se pudo refrescar ANON_LIMIT:', e);
  }
}

// Modo mantenimiento: si el admin apagó el servicio, la extensión lo avisa.
async function isServiceEnabled() {
  const flags = await refreshFlags();
  return flags.servicioHabilitado !== false;
}

// Mensaje de mantenimiento localizado (sin depender de las locales, que ya
// sufren problemas de codificación en algunas claves).
function serviceMaintenanceMsg() {
  const lang = (chrome.i18n.getUILanguage() || 'es').toLowerCase();
  const map = {
    en: 'AI service is in maintenance mode',
    es: 'Servicio de IA en modo de mantenimiento',
    de: 'KI-Dienst ist im Wartungsmodus',
    fr: 'Service IA en mode maintenance',
    'pt-br': 'Serviço de IA em modo de manutenção',
    'zh-cn': 'AI服务维护中'
  };
  for (const k of Object.keys(map)) {
    if (lang.startsWith(k)) return map[k];
  }
  return map.es;
}

function t(key, subs = []) {
  try {
    const msg = chrome.i18n.getMessage(key, subs);
    return msg || key;
  } catch {
    return key;
  }
}

// ── Context Menu ──────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'analyzeImage',
    title: t('analyzeImageWith'),
    contexts: ['image']
  });

  // Ya no recargamos pestañas aquí — el content script se actualiza solo
  // en la próxima navegación del usuario, sin perder datos no guardados.

});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'analyzeImage' || !tab?.id) return;

  if (!await isServiceEnabled()) {
    chrome.tabs.sendMessage(tab.id, {
      action: 'showImageTooltip',
      text: serviceMaintenanceMsg()
    });
    return;
  }

  const flags = await refreshFlags();
  if (!flags.imagenesHabilitadas) {
    chrome.tabs.sendMessage(tab.id, {
      action: 'showImageTooltip',
      text: t('imagesDisabledByAdmin')
    });
    return;
  }

  try {
    const selectedText = await getSelectedTextFromTab(tab.id);
    const prompt = selectedText || t('analyzeThisImage');
    const imageData = await fetchImageAsBase64(info.srcUrl);

    const stored = await getStored();
    let token = null;
    if (stored.accessToken) token = await getValidToken();

    if (token) {
      const data = await apiCall('POST', '/ai/chat', { mensaje: prompt, imagenes: [imageData] }, token);
      chrome.tabs.sendMessage(tab.id, { action: 'showImageTooltip', text: data.respuesta });
    } else {
      chrome.tabs.sendMessage(tab.id, {
        action: 'showImageTooltip',
        text: t('mustLoginForImages')
      });
    }
  } catch (e) {
    chrome.tabs.sendMessage(tab.id, { action: 'showImageTooltip', text: t('errorPrefix') + e.message });
  }
});

// ── Action icon click → toggle slidebar ───────────────────────

chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id, { action: 'toggleSlidebar' }).catch(() => {});
});

// ── Commands ──────────────────────────────────────────────────

chrome.commands.onCommand.addListener((command) => {
  if (command === 'capture-screenshot') {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab) handleScreenshot(tab);
    });
  }
});

async function handleScreenshot(tab) {
  if (!await isServiceEnabled()) {
    try {
      chrome.tabs.sendMessage(tab.id, {
        action: 'showImageTooltip',
        text: serviceMaintenanceMsg()
      });
    } catch {}
    return;
  }
  const flags = await refreshFlags();
  if (!flags.imagenesHabilitadas) {
    try {
      chrome.tabs.sendMessage(tab.id, {
        action: 'showImageTooltip',
        text: t('imagesDisabledByAdmin')
      });
    } catch {}
    return;
  }
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    const selectedText = await getSelectedTextFromTab(tab.id);
    const prompt = selectedText || t('analyzeThisScreenshot');

    const stored = await getStored();
    let token = null;
    if (stored.accessToken) token = await getValidToken();

    if (token) {
      const data = await apiCall('POST', '/ai/chat', { mensaje: prompt, imagenes: [dataUrl] }, token);
      chrome.tabs.sendMessage(tab.id, { action: 'showImageTooltip', text: data.respuesta });
    } else {
      chrome.tabs.sendMessage(tab.id, {
        action: 'showImageTooltip',
        text: t('mustLoginForImages')
      });
    }
  } catch (e) {
    console.warn('handleScreenshot error:', e);
    chrome.tabs.sendMessage(tab.id, { action: 'showImageTooltip', text: t('errorPrefix') + t('serverError') });
  }
}

async function getSelectedTextFromTab(tabId) {
  try {
    return await new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { action: 'getSelectedText' }, (response) => {
        if (chrome.runtime.lastError) resolve('');
        else resolve(response?.text || '');
      });
    });
  } catch {
    return '';
  }
}

async function fetchImageAsBase64(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(t('invalidImageUrl'));
    }
  } catch { throw new Error(t('invalidImageUrl')); }
  const response = await fetch(url);
  if (!response.ok) throw new Error(t('invalidImageUrl'));
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.startsWith('image/')) throw new Error(t('invalidImageUrl'));
  const blob = await response.blob();
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
  const mimeType = blob.type || 'image/jpeg';
  return `data:${mimeType};base64,${base64}`;
}

// ── Token management ──────────────────────────────────────────
// Tokens stored in session storage (cleared when browser closes)

async function getStored() {
  return chrome.storage.session.get(['accessToken', 'refreshToken', 'expiresAt', 'usuario']);
}

async function setStored(data) {
  return chrome.storage.session.set(data);
}

async function clearStored() {
  return chrome.storage.session.remove(['accessToken', 'refreshToken', 'expiresAt', 'usuario']);
}

function isTokenExpired(expiresAt) {
  if (!expiresAt) return true;
  return Date.now() >= new Date(expiresAt).getTime() - 60000;
}

async function getValidToken() {
  const stored = await getStored();
  if (!stored.accessToken || !stored.refreshToken) return null;
  if (!isTokenExpired(stored.expiresAt)) return stored.accessToken;
  const refreshed = await refreshTokens(stored.refreshToken);
  return refreshed || null;
}

let isRefreshing = false;
let refreshPromise = null;

async function refreshTokens(refreshToken) {
  if (isRefreshing) return refreshPromise;

  isRefreshing = true;
  refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken })
      });
      if (!res.ok) { await clearStored(); return null; }
      const data = await res.json();
      await setStored({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresAt: data.expiresAt,
        usuario: data.usuario
      });
      return data.accessToken;
    } catch {
      await clearStored();
      return null;
    } finally {
      isRefreshing = false;
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

// ── Anonymous usage tracking ──────────────────────────────────

async function getAnonUsage() {
  const data = await chrome.storage.local.get(['anonDate', 'anonCount']);
  const today = new Date().toDateString();
  if (data.anonDate !== today) {
    await chrome.storage.local.set({ anonDate: today, anonCount: 0 });
    return 0;
  }
  return data.anonCount || 0;
}

async function incrementAnonUsage() {
  const count = await getAnonUsage();
  await chrome.storage.local.set({ anonDate: new Date().toDateString(), anonCount: count + 1 });
}

// ── API call helper ───────────────────────────────────────────

async function apiCall(method, path, body, token) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Extension-Version': EXTENSION_VERSION,
    'X-Client': 'extension'
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method, headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000)
    });
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      throw new Error('La IA no respondió a tiempo. Intenta de nuevo.');
    }
    throw e;
  }
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { error: true, mensaje: text }; }

  // Version de la extension desactualizada (bloqueo del servidor)
  if (!res.ok && (res.status === 426 || json.codigo === 'EXTENSION_OUTDATED')) {
    await chrome.storage.local.set({ extensionOutdated: json });
    throw new Error(json.mensaje || EXTENSION_OUTDATED_MSG);
  }

  // Session revoked in another device
  if (!res.ok && json.codigo === 'SESSION_REVOKED') {
    await handleSessionRevoked();
    throw new Error(t('sessionInOtherDevice'));
  }

  if (!res.ok) throw new Error(json.mensaje || `Error ${res.status}`);
  return json;
}

async function handleSessionRevoked() {
  await chrome.storage.local.set({ sessionRevokedFlag: true });
  await clearStored();
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { action: 'sessionRevoked' }).catch(() => {});
    }
  });
}

// ── Refresh usage for popup ──

async function refreshUsage(token) {
  try {
    const res = await fetch(`${API_BASE}/ai/usage`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-Extension-Version': EXTENSION_VERSION,
        'X-Client': 'extension'
      }
    });
    if (res.ok) {
      const data = await res.json();
      await chrome.storage.local.set({ latestUsage: data });
    }
  } catch {
    console.warn('refreshUsage: error al refrescar uso');
  }
}

// ── Message handler ───────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  const handler = {
    async checkVersion() {
      const state = await getVersionState(true);
      return { success: true, ...state };
    },
    async login() {
      const data = await apiCall('POST', '/auth/login', { email: msg.email, password: msg.password });
      await setStored({ accessToken: data.accessToken, refreshToken: data.refreshToken, expiresAt: data.expiresAt, usuario: data.usuario });
      return { success: true, data };
    },
    async register() {
      const data = await apiCall('POST', '/auth/register', { email: msg.email, password: msg.password, nombre: msg.nombre, codigo: msg.codigo });
      await setStored({ accessToken: data.accessToken, refreshToken: data.refreshToken, expiresAt: data.expiresAt, usuario: data.usuario });
      // Auto-accept terms
      try {
        await apiCall('POST', '/terms/accept', null, data.accessToken);
      } catch {
        console.warn('register: error al auto-aceptar términos');
      }
      return { success: true, data };
    },
    async logout() {
      const stored = await getStored();
      if (stored.accessToken && stored.refreshToken) {
        try {
          await fetch(`${API_BASE}/auth/logout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${stored.accessToken}` },
            body: JSON.stringify({ refreshToken: stored.refreshToken })
          });
        } catch {
          console.warn('logout: error al cerrar sesión en servidor');
        }
      }
      await clearStored();
      return { success: true };
    },
    async googleLogin() {
      return new Promise((resolve) => {
        chrome.identity.getAuthToken({ interactive: true }, async (token) => {
          if (chrome.runtime.lastError || !token) {
            resolve({ success: false, error: t('googleLoginFailed') });
            return;
          }
          try {
            const data = await apiCall('POST', '/auth/google', { accessToken: token });
            await setStored({ accessToken: data.accessToken, refreshToken: data.refreshToken, expiresAt: data.expiresAt, usuario: data.usuario });
            resolve({ success: true, data });
          } catch (e) {
            resolve({ success: false, error: e.message });
          }
        });
      });
    },
    async getUser() {
      const stored = await getStored();
      if (!stored.usuario) return { success: false, error: t('notLoggedIn') };
      const token = await getValidToken();
      if (!token) return { success: false, error: t('sessionExpired') };
      const data = await apiCall('GET', '/users/me', null, token);
      await setStored({ usuario: data });
      return { success: true, data };
    },
    async getUsage() {
      const token = await getValidToken();
      if (!token) return { success: false, error: t('mustLoginGeneral') };
      const data = await apiCall('GET', '/ai/usage', null, token);
      return { success: true, data };
    },
    async getPlans() {
      const data = await apiCall('GET', '/plans', null, null);
      return { success: true, data };
    },
    async ask() {
      if (!await isServiceEnabled()) {
        return { success: false, error: serviceMaintenanceMsg(), maintenance: true };
      }
      const versionState = await getVersionState();
      if (versionState.outdated) {
        return {
          success: false, outdated: true, error: versionState.message,
          updateUrl: versionState.updateUrl, minVersion: versionState.minVersion,
          latestVersion: versionState.latestVersion
        };
      }
      const text = msg.text;
      const imagenes = msg.imagenes;
      if (imagenes && imagenes.length > 0) {
        const flags = await refreshFlags();
        if (!flags.imagenesHabilitadas) {
          return { success: false, error: t('imagesDisabledByAdmin') };
        }
      }
      const stored = await getStored();
      let token = null;
      if (stored.accessToken) token = await getValidToken();

      const body = { mensaje: text };
      if (imagenes && imagenes.length > 0) body.imagenes = imagenes;

      if (token) {
        const data = await apiCall('POST', '/ai/chat', body, token);
        refreshUsage(token);
        return { success: true, answer: data.respuesta, full: data };
      } else if (imagenes && imagenes.length > 0) {
        return { success: false, error: t('mustLoginForImages2') };
      } else {
        const anonCount = await getAnonUsage();
        if (anonCount >= ANON_LIMIT) {
          return { success: false, error: t('limitReachedMsg', [ANON_LIMIT]), limitReached: true, forceLogin: true };
        }
        const data = await apiCall('POST', '/ai/anonymous', body, null);
        await incrementAnonUsage();
        return { success: true, answer: data.respuesta, full: data, anonymous: true };
      }
    },
    async getConfig() {
      await refreshAnonLimit();
      await refreshFlags();
      const data = await chrome.storage.sync.get({ systemPrompt: '', transparency: false, autoRespond: true, captureMode: false });
      const anonCount = await getAnonUsage();
      return { success: true, config: data, anonCount, anonLimit: ANON_LIMIT, flags: SERVER_FLAGS };
    },
    async sendCode() {
      const data = await apiCall('POST', '/auth/send-code', { email: msg.email });
      return { success: true, data };
    },
    async getPaymentMethods() {
      const data = await apiCall('GET', '/payments/methods', null, null);
      return { success: true, data };
    },
    async getNotifications() {
      const token = await getValidToken();
      if (!token) return { success: false, error: t('mustLoginGeneral') };
      const data = await apiCall('GET', '/notifications', null, token);
      return { success: true, data };
    },
    async markNotificationRead() {
      const token = await getValidToken();
      if (!token) return { success: false, error: t('mustLoginGeneral') };
      const data = await apiCall('PATCH', `/notifications/${msg.id}/read`, null, token);
      return { success: true, data };
    },
    async markAllNotificationsRead() {
      const token = await getValidToken();
      if (!token) return { success: false, error: t('mustLoginGeneral') };
      const data = await apiCall('PATCH', '/notifications/read-all', null, token);
      return { success: true, data };
    },
    async getPayments() {
      const token = await getValidToken();
      if (!token) return { success: false, error: t('mustLoginGeneral') };
      const data = await apiCall('GET', '/payments', null, token);
      return { success: true, data };
    },
    async updateConfig() {
      await chrome.storage.sync.set(msg.config);
      return { success: true };
    },
    async getTerms() {
      const data = await apiCall('GET', '/terms/latest', null, null);
      return { success: true, data };
    },
    async acceptTerms() {
      const token = await getValidToken();
      if (!token) return { success: false, error: t('mustLoginGeneral') };
      const data = await apiCall('POST', '/terms/accept', null, token);
      return { success: true, data };
    },
    async captureScreen() {
      if (!await isServiceEnabled()) {
        return { success: false, error: serviceMaintenanceMsg(), maintenance: true };
      }
      const versionState = await getVersionState();
      if (versionState.outdated) {
        return {
          success: false, outdated: true, error: versionState.message,
          updateUrl: versionState.updateUrl, minVersion: versionState.minVersion,
          latestVersion: versionState.latestVersion
        };
      }
      const flags = await refreshFlags();
      if (!flags.imagenesHabilitadas) return { success: false, error: t('imagesDisabledByAdmin') };
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tabs[0]) return { success: false, error: t('unknownAction') };
        const dataUrl = await chrome.tabs.captureVisibleTab(tabs[0].windowId, { format: 'png' });
        const text = msg.text || 'Analiza esta captura de pantalla';
        const stored = await getStored();
        let token = null;
        if (stored.accessToken) token = await getValidToken();
        if (!token) return { success: false, error: t('mustLoginForImages2') };
        const data = await apiCall('POST', '/ai/chat', { mensaje: text, imagenes: [dataUrl] }, token);
        refreshUsage(token);
        return { success: true, answer: data.respuesta, full: data };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
  };

  const fn = handler[msg.action];
  if (!fn) { sendResponse({ success: false, error: t('unknownAction') }); return false; }
  fn().then(sendResponse).catch(e => sendResponse({ success: false, error: e.message }));
  return true;
});

// ── Notify content scripts when config changes ────────────────

chrome.storage.sync.onChanged.addListener((changes) => {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { action: 'configChanged', changes }).catch(() => {});
    }
  });
});
