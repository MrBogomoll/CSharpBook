(() => {
  const android = navigator.userAgent.includes('CSharpBookAndroid/');
  const windows = window.chrome?.webview;
  const workers = navigator.serviceWorker;
  let previousController = workers?.controller;
  let newerCache = false;
  workers?.addEventListener('controllerchange', () => {
    if (previousController && previousController !== workers.controller) newerCache = true;
    previousController = workers.controller;
  });
  let state = { message: '', busy: false };
  let renderedButton;
  function render() {
    const button = document.getElementById('book-update-button');
    const status = document.getElementById('book-update-status');
    if (!button || !status) return;
    renderedButton = button;
    if (status.textContent !== state.message) status.textContent = state.message;
    button.disabled = state.busy;
    const beta = document.getElementById('book-update-beta');
    if (beta) beta.disabled = state.busy;
  }
  function set(message, busy = false) {
    state = { message, busy };
    render();
  }
  function nativeUpdate(value) {
    if (value && typeof value.message === 'string') set(value.message, value.busy === true);
  }
  windows?.addEventListener('message', e => {
    if (e.data?.type === 'update') nativeUpdate(e.data);
  });
  window.addEventListener('book-native-update', e => nativeUpdate(e.detail));
  document.addEventListener('change', e => {
    if (e.target.id === 'book-update-beta') store.set('update-beta', e.target.checked);
  });

  async function updateWeb() {
    if (newerCache) { location.reload(); return; }
    if (!workers) { set('Эту версию учебника обновляет владелец сервера. После обновления открой страницу заново.'); return; }
    const registration = await workers.getRegistration();
    if (!registration) { set('Автономная копия ещё не готова. Проверь подключение к серверу учебника.'); return; }
    let pending = registration.installing || registration.waiting;
    const found = () => { pending = registration.installing || pending; };
    registration.addEventListener('updatefound', found);
    try {
      await registration.update();
      const worker = pending || registration.installing || registration.waiting;
      if (!worker) { set('На этом сервере установлена последняя доступная тебе версия.'); return; }
      set('Сохраняем новую версию для чтения без интернета…', true);
      await new Promise((resolve, reject) => {
        const done = () => {
          if (worker.state === 'activated') finish();
          else if (worker.state === 'redundant') finish(new Error());
        };
        const finish = error => {
          clearTimeout(timer);
          worker.removeEventListener('statechange', done);
          if (error) reject(error); else resolve();
        };
        const timer = setTimeout(() => finish(new Error()), 120000);
        worker.addEventListener('statechange', done);
        done();
      });
      location.reload();
    } finally { registration.removeEventListener('updatefound', found); }
  }
  document.addEventListener('click', async e => {
    if (!e.target.closest?.('#book-update-button') || state.busy) return;
    set('Проверяем обновления…', true);
    try {
      if (windows) windows.postMessage('update-start');
      else if (android) location.href = 'csharpbook://update/start'+
        (document.getElementById('book-update-beta')?.checked ? '?channel=beta' : '');
      else await updateWeb();
    } catch { set('Не удалось проверить обновление. Проверь подключение и попробуй ещё раз.'); }
  });
  new MutationObserver(() => {
    const current = document.getElementById('book-update-button');
    if (current !== renderedButton) { renderedButton = current; render(); }
  }).observe(document.getElementById('app'), { childList: true, subtree: true });
  render();
})();
