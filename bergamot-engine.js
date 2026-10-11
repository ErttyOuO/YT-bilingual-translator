// Local translation with the Bergamot WebAssembly engine.
//
// Engine: vendor/bergamot/ is the unmodified worker build from the npm package
// @browsermt/bergamot-translator 0.4.9 (MPL-2.0). It runs in a dedicated Worker
// owned by the background page, so the YouTube page thread is never blocked.
//
// Models: the same files Firefox Translations uses, published in Mozilla's
// Remote Settings collection "translations-models". They are data, not code:
// downloaded on first use, verified against the published SHA-256, and kept
// in this extension's IndexedDB. Nothing here falls back to a cloud service;
// background.js decides that from the user's settings.
(function () {
  'use strict';

  const EXT = typeof browser !== 'undefined' ? browser : chrome;
  const SETTINGS_SERVER = 'https://firefox.settings.services.mozilla.com/v1';
  const RECORDS_URL = `${SETTINGS_SERVER}/buckets/main/collections/translations-models/records`;
  const RECORDS_CACHE_KEY = 'ytbbiBergamotRecordsV1';
  const RECORDS_TTL_MS = 24 * 60 * 60 * 1000;
  const DOWNLOAD_TIMEOUT_MS = 180000;
  const DB_NAME = 'ytbbi-bergamot';
  const DB_STORE = 'files';
  const MAX_LOADED_MODELS = 2;
  // Origins the model download needs; requested as optional permissions.
  const MODEL_ORIGINS = ['https://firefox.settings.services.mozilla.com/*', 'https://firefox-settings-attachments.cdn.mozilla.net/*'];

  // Machine-readable failure reasons, surfaced to the popup and the overlay.
  const CODES = Object.freeze({
    PERMISSION: 'BERGAMOT_PERMISSION_REQUIRED',
    SOURCE_UNKNOWN: 'BERGAMOT_SOURCE_LANGUAGE_UNKNOWN',
    SAME_LANGUAGE: 'BERGAMOT_SAME_LANGUAGE',
    REGISTRY: 'BERGAMOT_REGISTRY_FAILED',
    NO_MODEL: 'BERGAMOT_MODEL_NOT_AVAILABLE',
    DOWNLOAD: 'BERGAMOT_MODEL_DOWNLOAD_FAILED',
    ENGINE: 'BERGAMOT_ENGINE_LOAD_FAILED',
    MODEL_INIT: 'BERGAMOT_MODEL_INIT_FAILED',
    TRANSLATE: 'BERGAMOT_TRANSLATE_FAILED'
  });

  class BergamotError extends Error {
    constructor(code, detail = '', status = 422) {
      super(detail ? `[${code}] ${detail}` : `[${code}]`);
      this.name = 'BergamotError';
      this.code = code;
      // 503 marks failures worth retrying later (network); the rest are final.
      this.status = status;
    }
  }

  const status = { state: 'idle', pair: '', received: 0, total: 0, error: null, updatedAt: 0 };
  const setStatus = (patch) => Object.assign(status, patch, { updatedAt: Date.now() });

  // ---- permissions -------------------------------------------------------------
  const hasModelPermission = async () => {
    try {
      return await EXT.permissions.contains({ origins: MODEL_ORIGINS });
    } catch (_error) {
      return false;
    }
  };

  // ---- model registry ------------------------------------------------------------
  // Remote Settings records carry a filter_expression that Firefox evaluates
  // against its own environment. We emulate desktop release Firefox for the two
  // variables the collection uses; anything we cannot parse is skipped.
  const FILTER_ENV = { 'env.appinfo.OS': 'WINNT', 'env.channel': 'release' };
  const matchesFilter = (expression) => {
    const value = String(expression || '').trim();
    if (!value) return true;
    const evalClause = (clause) => {
      const match = clause.trim().match(/^(env\.[\w.]+)\s*(==|!=)\s*'([^']*)'$/);
      if (!match || !(match[1] in FILTER_ENV)) return null;
      return match[2] === '==' ? FILTER_ENV[match[1]] === match[3] : FILTER_ENV[match[1]] !== match[3];
    };
    if (/[()]/.test(value)) return false;
    const anyOf = value.split('||').map((group) => group.split('&&').map(evalClause));
    if (anyOf.some((group) => group.some((result) => result === null))) return false;
    return anyOf.some((group) => group.every(Boolean));
  };

  const compareVersions = (a, b) => {
    const parse = (v) => String(v).split(/[^\d]+/).filter(Boolean).map(Number);
    const x = parse(a);
    const y = parse(b);
    for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
      if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
    }
    return 0;
  };

  let registryPromise = null;

  const fetchJson = async (url) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, { credentials: 'omit', cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  };

  const loadRegistry = () => {
    if (registryPromise) return registryPromise;
    registryPromise = (async () => {
      try {
        const stored = (await EXT.storage.local.get({ [RECORDS_CACHE_KEY]: null }))[RECORDS_CACHE_KEY];
        if (stored?.records?.length && Date.now() - stored.fetchedAt < RECORDS_TTL_MS) return stored;
      } catch (_error) {
        // Fall through to a fresh download.
      }
      try {
        const [server, collection] = await Promise.all([fetchJson(`${SETTINGS_SERVER}/`), fetchJson(RECORDS_URL)]);
        const records = (collection?.data || [])
          .filter((r) => r?.attachment?.location && r.fromLang && r.toLang && r.fileType)
          .map((r) => ({
            fromLang: r.fromLang, toLang: r.toLang, fileType: r.fileType, version: String(r.version || ''),
            name: r.name, filter: r.filter_expression || '', location: r.attachment.location,
            hash: r.attachment.hash, size: r.attachment.size
          }));
        const registry = { fetchedAt: Date.now(), attachBase: server?.capabilities?.attachments?.base_url, records };
        if (!registry.attachBase || !records.length) throw new Error('empty model registry');
        await EXT.storage.local.set({ [RECORDS_CACHE_KEY]: registry }).catch(() => undefined);
        return registry;
      } catch (error) {
        registryPromise = null;
        throw new BergamotError(CODES.REGISTRY, error.message || String(error), 503);
      }
    })();
    return registryPromise;
  };

  // Newest applicable file of each type for one direction, or null.
  const pickModelFiles = (registry, from, to) => {
    const byType = new Map();
    for (const record of registry.records) {
      if (record.fromLang !== from || record.toLang !== to) continue;
      if (/[a-z]/i.test(record.version.replace(/^\d+(\.\d+)*/, ''))) continue; // alpha/beta builds
      if (!matchesFilter(record.filter)) continue;
      const current = byType.get(record.fileType);
      if (!current || compareVersions(record.version, current.version) > 0) byType.set(record.fileType, record);
    }
    const hasVocab = byType.has('vocab') || (byType.has('srcvocab') && byType.has('trgvocab'));
    if (!byType.has('model') || !byType.has('lex') || !hasVocab) return null;
    // All files of a model must come from the same release.
    const version = byType.get('model').version;
    if ([...byType.values()].some((record) => record.version !== version)) return null;
    return Object.fromEntries(byType);
  };

  // Direct model, or two models through English (e.g. ja -> en -> zh-Hant).
  const planTranslation = async (from, to) => {
    const registry = await loadRegistry();
    const direct = pickModelFiles(registry, from, to);
    if (direct) return { steps: [{ from, to, files: direct }] };
    if (from !== 'en' && to !== 'en') {
      const first = pickModelFiles(registry, from, 'en');
      const second = pickModelFiles(registry, 'en', to);
      if (first && second) return { steps: [{ from, to: 'en', files: first }, { from: 'en', to, files: second }] };
    }
    throw new BergamotError(CODES.NO_MODEL, `${from} -> ${to}`);
  };

  // ---- model file cache (IndexedDB) -------------------------------------------
  let dbPromise = null;
  const openDb = () => {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { dbPromise = null; reject(request.error); };
    });
    return dbPromise;
  };

  const dbRequest = async (mode, run) => {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, mode);
      const request = run(tx.objectStore(DB_STORE));
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  };

  const cachedFile = (hash) => dbRequest('readonly', (store) => store.get(hash)).catch(() => undefined);
  const storeFile = (hash, buffer) => dbRequest('readwrite', (store) => store.put(buffer, hash)).catch(() => undefined);

  const sha256Hex = async (buffer) => {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  };

  const downloadFile = async (registry, record, onProgress) => {
    const cached = await cachedFile(record.hash);
    if (cached instanceof ArrayBuffer && cached.byteLength === record.size) {
      onProgress(record.size);
      return cached;
    }
    if (!(await hasModelPermission())) throw new BergamotError(CODES.PERMISSION, 'model download hosts');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      const response = await fetch(registry.attachBase + record.location, { credentials: 'omit', signal: controller.signal });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      const reader = response.body.getReader();
      const chunks = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        onProgress(received);
      }
      const bytes = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      if (await sha256Hex(bytes.buffer) !== record.hash) throw new Error(`checksum mismatch for ${record.name}`);
      await storeFile(record.hash, bytes.buffer);
      return bytes.buffer;
    } catch (error) {
      if (error instanceof BergamotError) throw error;
      throw new BergamotError(CODES.DOWNLOAD, `${record.name}: ${error.name === 'AbortError' ? 'timeout' : error.message}`, 503);
    } finally {
      clearTimeout(timer);
    }
  };

  // ---- worker ---------------------------------------------------------------------
  let worker = null;
  let enginePromise = null;
  let rpcSeq = 0;
  const rpcPending = new Map();
  const loadedModels = new Map(); // "from|to" -> Promise<void>, insertion order = LRU

  const resetEngine = (reason) => {
    try { worker?.terminate(); } catch (_error) { /* already gone */ }
    worker = null;
    enginePromise = null;
    loadedModels.clear();
    rpcPending.forEach(({ reject }) => reject(reason));
    rpcPending.clear();
  };

  const rpc = (name, ...args) => new Promise((resolve, reject) => {
    const id = ++rpcSeq;
    rpcPending.set(id, { resolve, reject });
    worker.postMessage({ id, name, args });
  });

  const ensureEngine = () => {
    if (enginePromise) return enginePromise;
    enginePromise = (async () => {
      try {
        worker = new Worker(EXT.runtime.getURL('vendor/bergamot/translator-worker.js'));
        worker.addEventListener('message', ({ data }) => {
          const pending = rpcPending.get(data?.id);
          if (!pending) return;
          rpcPending.delete(data.id);
          if (data.error) pending.reject(Object.assign(new Error(data.error.message || 'worker error'), { workerError: data.error }));
          else pending.resolve(data.result);
        });
        worker.addEventListener('error', (event) => {
          event.preventDefault?.();
          const error = new BergamotError(CODES.ENGINE, event.message || 'worker crashed');
          setStatus({ state: 'error', error: { code: error.code, message: error.message } });
          resetEngine(error);
        });
        await rpc('initialize', { cacheSize: 0, useNativeIntGemm: false });
      } catch (error) {
        const failure = error instanceof BergamotError ? error : new BergamotError(CODES.ENGINE, error.message || String(error));
        resetEngine(failure);
        throw failure;
      }
    })();
    return enginePromise;
  };

  const ensureModel = (step) => {
    const key = `${step.from}|${step.to}`;
    if (loadedModels.has(key)) {
      const promise = loadedModels.get(key);
      loadedModels.delete(key);
      loadedModels.set(key, promise); // mark as recently used
      return promise;
    }
    const promise = (async () => {
      const registry = await loadRegistry();
      const records = Object.values(step.files);
      const total = records.reduce((sum, record) => sum + (record.size || 0), 0);
      const received = new Map();
      const report = (record) => (bytes) => {
        received.set(record.hash, bytes);
        const sum = [...received.values()].reduce((a, b) => a + b, 0);
        if (status.state !== 'loading-model') setStatus({ state: 'downloading-model', pair: key, received: sum, total });
      };
      setStatus({ state: 'downloading-model', pair: key, received: 0, total, error: null });
      const buffers = {};
      for (const [type, record] of Object.entries(step.files)) buffers[type] = await downloadFile(registry, record, report(record));

      setStatus({ state: 'loading-engine', pair: key });
      await ensureEngine();
      setStatus({ state: 'loading-model', pair: key });
      const vocabs = buffers.vocab ? [buffers.vocab] : [buffers.srcvocab, buffers.trgvocab];
      try {
        await rpc('loadTranslationModel', { from: step.from, to: step.to }, { model: buffers.model, shortlist: buffers.lex, vocabs, config: {} });
      } catch (error) {
        throw new BergamotError(CODES.MODEL_INIT, error.message || String(error));
      }
      // Keep memory bounded: each loaded model costs roughly 100-200 MB.
      while (loadedModels.size > MAX_LOADED_MODELS) {
        const [oldKey] = loadedModels.keys();
        loadedModels.delete(oldKey);
        const [from, to] = oldKey.split('|');
        rpc('freeTranslationModel', { from, to }).catch(() => undefined);
      }
    })();
    loadedModels.set(key, promise);
    promise.catch((error) => {
      if (loadedModels.get(key) === promise) loadedModels.delete(key);
      setStatus({ state: 'error', pair: key, error: { code: error.code || CODES.MODEL_INIT, message: error.message } });
    });
    return promise;
  };

  const toModelLang = (code) => globalThis.YTBBI_LANG.providerLanguage('bergamot', code);

  // Download (if needed) and load the models for one direction.
  const prepare = async ({ sourceLang, targetLang }) => {
    if (!sourceLang || sourceLang === 'auto') throw new BergamotError(CODES.SOURCE_UNKNOWN);
    const from = toModelLang(sourceLang);
    const to = toModelLang(targetLang);
    if (from === to) throw new BergamotError(CODES.SAME_LANGUAGE, `${from}`);
    const plan = await planTranslation(from, to);
    for (const step of plan.steps) await ensureModel(step);
    setStatus({ state: 'ready', pair: `${from}|${to}`, error: null });
    return plan;
  };

  // texts: string[] -> Promise<string[]>
  const translateTexts = async ({ texts, sourceLang, targetLang }) => {
    const plan = await prepare({ sourceLang, targetLang });
    try {
      const responses = await rpc('translate', {
        models: plan.steps.map(({ from, to }) => ({ from, to })),
        texts: texts.map((text) => ({ text, html: false, qualityScores: false }))
      });
      return responses.map((item) => String(item?.target?.text || '').trim());
    } catch (error) {
      if (error instanceof BergamotError) throw error;
      throw new BergamotError(CODES.TRANSLATE, error.message || String(error));
    }
  };

  // Directions available from the registry, for the settings page.
  const listDirections = async () => {
    const registry = await loadRegistry();
    const pairs = new Set();
    for (const record of registry.records) {
      if (record.fileType === 'model' && pickModelFiles(registry, record.fromLang, record.toLang)) pairs.add(`${record.fromLang}|${record.toLang}`);
    }
    return Array.from(pairs).sort();
  };

  const clearModels = async () => {
    resetEngine(new BergamotError(CODES.ENGINE, 'models cleared'));
    registryPromise = null;
    await dbRequest('readwrite', (store) => store.clear()).catch(() => undefined);
    await EXT.storage.local.remove(RECORDS_CACHE_KEY).catch(() => undefined);
    setStatus({ state: 'idle', pair: '', received: 0, total: 0, error: null });
    return { ok: true };
  };

  const getStatus = async () => ({ ...status, permission: await hasModelPermission(), modelOrigins: MODEL_ORIGINS.slice() });

  globalThis.YTBBI_BERGAMOT = Object.freeze({
    CODES, BergamotError, MODEL_ORIGINS, translateTexts, prepare, listDirections, clearModels, getStatus,
    // Exposed for unit tests.
    _matchesFilter: matchesFilter, _pickModelFiles: pickModelFiles
  });
})();
