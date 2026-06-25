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
    batchSize: 5,
    transcriptFirstMode: true
  });

  const CAPTION_SOURCE_LANG = 'auto';
  const PREFETCH_AHEAD_MS = 30000;
  const PREFETCH_AHEAD_MAX_COUNT = 48;
  const VISIBLE_STABLE_DELAY_MS = 900;
  const VISIBLE_MIN_WORDS_FOR_QUICK_COMMIT = 4;
  const VISIBLE_MAX_WAIT_MS = 2800;
  const VISIBLE_MAX_CHARS = 118;
  const VISIBLE_SENTENCE_BOUNDARY_CHARS = new Set([',', '，', '、', '.', '。', '!', '！', '?', '？']);
  const VISIBLE_RECENT_COMMITTED_LIMIT = 8;

  const SELECTORS = [
    '.ytp-caption-segment',
    '.ytp-caption-window-container .caption-visual-line',
    '.caption-window .captions-text',
    '.caption-window span'
  ];

  const state = {
    settings: { ...DEFAULT_SETTINGS },
    observer: null,
    routeTimer: null,
    textTimer: null,
    hoverTimer: null,
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
    dragHandlersInstalled: false,
    originalEl: null,
    translationEl: null,
    statusEl: null,
    lookupPopover: null,
    lookupAbortSeq: 0,
    lastLookupEntry: null,
    transcriptKey: '',
    transcriptLoadingKey: '',
    transcriptSeq: 0,
    transcriptCues: [],
    transcriptRawCues: [],
    transcriptTrackLang: '',
    transcriptIsAuto: false,
    currentStableCaptionKey: '',
    transcriptPrefetchedKeys: new Set(),
    transcriptPrefetchingKeys: new Set(),
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
    lastRenderedOriginal: '',
    lastRenderedTranslation: '',
    lastRenderedStatus: '',
    translationStatusTimer: 0,
    initialized: false
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

  const findPlayer = () => {
    return (
      document.querySelector('.html5-video-player') ||
      document.querySelector('#movie_player') ||
      document.querySelector('ytd-player') ||
      document.querySelector('video')?.parentElement ||
      document.body
    );
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
      hideOverlay();
      return;
    }
    state.lastCaptionText = '';
    state.lastTranslatedText = '';
    scheduleCaptionRead();
  };

  const toggleBilingualMode = async () => {
    await setBilingualModeEnabled(!state.settings.enabled);
  };

  const ensurePlayerToggle = () => {
    const rightControls = document.querySelector('.ytp-right-controls');
    if (!rightControls) return null;

    let button = state.playerToggleButton;
    if (!button || !button.isConnected) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'ytp-button ytbbi-player-toggle';
      const iconUrl = EXT.runtime.getURL('icons/icon-48.png');
      button.innerHTML = `<span class="ytbbi-player-toggle-chip" aria-hidden="true"><img class="ytbbi-player-toggle-icon" src="${iconUrl}" alt=""></span>`;
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleBilingualMode().catch((error) => console.warn(`[${EXT_NAME}] Toggle failed.`, error));
      }, true);
      state.playerToggleButton = button;
    }

    // v0.24: avoid repeatedly moving the button on every YouTube UI mutation.
    // YouTube updates its player controls very often; moving our button every time
    // creates a mutation feedback loop that can freeze the player. Insert once,
    // then keep the existing position unless the button was detached.
    if (button.parentElement !== rightControls) {
      const ccButton = rightControls.querySelector('.ytp-subtitles-button');
      if (ccButton && ccButton.parentElement === rightControls) {
        ccButton.insertAdjacentElement('afterend', button);
      } else {
        rightControls.insertBefore(button, rightControls.firstElementChild || null);
      }
    }

    updatePlayerToggleState();
    return button;
  };

  const schedulePlayerToggleEnsure = (delay = 300) => {
    clearTimeout(state.playerToggleTimer);
    state.playerToggleTimer = setTimeout(() => {
      ensurePlayerToggle();
    }, delay);
  };

  const ensureOverlay = () => {
    const player = findPlayer();
    if (!player) return null;

    if (getComputedStyle(player).position === 'static') {
      player.style.position = 'relative';
    }

    if (!state.overlay || !state.overlay.isConnected) {
      const overlay = document.createElement('div');
      overlay.className = 'ytbbi-overlay';
      overlay.setAttribute('aria-live', 'polite');

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

      const translation = document.createElement('div');
      translation.className = 'ytbbi-translation';

      const status = document.createElement('div');
      status.className = 'ytbbi-status';

      card.append(dragHandle, original, translation, status);
      overlay.append(card);
      player.appendChild(overlay);

      state.overlay = overlay;
      state.overlayCard = card;
      state.dragHandle = dragHandle;
      state.dragHandlersInstalled = false;
      state.originalEl = original;
      state.translationEl = translation;
      state.statusEl = status;
    } else if (state.overlay.parentElement !== player) {
      player.appendChild(state.overlay);
    }

    installOverlayDragHandlers();
    applySettingsToDom();
    applyOverlayPositionForCurrentVideo();
    return state.overlay;
  };

  const applySettingsToDom = () => {
    const root = document.documentElement;
    root.style.setProperty('--ytbbi-font-size', `${state.settings.fontSize}px`);
    root.style.setProperty('--ytbbi-bottom', `${state.settings.bottomPercent}%`);
    root.style.setProperty('--ytbbi-max-width', `${state.settings.maxWidthPercent}%`);

    document.documentElement.classList.toggle(
      'ytbbi-hide-native-captions',
      !!state.settings.enabled
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
      word.addEventListener('mouseenter', () => {
        clearTimeout(state.hoverTimer);
        state.hoverTimer = setTimeout(() => openLookup(token, word, false), 420);
      });
      word.addEventListener('mouseleave', () => {
        clearTimeout(state.hoverTimer);
      });
      word.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        clearTimeout(state.hoverTimer);
        openLookup(token, word, true);
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
  };

  const hideOverlay = () => {
    if (state.overlay) state.overlay.classList.remove('ytbbi-visible');
  };

  const getVisibleCaptionText = () => {
    const pieces = [];
    const seen = new Set();

    for (const selector of SELECTORS) {
      document.querySelectorAll(selector).forEach((node) => {
        const rect = node.getBoundingClientRect();
        const text = normalizeText(node.textContent);
        if (!text) return;
        if (rect.width === 0 && rect.height === 0) return;
        if (seen.has(text)) return;
        seen.add(text);
        pieces.push(text);
      });
      if (pieces.length) break;
    }

    return normalizeText(pieces.join(' '));
  };

  const getVideoId = () => {
    try {
      const url = new URL(location.href);
      return url.searchParams.get('v') || '';
    } catch (_error) {
      return '';
    }
  };


  const getOverlayPositionStorageKey = () => {
    const videoId = getVideoId();
    return videoId ? `ytbbi-overlay-position:${videoId}` : '';
  };

  const readOverlayPositionForCurrentVideo = () => {
    const key = getOverlayPositionStorageKey();
    if (!key) return null;
    if (state.overlayDragPositions.has(key)) return state.overlayDragPositions.get(key);
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const left = Number(parsed.leftPercent);
      const top = Number(parsed.topPercent);
      if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
      const pos = {
        leftPercent: Math.max(0, Math.min(100, left)),
        topPercent: Math.max(0, Math.min(100, top))
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
    const pos = {
      leftPercent: Math.max(0, Math.min(100, Number(position.leftPercent) || 0)),
      topPercent: Math.max(0, Math.min(100, Number(position.topPercent) || 0))
    };
    state.overlayDragPositions.set(key, pos);
    try { sessionStorage.setItem(key, JSON.stringify(pos)); } catch (_error) {}
  };

  const clearOverlayPositionForCurrentVideo = () => {
    const key = getOverlayPositionStorageKey();
    if (!key) return;
    state.overlayDragPositions.delete(key);
    try { sessionStorage.removeItem(key); } catch (_error) {}
  };

  const applyOverlayPositionForCurrentVideo = () => {
    const overlay = state.overlay;
    if (!overlay) return;
    const pos = readOverlayPositionForCurrentVideo();
    if (pos) {
      overlay.classList.add('ytbbi-dragged');
      overlay.style.left = `${pos.leftPercent}%`;
      overlay.style.top = `${pos.topPercent}%`;
      overlay.style.bottom = 'auto';
      overlay.style.transform = 'none';
    } else {
      overlay.classList.remove('ytbbi-dragged', 'ytbbi-dragging');
      overlay.style.left = '50%';
      overlay.style.top = 'auto';
      overlay.style.bottom = 'var(--ytbbi-bottom)';
      overlay.style.transform = 'translateX(-50%)';
    }
  };

  const setDraggedOverlayPosition = (leftPx, topPx, playerRect, overlayRect, shouldSave = false) => {
    const overlay = state.overlay;
    if (!overlay || !playerRect || !overlayRect) return;
    const maxLeft = Math.max(0, playerRect.width - overlayRect.width);
    const maxTop = Math.max(0, playerRect.height - overlayRect.height);
    const clampedLeft = Math.max(0, Math.min(maxLeft, leftPx));
    const clampedTop = Math.max(0, Math.min(maxTop, topPx));
    const leftPercent = playerRect.width ? (clampedLeft / playerRect.width) * 100 : 50;
    const topPercent = playerRect.height ? (clampedTop / playerRect.height) * 100 : 50;

    overlay.classList.add('ytbbi-dragged');
    overlay.style.left = `${leftPercent}%`;
    overlay.style.top = `${topPercent}%`;
    overlay.style.bottom = 'auto';
    overlay.style.transform = 'none';

    if (shouldSave) saveOverlayPositionForCurrentVideo({ leftPercent, topPercent });
  };

  const installOverlayDragHandlers = () => {
    if (!state.overlay || !state.dragHandle || state.dragHandlersInstalled) return;
    state.dragHandlersInstalled = true;

    const onPointerMove = (event) => {
      const drag = state.dragState;
      if (!drag) return;
      event.preventDefault();
      const leftPx = event.clientX - drag.offsetX - drag.playerRect.left;
      const topPx = event.clientY - drag.offsetY - drag.playerRect.top;
      setDraggedOverlayPosition(leftPx, topPx, drag.playerRect, drag.overlayRect, false);
    };

    const stopDrag = (event) => {
      const drag = state.dragState;
      if (!drag) return;
      event?.preventDefault?.();
      const leftPx = (event?.clientX ?? drag.lastClientX ?? drag.startClientX) - drag.offsetX - drag.playerRect.left;
      const topPx = (event?.clientY ?? drag.lastClientY ?? drag.startClientY) - drag.offsetY - drag.playerRect.top;
      setDraggedOverlayPosition(leftPx, topPx, drag.playerRect, drag.overlayRect, true);
      state.overlay?.classList.remove('ytbbi-dragging');
      state.dragState = null;
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('pointerup', stopDrag, true);
      document.removeEventListener('pointercancel', stopDrag, true);
    };

    state.dragHandle.addEventListener('pointerdown', (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      const player = findPlayer();
      const overlay = state.overlay;
      if (!player || !overlay) return;
      event.preventDefault();
      event.stopPropagation();
      const playerRect = player.getBoundingClientRect();
      const overlayRect = overlay.getBoundingClientRect();
      state.dragState = {
        startClientX: event.clientX,
        startClientY: event.clientY,
        offsetX: event.clientX - overlayRect.left,
        offsetY: event.clientY - overlayRect.top,
        playerRect,
        overlayRect
      };
      overlay.classList.add('ytbbi-dragging');
      try { state.dragHandle.setPointerCapture?.(event.pointerId); } catch (_error) {}
      document.addEventListener('pointermove', onPointerMove, true);
      document.addEventListener('pointerup', stopDrag, true);
      document.addEventListener('pointercancel', stopDrag, true);
    });

    state.dragHandle.addEventListener('dblclick', (event) => {
      event.preventDefault();
      event.stopPropagation();
      clearOverlayPositionForCurrentVideo();
      applyOverlayPositionForCurrentVideo();
    });
  };

  const getVideoCurrentMs = () => {
    const video = document.querySelector('video');
    const seconds = Number(video?.currentTime || 0);
    return Number.isFinite(seconds) ? Math.max(0, Math.round(seconds * 1000)) : 0;
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
    state.transcriptSeq += 1;
    state.transcriptCues = [];
    state.transcriptRawCues = [];
    state.transcriptTrackLang = '';
    state.transcriptIsAuto = false;
    state.currentStableCaptionKey = '';
    state.transcriptPrefetchedKeys = new Set();
    state.transcriptPrefetchingKeys = new Set();
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
        if (message.playerResponse) state.pagePlayerResponse = cloneJson(message.playerResponse);
        if (message.selectedTrack) state.pageSelectedTrack = cloneJson(message.selectedTrack);
        if (message.audioTrack) state.pageAudioTrack = cloneJson(message.audioTrack);
        if (message.requestId && state.bridgeRequests.has(message.requestId)) {
          state.bridgeRequests.get(message.requestId)({
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
        resolve({ playerResponse: state.pagePlayerResponse, selectedTrack: state.pageSelectedTrack, audioTrack: state.pageAudioTrack });
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
    if (state.pagePlayerResponse?.captions) return cloneJson(state.pagePlayerResponse);

    try {
      const pageWindow = window.wrappedJSObject || window;
      const direct = pageWindow.ytInitialPlayerResponse;
      if (direct?.captions) return cloneJson(direct);
    } catch (_error) {
      // Content scripts may not be allowed to read page globals; script parsing below is the fallback.
    }

    try {
      const pageWindow = window.wrappedJSObject || window;
      const rawPlayerResponse = pageWindow.ytplayer?.config?.args?.raw_player_response;
      if (rawPlayerResponse) {
        const parsed = typeof rawPlayerResponse === 'string' ? JSON.parse(rawPlayerResponse) : rawPlayerResponse;
        if (parsed?.captions) return cloneJson(parsed);
      }
    } catch (_error) {
      // Some YouTube layouts expose caption tracks through ytplayer config instead of ytInitialPlayerResponse.
    }

    const scripts = Array.from(document.scripts || []).reverse();
    for (const script of scripts) {
      const text = script.textContent || '';
      if (!text.includes('ytInitialPlayerResponse')) continue;
      const response = extractJsonObjectAfterMarker(text, 'ytInitialPlayerResponse');
      if (response?.captions) return response;
    }
    return null;
  };

  const getCaptionTracks = () => {
    const response = getInitialPlayerResponse();
    const tracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    const list = Array.isArray(tracks) ? tracks.filter((track) => track?.baseUrl) : [];
    if (state.pageSelectedTrack?.baseUrl && !list.some((track) => track.baseUrl === state.pageSelectedTrack.baseUrl)) {
      list.unshift(state.pageSelectedTrack);
    }
    return list;
  };

  const chooseCaptionTrack = (tracks, captionText) => {
    if (!tracks.length) return null;
    if (state.pageSelectedTrack?.baseUrl) {
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
          const endMs = eventStart + (Number.isFinite(nextOffset) ? Math.max(nextOffset, offset + 200) : Math.max(eventDuration, offset + 450));
          tokens.push({ startMs, endMs, text });
        }
      } else {
        const text = getEventText(event);
        if (text) tokens.push({ startMs: eventStart, endMs: eventStart + Math.max(eventDuration, 900), text });
      }
    }
    return tokens.sort((a, b) => a.startMs - b.startMs);
  };

  const buildStableSegmentsFromTokens = (tokens) => {
    const result = [];
    let current = null;

    const flush = () => {
      if (!current) return;
      const text = normalizeText(current.text);
      if (text) {
        result.push({
          startMs: current.startMs,
          endMs: Math.max(current.endMs, current.startMs + 1000),
          text,
          key: `${current.startMs}|tok|${text}`
        });
      }
      current = null;
    };

    for (const token of tokens) {
      const text = normalizeText(token.text);
      if (!text) continue;
      if (!current) {
        current = { startMs: token.startMs, endMs: token.endMs, text };
        continue;
      }
      const gap = token.startMs - current.endMs;
      const duration = token.endMs - current.startMs;
      const shouldStartNew =
        gap > 950 ||
        duration > 9000 ||
        current.text.length > 145 ||
        endsWithSegmentBoundary(current.text) ||
        (endsWithSoftBoundary(current.text) && (duration > 4200 || current.text.length > 72));
      if (shouldStartNew) {
        flush();
        current = { startMs: token.startMs, endMs: token.endMs, text };
      } else {
        current.text = joinCaptionText(current.text, text);
        current.endMs = Math.max(current.endMs, token.endMs);
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
        return normalizeText(`${a} ${bWords.slice(size).join(' ')}`);
      }
    }

    const glue = hasCjk(a) || hasCjk(b) ? '' : ' ';
    return normalizeText(`${a}${glue}${b}`);
  };

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
        endMs: Math.max(current.endMs, current.startMs + 1200),
        text,
        key: `${current.startMs}|stable|${text}`
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
      const duration = cue.endMs - current.startMs;

      // YouTube ASR often emits progressive strings: "maybe" => "maybe their" =>
      // "maybe their whole life". Keep the longest version and avoid translating
      // every intermediate word.
      if (nextKey && curKey && (nextKey.startsWith(curKey) || nextKey.includes(curKey))) {
        current.text = text.length >= cur.length ? text : cur;
        current.endMs = Math.max(current.endMs, cue.endMs);
        continue;
      }

      if (curKey && nextKey && curKey.includes(nextKey)) {
        current.endMs = Math.max(current.endMs, cue.endMs);
        continue;
      }

      const shouldFlushBeforeAppend =
        gap > 950 ||
        endsWithSegmentBoundary(cur) ||
        duration > 9500 ||
        cur.length > 150 ||
        (endsWithSoftBoundary(cur) && (duration > 4800 || cur.length > 78));

      if (shouldFlushBeforeAppend) {
        flush();
        current = { startMs: cue.startMs, endMs: cue.endMs, text };
      } else {
        current.text = joinCaptionText(cur, text);
        current.endMs = Math.max(current.endMs, cue.endMs);
      }
    }

    flush();

    // Avoid excessively long on-screen paragraphs.
    const splitSegments = [];
    for (const segment of segments) {
      const text = segment.text;
      if (text.length <= 135) {
        splitSegments.push(segment);
        continue;
      }

      const parts = text
        .replace(/([,，、.!?。！？…])\s+/g, '$1|')
        .split('|')
        .map(normalizeText)
        .filter(Boolean);

      if (parts.length <= 1) {
        splitSegments.push(segment);
        continue;
      }

      const span = Math.max(900, Math.floor((segment.endMs - segment.startMs) / parts.length));
      parts.forEach((part, index) => {
        splitSegments.push({
          startMs: segment.startMs + index * span,
          endMs: index === parts.length - 1 ? segment.endMs : segment.startMs + (index + 1) * span,
          text: part,
          key: `${segment.startMs}|stable-split|${index}|${part}`
        });
      });
    }

    return splitSegments;
  };

  const normalizeTranscriptCueWindows = (cues) => {
    const normalized = (Array.isArray(cues) ? cues : [])
      .filter((cue) => cue?.text && Number.isFinite(cue.startMs))
      .sort((a, b) => a.startMs - b.startMs);

    for (let index = 0; index < normalized.length; index += 1) {
      const cue = normalized[index];
      const next = normalized[index + 1];
      const minEnd = cue.startMs + 900;
      const naturalEnd = Math.max(cue.endMs || 0, minEnd);
      cue.endMs = next
        ? Math.max(naturalEnd, Math.min(next.startMs + 120, next.startMs + 420))
        : naturalEnd;
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

    try {
      const fetched = await fetchTranscriptCues(track);
      if (seq !== state.transcriptSeq) return;
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
      state.transcriptRawCues = rawCues;
      state.transcriptCues = cues;
      state.transcriptTrackLang = track.languageCode || detected || 'auto';
      state.transcriptIsAuto = isAutoTrack;
      state.currentStableCaptionKey = '';
      state.transcriptPrefetchedKeys = new Set();
      log('timedtext loaded', state.transcriptTrackLang, cues.length, fetched.format || (isAutoTrack ? 'stable-auto' : 'manual'));
      scheduleUpcomingPrefetch(captionText || state.lastCaptionText || cues[0]?.text || '');
    } catch (error) {
      if (seq !== state.transcriptSeq) return;
      state.transcriptLoadingKey = '';
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
      if (!VISIBLE_SENTENCE_BOUNDARY_CHARS.has(ch)) continue;

      // Do not split decimal numbers such as 3.5 or 1,000.
      if ((ch === '.' || ch === ',') && /\d/.test(value[i - 1] || '') && /\d/.test(value[i + 1] || '')) {
        continue;
      }

      const head = normalizeText(value.slice(0, i + 1));
      if (!head) continue;

      // Avoid committing tiny fragments like "I," unless it is CJK text.
      if (!hasCjk(head) && countCaptionWords(head) < 2 && head.length < 8) continue;
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

  // YouTube auto-generated captions often appear as partial text streams:
  // "maybe" -> "maybe now" -> "maybe now and a while". If we translate every
  // mutation, the bilingual subtitle becomes one-word karaoke. This fallback
  // buffers visible caption mutations and only commits a readable phrase after
  // the text stops changing, reaches punctuation, or gets long enough.
  const getStabilizedVisibleCaption = (visibleText) => {
    const rawText = normalizeText(visibleText);
    const text = trimCommittedPrefixFromVisibleText(rawText);
    const now = Date.now();

    if (rawText && !text) {
      // The visible caption only contains a segment we already committed. Keep
      // the current overlay instead of triggering a duplicate translation.
      scheduleVisibleBufferFlush(360);
      return null;
    }

    if (!text) {
      if (state.visibleBufferText && state.visibleBufferText !== state.visibleBufferCommittedText) {
        const committed = commitVisibleBuffer();
        resetVisibleBufferState(false);
        state.emptyCaptionTimer = setTimeout(() => {
          if (!getVisibleCaptionText()) hideOverlay();
        }, 1800);
        return committed;
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
      scheduleVisibleBufferFlush();
      return null;
    }

    if (text !== state.visibleBufferText) {
      if (looksLikeProgressiveCaption(state.visibleBufferText, text)) {
        state.visibleBufferText = mergeProgressiveVisibleText(state.visibleBufferText, text);
        state.visibleBufferUpdatedAt = now;
      } else {
        const committed = commitVisibleBuffer();
        state.visibleBufferText = text;
        state.visibleBufferStartedAt = now;
        state.visibleBufferUpdatedAt = now;
        scheduleVisibleBufferFlush();
        return committed || null;
      }
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
    const stableFor = now - state.visibleBufferUpdatedAt;
    const age = now - state.visibleBufferStartedAt;
    const hasSentenceEnd = endsWithSentencePunctuation(buffered);
    const enoughWords = wordCount >= VISIBLE_MIN_WORDS_FOR_QUICK_COMMIT || hasCjk(buffered);
    const shouldCommit =
      hasSentenceEnd ||
      buffered.length >= VISIBLE_MAX_CHARS ||
      age >= VISIBLE_MAX_WAIT_MS ||
      (enoughWords && stableFor >= VISIBLE_STABLE_DELAY_MS);

    if (shouldCommit) {
      clearTimeout(state.visibleBufferTimer);
      return commitVisibleBuffer();
    }

    scheduleVisibleBufferFlush(Math.max(120, VISIBLE_STABLE_DELAY_MS - stableFor + 80));
    return null;
  };

  const findCurrentCueIndex = (captionText) => {
    const cues = state.transcriptCues;
    if (!cues.length) return -1;

    const nowMs = getVideoCurrentMs();

    // In v0.12 the visible YouTube caption text was used before currentTime.
    // That is dangerous for ASR captions because YouTube often keeps a rolling
    // two-line window on screen: the current visible text may still contain an
    // older phrase. Returning the first substring match made the overlay jump
    // back to an earlier fragment, which looked like missing subtitle content.
    // Prefer the timed transcript cue first; use visible text only as a fallback.
    const activeCandidates = cues
      .map((cue, index) => ({ cue, index }))
      .filter(({ cue }) => nowMs >= cue.startMs - 350 && nowMs <= cue.endMs + 900);

    if (activeCandidates.length) {
      activeCandidates.sort((a, b) => {
        const aInside = nowMs >= a.cue.startMs && nowMs <= a.cue.endMs ? 1 : 0;
        const bInside = nowMs >= b.cue.startMs && nowMs <= b.cue.endMs ? 1 : 0;
        if (aInside !== bInside) return bInside - aInside;
        return b.cue.startMs - a.cue.startMs;
      });
      return activeCandidates[0].index;
    }

    const visibleKey = captionSimilarityKey(captionText);
    if (visibleKey) {
      const candidates = cues
        .map((cue, index) => {
          const cueKey = captionSimilarityKey(cue.text);
          if (!cueKey) return null;
          const contains = cueKey.includes(visibleKey) || visibleKey.includes(cueKey);
          if (!contains) return null;
          const distance = Math.min(Math.abs(cue.startMs - nowMs), Math.abs(cue.endMs - nowMs));
          if (distance > 6500) return null;
          const overlap = Math.min(cueKey.length, visibleKey.length);
          return { index, cue, distance, overlap };
        })
        .filter(Boolean)
        .sort((a, b) => {
          if (a.distance !== b.distance) return a.distance - b.distance;
          if (a.overlap !== b.overlap) return b.overlap - a.overlap;
          return b.cue.startMs - a.cue.startMs;
        });
      if (candidates.length) return candidates[0].index;
    }

    const next = cues.findIndex((cue) => cue.startMs >= nowMs - 250);
    return next >= 0 ? next : cues.length - 1;
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
    const horizonMs = nowMs + PREFETCH_AHEAD_MS;
    const upcoming = [];
    for (let index = startIndex; index < state.transcriptCues.length; index += 1) {
      const cue = state.transcriptCues[index];
      if (cue.startMs > horizonMs && upcoming.length >= 8) break;
      if (upcoming.length >= PREFETCH_AHEAD_MAX_COUNT) break;
      if (!cue?.text || !cue?.key) continue;
      if (state.transcriptPrefetchedKeys.has(cue.key) || state.transcriptPrefetchingKeys.has(cue.key)) continue;
      upcoming.push(cue);
    }
    return upcoming;
  };


  const scheduleUpcomingPrefetch = (captionText) => {
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

        sendMessage({
          type: 'YTBBI_PREFETCH_TRANSLATIONS',
          texts,
          sourceLang: CAPTION_SOURCE_LANG,
          targetLang: getCaptionTargetLang()
        }).then((response) => {
          upcomingCues.forEach((cue) => {
            state.transcriptPrefetchingKeys.delete(cue.key);
            state.transcriptPrefetchedKeys.add(cue.key);
          });
          (response?.results || []).forEach((item) => {
            if (item?.text && item?.translatedText) cacheDisplayTranslation(item.text, item.translatedText);
          });
          log('prefetch completed', response?.count || 0, response?.mode || '', texts[0]);
        }).catch((error) => {
          upcomingCues.forEach((cue) => state.transcriptPrefetchingKeys.delete(cue.key));
          log('prefetch failed', error);
        });

        log('prefetch queued', texts.length, texts[0]);
      } catch (error) {
        log('prefetch skipped', error);
      }
    }, 120);
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


  const getStableTranscriptCaption = (visibleText = '') => {
    if (!state.settings.transcriptFirstMode && !state.settings.stableAutoCaptions) return '';
    if (!state.transcriptCues.length) return '';

    const index = findCurrentCueIndex(visibleText);
    if (index < 0) return '';

    const cue = state.transcriptCues[index];
    const nowMs = getVideoCurrentMs();
    if (nowMs < cue.startMs - 900 || nowMs > cue.endMs + 2600) return '';

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
    if (!state.settings.enabled) {
      hideOverlay();
      return;
    }

    const visibleCaptionText = getVisibleCaptionText();
    ensureTranscriptForCurrentVideo(visibleCaptionText || state.lastCaptionText || '').catch((error) => log('timedtext load failed', error));

    const stableCaptionText = getStableTranscriptCaption(visibleCaptionText);
    if (stableCaptionText) resetVisibleBufferState(false);

    const captionText = stableCaptionText || getStabilizedVisibleCaption(visibleCaptionText);

    if (captionText === null) {
      scheduleUpcomingPrefetch(visibleCaptionText || state.lastCaptionText);
      return;
    }

    if (!captionText) {
      state.lastCaptionText = '';
      state.lastTranslatedText = '';
      state.currentStableCaptionKey = '';
      hideOverlay();
      return;
    }

    const captionKey = stableCaptionText
      ? `stable|${findCurrentCueIndex(visibleCaptionText)}|${captionText}`
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
    const imageMarkup = image?.url ? `
      <section class="ytbbi-pop-image-section">
        <a class="ytbbi-pop-image-link" href="${escapeText(image.sourceUrl || image.url)}" target="_blank" rel="noreferrer">
          <img class="ytbbi-pop-image" src="${escapeText(image.url)}" alt="${escapeText((result.word || result.term || 'word') + ' image')}" loading="lazy" />
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

  const openLookup = async (term, anchor, pinned) => {
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
    if (target.closest('.ytp-right-controls, .ytp-chrome-controls')) return true;
    for (const node of mutation.addedNodes || []) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      if (node.matches?.('.ytp-right-controls, .ytp-chrome-controls') ||
          node.querySelector?.('.ytp-right-controls, .ytp-chrome-controls')) {
        return true;
      }
    }
    return false;
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
        closeLookupPopover();
        ensureOverlay();
        applyOverlayPositionForCurrentVideo();
      }

      for (const mutation of mutations) {
        if (!captionChanged && isCaptionMutation(mutation)) captionChanged = true;
        if (!controlsChanged && isPlayerControlsMutation(mutation)) controlsChanged = true;
        if (captionChanged && controlsChanged) break;
      }

      if (routeChanged || controlsChanged) schedulePlayerToggleEnsure(routeChanged ? 100 : 450);
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
        closeLookupPopover();
        ensureOverlay();
        schedulePlayerToggleEnsure(100);
        applyOverlayPositionForCurrentVideo();
        scheduleCaptionRead();
      }
    }, 800);
  };


  const startPlaybackWatcher = () => {
    clearInterval(state.playbackTimer);
    state.playbackTimer = setInterval(() => {
      if (!state.playerToggleButton || !state.playerToggleButton.isConnected) schedulePlayerToggleEnsure(100);
      if (!state.settings.enabled) return;
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
    ensurePlayerToggle();
    applySettingsToDom();
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
    ensureOverlay();
    ensurePlayerToggle();
    applyOverlayPositionForCurrentVideo();
    startObserver();
    startRouteWatcher();
    startPlaybackWatcher();
    installMessageListener();
    ensureTranscriptForCurrentVideo('').catch((error) => log('timedtext init failed', error));
    scheduleCaptionRead();
    log('initialized', state.settings);
  };

  init();
})();
