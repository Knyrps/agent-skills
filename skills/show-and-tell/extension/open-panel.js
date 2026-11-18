// Helper tab used by scripts/browser.mjs: sidePanel.open() needs a real user gesture, so the
// script sends a trusted click (CDP Input) to this page, which opens the panel and closes itself.
let windowId = null;
chrome.windows.getCurrent().then(w => { windowId = w.id; document.title = 'show-and-tell:ready'; });
document.getElementById('open').addEventListener('click', () => {
  if (windowId == null) return;
  chrome.sidePanel.open({ windowId })
    .then(() => { document.title = 'show-and-tell:opened'; setTimeout(() => window.close(), 300); })
    .catch(e => { document.title = 'show-and-tell:error ' + e.message; });
});
