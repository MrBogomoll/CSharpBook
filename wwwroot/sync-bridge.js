// The hosts authorize the user and talk to Drive. Only textbook records cross this channel.
const desktop = window.top === window ? window.chrome?.webview : null;
const android = window.top === window && navigator.userAgent.includes('CSharpBookAndroid/');
const pending = new Map();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
let androidPort;
let notifyPort;
const firstPort = new Promise(resolve => { notifyPort = resolve; });

function receive(event) {
  let data = event.data;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { return; }
  }
  if (data?.type !== 'book-sync') return;
  const request = pending.get(data.id);
  if (!request) return;
  pending.delete(data.id);
  clearTimeout(request.timer);
  if (data.ok === true) request.resolve(data.result);
  else request.reject(new Error(typeof data.error === 'string' ? data.error : 'Не удалось выполнить синхронизацию.'));
}

desktop?.addEventListener('message', receive);
if (android) {
  window.addEventListener('message', event => {
    // Android WebView supplies a native sender and a transferred port, never a child frame.
    if (event.source != null || event.data !== 'book-sync-port' || event.ports.length !== 1) return;
    androidPort?.close();
    [androidPort] = event.ports;
    androidPort.onmessage = receive;
    notifyPort();
  });
}

export function available() { return Boolean(desktop || android); }

async function request(op, args = {}) {
  if (!available()) throw new Error('Синхронизация доступна в приложениях для Windows и Android.');
  if (android && !androidPort) {
    let timer;
    try {
      await Promise.race([firstPort, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Канал синхронизации недоступен. Открой учебник заново.')), 10000);
      })]);
    } finally { clearTimeout(timer); }
  }
  const id = crypto.randomUUID();
  const payload = JSON.stringify({type:'book-sync', id, op, ...args});
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Время ожидания истекло. Попробуй ещё раз.'));
    }, ['connect', 'export', 'import'].includes(op) ? 330000 : 90000);
    pending.set(id, {timer, resolve, reject});
    try { (desktop || androidPort).postMessage(payload); }
    catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
  });
}

function validateProvider(provider) {
  if (provider !== 'google' && provider !== 'yandex' && provider !== 'folder' && provider !== 'documents') throw new Error('Неизвестный облачный диск.');
}

export function getStatus() { return request('status'); }
export function connect(provider, deviceId) {
  validateProvider(provider);
  if (provider === 'documents' && !uuid.test(deviceId)) throw new Error('Не удалось определить устройство.');
  return request('connect', provider === 'documents' ? {provider, deviceId} : {provider});
}
export function disconnect() { return request('disconnect'); }

export function getProvider(provider) {
  validateProvider(provider);
  return {
    ensureOwnReplica: provider === 'folder' || provider === 'documents',
    async readReplicas() {
      const result = await request('list', {provider});
      if (!Array.isArray(result) || result.some(id => typeof id !== 'string' || !uuid.test(id))) {
        throw new Error('Диск вернул некорректный список устройств.');
      }
      const snapshots = [];
      for (const deviceId of new Set(result)) {
        const data = await request('read', {provider, deviceId});
        // Google Drive can retain two files with the same name after a retried create.
        const copies = Array.isArray(data) ? data : [data];
        if (!copies.length || copies.some(snapshot => snapshot?.deviceId !== deviceId)) {
          throw new Error('Данные устройства на диске не совпадают с именем файла.');
        }
        snapshots.push(...copies);
      }
      return snapshots;
    },
    async writeReplica(deviceId, snapshot) {
      if (!uuid.test(deviceId) || snapshot?.deviceId !== deviceId) throw new Error('Не удалось определить устройство.');
      await request('write', {provider, deviceId, snapshot});
    }
  };
}

const maxExchangeBytes = 8 * 1024 * 1024;

export async function saveExchangeFile(snapshot) {
  if (available()) return (await request('export', {snapshot})) !== false;
  const file = new Blob([JSON.stringify(snapshot)], {type:'application/json'});
  if (file.size > maxExchangeBytes) throw new Error('Файл прогресса превышает 8 МБ.');
  const url = URL.createObjectURL(file);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = 'CSharpBook-progress.json';
    document.body.append(link);
    link.click();
    link.remove();
  } finally { setTimeout(() => URL.revokeObjectURL(url), 30000); }
  return true;
}

export async function openExchangeFile() {
  if (available()) return request('import');
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.hidden = true;
  document.body.append(input);
  try {
    const file = await new Promise(resolve => {
      input.onchange = () => resolve(input.files[0] || null);
      input.oncancel = () => resolve(null);
      input.click();
    });
    if (!file) return null;
    if (file.size > maxExchangeBytes) throw new Error('Файл прогресса превышает 8 МБ.');
    try { return JSON.parse(await file.text()); }
    catch { throw new Error('Не удалось прочитать файл прогресса. Выбери JSON, сохранённый учебником.'); }
  } finally { input.remove(); }
}
