(() => {
  'use strict';

  const IS_BROWSER_PROMISE_API = typeof browser !== 'undefined';
  const EXT = IS_BROWSER_PROMISE_API ? browser : chrome;
  const MODULE_NAME = 'YT Bilingual Translator · Twitch';

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    twitchEnabled: true,
    uiLanguage: 'zh-TW',
    targetLang: 'zh-TW',
    showOriginal: true,
    showTranslation: true,
    hideNativeCaptions: true,
    fontSize: 18,
    bottomPercent: 12,
    maxWidthPercent: 92,
    sourceLang: 'auto',
    debug: false,
    interactiveLookup: true,
    dictionaryMode: 'both',
    showWordUnderline: true,
    recalculateOnScroll: true,
    recalculateOnViewportResize: true,
    observePlayerResize: true
  });

  const LIVE_MERGE_IDLE_MS = 120;
  const LIVE_MERGE_MAX_WAIT_MS = 320;
  const LIVE_MERGE_MAX_CHARS = 180;
  const OVERLAY_DRAG_START_DISTANCE_PX = 6;
  const OVERLAY_VIEWPORT_MARGIN_PX = 8;
  const TWITCH_CC_AUTO_RETRY_MS = 3500;
  const TEXTTRACK_SOURCE_LOCK_MS = 2000;
  const DOM_STABILIZE_IDLE_MS = 90;
  const DOM_STABILIZE_MAX_WAIT_MS = 220;

  const RESERVED_ROOT_PATHS = new Set([
    '', 'directory', 'downloads', 'jobs', 'p', 'settings', 'subscriptions',
    'inventory', 'drops', 'wallet', 'search', 'friends', 'messages', 'videos',
    'clip', 'clips', 'turbo', 'prime'
  ]);

  const TWITCH_CC_BUTTON_SELECTORS = [
    'button[data-a-target="player-closed-caption-button"]',
    'button[data-a-target*="caption" i]',
    'button[data-test-selector*="caption" i]',
    'button[aria-label*="closed caption" i]',
    'button[aria-label*="caption" i]',
    'button[aria-label*="subtitle" i]',
    'button[aria-label*="字幕" i]',
    'button[title*="closed caption" i]',
    'button[title*="caption" i]',
    'button[title*="subtitle" i]',
    'button[title*="字幕" i]'
  ].join(', ');

  const TWITCH_NATIVE_CAPTION_SELECTORS = [
    '[data-a-target="player-caption-overlay"]',
    '[data-a-target*="caption" i]:not(button)',
    '[data-test-selector*="caption" i]:not(button)',
    '[class*="closed-caption" i]',
    '[class*="caption-line" i]',
    '[class*="captions" i]'
  ].join(', ');

  const state = {
    settings: { ...DEFAULT_SETTINGS },
    initialized: false,
    channelKey: '',
    playerRoot: null,
    video: null,
    observer: null,
    routeTimer: 0,
    sourceTimer: 0,
    autoEnableTimer: 0,
    autoEnableLastAttemptAt: 0,
    boundTracks: new Map(),
    nativeCaptionNodes: new Set(),
    lastNativeText: '',
    lastAcceptedTextBySource: { texttrack: '', dom: '' },
    activeCaptionSource: 'none',
    lastTextTrackCueAt: 0,
    domCandidateText: '',
    domCandidateStartedAt: 0,
    domCandidateTimer: 0,
    pendingText: '',
    pendingStartedAt: 0,
    pendingUpdatedAt: 0,
    mergeTimer: 0,
    requestSeq: 0,
    translationCache: new Map(),
    translationInflight: new Map(),
    overlay: null,
    overlayCard: null,
    dragHandle: null,
    originalEl: null,
    translationEl: null,
    statusEl: null,
    overlayResizeObserver: null,
    overlayObservedPlayer: null,
    overlayGeometryRaf: 0,
    overlayGeometryHandlersInstalled: false,
    dragState: null,
    dragDocumentCleanup: null,
    suppressLookupClickUntil: 0,
    interactionActive: false,
    interactionTimer: 0,
    lookupPopover: null,
    lookupAbortSeq: 0,
    lastCaptionText: '',
    currentDisplayText: '',
    playerToggleButton: null
  };

  const I18N = globalThis.YTBBI_I18N;
  const t = (key, vars) => I18N?.t(state.settings.uiLanguage || 'zh-TW', key, vars) || key;

  const log = (...args) => {
    if (state.settings.debug) console.log(`[${MODULE_NAME}]`, ...args);
  };

  const isTwitchBilingualEnabled = () => !!state.settings.enabled && state.settings.twitchEnabled !== false;

  const normalizeText = (text) => String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const normalizeTerm = (text) => normalizeText(text)
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '')
    .trim();

  const escapeText = (text) => String(text || '').replace(/[&<>"]/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
  }[ch]));

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
      console.warn(`[${MODULE_NAME}] Failed to read settings`, error);
      return { ...DEFAULT_SETTINGS };
    }
  };

  const sendMessage = (message) => callMaybePromise(EXT.runtime.sendMessage, EXT.runtime, message);

  const getChannelKey = () => {
    const parts = location.pathname.split('/').filter(Boolean);
    if (parts.length !== 1) return '';
    const key = decodeURIComponent(parts[0] || '').toLowerCase();
    if (!key || RESERVED_ROOT_PATHS.has(key)) return '';
    return key;
  };

  const isSupportedTwitchLivePage = () => {
    if (!/(^|\.)twitch\.tv$/i.test(location.hostname)) return false;
    return !!getChannelKey();
  };

  const getVisibleScore = (element) => {
    if (!element?.getBoundingClientRect) return 0;
    const rect = element.getBoundingClientRect();
    if (rect.width < 80 || rect.height < 60) return 0;
    if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth) return 0;
    const visibleWidth = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
    const visibleHeight = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
    const visibleArea = visibleWidth * visibleHeight;
    const activeBonus = !element.paused && !element.ended ? 250000 : 0;
    return visibleArea + activeBonus;
  };

  const findActiveVideo = () => Array.from(document.querySelectorAll('video'))
    .map((video) => ({ video, score: getVisibleScore(video) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.video || null;

  const findPlayerRoot = (video = findActiveVideo()) => {
    if (!video) return null;
    return video.closest?.(
      '[data-a-target="video-player"], [data-test-selector="video-player"], .video-player, [class*="video-player" i]'
    ) || video.parentElement?.parentElement || video.parentElement || null;
  };

  const isCaptionTrack = (track) => /^(captions|subtitles)$/i.test(track?.kind || '');

  const getCaptionTracks = (video = state.video || findActiveVideo()) => {
    if (!video?.textTracks) return [];
    return Array.from(video.textTracks).filter(isCaptionTrack);
  };

  const getActiveCueText = (track) => {
    if (!track?.activeCues) return '';
    return normalizeText(Array.from(track.activeCues).map((cue) => cue?.text || '').filter(Boolean).join(' '));
  };

  const hasUsableCaptionTrack = () => getCaptionTracks().some((track) => track.mode !== 'disabled');

  const setTrackModeHidden = (track) => {
    if (!track || !isCaptionTrack(track)) return;
    try {
      if (isTwitchBilingualEnabled()) track.mode = 'hidden';
    } catch (_error) {}
  };

  const restoreTrackVisibility = () => {
    for (const track of getCaptionTracks()) {
      try {
        if (track.mode === 'hidden') track.mode = 'showing';
      } catch (_error) {}
    }
  };

  const bindCaptionTracks = () => {
    const currentTracks = new Set(getCaptionTracks());

    for (const [track, handler] of state.boundTracks.entries()) {
      if (currentTracks.has(track)) continue;
      try { track.removeEventListener('cuechange', handler); } catch (_error) {}
      state.boundTracks.delete(track);
    }

    for (const track of currentTracks) {
      if (!state.boundTracks.has(track)) {
        const handler = () => {
          setTrackModeHidden(track);
          const text = getActiveCueText(track);
          if (text) {
            state.lastTextTrackCueAt = Date.now();
            state.activeCaptionSource = 'texttrack';
            handleNativeCaptionText(text, 'texttrack');
          }
        };
        try { track.addEventListener('cuechange', handler); } catch (_error) {}
        state.boundTracks.set(track, handler);
      }
      setTrackModeHidden(track);
      const text = getActiveCueText(track);
      if (text && text !== state.lastAcceptedTextBySource.texttrack) {
        state.lastTextTrackCueAt = Date.now();
        state.activeCaptionSource = 'texttrack';
        handleNativeCaptionText(text, 'texttrack');
      }
    }
  };

  const isProbablyCaptionButton = (button) => {
    if (!(button instanceof HTMLButtonElement)) return false;
    if (button.closest('.tbt-twitch-overlay, .tbt-twitch-popover, .tbt-twitch-player-toggle')) return false;
    const player = state.playerRoot || findPlayerRoot();
    if (player && !player.contains(button)) return false;
    const signature = [
      button.getAttribute('aria-label'), button.getAttribute('title'),
      button.dataset?.aTarget, button.dataset?.testSelector, button.textContent
    ].filter(Boolean).join(' ');
    return /closed\s*caption|caption|subtitle|字幕|\bcc\b/i.test(signature);
  };

  const findCaptionButton = () => {
    const root = state.playerRoot || findPlayerRoot();
    const candidates = Array.from((root || document).querySelectorAll(TWITCH_CC_BUTTON_SELECTORS));
    return candidates.find(isProbablyCaptionButton) || null;
  };

  const captionButtonLooksEnabled = (button) => {
    if (!button) return false;
    if (button.getAttribute('aria-pressed') === 'true') return true;
    if (button.getAttribute('data-state') === 'on') return true;
    const signature = `${button.className || ''} ${button.getAttribute('data-a-state') || ''}`;
    return /active|enabled|selected|on\b/i.test(signature);
  };

  const updatePlayerToggleState = () => {
    const button = state.playerToggleButton;
    if (!button?.isConnected) return;
    const enabled = isTwitchBilingualEnabled();
    button.classList.toggle('tbt-twitch-player-toggle-on', enabled);
    button.classList.toggle('tbt-twitch-player-toggle-off', !enabled);
    button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    const title = enabled ? t('twitchPlayerToggleOnTitle') : t('twitchPlayerToggleOffTitle');
    button.title = title;
    button.setAttribute('aria-label', title);
  };

  const setTwitchBilingualEnabled = async (enabled) => {
    const next = !!enabled;
    state.settings = { ...state.settings, enabled: next ? true : state.settings.enabled, twitchEnabled: next };
    await callMaybePromise(EXT.storage.local.set, EXT.storage.local, next ? { enabled: true, twitchEnabled: true } : { twitchEnabled: false });
    updatePlayerToggleState();
    state.requestSeq += 1;
    clearTimeout(state.mergeTimer);
    clearTimeout(state.domCandidateTimer);
    state.pendingText = '';
    state.domCandidateText = '';
    state.lastNativeText = '';
    state.lastAcceptedTextBySource = { texttrack: '', dom: '' };
    state.activeCaptionSource = 'none';
    state.lastTextTrackCueAt = 0;
    if (!next) {
      hideOverlay(true);
      restoreNativeCaptionNodes();
      restoreTrackVisibility();
      return;
    }
    state.autoEnableLastAttemptAt = 0;
    syncContext();
  };

  const toggleTwitchBilingualMode = () => setTwitchBilingualEnabled(!isTwitchBilingualEnabled());

  // Keep the extension control geometrically neutral: mirror the native CC
  // button box instead of imposing a taller fixed box on Twitch's control row.
  const syncPlayerToggleGeometry = (nativeButton, button) => {
    if (!nativeButton?.getBoundingClientRect || !button?.style) return;
    const rect = nativeButton.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (width >= 24 && width <= 64) {
      button.style.setProperty('--tbt-twitch-control-width', `${width}px`);
    }
    if (height >= 24 && height <= 64) {
      button.style.setProperty('--tbt-twitch-control-height', `${height}px`);
    }
  };

  const ensurePlayerToggle = () => {
    if (!isSupportedTwitchLivePage()) {
      state.playerToggleButton?.remove?.();
      state.playerToggleButton = null;
      return null;
    }
    const nativeButton = findCaptionButton();
    const parent = nativeButton?.parentElement;
    if (!nativeButton || !parent) {
      state.playerToggleButton?.remove?.();
      state.playerToggleButton = null;
      return null;
    }

    let button = state.playerToggleButton;
    if (!button?.isConnected) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'tbt-twitch-player-toggle';
      button.innerHTML = '<span class="tbt-twitch-player-toggle-icon" aria-hidden="true"><svg class="tbt-twitch-player-toggle-svg" viewBox="0 0 36 36" focusable="false"><rect class="tbt-twitch-player-toggle-box" x="8.5" y="11.5" width="19" height="13" rx="3"></rect><circle class="tbt-twitch-player-toggle-badge" cx="25.5" cy="14.5" r="2.2"></circle><path class="tbt-twitch-player-toggle-line" d="M12 16h7"></path><path class="tbt-twitch-player-toggle-line" d="M12 20h11"></path><path class="tbt-twitch-player-toggle-mark" d="M24.2 14.5h2.6"></path></svg></span>';
      button.dataset.aTarget = 'tbt-bilingual-caption-button';
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleTwitchBilingualMode().catch((error) => console.warn(`[${MODULE_NAME}] toggle failed`, error));
      }, true);
      state.playerToggleButton = button;
    }

    if (button.parentElement !== parent || button.previousElementSibling !== nativeButton) {
      nativeButton.insertAdjacentElement('afterend', button);
    }
    syncPlayerToggleGeometry(nativeButton, button);
    updatePlayerToggleState();
    return button;
  };

  const attemptAutoEnableCaptions = () => {
    if (!isTwitchBilingualEnabled() || !isSupportedTwitchLivePage()) return;
    bindCaptionTracks();
    if (hasUsableCaptionTrack()) return;

    const now = Date.now();
    if (now - state.autoEnableLastAttemptAt < TWITCH_CC_AUTO_RETRY_MS) return;
    const button = findCaptionButton();
    if (!button) return;
    if (captionButtonLooksEnabled(button)) return;

    state.autoEnableLastAttemptAt = now;
    try {
      button.click();
      log('attempted to enable Twitch native captions');
      setTimeout(() => bindCaptionTracks(), 250);
      setTimeout(() => bindCaptionTracks(), 800);
    } catch (error) {
      log('caption auto-enable failed', error);
    }
  };

  const markNativeCaptionNode = (element) => {
    if (!(element instanceof HTMLElement)) return;
    if (element.closest('.tbt-twitch-overlay, .tbt-twitch-popover')) return;
    element.classList.add('tbt-twitch-native-caption-source');
    element.setAttribute('translate', 'no');
    element.classList.add('notranslate');
    state.nativeCaptionNodes.add(element);
  };

  const restoreNativeCaptionNodes = () => {
    for (const element of state.nativeCaptionNodes) {
      try { element.classList.remove('tbt-twitch-native-caption-source'); } catch (_error) {}
    }
    state.nativeCaptionNodes.clear();
  };

  const isPlausibleNativeCaptionElement = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    if (element.closest('.tbt-twitch-overlay, .tbt-twitch-popover')) return false;
    if (element.matches('button, input, textarea, [role="button"]')) return false;
    const player = state.playerRoot || findPlayerRoot();
    if (player && !player.contains(element)) return false;
    const text = normalizeText(element.textContent);
    if (!text || text.length > 420) return false;
    if (/^(字幕|captions?|closed captions?|subtitles?)\s*(\([a-z]\))?$/i.test(text)) return false;
    const rect = element.getBoundingClientRect?.();
    if (!rect || rect.width < 8 || rect.height < 8) return false;
    const videoRect = state.video?.getBoundingClientRect?.();
    if (videoRect) {
      const intersectsVideo = rect.right > videoRect.left && rect.left < videoRect.right && rect.bottom > videoRect.top && rect.top < videoRect.bottom;
      if (!intersectsVideo) return false;
    }
    return true;
  };

  const scoreCaptionCandidate = (element, text) => {
    const rect = element.getBoundingClientRect?.();
    if (!rect) return -Infinity;
    let score = Math.min(text.length, 240) * 4;
    const signature = `${element.getAttribute('data-a-target') || ''} ${element.getAttribute('data-test-selector') || ''} ${element.className || ''}`;
    if (/player-caption-overlay|closed-caption|caption-line/i.test(signature)) score += 180;
    if (element.children.length === 0) score += 20;
    score += Math.min(rect.width * rect.height / 1000, 80);
    return score;
  };

  const flushDomCandidate = () => {
    clearTimeout(state.domCandidateTimer);
    state.domCandidateTimer = 0;
    const text = normalizeText(state.domCandidateText);
    state.domCandidateText = '';
    state.domCandidateStartedAt = 0;
    if (!text || !isTwitchBilingualEnabled()) return;
    if (Date.now() - state.lastTextTrackCueAt < TEXTTRACK_SOURCE_LOCK_MS) return;
    state.activeCaptionSource = 'dom';
    handleNativeCaptionText(text, 'dom');
  };

  const scheduleDomCaptionCandidate = (text) => {
    const normalized = normalizeText(text);
    if (!normalized) return;
    const now = Date.now();
    if (!state.domCandidateStartedAt) state.domCandidateStartedAt = now;
    state.domCandidateText = normalized;
    clearTimeout(state.domCandidateTimer);
    const elapsed = now - state.domCandidateStartedAt;
    const delay = elapsed >= DOM_STABILIZE_MAX_WAIT_MS ? 0 : DOM_STABILIZE_IDLE_MS;
    state.domCandidateTimer = setTimeout(flushDomCandidate, delay);
  };

  const scanNativeCaptionDom = (root = state.playerRoot || document) => {
    if (!root?.querySelectorAll) return;
    const candidates = [];
    const seenText = new Set();
    for (const element of root.querySelectorAll(TWITCH_NATIVE_CAPTION_SELECTORS)) {
      if (!isPlausibleNativeCaptionElement(element)) continue;
      const text = normalizeText(element.textContent);
      if (!text) continue;
      markNativeCaptionNode(element);
      if (seenText.has(text)) continue;
      seenText.add(text);
      candidates.push({ element, text, score: scoreCaptionCandidate(element, text) });
    }
    if (!candidates.length) return;
    if (Date.now() - state.lastTextTrackCueAt < TEXTTRACK_SOURCE_LOCK_MS) return;
    candidates.sort((a, b) => b.score - a.score || b.text.length - a.text.length);
    scheduleDomCaptionCandidate(candidates[0].text);
  };

  const mergeCaptionText = (current, incoming) => {
    const a = normalizeText(current);
    const b = normalizeText(incoming);
    if (!a) return b;
    if (!b || a === b) return a;
    if (b.startsWith(a)) return b;
    if (a.startsWith(b)) return a;
    if (b.includes(a)) return b;
    if (a.includes(b)) return a;

    const aWords = a.split(' ');
    const bWords = b.split(' ');
    const maxOverlap = Math.min(6, aWords.length, bWords.length);
    for (let count = maxOverlap; count >= 1; count -= 1) {
      const tail = aWords.slice(-count).join(' ').toLowerCase();
      const head = bWords.slice(0, count).join(' ').toLowerCase();
      if (tail === head) return normalizeText(`${a} ${bWords.slice(count).join(' ')}`);
    }

    if (/[.!?。！？]$/.test(a) || `${a} ${b}`.length > LIVE_MERGE_MAX_CHARS) return b;
    return normalizeText(`${a} ${b}`);
  };

  const handleNativeCaptionText = (rawText, source) => {
    if (!isTwitchBilingualEnabled() || !isSupportedTwitchLivePage()) return;
    const text = normalizeText(rawText);
    if (!text) return;
    if (source === 'dom' && Date.now() - state.lastTextTrackCueAt < TEXTTRACK_SOURCE_LOCK_MS) return;
    if (state.lastAcceptedTextBySource[source] === text) return;
    state.lastAcceptedTextBySource[source] = text;
    if (text === state.lastNativeText && state.activeCaptionSource === source) return;
    state.lastNativeText = text;
    state.lastCaptionText = text;
    state.activeCaptionSource = source;

    const now = Date.now();
    if (!state.pendingText) {
      state.pendingText = text;
      state.pendingStartedAt = now;
    } else {
      const elapsed = now - state.pendingStartedAt;
      if (elapsed >= LIVE_MERGE_MAX_WAIT_MS) {
        flushPendingCaption();
        state.pendingText = text;
        state.pendingStartedAt = now;
      } else {
        state.pendingText = mergeCaptionText(state.pendingText, text);
      }
    }
    state.pendingUpdatedAt = now;

    clearTimeout(state.mergeTimer);
    state.mergeTimer = setTimeout(flushPendingCaption, LIVE_MERGE_IDLE_MS);
    log('caption', source, text);
  };

  const getTranslation = (text) => {
    const normalized = normalizeText(text);
    if (!normalized) return Promise.resolve('');
    if (state.translationCache.has(normalized)) return Promise.resolve(state.translationCache.get(normalized));
    if (state.translationInflight.has(normalized)) return state.translationInflight.get(normalized);

    const promise = sendMessage({
      type: 'YTBBI_TRANSLATE_TEXT',
      text: normalized,
      sourceLang: state.settings.sourceLang || 'auto',
      targetLang: state.settings.targetLang || 'zh-TW'
    }).then((response) => {
      if (!response?.ok) throw new Error(response?.error || 'Translation failed');
      const translated = normalizeText(response.translatedText);
      if (translated) {
        state.translationCache.set(normalized, translated);
        if (state.translationCache.size > 500) state.translationCache.delete(state.translationCache.keys().next().value);
      }
      return translated;
    }).finally(() => state.translationInflight.delete(normalized));

    state.translationInflight.set(normalized, promise);
    return promise;
  };

  function flushPendingCaption() {
    clearTimeout(state.mergeTimer);
    state.mergeTimer = 0;
    const text = normalizeText(state.pendingText);
    state.pendingText = '';
    state.pendingStartedAt = 0;
    state.pendingUpdatedAt = 0;
    if (!text || !isTwitchBilingualEnabled()) return;

    state.currentDisplayText = text;
    const seq = ++state.requestSeq;
    const cached = state.translationCache.get(text);
    if (cached) {
      showOverlay({ original: text, translation: cached });
      return;
    }

    showOverlay({ original: text, translation: '', status: t('statusTranslating') });
    getTranslation(text).then((translated) => {
      if (!translated) return;
      if (seq !== state.requestSeq && state.currentDisplayText !== text) return;
      if (state.currentDisplayText === text || state.lastNativeText === text) {
        showOverlay({ original: text, translation: translated });
      }
    }).catch((error) => {
      log('translation failed', error);
      if (state.currentDisplayText === text) showOverlay({ original: text, translation: '', status: error?.message || 'Translation failed' });
    });
  }

  const getOverlayHost = () => document.fullscreenElement || document.body || document.documentElement;

  const ensureOverlayHost = () => {
    const host = getOverlayHost();
    if (state.overlay && host && state.overlay.parentElement !== host) host.appendChild(state.overlay);
    if (state.lookupPopover && state.lookupPopover.parentElement !== document.body) document.body.appendChild(state.lookupPopover);
  };

  const markNoTranslate = (element) => {
    if (!(element instanceof HTMLElement)) return;
    element.setAttribute('translate', 'no');
    element.classList.add('notranslate');
  };

  const renderOriginal = (text) => {
    if (!state.originalEl) return;
    const value = normalizeText(text);
    state.originalEl.replaceChildren();
    if (!value) return;

    if (!state.settings.interactiveLookup) {
      state.originalEl.textContent = value;
      return;
    }

    const pieces = value.match(/[A-Za-z][A-Za-z0-9'’-]*|[^A-Za-z]+/g) || [value];
    for (const token of pieces) {
      if (/^[A-Za-z]/.test(token)) {
        const word = document.createElement('button');
        word.type = 'button';
        word.className = 'tbt-twitch-word';
        word.textContent = token;
        word.title = t('wordTitle');
        word.addEventListener('click', (event) => {
          if (Date.now() < state.suppressLookupClickUntil) return;
          event.preventDefault();
          event.stopPropagation();
          openLookup(token, word);
        });
        state.originalEl.appendChild(word);
      } else {
        state.originalEl.appendChild(document.createTextNode(token));
      }
    }
  };

  const ensureOverlay = () => {
    if (!isSupportedTwitchLivePage()) return null;
    const player = state.playerRoot || findPlayerRoot();
    if (!player) return null;

    if (!state.overlay?.isConnected) {
      const overlay = document.createElement('div');
      overlay.className = 'tbt-twitch-overlay';
      overlay.setAttribute('aria-live', 'polite');
      markNoTranslate(overlay);

      const card = document.createElement('div');
      card.className = 'tbt-twitch-card';

      const dragHandle = document.createElement('button');
      dragHandle.type = 'button';
      dragHandle.className = 'tbt-twitch-drag-handle';
      dragHandle.textContent = '⋮⋮';
      dragHandle.title = t('dragHandleTitle');
      dragHandle.setAttribute('aria-label', t('dragHandleTitle'));

      const original = document.createElement('div');
      original.className = 'tbt-twitch-original';
      markNoTranslate(original);

      const translation = document.createElement('div');
      translation.className = 'tbt-twitch-translation';
      markNoTranslate(translation);

      const status = document.createElement('div');
      status.className = 'tbt-twitch-status';
      markNoTranslate(status);

      card.append(dragHandle, original, translation, status);
      overlay.appendChild(card);
      getOverlayHost().appendChild(overlay);

      state.overlay = overlay;
      state.overlayCard = card;
      state.dragHandle = dragHandle;
      state.originalEl = original;
      state.translationEl = translation;
      state.statusEl = status;
      installDragHandlers();
      installInteractionHandlers();
      installGeometryHandlers();
    }

    ensureOverlayHost();
    applySettingsToDom();
    observePlayerGeometry(player);
    applyOverlayPosition();
    return state.overlay;
  };

  const showOverlay = ({ original = '', translation = '', status = '' }) => {
    if (!isTwitchBilingualEnabled()) return;
    const overlay = ensureOverlay();
    if (!overlay) return;

    const normalizedOriginal = normalizeText(original);
    const normalizedTranslation = normalizeText(translation);
    state.currentDisplayText = normalizedOriginal || state.currentDisplayText;

    if (state.settings.showOriginal) renderOriginal(normalizedOriginal);
    else state.originalEl.replaceChildren();
    state.translationEl.textContent = state.settings.showTranslation ? normalizedTranslation : '';
    state.statusEl.textContent = status || '';

    state.originalEl.hidden = !state.settings.showOriginal || !normalizedOriginal;
    state.translationEl.hidden = !state.settings.showTranslation || !normalizedTranslation;
    state.statusEl.hidden = !status;

    if (!state.settings.showOriginal && !state.settings.showTranslation) return hideOverlay(true);
    applyOverlayPosition();
    overlay.classList.add('tbt-twitch-visible');
  };

  const hideOverlay = (force = false) => {
    if (!state.overlay) return;
    if (!force && (state.interactionActive || state.dragState)) return;
    state.overlay.classList.remove('tbt-twitch-visible', 'tbt-twitch-interacting', 'tbt-twitch-dragging');
  };

  const destroyOverlay = () => {
    state.dragDocumentCleanup?.();
    state.dragDocumentCleanup = null;
    state.dragState = null;
    state.overlayResizeObserver?.disconnect?.();
    state.overlayResizeObserver = null;
    state.overlayObservedPlayer = null;
    state.overlay?.remove();
    state.lookupPopover?.remove();
    state.overlay = null;
    state.overlayCard = null;
    state.dragHandle = null;
    state.originalEl = null;
    state.translationEl = null;
    state.statusEl = null;
    state.lookupPopover = null;
  };

  const applySettingsToDom = () => {
    const root = document.documentElement;
    root.style.setProperty('--tbt-twitch-font-size', `${Number(state.settings.fontSize || 18)}px`);
    root.style.setProperty('--tbt-twitch-bottom', `${Number(state.settings.bottomPercent || 12)}%`);
    root.style.setProperty('--tbt-twitch-max-width', `${Number(state.settings.maxWidthPercent || 92)}%`);
    root.classList.toggle('tbt-twitch-word-underline', !!state.settings.showWordUnderline);
  };

  const getPositionStorageKey = () => state.channelKey ? `tbt-twitch-overlay-position:${state.channelKey}` : '';

  const loadSavedPosition = () => {
    const key = getPositionStorageKey();
    if (!key) return null;
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const value = JSON.parse(raw);
      if (value?.mode !== 'page' || value?.anchor !== 'center') return null;
      if (!Number.isFinite(Number(value.pageCenterX)) || !Number.isFinite(Number(value.pageCenterY))) return null;
      return {
        mode: 'page', anchor: 'center',
        pageCenterX: Number(value.pageCenterX), pageCenterY: Number(value.pageCenterY)
      };
    } catch (_error) {
      return null;
    }
  };

  const savePageCenter = (clientLeft, clientTop, width, height) => {
    const key = getPositionStorageKey();
    if (!key) return;
    const payload = {
      mode: 'page', anchor: 'center',
      pageCenterX: scrollX + clientLeft + width / 2,
      pageCenterY: scrollY + clientTop + height / 2
    };
    try { sessionStorage.setItem(key, JSON.stringify(payload)); } catch (_error) {}
  };

  const clearSavedPosition = () => {
    const key = getPositionStorageKey();
    if (!key) return;
    try { sessionStorage.removeItem(key); } catch (_error) {}
  };

  const clampToViewport = (left, top, width, height) => ({
    left: Math.max(OVERLAY_VIEWPORT_MARGIN_PX, Math.min(left, innerWidth - width - OVERLAY_VIEWPORT_MARGIN_PX)),
    top: Math.max(OVERLAY_VIEWPORT_MARGIN_PX, Math.min(top, innerHeight - height - OVERLAY_VIEWPORT_MARGIN_PX))
  });

  const applyOverlayPosition = () => {
    const overlay = state.overlay;
    const player = state.playerRoot || findPlayerRoot();
    if (!overlay || !player || state.dragState?.started) return;

    const overlayRect = overlay.getBoundingClientRect();
    const saved = loadSavedPosition();
    if (saved && !document.fullscreenElement) {
      const left = saved.pageCenterX - scrollX - overlayRect.width / 2;
      const top = saved.pageCenterY - scrollY - overlayRect.height / 2;
      overlay.style.left = `${left}px`;
      overlay.style.top = `${top}px`;
      overlay.style.transform = 'none';
      overlay.classList.add('tbt-twitch-dragged', 'tbt-twitch-page-position');

      const outside = left + overlayRect.width <= 0 || top + overlayRect.height <= 0 || left >= innerWidth || top >= innerHeight;
      overlay.classList.toggle('tbt-twitch-outside-viewport', outside);
      return;
    }

    const playerRect = player.getBoundingClientRect();
    const maxWidthPx = Math.max(220, playerRect.width * Math.min(1, Number(state.settings.maxWidthPercent || 92) / 100));
    overlay.style.setProperty('--tbt-twitch-overlay-max-width', `${maxWidthPx}px`);
    const left = playerRect.left + playerRect.width / 2;
    const bottomOffset = playerRect.height * Math.max(0, Math.min(100, Number(state.settings.bottomPercent || 12))) / 100;
    const top = Math.max(OVERLAY_VIEWPORT_MARGIN_PX, playerRect.bottom - bottomOffset - overlayRect.height);
    overlay.style.left = `${left}px`;
    overlay.style.top = `${top}px`;
    overlay.style.transform = 'translateX(-50%)';
    overlay.classList.remove('tbt-twitch-dragged', 'tbt-twitch-page-position', 'tbt-twitch-outside-viewport');
  };

  const scheduleGeometryUpdate = () => {
    if (state.overlayGeometryRaf) return;
    state.overlayGeometryRaf = requestAnimationFrame(() => {
      state.overlayGeometryRaf = 0;
      if (!state.overlay?.isConnected || !isSupportedTwitchLivePage()) return;
      if (!state.overlay.classList.contains('tbt-twitch-visible') && !state.dragState) return;
      ensureOverlayHost();
      applyOverlayPosition();
    });
  };

  const observePlayerGeometry = (player) => {
    if (state.settings.observePlayerResize === false) {
      state.overlayResizeObserver?.disconnect?.();
      state.overlayResizeObserver = null;
      state.overlayObservedPlayer = null;
      return;
    }
    if (!player || state.overlayObservedPlayer === player || typeof ResizeObserver !== 'function') return;
    state.overlayResizeObserver?.disconnect?.();
    state.overlayObservedPlayer = player;
    state.overlayResizeObserver = new ResizeObserver(scheduleGeometryUpdate);
    state.overlayResizeObserver.observe(player);
  };

  const installGeometryHandlers = () => {
    if (state.overlayGeometryHandlersInstalled) return;
    state.overlayGeometryHandlersInstalled = true;
    window.addEventListener('scroll', () => {
      if (state.settings.recalculateOnScroll !== false) scheduleGeometryUpdate();
    }, { passive: true, capture: true });
    window.addEventListener('resize', () => {
      if (state.settings.recalculateOnViewportResize !== false) scheduleGeometryUpdate();
    }, { passive: true });
    document.addEventListener('fullscreenchange', () => {
      ensureOverlayHost();
      scheduleGeometryUpdate();
    });
  };

  const setInteractionActive = (active) => {
    clearTimeout(state.interactionTimer);
    state.interactionActive = !!active;
    state.overlay?.classList.toggle('tbt-twitch-interacting', state.interactionActive);
    if (!active) state.interactionTimer = setTimeout(() => {
      state.interactionActive = false;
      state.overlay?.classList.remove('tbt-twitch-interacting');
    }, 140);
  };

  const installInteractionHandlers = () => {
    if (!state.overlayCard || state.overlayCard.dataset.tbtInteraction === '1') return;
    state.overlayCard.dataset.tbtInteraction = '1';
    state.overlayCard.addEventListener('mouseenter', () => setInteractionActive(true));
    state.overlayCard.addEventListener('mouseleave', () => setInteractionActive(false));
    state.overlayCard.addEventListener('focusin', () => setInteractionActive(true));
    state.overlayCard.addEventListener('focusout', () => setInteractionActive(false));
  };

  const installDragHandlers = () => {
    const card = state.overlayCard;
    const handle = state.dragHandle;
    if (!card || !handle || card.dataset.tbtDrag === '1') return;
    card.dataset.tbtDrag = '1';

    const cleanup = () => {
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', onPointerUp, true);
    };

    const onPointerMove = (event) => {
      const drag = state.dragState;
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (!drag.started) {
        const distance = Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY);
        if (distance < OVERLAY_DRAG_START_DISTANCE_PX) return;
        drag.started = true;
        state.overlay.classList.add('tbt-twitch-dragging');
        state.suppressLookupClickUntil = Date.now() + 350;
        closeLookupPopover();
      }
      event.preventDefault();
      event.stopPropagation();
      const rawLeft = event.clientX - drag.offsetX;
      const rawTop = event.clientY - drag.offsetY;
      const pos = clampToViewport(rawLeft, rawTop, drag.width, drag.height);
      state.overlay.style.left = `${pos.left}px`;
      state.overlay.style.top = `${pos.top}px`;
      state.overlay.style.transform = 'none';
      state.overlay.classList.add('tbt-twitch-page-position');
      state.overlay.classList.remove('tbt-twitch-outside-viewport');
      drag.lastLeft = pos.left;
      drag.lastTop = pos.top;
    };

    const onPointerUp = (event) => {
      const drag = state.dragState;
      if (!drag || (event.pointerId != null && event.pointerId !== drag.pointerId)) return;
      if (drag.started) {
        savePageCenter(drag.lastLeft ?? drag.startLeft, drag.lastTop ?? drag.startTop, drag.width, drag.height);
        state.suppressLookupClickUntil = Date.now() + 350;
      }
      state.overlay?.classList.remove('tbt-twitch-dragging');
      state.dragState = null;
      cleanup();
      state.dragDocumentCleanup = null;
      scheduleGeometryUpdate();
    };

    card.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.isPrimary === false) return;
      const rect = state.overlay.getBoundingClientRect();
      state.dragState = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        width: rect.width,
        height: rect.height,
        startLeft: rect.left,
        startTop: rect.top,
        lastLeft: rect.left,
        lastTop: rect.top,
        started: false
      };
      event.stopPropagation();
      cleanup();
      document.addEventListener('pointermove', onPointerMove, true);
      document.addEventListener('pointerup', onPointerUp, true);
      document.addEventListener('pointercancel', onPointerUp, true);
      state.dragDocumentCleanup = cleanup;
    });

    card.addEventListener('click', (event) => {
      if (Date.now() < state.suppressLookupClickUntil) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    });

    handle.addEventListener('dblclick', (event) => {
      event.preventDefault();
      event.stopPropagation();
      clearSavedPosition();
      applyOverlayPosition();
    });
  };

  const ensureLookupPopover = () => {
    if (state.lookupPopover?.isConnected) return state.lookupPopover;
    const popover = document.createElement('div');
    popover.className = 'tbt-twitch-popover';
    popover.setAttribute('role', 'dialog');
    markNoTranslate(popover);
    popover.innerHTML = `
      <div class="tbt-twitch-pop-head">
        <div><strong class="tbt-twitch-pop-word"></strong><span class="tbt-twitch-pop-phonetic"></span></div>
        <button type="button" class="tbt-twitch-pop-close" aria-label="${escapeText(t('close'))}">×</button>
      </div>
      <div class="tbt-twitch-pop-body"></div>`;
    document.body.appendChild(popover);
    popover.querySelector('.tbt-twitch-pop-close').addEventListener('click', closeLookupPopover);
    popover.addEventListener('click', (event) => event.stopPropagation());
    state.lookupPopover = popover;
    return popover;
  };

  const closeLookupPopover = () => state.lookupPopover?.classList.remove('tbt-twitch-pop-visible');

  const positionLookupPopover = (anchor) => {
    const popover = ensureLookupPopover();
    const rect = anchor?.getBoundingClientRect?.() || { left: innerWidth / 2, top: innerHeight / 2, bottom: innerHeight / 2, width: 0 };
    const width = Math.min(360, Math.max(280, innerWidth - 24));
    popover.style.width = `${width}px`;
    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(12, Math.min(left, innerWidth - width - 12));
    let top = rect.bottom + 10;
    if (top + 310 > innerHeight) top = Math.max(12, rect.top - 320);
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  };

  const renderLookupResult = (result, anchor) => {
    const popover = ensureLookupPopover();
    positionLookupPopover(anchor);
    popover.querySelector('.tbt-twitch-pop-word').textContent = result.word || result.term || '';
    popover.querySelector('.tbt-twitch-pop-phonetic').textContent = [result.phonetic, result.partOfSpeech].filter(Boolean).join(' · ');
    const body = popover.querySelector('.tbt-twitch-pop-body');
    const mode = state.settings.dictionaryMode || 'both';
    const showEn = mode === 'both' || mode === 'en';
    const showZh = mode === 'both' || mode === 'zh';
    const image = result.image || result.visualImage || null;
    const imageSrc = image?.dataUrl || image?.url || '';
    const imageHref = image?.sourceUrl || image?.url || '';
    body.innerHTML = `
      ${imageSrc ? `<section class="tbt-twitch-pop-image-section"><a class="tbt-twitch-pop-image-link" href="${escapeText(imageHref || imageSrc)}" target="_blank" rel="noreferrer"><img class="tbt-twitch-pop-image" src="${escapeText(imageSrc)}" alt="${escapeText((result.word || result.term || 'word') + ' image')}" loading="lazy"><span class="tbt-twitch-pop-image-caption">${escapeText(image.caption || image.title || image.source || t('wordImageCaption'))}</span></a></section>` : ''}
      ${showZh ? `<section class="tbt-twitch-pop-section"><div class="tbt-twitch-pop-label">${escapeText(t('labelZh'))}</div><p>${escapeText(result.meaningZh || t('noZh'))}</p></section>` : ''}
      ${showEn ? `<section class="tbt-twitch-pop-section"><div class="tbt-twitch-pop-label">${escapeText(t('labelEn'))}</div><p>${escapeText(result.definitionEn || t('noEn'))}</p></section>` : ''}
      ${showZh && result.definitionZh ? `<section class="tbt-twitch-pop-section"><div class="tbt-twitch-pop-label">${escapeText(t('labelDefinitionZh'))}</div><p>${escapeText(result.definitionZh)}</p></section>` : ''}
      ${showEn && result.exampleEn ? `<section class="tbt-twitch-pop-section"><div class="tbt-twitch-pop-label">${escapeText(t('labelExampleEn'))}</div><p>${escapeText(result.exampleEn)}</p></section>` : ''}
      ${showZh && result.exampleZh ? `<section class="tbt-twitch-pop-section"><div class="tbt-twitch-pop-label">${escapeText(t('labelExampleZh'))}</div><p>${escapeText(result.exampleZh)}</p></section>` : ''}
      <div class="tbt-twitch-pop-actions"><button type="button" class="tbt-twitch-add-vocab">${escapeText(t('addVocab'))}</button>${result.audio ? `<a class="tbt-twitch-audio" href="${escapeText(result.audio)}" target="_blank" rel="noreferrer">${escapeText(t('playAudio'))}</a>` : ''}</div>
      <div class="tbt-twitch-vocab-status" aria-live="polite"></div>`;

    body.querySelector('.tbt-twitch-pop-image')?.addEventListener('error', () => body.querySelector('.tbt-twitch-pop-image-section')?.remove());
    body.querySelector('.tbt-twitch-add-vocab')?.addEventListener('click', async () => {
      const status = body.querySelector('.tbt-twitch-vocab-status');
      status.textContent = t('addingVocab');
      try {
        const response = await sendMessage({ type: 'YTBBI_ADD_VOCAB', entry: result });
        if (!response?.ok) throw new Error(response?.error || 'Failed to add vocabulary');
        status.textContent = t('vocabAdded', { count: response.count });
      } catch (error) {
        status.textContent = t('vocabAddFailed', { error: error?.message || String(error) });
      }
    });
    popover.classList.add('tbt-twitch-pop-visible');
  };

  const openLookup = async (term, anchor) => {
    if (!state.settings.interactiveLookup) return;
    const normalized = normalizeTerm(term);
    if (!normalized || !/[A-Za-z]/.test(normalized)) return;
    const seq = ++state.lookupAbortSeq;
    const popover = ensureLookupPopover();
    positionLookupPopover(anchor);
    popover.querySelector('.tbt-twitch-pop-word').textContent = normalized;
    popover.querySelector('.tbt-twitch-pop-phonetic').textContent = '';
    popover.querySelector('.tbt-twitch-pop-body').innerHTML = `<div class="tbt-twitch-loading">${escapeText(t('lookupLoading'))}</div>`;
    popover.classList.add('tbt-twitch-pop-visible');

    try {
      const response = await sendMessage({
        type: 'YTBBI_LOOKUP_WORD',
        term: normalized,
        context: state.lastCaptionText,
        url: location.href,
        title: document.title,
        targetLang: state.settings.targetLang || 'zh-TW'
      });
      if (seq !== state.lookupAbortSeq) return;
      if (!response?.ok) throw new Error(response?.error || 'Lookup failed');
      renderLookupResult(response.result, anchor);
    } catch (error) {
      if (seq !== state.lookupAbortSeq) return;
      popover.querySelector('.tbt-twitch-pop-body').innerHTML = `<div class="tbt-twitch-error">查詢失敗：${escapeText(error?.message || String(error))}</div>`;
    }
  };

  const deactivate = () => {
    clearTimeout(state.mergeTimer);
    clearTimeout(state.domCandidateTimer);
    state.domCandidateTimer = 0;
    state.pendingText = '';
    state.lastNativeText = '';
    state.lastAcceptedTextBySource = { texttrack: '', dom: '' };
    state.activeCaptionSource = 'none';
    state.lastTextTrackCueAt = 0;
    state.domCandidateText = '';
    state.domCandidateStartedAt = 0;
    state.currentDisplayText = '';
    state.requestSeq += 1;
    restoreNativeCaptionNodes();
    restoreTrackVisibility();
    destroyOverlay();
    for (const [track, handler] of state.boundTracks.entries()) {
      try { track.removeEventListener('cuechange', handler); } catch (_error) {}
    }
    state.boundTracks.clear();
    state.playerToggleButton?.remove?.();
    state.playerToggleButton = null;
    state.playerRoot = null;
    state.video = null;
  };

  const syncContext = () => {
    if (!isSupportedTwitchLivePage()) {
      if (state.channelKey) deactivate();
      state.channelKey = '';
      return false;
    }

    const channelKey = getChannelKey();
    const video = findActiveVideo();
    const player = findPlayerRoot(video);
    if (!video || !player) return false;

    if (channelKey !== state.channelKey) {
      deactivate();
      state.channelKey = channelKey;
      state.autoEnableLastAttemptAt = 0;
    }

    state.video = video;
    state.playerRoot = player;
    ensurePlayerToggle();
    if (isTwitchBilingualEnabled()) {
      ensureOverlay();
      bindCaptionTracks();
      scanNativeCaptionDom(player);
      attemptAutoEnableCaptions();
    } else {
      hideOverlay(true);
      restoreNativeCaptionNodes();
      restoreTrackVisibility();
    }
    return true;
  };

  const startObserver = () => {
    state.observer?.disconnect?.();
    state.observer = new MutationObserver((mutations) => {
      if (!isSupportedTwitchLivePage()) return;
      ensurePlayerToggle();
      if (!isTwitchBilingualEnabled()) return;
      let shouldScan = false;
      for (const mutation of mutations) {
        const target = mutation.target?.nodeType === Node.TEXT_NODE ? mutation.target.parentElement : mutation.target;
        if (target?.closest?.('.tbt-twitch-overlay, .tbt-twitch-popover')) continue;
        const player = state.playerRoot;
        if (!player || player.contains(target) || Array.from(mutation.addedNodes || []).some((node) => node.nodeType === Node.ELEMENT_NODE && player.contains(node))) {
          shouldScan = true;
          break;
        }
      }
      if (shouldScan) {
        clearTimeout(state.sourceTimer);
        state.sourceTimer = setTimeout(() => {
          syncContext();
          scanNativeCaptionDom(state.playerRoot || document);
          bindCaptionTracks();
        }, 60);
      }
    });
    state.observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  };

  const startRouteWatcher = () => {
    clearInterval(state.routeTimer);
    let lastHref = location.href;
    state.routeTimer = setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        state.lastNativeText = '';
        state.lastAcceptedTextBySource = { texttrack: '', dom: '' };
        state.activeCaptionSource = 'none';
        state.lastTextTrackCueAt = 0;
        state.pendingText = '';
        state.requestSeq += 1;
        syncContext();
      } else if (isSupportedTwitchLivePage()) {
        syncContext();
      }
    }, 650);
  };

  const startAutoEnableWatcher = () => {
    clearInterval(state.autoEnableTimer);
    state.autoEnableTimer = setInterval(() => {
      if (!isSupportedTwitchLivePage()) return;
      syncContext();
      ensurePlayerToggle();
      if (!isTwitchBilingualEnabled()) return;
      bindCaptionTracks();
      attemptAutoEnableCaptions();
      scanNativeCaptionDom(state.playerRoot || document);
    }, 1400);
  };

  const onSettingsChanged = async () => {
    const wasEffective = isTwitchBilingualEnabled();
    state.settings = await storageGet();
    const isEffective = isTwitchBilingualEnabled();
    applySettingsToDom();
    updatePlayerToggleState();
    if (!isEffective) {
      clearTimeout(state.mergeTimer);
      clearTimeout(state.domCandidateTimer);
      state.pendingText = '';
      state.domCandidateText = '';
      hideOverlay(true);
      restoreNativeCaptionNodes();
      restoreTrackVisibility();
      return;
    }
    if (!wasEffective && isEffective) state.autoEnableLastAttemptAt = 0;
    syncContext();
    if (state.currentDisplayText) {
      const translated = state.translationCache.get(state.currentDisplayText) || '';
      showOverlay({ original: state.currentDisplayText, translation: translated, status: translated ? '' : t('statusTranslating') });
    }
  };

  const installSettingsListeners = () => {
    try {
      EXT.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (!message || message.type !== 'YTBBI_SETTINGS_UPDATED') return false;
        onSettingsChanged().then(() => sendResponse({ ok: true }));
        return true;
      });
    } catch (_error) {}

    try {
      EXT.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (!Object.keys(changes || {}).some((key) => key in DEFAULT_SETTINGS)) return;
        onSettingsChanged();
      });
    } catch (_error) {}

    document.addEventListener('click', (event) => {
      if (!state.lookupPopover?.classList.contains('tbt-twitch-pop-visible')) return;
      if (state.lookupPopover.contains(event.target)) return;
      if (event.target?.classList?.contains('tbt-twitch-word')) return;
      closeLookupPopover();
    }, true);
  };

  const init = async () => {
    if (state.initialized) return;
    if (!/(^|\.)twitch\.tv$/i.test(location.hostname)) return;
    state.initialized = true;
    state.settings = await storageGet();
    applySettingsToDom();
    startObserver();
    startRouteWatcher();
    startAutoEnableWatcher();
    installSettingsListeners();
    syncContext();
    log('initialized');
  };

  init().catch((error) => console.warn(`[${MODULE_NAME}] init failed`, error));
})();
