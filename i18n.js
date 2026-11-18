function t(key, subs = []) {
  try {
    const msg = chrome.i18n.getMessage(key, subs);
    return msg || key;
  } catch {
    return key;
  }
}

function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    const translated = t(key);
    if (!translated) return;
    if (el.placeholder !== undefined) { el.placeholder = translated; return; }
    if (el.title !== undefined) { el.title = translated; return; }
    if (el.tagName === 'INPUT' && el.type !== 'checkbox') { el.placeholder = translated; return; }
    const hasChildElements = Array.from(el.childNodes).some(n => n.nodeType === 1);
    if (!hasChildElements) el.textContent = translated;
  });
}
