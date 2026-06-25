(() => {
  'use strict';

  if (window.__YTBBI_TRANSCRIPT_BRIDGE_INSTALLED__) return;
  window.__YTBBI_TRANSCRIPT_BRIDGE_INSTALLED__ = true;

  const BRIDGE_PREFIX = 'YTBBI_BRIDGE_';
  let lastSentKey = '';
  const postedUrls = new Set();

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
    if (!isTimedtextUrl(value)) return;
    const url = new URL(String(value), location.href).toString();
    if (postedUrls.has(url)) return;
    postedUrls.add(url);
    if (postedUrls.size > 30) postedUrls.delete(postedUrls.values().next().value);
    window.postMessage({ type: `${BRIDGE_PREFIX}TIMEDTEXT_URL`, url }, '*');
  };

  const findPlayer = () => {
    const ids = ['movie_player', 'player'];
    for (const id of ids) {
      const node = document.getElementById(id);
      if (node && (typeof node.getPlayerResponse === 'function' || typeof node.getOption === 'function')) return node;
    }
    const candidates = document.querySelectorAll('.html5-video-player, ytd-player, #movie_player');
    for (const node of candidates) {
      if (node && (typeof node.getPlayerResponse === 'function' || typeof node.getOption === 'function')) return node;
    }
    return null;
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
    const player = findPlayer();
    const playerResponse = getPlayerResponse(player);
    const selectedTrack = getSelectedTrack(player);
    const audioTrack = getAudioTrack(player);
    const videoId = playerResponse?.videoDetails?.videoId || new URLSearchParams(location.search).get('v') || '';
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
    if (!message || message.type !== 'YTBBI_CONTENT_GET_PLAYER_DATA') return;
    sendPlayerData(message.requestId || '');
  });

  installNetworkObserver();
  sendPlayerData();
  setInterval(sendPlayerData, 1200);
})();
