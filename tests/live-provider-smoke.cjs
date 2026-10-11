'use strict';
// Optional manual check against the real free endpoints (not run in CI):
//   node tests/live-provider-smoke.cjs
// Verifies each provider returns the requested Chinese script. Network results
// vary by region and rate limits, so failures here are informative, not fatal.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repo = path.resolve(__dirname, '..');
const quiet = { log() {}, warn() {}, error() {} };
const context = vm.createContext({
  browser: {
    storage: { local: { get: async (defaults) => ({ ...(defaults || {}) }), set: async () => {} } },
    runtime: { onInstalled: { addListener() {} }, onMessage: { addListener() {} }, getURL: (x) => x },
    tabs: { create: async () => {} }
  },
  console: quiet, fetch, AbortController, URL, URLSearchParams, setTimeout, clearTimeout, btoa, Date
});
vm.runInContext(fs.readFileSync(path.join(repo, 'lang-codes.js'), 'utf8'), context);
let source = fs.readFileSync(path.join(repo, 'background.js'), 'utf8');
source = source.replace(/\}\)\(\);\s*$/, 'globalThis.smoke = { callProvider, callProviderBatch }; })();');
vm.runInContext(source, context);

// Characters that differ between the scripts: 這/这, 們/们, 嗎/吗, 來/来, 說/说, 會/会, 個/个, 時/时, 間/间, 對/对.
const TRAD = /[這們嗎來說會個時間對麼裡]/;
const SIMP = /[这们吗来说会个时间对么里]/;
const script = (text) => (TRAD.test(text) && !SIMP.test(text) ? 'Traditional' : SIMP.test(text) && !TRAD.test(text) ? 'Simplified' : 'unclear');

(async () => {
  const text = 'Are you coming to the meeting this time? We will talk about it there.';
  const settings = { libreTranslateUrl: 'https://libretranslate.com', lingvaInstanceUrl: 'https://lingva.ml' };
  for (const provider of ['google-free', 'google-dict', 'lingva', 'mymemory']) {
    for (const targetLang of ['zh-TW', 'zh-CN']) {
      try {
        const out = await context.smoke.callProvider(provider, { text, sourceLang: 'auto', targetLang, settings, priority: 1 });
        const got = script(out);
        const want = targetLang === 'zh-TW' ? 'Traditional' : 'Simplified';
        console.log(`${got === want ? 'OK  ' : 'WARN'} ${provider.padEnd(15)} ${targetLang}  ${got.padEnd(11)} ${out}`);
      } catch (error) {
        console.log(`SKIP ${provider.padEnd(15)} ${targetLang}  ${String(error.message || error).slice(0, 100)}`);
      }
    }
  }
  // Prefetch batches on endpoints without a batch API rely on framed markers.
  const lines = ['I think that we should go home now.', 'The meeting starts at nine.', 'Did you bring the documents?',
    'Mr. Smith will join us later.', 'This is the last item.', 'Thanks for watching!'];
  for (const provider of ['google-free', 'google-dict']) {
    try {
      const out = await context.smoke.callProviderBatch(provider, { texts: lines, sourceLang: 'auto', targetLang: 'zh-TW', settings, priority: 0 });
      console.log(`OK   ${provider.padEnd(15)} batch of ${lines.length} kept markers: ${Array.from(out).join(' | ')}`);
    } catch (error) {
      console.log(`WARN ${provider.padEnd(15)} batch: ${String(error.message || error).slice(0, 120)}`);
    }
  }
})();
