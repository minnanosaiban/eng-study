// 保存先: IndexedDB。英文の表(sentences)と、小さな設定(meta)を持つ。
// localStorage(約5MB)では、行数が増えると足りなくなるため。
const Store = (() => {
  const DB = "eng-study", VER = 3;
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, VER);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains("sentences")) d.createObjectStore("sentences", { keyPath: "id" });
        if (!d.objectStoreNames.contains("words")) d.createObjectStore("words", { keyPath: "id" });
        if (!d.objectStoreNames.contains("chunks")) d.createObjectStore("chunks", { keyPath: "id" });
        if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta", { keyPath: "key" });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }

  async function tx(store, mode, fn) {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode), s = t.objectStore(store);
      let out;
      Promise.resolve(fn(s)).then(v => { out = v });
      t.oncomplete = () => res(out);
      t.onerror = t.onabort = () => rej(t.error);
    });
  }
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) });

  const hook = { onChange: null }; // 同期が、変更を知るための入り口
  const changed = r => { try { hook.onChange && hook.onChange() } catch {} return r };
  return {
    get onChange() { return hook.onChange }, set onChange(f) { hook.onChange = f },
    // kind: "sentences"(英文)/ "words"(単語)/ "chunks"(意味句・IU)
    all: (kind = "sentences") => tx(kind, "readonly", s => req(s.getAll())),
    put: (rows, kind = "sentences") => tx(kind, "readwrite", s => { (Array.isArray(rows) ? rows : [rows]).forEach(r => s.put(r)); }).then(changed),
    del: (ids, kind = "sentences") => tx(kind, "readwrite", s => { ids.forEach(id => s.delete(id)); }).then(changed),
    getMeta: async (key, dflt) => { const r = await tx("meta", "readonly", s => req(s.get(key))); return r ? r.value : dflt },
    setMeta: (key, value) => tx("meta", "readwrite", s => { s.put({ key, value }); })
  };
})();
