const t = (key, subs = []) => {
  try {
    const msg = chrome.i18n.getMessage(key, subs);
    return msg || key;
  } catch {
    return key;
  }
};
(() => {
  let config = { transparency: false, autoRespond: true, captureMode: false };

  // ── Read config ──

  function readConfig() {
    chrome.storage.sync.get({ transparency: false, autoRespond: true, captureMode: false }, (data) => {
      const captureChanged = config.captureMode !== data.captureMode;
      config = data;
      applyTransparency(config.transparency);
      if (captureChanged) updateCaptureMode();
    });
  }

  // ── Transparency ──

  function applyTransparency(enable) {
    const existing = document.getElementById('er-transparency');
    if (existing) existing.remove();
    if (enable) {
      const style = document.createElement('style');
      style.id = 'er-transparency';
      style.textContent = `::selection { background: transparent !important; color: inherit !important; } ::-moz-selection { background: transparent !important; color: inherit !important; }`;
      document.head.appendChild(style);
    }
  }

  // ── Text extraction (same as before) ──

  function getSelectedText() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return '';
    const plain = sel.toString().trim();
    if (!plain || sel.rangeCount === 0) return plain;
    try {
      const range = sel.getRangeAt(0);
      const root = range.commonAncestorContainer;
      const walkerRoot = root.nodeType === 3 ? root.parentNode : root;
      const fragment = range.cloneContents();
      const textParts = [];
      const walk = (node) => {
        if (node.nodeType === 3) { const t = node.textContent.trim(); if (t) textParts.push(t); return; }
        if (node.nodeType !== 1) return;
        if (node.classList && node.classList.contains('katex-mathml')) return;
        if (node.tagName === 'MATH' || node.tagName === 'math') return;
        if (node.tagName === 'IMG' && node.alt) { textParts.push(node.alt); return; }
        if (node.tagName === 'SUP') { textParts.push('^('); for (let c of node.childNodes) walk(c); textParts.push(')'); return; }
        if (node.tagName === 'SUB') { textParts.push('_('); for (let c of node.childNodes) walk(c); textParts.push(')'); return; }
        for (let c of node.childNodes) walk(c);
      };
      for (let c of fragment.childNodes) walk(c);
      let result = textParts.join('').replace(/\s+/g, ' ').trim();
      const suppParts = [];
      const seenSupp = new Set();
      const elWalker = document.createTreeWalker(walkerRoot, NodeFilter.SHOW_ELEMENT, null, false);
      while (elWalker.nextNode()) {
        const el = elWalker.currentNode;
        if (!range.intersectsNode(el)) continue;
        if (el.hasAttribute('aria-label')) { const label = el.getAttribute('aria-label').trim(); if (label && !seenSupp.has(label)) { seenSupp.add(label); suppParts.push(label); } }
        if (el.tagName === 'IMG' && el.alt) { const alt = el.alt.trim(); if (alt && !seenSupp.has(alt)) { seenSupp.add(alt); suppParts.push(alt); } }
      }
      if (suppParts.length) result = result + '\n' + suppParts.join('\n');
      result = result.replace(/([a-dA-D]\))/g, '\n$1').trim();
      return result.length > plain.length ? result : plain.replace(/([a-dA-D]\))/g, '\n$1').trim();
    } catch (_) {
      return plain.replace(/([a-dA-D]\))/g, '\n$1').trim();
    }
  }

  // ── Tooltip (bottom-right) ──

  let tooltip = null;
  let isLoading = false;

  function getTooltipStyles() {
    return {
      background: '#fff',
      color: '#666',
      fontSize: '12px',
      border: '1px solid rgba(0,0,0,0.08)',
      boxShadow: '0 2px 12px rgba(0,0,0,0.1)',
      opacity: '0.85'
    };
  }

  function showTooltip(text, isButton = false, onClick = null) {
    const styles = getTooltipStyles();
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = 'er-tooltip';
      document.body.appendChild(tooltip);
    }
    Object.assign(tooltip.style, {
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      zIndex: '2147483647',
      borderRadius: '8px',
      padding: isButton ? '4px 14px' : '8px 16px',
      fontFamily: 'Segoe UI, Arial, sans-serif',
      display: 'none',
      maxWidth: '300px',
      wordBreak: 'break-word',
      lineHeight: '1.3',
      cursor: onClick ? 'pointer' : 'default',
      ...styles
    });
    if (isButton) {
      tooltip.textContent = '?';
      tooltip.style.fontSize = '24px';
      tooltip.style.cursor = 'pointer';
      tooltip.onclick = onClick;
    } else {
      tooltip.textContent = text;
      tooltip.style.fontSize = styles.fontSize;
      tooltip.style.cursor = onClick ? 'pointer' : 'default';
      tooltip.onclick = onClick;
    }
    tooltip.style.display = 'flex';
    tooltip.style.opacity = styles.opacity;
    clearTimeout(tooltip._hideTimer);
    if (!isButton && text !== '...' && !onClick) {
      tooltip._hideTimer = setTimeout(() => { if (tooltip) tooltip.style.display = 'none'; }, 30000);
    }
  }

  function hideTooltip() {
    if (tooltip) tooltip.style.display = 'none';
  }

  // ── Floating "?" button at end of selection ──

  let floatBtn = null;
  let pendingText = '';

  function createFloatBtn() {
    removeFloatBtn();
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const btnX = Math.max(rect.left - 34, 4);
    const btnY = rect.top - 6;
    floatBtn = document.createElement('div');
    floatBtn.id = 'er-float-btn';
    Object.assign(floatBtn.style, {
      position: 'fixed',
      left: btnX + 'px',
      top: btnY + 'px',
      zIndex: '2147483647',
      width: '28px',
      height: '28px',
      borderRadius: '50%',
      background: '#fff',
      color: '#666',
      fontFamily: 'Segoe UI, Arial, sans-serif',
      fontSize: '15px',
      fontWeight: '700',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      boxShadow: '0 1px 6px rgba(0,0,0,0.15)',
      border: '1px solid rgba(0,0,0,0.08)',
      transition: 'opacity 0.15s, transform 0.15s',
      userSelect: 'none',
      opacity: '1'
    });
    floatBtn.textContent = '?';
    floatBtn.addEventListener('mouseenter', () => { floatBtn.style.opacity = '0.8'; });
    floatBtn.addEventListener('mouseleave', () => { floatBtn.style.opacity = '1'; });
    floatBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isLoading) return;
      const text = pendingText;
      pendingText = '';
      removeFloatBtn();
      isLoading = true;
      showTooltip('...');
      askBackground(text).then((result) => {
        isLoading = false;
        if (result.success && result.answer) {
          showTooltip(result.answer);
        } else if (result.forceLogin) {
          showTooltip(t('loginToContinue'), false, () => { openSlidebar(); });
        } else if (result.error) {
          showTooltip(result.error.substring(0, 50));
        } else {
          showTooltip('?', true);
        }
      });
    });
    document.body.appendChild(floatBtn);
  }

  function removeFloatBtn() {
    if (floatBtn) {
      floatBtn.remove();
      floatBtn = null;
    }
  }

  // ── API call ──

  async function askBackground(text) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'ask', text }, (res) => {
        if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message });
        else resolve(res || { success: false, error: t('noResponse') });
      });
    });
  }

  // ── Capture mode (📷 button on right-click) ──

  let captureBtn = null;

  function updateCaptureMode() {
    if (config.captureMode) {
      window.addEventListener('contextmenu', onContextMenu, true);
    } else {
      window.removeEventListener('contextmenu', onContextMenu, true);
      removeCaptureBtn();
    }
  }

  function onContextMenu(e) {
    if (!config.captureMode) return;
    e.preventDefault();
    showCaptureBtn(e.clientX, e.clientY);
  }

  function showCaptureBtn(x, y) {
    removeCaptureBtn();
    captureBtn = document.createElement('div');
    captureBtn.id = 'er-capture-btn';
    Object.assign(captureBtn.style, {
      position: 'fixed',
      left: x + 'px',
      top: y + 'px',
      zIndex: '2147483647',
      width: '32px',
      height: '32px',
      borderRadius: '50%',
      background: '#fff',
      color: '#333',
      fontFamily: 'Segoe UI, Arial, sans-serif',
      fontSize: '17px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      boxShadow: '0 2px 12px rgba(0,0,0,0.2)',
      border: '1px solid rgba(0,0,0,0.08)',
      transition: 'opacity 0.15s, transform 0.15s',
      userSelect: 'none',
      opacity: '1',
      transform: 'scale(1)'
    });
    captureBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>';
    captureBtn.title = t('captureAndAnalyze');
    captureBtn.addEventListener('mouseenter', () => { captureBtn.style.opacity = '0.8'; });
    captureBtn.addEventListener('mouseleave', () => { captureBtn.style.opacity = '1'; });
    captureBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      removeCaptureBtn();
      if (isLoading) return;
      isLoading = true;
      showTooltip('...');
      const text = getSelectedText();
      const result = await captureBackground(text);
      isLoading = false;
      if (result.success && result.answer) {
        showTooltip(result.answer);
      } else if (result.forceLogin) {
        showTooltip(t('loginToContinue'), false, () => { openSlidebar(); });
      } else if (result.error) {
        showTooltip(result.error.substring(0, 50));
      } else {
        showTooltip('?', true);
      }
    });
    document.body.appendChild(captureBtn);

    // Hide on click outside
    setTimeout(() => {
      document.addEventListener('click', hideCaptureOnClickOutside, { once: true });
    }, 10);
  }

  function hideCaptureOnClickOutside(e) {
    if (captureBtn && e.target !== captureBtn) removeCaptureBtn();
  }

  function removeCaptureBtn() {
    if (captureBtn) {
      captureBtn.remove();
      captureBtn = null;
    }
    document.removeEventListener('click', hideCaptureOnClickOutside);
  }

  async function captureBackground(text) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'captureScreen', text }, (res) => {
        if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message });
        else resolve(res || { success: false, error: t('noResponse') });
      });
    });
  }

  // ── Mouse events ──

  let _mouseDownPos = null;

  window.addEventListener('mousedown', (e) => {
    _mouseDownPos = { x: e.clientX, y: e.clientY };
    if (floatBtn && e.target !== floatBtn && !floatBtn.contains(e.target)) {
      removeFloatBtn();
    }
    if (tooltip && e.target !== tooltip && !tooltip.contains(e.target)) {
      hideTooltip();
    }
  }, true);

  window.addEventListener('mouseup', async (e) => {
    if (tooltip && (e.target === tooltip || tooltip.contains(e.target))) return;
    if (floatBtn && (e.target === floatBtn || floatBtn.contains(e.target))) return;

    // If mouse barely moved, it was a click, not a selection
    if (_mouseDownPos) {
      const dx = e.clientX - _mouseDownPos.x;
      const dy = e.clientY - _mouseDownPos.y;
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    }

    const text = getSelectedText();
    if (text.length <= 5) { removeFloatBtn(); return; }

    removeFloatBtn();

    if (config.autoRespond) {
      if (isLoading) return;
      isLoading = true;
      showTooltip('...');
      const result = await askBackground(text);
      isLoading = false;
      if (result.success && result.answer) {
        showTooltip(result.answer);
      } else if (result.forceLogin) {
        showTooltip(t('loginToContinue'), false, () => { openSlidebar(); });
      } else if (result.error) {
        showTooltip(result.error.substring(0, 50));
      }
    } else {
      pendingText = text;
      createFloatBtn();
    }
  }, true);

  // ── Listen for config changes from popup ──

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return;
    if (msg.action === 'configChanged') {
      const changes = msg.changes;
      if (changes.transparency) {
        config.transparency = changes.transparency.newValue;
        applyTransparency(config.transparency);
      }
      if (changes.autoRespond) {
        config.autoRespond = changes.autoRespond.newValue;
      }
      if (changes.captureMode) {
        const was = config.captureMode;
        config.captureMode = changes.captureMode.newValue;
        if (was !== config.captureMode) updateCaptureMode();
      }
      return;
    }

    // ── Image analysis tooltip ──
    if (msg.action === 'showImageTooltip') {
      showTooltip(msg.text);
      return;
    }

    // ── Get selected text (for context menu / screenshot) ──
    if (msg.action === 'getSelectedText') {
      const text = getSelectedText();
      sendResponse({ text });
      return true;
    }

    // ── Session revoked in another device — modal en popup, no cerrar ──
    if (msg.action === 'sessionRevoked') {
      return;
    }

    // ── Toggle slidebar panel (from action icon click) ──
    if (msg.action === 'toggleSlidebar') {
      if (currentSlidebarMode === 'hover') {
        currentSlidebarMode = 'normal';
        if (slidebarWrapper) { slidebarWrapper.style.display = 'block'; slidebarWrapper.style.opacity = '1'; }
      }
      if (!slidebar) createSlidebar();
      toggleSlidebarPanel();
      return;
    }

  });

  // ── Tutorial helpers ──

  function showTutorial(step, onDone) {
    const overlay = document.createElement('div');
    overlay.id = 'er-tutorial-overlay';
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', width: '100vw', height: '100vh',
      background: 'rgba(0,0,0,0.6)', zIndex: '2147483647',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', fontFamily: 'Segoe UI, Arial, sans-serif'
    });

    const card = document.createElement('div');
    Object.assign(card.style, {
      background: '#fff', borderRadius: '12px', padding: '28px 32px',
      maxWidth: '380px', textAlign: 'center', boxShadow: '0 8px 32px rgba(0,0,0,0.3)'
    });

    const msg = document.createElement('p');
    msg.style.cssText = 'color:#333;font-size:15px;line-height:1.5;margin:0 0 20px';

    if (step === 1) {
      msg.textContent = t('manageExtension');
      const arrow = document.createElement('div');
      arrow.textContent = '→';
      Object.assign(arrow.style, {
        fontSize: '40px', color: '#6c5ce7', marginBottom: '12px',
        animation: 'er-bounce-right 1s infinite'
      });
      card.appendChild(arrow);
    } else {
      msg.textContent = t('hoverPanelHint');
    }

    const btn = document.createElement('button');
    btn.textContent = t('understood');
    Object.assign(btn.style, {
      background: '#6c5ce7', color: '#fff', border: 'none',
      borderRadius: '8px', padding: '10px 28px', fontSize: '14px',
      fontWeight: '600', cursor: 'pointer', transition: 'opacity 0.15s'
    });
    btn.addEventListener('mouseenter', () => btn.style.opacity = '0.85');
    btn.addEventListener('mouseleave', () => btn.style.opacity = '1');
    btn.addEventListener('click', () => { overlay.remove(); if (onDone) onDone(); });

    // Add pulse animation for arrow
    if (!document.getElementById('er-tutorial-style')) {
      const style = document.createElement('style');
      style.id = 'er-tutorial-style';
      style.textContent = '@keyframes er-bounce-right { 0%,100%{transform:translateX(0)} 50%{transform:translateX(8px)} }';
      document.head.appendChild(style);
    }

    card.appendChild(msg);
    card.appendChild(btn);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  // ── Slidebar ──

  let slidebar = null;
  let slidebarWrapper = null;
  let slidebarPanel = null;
  let slidebarIframe = null;
  let slidebarBackdrop = null;
  let currentSlidebarMode = 'normal';
  let hoverTimeout = null;

  function createSlidebar() {
    if (slidebar) return;

    // ── Wrapper: covers tab + X area so hover doesn't break ──
    slidebarWrapper = document.createElement('div');
    slidebarWrapper.id = 'er-slidebar-wrapper';
    Object.assign(slidebarWrapper.style, {
      position: 'fixed',
      right: '0',
      top: '50%',
      transform: 'translateY(-50%)',
      width: '44px',
      height: '75px',
      zIndex: '2147483646',
      overflow: 'visible',
      transition: 'opacity 0.15s ease'
    });

    // ── Tab (navy blue, flush with right edge) ──
    slidebar = document.createElement('div');
    slidebar.id = 'er-slidebar';
    Object.assign(slidebar.style, {
      position: 'absolute',
      right: '0',
      top: '50%',
      transform: 'translateY(-50%)',
      width: '10px',
      height: '60px',
      background: '#1a2a6c',
      borderRadius: '5px 0 0 5px',
      cursor: 'pointer',
      transition: 'width 0.2s ease, opacity 0.2s ease',
      opacity: '0.4',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'visible'
    });

    // Arrow ◀ at center
    const arrowSpan = document.createElement('span');
    arrowSpan.textContent = '◀';
    Object.assign(arrowSpan.style, {
      color: '#fff',
      fontSize: '9px',
      opacity: '0.6',
      transition: 'opacity 0.2s',
      userSelect: 'none',
      pointerEvents: 'none'
    });
    slidebar.appendChild(arrowSpan);

    // X circle — minimal, dark, hover mode activator
    const hideX = document.createElement('div');
    hideX.id = 'er-slidebar-hide';
    hideX.textContent = '✕';
    hideX.title = t('hoverMode');
    Object.assign(hideX.style, {
      position: 'absolute',
      left: '4px',
      top: '3px',
      width: '16px',
      height: '16px',
      borderRadius: '50%',
      background: '#e8eaf6',
      color: '#1a2a6c',
      fontSize: '9px',
      fontWeight: '600',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
      userSelect: 'none',
      zIndex: '3',
      lineHeight: '16px',
      transition: 'background 0.15s'
    });
    hideX.addEventListener('mouseenter', () => { hideX.style.background = '#c5cae9'; });
    hideX.addEventListener('mouseleave', () => { hideX.style.background = '#e8eaf6'; });
    hideX.addEventListener('click', (e) => { e.stopPropagation(); activateHoverMode(); });

    slidebarWrapper.appendChild(slidebar);
    slidebarWrapper.appendChild(hideX);
    document.body.appendChild(slidebarWrapper);

    slidebarWrapper.addEventListener('mouseenter', () => {
      if (currentSlidebarMode === 'hidden') return;
      slidebar.style.width = '22px';
      slidebar.style.opacity = '0.7';
      arrowSpan.style.opacity = '0.9';
      hideX.style.display = 'flex';
    });
    slidebarWrapper.addEventListener('mouseleave', () => {
      if (currentSlidebarMode === 'hidden') return;
      slidebar.style.width = '10px';
      slidebar.style.opacity = '0.4';
      arrowSpan.style.opacity = '0.6';
      hideX.style.display = 'none';
    });
    slidebar.addEventListener('click', (e) => {
      toggleSlidebarPanel();
    });

    // Always start visible (normal mode). Hover mode is session-only.
    slidebarWrapper.style.display = 'block';

    // ── Panel container (slides from the right) ──
    slidebarPanel = document.createElement('div');
    slidebarPanel.id = 'er-slidebar-panel';
    Object.assign(slidebarPanel.style, {
      position: 'fixed',
      right: '-370px',
      top: '0',
      width: '360px',
      height: '100vh',
      background: '#0a0a12',
      zIndex: '2147483647',
      boxShadow: '-6px 0 32px rgba(0,0,0,0.5)',
      transition: 'right 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'Segoe UI, Arial, sans-serif'
    });

    // Panel header
    const panelHeader = document.createElement('div');
    Object.assign(panelHeader.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '10px 14px',
      borderBottom: '1px solid rgba(255,255,255,0.08)',
      flexShrink: '0'
    });
    const titleSpan = document.createElement('span');
    titleSpan.textContent = t('slidebarTitle');
    Object.assign(titleSpan.style, { color: '#fff', fontWeight: '600', fontSize: '14px' });

    const headerBtns = document.createElement('div');
    Object.assign(headerBtns.style, { display: 'flex', gap: '6px', alignItems: 'center' });

    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '&times;';
    closeBtn.title = t('closePanel');
    Object.assign(closeBtn.style, { background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: '20px', padding: '2px 6px', lineHeight: '1' });
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeSlidebarPanel(); });

    headerBtns.appendChild(closeBtn);
    panelHeader.appendChild(titleSpan);
    panelHeader.appendChild(headerBtns);
    slidebarPanel.appendChild(panelHeader);

    // Iframe for popup content
    slidebarIframe = document.createElement('iframe');
    slidebarIframe.src = chrome.runtime.getURL('popup.html');
    Object.assign(slidebarIframe.style, {
      flex: '1',
      border: 'none',
      width: '100%',
      background: '#0a0a12'
    });
    slidebarIframe.setAttribute('allow', 'clipboard-read; clipboard-write');
    slidebarPanel.appendChild(slidebarIframe);
    document.body.appendChild(slidebarPanel);
  }

  function openSlidebar() {
    if (!slidebarPanel) createSlidebar();
    slidebarPanel.style.right = '0';
    if (slidebar) { slidebar.style.opacity = '0'; slidebar.style.pointerEvents = 'none'; }
    if (slidebarWrapper) { slidebarWrapper.style.display = 'block'; slidebarWrapper.style.opacity = '1'; }
    // Backdrop: click outside → close
    if (!slidebarBackdrop) {
      slidebarBackdrop = document.createElement('div');
      slidebarBackdrop.id = 'er-slidebar-backdrop';
      Object.assign(slidebarBackdrop.style, {
        position: 'fixed', inset: '0', zIndex: '2147483646',
        background: 'transparent', display: 'none'
      });
      slidebarBackdrop.addEventListener('click', closeSlidebarPanel);
      document.body.appendChild(slidebarBackdrop);
    }
    slidebarBackdrop.style.display = 'block';
  }

  function closeSlidebarPanel() {
    if (slidebarPanel) slidebarPanel.style.right = '-370px';
    if (slidebar) { slidebar.style.opacity = '0.6'; slidebar.style.pointerEvents = 'auto'; }
    if (currentSlidebarMode === 'hover') {
      if (slidebarWrapper) slidebarWrapper.style.display = 'none';
    }
    if (slidebarBackdrop) slidebarBackdrop.style.display = 'none';
  }

  function toggleSlidebarPanel() {
    if (slidebarPanel && slidebarPanel.style.right === '0px') {
      closeSlidebarPanel();
    } else {
      openSlidebar();
    }
  }

  function activateHoverMode() {
    closeSlidebarPanel();
    currentSlidebarMode = 'hover';
    if (slidebarWrapper) slidebarWrapper.style.display = 'none';
  }

  // ── Hover-reveal: show tab when cursor nears right edge ──

  document.addEventListener('mousemove', (e) => {
    if (currentSlidebarMode !== 'hover') return;
    if (!slidebarWrapper) return;
    if (slidebarPanel && slidebarPanel.style.right === '0px') return;
    const nearEdge = e.clientX >= window.innerWidth - 35;
    if (nearEdge) {
      clearTimeout(hoverTimeout);
      slidebarWrapper.style.display = 'block';
      slidebarWrapper.style.opacity = '1';
      if (slidebar) {
        slidebar.style.opacity = '0.8';
        const arrow = slidebar.querySelector('span');
        if (arrow) arrow.style.opacity = '0.8';
      }
    } else {
      clearTimeout(hoverTimeout);
      hoverTimeout = setTimeout(() => {
        slidebarWrapper.style.opacity = '0';
        if (slidebar) {
          slidebar.style.opacity = '0.35';
          const arrow = slidebar.querySelector('span');
          if (arrow) arrow.style.opacity = '0.5';
        }
        setTimeout(() => { if (slidebarWrapper) slidebarWrapper.style.display = 'none'; }, 150);
      }, 400);
    }
  });

  // ── Moodle secure-window compatibility ──
  //
  // Moodle's "quiz-secure-window" mode registers delegated listeners on
  // document/body and calls e.halt() (preventDefault + stopPropagation) for
  // contextmenu, selectstart, copy/cut/paste, dragstart, mouse buttons and
  // Ctrl/Cmd+C/V/X. Those handlers run in the bubbling phase, so a capture
  // listener on window sees the event first and can stop it from reaching
  // them. We never call preventDefault(), so the browser's native behaviour
  // (selection, clipboard, context menu) stays enabled.
  //
  // This only defeats client-side blocking; it does not hide anything from
  // server-side logging or extension detection.

  function installSecureModeCompatibility() {
    const body = document.body;
    if (!body || !body.classList.contains('quiz-secure-window')) return;

    const questionSelector =
      '#responseform, .que, .qtext, .answer, .formulation, .ablock, .answeroption, .prompt';

    const stop = (e) => {
      // Never preventDefault(): the browser's native action must continue.
      e.stopPropagation();
    };

    // Events Moodle blocks globally (right-click, clipboard, keyboard).
    ['contextmenu', 'selectstart', 'dragstart', 'copy', 'cut', 'paste',
      'keydown', 'keyup', 'keypress'].forEach((type) => {
      window.addEventListener(type, stop, true);
    });

    // Mouse buttons are only blocked over the question content, so the rest
    // of the quiz UI (navigation, buttons, menus) keeps working normally.
    ['mousedown', 'mouseup'].forEach((type) => {
      window.addEventListener(type, (e) => {
        const target = e.target;
        if (target && target.closest && target.closest(questionSelector)) {
          e.stopPropagation();
        }
      }, true);
    });

    // Some themes also disable text selection through CSS.
    if (!document.getElementById('er-securemode-selectable')) {
      const style = document.createElement('style');
      style.id = 'er-securemode-selectable';
      style.textContent = `
        .quiz-secure-window .que,
        .quiz-secure-window .que *,
        .quiz-secure-window .qtext,
        .quiz-secure-window .qtext *,
        .quiz-secure-window .answer,
        .quiz-secure-window .answer *,
        .quiz-secure-window .formulation,
        .quiz-secure-window .formulation * {
          -webkit-user-select: text !important;
          -moz-user-select: text !important;
          user-select: text !important;
        }
      `;
      (document.head || document.documentElement).appendChild(style);
    }
  }

  // ── Init ──

  installSecureModeCompatibility();
  readConfig();
  chrome.storage.sync.get(['slidebarHidden', 'slidebarTutorialDone', 'slidebarMode'], (data) => {
    // Always start in normal mode. Hover mode is session-only.
    currentSlidebarMode = 'normal';

    // Migrate old slidebarHidden from previous extension version
    if (data.slidebarHidden) {
      chrome.storage.sync.set({ slidebarMode: 'hover', slidebarHidden: undefined });
    }

    const isFirstRun = !data.slidebarTutorialDone && data.slidebarMode === undefined && !data.slidebarHidden;
    if (isFirstRun) {
      showTutorial(1, () => {
        chrome.storage.sync.set({ slidebarTutorialDone: true });
        createSlidebar();
      });
    } else {
      createSlidebar();
    }
  });

  // Safety fallback: if still no slidebar after 2s, force-create
  setTimeout(() => {
    if (!slidebarWrapper || slidebarWrapper.style.display === 'none' && currentSlidebarMode === 'normal') {
      if (!slidebar) createSlidebar();
      if (slidebarWrapper && currentSlidebarMode === 'normal') slidebarWrapper.style.display = 'block';
    }
  }, 2000);
})();
