const $ = (id) => document.getElementById(id);
const API_BASE = 'https://apipreguntasai.runasp.net/api';
const VIEWS = ['login', 'register', 'profile', 'help', 'plans', 'payment-method', 'transfer', 'card', 'paypal', 'payment-pending', 'notifications', 'terms'];
let currentUser = null;
let currentPlanSlug = 'free';
let anonCount = 0;
let anonLimit = 5;
let selectedPlanForPayment = null;
let selectedPeriod = 'mensual';

function showView(name) {
  VIEWS.forEach(v => $(`view-${v}`).style.display = v === name ? 'block' : 'none');
}

function showLoading(show) {
  $('loading').style.display = show ? 'flex' : 'none';
}

function bg(action, data = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action, ...data }, (res) => {
      if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message });
      else resolve(res || { success: false, error: t('noResponse') });
    });
  });
}

function showError(id, msg) {
  const el = $(id);
  if (el) { el.textContent = msg; el.style.display = msg ? 'block' : 'none'; }
}

function flashStatus(id, msg) {
  const el = $(id);
  if (el) { el.textContent = msg; el.style.display = msg ? 'block' : 'none'; setTimeout(() => { el.textContent = ''; el.style.display = 'none'; }, 4000); }
}

// ── Config / Toggles ──

let currentConfig = { transparency: false, autoRespond: true, captureMode: false };

async function loadConfig() {
  const result = await bg('getConfig');
  if (result.success) {
    currentConfig = result.config;
    $('chk-transparency').checked = currentConfig.transparency || false;
    $('chk-autorespond').checked = currentConfig.autoRespond !== false;
    $('chk-capturemode').checked = currentConfig.captureMode || false;

    applyServerFlags(result.flags);
  }
}

function applyServerFlags(flags) {
  const imagenesHabilitadas = flags && flags.imagenesHabilitadas !== false;
  const row = $('row-capturemode');
  const usageImg = $('usage-images-container');
  const hasImagesEnabled = imagenesHabilitadas;

  if (row) row.style.display = hasImagesEnabled ? '' : 'none';
  if (usageImg) usageImg.style.display = hasImagesEnabled ? '' : 'none';

  if (!hasImagesEnabled && $('chk-capturemode')?.checked) {
    $('chk-capturemode').checked = false;
    currentConfig.captureMode = false;
    saveConfig();
  }
}

async function saveConfig() {
  await bg('updateConfig', { config: currentConfig });
}

$('chk-transparency').addEventListener('change', async () => {
  currentConfig.transparency = $('chk-transparency').checked;
  await saveConfig();
  if (currentConfig.transparency) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) chrome.tabs.reload(tabs[0].id);
    });
  }
});

$('chk-autorespond').addEventListener('change', async () => {
  currentConfig.autoRespond = $('chk-autorespond').checked;
  await saveConfig();
});

$('chk-capturemode').addEventListener('change', async () => {
  currentConfig.captureMode = $('chk-capturemode').checked;
  await saveConfig();
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) chrome.tabs.reload(tabs[0].id);
  });
});

// ── Plan helpers ──

const PLAN_COLOR_PALETTE = [
  { bg: 'rgba(255,255,255,0.08)', fg: 'rgba(255,255,255,0.4)' },
  { bg: 'rgba(108,92,231,0.2)', fg: '#6c5ce7' },
  { bg: 'rgba(253,203,110,0.2)', fg: '#fdcb6e' },
  { bg: 'rgba(0,206,201,0.2)', fg: '#00cec9' },
];

let _plansBySlug = {};
let _plansTiered = [];

function _buildPlanCache(plans) {
  _plansBySlug = {};
  const sorted = [...plans].sort((a, b) => (a.precioMensual || a.precio || 0) - (b.precioMensual || b.precio || 0));
  _plansTiered = sorted.map(p => p.slug);
  sorted.forEach(p => { _plansBySlug[p.slug] = p; });
}

function getPlanLabel(slug) {
  return _plansBySlug[slug]?.nombre || (slug ? slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, ' ') : 'Free');
}

function getPlanIndex(slug) {
  const idx = _plansTiered.indexOf(slug);
  return idx >= 0 ? idx : 0;
}

function getDailyLimit(slug) {
  const val = _plansBySlug[slug]?.caracteristicas?.find(c => c.clave === 'consultas_por_dia')?.valor;
  return val ? parseInt(val) : 20;
}

function getImageLimit(slug) {
  const val = _plansBySlug[slug]?.caracteristicas?.find(c => c.clave === 'imagenes_por_dia')?.valor;
  return val ? parseInt(val) : 0;
}

// ── Render plans ──

async function renderPlans() {
  const container = $('plans-container');
  container.textContent = '';
  const [plansRes, paymentsRes] = await Promise.all([
    bg('getPlans'),
    bg('getPayments')
  ]);
  if (!plansRes.success) {
    const errDiv = document.createElement('div');
    errDiv.className = 'error-msg';
    errDiv.textContent = plansRes.error;
    container.appendChild(errDiv);
    return;
  }
  _buildPlanCache(plansRes.data);
  const payments = paymentsRes.success ? paymentsRes.data : [];
  const pendingPayment = payments.find(p => p.estado === 'pendiente');
  const pendingPlanId = pendingPayment ? String(pendingPayment.planId) : null;

  // Period toggle
  const toggle = document.createElement('div');
  toggle.className = 'period-toggle';
  const mBtn = document.createElement('button');
  mBtn.className = `period-btn ${selectedPeriod === 'mensual' ? 'active' : ''}`;
  mBtn.textContent = t('monthly');
  mBtn.addEventListener('click', () => {
    if (selectedPeriod !== 'mensual') {
      selectedPeriod = 'mensual';
      renderPlans();
    }
  });
  const aBtn = document.createElement('button');
  aBtn.className = `period-btn ${selectedPeriod === 'anual' ? 'active' : ''}`;
  aBtn.textContent = t('yearly');
  aBtn.addEventListener('click', () => {
    if (selectedPeriod !== 'anual') {
      selectedPeriod = 'anual';
      renderPlans();
    }
  });
  toggle.appendChild(mBtn);
  toggle.appendChild(aBtn);
  container.appendChild(toggle);

  plansRes.data.forEach(p => {
    const isMonthly = selectedPeriod === 'mensual';
    const price = isMonthly
      ? (p.precioMensual || p.precio)
      : (p.precioAnual || p.precio * 12);
    const isCurrent = currentPlanSlug === p.slug;
    const isPending = pendingPlanId && String(p.id) === pendingPlanId;
    const limit = p.caracteristicas?.find(c => c.clave === 'consultas_por_dia')?.valor || getDailyLimit(p.slug);
    const imgLimit = p.caracteristicas?.find(c => c.clave === 'imagenes_por_dia')?.valor || getImageLimit(p.slug);
    const priceStr = price > 0
      ? `$${price.toFixed(2)}/${isMonthly ? t('month') : t('year')}`
      : t('gratis');
    const showBuy = !isPending && price > 0;

    const card = document.createElement('div');
    card.className = `plan-card ${isCurrent ? 'plan-current' : ''} ${isPending ? 'plan-pending' : ''}`;

    const nameDiv = document.createElement('div');
    nameDiv.className = 'plan-name';
    nameDiv.textContent = p.nombre;
    card.appendChild(nameDiv);

    const priceDiv = document.createElement('div');
    priceDiv.className = 'plan-price';
    priceDiv.textContent = priceStr;
    card.appendChild(priceDiv);

    const limitDiv = document.createElement('div');
    limitDiv.className = 'plan-limit';
    limitDiv.textContent = t('queriesPerDay', [limit]);
    card.appendChild(limitDiv);

    const imgLimitDiv = document.createElement('div');
    imgLimitDiv.className = 'plan-limit';
    imgLimitDiv.style.marginTop = '2px';
    imgLimitDiv.textContent = t('imagesPerDay', [imgLimit]);
    card.appendChild(imgLimitDiv);

    const descDiv = document.createElement('div');
    descDiv.className = 'plan-desc';
    descDiv.textContent = p.descripcion || '';
    card.appendChild(descDiv);

    if (isCurrent) {
      const badge = document.createElement('div');
      badge.className = 'plan-current-badge';
      badge.textContent = t('currentPlanLabel');
      card.appendChild(badge);
    }

    if (isPending) {
      const badge = document.createElement('div');
      badge.className = 'plan-pending-badge';
      badge.textContent = '⏳ ' + t('pendingBadge');
      card.appendChild(badge);
    }

    if (!isPending && price > 0) {
      if (isCurrent && currentUser?.planExpiracion) {
        const expDate = new Date(currentUser.planExpiracion);
        if (expDate > new Date()) {
          const daysToAdd = selectedPeriod === 'anual' ? 365 : p.duracionDias;
          const newExp = new Date(expDate.getTime() + daysToAdd * 86400000);
          const info = document.createElement('div');
          info.className = 'plan-info';
          info.textContent = t('alreadyActive', [expDate.toLocaleDateString(), newExp.toLocaleDateString()]);
          card.appendChild(info);
        }
      } else if (!isCurrent && currentPlanSlug && currentPlanSlug !== 'free') {
        const currentTier = getPlanIndex(currentPlanSlug);
        const newTier = getPlanIndex(p.slug);
        const info = document.createElement('div');
        info.className = 'plan-info';
        info.textContent = newTier > currentTier ? t('upgradeInfo') : t('downgradeInfo');
        card.appendChild(info);
      }
    }

    if (showBuy) {
      const btn = document.createElement('button');
      btn.className = 'btn-buy-plan';
      btn.dataset.planId = p.id;
      btn.dataset.planName = p.nombre;
      btn.dataset.planPrice = price;
      btn.dataset.planSlug = p.slug;
      btn.dataset.periodo = selectedPeriod;
      btn.textContent = isCurrent ? t('extend') : t('buy');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedPlanForPayment = {
          id: btn.dataset.planId,
          nombre: btn.dataset.planName,
          precio: parseFloat(btn.dataset.planPrice),
          slug: btn.dataset.planSlug,
          periodo: btn.dataset.periodo
        };
        showPaymentMethod();
      });
      card.appendChild(btn);
    }

    container.appendChild(card);
  });
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ── Payment flow ──

async function showPaymentMethod() {
  showError('pm-error', '');
  const summary = $('payment-plan-summary');
  summary.textContent = '';
  const isMonthly = selectedPlanForPayment.periodo === 'mensual';
  const selDiv = document.createElement('div');
  selDiv.className = 'payment-plan-selected';
  const nameSpan = document.createElement('span');
  nameSpan.className = 'pps-name';
  nameSpan.textContent = selectedPlanForPayment.nombre;
  const priceSpan = document.createElement('span');
  priceSpan.className = 'pps-price';
  priceSpan.textContent = `$${selectedPlanForPayment.precio.toFixed(2)}/${isMonthly ? t('month') : t('year')}`;
  selDiv.appendChild(nameSpan);
  selDiv.appendChild(priceSpan);
  summary.appendChild(selDiv);
  const transferBtn = document.querySelector('.payment-method-btn[data-method="transferencia"]');
  if (transferBtn) {
    transferBtn.style.display = currentUser?.paisCodigo === 'EC' ? '' : 'none';
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
  showView('payment-method');
}

// Payment method buttons
document.querySelectorAll('.payment-method-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const method = btn.dataset.method;
    if (method === 'transferencia') {
      showLoading(true);
      const result = await bg('getPaymentMethods');
      showLoading(false);
      if (result.success && result.data?.metodos) {
        const transferData = result.data.metodos.find(m => m.slug === 'transferencia')?.datosTransferencia;
        if (transferData) {
          $('td-banco').textContent = transferData.banco;
          $('td-cuenta').textContent = transferData.cuenta;
          $('td-titular').textContent = transferData.titular;
          $('td-instrucciones').textContent = transferData.instrucciones;
          $('qr-image').src = transferData.qrUrl + '?t=' + Date.now();
        }
      } else {
        showError('transfer-error', t('paymentMethodsError'));
        return;
      }
      $('transfer-file').value = '';
      showError('transfer-error', '');
      showView('transfer');
    } else if (method === 'tarjeta') {
      showView('card');
    } else if (method === 'paypal') {
      showView('paypal');
    }
  });
});

$('btn-submit-transfer').addEventListener('click', async () => {
  showError('transfer-error', '');
  const fileInput = $('transfer-file');
  const file = fileInput.files[0];
  if (!file) { showError('transfer-error', t('selectFile')); return; }

  // Validaciones client-side
  const allowedTypes = ['image/jpeg', 'image/png'];
  if (!allowedTypes.includes(file.type)) {
    showError('transfer-error', t('invalidFormat'));
    return;
  }
  const maxSize = 5 * 1024 * 1024;
  if (file.size > maxSize) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    showError('transfer-error', t('fileTooLarge', [mb]));
    return;
  }

  $('btn-submit-transfer').disabled = true;
  showLoading(true);

  try {
    const stored = await chrome.storage.session.get(['accessToken']);
    const token = stored.accessToken;
    if (!token) throw new Error(t('mustLogin'));

    // Subir directo sin pasar por background
    const formData = new FormData();
    formData.append('planId', selectedPlanForPayment.id.toString());
    formData.append('periodo', selectedPlanForPayment.periodo || 'mensual');
    formData.append('comprobante', file);

    const res = await fetch(`${API_BASE}/payments/transfer`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });

    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { error: true, mensaje: text }; }

    if (!res.ok) throw new Error(json.mensaje || `Error ${res.status}`);

    showLoading(false);
    $('btn-submit-transfer').disabled = false;
    showView('payment-pending');
  } catch (e) {
    showLoading(false);
    $('btn-submit-transfer').disabled = false;
    showError('transfer-error', e.message);
  }
});

// ── Payment back buttons ──

$('btn-back-payment-method').addEventListener('click', () => {
  $('btn-back-payment-method').disabled = true;
  showLoading(true);
  renderPlans().then(() => { showLoading(false); $('btn-back-payment-method').disabled = false; });
  showView('plans');
});
$('btn-back-transfer').addEventListener('click', () => showPaymentMethod());
$('btn-back-card').addEventListener('click', () => showPaymentMethod());
$('btn-back-paypal').addEventListener('click', () => showPaymentMethod());
$('btn-back-pending').addEventListener('click', () => {
  $('btn-back-pending').disabled = true;
  showLoading(true);
  refreshProfile().then(() => { showLoading(false); $('btn-back-pending').disabled = false; });
});
$('btn-back-to-profile').addEventListener('click', () => {
  $('btn-back-to-profile').disabled = true;
  showLoading(true);
  refreshProfile().then(() => { showLoading(false); $('btn-back-to-profile').disabled = false; });
});

// ── Refresh profile data ──

async function refreshProfile() {
  const result = await bg('getUser');
  if (result.success) {
    currentUser = result.data;
    currentPlanSlug = result.data.plan || 'free';
    $('profile-name').textContent = `${result.data.nombre} ${result.data.apellido || ''}`.trim();
    $('profile-email').textContent = result.data.email;
    const [usageRes, paymentsRes, notifRes, plansRes] = await Promise.all([
      bg('getUsage'),
      bg('getPayments'),
      bg('getNotifications'),
      bg('getPlans')
    ]);
    if (usageRes.success) {
      const used = usageRes.data.consultasHoy || 0;
      const limit = usageRes.data.limiteDiario || getDailyLimit(currentPlanSlug);
      const remaining = usageRes.data.consultasRestantes || 0;
      const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
      $('usage-text').textContent = t('usesToday', [used, limit]);
      $('usage-remaining').textContent = t('remaining', [remaining]);
      $('usage-fill').style.width = `${pct}%`;
      const imgUsed = usageRes.data.imagenesHoy || 0;
      const imgLimit = usageRes.data.limiteImagenes || getImageLimit(currentPlanSlug);
      const imgRemaining = usageRes.data.imagenesRestantes || 0;
      $('image-usage-text').textContent = t('imagesToday', [imgUsed, imgLimit]);
      $('image-remaining').textContent = t('remainingImages', [imgRemaining]);
      const imgPct = imgLimit > 0 ? Math.min(100, (imgUsed / imgLimit) * 100) : 0;
      $('image-usage-fill').style.width = `${imgPct}%`;
    }
    updateResetInfo();
    // Plan info from DB
    if (plansRes.success) {
      _buildPlanCache(plansRes.data);
      const badge = $('plan-badge');
      const planIdx = getPlanIndex(currentPlanSlug);
      const palette = PLAN_COLOR_PALETTE[planIdx] || PLAN_COLOR_PALETTE[0];
      badge.textContent = getPlanLabel(currentPlanSlug);
      badge.style.background = palette.bg;
      badge.style.color = palette.fg;
      badge.className = 'badge';
      const currentPlan = plansRes.data.find(p => p.slug === currentPlanSlug);
      if (currentPlan) {
        const queryLimit = currentPlan.caracteristicas?.find(c => c.clave === 'consultas_por_dia')?.valor || getDailyLimit(currentPlanSlug);
        const imgPlanLimit = currentPlan.caracteristicas?.find(c => c.clave === 'imagenes_por_dia')?.valor || getImageLimit(currentPlanSlug);
        const section = $('plan-info-section');
        section.textContent = '';
        const strong = document.createElement('strong');
        strong.textContent = currentPlan.nombre;
        section.appendChild(strong);
        section.appendChild(document.createElement('br'));
        section.appendChild(document.createTextNode(t('queriesPerDay', [queryLimit])));
        section.appendChild(document.createElement('br'));
        section.appendChild(document.createTextNode(t('imagesPerDay', [imgPlanLimit])));
        section.appendChild(document.createElement('br'));
        const descSpan = document.createElement('span');
        descSpan.style.cssText = 'font-size:11px;color:rgba(255,255,255,0.4)';
        descSpan.textContent = currentPlan.descripcion || '';
        section.appendChild(descSpan);
      }
    }
    // Pending payment banner
    const hasPending = paymentsRes.success && paymentsRes.data.some(p => p.estado === 'pendiente');
    $('pending-banner').style.display = hasPending ? 'flex' : 'none';
    // Notification badge
    const noLeidas = notifRes.success ? notifRes.data.noLeidas : 0;
    const badgeEl = $('notif-badge');
    if (noLeidas > 0) {
      badgeEl.textContent = noLeidas > 99 ? '99+' : noLeidas;
      badgeEl.style.display = 'flex';
    } else {
      badgeEl.style.display = 'none';
    }
    showView('profile');
  } else {
    await showAnonView();
  }
}

// ── Anonymous view ──

async function showAnonView() {
  const result = await bg('getConfig');
  anonCount = result.anonCount || 0;
  anonLimit = result.anonLimit || 5;
  const remaining = anonLimit - anonCount;
  $('plan-badge').textContent = t('anon');
  $('plan-badge').className = 'badge badge-free';
  $('anon-info').textContent = t('freeUses', [anonCount, anonLimit]);
  $('anon-info').style.display = 'block';
  if (remaining <= 0) {
    $('anon-info').textContent += t('limitReachedSuffix');
  }
  showView('login');
}

// ── Login ──

function doLogin() { $('btn-login').click(); }

['login-email', 'login-password'].forEach(id => {
  $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
});

$('btn-login').addEventListener('click', async () => {
  showError('login-error', '');
  const email = $('login-email').value.trim();
  const password = $('login-password').value.trim();
  if (!email || !password) { showError('login-error', t('requiredFields')); return; }
  $('btn-login').disabled = true;
  showLoading(true);
  const result = await bg('login', { email, password });
  showLoading(false);
  $('btn-login').disabled = false;
  if (result.success) {
    $('login-email').value = '';
    $('login-password').value = '';
    if (result.data?.usuario?.termsRequired) {
      await showTermsAcceptance();
    } else {
      await refreshProfile();
    }
  } else {
    showError('login-error', result.error || t('loginError'));
  }
});

// ── Terms Acceptance ──

async function showTermsAcceptance() {
  showError('terms-error', '');
  try {
    const res = await bg('getTerms');
    if (res.success && res.data?.existe) {
      $('terms-title').textContent = res.data.titulo || 'Términos de Uso';
      $('terms-body').textContent = res.data.contenido || t('termsBodyEmpty');
    } else {
      $('terms-title').textContent = 'Términos de Uso';
      $('terms-body').textContent = res.data?.mensaje || t('termsBodyFallback');
    }
  } catch {
    $('terms-body').textContent = t('termsFetchError');
  }
  $('terms-accept-checkbox').checked = false;
  showView('terms');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

$('btn-accept-terms').addEventListener('click', async () => {
  showError('terms-error', '');
  if (!$('terms-accept-checkbox').checked) {
    showError('terms-error', t('acceptTermsError'));
    return;
  }
  $('btn-accept-terms').disabled = true;
  showLoading(true);
  const res = await bg('acceptTerms');
  showLoading(false);
  $('btn-accept-terms').disabled = false;
  if (res.success) {
    await refreshProfile();
  } else {
    showError('terms-error', res.error || t('termsAcceptError'));
  }
});

$('btn-logout-terms').addEventListener('click', async () => {
  $('btn-logout-terms').disabled = true;
  showLoading(true);
  await bg('logout');
  showLoading(false);
  $('btn-logout-terms').disabled = false;
  currentUser = null;
  currentPlanSlug = 'free';
  await showAnonView();
});

$('btn-view-terms-register').addEventListener('click', async (e) => {
  e.preventDefault();
  showError('register-error', '');
  try {
    const res = await bg('getTerms');
    if (res.success && res.data?.existe) {
      $('terms-title').textContent = res.data.titulo || 'Términos de Uso';
      $('terms-body').textContent = res.data.contenido || t('termsBodyEmpty');
    } else {
      $('terms-title').textContent = 'Términos de Uso';
      $('terms-body').textContent = res.data?.mensaje || t('termsBodyFallback');
    }
  } catch {
    $('terms-body').textContent = t('termsFetchError');
  }
  showView('terms');
  if (typeof lucide !== 'undefined') lucide.createIcons();
});

// ── Send verification code ──

$('btn-send-code').addEventListener('click', async () => {
  showError('register-error', '');
  const email = $('reg-email').value.trim();
  if (!email) { showError('register-error', t('enterEmail')); return; }
  $('btn-send-code').disabled = true;
  showLoading(true);
  const result = await bg('sendCode', { email });
  showLoading(false);
  $('btn-send-code').disabled = false;
  if (result.success) {
    flashStatus('register-error', t('codeSent'));
  } else {
    showError('register-error', result.error || t('sendCodeError'));
  }
});

// ── Register ──

$('btn-register').addEventListener('click', async () => {
  showError('register-error', '');
  const nombre = $('reg-nombre').value.trim();
  const email = $('reg-email').value.trim();
  const password = $('reg-password').value;
  const confirm = $('reg-confirm').value;
  const codigo = $('reg-codigo').value.trim();

  if (!nombre || !email || !password || !codigo) { showError('register-error', t('requiredFields')); return; }
  if (password !== confirm) { showError('register-error', t('passwordsDontMatch')); return; }
  if (password.length < 8) { showError('register-error', t('passwordMinLength')); return; }
  if (!$('reg-accept-terms').checked) { showError('register-error', t('mustAcceptTermsRegister')); return; }

  $('btn-register').disabled = true;
  showLoading(true);
  const result = await bg('register', { nombre, email, password, codigo });
  showLoading(false);
  $('btn-register').disabled = false;
  if (result.success) {
    $('reg-nombre').value = '';
    $('reg-email').value = '';
    $('reg-password').value = '';
    $('reg-confirm').value = '';
    $('reg-codigo').value = '';
    await refreshProfile();
  } else {
    showError('register-error', result.error || t('registerError'));
  }
});

// ── Google Login ──

$('btn-google').addEventListener('click', async () => {
  showError('login-error', '');
  $('btn-google').disabled = true;
  showLoading(true);
  const result = await bg('googleLogin');
  showLoading(false);
  $('btn-google').disabled = false;
  if (result.success) {
    const terms = result.data?.usuario?.termsRequired;
    if (terms) {
      await showTermsAcceptance();
    } else {
      await refreshProfile();
    }
  } else {
    showError('login-error', result.error || t('googleError'));
  }
});

// ── Logout ──

$('btn-logout').addEventListener('click', async () => {
  $('btn-logout').disabled = true;
  showLoading(true);
  await bg('logout');
  showLoading(false);
  $('btn-logout').disabled = false;
  currentUser = null;
  currentPlanSlug = 'free';
  await showAnonView();
});

// ── View switching ──

$('link-register').addEventListener('click', (e) => { e.preventDefault(); showView('register'); showError('login-error', ''); });
$('link-login').addEventListener('click', (e) => { e.preventDefault(); showView('login'); showError('register-error', ''); });

$('btn-help').addEventListener('click', () => showView('help'));
$('btn-back-help').addEventListener('click', () => {
  if (currentUser) showView('profile'); else showView('login');
});

$('btn-plans').addEventListener('click', async () => {
  $('btn-plans').disabled = true;
  showLoading(true);
  await renderPlans();
  showLoading(false);
  $('btn-plans').disabled = false;
  showView('plans');
});
$('btn-back-plans').addEventListener('click', () => showView('profile'));

// ── Notifications ──

$('btn-notifications').addEventListener('click', async () => {
  $('btn-notifications').disabled = true;
  showLoading(true);
  const res = await bg('getNotifications');
  showLoading(false);
  $('btn-notifications').disabled = false;
  if (res.success) {
    renderNotifications(res.data);
    showView('notifications');
  } else {
    toast(res.error, 'error');
  }
});

$('btn-back-notifications').addEventListener('click', async () => {
  $('btn-back-notifications').disabled = true;
  await refreshProfile();
  $('btn-back-notifications').disabled = false;
});

$('btn-mark-all-read').addEventListener('click', async () => {
  $('btn-mark-all-read').disabled = true;
  await bg('markAllNotificationsRead');
  $('btn-mark-all-read').disabled = false;
  const res = await bg('getNotifications');
  if (res.success) renderNotifications(res.data);
  $('notif-badge').style.display = 'none';
});

function renderNotifications(data) {
  const container = $('notifications-container');
  const { notificaciones, noLeidas } = data;
  $('btn-mark-all-read').style.display = noLeidas > 0 ? 'inline' : 'none';
  container.textContent = '';
  if (!notificaciones || notificaciones.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'notif-empty';
    empty.textContent = t('noNotifications');
    container.appendChild(empty);
    return;
  }
  notificaciones.forEach(n => {
    const item = document.createElement('div');
    item.className = `notif-item ${n.leida ? '' : 'notif-unread'}`;
    item.dataset.id = n.id;

    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', n.tipo === 'pago_rechazado' ? 'x-circle' : 'bell');
    icon.className = `notif-icon ${n.tipo === 'pago_rechazado' ? 'rejected' : 'default'}`;
    item.appendChild(icon);

    const body = document.createElement('div');
    body.className = 'notif-body';

    const title = document.createElement('div');
    title.className = 'notif-title';
    title.textContent = n.titulo;
    body.appendChild(title);

    const msg = document.createElement('div');
    msg.className = 'notif-message';
    msg.textContent = n.mensaje || '';
    body.appendChild(msg);

    const date = document.createElement('div');
    date.className = 'notif-date';
    date.textContent = new Date(n.createdAt).toLocaleString();
    body.appendChild(date);

    item.appendChild(body);

    if (!n.leida) {
      const dot = document.createElement('div');
      dot.className = 'notif-dot';
      item.appendChild(dot);
    }

    container.appendChild(item);
  });
  if (typeof lucide !== 'undefined') lucide.createIcons();
  // Click to mark as read
  container.querySelectorAll('.notif-item.notif-unread').forEach(el => {
    el.addEventListener('click', async () => {
      const id = el.dataset.id;
      await bg('markNotificationRead', { id: parseInt(id) });
      el.classList.remove('notif-unread');
      el.querySelector('.notif-dot')?.remove();
      const badgeEl = $('notif-badge');
      const count = parseInt(badgeEl.textContent || '0');
      if (count > 1) badgeEl.textContent = count - 1;
      else badgeEl.style.display = 'none';
    });
  });
}

// ── Session revoked modal ──

function showSessionRevokedModal() {
  const existing = document.getElementById('sr-modal');
  if (existing) return;

  document.getElementById('app').style.filter = 'blur(4px)';
  document.getElementById('app').style.pointerEvents = 'none';

  const overlay = document.createElement('div');
  overlay.id = 'sr-modal';
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', zIndex: '9999',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(0,0,0,0.5)',
    fontFamily: 'Inter, Segoe UI, Arial, sans-serif'
  });

  const card = document.createElement('div');
  Object.assign(card.style, {
    background: '#1a1a2e', borderRadius: '12px', padding: '28px 32px',
    maxWidth: '320px', width: '90%', textAlign: 'center',
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)'
  });

  const msg = document.createElement('p');
  msg.textContent = t('sessionRevoked');
  Object.assign(msg.style, {
    color: '#fff', fontSize: '15px', fontWeight: '500',
    margin: '0 0 20px', lineHeight: '1.5'
  });

  const btn = document.createElement('button');
  btn.textContent = t('ok');
  Object.assign(btn.style, {
    background: '#6c5ce7', color: '#fff', border: 'none',
    borderRadius: '8px', padding: '10px 32px', fontSize: '14px',
    fontWeight: '600', cursor: 'pointer', transition: 'opacity 0.15s'
  });
  btn.addEventListener('mouseenter', () => btn.style.opacity = '0.85');
  btn.addEventListener('mouseleave', () => btn.style.opacity = '1');
  btn.addEventListener('click', () => {
    overlay.remove();
    document.getElementById('app').style.filter = '';
    document.getElementById('app').style.pointerEvents = '';
    chrome.storage.local.remove('sessionRevokedFlag');
    showAnonView();
  });

  card.appendChild(msg);
  card.appendChild(btn);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

// ── Live usage update ──

function updateResetInfo() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const diff = midnight - now;
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  $('reset-info').textContent = t('resetIn', [hours, mins]);
}

function updateUsageUI(usage) {
  const used = usage.consultasHoy || 0;
  const limit = usage.limiteDiario || getDailyLimit(currentPlanSlug);
  const remaining = usage.consultasRestantes || 0;
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  $('usage-text').textContent = t('usesToday', [used, limit]);
  $('usage-remaining').textContent = t('remaining', [remaining]);
  $('usage-fill').style.width = `${pct}%`;

  const imgUsed = usage.imagenesHoy || 0;
  const imgLimit = usage.limiteImagenes || getImageLimit(currentPlanSlug);
  const imgRemaining = usage.imagenesRestantes || 0;
  $('image-usage-text').textContent = t('imagesToday', [imgUsed, imgLimit]);
  $('image-remaining').textContent = t('remainingImages', [imgRemaining]);
  const imgPct = imgLimit > 0 ? Math.min(100, (imgUsed / imgLimit) * 100) : 0;
  $('image-usage-fill').style.width = `${imgPct}%`;
  updateResetInfo();
}

// ── Auto-detect session revoked ──

function updateAnonDisplay() {
  if ($('view-login').style.display !== 'block') return;
  bg('getConfig').then(result => {
    if (!result.success) return;
    anonCount = result.anonCount || 0;
    anonLimit = result.anonLimit || 5;
    const remaining = anonLimit - anonCount;
    $('anon-info').textContent = t('freeUses', [anonCount, anonLimit]);
    if (remaining <= 0) {
      $('anon-info').textContent += t('limitReachedSuffix');
    }
  });
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.sessionRevokedFlag && changes.sessionRevokedFlag.newValue) {
    currentUser = null;
    currentPlanSlug = 'free';
    if (document.getElementById('sr-modal')) return;
    showSessionRevokedModal();
    return;
  }
  if (changes.latestUsage) {
    updateUsageUI(changes.latestUsage.newValue);
  }
  if (changes.anonCount || changes.anonDate) {
    updateAnonDisplay();
  }
});

// ── Version gate (forced update) ──

function showUpdateRequired(state) {
  const overlay = $('update-overlay');
  if (!overlay) return false;

  $('update-message').textContent = state.message || t('updateRequiredMessage');
  $('update-version').textContent =
    `Actual: ${state.currentVersion || '?'} · Mínima: ${state.minVersion || '?'}`;
  overlay.style.display = 'flex';

  const btn = $('btn-update-extension');
  if (btn) {
    if (state.updateUrl) {
      btn.style.display = '';
      btn.onclick = () => chrome.tabs.create({ url: state.updateUrl });
    } else {
      btn.style.display = 'none';
    }
  }
  return true;
}

async function checkVersionGate() {
  const result = await bg('checkVersion');
  if (result.success && result.outdated) {
    showUpdateRequired(result);
    return true;
  }

  // Si el servidor ya rechazo una peticion con 426, bloqueamos igual aunque
  // /config/version no responda (red caida, etc.).
  const stored = await chrome.storage.local.get('extensionOutdated');
  if (stored && stored.extensionOutdated) {
    const info = stored.extensionOutdated;
    showUpdateRequired({
      currentVersion: chrome.runtime.getManifest().version,
      minVersion: info.minVersion,
      updateUrl: info.updateUrl,
      message: info.mensaje
    });
    return true;
  }

  return false;
}

// ── Init ──

document.addEventListener('DOMContentLoaded', async () => {
  applyI18n();
  showLoading(true);

  const versionEl = $('app-version');
  if (versionEl) versionEl.textContent = 'v' + chrome.runtime.getManifest().version;

  if (await checkVersionGate()) {
    showLoading(false);
    return;
  }

  const stored = await chrome.storage.local.get('sessionRevokedFlag');
  if (stored.sessionRevokedFlag) {
    showLoading(false);
    showSessionRevokedModal();
    return;
  }

  await loadConfig();
  await refreshProfile();
  if (typeof lucide !== 'undefined') lucide.createIcons();
  showLoading(false);
});
