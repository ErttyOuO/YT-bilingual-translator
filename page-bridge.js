(() => {
  'use strict';

  if (window.__YTBBI_TRANSCRIPT_BRIDGE_INSTALLED__) return;
  window.__YTBBI_TRANSCRIPT_BRIDGE_INSTALLED__ = true;

  const BRIDGE_PREFIX = 'YTBBI_BRIDGE_';
  let lastSentKey = '';
  const postedUrls = new Set();

  const isWatchPage = () => /^\/watch(?:\/|$|\?)/.test(location.pathname);
  const isEmbedPage = () => /^\/embed(?:\/|$)/.test(location.pathname);
  const isShortsPage = () => /^\/shorts(?:\/|$)/.test(location.pathname) || !!document.querySelector('ytd-shorts, ytd-reel-video-renderer');
  const isSupportedVideoPage = () => isWatchPage() || isShortsPage() || isEmbedPage();
  let bridgeActive = isSupportedVideoPage();

  const canOperate = () => bridgeActive && isSupportedVideoPage();

  const clone = (value) => {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_error) {
      return null;
    }
  };

  const isTimedtextUrl = (value) => {
    try {
      const url = new URL(String(value), location.href);
      return /\/api\/timedtext|\/timedtext/.test(url.pathname);
    } catch (_error) {
      return false;
    }
  };

  const postTimedtextUrl = (value) => {
    if (!canOperate()) return;
    if (!isTimedtextUrl(value)) return;
    const url = new URL(String(value), location.href).toString();
    if (postedUrls.has(url)) return;
    postedUrls.add(url);
    if (postedUrls.size > 30) postedUrls.delete(postedUrls.values().next().value);
    window.postMessage({ type: `${BRIDGE_PREFIX}TIMEDTEXT_URL`, url }, '*');
  };

  const getVisibleElementScore = (element) => {
    if (!element?.getBoundingClientRect) return 0;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 16 || rect.height <= 16) return 0;
    if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= window.innerHeight || rect.left >= window.innerWidth) return 0;
    const visibleWidth = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
    const visibleHeight = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
    const visibleArea = visibleWidth * visibleHeight;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const distanceFromCenter = Math.hypot(centerX - window.innerWidth / 2, centerY - window.innerHeight / 2);
    const centerBonus = Math.max(0, 1 - distanceFromCenter / Math.max(window.innerWidth, window.innerHeight));
    return visibleArea + centerBonus * 20000;
  };

  const findActiveVideo = () => {
    const videos = Array.from(document.querySelectorAll('video'));
    if (!videos.length) return null;
    return videos
      .map((video) => {
        let score = getVisibleElementScore(video);
        if (video.closest?.('#shorts-player, ytd-reel-video-renderer, ytd-shorts')) score += 60000;
        if (!video.paused && !video.ended) score += 30000;
        return { video, score };
      })
      .sort((a, b) => b.score - a.score)[0]?.video || videos[0];
  };

  const findPlayer = () => {
    const activeVideo = findActiveVideo();
    const playerFromVideo = activeVideo?.closest?.('.html5-video-player');
    if (playerFromVideo && (typeof playerFromVideo.getPlayerResponse === 'function' || typeof playerFromVideo.getOption === 'function')) return playerFromVideo;

    const ids = isShortsPage() ? ['shorts-player', 'movie_player', 'player'] : ['movie_player', 'shorts-player', 'player'];
    for (const id of ids) {
      const node = document.getElementById(id);
      if (node && (typeof node.getPlayerResponse === 'function' || typeof node.getOption === 'function')) return node;
    }
    const candidates = document.querySelectorAll('.html5-video-player, ytd-player, #movie_player, #shorts-player');
    let best = null;
    let bestScore = -1;
    for (const node of candidates) {
      if (!node || !(typeof node.getPlayerResponse === 'function' || typeof node.getOption === 'function')) continue;
      const score = getVisibleElementScore(node) + (node.id === 'shorts-player' ? 60000 : 0);
      if (score > bestScore) {
        best = node;
        bestScore = score;
      }
    }
    return best;
  };

  const getSelectedTrack = (player) => {
    try {
      const track = player?.getOption?.('captions', 'track');
      if (track) return clone(track);
    } catch (_error) {
      // ignored
    }
    return null;
  };

  const getAudioTrack = (player) => {
    try {
      const track = player?.getAudioTrack?.();
      if (track) return clone(track);
    } catch (_error) {
      // ignored
    }
    return null;
  };

  const getPlayerResponse = (player) => {
    try {
      const response = player?.getPlayerResponse?.();
      if (response) return clone(response);
    } catch (_error) {
      // ignored
    }
    try {
      if (window.ytInitialPlayerResponse) return clone(window.ytInitialPlayerResponse);
    } catch (_error) {
      // ignored
    }
    return null;
  };

  const sendPlayerData = (requestId = '') => {
    if (!canOperate()) return;
    const player = findPlayer();
    const playerResponse = getPlayerResponse(player);
    const selectedTrack = getSelectedTrack(player);
    const audioTrack = getAudioTrack(player);
    const shortsMatch = location.pathname.match(/^\/shorts\/([^/?#]+)/);
    const videoId = playerResponse?.videoDetails?.videoId || (shortsMatch?.[1] ? decodeURIComponent(shortsMatch[1]) : '') || new URLSearchParams(location.search).get('v') || '';
    const key = JSON.stringify({
      requestId,
      videoId,
      selected: selectedTrack?.baseUrl || selectedTrack?.languageCode || '',
      captions: Boolean(playerResponse?.captions)
    });
    if (!requestId && key === lastSentKey) return;
    lastSentKey = key;
    window.postMessage({
      type: `${BRIDGE_PREFIX}PLAYER_DATA`,
      requestId,
      videoId,
      playerResponse,
      selectedTrack,
      audioTrack
    }, '*');
  };

  const installNetworkObserver = () => {
    if (window.__YTBBI_NETWORK_OBSERVER_INSTALLED__) return;
    window.__YTBBI_NETWORK_OBSERVER_INSTALLED__ = true;

    const originalFetch = window.fetch;
    if (typeof originalFetch === 'function') {
      window.fetch = function patchedFetch(input, init) {
        try {
          const url = typeof input === 'string' ? input : input?.url;
          postTimedtextUrl(url);
        } catch (_error) {
          // ignored
        }
        return originalFetch.apply(this, arguments);
      };
    }

    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
      try {
        postTimedtextUrl(url);
      } catch (_error) {
        // ignored
      }
      return originalOpen.apply(this, arguments);
    };
  };

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const message = event.data;
    if (!message || typeof message !== 'object') return;

    if (message.type === 'YTBBI_CONTENT_SET_BRIDGE_ACTIVE') {
      bridgeActive = !!message.active;
      if (!bridgeActive) lastSentKey = '';
      return;
    }

    if (message.type !== 'YTBBI_CONTENT_GET_PLAYER_DATA') return;
    sendPlayerData(message.requestId || '');
  });

  installNetworkObserver();
  if (canOperate()) sendPlayerData();
  setInterval(() => {
    if (!canOperate()) return;
    sendPlayerData();
  }, 1200);
})();
