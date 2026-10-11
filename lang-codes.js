// Shared language-code helpers for the background worker and content scripts.
// Every provider spells Chinese scripts differently; keeping the table in one
// place prevents Traditional/Simplified mix-ups when failover changes provider.
(function () {
  'use strict';

  const HANT_REGIONS = new Set(['tw', 'hk', 'mo', 'hant']);
  const HANS_REGIONS = new Set(['cn', 'sg', 'my', 'hans']);

  const normalizeCode = (code) => String(code || '').trim().replace(/_/g, '-');

  const baseLanguage = (code) => normalizeCode(code).split('-')[0].toLowerCase();

  // Returns 'hant', 'hans', or '' (unknown script / not Chinese).
  const chineseScript = (code) => {
    const parts = normalizeCode(code).toLowerCase().split('-');
    if (parts[0] !== 'zh') return '';
    for (const part of parts.slice(1)) {
      if (HANT_REGIONS.has(part)) return 'hant';
      if (HANS_REGIONS.has(part)) return 'hans';
    }
    return '';
  };

  // True when translating would only reproduce the same text. Chinese variants
  // are only "the same" when both scripts are known and equal, so a Simplified
  // video can still be converted for a Traditional Chinese reader.
  const isSameLanguage = (source, target) => {
    const src = baseLanguage(source);
    const tgt = baseLanguage(target);
    if (!src || !tgt || src === 'auto' || src !== tgt) return false;
    if (src !== 'zh') return true;
    const srcScript = chineseScript(source);
    return !!srcScript && srcScript === chineseScript(target);
  };

  // Per-provider target codes. Each entry may list fallbacks tried in order
  // (LibreTranslate renamed its Chinese codes in v1.6).
  const TABLE = {
    google: { 'zh-hant': ['zh-TW'], 'zh-hans': ['zh-CN'], 'pt-BR': ['pt'] },
    microsoft: { 'zh-hant': ['zh-Hant'], 'zh-hans': ['zh-Hans'], 'pt-BR': ['pt'] },
    lingva: { 'zh-hant': ['zh_HANT'], 'zh-hans': ['zh'], 'pt-BR': ['pt'] },
    libretranslate: { 'zh-hant': ['zh-Hant', 'zt'], 'zh-hans': ['zh-Hans', 'zh'], 'pt-BR': ['pt'] },
    mymemory: { 'zh-hant': ['zh-TW'], 'zh-hans': ['zh-CN'], 'pt-BR': ['pt-BR'] },
    // DeepL: uppercase codes; plain "EN"/"PT" are deprecated as targets.
    deepl: { 'zh-hant': ['ZH-HANT'], 'zh-hans': ['ZH-HANS'], 'pt-BR': ['PT-BR'], en: ['EN-US'] },
    // Firefox translation models (Remote Settings fromLang/toLang values).
    bergamot: { 'zh-hant': ['zh-Hant'], 'zh-hans': ['zh-Hans'], 'pt-BR': ['pt'] }
  };

  // Source-language spellings where they differ from the target table.
  const SOURCE_TABLE = {
    deepl: { 'zh-hant': ['ZH'], 'zh-hans': ['ZH'], 'pt-BR': ['PT'], en: ['EN'] }
  };

  const PROVIDER_FAMILY = {
    'google-free': 'google', 'google-dict': 'google', 'cloud-v2': 'google', 'cloud-v3-proxy': 'google',
    'microsoft-azure': 'microsoft', 'lingva': 'lingva', 'libretranslate': 'libretranslate', 'mymemory': 'mymemory',
    'deepl': 'deepl', 'bergamot': 'bergamot'
  };

  const tableKey = (code) => {
    const normalized = normalizeCode(code);
    if (baseLanguage(normalized) === 'zh') return chineseScript(normalized) === 'hans' ? 'zh-hans' : 'zh-hant';
    if (/^pt-br$/i.test(normalized)) return 'pt-BR';
    if (baseLanguage(normalized) === 'en') return 'en';
    return '';
  };

  // All acceptable spellings of `code` for `provider`, best first.
  const providerLanguageCandidates = (provider, code, role = 'target') => {
    const normalized = normalizeCode(code);
    if (!normalized || normalized === 'auto') return ['auto'];
    const family = PROVIDER_FAMILY[provider];
    if (!family) return [normalized];
    const key = tableKey(normalized);
    const table = (role === 'source' && SOURCE_TABLE[family]) || TABLE[family];
    if (key && table[key]) return table[key].slice();
    if (key && TABLE[family][key]) return TABLE[family][key].slice();
    const base = baseLanguage(normalized);
    return [family === 'deepl' ? base.toUpperCase() : base];
  };

  const providerLanguage = (provider, code, role = 'target') => providerLanguageCandidates(provider, code, role)[0];

  // Used only where a provider cannot auto-detect (MyMemory). Decides by the
  // dominant script instead of "any Latin letter means English".
  const guessLanguageFromText = (text) => {
    const value = String(text || '');
    const count = (re) => (value.match(re) || []).length;
    const kana = count(/[぀-ヿ]/g);
    const hangul = count(/[가-힯]/g);
    const han = count(/[㐀-鿿]/g);
    const latin = count(/[A-Za-z]/g);
    if (kana) return 'ja';
    if (hangul > Math.max(han, latin / 3)) return 'ko';
    if (han && han >= latin / 3) return 'zh-CN';
    return 'en';
  };

  globalThis.YTBBI_LANG = Object.freeze({
    normalizeCode, baseLanguage, chineseScript, isSameLanguage,
    providerLanguage, providerLanguageCandidates, guessLanguageFromText
  });
})();
