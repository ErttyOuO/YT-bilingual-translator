'use strict';
// Regression tests execute extension code with fake clocks and network services.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const repo = process.argv[2] || path.resolve(__dirname, '..');
const results = [];
const quiet = { log() {}, warn() {}, error() {} };
const pump = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; };
class Clock {
  constructor() { this.time = 1000000; this.seq = 0; this.timers = new Map(); }
  setTimeout(fn, delay = 0) { const id = ++this.seq; this.timers.set(id, { fn, at: this.time + delay }); return id; }
  clearTimeout(id) { this.timers.delete(id); }
  async advance(ms) {
    const end = this.time + ms;
    await pump();
    while (true) {
      const next = [...this.timers].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      this.time = next[1].at; this.timers.delete(next[0]); next[1].fn(); await pump();
    }
    this.time = end; await pump();
  }
}
function makeContext(settings = {}) {
  const clock = new Clock();
  class FakeDate extends Date { static now() { return clock.time; } }
  const mock = { currentMs: 500, rate: 1, overlays: [], hides: 0, sends: 0, visibleText: '' };
  const browser = {
    storage: { local: { get: async defaults => ({ ...defaults, ...settings }), set: async () => {} } },
    runtime: { onInstalled: { addListener() {} }, onMessage: { addListener() {} },
      sendMessage: async () => { mock.sends++; return mock.response || { ok: false, error: 'mock failure' }; }, getURL: x => x },
    tabs: { create: async () => {} }
  };
  const context = vm.createContext({ browser, console: quiet, Date: FakeDate, AbortController,
    URL, URLSearchParams, setTimeout: clock.setTimeout.bind(clock), clearTimeout: clock.clearTimeout.bind(clock),
    setInterval: () => 0, clearInterval() {}, location: { href: 'https://www.youtube.com/watch?v=video-a', hostname: 'www.youtube.com', pathname: '/watch' },
    document: {}, window: {}, mock,
    fetch: async () => { throw new Error('Unexpected network call: real network disabled'); }
  });
  return { context, clock, mock };
}
function background(settings = {}) {
  const env = makeContext(settings);
  for (const file of ['lang-codes.js', 'bergamot-engine.js']) vm.runInContext(fs.readFileSync(path.join(repo, file), 'utf8'), env.context, { filename: file });
  let source = fs.readFileSync(path.join(repo, 'background.js'), 'utf8');
  for (const name of ['translateBatchUsingProviders', 'translateUsingProviders']) source = source.replace(`const ${name} =`, `let ${name} =`);
  source = source.replace(/\}\)\(\);\s*$/, `globalThis.audit = { fetchWithTimeout, providerQueues, getProviderState, translateBatch, translateText,
    inflightTranslate, translateCache, makeTranslateCacheKey, callGeminiGenerateContent, translationJobs, cancelObsoletePrefetch, getSettings,
    acquireProviderSlot, callProvider, translateBatchUsingProviders, markerUnreliableUntil, getProviderState,
    getProviderOrder, resolveSourceLang,
    setBatch(fn) { translateBatchUsingProviders = fn; }, setSingle(fn) { translateUsingProviders = fn; } }; })();`);
  vm.runInContext(source, env.context, { filename: 'background.js' });
  env.api = env.context.audit;
  return env;
}
function content(options = {}) {
  const env = makeContext();
  vm.runInContext(fs.readFileSync(path.join(repo, 'lang-codes.js'), 'utf8'), env.context, { filename: 'lang-codes.js' });
  let source = fs.readFileSync(path.join(repo, 'content.js'), 'utf8');
  const stubs = {
    isSupportedVideoPage: '() => true', syncActiveVideoContext: '() => false', getVideoId: "() => 'video-a'",
    shouldBlockOverlayBecauseNativeCaptionsOff: '() => false', isVideoPaused: '() => false',
    getVideoCurrentMs: '() => mock.currentMs', getVideoElement: '() => ({ playbackRate: mock.rate })',
    getVisibleCaptionText: '() => mock.visibleText', ensureTranscriptForCurrentVideo: 'async () => {}',
    scheduleUpcomingPrefetch: '() => {}', showOverlay: '(value) => mock.overlays.push(value)',
    hideOverlay: '() => { mock.hides++; }'
  };
  if (options.transcript) {
    delete stubs.ensureTranscriptForCurrentVideo;
    stubs.getCaptionTracks = '() => [mock.track]';
    stubs.chooseCaptionTrack = '() => mock.track';
  }
  if (options.prefetch) delete stubs.scheduleUpcomingPrefetch;
  for (const name of Object.keys(stubs)) source = source.replace(`const ${name} =`, `let ${name} =`);
  const assignments = Object.entries(stubs).map(([k,v]) => `${k} = ${v};`).join('\n');
  source = source.replace(/  init\(\);\s*\}\)\(\);\s*$/, `${assignments}\n globalThis.audit = { state, handleCaptionChange, settlePrefetchResponse,
    makeDisplayTranslationKey, getAdaptivePrefetchAheadMs, getStabilizedVisibleCaption, ensureTranscriptForCurrentVideo,
    resetTranscriptState, invalidateUpcomingPrefetch, installVideoEventListeners, onSettingsChanged, scheduleCaptionRead, scheduleUpcomingPrefetch,
    mergeManualCues, normalizeTranscriptCueWindows, joinTimedCaptionText, endsWithSegmentBoundary, buildStableSegmentsFromTokens,
    setVideo(video) { getVideoElement = () => video; } }; })();`);
  vm.runInContext(source, env.context, { filename: 'content.js' });
  env.api = env.context.audit;
  const s = env.api.state;
  s.transcriptVideoId = 'video-a';
  s.transcriptCues = [{ startMs: 0, endMs: 1000, text: 'Hello there.', key: '0|Hello there.' }];
  return env;
}
async function test(id, fn) {
  try { const evidence = await fn(); results.push({ id, passed: true, evidence }); }
  catch (error) { results.push({ id, passed: false, error: error.stack }); process.exitCode = 1; }
}
function twitch() {
  const env = makeContext();
  let source = fs.readFileSync(path.join(repo, 'twitch-content.js'), 'utf8');
  const stubs = {
    showOverlay: '(value) => mock.overlays.push(value)', applySettingsToDom: '() => {}',
    updatePlayerToggleState: '() => {}', syncContext: '() => {}'
  };
  for (const name of Object.keys(stubs)) source = source.replace(`const ${name} =`, `let ${name} =`);
  source = source.replace(/  init\(\)\.catch\([^\n]+\);\s*\}\)\(\);\s*$/,
    `${Object.entries(stubs).map(([name, fn]) => `${name} = ${fn};`).join('\n')}
    globalThis.audit = { state, flushPendingCaption, onSettingsChanged }; })();`);
  vm.runInContext(source, env.context, { filename: 'twitch-content.js' });
  env.api = env.context.audit;
  return env;
}
// With a fake clock, a never-settling promise empties the event loop and Node
// would exit 0 without a report. Treat an unfinished run as a failure.
let runFinished = false;
process.on('exit', () => {
  if (!runFinished) { console.error('Regression run did not finish (a test never settled).'); process.exitCode = 1; }
});
(async () => {
  await test('network_timeout_starts_after_dequeue', async () => {
    const e = background(), calls = [];
    // Occupy every slot of the gate (gemini:* allows 4 concurrent requests).
    const releases = [];
    for (let i = 0; i < 4; i++) {
      // Starts are spaced by the provider delay (80 ms for Gemini).
      const slot = e.api.acquireProviderSlot('gemini:mock', 0); await e.clock.advance(100); releases.push(await slot);
    }
    e.context.fetch = async (_url, options) => {
      calls.push({ at: e.clock.time, alreadyAborted: options.signal.aborted });
      if (options.signal.aborted) { const err = new Error('aborted before start'); err.name = 'AbortError'; throw err; }
      return { ok: true, text: async () => '{}' };
    };
    const p = e.api.fetchWithTimeout('gemini:mock', 'https://mock.invalid').then(() => 'ok', x => x.message);
    await e.clock.advance(16000); assert.equal(calls.length, 0);
    releases[0](); await pump(); const outcome = await p;
    assert.equal(calls[0].alreadyAborted, false); assert.equal(outcome, 'ok');
    return { queuedMs: 16000, fetchEnteredWithAbortedSignal: false, outcome };
  });
  await test('network_timeout_includes_response_body', async () => {
    const e = background(), body = deferred();
    e.context.fetch = async () => ({ ok: true, text: () => body.promise });
    let settled = false;
    const p = e.api.callGeminiGenerateContent({ apiKey: 'AQ.mock-key', model: 'gemini-mock', payload: {} }).then(
      () => { settled = true; return 'unexpected success'; }, error => { settled = true; return error.message; });
    await pump(); await e.clock.advance(15000); assert.equal(settled, true); assert.match(await p, /timeout/);
    return { timeoutMs: 15000, timedOut: true };
  });
  await test('successful_fallback_item_delivered_before_slow_sibling', async () => {
    const e = background(), slow = deferred(), alpha = deferred();
    e.api.setBatch(async () => { throw new Error('mock batch failure'); });
    e.api.setSingle(async ({ normalized }) => normalized === 'alpha' ? alpha.promise : slow.promise);
    const p = e.api.translateBatch({ texts: ['alpha', 'beta'], sourceLang: 'en', targetLang: 'zh-TW' });
    await pump();
    const key = e.api.makeTranslateCacheKey('en', 'zh-TW', 'alpha');
    let itemDelivered = false;
    e.api.inflightTranslate.get(key).then(() => { itemDelivered = true; });
    alpha.resolve('甲'); await pump(); assert.equal(itemDelivered, true); assert.equal(e.api.translateCache.get(key), '甲');
    slow.resolve('乙'); await pump(); await p;
    return { alphaDeliveredBeforeBetaCompletes: true };
  });
  await test('foreground_promotes_reserved_prefetch_without_duplicate_call', async () => {
    const e = background(), first = deferred(), calls = [], texts = Array.from({ length: 10 }, (_, i) => `sentence ${i}`);
    e.api.setBatch(async ({ texts: group }) => {
      calls.push({ kind: 'batch', texts: [...group] });
      if (calls.filter(x => x.kind === 'batch').length === 1) await first.promise;
      return { provider: 'mock', translated: group.map(t => `譯:${t}`) };
    });
    e.api.setSingle(async ({ normalized }) => { calls.push({ kind: 'single', texts: [normalized] }); return `譯:${normalized}`; });
    const p = e.api.translateBatch({ texts, sourceLang: 'en', targetLang: 'zh-TW', priority: 0 }); await pump();
    assert.equal(calls.length, 1);
    await e.api.translateText({ text: texts[8], sourceLang: 'en', targetLang: 'zh-TW' });
    assert.equal(calls.length, 2); assert.equal(calls[1].kind, 'batch');
    first.resolve(); await pump(); await e.clock.advance(240); await p;
    const count = calls.filter(x => x.texts.includes(texts[8])).length;
    assert.equal(count, 1);
    return { ninthItemProviderCalls: count, calls };
  });
  await test('new_missing_item_starts_without_waiting_for_unrelated_inflight', async () => {
    const e = background(), old = deferred(); let newCalls = 0;
    await e.api.getSettings();
    e.api.inflightTranslate.set(e.api.makeTranslateCacheKey('en', 'zh-TW', 'old sentence'), old.promise);
    e.api.setSingle(async () => { newCalls++; return '新句翻譯'; });
    const p = e.api.translateBatch({ texts: ['old sentence', 'new sentence'], sourceLang: 'en', targetLang: 'zh-TW' });
    await pump(); assert.equal(newCalls, 1); old.resolve('舊句翻譯'); await p;
    return { newItemStartedBeforeOldResolved: true };
  });
  await test('semantic_cache_keys_preserve_meaning', async () => {
    const b = background(), c = content();
    const pairs = [["I'll", 'ill'], ['US', 'us'], ['1.0', '10'], ['re-sign', 'resign']];
    for (const [a,z] of pairs) {
      assert.notEqual(b.api.makeTranslateCacheKey('auto','zh-TW',a), b.api.makeTranslateCacheKey('auto','zh-TW',z));
      assert.notEqual(c.api.makeDisplayTranslationKey(a), c.api.makeDisplayTranslationKey(z));
    }
    return { distinctPairs: pairs, layers: ['background', 'content'] };
  });
  await test('same_caption_recovers_after_one_failed_request', async () => {
    const e = content(); e.api.handleCaptionChange(); await pump();
    for (let i = 0; i < 10; i++) { e.api.handleCaptionChange(); await pump(); }
    assert.equal(e.mock.sends, 1);
    assert.match(e.mock.overlays.at(-1).status, /mock failure/);
    e.mock.response = { ok: true, translatedText: '你好。' };
    await e.clock.advance(1500); assert.equal(e.mock.sends, 2); assert.equal(e.mock.overlays.at(-1).translation, '你好。');
    return { initialCaptionReads: 11, translateRequests: e.mock.sends, recovered: true };
  });
  await test('prefetch_recovery_updates_unchanged_caption', async () => {
    const e = content(); e.api.handleCaptionChange(); await pump();
    const renders = e.mock.overlays.length;
    e.api.settlePrefetchResponse(e.api.state.transcriptCues, { results: [{ text: 'Hello there.', translatedText: '你好。' }] });
    e.api.handleCaptionChange(); await pump();
    assert.equal(e.mock.overlays.length, renders + 1); assert.equal(e.mock.overlays.at(-1).translation, '你好。');
    return { recoveredTranslationRendered: true };
  });
  await test('late_translation_cannot_resurrect_caption_in_gap', async () => {
    const e = content(), pending = deferred();
    e.context.browser.runtime.sendMessage = async () => pending.promise;
    e.api.handleCaptionChange(); await pump();
    e.mock.currentMs = 2000; e.api.handleCaptionChange(); await pump(); assert.ok(e.mock.hides > 0);
    pending.resolve({ ok: true, translatedText: '遲到的譯文' }); await pump();
    assert.equal(e.api.state.lastCaptionText, ''); assert.equal(e.mock.overlays.some(x => x.translation === '遲到的譯文'), false);
    return { noActiveCue: true, staleReplyShownAfterGap: false };
  });
  await test('AQ_key_preserved_in_native_Gemini_header', async () => {
    const e = background(); let captured;
    e.context.fetch = async (url, options) => { captured = { url, header: options.headers['x-goog-api-key'], bearer: options.headers.Authorization || null }; return { ok: true, text: async () => JSON.stringify({ candidates: [] }) }; };
    await e.api.callGeminiGenerateContent({ apiKey: 'AQ.mock-key', model: 'gemini-mock', payload: {} });
    assert.equal(captured.header, 'AQ.mock-key'); assert.equal(captured.bearer, null); assert.match(captured.url, /generativelanguage\.googleapis\.com/);
    return { nativeEndpoint: true, prefixPreserved: true, xGoogApiKeyUsed: true, bearerUsed: false, realKeyOrApiCall: false };
  });
  await test('DOM_fallback_wait_is_bounded_and_rate_aware', async () => {
    const waits = [];
    for (const rate of [1, 1.5, 2]) {
    const e = content(); e.api.state.transcriptCues = [];
    e.mock.rate = rate; e.mock.visibleText = 'hello there'; e.api.handleCaptionChange();
    const waitMs = 2500 / rate;
    await e.clock.advance(waitMs - 1); assert.equal(e.mock.sends, 0);
    await e.clock.advance(181); assert.equal(e.mock.sends, 1);
    waits.push({ rate, maxBufferMs: Math.ceil(waitMs + 180) });
    }
    return { waits };
  });
  await test('source_change_invalidates_previous_provider_cache', async () => {
    const settings = { translationProvider: 'google-free' }, e = background(settings); let calls = 0;
    e.api.setSingle(async ({ settings }) => { calls++; return `provider:${settings.translationProvider}`; });
    const args = { text: 'provider switch example', sourceLang: 'en', targetLang: 'zh-TW' };
    const first = await e.api.translateText(args); settings.translationProvider = 'gemini';
    // Override storage so subsequent settings reads reflect an actual provider switch.
    e.context.browser.storage.local.get = async defaults => ({ ...defaults, ...settings });
    const second = await e.api.translateText(args); assert.notEqual(second, first); assert.equal(calls, 2);
    return { firstProvider: 'google-free', selectedProviderAfterSwitch: 'gemini', secondResultStillFromFirstProvider: false };
  });
  await test('display_retries_stop_after_two_retries', async () => {
    const e = content(); e.api.handleCaptionChange(); await pump();
    await e.clock.advance(20000); assert.equal(e.mock.sends, 3);
    for (let i = 0; i < 5; i++) e.api.handleCaptionChange();
    await e.clock.advance(20000); assert.equal(e.mock.sends, 3);
    return { initialRequestPlusRetries: 3 };
  });
  await test('retry_does_not_translate_expired_cue', async () => {
    const e = content(); e.api.handleCaptionChange(); await pump();
    e.mock.currentMs = 2000; await e.clock.advance(1500); assert.equal(e.mock.sends, 1);
    return { expiredCueRetried: false };
  });
  await test('batch_failure_cleans_every_reservation', async () => {
    const e = background();
    e.api.setBatch(async () => { throw new Error('batch failed'); });
    e.api.setSingle(async () => { throw new Error('single failed'); });
    const result = await e.api.translateBatch({ texts: ['first failed sentence', 'second failed sentence'] });
    assert.equal(result.errors.length, 2); assert.equal(e.api.inflightTranslate.size, 0);
    return { errors: result.errors.length, reservationsLeft: 0 };
  });
  await test('seek_cancels_queued_prefetch_and_keeps_shared_consumers', async () => {
    const e = background(), first = deferred(), calls = [], texts = Array.from({ length: 24 }, (_, i) => `old subtitle ${i}`);
    e.api.setBatch(async ({ texts: group }) => { calls.push([...group]); if (calls.length === 1) await first.promise; return { provider: 'mock', translated: group.map(x => `譯:${x}`) }; });
    const p = e.api.translateBatch({ texts, priority: 0, owners: ['tab:1|old'] }); await pump();
    // Another tab still needs the final batch; cancelling tab 1 must keep it.
    const shared = e.api.translateBatch({ texts: texts.slice(16), priority: 0, owners: ['tab:2|same'] }); await pump();
    e.api.cancelObsoletePrefetch(1, 'new'); await pump();
    first.resolve(); const result = await p; await shared;
    assert.equal(result.errors.length, 8); assert.equal(calls.length, 2);
    assert.equal(calls.some(group => group.includes(texts[8])), false);
    return { obsoleteBatchCancelled: true, otherTabPreserved: true };
  });
  await test('same_language_track_change_refetches_transcript', async () => {
    const e = content({ transcript: true }); e.api.state.transcriptCues = [];
    const urls = [];
    e.mock.track = { baseUrl: 'https://www.youtube.com/api/timedtext?v=video-a&lang=en&name=first', languageCode: 'en', vssId: 'manual-first' };
    e.context.fetch = async url => { urls.push(url); return { ok: true, json: async () => ({ events: [{ tStartMs: 0, dDurationMs: 3000, segs: [{ utf8: urls.length === 1 ? 'First track.' : 'Second track.' }] }] }) }; };
    await e.api.ensureTranscriptForCurrentVideo('hello');
    e.mock.track = { ...e.mock.track, baseUrl: 'https://www.youtube.com/api/timedtext?v=video-a&lang=en&name=second', vssId: 'manual-second' };
    await e.api.ensureTranscriptForCurrentVideo('hello');
    assert.equal(urls.length, 2); assert.equal(e.api.state.transcriptCues[0].text, 'Second track.');
    return { sameLanguageTrackFetches: urls.length };
  });
  await test('stalled_transcript_fetch_times_out_and_can_retry', async () => {
    const e = content({ transcript: true }); e.api.state.transcriptCues = [];
    e.mock.track = { baseUrl: 'https://www.youtube.com/api/timedtext?v=video-a&lang=en', languageCode: 'en' };
    let calls = 0; e.context.fetch = async () => { calls++; return new Promise(() => {}); };
    const p = e.api.ensureTranscriptForCurrentVideo('hello'); await pump(); await e.clock.advance(8000); await p;
    assert.equal(e.api.state.transcriptLoadingKey, '');
    await e.api.ensureTranscriptForCurrentVideo('hello'); assert.equal(calls, 1);
    await e.clock.advance(3000);
    e.context.fetch = async () => { calls++; return { ok: true, json: async () => ({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Recovered.' }] }] }) }; };
    await e.api.ensureTranscriptForCurrentVideo('hello'); assert.equal(calls, 2); assert.equal(e.api.state.transcriptCues[0].text, 'Recovered.');
    return { timeoutMs: 8000, retriesAfterCooldown: true };
  });
  await test('old_settings_response_cannot_poison_new_display_cache', async () => {
    const e = content(), pending = deferred(); e.context.browser.runtime.sendMessage = async () => pending.promise;
    e.api.handleCaptionChange(); await pump();
    e.api.state.settings = { ...e.api.state.settings, targetLang: 'ja' };
    e.api.state.requestSeq++; e.api.state.displayTranslationCache.clear();
    pending.resolve({ ok: true, translatedText: '舊目標語言' }); await pump();
    assert.equal(e.api.state.displayTranslationCache.size, 0);
    assert.equal(e.mock.overlays.some(x => x.translation === '舊目標語言'), false);
    return { oldResponseCachedOrRendered: false };
  });
  await test('seek_invalidates_visible_request_before_next_caption_read', async () => {
    const e = content(), pending = deferred(); const handlers = {};
    e.context.browser.runtime.sendMessage = async message => message.type === 'YTBBI_TRANSLATE_TEXT' ? pending.promise : { ok: true };
    const video = { playbackRate: 2, addEventListener: (name, handler) => { handlers[name] = handler; } };
    // The installed listener uses the same video getter as the timeline tests.
    e.context.mock.video = video;
    // Inject a getter override only in the isolated VM.
    e.api.setVideo(video); e.api.installVideoEventListeners(); e.api.handleCaptionChange(); await pump();
    handlers.seeking({ type: 'seeking' }); pending.resolve({ ok: true, translatedText: 'seek 前譯文' }); await pump();
    assert.equal(e.mock.overlays.some(x => x.translation === 'seek 前譯文'), false);
    return { oldReplyRenderedDuringSeek: false };
  });
  await test('continuous_caption_events_do_not_starve_display_reads', async () => {
    const e = content();
    for (let i = 0; i < 20; i++) { e.api.scheduleCaptionRead(); await e.clock.advance(20); }
    assert.equal(e.mock.sends, 1); assert.ok(e.mock.overlays.length > 0);
    return { continuousEventIntervalMs: 20, subtitleWasRead: true };
  });
  await test('continuous_timeupdate_events_do_not_starve_prefetch', async () => {
    const e = content({ prefetch: true });
    for (let i = 0; i < 20; i++) { e.api.scheduleUpcomingPrefetch('Hello there.'); await e.clock.advance(20); }
    assert.ok(e.mock.sends > 0);
    return { continuousEventIntervalMs: 20, prefetchStarted: true };
  });
  await test('Twitch_language_change_retranslates_and_ignores_old_reply', async () => {
    const e = twitch(), old = deferred(), current = deferred(), requests = [];
    e.context.browser.runtime.sendMessage = async message => {
      requests.push(message);
      return requests.length === 1 ? old.promise : current.promise;
    };
    e.api.state.pendingText = 'Same caption.'; e.api.flushPendingCaption(); await pump();
    e.context.browser.storage.local.get = async defaults => ({ ...defaults, targetLang: 'ja' });
    await e.api.onSettingsChanged(); await pump();
    assert.equal(requests.length, 2); assert.equal(requests[1].targetLang, 'ja');
    old.resolve({ ok: true, translatedText: '舊語言譯文' }); await pump();
    assert.equal(e.api.state.translationCache.size, 0);
    assert.equal(e.mock.overlays.some(x => x.translation === '舊語言譯文'), false);
    current.resolve({ ok: true, translatedText: '新しい翻訳' }); await pump();
    assert.equal(e.mock.overlays.at(-1).translation, '新しい翻訳');
    return { currentCaptionRetranslated: true, oldLanguageReplyRenderedOrCached: false };
  });
  await test('Twitch_old_failure_does_not_overwrite_new_translation', async () => {
    const e = twitch(), old = deferred(); let calls = 0;
    e.context.browser.runtime.sendMessage = async () => ++calls === 1 ? old.promise : { ok: true, translatedText: '新しい翻訳' };
    e.api.state.pendingText = 'Same caption.'; e.api.flushPendingCaption(); await pump();
    e.context.browser.storage.local.get = async defaults => ({ ...defaults, targetLang: 'ja' });
    await e.api.onSettingsChanged(); await pump();
    old.reject(new Error('Old provider failed')); await pump();
    assert.equal(e.mock.overlays.at(-1).translation, '新しい翻訳');
    return { staleFailureOverwroteCurrentTranslation: false };
  });
  // ---- v0.60 translation-core regressions -----------------------------------
  await test('provider_language_codes_keep_chinese_script', async () => {
    const e = background(), L = e.context.YTBBI_LANG;
    assert.equal(L.providerLanguage('microsoft-azure', 'zh-TW'), 'zh-Hant');
    assert.equal(L.providerLanguage('microsoft-azure', 'zh-CN'), 'zh-Hans');
    assert.equal(L.providerLanguage('deepl', 'zh-TW'), 'ZH-HANT');
    assert.equal(L.providerLanguage('deepl', 'zh-CN'), 'ZH-HANS');
    assert.equal(L.providerLanguage('deepl', 'en'), 'EN-US');
    assert.equal(L.providerLanguage('deepl', 'en', 'source'), 'EN');
    assert.equal(L.providerLanguage('bergamot', 'zh-TW'), 'zh-Hant');
    assert.equal(L.providerLanguage('bergamot', 'zh-CN'), 'zh-Hans');
    assert.equal(L.providerLanguage('lingva', 'zh-TW'), 'zh_HANT');
    assert.equal(L.providerLanguage('lingva', 'zh-CN'), 'zh');
    assert.deepEqual([...L.providerLanguageCandidates('libretranslate', 'zh-TW')], ['zh-Hant', 'zt']);
    assert.equal(L.providerLanguage('mymemory', 'zh-CN'), 'zh-CN');
    assert.equal(L.providerLanguage('google-free', 'zh-TW'), 'zh-TW');
    assert.equal(L.providerLanguage('google-free', 'pt-BR'), 'pt');
    assert.equal(L.isSameLanguage('en', 'en'), true);
    assert.equal(L.isSameLanguage('zh-Hant', 'zh-TW'), true);
    assert.equal(L.isSameLanguage('zh-Hans', 'zh-TW'), false);
    assert.equal(L.isSameLanguage('zh', 'zh-TW'), false);
    assert.equal(L.guessLanguageFromText('這是 iPhone 的新功能'), 'zh-CN');
    return { simplifiedNeverMappedToTraditional: true, traditionalNeverMappedToSimplified: true };
  });
  await test('foreground_request_jumps_ahead_of_queued_prefetch', async () => {
    const e = background(), order = [];
    const r1 = await e.api.acquireProviderSlot('google-free', 0);
    const p2 = e.api.acquireProviderSlot('google-free', 0); await e.clock.advance(700); const r2 = await p2;
    e.context.fetch = async (url) => { order.push(url); return { ok: true, status: 200, text: async () => '[]' }; };
    const prefetch = e.api.fetchWithTimeout('google-free', 'prefetch', {}, 0);
    const foreground = e.api.fetchWithTimeout('google-free', 'foreground', {}, 1);
    r1(); await e.clock.advance(700); r2(); await e.clock.advance(700);
    await Promise.all([prefetch, foreground]);
    assert.deepEqual(order, ['foreground', 'prefetch']);
    return { order };
  });
  await test('mymemory_quota_warning_is_rejected_not_cached', async () => {
    const e = background(); let requested = '';
    e.context.fetch = async (url) => { requested = url; return { ok: true, status: 200, text: async () => JSON.stringify({
      responseStatus: 429, responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY.' } }) }; };
    const outcome = await e.api.callProvider('mymemory', { text: 'Hello world', sourceLang: 'auto', targetLang: 'zh-TW', settings: {}, priority: 1 })
      .then(() => null, (error) => error);
    assert.ok(outcome); assert.equal(outcome.status, 429);
    assert.match(decodeURIComponent(requested), /langpair=en\|zh-TW/);
    return { warningShownAsSubtitle: false, status: outcome.status };
  });
  await test('azure_translator_uses_user_key_region_and_plain_text', async () => {
    const e = background(); let captured;
    e.context.fetch = async (url, options) => { captured = { url, headers: options.headers };
      return { ok: true, status: 200, text: async () => JSON.stringify([{ translations: [{ text: '你好 & <3' }] }]) }; };
    const out = await e.api.callProvider('microsoft-azure', { text: 'Hello & <3', sourceLang: 'auto', targetLang: 'zh-CN',
      settings: { azureTranslatorKey: 'key-123', azureTranslatorRegion: 'eastasia' }, priority: 1 });
    assert.equal(out, '你好 & <3');
    assert.match(captured.url, /^https:\/\/api\.cognitive\.microsofttranslator\.com\/translate\?/);
    assert.match(captured.url, /to=zh-Hans/); assert.match(captured.url, /textType=plain/);
    assert.equal(captured.headers['Ocp-Apim-Subscription-Key'], 'key-123');
    assert.equal(captured.headers['Ocp-Apim-Subscription-Region'], 'eastasia');
    const missing = await e.api.callProvider('microsoft-azure', { text: 'x', targetLang: 'zh-TW', settings: {}, priority: 1 }).then(() => null, (x) => x.message);
    assert.equal(missing, 'NO_AZURE_TRANSLATOR_KEY');
    return { endpoint: 'api.cognitive.microsofttranslator.com', regionHeader: true };
  });
  await test('deepl_uses_free_host_auth_header_and_traditional_code', async () => {
    const e = background(); const calls = [];
    e.context.fetch = async (url, options) => { calls.push({ url, auth: options.headers.Authorization, body: JSON.parse(options.body) });
      if (calls.length === 2) return { ok: false, status: 456, text: async () => '{"message":"Quota exceeded"}' };
      return { ok: true, status: 200, text: async () => JSON.stringify({ translations: [{ text: '我們走吧' }, { text: '好' }] }) }; };
    const settings = { deeplApiKey: 'abc:fx' };
    const out = await e.api.translateBatchUsingProviders({ texts: ['Let us go', 'OK'], sourceLang: 'auto', targetLang: 'zh-TW',
      settings: { ...settings, translationProvider: 'deepl', autoFailover: false }, priority: 0 });
    assert.deepEqual(Array.from(out.translated), ['我們走吧', '好']);
    assert.equal(calls[0].url, 'https://api-free.deepl.com/v2/translate');
    assert.equal(calls[0].auth, 'DeepL-Auth-Key abc:fx');
    assert.equal(calls[0].body.target_lang, 'ZH-HANT'); assert.equal(calls[0].body.source_lang, undefined);
    await e.clock.advance(200);
    const quota = await e.api.callProvider('deepl', { text: 'x', sourceLang: 'en', targetLang: 'zh-TW', settings, priority: 1 }).then(() => null, (x) => x);
    assert.equal(quota.message, 'DEEPL_QUOTA_EXCEEDED'); assert.equal(quota.status, 429); assert.equal(calls[1].body.source_lang, 'EN');
    return { nativeBatch: true, quotaMappedToRateLimit: true };
  });
  await test('key_free_order_drops_microsoft_edge', async () => {
    const e = background(), order = (settings) => Array.from(e.api.getProviderOrder(settings));
    assert.deepEqual(order({ translationProvider: 'auto-free' }), ['google-free', 'google-dict', 'mymemory']);
    assert.deepEqual(order({ translationProvider: 'deepl' }), ['deepl', 'google-free', 'google-dict', 'mymemory']);
    assert.deepEqual(order({ translationProvider: 'deepl', autoFailover: false }), ['deepl']);
    // Local translation never reaches the cloud unless explicitly allowed.
    assert.deepEqual(order({ translationProvider: 'bergamot' }), ['bergamot']);
    assert.deepEqual(order({ translationProvider: 'bergamot', bergamotCloudFallback: true }), ['bergamot', 'google-free', 'google-dict', 'mymemory']);
    e.context.browser.storage.local.get = async (defaults) => ({ ...defaults, translationProvider: 'microsoft-edge' });
    assert.equal((await e.api.getSettings()).translationProvider, 'auto-free');
    return { migratedFromMicrosoftEdge: true };
  });
  await test('bergamot_source_comes_from_caption_track_only', async () => {
    const e = background();
    e.context.browser.storage.local.get = async (defaults) => ({ ...defaults, translationProvider: 'google-free' });
    assert.equal(await e.api.resolveSourceLang('auto', 'en'), 'auto');
    e.context.browser.storage.local.get = async (defaults) => ({ ...defaults, translationProvider: 'bergamot' });
    assert.equal(await e.api.resolveSourceLang('auto', 'en'), 'en');
    assert.equal(await e.api.resolveSourceLang('auto', ''), 'auto');
    const B = e.context.YTBBI_BERGAMOT;
    const unknown = await B.prepare({ sourceLang: 'auto', targetLang: 'zh-TW' }).then(() => null, (x) => x.code);
    assert.equal(unknown, B.CODES.SOURCE_UNKNOWN);
    return { cloudProvidersKeepAutoDetect: true, missingTrackLanguageIsAnError: true };
  });
  await test('bergamot_picks_desktop_release_model_files', async () => {
    const e = background(), B = e.context.YTBBI_BERGAMOT;
    assert.equal(B._matchesFilter(''), true);
    assert.equal(B._matchesFilter("env.appinfo.OS == 'Android'"), false);
    assert.equal(B._matchesFilter("env.appinfo.OS != 'Android' || env.channel != 'release'"), true);
    assert.equal(B._matchesFilter("env.channel == 'default' || env.channel == 'nightly'"), false);
    assert.equal(B._matchesFilter("env.version|versionCompare('130') >= 0"), false);
    const rec = (fileType, version, filter = '') => ({ fromLang: 'en', toLang: 'zh-Hans', fileType, version, filter, name: `${fileType}-${version}`, hash: fileType + version, size: 1 });
    const types = ['model', 'lex', 'srcvocab', 'trgvocab'];
    const registry = { records: [
      ...types.map((t) => rec(t, '2.2')),
      ...types.map((t) => rec(t, '2.1', "env.appinfo.OS == 'Android'")),
      ...types.map((t) => rec(t, '2.0a2', "env.channel == 'nightly'"))
    ] };
    const picked = B._pickModelFiles(registry, 'en', 'zh-Hans');
    assert.equal(picked.model.version, '2.2'); assert.equal(picked.srcvocab.version, '2.2');
    assert.equal(B._pickModelFiles(registry, 'en', 'ja'), null);
    return { pickedVersion: picked.model.version };
  });
  await test('mangled_batch_markers_fall_back_without_cascade', async () => {
    const e = background(); let calls = 0;
    e.context.fetch = async () => { calls++; return { ok: true, status: 200, text: async () => JSON.stringify([[['mangled output', 'x']]]) }; };
    const settings = { translationProvider: 'google-free', autoFailover: false };
    const texts = Array.from({ length: 8 }, (_, i) => `line ${i}`);
    const first = await e.api.translateBatchUsingProviders({ texts, sourceLang: 'auto', targetLang: 'zh-TW', settings, priority: 0 }).then(() => null, (x) => x);
    assert.ok(first); assert.equal(calls, 1);
    const second = await e.api.translateBatchUsingProviders({ texts, sourceLang: 'auto', targetLang: 'zh-TW', settings, priority: 0 }).then(() => null, (x) => x);
    assert.ok(second); assert.equal(calls, 1);
    assert.equal(e.api.getProviderState('google-free').cooldownUntil, 0);
    return { requestsForTwoFailedBatches: calls, providerCooledDown: false };
  });
  await test('manual_captions_merge_into_sentences', async () => {
    const e = content();
    const merged = e.api.mergeManualCues([
      { startMs: 0, endMs: 1500, text: 'I think that we' },
      { startMs: 1600, endMs: 3000, text: 'should go home now.' },
      { startMs: 3100, endMs: 4000, text: '[Music]' },
      { startMs: 4100, endMs: 5000, text: '- Yes.' },
      { startMs: 5100, endMs: 6000, text: '- No.' },
      { startMs: 9000, endMs: 9500, text: 'Far away' },
      { startMs: 12000, endMs: 13000, text: 'after a pause.' }
    ]).map((cue) => cue.text);
    // Arrays created inside the VM belong to another realm; compare contents.
    assert.deepEqual(Array.from(merged), ['I think that we should go home now.', '[Music]', '- Yes.', '- No.', 'Far away', 'after a pause.']);
    return { merged };
  });
  await test('abbreviations_do_not_end_sentences', async () => {
    const e = content(), end = e.api.endsWithSegmentBoundary;
    assert.equal(end('Thank you Mr.'), false); assert.equal(end('back in the U.S.'), false); assert.equal(end('apples, pears, etc.'), false);
    assert.equal(end('So do I.'), true); assert.equal(end('Say no.'), true); assert.equal(end('Really?'), true);
    return { checked: 6 };
  });
  await test('cjk_tokens_join_without_spaces', async () => {
    const e = content(), join = e.api.joinTimedCaptionText;
    assert.equal(join('今日は', 'いい天気'), '今日はいい天気'); assert.equal(join('我們', '今天'), '我們今天');
    assert.equal(join('hello', 'world'), 'hello world'); assert.equal(join('iPhone', '很好'), 'iPhone 很好');
    const segs = e.api.buildStableSegmentsFromTokens([{ startMs: 0, endMs: 300, text: '今日は' }, { startMs: 300, endMs: 600, text: 'いい天気。' }]);
    assert.equal(segs[0].text, '今日はいい天気。');
    return { cjkSpacesInserted: false };
  });
  await test('cue_does_not_linger_through_long_silence', async () => {
    const e = content(), w = e.api.normalizeTranscriptCueWindows;
    const longGap = w([{ startMs: 0, endMs: 2000, text: 'a' }, { startMs: 30000, endMs: 32000, text: 'b' }]);
    assert.equal(longGap[0].endMs, 2700);
    const shortGap = w([{ startMs: 0, endMs: 2000, text: 'a' }, { startMs: 2500, endMs: 4000, text: 'b' }]);
    assert.equal(shortGap[0].endMs, 2400);
    return { longGapEndMs: longGap[0].endMs, shortGapEndMs: shortGap[0].endMs };
  });
  await test('same_language_track_shows_original_without_request', async () => {
    const e = content();
    e.api.state.settings = { ...e.api.state.settings, targetLang: 'en' };
    e.api.state.transcriptTrackLang = 'en';
    e.api.handleCaptionChange(); await pump(); await e.clock.advance(1000);
    assert.equal(e.mock.sends, 0);
    assert.equal(e.mock.overlays.at(-1).original, 'Hello there.'); assert.equal(e.mock.overlays.at(-1).translation, '');
    return { translationRequests: 0 };
  });
  runFinished = true;
  console.log(JSON.stringify({ repo, checkedVersion: JSON.parse(fs.readFileSync(path.join(repo, 'manifest.json'),'utf8')).version,
    mode: 'isolated VM, synthetic inputs, fake clock, no real network or credentials',
    total: results.length, passed: results.filter(x => x.passed).length, results }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
