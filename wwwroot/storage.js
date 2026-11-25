class BookStore {
  constructor() {
    this.values = new Map();
    this.pendingWrites = new Set();
    this.latestWrites = new Map();
    this.unsaved = new Map();
    this.prefix = 'csharp-book/v1/';
    this.db = null;
    this.channel = null;
    this.warning = '';
    this.persistenceWarning = 'Не удалось сохранить изменения на устройстве. Проверь свободное место.';
  }

  async open() {
    try {
      this.db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('csharp-textbook', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('items');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(Error('Хранилище занято'));
      });
      await new Promise((resolve, reject) => {
        const cursor = this.db.transaction('items').objectStore('items').openCursor();
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (!row) return resolve();
          this.values.set(row.key, row.value);
          row.continue();
        };
        cursor.onerror = () => reject(cursor.error);
      });
    } catch { this.db = null; }
    try {
      for (let i=0; i<localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(this.prefix)) {
          try { this.values.set(key.slice(this.prefix.length), JSON.parse(localStorage.getItem(key))); }
          catch { /* Skip a damaged mirror; the IndexedDB value is still available. */ }
        }
      }
    } catch { if (!this.db) this.warning = 'Браузер разрешает сохранять прогресс только до закрытия вкладки.'; }

    window.addEventListener('storage',event => {
      if (event.key?.startsWith(this.prefix)) this.readExternal(event.key.slice(this.prefix.length));
    });
    try {
      this.channel = new BroadcastChannel('csharp-book/storage');
      this.channel.onmessage = ({data}) => { if (typeof data === 'string') this.readExternal(data); };
    } catch { /* localStorage events are enough when the mirror has room. */ }
  }

  readExternal(key) {
    const notify = value => {
      if (value === undefined || this.values.get(key) === value || this.unsaved.has(key)) return;
      this.values.set(key,value);
      window.dispatchEvent(new CustomEvent('book-storage', {detail:key}));
    };
    const readMirror = () => {
      try {
        const raw = localStorage.getItem(this.prefix + key);
        if (raw !== null) { notify(JSON.parse(raw)); return true; }
      } catch {}
      return false;
    };
    if (readMirror() || !this.db) return;
    // The sender wrote IndexedDB when localStorage was full. Read the current
    // value instead of applying an older message after a more recent edit.
    const before = this.values.get(key);
    try {
      const read = this.db.transaction('items').objectStore('items').get(key);
      read.onsuccess = () => {
        if (this.values.get(key) === before && !readMirror()) notify(read.result);
      };
    } catch {}
  }

  get(key, fallback) { return this.values.has(key) ? this.values.get(key) : fallback; }

  set(key, value) {
    const changed = this.values.get(key) !== value;
    this.values.set(key,value);
    this.save(key,value);
    if (changed) window.dispatchEvent(new CustomEvent('book-local-write', {detail:key}));
  }

  save(key, value) {
    // These raw values are read by 0.2.x on the same Windows WebView profile.
    const mirrorKey = this.prefix + key;
    let mirrored = false, staleMirror;
    try { localStorage.setItem(mirrorKey, JSON.stringify(value)); mirrored = true; }
    catch { try { staleMirror = localStorage.getItem(mirrorKey); } catch {} }
    const write = {};
    this.latestWrites.set(key,write);
    this.unsaved.delete(key);
    const complete = committed => {
      if (this.latestWrites.get(key) !== write) return;
      this.latestWrites.delete(key);
      if (!mirrored && !committed) {
        this.unsaved.set(key,value);
        this.warning = this.persistenceWarning;
      } else if (!mirrored) {
        // Keep the previous durable copy until IDB commits, and never remove a
        // newer value that another window wrote while this transaction ran.
        try {
          if (staleMirror != null && localStorage.getItem(mirrorKey) === staleMirror)
            localStorage.removeItem(mirrorKey);
        } catch {}
        try { this.channel?.postMessage(key); } catch {}
      }
    };
    if (!this.db) { complete(false); return; }
    let tx;
    try {
      tx = this.db.transaction('items','readwrite');
      tx.objectStore('items').put(value,key);
    } catch { complete(false); return; }
    const pending = new Promise(resolve => {
      tx.oncomplete = () => { complete(true); resolve(); };
      tx.onabort = () => { complete(false); resolve(); };
    });
    this.pendingWrites.add(pending);
    pending.then(() => this.pendingWrites.delete(pending));
  }

  async flush() {
    await Promise.all([...this.pendingWrites]);
    for (const [key, value] of [...this.unsaved]) this.save(key,value);
    await Promise.all([...this.pendingWrites]);
    if (this.unsaved.size) throw Error(this.warning);
    if (this.warning === this.persistenceWarning) this.warning = '';
  }
}
