import {SyncEngine, isSyncKey} from './sync-engine.js';
import {available, getStatus, connect, disconnect, getProvider, openExchangeFile, saveExchangeFile} from './sync-bridge.js';

const providers = {google: 'Google Диск', yandex: 'Яндекс Диск'};

function showValue(value) {
  if (value === null) return 'Удалено';
  if (typeof value === 'string') return value;
  if (typeof value?.source === 'string') {
    return Object.entries({'Program.cs': value.source, ...value.files})
      .map(([name, source]) => name + '\n' + source).join('\n\n');
  }
  if (typeof value?.body === 'string') return [value.quote, value.body].filter(Boolean).join('\n\n');
  return JSON.stringify(value, null, 2);
}

export async function startCloudSync({store, label, refresh, describeKey}) {
  const native = available();
  let engine;
  let settings = null;
  let provider = null;
  let awaitingPeer = false;
  let choosingService = false;
  let configured = {};
  let busy = false;
  let message = '';
  let timer;
  let statusReady = false;
  let conflicts = [];
  let connectionControls = '';
  let conflictsVersion = '';

  function controls() {
    if (!settings?.isConnected) return;
    const actions = settings.querySelector('.sync-actions');
    const signature = JSON.stringify([provider, configured, statusReady, awaitingPeer, choosingService]);
    if (signature !== connectionControls) {
      connectionControls = signature;
      actions.replaceChildren();
      const add = (text, command) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'cs-tool';
        button.textContent = text;
        button.dataset.sync = command;
        actions.append(button);
      };
      let intro;
      if (!native) {
        intro = 'Прогресс хранится в этом браузере. Его можно сохранить в файл и восстановить из копии.';
        add('Скачать копию', 'export');
        add('Восстановить из файла', 'import');
      } else if (!statusReady) {
        intro = '';
        add('Проверить подключение', 'status');
      } else if (provider && !choosingService) {
        if (provider === 'folder') intro = 'Подключена папка обмена. Облачное приложение отвечает за передачу файлов между устройствами.';
        else if (provider === 'documents' && awaitingPeer) {
          intro = 'Прогресс сохраняется в файл телефона. Если на ПК уже есть файл Sharpwise, подключи его для обмена в обе стороны.';
          add('Подключить файл ПК', 'add-peer');
        } else if (provider === 'documents') intro = 'Подключены файлы ПК и телефона. Учебник обменивается изменениями через эти файлы автоматически.';
        else intro = 'Подключён ' + providers[provider] + '.';
        add('Синхронизировать сейчас', 'sync');
        if (providers[provider]) add('Восстановить прогресс', 'restore');
        add('Сменить диск', 'choose-service');
        const target = {folder:'папку', documents:'файлы'}[provider] || providers[provider];
        add('Отключить ' + target, 'disconnect');
      } else {
        const disks = Object.entries(providers).filter(([id]) => configured[id]);
        if (disks.length) {
          intro = 'Подключи тот же диск и аккаунт, что на другом устройстве. Sharpwise автоматически восстановит сохранённый там прогресс и объединит его с местными изменениями.';
          for (const [id, name] of disks) add('Подключить ' + name, id);
        } else {
          intro = 'Для обмена между устройствами выбери общую папку диска.';
          if (configured.folder) add('Выбрать папку', 'folder');
          if (configured.documents) {
            add('Начать с файла телефона', 'phone-first');
            add('Подключить файл ПК', 'documents');
          }
        }
        if (choosingService) add('Отмена', 'cancel-service');
      }
      settings.querySelector('.sync-description').textContent = intro;
    }
    for (const button of settings.querySelectorAll('[data-sync]')) button.disabled = busy;
    const status = settings.querySelector('.sync-status');
    if (status.textContent !== message) status.textContent = message;
    const conflictBox = settings.querySelector('.sync-conflicts');
    const version = JSON.stringify(conflicts.map(group => [group.key, ...group.variants.map(item => item.id)]));
    if (version === conflictsVersion) {
      for (const button of conflictBox.querySelectorAll('button')) button.disabled = busy;
      return;
    }
    conflictsVersion = version;
    conflictBox.replaceChildren();
    if (!conflicts.length) return;
    const heading = document.createElement('h3');
    heading.textContent = 'Изменения на двух устройствах';
    const explanation = document.createElement('p');
    explanation.textContent = 'Сравни сохранённые варианты и выбери, какой использовать на обоих устройствах.';
    conflictBox.append(heading, explanation);
    for (const group of conflicts) {
      const details = document.createElement('details');
      const title = document.createElement('summary');
      title.textContent = describeKey(group.key);
      details.append(title);
      for (const variant of group.variants) {
        const device = document.createElement('strong');
        device.textContent = variant.label || 'Устройство';
        if (variant.updated) device.textContent += ' · ' + new Date(variant.updated).toLocaleString('ru');
        const preview = document.createElement('pre');
        preview.textContent = showValue(variant.value);
        const use = document.createElement('button');
        use.type = 'button';
        use.disabled = busy;
        use.className = 'cs-tool';
        use.textContent = 'Выбрать этот вариант';
        use.onclick = () => {
          if (busy) return;
          try {
            const keys = engine.resolve(group.key, variant.id);
            refresh(keys);
            conflicts = engine.conflicts();
            message = 'Выбранный вариант сохранён на устройстве.';
            controls();
            schedule(0);
          } catch (error) { fail(error); }
        };
        details.append(device, preview, use);
      }
      conflictBox.append(details);
    }
  }

  function mount(section) {
    if (!section || settings === section) return;
    settings = section;
    settings.hidden = false;
    connectionControls = conflictsVersion = '';
    settings.innerHTML = '<h2>Синхронизация</h2><p class="sync-description"></p><div class="sync-actions"></div>' +
      '<p class="sync-status" role="status"></p><div class="sync-conflicts"></div>';
    settings.onclick = event => {
      const button = event.target.closest('[data-sync]');
      if (button && !busy && !button.disabled) handle(button.dataset.sync);
    };
    controls();
  }

  function fail(error) {
    message = store.unsaved?.size ? store.warning : 'Прогресс сохранён на устройстве. ' + (error?.message || 'Синхронизация недоступна.');
    controls();
  }

  function schedule(delay) {
    clearTimeout(timer);
    if (provider) timer = setTimeout(synchronize, delay);
  }

  async function synchronize(restoreOnly = false) {
    clearTimeout(timer);
    if (busy || !provider) return;
    if (provider !== 'folder' && provider !== 'documents' && !navigator.onLine) {
      message = 'Нет подключения. Прогресс сохранён на устройстве.';
      controls();
      return;
    }
    busy = true;
    message = restoreOnly ? 'Ищем сохранённый прогресс на диске…' : 'Синхронизируем…';
    controls();
    try {
      engine ||= new SyncEngine(store, label);
      const {changedKeys, uploaded, hasRemoteRecords} = await engine.sync(getProvider(provider), {restoreOnly});
      refresh(changedKeys);
      conflicts = engine.conflicts();
      const time = new Date().toLocaleTimeString('ru', {hour:'2-digit', minute:'2-digit'});
      if (restoreOnly) {
        if (!hasRemoteRecords) message = 'На этом диске пока нет сохранённого прогресса.';
        else message = changedKeys.length ? 'Прогресс с диска восстановлен.' : 'На устройстве уже есть весь прогресс с этого диска.';
      } else if (provider === 'folder' || provider === 'documents') {
        const completed = provider === 'folder' ? 'Обмен с папкой завершён в ' :
          awaitingPeer ? 'Файл телефона сохранён в ' : 'Обмен со связанными файлами завершён в ';
        message = completed + time + '.';
      } else if (changedKeys.length) message = 'Прогресс с диска загружен в ' + time + '.';
      else if (!hasRemoteRecords && !uploaded) message = 'На этом диске пока нет сохранённого прогресса.';
      else message = 'Синхронизировано в ' + time + '.';
      if (engine.hasLocalChanges()) {
        if (!restoreOnly) message = 'Новые изменения сохранены на устройстве.';
        schedule(1800);
      }
    } catch (error) {
      if (error.changedKeys?.length) {
        refresh(error.changedKeys);
        conflicts = engine.conflicts();
      }
      fail(error);
    } finally { busy = false; controls(); }
  }

  async function handle(command) {
    if (command === 'sync' || command === 'restore') return synchronize(command === 'restore');
    if (command === 'choose-service' || command === 'cancel-service') {
      choosingService = command === 'choose-service';
      message = '';
      controls();
      return;
    }
    busy = true;
    clearTimeout(timer);
    message = ({
      disconnect:'Отключаем диск…', status:'Проверяем подключение…', folder:'Выбери папку обмена…',
      documents:'Открой файл ПК, затем сохрани файл телефона в той же папке.',
      'phone-first':'Выбери в Google Диске место для файла телефона.',
      'add-peer':'Выбери файл ПК в папке, где находится файл телефона.',
      export:'Готовим файл прогресса…', import:'Выбери файл прогресса…'
    })[command] || 'Ожидаем разрешения на доступ к диску…';
    controls();
    try {
      if (command === 'export' || command === 'import') {
        engine ||= new SyncEngine(store, label);
        if (command === 'export') {
          const saved = await saveExchangeFile(await engine.exportSnapshot());
          message = saved === false ? 'Сохранение отменено.' : 'Файл прогресса подготовлен для передачи.';
        } else {
          const snapshot = await openExchangeFile();
          if (snapshot === null) { message = 'Открытие файла отменено.'; return; }
          const {changedKeys} = await engine.importSnapshot(snapshot);
          refresh(changedKeys);
          conflicts = engine.conflicts();
          message = 'Прогресс из файла объединён с прогрессом на устройстве.';
          schedule(1800);
        }
        return;
      }
      if (command === 'disconnect') { await disconnect(); provider = null; }
      else if (command === 'documents' || command === 'phone-first' || command === 'add-peer') {
        engine ||= new SyncEngine(store, label);
        await store.flush();
        await connect('documents', engine.deviceId, command === 'documents' ? 'pair' : command);
      } else if (command !== 'status') await connect(command);
      statusReady = false;
      const status = await getStatus();
      provider = status.provider;
      awaitingPeer = status.awaitingPeer === true;
      configured = status.configured;
      statusReady = true;
      choosingService = false;
      message = '';
      schedule(0);
    } catch (error) {
      if (error.changedKeys?.length) refresh(error.changedKeys);
      fail(error);
    } finally {
      busy = false;
      if ((command === 'export' || command === 'import') && engine?.hasLocalChanges()) schedule(1800);
      controls();
    }
  }

  function saved(event) {
    if (!provider || !isSyncKey(event.detail)) return;
    if (!busy) {
      message = 'Изменения сохранены на устройстве.';
      controls();
      schedule(1800);
    }
  }

  window.addEventListener('book-local-write', saved);
  window.addEventListener('book-storage', saved);
  window.addEventListener('online', () => schedule(0));
  window.addEventListener('offline', () => { if (provider && !busy) synchronize(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') schedule(0);
  });
  setInterval(() => { if (document.visibilityState === 'visible' && provider) synchronize(); }, 90000);
  if (native) handle('status');
  return {mount};
}
