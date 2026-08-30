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
    requireNativeCaptions: true,
    autoEnableNativeCaptions: false,
    fontSize: 18,
    bottomPercent: 12,
    maxWidthPercent: 92,
    sourceLang: 'auto',
    debug: false,
    translationProvider: 'auto-free',
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
    autoFailover: true,
    batchTranslationEnabled: true,
    batchSize: 8,
    transcriptFirstMode: true,
    recalculateOnScroll: true,
    recalculateOnViewportResize: true,
    observePlayerResize: true
  });

  const CAPTION_SOURCE_LANG = 'auto';
  const PREFETCH_AHEAD_BASE_MS = 90000;
  const PREFETCH_AHEAD_MAX_MS = 150000;
  const PREFETCH_RATE_EXTRA_PER_1X_MS = 60000;
  const PREFETCH_AHEAD_MIN_COUNT = 16;
  const PREFETCH_AHEAD_MAX_COUNT = 100;
  const PREFETCH_DEBOUNCE_MS = 80;
  const PREFETCH_RETRY_DELAYS_MS = Object.freeze([2000, 5000, 15000]);
  // v0.52: Visible-DOM captions are emergency fallback only. Do not commit
  // short ASR fragments just because the DOM stopped changing for ~1 second.
  // YouTube VOD timed-text is assembled ahead of playback and remains the
  // authoritative timeline whenever it is available.
  const VISIBLE_STABLE_DELAY_MS = 1200;
  const VISIBLE_MIN_WORDS_FOR_SOFT_BOUNDARY = 6;
  const VISIBLE_MAX_WAIT_MS = 6000;
  const VISIBLE_MAX_CHARS = 170;
  const VISIBLE_MAX_WORDS = 24;
  const VISIBLE_STRONG_BOUNDARY_CHARS = new Set(['.', '。', '!', '！', '?', '？']);
  const VISIBLE_SOFT_BOUNDARY_CHARS = new Set([',', '，', '、']);
  const VISIBLE_RECENT_COMMITTED_LIMIT = 8;
  const OVERLAY_DRAG_START_DISTANCE_PX = 6;
  const OVERLAY_VIEWPORT_MARGIN_PX = 8;

  const SELECTORS = [
    '.ytp-caption-segment',
    '.ytp-caption-window-container .caption-visual-line',
    '.caption-window .captions-text',
    '.caption-window span'
  ];

  const NATIVE_CAPTION_NO_TRANSLATE_SELECTOR = [
    '.ytp-caption-window-container',
    '.caption-window',
    '.ytp-caption-segment',
    '.caption-visual-line',
    '.captions-text'
  ].join(', ');

  const markNoTranslate = (element) => {
    if (!(element instanceof HTMLElement)) return;
    if (element.getAttribute('translate') !== 'no') element.setAttribute('translate', 'no');
    if (!element.classList.contains('notranslate')) element.classList.add('notranslate');
    if (element.dataset.ytbbiNoTranslate !== 'true') element.dataset.ytbbiNoTranslate = 'true';
  };

  const protectNativeCaptionNodes = (root = document) => {
    const start = root?.nodeType === Node.TEXT_NODE ? root.parentElement : root;
    if (!start) return;

    if (start instanceof Element) {
      const closestCaption = start.closest(NATIVE_CAPTION_NO_TRANSLATE_SELECTOR);
      if (closestCaption) markNoTranslate(closestCaption);
      if (start.matches(NATIVE_CAPTION_NO_TRANSLATE_SELECTOR)) markNoTranslate(start);
    }

    start.querySelectorAll?.(NATIVE_CAPTION_NO_TRANSLATE_SELECTOR).forEach(markNoTranslate);
  };

  const protectCaptionMutation = (mutation) => {
    protectNativeCaptionNodes(mutation.target);
    for (const node of mutation.addedNodes || []) {
      if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) {
        protectNativeCaptionNodes(node);
      }
    }
  };

  const state = {
    settings: { ...DEFAULT_SETTINGS },
    observer: null,
    routeTimer: null,
    textTimer: null,
    lastUrl: location.href,
    lastCaptionText: '',
    lastTranslatedText: '',
    requestSeq: 0,
    overlay: null,
    overlayCard: null,
    dragHandle: null,
    playerToggleButton: null,
    overlayDragPositions: new Map(),
    dragState: null,
    dragDocumentCleanup: null,
    suppressLookupClickUntil: 0,
    dragHandlersInstalled: false,
    overlayInteractionActive: false,
    overlayInteractionTimer: 0,
    overlayInteractionHandlersInstalled: false,
    overlayGeometryHandlersInstalled: false,
    overlayGeometryRaf: 0,
    overlayResizeObserver: null,
    overlayObservedPlayer: null,
    originalEl: null,
    translationEl: null,
    statusEl: null,
    lookupPopover: null,
    lookupAbortSeq: 0,
    lastLookupEntry: null,
    transcriptKey: '',
    transcriptLoadingKey: '',
    transcriptLoadStartedAt: 0,
    transcriptSeq: 0,
    transcriptCues: [],
    transcriptRawCues: [],
    transcriptVideoId: '',
    transcriptTrackLang: '',
    transcriptIsAuto: false,
    currentStableCaptionKey: '',
    transcriptPrefetchedKeys: new Set(),
    transcriptPrefetchingKeys: new Set(),
    transcriptPrefetchRetryAfter: new Map(),
    transcriptPrefetchRetryAttempts: new Map(),
    prefetchTimer: null,
    playbackTimer: null,
    playerToggleTimer: null,
    visibleBufferText: '',
    visibleBufferStartedAt: 0,
    visibleBufferUpdatedAt: 0,
    visibleBufferTimer: null,
    visibleBufferCommittedText: '',
    visibleRecentCommittedSegments: [],
    lastVisibleRawText: '',
    visibleProgressiveScore: 0,
    visibleProgressiveMode: false,
    emptyCaptionTimer: null,
    pagePlayerResponse: null,
    pageVideoId: '',
    pageSelectedTrack: null,
    pageAudioTrack: null,
    observedTimedtextUrls: [],
    bridgeInstalled: false,
    bridgeRequestSeq: 0,
    bridgeRequests: new Map(),
    lastTranscriptIndex: -1,
    displayTranslationCache: new Map(),
    displayTranslationInflight: new Map(),
    lastOverlaySignature: '',
    lastHandledVideoTimeMs: -1,
    videoEventTarget: null,
    lastRenderedOriginal: '',
    lastRenderedTranslation: '',
    lastRenderedStatus: '',
    translationStatusTimer: 0,
    initialized: false,
    activeVideoId: '',
    activePlayerElement: null,
    lastNativeCaptionClickAt: 0,
    lastBridgeRefreshAt: 0,
    nativeCaptionAutoEnableVideoId: '',
    nativeCaptionUserDisabledVideoId: '',
    nativeCaptionStateVideoId: '',
    lastKnownNativeCaptionActive: false,
    shortsToggleHost: null
  };



  const I18N = globalThis.YTBBI_I18N;
  const getUiLanguage = () => state.settings?.uiLanguage || DEFAULT_SETTINGS.uiLanguage || 'zh-TW';
  const t = (key, vars) => I18N?.t(getUiLanguage(), key, vars) || key;
  const getCaptionTargetLang = () => state.settings?.targetLang || DEFAULT_SETTINGS.targetLang || 'zh-TW';

  const log = (...args) => {
    if (state.settings.debug) console.log(`[${EXT_NAME}]`, ...args);
  };

  const normalizeText = (text) => String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const normalizeTerm = (text) => normalizeText(text)
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '')
    .trim();

  const normalizeTranslationKeyText = (text) => {
    const normalized = normalizeText(text).toLowerCase();
    const compact = normalized.replace(/[\s\p{P}\p{S}]+/gu, '');
    return compact || normalized;
  };

  const makeDisplayTranslationKey = (text) => `${CAPTION_SOURCE_LANG}|${getCaptionTargetLang()}|${normalizeTranslationKeyText(text)}`;

  const cacheDisplayTranslation = (text, translatedText) => {
    const original = normalizeText(text);
    const translated = normalizeText(translatedText);
    if (!original || !translated) return;
    state.displayTranslationCache.set(makeDisplayTranslationKey(original), translated);
    if (state.displayTranslationCache.size > 900) {
      const first = state.displayTranslationCache.keys().next().value;
      state.displayTranslationCache.delete(first);
    }
  };

  const getDisplayCachedTranslation = (text) => {
    const key = makeDisplayTranslationKey(text);
    if (state.displayTranslationCache.has(key)) return state.displayTranslationCache.get(key);
    return '';
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

  const storageGet = async () => {
    try {
      const result = await callMaybePromise(EXT.storage.local.get, EXT.storage.local, DEFAULT_SETTINGS);
      return { ...DEFAULT_SETTINGS, ...result };
    } catch (error) {
      console.warn(`[${EXT_NAME}] Failed to read settings.`, error);
      return { ...DEFAULT_SETTINGS };
    }
  };

  const storageSet = async (value) => {
    try {
      await callMaybePromise(EXT.storage.local.set, EXT.storage.local, value);
    } catch (error) {
      console.warn(`[${EXT_NAME}] Failed to save settings.`, error);
    }
  };

  const sendMessage = (message) => callMaybePromise(EXT.runtime.sendMessage, EXT.runtime, message);

  const isShortsPage = () => /^\/shorts(?:\/|$)/.test(location.pathname);
  const isWatchPage = () => {
    try {
      return location.pathname === '/watch' && new URL(location.href).searchParams.has('v');
    } catch (_error) {
      return false;
    }
  };
  const isEmbedPage = () => /^\/embed\//.test(location.pathname);
  const isSupportedVideoPage = () => isWatchPage() || isShortsPage() || isEmbedPage();

  const getVisibleElementScore = (element) => {
    if (!element?.getBoundingClientRect) return 0;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 16 || rect.height <= 16) return 0;
    if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= window.innerHeight || rect.left >= window.innerWidth) return 0;

    const visibleWidth = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
    const visibleHeight = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
    const visibleArea = visibleWidth * visibleHeight;
    const area = Math.max(1, rect.width * rect.height);
    const visibleRatio = visibleArea / area;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const distanceFromCenter = Math.hypot(centerX - window.innerWidth / 2, centerY - window.innerHeight / 2);
    const centerBonus = Math.max(0, 1 - distanceFromCenter / Math.max(window.innerWidth, window.innerHeight));
    return visibleArea + visibleRatio * 120000 + centerBonus * 20000;
  };

  const selectActiveVideoElement = () => {
    const videos = Array.from(document.querySelectorAll('video'));
    if (!videos.length) return null;
    if (videos.length === 1) return videos[0];

    const candidates = videos
      .map((video) => {
        let score = getVisibleElementScore(video);
        const player = video.closest?.('.html5-video-player');
        if (player?.id === 'shorts-player') score += 60000;
        if (video.closest?.('ytd-reel-video-renderer, ytd-shorts')) score += 40000;
        if (!video.paused && !video.ended) score += 30000;
        return { video, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);

    return candidates[0]?.video || videos.find((video) => !video.paused && !video.ended) || videos[0];
  };

  const findPlayer = () => {
    const activeVideo = selectActiveVideoElement();
    const playerFromVideo = activeVideo?.closest?.('.html5-video-player');
    if (playerFromVideo) return playerFromVideo;

    if (isShortsPage()) {
      const shortsPlayer = document.getElementById('shorts-player');
      if (shortsPlayer) return shortsPlayer;
      const reelPlayer = document.querySelector('ytd-reel-video-renderer .html5-video-player, ytd-shorts .html5-video-player');
      if (reelPlayer) return reelPlayer;
    }

    return (
      document.querySelector('#movie_player.html5-video-player') ||
      document.querySelector('.html5-video-player') ||
      document.querySelector('ytd-player') ||
      activeVideo?.parentElement ||
      document.body
    );
  };

  const getActiveReelRoot = () => {
    const activeVideo = selectActiveVideoElement();
    return (
      activeVideo?.closest?.('ytd-reel-video-renderer, ytd-shorts') ||
      document.querySelector('ytd-reel-video-renderer[is-active], ytd-reel-video-renderer[active], ytd-reel-video-renderer, ytd-shorts')
    );
  };

  const responseMatchesCurrentVideo = (response) => {
    const currentVideoId = getVideoId();
    const responseVideoId = normalizeText(response?.videoDetails?.videoId || '');
    return !currentVideoId || !responseVideoId || currentVideoId === responseVideoId;
  };

  const pageBridgeMatchesCurrentVideo = () => {
    const currentVideoId = getVideoId();
    return !currentVideoId || !state.pageVideoId || currentVideoId === state.pageVideoId;
  };

  const hasPageSelectedTrackForCurrentVideo = () => {
    return !!(state.pageSelectedTrack?.baseUrl && pageBridgeMatchesCurrentVideo());
  };

  const refreshPagePlayerDataSoon = () => {
    if (!isSupportedVideoPage()) return;
    const now = Date.now();
    if (now - state.lastBridgeRefreshAt < 900) return;
    state.lastBridgeRefreshAt = now;
    requestPagePlayerData().then(() => scheduleCaptionRead()).catch((error) => log('bridge refresh failed', error));
  };

  const updatePlayerToggleState = () => {
    const button = state.playerToggleButton;
    if (!button || !button.isConnected) return;
    const enabled = !!state.settings.enabled;
    button.classList.toggle('ytbbi-player-toggle-on', enabled);
    button.classList.toggle('ytbbi-player-toggle-off', !enabled);
    button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    button.title = enabled ? t('playerToggleOnTitle') : t('playerToggleOffTitle');
    button.setAttribute('aria-label', enabled ? t('playerToggleOnTitle') : t('playerToggleOffTitle'));
  };

  const CAPTION_BUTTON_SELECTORS = [
    '.ytp-subtitles-button',
    'button[aria-label*="字幕"]',
    'button[title*="字幕"]',
    'button[aria-label*="Captions" i]',
    'button[title*="Captions" i]',
    'button[aria-label*="Subtitles" i]',
    'button[title*="Subtitles" i]',
    'button[aria-label*="CC"]',
    'button[title*="CC"]'
  ];

  const PLAYER_CONTROL_CONTAINER_SELECTOR = [
    '.ytp-right-controls',
    '.ytp-chrome-controls',
    'ytd-shorts-player-controls',
    'ytd-shorts-player-controls #top-controls',
    '.player-controls-top-right',
    '.player-controls'
  ].join(', ');

  const EXTENSION_UI_SELECTOR = [
    '.ytbbi-overlay',
    '.ytbbi-popover',
    '.ytbbi-player-toggle',
    '.ytbbi-shorts-toggle-host'
  ].join(', ');

  const isVisibleInteractiveElement = (node) => {
    if (!node?.getBoundingClientRect) return false;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 8 || rect.height <= 8) return false;
    if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= window.innerHeight || rect.left >= window.innerWidth) return false;
    const style = getComputedStyle(node);
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity || 1) > 0.05;
  };

  const getNativeCaptionButton = () => {
    const activePlayer = findPlayer();
    const activeReel = getActiveReelRoot();
    const roots = [activePlayer, activeReel, document].filter(Boolean);
    const seenRoots = new Set();

    for (const root of roots) {
      if (seenRoots.has(root)) continue;
      seenRoots.add(root);

      for (const selector of CAPTION_BUTTON_SELECTORS) {
        let nodes = [];
        try { nodes = Array.from(root.querySelectorAll?.(selector) || []); } catch (_error) { nodes = []; }

        const visible = nodes.find((node) => {
          if (!isVisibleInteractiveElement(node)) return false;

          // Never treat this extension's own drag handle, lookup card or toggle
          // as YouTube's native CC button. Their translated labels may also
          // contain words such as "字幕", "Captions" or "Subtitles".
          if (node.closest?.(EXTENSION_UI_SELECTOR)) return false;

          // Avoid picking caption menu rows while the settings menu is open.
          if (node.closest?.('.ytp-panel, ytd-popup-container, tp-yt-paper-dialog, yt-sheet-view-model')) return false;

          // A native CC button must live inside a recognized YouTube player
          // control container. This prevents matching unrelated page buttons.
          if (!node.closest?.(PLAYER_CONTROL_CONTAINER_SELECTOR)) return false;

          const nodePlayer = node.closest?.('.html5-video-player');
          if (activePlayer?.matches?.('.html5-video-player') && nodePlayer && nodePlayer !== activePlayer) return false;

          if (isShortsPage() && activeReel) {
            const nodeReel = node.closest?.('ytd-reel-video-renderer, ytd-shorts');
            if (nodeReel && nodeReel !== activeReel) return false;
          }

          return true;
        });

        if (visible) return visible;
      }
    }

    return null;
  };

  const isNativeCaptionActive = () => {
    if (hasPageSelectedTrackForCurrentVideo()) return true;

    const button = getNativeCaptionButton();
    if (button) {
      const ariaPressed = String(button.getAttribute('aria-pressed') || '').toLowerCase();
      if (ariaPressed === 'true') return true;
      if (ariaPressed === 'false') return false;
      if (button.classList.contains('ytp-button-active')) return true;
      const label = `${button.getAttribute('aria-label') || ''} ${button.title || ''}`.toLowerCase();
      if (/captions?\s+on|subtitles?\s+on|字幕\/?cc 已開啟|字幕已開啟/.test(label)) return true;
      if (/captions?\s+off|subtitles?\s+off|字幕\/?cc 已關閉|字幕已關閉/.test(label)) return false;
    }

    const activeVideo = selectActiveVideoElement();
    try {
      const tracks = Array.from(activeVideo?.textTracks || []);
      if (tracks.some((track) => track.mode === 'showing' || (track.mode === 'hidden' && track.activeCues && track.activeCues.length))) return true;
    } catch (_error) {
      // Some browsers restrict TextTrack access. Ignore and continue.
    }

    return false;
  };

  const getNativeCaptionVideoKey = () => {
    if (!isSupportedVideoPage()) return '';
    return getVideoId() || state.pageVideoId || state.activeVideoId || location.href;
  };

  const observeNativeCaptionState = (active) => {
    const key = getNativeCaptionVideoKey();
    if (key && state.nativeCaptionStateVideoId && state.nativeCaptionStateVideoId !== key) {
      state.lastKnownNativeCaptionActive = false;
      state.nativeCaptionUserDisabledVideoId = '';
    }
    if (key) state.nativeCaptionStateVideoId = key;

    // If captions were active and then become inactive on the same video, treat
    // that as a user choice. Do not keep forcing CC back on until a new video is
    // loaded.
    if (!active && state.lastKnownNativeCaptionActive && key) {
      state.nativeCaptionUserDisabledVideoId = key;
    }
    state.lastKnownNativeCaptionActive = !!active;
  };

  const maybeAutoEnableNativeCaptions = () => {
    if (!isSupportedVideoPage()) return false;
    if (!state.settings.autoEnableNativeCaptions) return false;

    const key = getNativeCaptionVideoKey();
    if (key && state.nativeCaptionUserDisabledVideoId === key) return false;
    if (key && state.nativeCaptionAutoEnableVideoId === key) return false;

    const button = getNativeCaptionButton();
    if (!button) return false;

    const active = isNativeCaptionActive();
    observeNativeCaptionState(active);
    if (active) return false;

    const now = Date.now();
    if (now - state.lastNativeCaptionClickAt < 1800) return false;
    state.lastNativeCaptionClickAt = now;
    if (key) state.nativeCaptionAutoEnableVideoId = key;
    button.click();
    refreshPagePlayerDataSoon();
    return true;
  };

  const shouldBlockOverlayBecauseNativeCaptionsOff = () => {
    if (!isSupportedVideoPage()) return true;
    if (!state.settings.requireNativeCaptions) return false;

    const active = isNativeCaptionActive();
    observeNativeCaptionState(active);
    if (active) return false;

    refreshPagePlayerDataSoon();
    maybeAutoEnableNativeCaptions();

    const activeAfterAttempt = isNativeCaptionActive();
    observeNativeCaptionState(activeAfterAttempt);
    return !activeAfterAttempt;
  };

  const clearCaptionDisplayState = () => {
    state.lastCaptionText = '';
    state.lastTranslatedText = '';
    state.currentStableCaptionKey = '';
    state.lastOverlaySignature = '';
    state.lastRenderedOriginal = '';
    state.lastRenderedTranslation = '';
    state.lastRenderedStatus = '';
    clearTimeout(state.translationStatusTimer);
    resetVisibleBufferState(false);
    state.originalEl?.replaceChildren?.();
    if (state.translationEl) state.translationEl.textContent = '';
    if (state.statusEl) state.statusEl.textContent = '';
    hideOverlay(true);
  };

  const destroyOverlay = () => {
    clearTimeout(state.overlayInteractionTimer);
    state.overlayInteractionTimer = 0;
    state.dragDocumentCleanup?.();
    state.dragDocumentCleanup = null;
    state.dragState = null;
    state.overlayInteractionActive = false;
    state.overlayResizeObserver?.disconnect?.();
    state.overlayResizeObserver = null;
    state.overlayObservedPlayer = null;
    if (state.overlayGeometryRaf) cancelAnimationFrame(state.overlayGeometryRaf);
    state.overlayGeometryRaf = 0;
    state.overlay?.remove?.();
    state.overlay = null;
    state.overlayCard = null;
    state.dragHandle = null;
    state.originalEl = null;
    state.translationEl = null;
    state.statusEl = null;
    state.dragHandlersInstalled = false;
    state.overlayInteractionHandlersInstalled = false;
  };

  const setBilingualModeEnabled = async (enabled) => {
    const next = !!enabled;
    state.settings = {
      ...state.settings,
      enabled: next,
      // When the bilingual overlay is enabled, hide YouTube native captions so
      // users do not see duplicated subtitles. When disabled, restore native
      // captions immediately so the normal YouTube CC experience remains.
      hideNativeCaptions: next
    };
    await storageSet({ enabled: next, hideNativeCaptions: next });
    applySettingsToDom();
    updatePlayerToggleState();
    state.requestSeq += 1;
    if (!next) {
      hideOverlay(true);
      return;
    }
    state.lastCaptionText = '';
    state.lastTranslatedText = '';
    if (!isSupportedVideoPage()) {
      clearCaptionDisplayState();
      return;
    }
    if (next) maybeAutoEnableNativeCaptions();
    scheduleCaptionRead();
  };

  const toggleBilingualMode = async () => {
    await setBilingualModeEnabled(!state.settings.enabled);
  };

  const clearShortsToggleHost = () => {
    if (state.shortsToggleHost?.isConnected) state.shortsToggleHost.remove();
    state.shortsToggleHost = null;
  };

  const deactivateForUnsupportedPage = () => {
    clearTimeout(state.textTimer);
    clearTimeout(state.playerToggleTimer);
    clearTimeout(state.prefetchTimer);
    clearCaptionDisplayState();
    closeLookupPopover();
    destroyOverlay();
    resetTranscriptState();
    resetVisibleBufferState(false);
    state.pageVideoId = '';
    state.pageSelectedTrack = null;
    state.pagePlayerResponse = null;
    state.activeVideoId = '';
    state.activePlayerElement = null;
    state.overlayResizeObserver?.disconnect?.();
    state.overlayObservedPlayer = null;
    if (state.overlayGeometryRaf) cancelAnimationFrame(state.overlayGeometryRaf);
    state.overlayGeometryRaf = 0;
    if (state.playerToggleButton?.isConnected) state.playerToggleButton.remove();
    state.playerToggleButton = null;
    clearShortsToggleHost();
    document.documentElement.classList.remove('ytbbi-shorts-mode', 'ytbbi-hide-native-captions');
  };

  const updateShortsToggleHostGeometry = () => {
    const host = state.shortsToggleHost;
    if (!host?.isConnected) return;

    const video = selectActiveVideoElement();
    const rect = video?.getBoundingClientRect?.();
    if (!rect || rect.width <= 16 || rect.height <= 16) {
      host.style.top = '88px';
      host.style.right = '84px';
      host.style.left = '';
      return;
    }

    const left = Math.min(window.innerWidth - 52, Math.max(8, rect.right - 48));
    const top = Math.min(window.innerHeight - 52, Math.max(8, rect.top + 48));
    host.style.left = `${left}px`;
    host.style.top = `${top}px`;
    host.style.right = 'auto';
  };

  const getShortsToggleHost = () => {
    if (!isShortsPage()) {
      clearShortsToggleHost();
      return null;
    }

    let host = state.shortsToggleHost;
    if (!host || !host.isConnected) {
      host = document.createElement('div');
      host.className = 'ytbbi-shorts-toggle-host';
      host.setAttribute('aria-hidden', 'false');
      document.body.appendChild(host);
      state.shortsToggleHost = host;
    }

    updateShortsToggleHostGeometry();
    return host;
  };

  const findPlayerToggleHost = () => {
    if (!isSupportedVideoPage()) return null;

    const ccButton = getNativeCaptionButton();
    if (ccButton?.parentElement && ccButton.closest?.(PLAYER_CONTROL_CONTAINER_SELECTOR)) {
      return { parent: ccButton.parentElement, after: ccButton };
    }

    // Shorts controls are frequently rebuilt. If the real CC button is not
    // available yet, wait for the next controls mutation instead of placing the
    // extension toggle in a guessed or floating location.
    if (isShortsPage()) return null;

    const player = findPlayer();
    const rightControls = player?.querySelector?.('.ytp-right-controls');
    if (rightControls && isVisibleInteractiveElement(rightControls)) {
      return { parent: rightControls, after: null };
    }

    return null;
  };

  const ensurePlayerToggle = () => {
    if (!isSupportedVideoPage()) {
      if (state.playerToggleButton?.isConnected) state.playerToggleButton.remove();
      state.playerToggleButton = null;
      return null;
    }
    const host = findPlayerToggleHost();
    if (!host?.parent) {
      if (state.playerToggleButton?.isConnected) state.playerToggleButton.remove();
      state.playerToggleButton = null;
      return null;
    }

    let button = state.playerToggleButton;
    if (!button || !button.isConnected) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'ytp-button ytbbi-player-toggle';
      button.innerHTML = '<span class="ytbbi-player-toggle-icon" aria-hidden="true"><svg class="ytbbi-player-toggle-svg" viewBox="0 0 36 36" focusable="false"><rect class="ytbbi-player-toggle-box" x="8.5" y="11.5" width="19" height="13" rx="3"></rect><circle class="ytbbi-player-toggle-badge" cx="25.5" cy="14.5" r="2.2"></circle><path class="ytbbi-player-toggle-line" d="M12 16h7"></path><path class="ytbbi-player-toggle-line" d="M12 20h11"></path><path class="ytbbi-player-toggle-mark" d="M24.2 14.5h2.6"></path></svg></span>';
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleBilingualMode().catch((error) => console.warn(`[${EXT_NAME}] Toggle failed.`, error));
      }, true);
      state.playerToggleButton = button;
    }

    if (button.parentElement !== host.parent) {
      if (host.after && host.after.parentElement === host.parent) {
        host.after.insertAdjacentElement('afterend', button);
      } else {
        host.parent.insertBefore(button, host.parent.firstElementChild || null);
      }
    } else if (host.after && button.previousElementSibling !== host.after && host.after.parentElement === host.parent) {
      host.after.insertAdjacentElement('afterend', button);
    }

    updatePlayerToggleState();
    return button;
  };

  const schedulePlayerToggleEnsure = (delay = 300) => {
    clearTimeout(state.playerToggleTimer);
    if (!isSupportedVideoPage()) return;
    state.playerToggleTimer = setTimeout(() => {
      ensurePlayerToggle();
    }, delay);
  };

  const getOverlayHost = () => document.fullscreenElement || document.body || document.documentElement;

  const ensureOverlayHost = () => {
    const overlay = state.overlay;
    const host = getOverlayHost();
    if (!overlay || !host) return;
    if (overlay.parentElement !== host) host.appendChild(overlay);
  };

  const scheduleOverlayGeometryUpdate = () => {
    if (state.overlayGeometryRaf) return;
    state.overlayGeometryRaf = requestAnimationFrame(() => {
      state.overlayGeometryRaf = 0;
      const overlay = state.overlay;
      if (!isSupportedVideoPage() || !overlay?.isConnected) return;
      // Hidden subtitles are repositioned by showOverlay() before becoming visible.
      // Skipping geometry work here avoids layout reads during unrelated page activity.
      if (!overlay.classList.contains('ytbbi-visible') && !state.dragState) return;
      ensureOverlayHost();
      applyOverlayPositionForCurrentVideo();
    });
  };

  const scheduleOverlayGeometryFromScroll = () => {
    if (state.settings.recalculateOnScroll === false) return;
    const overlay = state.overlay;
    if (!overlay?.isConnected || !overlay.classList.contains('ytbbi-visible')) return;
    // Default behavior keeps dragged subtitles anchored to their page position.
    // Rapid scroll events are still merged by requestAnimationFrame, so the overlay
    // follows the page at most once per rendered frame and hides when fully off-screen.
    scheduleOverlayGeometryUpdate();
  };

  const scheduleOverlayGeometryFromViewportResize = () => {
    if (state.settings.recalculateOnViewportResize === false) return;
    scheduleOverlayGeometryUpdate();
  };

  const observeOverlayPlayerGeometry = (player) => {
    if (state.settings.observePlayerResize === false) {
      state.overlayResizeObserver?.disconnect?.();
      state.overlayResizeObserver = null;
      state.overlayObservedPlayer = null;
      return;
    }
    if (!player || state.overlayObservedPlayer === player) return;
    state.overlayResizeObserver?.disconnect?.();
    state.overlayObservedPlayer = player;
    if (typeof ResizeObserver !== 'function') return;
    state.overlayResizeObserver = new ResizeObserver(() => scheduleOverlayGeometryUpdate());
    state.overlayResizeObserver.observe(player);
  };

  const installOverlayGeometryHandlers = () => {
    if (state.overlayGeometryHandlersInstalled) return;
    state.overlayGeometryHandlersInstalled = true;
    window.addEventListener('resize', scheduleOverlayGeometryFromViewportResize, { passive: true });
    window.addEventListener('scroll', scheduleOverlayGeometryFromScroll, { passive: true, capture: true });
    document.addEventListener('fullscreenchange', () => {
      // Firefox requires the overlay to move into the fullscreen element. Keep this
      // safety behavior even when optional geometry synchronization is disabled.
      ensureOverlayHost();
      scheduleOverlayGeometryUpdate();
    });
  };

  const ensureOverlay = () => {
    if (!isSupportedVideoPage()) return null;
    const player = findPlayer();
    if (!player) return null;

    if (!state.overlay || !state.overlay.isConnected) {
      const overlay = document.createElement('div');
      overlay.className = 'ytbbi-overlay';
      overlay.setAttribute('aria-live', 'polite');
      markNoTranslate(overlay);

      const card = document.createElement('div');
      card.className = 'ytbbi-card';

      const dragHandle = document.createElement('button');
      dragHandle.type = 'button';
      dragHandle.className = 'ytbbi-drag-handle';
      dragHandle.title = t('dragHandleTitle');
      dragHandle.setAttribute('aria-label', t('dragHandleTitle'));
      dragHandle.textContent = '⋮⋮';

      const original = document.createElement('div');
      original.className = 'ytbbi-original';
      markNoTranslate(original);

      const translation = document.createElement('div');
      translation.className = 'ytbbi-translation';
      markNoTranslate(translation);

      const status = document.createElement('div');
      status.className = 'ytbbi-status';
      markNoTranslate(status);

      card.append(dragHandle, original, translation, status);
      overlay.append(card);

      state.overlay = overlay;
      state.overlayCard = card;
      state.dragHandle = dragHandle;
      state.dragHandlersInstalled = false;
      state.overlayInteractionHandlersInstalled = false;
      state.overlayInteractionActive = false;
      state.originalEl = original;
      state.translationEl = translation;
      state.statusEl = status;
      ensureOverlayHost();
    } else {
      ensureOverlayHost();
    }

    installOverlayDragHandlers();
    installOverlayInteractionHandlers();
    installOverlayGeometryHandlers();
    observeOverlayPlayerGeometry(player);
    applySettingsToDom();
    applyOverlayPositionForCurrentVideo();
    return state.overlay;
  };

  const applySettingsToDom = () => {
    const root = document.documentElement;
    root.classList.toggle('ytbbi-shorts-mode', isShortsPage());
    root.style.setProperty('--ytbbi-font-size', `${state.settings.fontSize}px`);
    root.style.setProperty('--ytbbi-bottom', `${state.settings.bottomPercent}%`);
    root.style.setProperty('--ytbbi-max-width', `${state.settings.maxWidthPercent}%`);

    document.documentElement.classList.toggle(
      'ytbbi-hide-native-captions',
      !!state.settings.enabled && isSupportedVideoPage()
    );

    document.documentElement.classList.toggle(
      'ytbbi-word-underline',
      !!state.settings.showWordUnderline
    );

    if (state.originalEl) {
      state.originalEl.style.display = state.settings.showOriginal ? 'block' : 'none';
    }
    if (state.translationEl) {
      state.translationEl.style.display = state.settings.showTranslation ? 'block' : 'none';
    }
    if (state.dragHandle) {
      state.dragHandle.title = t('dragHandleTitle');
      state.dragHandle.setAttribute('aria-label', t('dragHandleTitle'));
    }
    if (state.lookupPopover) {
      state.lookupPopover.querySelector('.ytbbi-pop-close')?.setAttribute('aria-label', t('close'));
    }
    updatePlayerToggleState();
  };

  const isEnglishToken = (token) => /^[A-Za-z]+(?:[-'][A-Za-z]+)*$/.test(token);

  const renderInteractiveText = (container, text) => {
    container.textContent = '';
    const normalized = normalizeText(text);
    if (!normalized) return;

    if (!state.settings.interactiveLookup) {
      container.textContent = normalized;
      return;
    }

    const tokens = normalized.match(/[A-Za-z]+(?:[-'][A-Za-z]+)*|\s+|[^\sA-Za-z]+/g) || [normalized];
    const frag = document.createDocumentFragment();

    tokens.forEach((token) => {
      if (!isEnglishToken(token)) {
        frag.append(document.createTextNode(token));
        return;
      }

      const word = document.createElement('button');
      word.type = 'button';
      word.className = 'ytbbi-word';
      word.textContent = token;
      word.title = t('wordTitle');
      word.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (Date.now() < state.suppressLookupClickUntil) return;
        openLookup(token, word);
      });
      frag.append(word);
    });

    container.appendChild(frag);
  };

  const showOverlay = ({ original = '', translation = '', status = '' }) => {
    const overlay = ensureOverlay();
    if (!overlay) return;

    const originalText = normalizeText(original);
    const translationText = normalizeText(translation);
    const statusText = normalizeText(status);
    const signature = [
      state.settings.enabled ? '1' : '0',
      state.settings.showOriginal ? '1' : '0',
      state.settings.showTranslation ? '1' : '0',
      originalText,
      translationText,
      statusText
    ].join('||');

    // YouTube fires many DOM mutations while the same cue is on screen. Rewriting
    // the overlay for identical content rebuilds word buttons and looks like a
    // subtitle flicker, so skip no-op renders.
    if (state.lastOverlaySignature === signature && overlay.isConnected) return;
    state.lastOverlaySignature = signature;

    if (state.settings.showOriginal) {
      if (state.lastRenderedOriginal !== originalText) {
        renderInteractiveText(state.originalEl, originalText);
        state.lastRenderedOriginal = originalText;
      }
    } else if (state.lastRenderedOriginal) {
      state.originalEl.textContent = '';
      state.lastRenderedOriginal = '';
    }

    if (state.settings.showTranslation) {
      if (state.lastRenderedTranslation !== translationText) {
        state.translationEl.textContent = translationText;
        state.lastRenderedTranslation = translationText;
      }
    } else if (state.lastRenderedTranslation) {
      state.translationEl.textContent = '';
      state.lastRenderedTranslation = '';
    }

    if (state.lastRenderedStatus !== statusText) {
      state.statusEl.textContent = statusText;
      state.statusEl.style.display = statusText ? 'block' : 'none';
      state.lastRenderedStatus = statusText;
    }

    const hasVisibleText =
      (state.settings.showOriginal && originalText) ||
      (state.settings.showTranslation && translationText) ||
      statusText;

    overlay.classList.toggle('ytbbi-visible', !!state.settings.enabled && !!hasVisibleText);
    scheduleOverlayGeometryUpdate();
  };

  const setOverlayInteractionActive = (active) => {
    clearTimeout(state.overlayInteractionTimer);
    state.overlayInteractionActive = !!active && !!state.settings.enabled && isSupportedVideoPage();
    state.overlay?.classList.toggle('ytbbi-interacting', state.overlayInteractionActive);

    if (state.overlayInteractionActive) {
      clearTimeout(state.emptyCaptionTimer);
      const hasRenderedText = !!(
        state.lastRenderedOriginal ||
        state.lastRenderedTranslation ||
        state.lastRenderedStatus
      );
      if (state.settings.enabled && hasRenderedText) {
        state.overlay?.classList.add('ytbbi-visible');
      }
    }
  };

  const isOverlayStillInteracting = () => {
    const overlay = state.overlay;
    if (!overlay?.isConnected) return false;
    if (state.dragState) return true;
    if (overlay.contains(document.activeElement)) return true;
    try {
      return overlay.matches(':hover');
    } catch (_error) {
      return false;
    }
  };

  const scheduleOverlayInteractionRelease = () => {
    clearTimeout(state.overlayInteractionTimer);
    state.overlayInteractionTimer = setTimeout(() => {
      if (isOverlayStillInteracting()) return;
      setOverlayInteractionActive(false);
      scheduleCaptionRead();
    }, 140);
  };

  const installOverlayInteractionHandlers = () => {
    if (!state.overlayCard || state.overlayInteractionHandlersInstalled) return;
    state.overlayInteractionHandlersInstalled = true;

    state.overlayCard.addEventListener('pointerenter', () => {
      setOverlayInteractionActive(true);
    });
    state.overlayCard.addEventListener('pointerleave', () => {
      scheduleOverlayInteractionRelease();
    });
    state.overlayCard.addEventListener('focusin', () => {
      setOverlayInteractionActive(true);
    });
    state.overlayCard.addEventListener('focusout', () => {
      scheduleOverlayInteractionRelease();
    });
  };

  const hideOverlay = (force = false) => {
    if (!state.overlay) return;
    if (!force && (state.overlayInteractionActive || isOverlayStillInteracting())) {
      state.overlay.classList.add('ytbbi-visible');
      return;
    }
    if (force) setOverlayInteractionActive(false);
    state.overlay.classList.remove('ytbbi-visible');
  };

  const getVisibleCaptionText = () => {
    const collectFromRoot = (root) => {
      const pieces = [];
      const seen = new Set();
      if (!root?.querySelectorAll) return '';

      for (const selector of SELECTORS) {
        root.querySelectorAll(selector).forEach((node) => {
          markNoTranslate(node);
          markNoTranslate(node.closest('.ytp-caption-window-container, .caption-window'));
          const rect = node.getBoundingClientRect();
          const text = normalizeText(node.textContent);
          if (!text) return;
          if (rect.width === 0 && rect.height === 0) return;
          if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= window.innerHeight || rect.left >= window.innerWidth) return;
          if (seen.has(text)) return;
          seen.add(text);
          pieces.push(text);
        });
        if (pieces.length) break;
      }
      return normalizeText(pieces.join(' '));
    };

    return collectFromRoot(findPlayer()) || collectFromRoot(document);
  };

  const getVideoId = () => {
    if (!isSupportedVideoPage()) return '';
    try {
      const shortsMatch = location.pathname.match(/^\/shorts\/([^/?#]+)/);
      if (shortsMatch?.[1]) return decodeURIComponent(shortsMatch[1]);
      const url = new URL(location.href);
      const watchId = url.searchParams.get('v');
      if (watchId) return watchId;
      const activePlayer = findPlayer();
      const responseId = state.pagePlayerResponse?.videoDetails?.videoId || activePlayer?.getPlayerResponse?.()?.videoDetails?.videoId || '';
      return responseId || '';
    } catch (_error) {
      return '';
    }
  };


  const getOverlayPositionStorageKey = () => {
    const videoId = getVideoId();
    return videoId ? `ytbbi-overlay-position:${videoId}` : '';
  };

  const clampPercent = (value) => Math.max(0, Math.min(100, Number(value) || 0));

  const readOverlayPositionForCurrentVideo = () => {
    const key = getOverlayPositionStorageKey();
    if (!key) return null;
    if (state.overlayDragPositions.has(key)) return state.overlayDragPositions.get(key);
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);

      if (parsed.mode === 'page' && parsed.anchor === 'center') {
        const pageCenterX = Number(parsed.pageCenterX);
        const pageCenterY = Number(parsed.pageCenterY);
        if (!Number.isFinite(pageCenterX) || !Number.isFinite(pageCenterY)) return null;
        const pos = {
          mode: 'page',
          anchor: 'center',
          pageCenterX: Math.max(0, pageCenterX),
          pageCenterY: Math.max(0, pageCenterY)
        };
        state.overlayDragPositions.set(key, pos);
        return pos;
      }

      if (parsed.mode === 'viewport' && parsed.anchor === 'center') {
        const centerX = Number(parsed.centerXPercent);
        const centerY = Number(parsed.centerYPercent);
        if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) return null;
        const pos = {
          mode: 'viewport',
          anchor: 'center',
          centerXPercent: clampPercent(centerX),
          centerYPercent: clampPercent(centerY)
        };
        state.overlayDragPositions.set(key, pos);
        return pos;
      }

      const left = Number(parsed.leftPercent);
      const top = Number(parsed.topPercent);
      if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
      const pos = {
        // v0.42 viewport positions used a top-left anchor; v0.41 and earlier
        // positions had no mode and were relative to the player.
        mode: parsed.mode === 'viewport' ? 'viewport' : 'player',
        anchor: parsed.mode === 'viewport' ? 'legacy-top-left' : 'player',
        leftPercent: clampPercent(left),
        topPercent: clampPercent(top)
      };
      state.overlayDragPositions.set(key, pos);
      return pos;
    } catch (_error) {
      return null;
    }
  };

  const saveOverlayPositionForCurrentVideo = (position) => {
    const key = getOverlayPositionStorageKey();
    if (!key || !position) return;

    let pos;
    if (position.mode === 'page' && position.anchor === 'center') {
      pos = {
        mode: 'page',
        anchor: 'center',
        pageCenterX: Math.max(0, Number(position.pageCenterX) || 0),
        pageCenterY: Math.max(0, Number(position.pageCenterY) || 0)
      };
    } else if (position.mode !== 'player' && position.anchor === 'center') {
      pos = {
        mode: 'viewport',
        anchor: 'center',
        centerXPercent: clampPercent(position.centerXPercent),
        centerYPercent: clampPercent(position.centerYPercent)
      };
    } else {
      pos = {
        mode: position.mode === 'player' ? 'player' : 'viewport',
        leftPercent: clampPercent(position.leftPercent),
        topPercent: clampPercent(position.topPercent)
      };
    }

    state.overlayDragPositions.set(key, pos);
    try { sessionStorage.setItem(key, JSON.stringify(pos)); } catch (_error) {}
  };

  const clearOverlayPositionForCurrentVideo = () => {
    const key = getOverlayPositionStorageKey();
    if (!key) return;
    state.overlayDragPositions.delete(key);
    try { sessionStorage.removeItem(key); } catch (_error) {}
  };

  const getOverlayViewportSize = () => ({
    width: Math.max(1, document.documentElement.clientWidth || window.innerWidth || 1),
    height: Math.max(1, document.documentElement.clientHeight || window.innerHeight || 1)
  });

  const getOverlayMaxWidthPx = (playerRect) => {
    const viewport = getOverlayViewportSize();
    const configured = Math.max(120, playerRect.width * (state.settings.maxWidthPercent / 100));
    const shortsLimit = isShortsPage() ? 360 : Number.POSITIVE_INFINITY;
    return Math.max(120, Math.min(configured, shortsLimit, viewport.width - OVERLAY_VIEWPORT_MARGIN_PX * 2));
  };

  const getOverlayRectSize = () => {
    const rect = state.overlay?.getBoundingClientRect?.();
    return {
      width: Math.max(1, rect?.width || state.overlay?.offsetWidth || 1),
      height: Math.max(1, rect?.height || state.overlay?.offsetHeight || 1)
    };
  };

  const clampOverlayToViewport = (leftPx, topPx, overlaySize = getOverlayRectSize()) => {
    const viewport = getOverlayViewportSize();
    const margin = OVERLAY_VIEWPORT_MARGIN_PX;
    const maxLeft = Math.max(margin, viewport.width - overlaySize.width - margin);
    const maxTop = Math.max(margin, viewport.height - overlaySize.height - margin);
    return {
      left: Math.max(margin, Math.min(maxLeft, Number(leftPx) || margin)),
      top: Math.max(margin, Math.min(maxTop, Number(topPx) || margin)),
      maxLeft,
      maxTop,
      viewport
    };
  };

  const getPageScrollOffset = () => ({
    x: Number(window.scrollX || document.documentElement.scrollLeft || 0),
    y: Number(window.scrollY || document.documentElement.scrollTop || 0)
  });

  const isOverlayOutsideViewport = (leftPx, topPx, overlaySize = getOverlayRectSize()) => {
    const viewport = getOverlayViewportSize();
    const left = Number(leftPx) || 0;
    const top = Number(topPx) || 0;
    const right = left + overlaySize.width;
    const bottom = top + overlaySize.height;
    return right <= 0 || bottom <= 0 || left >= viewport.width || top >= viewport.height;
  };

  const updateOverlayViewportVisibility = (leftPx, topPx, overlaySize = getOverlayRectSize()) => {
    const overlay = state.overlay;
    if (!overlay) return;
    overlay.classList.toggle(
      'ytbbi-outside-viewport',
      isOverlayOutsideViewport(leftPx, topPx, overlaySize)
    );
  };

  const setOverlayViewportPixels = (
    leftPx,
    topPx,
    overlaySize = getOverlayRectSize(),
    { clampToViewport = false } = {}
  ) => {
    const overlay = state.overlay;
    if (!overlay) return null;

    let result;
    if (clampToViewport) {
      result = clampOverlayToViewport(leftPx, topPx, overlaySize);
    } else {
      result = {
        left: Number(leftPx) || 0,
        top: Number(topPx) || 0,
        viewport: getOverlayViewportSize()
      };
    }

    overlay.style.left = `${result.left}px`;
    overlay.style.top = `${result.top}px`;
    overlay.style.right = 'auto';
    overlay.style.bottom = 'auto';
    overlay.style.transform = 'none';
    updateOverlayViewportVisibility(result.left, result.top, overlaySize);
    return result;
  };

  const savePageCenterPosition = (position, overlaySize) => {
    if (!position || !overlaySize) return;
    const scroll = getPageScrollOffset();
    saveOverlayPositionForCurrentVideo({
      mode: 'page',
      anchor: 'center',
      pageCenterX: scroll.x + position.left + overlaySize.width / 2,
      pageCenterY: scroll.y + position.top + overlaySize.height / 2
    });
  };

  const applyOverlayPositionForCurrentVideo = () => {
    const overlay = state.overlay;
    const player = findPlayer();
    if (!overlay || !player || state.dragState?.started) return;

    ensureOverlayHost();
    const playerRect = player.getBoundingClientRect();
    if (playerRect.width <= 1 || playerRect.height <= 1) return;
    overlay.style.setProperty('--ytbbi-overlay-max-width', `${getOverlayMaxWidthPx(playerRect)}px`);

    const overlaySize = getOverlayRectSize();
    const pos = readOverlayPositionForCurrentVideo();

    if (pos?.mode === 'page') {
      const scroll = getPageScrollOffset();
      const left = pos.pageCenterX - scroll.x - overlaySize.width / 2;
      const top = pos.pageCenterY - scroll.y - overlaySize.height / 2;
      overlay.classList.add('ytbbi-dragged', 'ytbbi-page-position');
      overlay.classList.remove('ytbbi-viewport-position');
      setOverlayViewportPixels(left, top, overlaySize);
      return;
    }

    if (pos?.mode === 'viewport') {
      const viewport = getOverlayViewportSize();
      let left;
      let top;

      if (pos.anchor === 'center') {
        const centerX = viewport.width * (pos.centerXPercent / 100);
        const centerY = viewport.height * (pos.centerYPercent / 100);
        left = centerX - overlaySize.width / 2;
        top = centerY - overlaySize.height / 2;
      } else {
        const availableWidth = Math.max(0, viewport.width - overlaySize.width - OVERLAY_VIEWPORT_MARGIN_PX * 2);
        const availableHeight = Math.max(0, viewport.height - overlaySize.height - OVERLAY_VIEWPORT_MARGIN_PX * 2);
        left = OVERLAY_VIEWPORT_MARGIN_PX + availableWidth * (pos.leftPercent / 100);
        top = OVERLAY_VIEWPORT_MARGIN_PX + availableHeight * (pos.topPercent / 100);
      }

      // v0.42-v0.44 stored dragged subtitles relative to the browser viewport.
      // Migrate once to page coordinates so scrolling moves the subtitle with
      // its original page location instead of pinning it to the screen.
      const visiblePosition = setOverlayViewportPixels(left, top, overlaySize, { clampToViewport: true });
      savePageCenterPosition(visiblePosition, overlaySize);
      overlay.classList.add('ytbbi-dragged', 'ytbbi-page-position');
      overlay.classList.remove('ytbbi-viewport-position');
      return;
    }

    if (pos?.mode === 'player') {
      const left = playerRect.left + playerRect.width * (pos.leftPercent / 100);
      const top = playerRect.top + playerRect.height * (pos.topPercent / 100);
      overlay.classList.add('ytbbi-dragged');
      overlay.classList.remove('ytbbi-viewport-position', 'ytbbi-page-position');
      setOverlayViewportPixels(left, top, overlaySize);
      return;
    }

    overlay.classList.remove(
      'ytbbi-dragged',
      'ytbbi-dragging',
      'ytbbi-viewport-position',
      'ytbbi-page-position'
    );
    const left = playerRect.left + (playerRect.width - overlaySize.width) / 2;
    const top = isShortsPage()
      ? playerRect.top + Math.max(56, Math.min(84, playerRect.height * 0.07))
      : playerRect.bottom - playerRect.height * (state.settings.bottomPercent / 100) - overlaySize.height;
    setOverlayViewportPixels(left, top, overlaySize);
  };

  const setDraggedOverlayPosition = (leftPx, topPx, overlayRect, shouldSave = false) => {
    const overlay = state.overlay;
    if (!overlay || !overlayRect) return;
    overlay.classList.add('ytbbi-dragged', 'ytbbi-page-position');
    overlay.classList.remove('ytbbi-viewport-position', 'ytbbi-outside-viewport');
    const visiblePosition = setOverlayViewportPixels(leftPx, topPx, {
      width: overlayRect.width,
      height: overlayRect.height
    }, { clampToViewport: true });
    if (!visiblePosition || !shouldSave) return;

    savePageCenterPosition(visiblePosition, {
      width: overlayRect.width,
      height: overlayRect.height
    });
  };

  const installOverlayDragHandlers = () => {
    if (!state.overlay || !state.overlayCard || !state.dragHandle || state.dragHandlersInstalled) return;
    state.dragHandlersInstalled = true;

    const finishDrag = (event, cancelled = false) => {
      const drag = state.dragState;
      if (!drag) return;

      if (drag.started) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        const clientX = event?.clientX ?? drag.lastClientX ?? drag.startClientX;
        const clientY = event?.clientY ?? drag.lastClientY ?? drag.startClientY;
        if (!cancelled) {
          const leftPx = clientX - drag.offsetX;
          const topPx = clientY - drag.offsetY;
          setDraggedOverlayPosition(leftPx, topPx, drag.overlayRect, true);
        }
        state.suppressLookupClickUntil = Date.now() + 650;
      }

      state.overlay?.classList.remove('ytbbi-dragging');
      try { state.overlayCard?.releasePointerCapture?.(drag.pointerId); } catch (_error) {}
      state.dragState = null;
      scheduleOverlayInteractionRelease();
      state.dragDocumentCleanup?.();
      state.dragDocumentCleanup = null;
    };

    const onPointerMove = (event) => {
      const drag = state.dragState;
      if (!drag || event.pointerId !== drag.pointerId) return;
      drag.lastClientX = event.clientX;
      drag.lastClientY = event.clientY;

      if (!drag.started) {
        const distance = Math.hypot(
          event.clientX - drag.startClientX,
          event.clientY - drag.startClientY
        );
        if (distance < OVERLAY_DRAG_START_DISTANCE_PX) return;

        drag.started = true;
        setOverlayInteractionActive(true);
        state.suppressLookupClickUntil = Date.now() + 650;
        state.lookupAbortSeq += 1;
        closeLookupPopover();
        state.overlay?.classList.add('ytbbi-dragging');
        try { state.overlayCard?.setPointerCapture?.(event.pointerId); } catch (_error) {}
      }

      event.preventDefault();
      event.stopPropagation();
      const leftPx = event.clientX - drag.offsetX;
      const topPx = event.clientY - drag.offsetY;
      setDraggedOverlayPosition(leftPx, topPx, drag.overlayRect, false);
    };

    const onPointerUp = (event) => finishDrag(event, false);
    const onPointerCancel = (event) => finishDrag(event, true);
    const cleanupDocumentDragListeners = () => {
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', onPointerCancel, true);
    };

    state.overlayCard.addEventListener('pointerdown', (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      if (event.isPrimary === false) return;

      const player = findPlayer();
      const overlay = state.overlay;
      if (!player || !overlay) return;

      const overlayRect = overlay.getBoundingClientRect();
      setOverlayInteractionActive(true);
      state.dragState = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        lastClientX: event.clientX,
        lastClientY: event.clientY,
        offsetX: event.clientX - overlayRect.left,
        offsetY: event.clientY - overlayRect.top,
        overlayRect,
        started: false
      };

      // Keep pointer interactions on the subtitle card from reaching YouTube's
      // player while preserving a normal click for vocabulary lookup.
      event.stopPropagation();
      state.dragDocumentCleanup?.();
      document.addEventListener('pointermove', onPointerMove, true);
      document.addEventListener('pointerup', onPointerUp, true);
      document.addEventListener('pointercancel', onPointerCancel, true);
      state.dragDocumentCleanup = cleanupDocumentDragListeners;
    });

    state.overlayCard.addEventListener('click', (event) => {
      if (Date.now() < state.suppressLookupClickUntil) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (!event.target.closest?.('.ytbbi-word')) event.stopPropagation();
    });

    state.dragHandle.addEventListener('dblclick', (event) => {
      event.preventDefault();
      event.stopPropagation();
      clearOverlayPositionForCurrentVideo();
      applyOverlayPositionForCurrentVideo();
    });
  };

  const getVideoElement = () => selectActiveVideoElement();

  const getVideoCurrentMs = () => {
    const video = getVideoElement();
    const seconds = Number(video?.currentTime || 0);
    return Number.isFinite(seconds) ? Math.max(0, Math.round(seconds * 1000)) : 0;
  };

  const isVideoPaused = () => {
    const video = getVideoElement();
    return !!video && (video.paused || video.ended);
  };


  const resetVisibleBufferState = (clearCommitted = true) => {
    state.visibleBufferText = '';
    state.visibleBufferStartedAt = 0;
    state.visibleBufferUpdatedAt = 0;
    state.lastVisibleRawText = '';
    state.visibleProgressiveScore = 0;
    state.visibleProgressiveMode = false;
    clearTimeout(state.visibleBufferTimer);
    clearTimeout(state.emptyCaptionTimer);
    if (clearCommitted) {
      state.visibleBufferCommittedText = '';
      state.visibleRecentCommittedSegments = [];
    }
  };

  const resetTranscriptState = () => {
    state.transcriptKey = '';
    state.transcriptLoadingKey = '';
    state.transcriptLoadStartedAt = 0;
    state.transcriptSeq += 1;
    state.transcriptCues = [];
    state.transcriptRawCues = [];
    state.transcriptVideoId = '';
    state.transcriptTrackLang = '';
    state.transcriptIsAuto = false;
    state.currentStableCaptionKey = '';
    state.transcriptPrefetchedKeys = new Set();
    state.transcriptPrefetchingKeys = new Set();
    state.transcriptPrefetchRetryAfter = new Map();
    state.transcriptPrefetchRetryAttempts = new Map();
    state.lastTranscriptIndex = -1;
    state.lastOverlaySignature = '';
    state.lastRenderedOriginal = '';
    state.lastRenderedTranslation = '';
    state.lastRenderedStatus = '';
    clearTimeout(state.translationStatusTimer);
    clearTimeout(state.prefetchTimer);
    resetVisibleBufferState();
  };

  const detectCaptionLanguage = (text) => {
    const value = String(text || '');
    if (/[\u3040-\u30ff]/.test(value)) return 'ja';
    if (/[\uac00-\ud7af]/.test(value)) return 'ko';
    if (/[A-Za-z]/.test(value)) return 'en';
    if (/[\u4e00-\u9fff]/.test(value)) return 'zh';
    return 'auto';
  };


  const cloneJson = (value) => {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_error) {
      return null;
    }
  };

  const installPageBridge = () => {
    if (state.bridgeInstalled) return;
    state.bridgeInstalled = true;

    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      const message = event.data;
      if (!message || typeof message !== 'object') return;
      if (!String(message.type || '').startsWith('YTBBI_BRIDGE_')) return;

      if (message.type === 'YTBBI_BRIDGE_PLAYER_DATA') {
        const previousVideoId = state.pageVideoId;
        const previousSelectedKey = state.pageSelectedTrack?.baseUrl || '';
        state.pageVideoId = normalizeText(message.videoId || message.playerResponse?.videoDetails?.videoId || '');
        state.pagePlayerResponse = message.playerResponse ? cloneJson(message.playerResponse) : null;
        state.pageSelectedTrack = message.selectedTrack ? cloneJson(message.selectedTrack) : null;
        state.pageAudioTrack = message.audioTrack ? cloneJson(message.audioTrack) : null;

        const selectedKey = state.pageSelectedTrack?.baseUrl || '';
        if ((state.pageVideoId && previousVideoId && state.pageVideoId !== previousVideoId) || selectedKey !== previousSelectedKey) {
          scheduleCaptionRead();
        }

        if (message.requestId && state.bridgeRequests.has(message.requestId)) {
          state.bridgeRequests.get(message.requestId)({
            videoId: state.pageVideoId,
            playerResponse: state.pagePlayerResponse,
            selectedTrack: state.pageSelectedTrack,
            audioTrack: state.pageAudioTrack
          });
          state.bridgeRequests.delete(message.requestId);
        }
      }

      if (message.type === 'YTBBI_BRIDGE_TIMEDTEXT_URL' && message.url) {
        rememberTimedtextUrl(message.url);
      }
    });

    try {
      const script = document.createElement('script');
      script.src = EXT.runtime.getURL('page-bridge.js');
      script.async = false;
      script.onload = () => script.remove();
      script.onerror = () => script.remove();
      (document.documentElement || document.head || document.body).appendChild(script);
    } catch (error) {
      log('page bridge injection failed', error);
    }
  };

  const requestPagePlayerData = () => new Promise((resolve) => {
    const requestId = `req-${Date.now()}-${++state.bridgeRequestSeq}`;
    const timer = setTimeout(() => {
      if (state.bridgeRequests.has(requestId)) {
        state.bridgeRequests.delete(requestId);
        resolve({ videoId: state.pageVideoId, playerResponse: state.pagePlayerResponse, selectedTrack: state.pageSelectedTrack, audioTrack: state.pageAudioTrack });
      }
    }, 800);
    state.bridgeRequests.set(requestId, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
    window.postMessage({ type: 'YTBBI_CONTENT_GET_PLAYER_DATA', requestId }, '*');
  });

  const rememberTimedtextUrl = (rawUrl) => {
    try {
      const url = new URL(String(rawUrl), location.href);
      if (!/\/api\/timedtext|\/timedtext/.test(url.pathname)) return;
      const value = url.toString();
      state.observedTimedtextUrls = [value, ...state.observedTimedtextUrls.filter((item) => item !== value)].slice(0, 12);
      log('observed timedtext url', value.slice(0, 120));
    } catch (_error) {
      // Ignore malformed URL.
    }
  };

  const addTimedtextTokenHints = (url) => {
    const observed = state.observedTimedtextUrls.find((item) => {
      try {
        const src = new URL(item);
        const lang = src.searchParams.get('lang');
        return !lang || !url.searchParams.get('lang') || lang === url.searchParams.get('lang');
      } catch (_error) {
        return false;
      }
    });
    if (!observed) return url;

    try {
      const src = new URL(observed);
      ['pot', 'c', 'cver', 'cpn', 'signatureTimestamp', 'key'].forEach((name) => {
        const value = src.searchParams.get(name);
        if (value && !url.searchParams.get(name)) url.searchParams.set(name, value);
      });
    } catch (_error) {
      // Ignore token copy failures.
    }
    return url;
  };

  const extractJsonObjectAfterMarker = (source, marker) => {
    const text = String(source || '');
    const markerIndex = text.indexOf(marker);
    if (markerIndex < 0) return null;

    const start = text.indexOf('{', markerIndex);
    if (start < 0) return null;

    let depth = 0;
    let inString = false;
    let quote = '';
    let escaped = false;

    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === quote) {
          inString = false;
        }
        continue;
      }

      if (ch === '"' || ch === "'") {
        inString = true;
        quote = ch;
        continue;
      }

      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(start, i + 1));
          } catch (_error) {
            return null;
          }
        }
      }
    }

    return null;
  };

  const getInitialPlayerResponse = () => {
    if (state.pagePlayerResponse?.captions && responseMatchesCurrentVideo(state.pagePlayerResponse)) return cloneJson(state.pagePlayerResponse);

    try {
      const pageWindow = window.wrappedJSObject || window;
      const direct = pageWindow.ytInitialPlayerResponse;
      if (direct?.captions && responseMatchesCurrentVideo(direct)) return cloneJson(direct);
    } catch (_error) {
      // Content scripts may not be allowed to read page globals; script parsing below is the fallback.
    }

    try {
      const pageWindow = window.wrappedJSObject || window;
      const rawPlayerResponse = pageWindow.ytplayer?.config?.args?.raw_player_response;
      if (rawPlayerResponse) {
        const parsed = typeof rawPlayerResponse === 'string' ? JSON.parse(rawPlayerResponse) : rawPlayerResponse;
        if (parsed?.captions && responseMatchesCurrentVideo(parsed)) return cloneJson(parsed);
      }
    } catch (_error) {
      // Some YouTube layouts expose caption tracks through ytplayer config instead of ytInitialPlayerResponse.
    }

    const scripts = Array.from(document.scripts || []).reverse();
    for (const script of scripts) {
      const text = script.textContent || '';
      if (!text.includes('ytInitialPlayerResponse')) continue;
      const response = extractJsonObjectAfterMarker(text, 'ytInitialPlayerResponse');
      if (response?.captions && responseMatchesCurrentVideo(response)) return response;
    }
    return null;
  };

  const getCaptionTracks = () => {
    const response = getInitialPlayerResponse();
    const tracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    const list = Array.isArray(tracks) ? tracks.filter((track) => track?.baseUrl) : [];
    if (hasPageSelectedTrackForCurrentVideo() && !list.some((track) => track.baseUrl === state.pageSelectedTrack.baseUrl)) {
      list.unshift(state.pageSelectedTrack);
    }
    return list;
  };

  const chooseCaptionTrack = (tracks, captionText) => {
    if (!tracks.length) return null;
    if (hasPageSelectedTrackForCurrentVideo()) {
      const selected = tracks.find((track) => track.baseUrl === state.pageSelectedTrack.baseUrl) || state.pageSelectedTrack;
      if (selected?.baseUrl) return selected;
    }
    const detected = detectCaptionLanguage(captionText);
    const normalizedDetected = detected.split('-')[0];

    const langMatch = tracks.find((track) => {
      const lang = String(track.languageCode || '').toLowerCase();
      return normalizedDetected !== 'auto' && lang.split('-')[0] === normalizedDetected;
    });
    if (langMatch) return langMatch;

    const manual = tracks.find((track) => track.kind !== 'asr');
    return manual || tracks[0];
  };

  const stripCaptionMarkup = (text) => normalizeText(String(text || '')
    .replace(/\{\\an\d+\}/g, '')
    .replace(/<[^>]+>/g, '')
  );

  const getEventText = (event) => stripCaptionMarkup((event?.segs || []).map((seg) => seg.utf8 || '').join(''));

  const parseJson3Transcript = (data) => {
    const events = Array.isArray(data?.events) ? data.events : [];
    return events.map((event) => {
      const text = getEventText(event);
      const startMs = Number(event.tStartMs || 0);
      const durationMs = Number(event.dDurationMs || 0);
      return {
        startMs,
        endMs: startMs + Math.max(durationMs, 900),
        text,
        key: `${startMs}|${text}`,
        rawEvent: event
      };
    }).filter((cue) => cue.text && Number.isFinite(cue.startMs));
  };

  const detectYouTubeCaptionFormat = (data, track = {}) => {
    const events = Array.isArray(data?.events) ? data.events : [];
    const withOffsets = events.filter((event) => Array.isArray(event?.segs) && event.segs.some((seg) => Number.isFinite(Number(seg.tOffsetMs))));
    const lineTexts = events.map(getEventText).filter(Boolean);
    let progressivePairs = 0;
    for (let i = 1; i < Math.min(lineTexts.length, 80); i += 1) {
      if (looksLikeProgressiveCaption(lineTexts[i - 1], lineTexts[i])) progressivePairs += 1;
    }
    const trackName = normalizeText(track.name?.simpleText || track.name?.runs?.map((run) => run.text).join('') || '');
    const isAsr = track.kind === 'asr' || /auto|自動|自動產生|automatic|generated/i.test(trackName);
    if (isAsr && progressivePairs >= 3) return 'scrolling-asr';
    if (isAsr && withOffsets.length >= Math.max(2, Math.floor(events.length * 0.25))) return 'karaoke-asr';
    return isAsr ? 'asr-standard' : 'standard';
  };

  const endsWithSegmentBoundary = (text) => /[.!?。！？…」』”")]$/.test(normalizeText(text));

  const endsWithSoftBoundary = (text) => /[,，、]$/.test(normalizeText(text));

  const segmentationWordCount = (text) => normalizeText(text).match(/[\p{L}\p{N}']+/gu)?.length || 0;

  const segmentationHasCjk = (text) => /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(String(text || ''));

  const isReadableSoftBoundary = (text, durationMs = 0) => {
    const value = normalizeText(text);
    if (!endsWithSoftBoundary(value)) return false;
    if (segmentationHasCjk(value)) {
      const cjkLength = value.replace(/\s+/g, '').length;
      return cjkLength >= 10 && (durationMs >= 900 || cjkLength >= 16);
    }
    const words = segmentationWordCount(value);
    return words >= 6 && (durationMs >= 1200 || value.length >= 32);
  };

  const exceedsReadableSegmentLimit = (text, durationMs = 0) => {
    const value = normalizeText(text);
    if (!value) return false;
    if (value.length >= 170) return true;
    if (!segmentationHasCjk(value) && segmentationWordCount(value) >= 24) return true;
    if (segmentationHasCjk(value) && value.replace(/\s+/g, '').length >= 48) return true;
    return durationMs >= 6500 && (segmentationHasCjk(value) || segmentationWordCount(value) >= 6);
  };

  const joinTimedCaptionText = (left, right) => {
    const a = normalizeText(left);
    const b = normalizeText(right);
    if (!a) return b;
    if (!b) return a;
    if (/^[,，、.;:!?。！？…)\]」』”]/u.test(b)) return normalizeText(`${a}${b}`);
    if (/^['’]/u.test(b) && /[\p{L}\p{N}]$/u.test(a)) return normalizeText(`${a}${b}`);
    return normalizeText(`${a} ${b}`)
      .replace(/\s+([,，、.;:!?。！？…)\]」』”])/gu, '$1')
      .replace(/([(【「『“])\s+/gu, '$1');
  };

  const extractTimedTokensFromJson3 = (data) => {
    const events = Array.isArray(data?.events) ? data.events : [];
    const tokens = [];
    for (const event of events) {
      const eventStart = Number(event?.tStartMs || 0);
      const eventDuration = Math.max(0, Number(event?.dDurationMs || 0));
      const segs = Array.isArray(event?.segs) ? event.segs : [];
      if (!segs.length) continue;
      if (segs.some((seg) => Number.isFinite(Number(seg.tOffsetMs)))) {
        for (let i = 0; i < segs.length; i += 1) {
          const seg = segs[i];
          const text = stripCaptionMarkup(seg.utf8 || '');
          if (!normalizeText(text)) continue;
          const offset = Number(seg.tOffsetMs || 0);
          const nextOffset = Number(segs[i + 1]?.tOffsetMs);
          const startMs = eventStart + Math.max(0, offset);
          const endMs = eventStart + (Number.isFinite(nextOffset) ? Math.max(nextOffset, offset + 160) : Math.max(eventDuration, offset + 380));
          tokens.push({ startMs, endMs, text });
        }
      } else {
        const text = getEventText(event);
        if (text) tokens.push({ startMs: eventStart, endMs: eventStart + Math.max(eventDuration, 900), text });
      }
    }
    return tokens.sort((a, b) => a.startMs - b.startMs);
  };

  // v0.52: Build display-ready sentences from timed ASR tokens before playback.
  // Strong punctuation closes a sentence immediately. Commas are readable line
  // breaks only after enough semantic content, so fragments such as "I mean,"
  // remain attached to the following words. Every segment keeps the real first
  // and last token timestamps; no equal-time sentence splitting is used.
  const buildStableSegmentsFromTokens = (tokens) => {
    const result = [];
    let current = null;

    const flush = () => {
      if (!current) return;
      const text = normalizeText(current.text);
      if (text) {
        result.push({
          startMs: current.startMs,
          endMs: Math.max(current.endMs, current.startMs + 650),
          text,
          key: `${current.startMs}|tok-sentence|${text}`
        });
      }
      current = null;
    };

    for (const token of tokens) {
      const tokenText = normalizeText(token.text);
      if (!tokenText) continue;

      if (current) {
        const gap = token.startMs - current.endMs;
        const duration = current.endMs - current.startMs;
        const currentWords = segmentationWordCount(current.text);
        const pauseEndsPhrase =
          gap > 2200 ||
          (gap > 1350 && (segmentationHasCjk(current.text) || currentWords >= 6));
        if (
          endsWithSegmentBoundary(current.text) ||
          isReadableSoftBoundary(current.text, duration) ||
          pauseEndsPhrase ||
          exceedsReadableSegmentLimit(current.text, duration)
        ) {
          flush();
        }
      }

      if (!current) {
        current = {
          startMs: token.startMs,
          endMs: token.endMs,
          text: tokenText
        };
      } else {
        current.text = joinTimedCaptionText(current.text, tokenText);
        current.endMs = Math.max(current.endMs, token.endMs);
      }

      const duration = current.endMs - current.startMs;
      if (
        endsWithSegmentBoundary(current.text) ||
        isReadableSoftBoundary(current.text, duration) ||
        exceedsReadableSegmentLimit(current.text, duration)
      ) {
        flush();
      }
    }

    flush();
    return result;
  };



  const endsWithSentencePunctuation = (text) => /[.!?。！？…」』”\)]$/.test(normalizeText(text));

  const hasCjk = (text) => /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(String(text || ''));

  const joinCaptionText = (left, right) => {
    const a = normalizeText(left);
    const b = normalizeText(right);
    if (!a) return b;
    if (!b) return a;
    if (a.endsWith(b)) return a;
    if (b.startsWith(a)) return b;

    // Remove small overlap such as "I have" + "have never" => "I have never".
    const aWords = a.split(/\s+/);
    const bWords = b.split(/\s+/);
    const maxOverlap = Math.min(6, aWords.length, bWords.length);
    for (let size = maxOverlap; size >= 1; size -= 1) {
      const tail = aWords.slice(-size).join(' ').toLowerCase();
      const head = bWords.slice(0, size).join(' ').toLowerCase();
      if (tail && tail === head) {
        return joinTimedCaptionText(a, bWords.slice(size).join(' '));
      }
    }

    return joinTimedCaptionText(a, b);
  };

  // Fallback for ASR tracks that do not expose per-token offsets. This follows
  // the same semantic boundaries as the timed-token path and intentionally
  // avoids equal-duration splitting, which caused subtitle timing drift.
  const mergeAutoGeneratedCues = (rawCues) => {
    const cues = (Array.isArray(rawCues) ? rawCues : [])
      .filter((cue) => cue?.text && Number.isFinite(cue.startMs))
      .sort((a, b) => a.startMs - b.startMs);

    const segments = [];
    let current = null;

    const flush = () => {
      if (!current || !current.text) return;
      const text = normalizeText(current.text);
      if (!text) return;
      segments.push({
        startMs: current.startMs,
        endMs: Math.max(current.endMs, current.startMs + 700),
        text,
        key: `${current.startMs}|stable-sentence|${text}`
      });
      current = null;
    };

    for (const cue of cues) {
      const text = normalizeText(cue.text);
      if (!text) continue;

      if (!current) {
        current = { startMs: cue.startMs, endMs: cue.endMs, text };
        continue;
      }

      const cur = normalizeText(current.text);
      const curKey = captionSimilarityKey(cur);
      const nextKey = captionSimilarityKey(text);
      const gap = cue.startMs - current.endMs;

      // Progressive ASR replacements should update the current sentence rather
      // than creating a new display cue for every added word.
      if (nextKey && curKey && (nextKey.startsWith(curKey) || nextKey.includes(curKey))) {
        current.text = text.length >= cur.length ? text : cur;
        current.endMs = Math.max(current.endMs, cue.endMs);
        const duration = current.endMs - current.startMs;
        if (
          endsWithSegmentBoundary(current.text) ||
          isReadableSoftBoundary(current.text, duration) ||
          exceedsReadableSegmentLimit(current.text, duration)
        ) {
          flush();
        }
        continue;
      }

      if (curKey && nextKey && curKey.includes(nextKey)) {
        current.endMs = Math.max(current.endMs, cue.endMs);
        continue;
      }

      const duration = current.endMs - current.startMs;
      const words = segmentationWordCount(cur);
      const pauseEndsPhrase =
        gap > 2300 ||
        (gap > 1450 && (segmentationHasCjk(cur) || words >= 6));

      if (
        endsWithSegmentBoundary(cur) ||
        isReadableSoftBoundary(cur, duration) ||
        pauseEndsPhrase ||
        exceedsReadableSegmentLimit(cur, duration)
      ) {
        flush();
        current = { startMs: cue.startMs, endMs: cue.endMs, text };
      } else {
        current.text = joinCaptionText(cur, text);
        current.endMs = Math.max(current.endMs, cue.endMs);
      }

      if (current) {
        const mergedDuration = current.endMs - current.startMs;
        if (
          endsWithSegmentBoundary(current.text) ||
          isReadableSoftBoundary(current.text, mergedDuration) ||
          exceedsReadableSegmentLimit(current.text, mergedDuration)
        ) {
          flush();
        }
      }
    }

    flush();
    return segments;
  };


  const normalizeTranscriptCueWindows = (cues) => {
    const normalized = (Array.isArray(cues) ? cues : [])
      .filter((cue) => cue?.text && Number.isFinite(cue.startMs))
      .sort((a, b) => a.startMs - b.startMs);

    for (let index = 0; index < normalized.length; index += 1) {
      const cue = normalized[index];
      const next = normalized[index + 1];
      const minEnd = cue.startMs + 650;
      const naturalEnd = Math.max(Number(cue.endMs || 0), minEnd);

      // Keep the current sentence visible until shortly before the next one,
      // but never let a previous cue linger for multiple seconds after its
      // actual token window. A tiny overlap absorbs timer jitter.
      if (next) {
        const bridgeEnd = Math.max(naturalEnd, next.startMs - 100);
        cue.endMs = Math.min(next.startMs + 120, bridgeEnd);
      } else {
        cue.endMs = naturalEnd;
      }
      cue.key = cue.key || `${cue.startMs}|${cue.text}`;
    }

    return normalized;
  };


  const fetchTranscriptCues = async (track) => {
    const attempts = [];
    try {
      const url = addTimedtextTokenHints(new URL(track.baseUrl));
      url.searchParams.set('fmt', 'json3');
      attempts.push(url.toString());
    } catch (_error) {
      // Ignore bad base URL.
    }

    for (const observed of state.observedTimedtextUrls) {
      try {
        const url = new URL(observed);
        url.searchParams.set('fmt', 'json3');
        if (track.languageCode && !url.searchParams.get('lang')) url.searchParams.set('lang', track.languageCode);
        attempts.push(url.toString());
      } catch (_error) {
        // Ignore malformed observed URL.
      }
    }

    let lastError = null;
    for (const requestUrl of Array.from(new Set(attempts))) {
      try {
        const response = await fetch(requestUrl, {
          method: 'GET',
          credentials: 'omit',
          cache: 'force-cache'
        });
        if (!response.ok) throw new Error(`Timedtext fetch failed: ${response.status}`);
        const data = await response.json();
        const format = detectYouTubeCaptionFormat(data, track);
        const rawCues = parseJson3Transcript(data);
        const tokenSegments = (format === 'scrolling-asr' || format === 'karaoke-asr')
          ? buildStableSegmentsFromTokens(extractTimedTokensFromJson3(data))
          : [];
        return { data, rawCues, tokenSegments, format, requestUrl };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('Timedtext fetch failed: no candidate URLs');
  };

  const ensureTranscriptForCurrentVideo = async (captionText = '') => {
    const videoId = getVideoId();
    if (!videoId) return;
    if (state.transcriptVideoId && state.transcriptVideoId !== videoId) resetTranscriptState();

    const detected = detectCaptionLanguage(captionText || state.lastCaptionText);
    const requestedKey = `${videoId}|${detected}`;
    if (state.transcriptKey === requestedKey && state.transcriptCues.length) return;
    if (state.transcriptLoadingKey === requestedKey) return;

    let tracks = getCaptionTracks();
    if (!tracks.length) {
      await requestPagePlayerData();
      tracks = getCaptionTracks();
    }
    if (!tracks.length) return;

    const track = chooseCaptionTrack(tracks, captionText || state.lastCaptionText);
    if (!track?.baseUrl) return;

    const seq = ++state.transcriptSeq;
    state.transcriptLoadingKey = requestedKey;
    state.transcriptLoadStartedAt = Date.now();

    try {
      const fetched = await fetchTranscriptCues(track);
      if (seq !== state.transcriptSeq) return;
      if (getVideoId() && getVideoId() !== videoId) return;
      const rawCues = fetched.rawCues || [];
      const trackName = normalizeText(track.name?.simpleText || track.name?.runs?.map((run) => run.text).join('') || '');
      const isAutoTrack = track.kind === 'asr' || /auto|自動|自動產生|automatic|generated|asr/i.test(`${trackName} ${fetched.format || ''}`);
      const cues = normalizeTranscriptCueWindows(
        isAutoTrack && state.settings.stableAutoCaptions !== false
          ? ((fetched.tokenSegments && fetched.tokenSegments.length >= 3) ? fetched.tokenSegments : mergeAutoGeneratedCues(rawCues))
          : rawCues
      );
      state.transcriptKey = requestedKey;
      state.transcriptLoadingKey = '';
      state.transcriptLoadStartedAt = 0;
      state.transcriptVideoId = videoId;
      state.transcriptRawCues = rawCues;
      state.transcriptCues = cues;
      state.transcriptTrackLang = track.languageCode || detected || 'auto';
      state.transcriptIsAuto = isAutoTrack;
      state.currentStableCaptionKey = '';
      state.transcriptPrefetchedKeys = new Set();
      state.transcriptPrefetchingKeys = new Set();
      state.transcriptPrefetchRetryAfter = new Map();
      state.transcriptPrefetchRetryAttempts = new Map();
      log('timedtext loaded', state.transcriptTrackLang, cues.length, fetched.format || (isAutoTrack ? 'stable-auto' : 'manual'));
      scheduleUpcomingPrefetch(captionText || state.lastCaptionText || cues[0]?.text || '', { immediate: true });
    } catch (error) {
      if (seq !== state.transcriptSeq) return;
      state.transcriptLoadingKey = '';
      state.transcriptLoadStartedAt = 0;
      log('timedtext unavailable', error);
    }
  };

  const captionSimilarityKey = (text) => normalizeText(text)
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');

  const tokenizeCaptionWords = (text) => normalizeText(text)
    .toLowerCase()
    .match(/[\p{L}\p{N}']+/gu) || [];

  const countCaptionWords = (text) => tokenizeCaptionWords(text).length;

  const getWordOverlap = (left, right) => {
    const a = tokenizeCaptionWords(left);
    const b = tokenizeCaptionWords(right);
    const max = Math.min(8, a.length, b.length);
    let bestTailHead = 0;
    let bestHeadTail = 0;

    for (let size = max; size >= 1; size -= 1) {
      if (!bestTailHead && a.slice(-size).join(' ') === b.slice(0, size).join(' ')) bestTailHead = size;
      if (!bestHeadTail && a.slice(0, size).join(' ') === b.slice(-size).join(' ')) bestHeadTail = size;
      if (bestTailHead || bestHeadTail) break;
    }
    return { tailHead: bestTailHead, headTail: bestHeadTail };
  };

  const looksLikeProgressiveCaption = (previous, next) => {
    const a = normalizeText(previous);
    const b = normalizeText(next);
    if (!a || !b || a === b) return !!(a && b);

    const aKey = captionSimilarityKey(a);
    const bKey = captionSimilarityKey(b);
    if (!aKey || !bKey) return false;
    if (aKey.includes(bKey) || bKey.includes(aKey)) return true;

    const overlap = getWordOverlap(a, b);
    return overlap.tailHead >= 2 || overlap.headTail >= 3;
  };

  const mergeProgressiveVisibleText = (previous, next) => {
    const a = normalizeText(previous);
    const b = normalizeText(next);
    if (!a) return b;
    if (!b) return a;

    const aKey = captionSimilarityKey(a);
    const bKey = captionSimilarityKey(b);
    if (bKey && aKey && bKey.includes(aKey)) return b.length >= a.length ? b : a;
    if (aKey && bKey && aKey.includes(bKey)) return a.length >= b.length ? a : b;

    const overlap = getWordOverlap(a, b);
    if (overlap.tailHead >= 1) {
      const bWords = normalizeText(b).split(/\s+/);
      return normalizeText(`${a} ${bWords.slice(overlap.tailHead).join(' ')}`);
    }

    if (overlap.headTail >= 3) return a.length >= b.length ? a : b;
    return b;
  };

  const stripLeadingBoundaryPunctuation = (text) => normalizeText(text)
    .replace(/^[,，、.。!?！？\s]+/u, '')
    .trim();

  const rememberVisibleCommittedSegment = (text) => {
    const segment = normalizeText(text);
    if (!segment) return;
    const recent = state.visibleRecentCommittedSegments.filter((item) => item !== segment);
    recent.push(segment);
    state.visibleRecentCommittedSegments = recent.slice(-VISIBLE_RECENT_COMMITTED_LIMIT);
  };

  const trimCommittedPrefixFromVisibleText = (text) => {
    let value = normalizeText(text);
    if (!value || !state.visibleRecentCommittedSegments.length) return value;

    // YouTube visible ASR often keeps the previous phrase on screen while the
    // next words are appended. After we commit a punctuation-ended phrase, trim
    // that already-shown phrase from the next raw caption so it does not get
    // translated again as a growing sentence.
    let changed = true;
    while (changed && value) {
      changed = false;
      for (const segment of [...state.visibleRecentCommittedSegments].reverse()) {
        const committed = normalizeText(segment);
        if (!committed) continue;

        if (value === committed) return '';
        if (value.startsWith(`${committed} `) || value.startsWith(committed)) {
          value = stripLeadingBoundaryPunctuation(value.slice(committed.length));
          changed = true;
          break;
        }
      }
    }
    return value;
  };

  const findVisibleSentenceBoundaryIndex = (text) => {
    const value = normalizeText(text);
    if (!value) return -1;

    for (let i = 0; i < value.length; i += 1) {
      const ch = value[i];
      const isStrong = VISIBLE_STRONG_BOUNDARY_CHARS.has(ch);
      const isSoft = VISIBLE_SOFT_BOUNDARY_CHARS.has(ch);
      if (!isStrong && !isSoft) continue;

      // Do not split decimal numbers such as 3.5 or 1,000.
      if ((ch === '.' || ch === ',') && /\d/.test(value[i - 1] || '') && /\d/.test(value[i + 1] || '')) {
        continue;
      }

      const head = normalizeText(value.slice(0, i + 1));
      if (!head) continue;

      if (isStrong) return i + 1;

      // A comma is a preferred visual line break only when it already carries
      // enough meaning. This intentionally keeps fragments such as "I mean,"
      // attached to the following clause.
      if (hasCjk(head)) {
        if (head.replace(/\s+/g, '').length < 10) continue;
      } else if (countCaptionWords(head) < VISIBLE_MIN_WORDS_FOR_SOFT_BOUNDARY) {
        continue;
      }
      return i + 1;
    }
    return -1;
  };

  const splitVisibleCaptionAtBoundary = (text) => {
    const value = normalizeText(text);
    const boundaryIndex = findVisibleSentenceBoundaryIndex(value);
    if (boundaryIndex < 0) return null;

    const head = normalizeText(value.slice(0, boundaryIndex));
    const tail = stripLeadingBoundaryPunctuation(value.slice(boundaryIndex));
    if (!head) return null;
    return { head, tail };
  };

  const commitVisibleText = (text) => {
    const normalized = normalizeText(text);
    if (!normalized) return '';
    state.visibleBufferCommittedText = normalized;
    rememberVisibleCommittedSegment(normalized);
    return normalized;
  };

  const commitVisibleBuffer = () => commitVisibleText(state.visibleBufferText);

  const scheduleVisibleBufferFlush = (delayMs = VISIBLE_STABLE_DELAY_MS + 80) => {
    clearTimeout(state.visibleBufferTimer);
    state.visibleBufferTimer = setTimeout(() => {
      try {
        handleCaptionChange();
      } catch (error) {
        log('visible buffer flush failed', error);
      }
    }, delayMs);
  };

  const mergeRollingVisibleText = (previous, next) => {
    const a = normalizeText(previous);
    const b = normalizeText(next);
    if (!a) return b;
    if (!b) return a;
    if (looksLikeProgressiveCaption(a, b)) return mergeProgressiveVisibleText(a, b);
    if (endsWithSentencePunctuation(a)) return b;

    // YouTube's rolling two-line ASR window frequently replaces the DOM text
    // without textual overlap even though the speaker is still in the same
    // sentence. Keep accumulating until a semantic boundary is reached.
    return joinCaptionText(a, b);
  };

  // v0.52 emergency fallback for cases where timed-text cannot be loaded.
  // "Stable for 900ms" is no longer treated as a sentence boundary. We wait for
  // meaningful punctuation/length, while rolling DOM replacements are merged
  // into the same buffer instead of being committed as tiny phrases.
  const getStabilizedVisibleCaption = (visibleText) => {
    const rawText = normalizeText(visibleText);
    const text = trimCommittedPrefixFromVisibleText(rawText);
    const now = Date.now();

    if (rawText && !text) {
      scheduleVisibleBufferFlush(420);
      return null;
    }

    if (!text) {
      if (state.visibleBufferText && state.visibleBufferText !== state.visibleBufferCommittedText) {
        const buffered = normalizeText(state.visibleBufferText);
        const age = now - state.visibleBufferStartedAt;
        const wordCount = countCaptionWords(buffered);
        const canCommitOnEmpty =
          endsWithSentencePunctuation(buffered) ||
          buffered.length >= VISIBLE_MAX_CHARS ||
          wordCount >= VISIBLE_MAX_WORDS ||
          age >= VISIBLE_MAX_WAIT_MS;

        if (canCommitOnEmpty) {
          const committed = commitVisibleBuffer();
          resetVisibleBufferState(false);
          state.emptyCaptionTimer = setTimeout(() => {
            if (!getVisibleCaptionText()) hideOverlay();
          }, 1000);
          return committed;
        }

        // A brief empty native-caption frame often happens during YouTube's
        // rolling line replacement. Preserve the buffer instead of cutting it.
        scheduleVisibleBufferFlush(500);
        return null;
      }
      resetVisibleBufferState(false);
      return state.visibleBufferCommittedText ? null : '';
    }

    const prevRaw = state.lastVisibleRawText;
    const isProgressive = looksLikeProgressiveCaption(prevRaw, text) || looksLikeProgressiveCaption(state.visibleBufferText, text);
    if (isProgressive) state.visibleProgressiveScore = Math.min(8, state.visibleProgressiveScore + 1);
    else if (prevRaw && text !== prevRaw) state.visibleProgressiveScore = Math.max(0, state.visibleProgressiveScore - 1);
    state.visibleProgressiveMode = state.visibleProgressiveScore >= 1;
    state.lastVisibleRawText = text;

    if (!state.visibleBufferText) {
      state.visibleBufferText = text;
      state.visibleBufferStartedAt = now;
      state.visibleBufferUpdatedAt = now;
    } else if (text !== state.visibleBufferText) {
      state.visibleBufferText = mergeRollingVisibleText(state.visibleBufferText, text);
      state.visibleBufferUpdatedAt = now;
    }

    const buffered = normalizeText(state.visibleBufferText);
    const boundarySplit = splitVisibleCaptionAtBoundary(buffered);
    if (boundarySplit) {
      clearTimeout(state.visibleBufferTimer);
      const committed = commitVisibleText(boundarySplit.head);
      state.visibleBufferText = boundarySplit.tail;
      if (state.visibleBufferText) {
        state.visibleBufferStartedAt = now;
        state.visibleBufferUpdatedAt = now;
        scheduleVisibleBufferFlush();
      } else {
        state.visibleBufferStartedAt = 0;
        state.visibleBufferUpdatedAt = 0;
      }
      return committed;
    }

    const wordCount = countCaptionWords(buffered);
    const age = now - state.visibleBufferStartedAt;
    const shouldCommit =
      endsWithSentencePunctuation(buffered) ||
      buffered.length >= VISIBLE_MAX_CHARS ||
      wordCount >= VISIBLE_MAX_WORDS ||
      age >= VISIBLE_MAX_WAIT_MS;

    if (shouldCommit) {
      clearTimeout(state.visibleBufferTimer);
      return commitVisibleBuffer();
    }

    const remaining = Math.max(180, VISIBLE_MAX_WAIT_MS - age);
    scheduleVisibleBufferFlush(Math.min(1200, remaining));
    return null;
  };


  const findCurrentCueIndex = (_captionText = '') => {
    const cues = state.transcriptCues;
    if (!cues.length) return -1;

    const nowMs = getVideoCurrentMs();
    let low = 0;
    let high = cues.length - 1;
    let candidateIndex = -1;

    // Find the latest cue whose real sentence start is not in the future. The
    // visible rolling CC text is deliberately ignored here: timed-text owns the
    // YouTube VOD timeline once loaded.
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (cues[mid].startMs <= nowMs + 90) {
        candidateIndex = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    if (candidateIndex >= 0) {
      const cue = cues[candidateIndex];
      if (nowMs >= cue.startMs - 90 && nowMs <= cue.endMs + 180) return candidateIndex;
    }

    const nextIndex = candidateIndex + 1;
    if (nextIndex >= 0 && nextIndex < cues.length) {
      const next = cues[nextIndex];
      if (next.startMs - nowMs <= 90) return nextIndex;
    }

    return -1;
  };


  const getAdaptivePrefetchAheadMs = () => {
    const playbackRate = Math.max(0.25, Math.min(4, Number(getVideoElement()?.playbackRate || 1)));
    const extraMs = Math.max(0, playbackRate - 1) * PREFETCH_RATE_EXTRA_PER_1X_MS;
    return Math.round(Math.min(PREFETCH_AHEAD_MAX_MS, PREFETCH_AHEAD_BASE_MS + extraMs));
  };

  const getUpcomingCueTexts = (captionText) => {
    if (!state.transcriptCues.length) return [];
    let startIndex = findCurrentCueIndex(captionText || state.lastCaptionText);
    if (startIndex < 0) {
      const nowMs = getVideoCurrentMs();
      startIndex = state.transcriptCues.findIndex((cue) => cue.startMs >= nowMs - 500);
    }
    if (startIndex < 0) return [];

    const nowMs = getVideoCurrentMs();
    const nowEpoch = Date.now();
    const horizonMs = nowMs + getAdaptivePrefetchAheadMs();
    const upcoming = [];
    for (let index = startIndex; index < state.transcriptCues.length; index += 1) {
      const cue = state.transcriptCues[index];
      if (cue.startMs > horizonMs && upcoming.length >= PREFETCH_AHEAD_MIN_COUNT) break;
      if (upcoming.length >= PREFETCH_AHEAD_MAX_COUNT) break;
      if (!cue?.text || !cue?.key) continue;
      if (state.transcriptPrefetchedKeys.has(cue.key) || state.transcriptPrefetchingKeys.has(cue.key)) continue;
      const retryAfter = Number(state.transcriptPrefetchRetryAfter.get(cue.key) || 0);
      if (retryAfter > nowEpoch) continue;
      upcoming.push(cue);
    }
    return upcoming;
  };

  const clearPrefetchRetryState = (cueKey) => {
    state.transcriptPrefetchRetryAfter.delete(cueKey);
    state.transcriptPrefetchRetryAttempts.delete(cueKey);
  };

  const schedulePrefetchRetry = (cueKey) => {
    const previousAttempts = Number(state.transcriptPrefetchRetryAttempts.get(cueKey) || 0);
    const attempts = previousAttempts + 1;
    const delayIndex = Math.min(attempts - 1, PREFETCH_RETRY_DELAYS_MS.length - 1);
    const delayMs = PREFETCH_RETRY_DELAYS_MS[delayIndex];
    state.transcriptPrefetchRetryAttempts.set(cueKey, attempts);
    state.transcriptPrefetchRetryAfter.set(cueKey, Date.now() + delayMs);
    return delayMs;
  };

  const settlePrefetchResponse = (upcomingCues, response) => {
    const successfulTexts = new Set();
    (response?.results || []).forEach((item) => {
      const text = normalizeText(item?.text);
      const translatedText = normalizeText(item?.translatedText);
      if (!text || !translatedText) return;
      cacheDisplayTranslation(text, translatedText);
      successfulTexts.add(text);
    });

    let successCount = 0;
    let retryCount = 0;
    upcomingCues.forEach((cue) => {
      state.transcriptPrefetchingKeys.delete(cue.key);
      if (successfulTexts.has(normalizeText(cue.text))) {
        state.transcriptPrefetchedKeys.add(cue.key);
        clearPrefetchRetryState(cue.key);
        successCount += 1;
      } else {
        schedulePrefetchRetry(cue.key);
        retryCount += 1;
      }
    });
    return { successCount, retryCount };
  };

  const failPrefetchRequest = (upcomingCues) => {
    upcomingCues.forEach((cue) => {
      state.transcriptPrefetchingKeys.delete(cue.key);
      schedulePrefetchRetry(cue.key);
    });
  };

  const scheduleUpcomingPrefetch = (captionText, { immediate = false } = {}) => {
    clearTimeout(state.prefetchTimer);
    state.prefetchTimer = setTimeout(async () => {
      try {
        await ensureTranscriptForCurrentVideo(captionText || state.lastCaptionText);
        const upcomingCues = getUpcomingCueTexts(captionText || state.lastCaptionText);
        if (!upcomingCues.length) {
          log('prefetch skipped: no upcoming transcript cues');
          return;
        }

        upcomingCues.forEach((cue) => state.transcriptPrefetchingKeys.add(cue.key));
        const texts = upcomingCues.map((cue) => cue.text);
        const requestTranscriptSeq = state.transcriptSeq;
        const requestVideoId = getVideoId();

        sendMessage({
          type: 'YTBBI_PREFETCH_TRANSLATIONS',
          texts,
          sourceLang: CAPTION_SOURCE_LANG,
          targetLang: getCaptionTargetLang()
        }).then((response) => {
          if (requestTranscriptSeq !== state.transcriptSeq || requestVideoId !== getVideoId()) return;
          const settled = settlePrefetchResponse(upcomingCues, response);
          log('prefetch completed', settled.successCount, 'retry', settled.retryCount, response?.mode || '', texts[0]);
        }).catch((error) => {
          if (requestTranscriptSeq !== state.transcriptSeq || requestVideoId !== getVideoId()) return;
          failPrefetchRequest(upcomingCues);
          log('prefetch failed; retry scheduled', error);
        });

        log('prefetch queued', texts.length, texts[0]);
      } catch (error) {
        log('prefetch skipped', error);
      }
    }, immediate ? 0 : PREFETCH_DEBOUNCE_MS);
  };

  const explainTranslationError = (message) => {
    if (!message) return 'Translation failed';
    if (message === 'NO_GOOGLE_CLOUD_API_KEY') return '請在擴充功能設定填入 Google Cloud API Key，或改用免費 Google 模式';
    if (message === 'NO_CLOUD_V3_PROXY_URL') return '請在設定填入 Cloud Translation v3 proxy URL，或改用免費 Google 模式';
    if (/API key not valid|API_KEY_INVALID/i.test(message)) return 'Google Cloud API Key 無效';
    if (/billing|Billing/i.test(message)) return 'Google Cloud 專案可能尚未啟用 Billing';
    if (/Cloud Translation API has not been used|disabled/i.test(message)) return '請在 Google Cloud 啟用 Cloud Translation API，或改用免費 Google 模式';
    if (/All translation providers failed/i.test(message)) return '所有免費翻譯來源暫時失敗，可能被限流或網路不穩；外掛會在冷卻後自動重試';
    if (/Google Free Translate failed/i.test(message)) return '免費 Google 翻譯暫時失敗，正在嘗試備用翻譯來源';
    return message.length > 90 ? `${message.slice(0, 90)}…` : message;
  };


  const getStableTranscriptCaption = (_visibleText = '') => {
    if (!state.settings.transcriptFirstMode && !state.settings.stableAutoCaptions) return '';
    const videoId = getVideoId();
    if (state.transcriptVideoId && videoId && state.transcriptVideoId !== videoId) return '';
    if (!state.transcriptCues.length) return '';

    const index = findCurrentCueIndex();
    if (index < 0) return '';

    const cue = state.transcriptCues[index];
    const nowMs = getVideoCurrentMs();
    if (nowMs < cue.startMs - 90 || nowMs > cue.endMs + 180) return '';

    return normalizeText(cue.text);
  };

  const translateCaption = async (captionText, seq) => {
    const original = normalizeText(captionText);
    if (!original) return;

    const cacheKey = makeDisplayTranslationKey(original);
    const cached = getDisplayCachedTranslation(original);
    if (cached) {
      clearTimeout(state.translationStatusTimer);
      state.lastTranslatedText = cached;
      showOverlay({ original, translation: cached });
      return;
    }

    if (state.lastCaptionText === original && state.lastTranslatedText) {
      clearTimeout(state.translationStatusTimer);
      showOverlay({ original, translation: state.lastTranslatedText });
      return;
    }

    let promise = state.displayTranslationInflight.get(cacheKey);
    if (!promise) {
      promise = sendMessage({
        type: 'YTBBI_TRANSLATE_TEXT',
        text: original,
        sourceLang: CAPTION_SOURCE_LANG,
        targetLang: getCaptionTargetLang()
      }).then((response) => {
        if (!response || !response.ok) throw new Error(response?.error || 'Translation failed');
        const translated = normalizeText(response.translatedText);
        cacheDisplayTranslation(original, translated);
        return translated;
      }).finally(() => {
        state.displayTranslationInflight.delete(cacheKey);
      });
      state.displayTranslationInflight.set(cacheKey, promise);
    }

    // Do not flash “Translating…” for requests that will usually resolve from
    // background cache/prefetch in a few milliseconds. Show the status only if
    // it is still pending after a short delay.
    showOverlay({ original, translation: '' });
    clearTimeout(state.translationStatusTimer);
    state.translationStatusTimer = setTimeout(() => {
      if (seq === state.requestSeq && state.lastCaptionText === original && !getDisplayCachedTranslation(original)) {
        showOverlay({ original, translation: '', status: t('statusTranslating') });
      }
    }, 520);

    try {
      const translated = await promise;
      if (seq !== state.requestSeq) return;
      clearTimeout(state.translationStatusTimer);
      state.lastTranslatedText = translated;
      showOverlay({ original, translation: translated });
    } catch (error) {
      if (seq !== state.requestSeq) return;
      clearTimeout(state.translationStatusTimer);
      console.warn(`[${EXT_NAME}] Translation failed.`, error);
      showOverlay({ original, translation: '', status: explainTranslationError(error.message) });
    }
  };

  const handleCaptionChange = () => {
    if (!isSupportedVideoPage()) {
      deactivateForUnsupportedPage();
      return;
    }
    if (!state.settings.enabled) {
      hideOverlay(true);
      return;
    }

    syncActiveVideoContext();
    const currentVideoId = getVideoId();
    if (state.transcriptVideoId && currentVideoId && state.transcriptVideoId !== currentVideoId) resetTranscriptState();

    if (shouldBlockOverlayBecauseNativeCaptionsOff()) {
      clearCaptionDisplayState();
      return;
    }

    const nowMsForPauseGuard = getVideoCurrentMs();
    if (isVideoPaused() && state.lastCaptionText && Math.abs(nowMsForPauseGuard - state.lastHandledVideoTimeMs) < 140) {
      // When a video is paused, YouTube may still mutate caption DOM or our
      // transcript watcher may fire. Do not advance to future transcript cues
      // unless the user actually seeks to a different timestamp.
      return;
    }

    const visibleCaptionText = getVisibleCaptionText();
    ensureTranscriptForCurrentVideo(visibleCaptionText || state.lastCaptionText || '').catch((error) => log('timedtext load failed', error));

    const transcriptTimelineReady =
      state.transcriptCues.length > 0 &&
      (!state.transcriptVideoId || !currentVideoId || state.transcriptVideoId === currentVideoId) &&
      (state.settings.transcriptFirstMode || (state.transcriptIsAuto && state.settings.stableAutoCaptions));

    const transcriptStillStarting =
      !transcriptTimelineReady &&
      !!state.transcriptLoadingKey &&
      state.transcriptLoadStartedAt > 0 &&
      Date.now() - state.transcriptLoadStartedAt < 1800;

    let stableCaptionText = '';
    let captionText = '';

    if (transcriptTimelineReady) {
      // Once timed-text exists, it owns both sentence boundaries and display
      // timing. Never mix the rolling native DOM fallback into the same VOD
      // timeline; that was the main cause of phrase jumps and late captions.
      stableCaptionText = getStableTranscriptCaption();
      resetVisibleBufferState(false);
      captionText = stableCaptionText;
    } else if (transcriptStillStarting) {
      // Give YouTube timed-text a short startup grace period before falling back
      // to live DOM assembly. This avoids translating the first few growing
      // words while the full timed transcript is already being fetched.
      scheduleUpcomingPrefetch(visibleCaptionText || state.lastCaptionText);
      return;
    } else {
      captionText = getStabilizedVisibleCaption(visibleCaptionText);
    }

    if (captionText === null) {
      scheduleUpcomingPrefetch(visibleCaptionText || state.lastCaptionText);
      return;
    }

    if (!captionText) {
      state.lastCaptionText = '';
      state.lastTranslatedText = '';
      state.currentStableCaptionKey = '';
      // With an authoritative timed transcript, a gap means there is no active
      // sentence. Clear the previous subtitle instead of letting it linger.
      hideOverlay();
      scheduleUpcomingPrefetch(visibleCaptionText || '');
      return;
    }

    state.lastHandledVideoTimeMs = getVideoCurrentMs();

    const captionKey = stableCaptionText
      ? `stable|${findCurrentCueIndex()}|${captionText}`
      : `visible-stable|${captionText}`;

    const normalizedCaptionText = normalizeText(captionText);
    if (captionKey === state.currentStableCaptionKey && normalizedCaptionText === state.lastCaptionText) return;

    const previousText = state.lastCaptionText;
    const cachedTranslation = getDisplayCachedTranslation(normalizedCaptionText);
    const sameTextAsBefore = normalizedCaptionText && normalizedCaptionText === previousText;

    state.currentStableCaptionKey = captionKey;
    state.lastCaptionText = normalizedCaptionText;

    if (cachedTranslation) {
      state.lastTranslatedText = cachedTranslation;
    } else if (!sameTextAsBefore) {
      state.lastTranslatedText = '';
    }

    scheduleUpcomingPrefetch(normalizedCaptionText);

    // If only the internal cue key/index changed but the visible sentence is the
    // same, keep the existing translated overlay and avoid restarting the
    // translation pipeline.
    if (sameTextAsBefore && state.lastTranslatedText) {
      showOverlay({ original: normalizedCaptionText, translation: state.lastTranslatedText });
      return;
    }

    const seq = ++state.requestSeq;
    translateCaption(normalizedCaptionText, seq);
  };

  const getVideoTitle = () => {
    return normalizeText(
      document.querySelector('h1.ytd-watch-metadata')?.textContent ||
      document.querySelector('h1.title')?.textContent ||
      document.title ||
      ''
    );
  };

  const ensureLookupPopover = () => {
    if (state.lookupPopover && state.lookupPopover.isConnected) return state.lookupPopover;

    const popover = document.createElement('div');
    popover.className = 'ytbbi-popover';
    popover.setAttribute('role', 'dialog');
    markNoTranslate(popover);
    popover.innerHTML = `
      <div class="ytbbi-pop-head">
        <div>
          <strong class="ytbbi-pop-word"></strong>
          <span class="ytbbi-pop-phonetic"></span>
        </div>
        <button type="button" class="ytbbi-pop-close" aria-label="${escapeText(t('close'))}">×</button>
      </div>
      <div class="ytbbi-pop-body"></div>
    `;
    document.body.appendChild(popover);
    popover.querySelector('.ytbbi-pop-close').addEventListener('click', closeLookupPopover);
    popover.addEventListener('click', (event) => event.stopPropagation());
    state.lookupPopover = popover;
    return popover;
  };

  const closeLookupPopover = () => {
    if (state.lookupPopover) state.lookupPopover.classList.remove('ytbbi-pop-visible');
  };

  const positionLookupPopover = (anchor) => {
    const popover = ensureLookupPopover();
    const rect = anchor?.getBoundingClientRect?.() || { left: window.innerWidth / 2, top: window.innerHeight / 2, bottom: window.innerHeight / 2, width: 0 };
    const width = Math.min(360, Math.max(280, window.innerWidth - 24));
    popover.style.width = `${width}px`;

    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - width - 12));

    let top = rect.bottom + 10;
    if (top + 310 > window.innerHeight) top = Math.max(12, rect.top - 320);

    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  };

  const setPopoverLoading = (term, anchor) => {
    const popover = ensureLookupPopover();
    positionLookupPopover(anchor);
    popover.querySelector('.ytbbi-pop-word').textContent = term;
    popover.querySelector('.ytbbi-pop-phonetic').textContent = '';
    popover.querySelector('.ytbbi-pop-body').innerHTML = `
      <div class="ytbbi-loading">${escapeText(t('lookupLoading'))}</div>
    `;
    popover.classList.add('ytbbi-pop-visible');
  };

  const escapeText = (text) => String(text || '').replace(/[&<>"]/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
  }[ch]));

  const renderLookupResult = (result, anchor) => {
    const popover = ensureLookupPopover();
    positionLookupPopover(anchor);
    state.lastLookupEntry = result;

    const mode = state.settings.dictionaryMode || 'both';
    const showEn = mode === 'both' || mode === 'en';
    const showZh = mode === 'both' || mode === 'zh';

    popover.querySelector('.ytbbi-pop-word').textContent = result.word || result.term;
    popover.querySelector('.ytbbi-pop-phonetic').textContent = [result.phonetic, result.partOfSpeech].filter(Boolean).join(' · ');

    const body = popover.querySelector('.ytbbi-pop-body');
    const image = result.image || result.visualImage || null;
    const imageSrc = image?.dataUrl || image?.url || '';
    const imageHref = image?.sourceUrl || image?.url || '';
    const imageMarkup = imageSrc ? `
      <section class="ytbbi-pop-image-section">
        <a class="ytbbi-pop-image-link" href="${escapeText(imageHref || imageSrc)}" target="_blank" rel="noreferrer">
          <img class="ytbbi-pop-image" src="${escapeText(imageSrc)}" alt="${escapeText((result.word || result.term || 'word') + ' image')}" loading="lazy" />
          <span class="ytbbi-pop-image-caption">${escapeText(image.caption || image.title || image.source || t('wordImageCaption'))}</span>
        </a>
      </section>` : '';
    body.innerHTML = `
      ${imageMarkup}
      ${showZh ? `<section class="ytbbi-pop-section"><div class="ytbbi-pop-label">${escapeText(t('labelZh'))}</div><p>${escapeText(result.meaningZh || t('noZh'))}</p></section>` : ''}
      ${showEn ? `<section class="ytbbi-pop-section"><div class="ytbbi-pop-label">${escapeText(t('labelEn'))}</div><p>${escapeText(result.definitionEn || t('noEn'))}</p></section>` : ''}
      ${showZh && result.definitionZh ? `<section class="ytbbi-pop-section"><div class="ytbbi-pop-label">${escapeText(t('labelDefinitionZh'))}</div><p>${escapeText(result.definitionZh)}</p></section>` : ''}
      ${(showEn && result.exampleEn) ? `<section class="ytbbi-pop-section"><div class="ytbbi-pop-label">${escapeText(t('labelExampleEn'))}</div><p>${escapeText(result.exampleEn)}</p></section>` : ''}
      ${(showZh && result.exampleZh) ? `<section class="ytbbi-pop-section"><div class="ytbbi-pop-label">${escapeText(t('labelExampleZh'))}</div><p>${escapeText(result.exampleZh)}</p></section>` : ''}
      <div class="ytbbi-pop-actions">
        <button type="button" class="ytbbi-add-vocab">${escapeText(t('addVocab'))}</button>
        ${result.audio ? `<a class="ytbbi-audio" href="${escapeText(result.audio)}" target="_blank" rel="noreferrer">${escapeText(t('playAudio'))}</a>` : ''}
      </div>
      <div class="ytbbi-vocab-status" aria-live="polite"></div>
    `;

    body.querySelector('.ytbbi-pop-image')?.addEventListener('error', () => {
      body.querySelector('.ytbbi-pop-image-section')?.remove();
    });

    body.querySelector('.ytbbi-add-vocab')?.addEventListener('click', async () => {
      const status = body.querySelector('.ytbbi-vocab-status');
      status.textContent = t('addingVocab');
      try {
        const response = await sendMessage({ type: 'YTBBI_ADD_VOCAB', entry: result });
        if (!response?.ok) throw new Error(response?.error || 'Failed to add vocabulary');
        status.textContent = t('vocabAdded', { count: response.count });
      } catch (error) {
        status.textContent = t('vocabAddFailed', { error: explainTranslationError(error.message) });
      }
    });

    popover.classList.add('ytbbi-pop-visible');
  };

  const openLookup = async (term, anchor) => {
    if (!state.settings.interactiveLookup) return;
    const normalized = normalizeTerm(term);
    if (!normalized || !/[A-Za-z]/.test(normalized)) return;

    const seq = ++state.lookupAbortSeq;
    setPopoverLoading(normalized, anchor);

    try {
      const response = await sendMessage({
        type: 'YTBBI_LOOKUP_WORD',
        term: normalized,
        context: state.lastCaptionText,
        url: location.href,
        title: getVideoTitle(),
        targetLang: getCaptionTargetLang()
      });
      if (seq !== state.lookupAbortSeq) return;
      if (!response?.ok) throw new Error(response?.error || 'Lookup failed');
      renderLookupResult(response.result, anchor);
    } catch (error) {
      if (seq !== state.lookupAbortSeq) return;
      const popover = ensureLookupPopover();
      popover.querySelector('.ytbbi-pop-body').innerHTML = `<div class="ytbbi-error">查詢失敗：${escapeText(explainTranslationError(error.message))}</div>`;
    }
  };

  const scheduleCaptionRead = () => {
    clearTimeout(state.textTimer);
    if (!isSupportedVideoPage()) {
      deactivateForUnsupportedPage();
      return;
    }
    state.textTimer = setTimeout(handleCaptionChange, 80);
  };

  const isCaptionMutation = (mutation) => {
    const target = mutation.target?.nodeType === Node.TEXT_NODE
      ? mutation.target.parentElement
      : mutation.target;
    if (!target?.closest) return false;
    if (target.closest('.ytp-caption-window-container, .caption-window, .ytp-caption-segment')) return true;
    for (const node of mutation.addedNodes || []) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      if (node.matches?.('.ytp-caption-window-container, .caption-window, .ytp-caption-segment') ||
          node.querySelector?.('.ytp-caption-window-container, .caption-window, .ytp-caption-segment')) {
        return true;
      }
    }
    return false;
  };

  const isPlayerControlsMutation = (mutation) => {
    const target = mutation.target?.nodeType === Node.TEXT_NODE
      ? mutation.target.parentElement
      : mutation.target;
    if (!target?.closest) return false;
    if (target.closest('.ytp-right-controls, .ytp-chrome-controls, ytd-shorts-player-controls, .player-controls, ytd-reel-player-overlay-renderer')) return true;
    for (const node of mutation.addedNodes || []) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      if (node.matches?.('.ytp-right-controls, .ytp-chrome-controls, ytd-shorts-player-controls, .player-controls, ytd-reel-player-overlay-renderer') ||
          node.querySelector?.('.ytp-right-controls, .ytp-chrome-controls, ytd-shorts-player-controls, .player-controls, ytd-reel-player-overlay-renderer')) {
        return true;
      }
    }
    return false;
  };

  const syncActiveVideoContext = () => {
    if (!isSupportedVideoPage()) {
      deactivateForUnsupportedPage();
      return false;
    }
    const videoId = getVideoId();
    const player = findPlayer();
    const playerChanged = !!(player && state.activePlayerElement && player !== state.activePlayerElement);
    const videoChanged = !!(videoId && state.activeVideoId && videoId !== state.activeVideoId);

    if (!state.activeVideoId && videoId) state.activeVideoId = videoId;
    if (!state.activePlayerElement && player) state.activePlayerElement = player;

    if (!playerChanged && !videoChanged) return false;

    if (videoChanged) {
      state.nativeCaptionUserDisabledVideoId = '';
      state.nativeCaptionStateVideoId = videoId || '';
      state.lastKnownNativeCaptionActive = false;
    }

    state.activeVideoId = videoId || state.activeVideoId;
    state.activePlayerElement = player || state.activePlayerElement;
    state.lastCaptionText = '';
    state.lastTranslatedText = '';
    state.requestSeq += 1;
    resetTranscriptState();
    state.pageVideoId = '';
    state.pageSelectedTrack = null;
    state.pagePlayerResponse = null;
    resetVisibleBufferState();
    closeLookupPopover();
    ensureOverlay();
    protectNativeCaptionNodes(player || document);
    schedulePlayerToggleEnsure(120);
    applyOverlayPositionForCurrentVideo();
    scheduleCaptionRead();
    return true;
  };

  const startObserver = () => {
    if (state.observer) state.observer.disconnect();

    state.observer = new MutationObserver((mutations) => {
      let routeChanged = false;
      let captionChanged = false;
      let controlsChanged = false;

      if (location.href !== state.lastUrl) {
        routeChanged = true;
        state.lastUrl = location.href;
        state.lastCaptionText = '';
        state.lastTranslatedText = '';
        state.requestSeq += 1;
        resetTranscriptState();
        state.pageVideoId = '';
        state.pageSelectedTrack = null;
        state.pagePlayerResponse = null;
        if (!isSupportedVideoPage()) {
          deactivateForUnsupportedPage();
          return;
        }
        state.activeVideoId = getVideoId();
        state.activePlayerElement = findPlayer();
        closeLookupPopover();
        ensureOverlay();
        protectNativeCaptionNodes(findPlayer() || document);
        applyOverlayPositionForCurrentVideo();
      }

      if (!isSupportedVideoPage()) return;

      for (const mutation of mutations) {
        if (isCaptionMutation(mutation)) {
          captionChanged = true;
          protectCaptionMutation(mutation);
        }
        if (!controlsChanged && isPlayerControlsMutation(mutation)) controlsChanged = true;
      }

      if (routeChanged || controlsChanged) schedulePlayerToggleEnsure(routeChanged ? 100 : 450);
      if (routeChanged) refreshPagePlayerDataSoon();
      if (captionChanged) scheduleCaptionRead();
    });

    state.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  };

  const startRouteWatcher = () => {
    clearInterval(state.routeTimer);
    state.routeTimer = setInterval(() => {
      if (location.href !== state.lastUrl) {
        log('YouTube route changed:', location.href);
        state.lastUrl = location.href;
        state.lastCaptionText = '';
        state.lastTranslatedText = '';
        state.requestSeq += 1;
        resetTranscriptState();
        state.pageVideoId = '';
        state.pageSelectedTrack = null;
        state.pagePlayerResponse = null;
        if (!isSupportedVideoPage()) {
          deactivateForUnsupportedPage();
          return;
        }
        state.activeVideoId = getVideoId();
        state.activePlayerElement = findPlayer();
        closeLookupPopover();
        ensureOverlay();
        protectNativeCaptionNodes(findPlayer() || document);
        schedulePlayerToggleEnsure(100);
        refreshPagePlayerDataSoon();
        applyOverlayPositionForCurrentVideo();
        scheduleCaptionRead();
      }
    }, 800);
  };


  const installVideoEventListeners = () => {
    if (!isSupportedVideoPage()) {
      if (state.videoEventTarget && state.videoEventHandler) {
        ['play', 'playing', 'pause', 'seeked', 'seeking', 'timeupdate', 'ratechange'].forEach((eventName) => {
          state.videoEventTarget.removeEventListener(eventName, state.videoEventHandler, true);
        });
      }
      state.videoEventTarget = null;
      return;
    }
    const video = getVideoElement();
    if (!video || state.videoEventTarget === video) return;
    if (state.videoEventTarget) {
      ['play', 'playing', 'pause', 'seeked', 'seeking', 'timeupdate', 'ratechange'].forEach((eventName) => {
        state.videoEventTarget.removeEventListener(eventName, state.videoEventHandler, true);
      });
    }
    state.videoEventTarget = video;
    state.videoEventHandler = (event) => {
      if (!state.settings.enabled) return;
      const nowMs = getVideoCurrentMs();
      if (event.type === 'pause') {
        state.lastHandledVideoTimeMs = nowMs;
        return;
      }
      const isTimelineJump = event.type === 'seeking' || event.type === 'seeked';
      if (isTimelineJump) {
        state.currentStableCaptionKey = '';
        state.lastCaptionText = '';
        state.lastTranslatedText = '';
        resetVisibleBufferState(false);
      }
      scheduleCaptionRead();
      if (!isVideoPaused()) {
        scheduleUpcomingPrefetch(state.lastCaptionText, {
          immediate: isTimelineJump || event.type === 'play' || event.type === 'playing' || event.type === 'ratechange'
        });
      }
    };
    ['play', 'playing', 'pause', 'seeked', 'seeking', 'timeupdate', 'ratechange'].forEach((eventName) => {
      video.addEventListener(eventName, state.videoEventHandler, true);
    });
  };

  const startPlaybackWatcher = () => {
    clearInterval(state.playbackTimer);
    state.playbackTimer = setInterval(() => {
      if (!isSupportedVideoPage()) {
        deactivateForUnsupportedPage();
        return;
      }
      if (!state.playerToggleButton || !state.playerToggleButton.isConnected) schedulePlayerToggleEnsure(100);
      installVideoEventListeners();
      syncActiveVideoContext();
      if (!state.settings.enabled) return;
      if (shouldBlockOverlayBecauseNativeCaptionsOff()) {
        clearCaptionDisplayState();
        return;
      }
      if (isVideoPaused()) return;
      if (!state.transcriptCues.length) {
        ensureTranscriptForCurrentVideo(state.lastCaptionText || getVisibleCaptionText() || '').catch((error) => log('timedtext load failed', error));
        return;
      }
      scheduleCaptionRead();
      scheduleUpcomingPrefetch(state.lastCaptionText);
    }, 260);
  };

  const onSettingsChanged = async () => {
    state.settings = await storageGet();
    if (!isSupportedVideoPage()) {
      applySettingsToDom();
      deactivateForUnsupportedPage();
      return;
    }
    ensurePlayerToggle();
    applySettingsToDom();
    observeOverlayPlayerGeometry(findPlayer());
    scheduleOverlayGeometryUpdate();
    state.lastCaptionText = '';
    state.lastTranslatedText = '';
    state.requestSeq += 1;
    resetTranscriptState();
    closeLookupPopover();
    scheduleCaptionRead();
  };

  const installMessageListener = () => {
    try {
      EXT.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (!message || message.type !== 'YTBBI_SETTINGS_UPDATED') return false;
        onSettingsChanged().then(() => sendResponse({ ok: true }));
        return true;
      });
    } catch (error) {
      log('runtime.onMessage is unavailable:', error);
    }

    try {
      EXT.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        const changedKeys = Object.keys(changes || {});
        if (!changedKeys.some((key) => key in DEFAULT_SETTINGS)) return;
        onSettingsChanged();
      });
    } catch (error) {
      log('storage.onChanged is unavailable:', error);
    }

    document.addEventListener('click', (event) => {
      if (!state.lookupPopover?.classList.contains('ytbbi-pop-visible')) return;
      if (state.lookupPopover.contains(event.target)) return;
      if (event.target?.classList?.contains('ytbbi-word')) return;
      closeLookupPopover();
    }, true);
  };

  const init = async () => {
    if (state.initialized) return;
    if (!/youtube\.com/.test(location.hostname)) return;

    state.initialized = true;
    state.settings = await storageGet();
    installPageBridge();
    startObserver();
    startRouteWatcher();
    startPlaybackWatcher();
    installMessageListener();

    if (!isSupportedVideoPage()) {
      applySettingsToDom();
      deactivateForUnsupportedPage();
      log('initialized on non-video page', state.settings);
      return;
    }

    state.activeVideoId = getVideoId();
    state.activePlayerElement = findPlayer();
    ensureOverlay();
    protectNativeCaptionNodes(findPlayer() || document);
    ensurePlayerToggle();
    applyOverlayPositionForCurrentVideo();
    installVideoEventListeners();
    ensureTranscriptForCurrentVideo('').catch((error) => log('timedtext init failed', error));
    scheduleCaptionRead();
    log('initialized', state.settings);
  };

  init();
})();
