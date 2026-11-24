class BookStore {
  constructor() {
    this.values = new Map();
    this.prefix = 'csharp-book/v1/';
    this.db = null;
    this.warning = '';
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
        if (key.startsWith(this.prefix)) this.values.set(key.slice(this.prefix.length),JSON.parse(localStorage.getItem(key)));
      }
    } catch { if (!this.db) this.warning = 'Браузер разрешает сохранять прогресс только до закрытия вкладки.'; }
    window.addEventListener('storage',event => {
      if (event.key?.startsWith(this.prefix) && event.newValue !== null) {
        try { const key=event.key.slice(this.prefix.length); this.values.set(key,JSON.parse(event.newValue)); window.dispatchEvent(new CustomEvent('book-storage',{detail:key})); } catch {}
      }
    });
  }
  get(key, fallback) { return this.values.has(key) ? this.values.get(key) : fallback; }
  set(key, value) {
    this.values.set(key,value);
    let mirrored = false;
    try { localStorage.setItem(this.prefix+key,JSON.stringify(value)); mirrored=true; } catch {}
    if (this.db) {
      try {
        const tx = this.db.transaction('items','readwrite');
        tx.objectStore('items').put(value,key);
        tx.onerror = () => { if (!mirrored) this.warning = 'Браузер не смог сохранить изменение на устройстве.'; };
      } catch { if (!mirrored) this.warning = 'Браузер не смог сохранить изменение на устройстве.'; }
    } else if (!mirrored) this.warning = 'Браузер не смог сохранить изменение на устройстве.';
  }
}
