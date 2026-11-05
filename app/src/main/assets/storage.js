export class Storage {
  constructor() { this.queue = Promise.resolve(); }
  async open() {
    this.db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('2048-choice', 2);
      r.onupgradeneeded = e => {
        const db = r.result, tx = r.transaction;
        if (e.oldVersion === 0) { db.createObjectStore('data'); db.createObjectStore('history'); }
        const games = db.createObjectStore('games');
        const histories = db.createObjectStore('game-history');
        // Copy the previous single save and its full undo history atomically.
        const meta = tx.objectStore('data').get('game');
        const hist = tx.objectStore('history').getAll();
        hist.onsuccess = () => {
          if (!meta.result) return;
          const size = meta.result.size;
          games.put(meta.result, size);
          hist.result.forEach((entry, i) => histories.put(entry, [size, i]));
          tx.objectStore('data').put(size, 'active-size');
        };
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return this;
  }
  async read(key) {
    return new Promise((resolve, reject) => {
      const r = this.db.transaction('data').objectStore('data').get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async loadGame(size) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['data', 'games', 'game-history']);
      let meta, hist;
      const read = n => {
        if (!n) return;
        meta = tx.objectStore('games').get(n);
        hist = tx.objectStore('game-history').getAll(IDBKeyRange.bound([n, 0], [n, Number.MAX_SAFE_INTEGER]));
      };
      if (size !== undefined) read(size);
      else { const active = tx.objectStore('data').get('active-size'); active.onsuccess = () => read(active.result); }
      tx.oncomplete = () => resolve(meta?.result ? { ...meta.result, history: hist.result } : null);
      tx.onerror = () => reject(tx.error);
    });
  }
  write(key, value) {
    return this.enqueue(() => {
      const tx = this.db.transaction('data', 'readwrite');
      tx.objectStore('data').put(value, key);
      return this.done(tx);
    });
  }
  saveGame(game, reset = false) {
    const meta = { version: 1, ...game.snapshot(), size: game.size, mode: game.mode, nextTile: game.nextTile, undoLocked: game.undoLocked, assisted: game.assisted, reached4096: game.reached4096, fourWarningShown: game.fourWarningShown };
    const length = game.history.length;
    const last = length ? structuredClone(game.history[length - 1]) : null;
    return this.enqueue(() => {
      const tx = this.db.transaction(['data', 'games', 'game-history'], 'readwrite');
      tx.objectStore('data').put(meta.size, 'active-size');
      tx.objectStore('games').put(meta, meta.size);
      const history = tx.objectStore('game-history');
      const from = reset || meta.mode === 'standard' ? 0 : length;
      history.delete(IDBKeyRange.bound([meta.size, from], [meta.size, Number.MAX_SAFE_INTEGER]));
      if (last) history.put(last, [meta.size, length - 1]);
      return this.done(tx);
    });
  }
  enqueue(fn) { const task = this.queue.catch(() => {}).then(fn); this.queue = task; return task; }
  done(tx) { return new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('Save interrupted')); }); }
}
