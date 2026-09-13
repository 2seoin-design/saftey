if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/saftey/frontend/sw.js').catch(() => {});
  });
}
