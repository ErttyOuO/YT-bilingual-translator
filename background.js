(() => {
  'use strict';

  const IS_BROWSER_PROMISE_API = typeof browser !== 'undefined';
  const EXT = IS_BROWSER_PROMISE_API ? browser : chrome;
  const EXT_NAME = 'YT Bilingual Translator';

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    uiLanguage: 'zh-TW',
    targetLang: 'zh-TW',
    showOriginal: true,
    showTranslation: true,
    hideNativeCaptions: true,
    fontSize: 18,
    bottomPercent: 12,
    maxWidthPercent: 86,
    sourceLang: 'auto',
    debug: false,
    translationProvider: 'auto-free',
    autoFailover: true,
    googleCloudApiKey: '',
    cloudV3ProxyUrl: '',
    libreTranslateUrl: 'https://libretranslate.com',
    libreTranslateApiKey: '',
    lingvaInstanceUrl: 'https://lingva.ml',
    interactiveLookup: true,
    dictionaryMode: 'both',
    showWordUnderline: true,
    learningMode: 'en-to-zh',
    stableAutoCaptions: true,
    batchTranslationEnabled: true,
    batchSize: 5,
    transcriptFirstMode: true
  });

  const PROVIDERS = Object.freeze({    'microsoft-edge': { label: 'Microsoft Edge Translate', delayMs: 260, timeoutMs: 9000, cooldownBaseMs: 14000 },
    'google-free': { label: 'Google Free', delayMs: 680, timeoutMs: 8500, cooldownBaseMs: 20000 },
    'google-dict': { label: 'Google Dictionary Endpoint', delayMs: 780, timeoutMs: 8500, cooldownBaseMs: 24000 },
    'lingva': { label: 'Lingva', delayMs: 760, timeoutMs: 10500, cooldownBaseMs: 22000 },
    'libretranslate': { label: 'LibreTranslate', delayMs: 980, timeoutMs: 12000, cooldownBaseMs: 26000 },
    'mymemory': { label: 'MyMemory', delayMs: 950, timeoutMs: 12000, cooldownBaseMs: 22000 },
    'cloud-v2': { label: 'Google Cloud v2', delayMs: 120, timeoutMs: 10000, cooldownBaseMs: 12000 },
    'cloud-v3-proxy': { label: 'Google Cloud v3 Proxy', delayMs: 120, timeoutMs: 10000, cooldownBaseMs: 12000 }
  });

  const AUTO_FREE_ORDER = ['microsoft-edge', 'google-free', 'google-dict', 'lingva', 'libretranslate', 'mymemory'];
  const GOOGLE_FALLBACK_ORDER = ['microsoft-edge', 'google-free', 'google-dict', 'lingva', 'libretranslate', 'mymemory'];
  const MICROSOFT_AUTH_URL = 'https://edge.microsoft.com/translate/auth';
  const MICROSOFT_TRANSLATE_URL = 'https://api-edge.cognitive.microsofttranslator.com/translate';  const MAX_CACHE_SIZE = 1800;
  const DEFAULT_BATCH_SIZE = 5;
  const MAX_BATCH_SIZE = 8;
  const BATCH_SEPARATOR = '\n§§§ YTBBI_BATCH_SPLIT §§§\n';

  const translateCache = new Map();
  const inflightTranslate = new Map();
  const dictionaryCache = new Map();
  const wordImageCache = new Map();
  const providerState = new Map();
  const providerQueues = new Map();
  const prefetchBatchInflight = new Map();
  const prefetchBatchQueue = [];
  let prefetchBatchTimer = 0;
  let microsoftToken = '';
  let microsoftTokenExpiresAt = 0;

  const log = (...args) => console.log(`[${EXT_NAME}]`, ...args);

  const now = () => Date.now();

  const normalizeText = (text) => String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const normalizeTerm = (text) => normalizeText(text)
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '')
    .trim();

  const decodeHtml = (text) => {
    if (!text) return '';
    return String(text)
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_m, num) => String.fromCodePoint(parseInt(num, 10)));
  };

  const cacheSet = (cache, key, value) => {
    cache.set(key, value);
    if (cache.size > MAX_CACHE_SIZE) {
      const first = cache.keys().next().value;
      cache.delete(first);
    }
  };

  const callMaybePromise = (fn, ctx, ...args) => {
    if (IS_BROWSER_PROMISE_API) return fn.apply(ctx, args);
    return new Promise((resolve, reject) => {
      try {
        fn.call(ctx, ...args, (value) => {
          const lastError = EXT.runtime && EXT.runtime.lastError;
          if (lastError) reject(new Error(lastError.message));
          else resolve(value);
        });
      } catch (error) {
        reject(error);
      }
    });
  };

  const storageGet = (defaults) => callMaybePromise(EXT.storage.local.get, EXT.storage.local, defaults);
  const storageSet = (value) => callMaybePromise(EXT.storage.local.set, EXT.storage.local, value);

  const getSettings = async () => {
    const stored = await storageGet(DEFAULT_SETTINGS);
    const merged = { ...DEFAULT_SETTINGS, ...stored, sourceLang: 'auto' };
    if (merged.translationProvider === 'google-html') merged.translationProvider = 'auto-free';
    return merged;
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms || 0)));

  class ProviderError extends Error {
    constructor(provider, message, status = 0) {
      super(message);
      this.name = 'ProviderError';
      this.provider = provider;
      this.status = status;
    }
  }

  const getProviderState = (provider) => {
    if (!providerState.has(provider)) {
      providerState.set(provider, { cooldownUntil: 0, failures: 0, nextAllowedAt: 0, lastOkAt: 0 });
    }
    return providerState.get(provider);
  };

  const isProviderCoolingDown = (provider) => getProviderState(provider).cooldownUntil > now();

  const markProviderSuccess = (provider) => {
    const state = getProviderState(provider);
    state.failures = 0;
    state.cooldownUntil = 0;
    state.lastOkAt = now();
  };

  const isRateLimitOrTransient = (error) => {
    const status = Number(error?.status || 0);
    const message = String(error?.message || '');
    return status === 0 || status === 403 || status === 408 || status === 429 || status >= 500 || /timeout|timed out|network|failed to fetch|rate|quota|too many|temporarily|limit/i.test(message);
  };

  const markProviderFailure = (provider, error) => {
    const state = getProviderState(provider);
    state.failures += 1;
    if (!isRateLimitOrTransient(error)) return;
    const config = PROVIDERS[provider] || PROVIDERS['google-free'];
    const base = config.cooldownBaseMs || 20000;
    const cooldown = Math.min(180000, base * Math.pow(1.8, Math.max(0, state.failures - 1)));
    state.cooldownUntil = now() + cooldown;
  };

  const runQueued = (provider, task) => {
    const previous = providerQueues.get(provider) || Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      const config = PROVIDERS[provider] || PROVIDERS['google-free'];
      const state = getProviderState(provider);
      const waitMs = Math.max(0, state.nextAllowedAt - now());
      if (waitMs) await sleep(waitMs);
      state.nextAllowedAt = now() + (config.delayMs || 700);
      return task();
    });
    providerQueues.set(provider, next.catch(() => undefined));
    return next;
  };

  const fetchWithTimeout = async (provider, url, options = {}) => {
    const config = PROVIDERS[provider] || PROVIDERS['google-free'];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs || 10000);
    try {
      return await runQueued(provider, () => fetch(url, { ...options, signal: controller.signal }));
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new ProviderError(provider, `${provider} timeout`, 0);
      }
      throw new ProviderError(provider, error?.message || String(error), 0);
    } finally {
      clearTimeout(timer);
    }
  };

  const buildUrl = (base, path) => {
    const trimmed = String(base || '').trim().replace(/\/+$/, '');
    if (!trimmed) return '';
    return `${trimmed}${path}`;
  };

  const providerLanguage = (provider, lang) => {
    const normalized = String(lang || '').trim();
    if (!normalized) return '';
    if (provider === 'libretranslate') {
      if (/^zh/i.test(normalized)) return 'zh';
      if (/^pt-BR$/i.test(normalized)) return 'pt';
      return normalized.split('-')[0];
    }
    if (provider === 'lingva') {
      if (/^zh/i.test(normalized)) return 'zh';
      return normalized.split('-')[0];
    }
    if (provider === 'mymemory') {
      if (/^zh/i.test(normalized)) return 'zh-TW';
      return normalized.split('-')[0] || 'auto';
    }
    if (provider === 'microsoft-edge') {
      if (/^zh/i.test(normalized)) return 'zh-Hant';
      if (/^pt-BR$/i.test(normalized)) return 'pt-BR';
      return normalized.split('-')[0] || 'auto';
    }
    if (provider === 'google-html') {
      if (/^zh/i.test(normalized)) return 'zh-TW';
      return normalized === 'auto' ? 'auto' : normalized.split('-')[0];
    }
    return normalized;
  };

  const guessSourceLang = (text, fallback = 'auto') => {
    const value = String(text || '');
    if (fallback && fallback !== 'auto') return fallback;
    if (/[\u3040-\u30ff]/.test(value)) return 'ja';
    if (/[\uac00-\ud7af]/.test(value)) return 'ko';
    if (/[A-Za-z]/.test(value)) return 'en';
    if (/[\u4e00-\u9fff]/.test(value)) return 'zh-CN';
    return 'en';
  };

  const parseGoogleArrayTranslation = (data) => {
    if (typeof data === 'string') return normalizeText(decodeHtml(data));
    if (Array.isArray(data?.sentences)) {
      return normalizeText(decodeHtml(data.sentences.map((s) => s.trans || '').join('')));
    }
    if (Array.isArray(data)) {
      const first = data[0];
      if (Array.isArray(first)) {
        if (Array.isArray(first[0])) {
          const joined = first.map((part) => Array.isArray(part) ? part[0] : '').filter(Boolean).join('');
          if (joined) return normalizeText(decodeHtml(joined));
        }
        const joined = first.filter((part) => typeof part === 'string').join('');
        if (joined) return normalizeText(decodeHtml(joined));
      }
    }
    return '';
  };

  const getMicrosoftToken = async () => {
    const safeNow = now();
    if (microsoftToken && microsoftTokenExpiresAt > safeNow + 60000) return microsoftToken;
    const provider = 'microsoft-edge';
    const response = await fetchWithTimeout(provider, MICROSOFT_AUTH_URL, {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store'
    });
    const token = await response.text().catch(() => '');
    if (!response.ok || !token) {
      throw new ProviderError(provider, `Microsoft auth failed: ${response.status}`, response.status);
    }
    microsoftToken = token.trim();
    microsoftTokenExpiresAt = safeNow + 8 * 60 * 1000;
    return microsoftToken;
  };

  const translateViaMicrosoftEdge = async ({ text, sourceLang, targetLang }) => {
    const provider = 'microsoft-edge';
    const token = await getMicrosoftToken();
    const source = sourceLang && sourceLang !== 'auto' ? providerLanguage(provider, sourceLang) : '';
    const target = providerLanguage(provider, targetLang || 'zh-TW');
    const params = new URLSearchParams({ 'api-version': '3.0', to: target, includeSentenceLength: 'true', textType: 'html' });
    if (source) params.set('from', source);
    const response = await fetchWithTimeout(provider, `${MICROSOFT_TRANSLATE_URL}?${params.toString()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Ocp-Apim-Subscription-Key': token,
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify([{ Text: text }]),
      credentials: 'omit',
      cache: 'no-store'
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new ProviderError(provider, `Microsoft Edge Translate failed: ${response.status}`, response.status);
    const translated = data?.[0]?.translations?.[0]?.text;
    if (!translated) throw new ProviderError(provider, 'Unexpected Microsoft Edge Translate response shape.', response.status);
    return normalizeText(decodeHtml(translated));
  };

  const translateViaGoogleFree = async ({ text, sourceLang, targetLang }) => {
    const provider = 'google-free';
    const source = sourceLang && sourceLang !== 'auto' ? sourceLang : 'auto';
    const target = targetLang || 'zh-TW';
    const params = new URLSearchParams({ client: 'gtx', sl: source, tl: target, dt: 't', q: text });
    const response = await fetchWithTimeout(provider, `https://translate.googleapis.com/translate_a/single?${params.toString()}`, {
      method: 'GET', credentials: 'omit', cache: 'no-store'
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(data)) {
      throw new ProviderError(provider, `Google Free Translate failed: ${response.status}`, response.status);
    }
    const translated = parseGoogleArrayTranslation(data);
    if (!translated) throw new ProviderError(provider, 'Unexpected Google Free Translate response shape.', response.status);
    return translated;
  };

  const translateViaGoogleDict = async ({ text, sourceLang, targetLang }) => {
    const provider = 'google-dict';
    const source = sourceLang && sourceLang !== 'auto' ? sourceLang : 'auto';
    const target = targetLang || 'zh-TW';
    const params = new URLSearchParams({ client: 'dict-chrome-ex', sl: source, tl: target, q: text });
    const response = await fetchWithTimeout(provider, `https://clients5.google.com/translate_a/t?${params.toString()}`, {
      method: 'GET', credentials: 'omit', cache: 'no-store'
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || data == null) {
      throw new ProviderError(provider, `Google Dictionary endpoint failed: ${response.status}`, response.status);
    }
    const translated = parseGoogleArrayTranslation(data);
    if (!translated) throw new ProviderError(provider, 'Unexpected Google Dictionary endpoint response shape.', response.status);
    return translated;
  };

  const translateViaLibreTranslate = async ({ text, sourceLang, targetLang, settings }) => {
    const provider = 'libretranslate';
    const baseUrl = settings.libreTranslateUrl || 'https://libretranslate.com';
    const source = sourceLang && sourceLang !== 'auto' ? providerLanguage(provider, sourceLang) : 'auto';
    const target = providerLanguage(provider, targetLang || settings.targetLang || 'zh-TW');
    const payload = { q: text, source, target, format: 'text' };
    if (settings.libreTranslateApiKey) payload.api_key = settings.libreTranslateApiKey;

    const response = await fetchWithTimeout(provider, buildUrl(baseUrl, '/translate'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), credentials: 'omit', cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data?.error || data?.message || `LibreTranslate failed: ${response.status}`;
      throw new ProviderError(provider, message, response.status);
    }
    const translated = data?.translatedText;
    if (!translated) throw new ProviderError(provider, 'Unexpected LibreTranslate response shape.', response.status);
    return normalizeText(decodeHtml(translated));
  };

  const translateViaLingva = async ({ text, sourceLang, targetLang, settings }) => {
    const provider = 'lingva';
    const baseUrl = settings.lingvaInstanceUrl || 'https://lingva.ml';
    const source = sourceLang && sourceLang !== 'auto' ? providerLanguage(provider, sourceLang) : 'auto';
    const target = providerLanguage(provider, targetLang || settings.targetLang || 'zh-TW');
    const endpoint = buildUrl(baseUrl, `/api/v1/${encodeURIComponent(source)}/${encodeURIComponent(target)}/${encodeURIComponent(text)}`);
    const response = await fetchWithTimeout(provider, endpoint, { method: 'GET', credentials: 'omit', cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data?.error || data?.message || `Lingva failed: ${response.status}`;
      throw new ProviderError(provider, message, response.status);
    }
    const translated = data?.translation || data?.translatedText;
    if (!translated) throw new ProviderError(provider, 'Unexpected Lingva response shape.', response.status);
    return normalizeText(decodeHtml(translated));
  };

  const translateViaMyMemory = async ({ text, sourceLang, targetLang }) => {
    const provider = 'mymemory';
    const source = providerLanguage(provider, guessSourceLang(text, sourceLang));
    const target = providerLanguage(provider, targetLang || 'zh-TW');
    const params = new URLSearchParams({ q: text, langpair: `${source}|${target}` });
    const response = await fetchWithTimeout(provider, `https://api.mymemory.translated.net/get?${params.toString()}`, {
      method: 'GET', credentials: 'omit', cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new ProviderError(provider, data?.responseDetails || `MyMemory failed: ${response.status}`, response.status);
    }
    const translated = data?.responseData?.translatedText;
    if (!translated) throw new ProviderError(provider, 'Unexpected MyMemory response shape.', response.status);
    return normalizeText(decodeHtml(translated));
  };

  const translateViaCloudV2 = async ({ text, sourceLang, targetLang, settings }) => {
    const provider = 'cloud-v2';
    const apiKey = String(settings.googleCloudApiKey || '').trim();
    if (!apiKey) throw new ProviderError(provider, 'NO_GOOGLE_CLOUD_API_KEY', 0);
    const body = new URLSearchParams();
    body.set('q', text);
    body.set('target', targetLang || settings.targetLang || 'zh-TW');
    body.set('format', 'text');
    const source = sourceLang || settings.sourceLang;
    if (source && source !== 'auto') body.set('source', source);
    const response = await fetchWithTimeout(provider, `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body: body.toString(), credentials: 'omit', cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data?.error?.message || `Cloud Translation API v2 failed: ${response.status}`;
      throw new ProviderError(provider, message, response.status);
    }
    const translated = data?.data?.translations?.[0]?.translatedText;
    if (!translated) throw new ProviderError(provider, 'Unexpected Cloud Translation API v2 response shape.', response.status);
    return normalizeText(decodeHtml(translated));
  };

  const translateViaCloudV3Proxy = async ({ text, sourceLang, targetLang, settings }) => {
    const provider = 'cloud-v3-proxy';
    const proxyUrl = String(settings.cloudV3ProxyUrl || '').trim();
    if (!proxyUrl) throw new ProviderError(provider, 'NO_CLOUD_V3_PROXY_URL', 0);
    const payload = { contents: [text], targetLanguageCode: targetLang || settings.targetLang || 'zh-TW', mimeType: 'text/plain' };
    const source = sourceLang || settings.sourceLang;
    if (source && source !== 'auto') payload.sourceLanguageCode = source;
    const response = await fetchWithTimeout(provider, proxyUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), credentials: 'omit', cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data?.error?.message || data?.error || `Cloud Translation API v3 proxy failed: ${response.status}`;
      throw new ProviderError(provider, message, response.status);
    }
    const translated = data?.translations?.[0]?.translatedText || data?.translation || data?.translatedText || data?.data?.translations?.[0]?.translatedText;
    if (!translated) throw new ProviderError(provider, 'Unexpected Cloud Translation API v3 proxy response shape.', response.status);
    return normalizeText(decodeHtml(translated));
  };

  const callProvider = (provider, args) => {
    if (provider === 'cloud-v2') return translateViaCloudV2(args);
    if (provider === 'cloud-v3-proxy') return translateViaCloudV3Proxy(args);
    if (provider === 'microsoft-edge') return translateViaMicrosoftEdge(args);
    if (provider === 'libretranslate') return translateViaLibreTranslate(args);
    if (provider === 'lingva') return translateViaLingva(args);
    if (provider === 'mymemory') return translateViaMyMemory(args);
    if (provider === 'google-dict') return translateViaGoogleDict(args);
    return translateViaGoogleFree(args);
  };

  const getProviderOrder = (settings) => {
    const provider = settings.translationProvider || 'auto-free';
    if (provider === 'auto-free') return AUTO_FREE_ORDER.slice();
    if (provider === 'google-free' && settings.autoFailover !== false) return GOOGLE_FALLBACK_ORDER.slice();
    if (provider === 'microsoft-edge' && settings.autoFailover !== false) return ['microsoft-edge', 'google-free', 'google-dict', 'lingva', 'libretranslate', 'mymemory'];
    if (provider === 'lingva' && settings.autoFailover !== false) return ['lingva', 'microsoft-edge', 'google-free', 'google-dict', 'libretranslate', 'mymemory'];
    if (provider === 'libretranslate' && settings.autoFailover !== false) return ['libretranslate', 'microsoft-edge', 'google-free', 'google-dict', 'lingva', 'mymemory'];
    if (provider === 'mymemory' && settings.autoFailover !== false) return ['mymemory', 'microsoft-edge', 'google-free', 'google-dict', 'lingva', 'libretranslate'];
    return [provider];
  };

  const normalizeTranslateCacheText = (text) => {
    const normalized = normalizeText(text).toLowerCase();
    const compact = normalized.replace(/[\s\p{P}\p{S}]+/gu, '');
    return compact || normalized;
  };

  const makeTranslateCacheKey = (sourceLang, targetLang, text) => `${sourceLang}|${targetLang}|${normalizeTranslateCacheText(text)}`;

  const retryProviderTask = async (provider, task, attempts = 2) => {
    let lastError = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await task();
      } catch (error) {
        lastError = error;
        if (!isRateLimitOrTransient(error) || attempt >= attempts - 1) break;
        await sleep(350 * Math.pow(2, attempt));
      }
    }
    throw lastError;
  };

  const translateUsingProviders = async ({ normalized, sourceLang, targetLang, settings }) => {
    const order = getProviderOrder(settings);
    const errors = [];
    const activeProviders = order.filter((provider) => !isProviderCoolingDown(provider));
    const providersToTry = activeProviders.length ? activeProviders : order;

    for (const provider of providersToTry) {
      try {
        const translated = await retryProviderTask(provider, () => callProvider(provider, {
          text: normalized,
          sourceLang,
          targetLang,
          settings
        }));
        markProviderSuccess(provider);
        return translated;
      } catch (error) {
        markProviderFailure(provider, error);
        errors.push(`${PROVIDERS[provider]?.label || provider}: ${error.message || String(error)}`);
        if (settings.debug) log('provider failed', provider, error);
      }
    }

    throw new Error(`All translation providers failed. ${errors.join(' | ')}`);
  };

  const translateText = async ({ text, sourceLang, targetLang, force = false }) => {
    const normalized = normalizeText(text);
    if (!normalized) return '';
    const settings = await getSettings();
    const src = sourceLang || settings.sourceLang || 'auto';
    const tgt = targetLang || settings.targetLang || 'zh-TW';
    const cacheKey = makeTranslateCacheKey(src, tgt, normalized);

    if (!force && translateCache.has(cacheKey)) return translateCache.get(cacheKey);
    if (!force && inflightTranslate.has(cacheKey)) return inflightTranslate.get(cacheKey);

    const task = (async () => {
      const translated = await translateUsingProviders({ normalized, sourceLang: src, targetLang: tgt, settings });
      cacheSet(translateCache, cacheKey, translated);
      return translated;
    })();

    if (!force) inflightTranslate.set(cacheKey, task);
    try {
      return await task;
    } finally {
      inflightTranslate.delete(cacheKey);
    }
  };

  const getBatchSize = (settings) => {
    const raw = Number(settings.batchSize || DEFAULT_BATCH_SIZE);
    if (!Number.isFinite(raw)) return DEFAULT_BATCH_SIZE;
    return Math.max(2, Math.min(MAX_BATCH_SIZE, Math.floor(raw)));
  };

  const splitIntoBatches = (items, size) => {
    const batches = [];
    for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
    return batches;
  };

  const splitDelimitedTranslation = (translated, count) => {
    const value = normalizeText(translated);
    const escaped = BATCH_SEPARATOR.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(escaped, 'i'),
      /§+\s*YTBBI[_\s-]*BATCH[_\s-]*SPLIT\s*§+/i,
      /YTBBI[_\s-]*BATCH[_\s-]*SPLIT/i
    ];

    for (const pattern of patterns) {
      const parts = value.split(pattern).map(normalizeText);
      if (parts.length === count && parts.every(Boolean)) return parts;
    }

    return null;
  };

  const buildMarkedBatchInput = (texts) => texts
    .map((text, index) => `<<<YTBBI_BATCH_ITEM_${index + 1}>>>
${text}`)
    .join('\n');

  const splitMarkedTranslation = (translated, count) => {
    const value = String(translated || '');
    const marker = /<{0,3}\s*YTBBI[_\s-]*BATCH[_\s-]*ITEM[_\s-]*(\d+)\s*>{0,3}/gi;
    const matches = Array.from(value.matchAll(marker))
      .map((match) => ({ index: Number(match[1]), start: match.index || 0, end: (match.index || 0) + match[0].length }))
      .filter((item) => item.index >= 1 && item.index <= count)
      .sort((a, b) => a.start - b.start);

    const unique = [];
    const seen = new Set();
    for (const item of matches) {
      if (seen.has(item.index)) continue;
      seen.add(item.index);
      unique.push(item);
    }
    if (unique.length !== count) return null;

    const result = new Array(count).fill('');
    for (let i = 0; i < unique.length; i += 1) {
      const current = unique[i];
      const next = unique[i + 1];
      const rawPart = value.slice(current.end, next ? next.start : value.length);
      const cleaned = normalizeText(rawPart.replace(/^[:：\-–—\s]+/, ''));
      if (!cleaned) return null;
      result[current.index - 1] = cleaned;
    }
    return result.every(Boolean) ? result : null;
  };

  const translateBatchViaDelimiter = async (provider, { texts, sourceLang, targetLang, settings }) => {
    // Free translation endpoints do not expose a browser-safe native batch API.
    // Use strong numbered markers first because Google/Lingva usually preserve
    // them better than a plain separator. If the provider rewrites/removes the
    // markers, fall back to the older separator strategy and finally to singles.
    const marked = buildMarkedBatchInput(texts);
    const translatedMarked = await callProvider(provider, { text: marked, sourceLang, targetLang, settings });
    const markedParts = splitMarkedTranslation(translatedMarked, texts.length);
    if (markedParts) return markedParts;

    const joined = texts.join(BATCH_SEPARATOR);
    const translated = await callProvider(provider, { text: joined, sourceLang, targetLang, settings });
    const parts = splitDelimitedTranslation(translated, texts.length);
    if (!parts) {
      throw new ProviderError(provider, `${PROVIDERS[provider]?.label || provider} batch markers were not preserved.`, 422);
    }
    return parts;
  };

  const translateBatchViaMicrosoftEdge = async ({ texts, sourceLang, targetLang }) => {
    const provider = 'microsoft-edge';
    const token = await getMicrosoftToken();
    const source = sourceLang && sourceLang !== 'auto' ? providerLanguage(provider, sourceLang) : '';
    const target = providerLanguage(provider, targetLang || 'zh-TW');
    const params = new URLSearchParams({ 'api-version': '3.0', to: target, includeSentenceLength: 'true', textType: 'html' });
    if (source) params.set('from', source);
    const body = texts.map((text) => ({ Text: text }));
    const response = await fetchWithTimeout(provider, `${MICROSOFT_TRANSLATE_URL}?${params.toString()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Ocp-Apim-Subscription-Key': token,
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(body),
      credentials: 'omit',
      cache: 'no-store'
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new ProviderError(provider, `Microsoft Edge Translate batch failed: ${response.status}`, response.status);
    if (!Array.isArray(data) || data.length !== texts.length) {
      throw new ProviderError(provider, 'Unexpected Microsoft Edge Translate batch response shape.', response.status);
    }
    const result = data.map((item) => normalizeText(decodeHtml(item?.translations?.[0]?.text || '')));
    if (result.some((item) => !item)) throw new ProviderError(provider, 'Microsoft Edge Translate batch returned empty text.', response.status);
    return result;
  };

  const translateBatchViaCloudV2 = async ({ texts, sourceLang, targetLang, settings }) => {
    const provider = 'cloud-v2';
    const apiKey = String(settings.googleCloudApiKey || '').trim();
    if (!apiKey) throw new ProviderError(provider, 'NO_GOOGLE_CLOUD_API_KEY', 0);
    const body = new URLSearchParams();
    for (const text of texts) body.append('q', text);
    body.set('target', targetLang || settings.targetLang || 'zh-TW');
    body.set('format', 'text');
    const source = sourceLang || settings.sourceLang;
    if (source && source !== 'auto') body.set('source', source);
    const response = await fetchWithTimeout(provider, `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body: body.toString(), credentials: 'omit', cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data?.error?.message || `Cloud Translation API v2 batch failed: ${response.status}`;
      throw new ProviderError(provider, message, response.status);
    }
    const translations = data?.data?.translations || [];
    const result = translations.map((entry) => normalizeText(decodeHtml(entry?.translatedText || '')));
    if (result.length !== texts.length || result.some((item) => !item)) {
      throw new ProviderError(provider, 'Unexpected Cloud Translation API v2 batch response shape.', response.status);
    }
    return result;
  };

  const translateBatchViaCloudV3Proxy = async ({ texts, sourceLang, targetLang, settings }) => {
    const provider = 'cloud-v3-proxy';
    const proxyUrl = String(settings.cloudV3ProxyUrl || '').trim();
    if (!proxyUrl) throw new ProviderError(provider, 'NO_CLOUD_V3_PROXY_URL', 0);
    const payload = { contents: texts, targetLanguageCode: targetLang || settings.targetLang || 'zh-TW', mimeType: 'text/plain' };
    const source = sourceLang || settings.sourceLang;
    if (source && source !== 'auto') payload.sourceLanguageCode = source;
    const response = await fetchWithTimeout(provider, proxyUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), credentials: 'omit', cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data?.error?.message || data?.error || `Cloud Translation API v3 proxy batch failed: ${response.status}`;
      throw new ProviderError(provider, message, response.status);
    }
    const raw = data?.translations || data?.data?.translations || [];
    const result = raw.map((entry) => normalizeText(decodeHtml(entry?.translatedText || entry?.translation || '')));
    if (result.length !== texts.length || result.some((item) => !item)) {
      throw new ProviderError(provider, 'Unexpected Cloud Translation API v3 proxy batch response shape.', response.status);
    }
    return result;
  };

  const translateBatchViaLibreTranslate = async ({ texts, sourceLang, targetLang, settings }) => {
    const provider = 'libretranslate';
    const baseUrl = settings.libreTranslateUrl || 'https://libretranslate.com';
    const source = sourceLang && sourceLang !== 'auto' ? providerLanguage(provider, sourceLang) : 'auto';
    const target = providerLanguage(provider, targetLang || settings.targetLang || 'zh-TW');
    const payload = { q: texts, source, target, format: 'text' };
    if (settings.libreTranslateApiKey) payload.api_key = settings.libreTranslateApiKey;

    const response = await fetchWithTimeout(provider, buildUrl(baseUrl, '/translate'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), credentials: 'omit', cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data?.error || data?.message || `LibreTranslate batch failed: ${response.status}`;
      throw new ProviderError(provider, message, response.status);
    }
    const translated = data?.translatedText;
    const result = Array.isArray(translated)
      ? translated.map((item) => normalizeText(decodeHtml(item)))
      : null;
    if (!result || result.length !== texts.length || result.some((item) => !item)) {
      throw new ProviderError(provider, 'LibreTranslate instance does not support native batch response shape.', 422);
    }
    return result;
  };

  const callProviderBatch = (provider, args) => {
    if (provider === 'cloud-v2') return translateBatchViaCloudV2(args);
    if (provider === 'cloud-v3-proxy') return translateBatchViaCloudV3Proxy(args);
    if (provider === 'microsoft-edge') return translateBatchViaMicrosoftEdge(args);
    if (provider === 'libretranslate') return translateBatchViaLibreTranslate(args);
    // Free Google, Google Dictionary, Lingva, and MyMemory do not reliably expose
    // a formal batch API to browser extensions. Use a guarded delimiter batch.
    return translateBatchViaDelimiter(provider, args);
  };

  const translateBatchUsingProviders = async ({ texts, sourceLang, targetLang, settings }) => {
    const order = getProviderOrder(settings);
    const errors = [];
    const activeProviders = order.filter((provider) => !isProviderCoolingDown(provider));
    const providersToTry = activeProviders.length ? activeProviders : order;

    for (const provider of providersToTry) {
      try {
        const translated = await retryProviderTask(provider, () => callProviderBatch(provider, { texts, sourceLang, targetLang, settings }));
        markProviderSuccess(provider);
        return { provider, translated };
      } catch (error) {
        markProviderFailure(provider, error);
        errors.push(`${PROVIDERS[provider]?.label || provider}: ${error.message || String(error)}`);
        if (settings.debug) log('batch provider failed', provider, error);
      }
    }

    throw new Error(`All batch translation providers failed. ${errors.join(' | ')}`);
  };

  const translateBatch = async ({ texts, sourceLang, targetLang, force = false }) => {
    const settings = await getSettings();
    const src = sourceLang || settings.sourceLang || 'auto';
    const tgt = targetLang || settings.targetLang || 'zh-TW';
    const normalizedTexts = Array.from(new Set((Array.isArray(texts) ? texts : []).map(normalizeText).filter(Boolean))).slice(0, 20);
    const results = [];
    const errors = [];
    const pending = [];
    const missing = [];

    for (const text of normalizedTexts) {
      const cacheKey = makeTranslateCacheKey(src, tgt, text);
      if (!force && translateCache.has(cacheKey)) {
        results.push({ text, translatedText: translateCache.get(cacheKey), source: 'cache' });
        continue;
      }
      if (!force && inflightTranslate.has(cacheKey)) {
        pending.push(inflightTranslate.get(cacheKey)
          .then((translatedText) => results.push({ text, translatedText, source: 'inflight' }))
          .catch((error) => errors.push({ text, error: error.message || String(error) })));
        continue;
      }
      missing.push(text);
    }

    if (pending.length) await Promise.allSettled(pending);
    if (!missing.length) return { ok: true, count: results.length, results, errors, mode: 'cache' };

    const useBatch = settings.batchTranslationEnabled !== false && missing.length >= 2;
    if (!useBatch) {
      for (const text of missing) {
        try {
          const translatedText = await translateText({ text, sourceLang: src, targetLang: tgt, force });
          results.push({ text, translatedText, source: 'single' });
        } catch (error) {
          errors.push({ text, error: error.message || String(error) });
        }
      }
      return { ok: true, count: results.length, results, errors, mode: 'single' };
    }

    const batchSize = getBatchSize(settings);
    for (const group of splitIntoBatches(missing, batchSize)) {
      const batchTask = (async () => {
        try {
          const batchResult = await translateBatchUsingProviders({ texts: group, sourceLang: src, targetLang: tgt, settings });
          const map = new Map();
          batchResult.translated.forEach((translatedText, index) => {
            const text = group[index];
            const cacheKey = makeTranslateCacheKey(src, tgt, text);
            const cleaned = normalizeText(translatedText);
            cacheSet(translateCache, cacheKey, cleaned);
            map.set(text, { translatedText: cleaned, source: `batch:${batchResult.provider}` });
          });
          return map;
        } catch (batchError) {
          if (settings.debug) log('batch failed; falling back to singles', batchError);
          const map = new Map();
          for (const text of group) {
            try {
              const translatedText = await translateUsingProviders({ normalized: text, sourceLang: src, targetLang: tgt, settings });
              const cacheKey = makeTranslateCacheKey(src, tgt, text);
              cacheSet(translateCache, cacheKey, translatedText);
              map.set(text, { translatedText, source: 'single-fallback' });
            } catch (error) {
              map.set(text, { error: error.message || String(error), source: 'failed' });
            }
          }
          return map;
        }
      })();

      group.forEach((text) => {
        const cacheKey = makeTranslateCacheKey(src, tgt, text);
        const promise = batchTask.then((map) => {
          const item = map.get(text);
          if (item?.translatedText) return item.translatedText;
          throw new Error(item?.error || 'Batch translation failed');
        });
        if (!force) inflightTranslate.set(cacheKey, promise);
      });

      const map = await batchTask;
      group.forEach((text) => inflightTranslate.delete(makeTranslateCacheKey(src, tgt, text)));

      for (const text of group) {
        const item = map.get(text);
        if (item?.translatedText) results.push({ text, translatedText: item.translatedText, source: item.source });
        else errors.push({ text, error: item?.error || 'Batch translation failed' });
      }

      await sleep(120);
    }

    return { ok: true, count: results.length, results, errors, mode: 'batch' };
  };


  const fetchJsonWithTimeout = async (url, timeoutMs = 6500) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'omit',
        cache: 'force-cache',
        signal: controller.signal,
        headers: { 'Accept': 'application/json' }
      });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  };

  const arrayBufferToBase64 = (buffer) => {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.subarray(index, index + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  };

  const fetchImageDataUrl = async (url, timeoutMs = 7000) => {
    if (!/^https:\/\//i.test(String(url || ''))) return '';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'omit',
        cache: 'force-cache',
        signal: controller.signal,
        headers: { 'Accept': 'image/avif,image/webp,image/png,image/jpeg,image/svg+xml,image/*;q=0.8,*/*;q=0.5' }
      });
      if (!response.ok) return '';
      const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!contentType.startsWith('image/')) return '';
      const buffer = await response.arrayBuffer();
      if (!buffer || buffer.byteLength > 900000) return '';
      return `data:${contentType};base64,${arrayBufferToBase64(buffer)}`;
    } catch (_error) {
      return '';
    } finally {
      clearTimeout(timer);
    }
  };

  const stripHtml = (text) => normalizeText(String(text || '').replace(/<[^>]+>/g, ' '));

  const looksLikeBadCommonsTitle = (title) => /\b(logo|icon|flag|map|diagram|symbol|seal|coat of arms|svg|locator|emblem|qr|barcode)\b/i.test(String(title || ''));

  const fetchWikipediaSummaryImage = async (term) => {
    const normalized = normalizeTerm(term).toLowerCase();
    if (!normalized || !/^[a-z][a-z'-]{1,31}$/.test(normalized)) return null;
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(normalized)}`;
    const data = await fetchJsonWithTimeout(url, 5200).catch(() => null);
    if (!data || data.type === 'disambiguation' || data.type === 'no-extract') return null;
    const imageUrl = data.thumbnail?.source || data.originalimage?.source || '';
    if (!imageUrl || !/^https:\/\//i.test(imageUrl)) return null;
    const title = normalizeText(data.title || normalized);
    const dataUrl = await fetchImageDataUrl(imageUrl).catch(() => '');
    return {
      url: imageUrl,
      dataUrl,
      title,
      caption: data.description ? `${title} · ${normalizeText(data.description)}` : title,
      source: 'Wikipedia',
      sourceUrl: data.content_urls?.desktop?.page || data.content_urls?.mobile?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
      confidence: 'high'
    };
  };

  const fetchCommonsImage = async (term) => {
    const normalized = normalizeTerm(term).toLowerCase();
    if (!normalized || !/^[a-z][a-z'-]{1,31}$/.test(normalized)) return null;
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      origin: '*',
      generator: 'search',
      gsrnamespace: '6',
      gsrlimit: '10',
      gsrsearch: `${normalized} filetype:bitmap -logo -icon -flag -map -diagram`,
      prop: 'imageinfo',
      iiprop: 'url|mime|size|extmetadata',
      iiurlwidth: '480'
    });
    const data = await fetchJsonWithTimeout(`https://commons.wikimedia.org/w/api.php?${params.toString()}`, 6500).catch(() => null);
    const pages = Object.values(data?.query?.pages || {});
    for (const page of pages) {
      const title = normalizeText(page.title || '');
      if (!title || looksLikeBadCommonsTitle(title)) continue;
      const info = page.imageinfo?.[0];
      if (!info || !String(info.mime || '').startsWith('image/')) continue;
      if (/gif/i.test(info.mime || '')) continue;
      if (Number(info.width || 0) < 80 || Number(info.height || 0) < 80) continue;
      const imageUrl = info.thumburl || info.url || '';
      if (!/^https:\/\//i.test(imageUrl)) continue;
      const objectName = stripHtml(info.extmetadata?.ObjectName?.value || '').slice(0, 90);
      const dataUrl = await fetchImageDataUrl(imageUrl).catch(() => '');
      return {
        url: imageUrl,
        dataUrl,
        title: objectName || title.replace(/^File:/i, ''),
        caption: objectName || title.replace(/^File:/i, ''),
        source: 'Wikimedia Commons',
        sourceUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
        confidence: 'medium'
      };
    }
    return null;
  };

  const lookupWordImage = async (term, dictionary) => {
    const normalized = normalizeTerm(term).toLowerCase();
    if (!normalized || !/^[a-z][a-z'-]{1,31}$/.test(normalized)) return null;
    const key = normalized;
    if (wordImageCache.has(key)) return wordImageCache.get(key);

    let image = await fetchWikipediaSummaryImage(normalized).catch(() => null);

    // Wikimedia Commons fallback is useful for concrete nouns, but can be noisy
    // for verbs/adjectives/pronouns, so only use it for noun-like dictionary entries.
    const pos = String(dictionary?.partOfSpeech || '').toLowerCase();
    if (!image && /noun/.test(pos)) {
      image = await fetchCommonsImage(normalized).catch(() => null);
    }

    cacheSet(wordImageCache, key, image || null);
    return image || null;
  };

  const fetchEnglishDictionary = async (term) => {
    const normalized = normalizeTerm(term).toLowerCase();
    if (!normalized) return null;
    const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(normalized)}`, {
      method: 'GET', credentials: 'omit', cache: 'force-cache'
    });
    if (!response.ok) return null;
    const data = await response.json();
    const entry = Array.isArray(data) ? data[0] : null;
    if (!entry) return null;

    let best = null;
    for (const meaning of entry.meanings || []) {
      for (const definition of meaning.definitions || []) {
        if (!definition.definition) continue;
        best = {
          partOfSpeech: meaning.partOfSpeech || '',
          definitionEn: normalizeText(definition.definition),
          exampleEn: normalizeText(definition.example || ''),
          synonyms: Array.isArray(definition.synonyms) ? definition.synonyms.slice(0, 4) : []
        };
        if (best.exampleEn) break;
      }
      if (best?.exampleEn) break;
    }

    return {
      word: entry.word || normalized,
      phonetic: entry.phonetic || entry.phonetics?.find((p) => p.text)?.text || '',
      audio: entry.phonetics?.find((p) => p.audio)?.audio || '',
      ...(best || {})
    };
  };

  const lookupWord = async ({ term, context, url, title, targetLang }) => {
    const normalized = normalizeTerm(term);
    if (!normalized) throw new Error('EMPTY_LOOKUP_TERM');
    const key = `${normalized.toLowerCase()}|${targetLang || (await getSettings()).targetLang || DEFAULT_SETTINGS.targetLang}`;
    if (dictionaryCache.has(key)) {
      return { ...dictionaryCache.get(key), context: normalizeText(context || ''), url: url || '', title: title || '', lookedUpAt: new Date().toISOString() };
    }

    const dictionary = await fetchEnglishDictionary(normalized).catch(() => null);
    const image = await lookupWordImage(normalized, dictionary).catch(() => null);
    let meaningZh = '';
    try { meaningZh = await translateText({ text: normalized, sourceLang: 'auto', targetLang: targetLang || (await getSettings()).targetLang || DEFAULT_SETTINGS.targetLang }); } catch (_error) { meaningZh = ''; }
    let definitionZh = '';
    if (dictionary?.definitionEn) {
      try { definitionZh = await translateText({ text: dictionary.definitionEn, sourceLang: 'auto', targetLang: targetLang || (await getSettings()).targetLang || DEFAULT_SETTINGS.targetLang }); } catch (_error) { definitionZh = ''; }
    }
    let exampleZh = '';
    if (dictionary?.exampleEn) {
      try { exampleZh = await translateText({ text: dictionary.exampleEn, sourceLang: 'auto', targetLang: targetLang || (await getSettings()).targetLang || DEFAULT_SETTINGS.targetLang }); } catch (_error) { exampleZh = ''; }
    }

    const result = {
      term: normalized,
      word: dictionary?.word || normalized,
      phonetic: dictionary?.phonetic || '',
      audio: dictionary?.audio || '',
      partOfSpeech: dictionary?.partOfSpeech || '',
      definitionEn: dictionary?.definitionEn || '',
      definitionZh,
      exampleEn: dictionary?.exampleEn || '',
      exampleZh,
      meaningZh,
      image,
      context: normalizeText(context || ''),
      url: url || '',
      title: title || '',
      lookedUpAt: new Date().toISOString(),
      targetLang: targetLang || (await getSettings()).targetLang || DEFAULT_SETTINGS.targetLang
    };
    cacheSet(dictionaryCache, key, result);
    return result;
  };

  const addVocabulary = async (entry) => {
    const normalized = normalizeTerm(entry?.term || entry?.word || '').toLowerCase();
    if (!normalized) throw new Error('EMPTY_VOCAB_TERM');
    const stored = await storageGet({ ytbbiVocabulary: [] });
    const current = Array.isArray(stored.ytbbiVocabulary) ? stored.ytbbiVocabulary : [];
    const withoutDuplicate = current.filter((item) => normalizeTerm(item.term || item.word || '').toLowerCase() !== normalized);
    const item = {
      id: `${normalized}-${Date.now()}`,
      term: entry.term || entry.word || normalized,
      word: entry.word || entry.term || normalized,
      phonetic: entry.phonetic || '',
      partOfSpeech: entry.partOfSpeech || '',
      meaningZh: entry.meaningZh || '',
      image: entry.image || entry.visualImage || null,
      definitionEn: entry.definitionEn || '',
      definitionZh: entry.definitionZh || '',
      exampleEn: entry.exampleEn || '',
      exampleZh: entry.exampleZh || '',
      context: entry.context || '',
      url: entry.url || '',
      title: entry.title || '',
      addedAt: new Date().toISOString()
    };
    const next = [item, ...withoutDuplicate].slice(0, 1000);
    await storageSet({ ytbbiVocabulary: next });
    return { ok: true, item, count: next.length };
  };

  const getVocabulary = async () => {
    const stored = await storageGet({ ytbbiVocabulary: [] });
    const items = Array.isArray(stored.ytbbiVocabulary) ? stored.ytbbiVocabulary : [];
    return { items, count: items.length };
  };

  const removeVocabulary = async (id) => {
    const stored = await storageGet({ ytbbiVocabulary: [] });
    const current = Array.isArray(stored.ytbbiVocabulary) ? stored.ytbbiVocabulary : [];
    const next = current.filter((item) => item.id !== id);
    await storageSet({ ytbbiVocabulary: next });
    return { ok: true, count: next.length };
  };

  const clearVocabulary = async () => {
    await storageSet({ ytbbiVocabulary: [] });
    return { ok: true, count: 0 };
  };

  const flushPrefetchBatchQueue = async () => {
    prefetchBatchTimer = 0;
    const batch = prefetchBatchQueue.splice(0, prefetchBatchQueue.length);
    const groups = new Map();
    batch.forEach((item) => {
      const src = item.sourceLang || 'auto';
      const tgt = item.targetLang || DEFAULT_SETTINGS.targetLang;
      const key = `${src}|${tgt}`;
      if (!groups.has(key)) groups.set(key, { sourceLang: src, targetLang: tgt, items: [] });
      groups.get(key).items.push(item);
    });

    for (const groupData of groups.values()) {
      const items = groupData.items;
      const allTexts = Array.from(new Set(items.flatMap((item) => item.texts).map(normalizeText).filter(Boolean))).slice(0, 60);
      if (!allTexts.length) {
        items.forEach((item) => item.resolve({ ok: true, count: 0, results: [], mode: 'empty' }));
        continue;
      }

      try {
        const response = await translateBatch({ texts: allTexts, sourceLang: groupData.sourceLang, targetLang: groupData.targetLang });
        const resultMap = new Map((response.results || []).map((item) => [normalizeText(item.text), item]));
        items.forEach((item) => {
          const results = item.texts.map((text) => resultMap.get(normalizeText(text))).filter(Boolean);
          item.resolve({ ok: true, count: results.length, results, errors: response.errors || [], mode: `coalesced-${response.mode || 'batch'}` });
        });
      } catch (error) {
        items.forEach((item) => item.reject(error));
      }
    }
  };

  const prefetchTranslations = async ({ texts, sourceLang, targetLang }) => {
    const normalizedTexts = Array.from(new Set((texts || []).map(normalizeText).filter(Boolean))).slice(0, 60);
    const cacheKey = `${sourceLang || 'auto'}|${targetLang || DEFAULT_SETTINGS.targetLang}|${normalizedTexts.join('\n')}`;
    if (prefetchBatchInflight.has(cacheKey)) return prefetchBatchInflight.get(cacheKey);

    const promise = new Promise((resolve, reject) => {
      prefetchBatchQueue.push({ texts: normalizedTexts, sourceLang: sourceLang || 'auto', targetLang: targetLang || DEFAULT_SETTINGS.targetLang, resolve, reject });
      if (!prefetchBatchTimer) {
        prefetchBatchTimer = setTimeout(flushPrefetchBatchQueue, 180);
      }
    }).finally(() => prefetchBatchInflight.delete(cacheKey));

    prefetchBatchInflight.set(cacheKey, promise);
    return promise;
  };

  const handleMessage = async (message, sender) => {
    if (!message || typeof message !== 'object') return { ok: false, error: 'EMPTY_MESSAGE' };
    switch (message.type) {
      case 'YTBBI_TRANSLATE_TEXT': {
        const translatedText = await translateText({ text: message.text, sourceLang: message.sourceLang, targetLang: message.targetLang, force: !!message.force });
        return { ok: true, translatedText };
      }
      case 'YTBBI_PREFETCH_TRANSLATIONS': return prefetchTranslations({ texts: message.texts, sourceLang: message.sourceLang || 'auto', targetLang: message.targetLang || DEFAULT_SETTINGS.targetLang });
      case 'YTBBI_TRANSLATE_BATCH': return translateBatch({ texts: message.texts, sourceLang: message.sourceLang || 'auto', targetLang: message.targetLang || DEFAULT_SETTINGS.targetLang, force: !!message.force });
      case 'YTBBI_LOOKUP_WORD': {
        const settings = await getSettings();
        const result = await lookupWord({ term: message.term, context: message.context, url: message.url || sender?.tab?.url, title: message.title, targetLang: message.targetLang || settings.targetLang });
        return { ok: true, result };
      }
      case 'YTBBI_ADD_VOCAB': return addVocabulary(message.entry || {});
      case 'YTBBI_GET_VOCAB': return getVocabulary();
      case 'YTBBI_REMOVE_VOCAB': return removeVocabulary(message.id);
      case 'YTBBI_CLEAR_VOCAB': return clearVocabulary();
      case 'YTBBI_TEST_TRANSLATION': {
        const settings = await getSettings();
        const translatedText = await translateText({ text: message.text || 'Hello, this is a translation test.', sourceLang: 'auto', targetLang: message.targetLang || settings.targetLang || DEFAULT_SETTINGS.targetLang, force: true });
        return { ok: true, translatedText };
      }
      default: return { ok: false, error: `UNKNOWN_MESSAGE_TYPE:${message.type}` };
    }
  };

  EXT.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender)
      .then(sendResponse)
      .catch((error) => {
        console.warn(`[${EXT_NAME}]`, error);
        sendResponse({ ok: false, error: error.message || String(error) });
      });
    return true;
  });
})();
