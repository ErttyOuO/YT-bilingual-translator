(() => {
  'use strict';

  const IS_BROWSER_PROMISE_API = typeof browser !== 'undefined';
  const EXT = IS_BROWSER_PROMISE_API ? browser : chrome;
  const DEFAULT_SETTINGS = {
    enabled: true,
    twitchEnabled: true,
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
    deeplApiKey: '',
    azureTranslatorKey: '',
    azureTranslatorRegion: '',
    bergamotCloudFallback: false,
    geminiApiKey: '',
    geminiPrimaryModel: '',
    geminiFallbackModel: '',
    geminiModelFailover: true,
    cloudV3ProxyUrl: '',
    libreTranslateUrl: 'https://libretranslate.com',
    libreTranslateApiKey: '',
    lingvaInstanceUrl: 'https://lingva.ml',
    interactiveLookup: true,
    dictionaryMode: 'both',
    showWordUnderline: true,
    learningMode: 'en-to-zh',
    stableAutoCaptions: true,
    mergeManualCaptions: true,
    autoFailover: true,
    batchTranslationEnabled: true,
    batchSize: 8,
    transcriptFirstMode: true,
    recalculateOnScroll: true,
    recalculateOnViewportResize: true,
    observePlayerResize: true,
    onboardingDone: false
  };

  const $ = (id) => document.getElementById(id);
  const I18N = globalThis.YTBBI_I18N;
  const ONBOARDING_MODE = new URLSearchParams(globalThis.location?.search || '').get('onboarding');
  const IS_FIRST_INSTALL_SETUP = ONBOARDING_MODE === 'install';
  const currentLang = () => $('uiLanguage')?.value || DEFAULT_SETTINGS.uiLanguage || 'zh-TW';
  const t = (key, vars) => I18N?.t(currentLang(), key, vars) || key;
  let geminiModelsCache = [];

  const TARGET_LANGUAGES = [
    { code: 'zh-TW', label: '繁體中文' },
    { code: 'zh-CN', label: '简体中文' },
    { code: 'en', label: 'English' },
    { code: 'ja', label: '日本語' },
    { code: 'ko', label: '한국어' },
    { code: 'es', label: 'Español' },
    { code: 'fr', label: 'Français' },
    { code: 'de', label: 'Deutsch' },
    { code: 'it', label: 'Italiano' },
    { code: 'pt-BR', label: 'Português (Brasil)' },
    { code: 'vi', label: 'Tiếng Việt' },
    { code: 'th', label: 'ไทย' },
    { code: 'id', label: 'Bahasa Indonesia' }
  ];

  const fillTargetLanguageSelects = () => {
    document.querySelectorAll('.target-language-select').forEach((select) => {
      const currentValue = select.value || DEFAULT_SETTINGS.targetLang;
      select.textContent = '';
      TARGET_LANGUAGES.forEach(({ code, label }) => {
        const option = document.createElement('option');
        option.value = code;
        option.textContent = label;
        select.appendChild(option);
      });
      select.value = TARGET_LANGUAGES.some((item) => item.code === currentValue) ? currentValue : DEFAULT_SETTINGS.targetLang;
    });
  };


  const applyI18n = () => {
    const lang = currentLang();
    document.documentElement.lang = lang;
    document.title = t('appTitle');
    document.querySelectorAll('[data-i18n]').forEach((node) => {
      node.textContent = t(node.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
      node.setAttribute('placeholder', t(node.dataset.i18nPlaceholder));
    });
    document.querySelectorAll('[data-i18n-title]').forEach((node) => {
      node.setAttribute('title', t(node.dataset.i18nTitle));
    });
    fillTargetLanguageSelects();
    updateProviderUi();
    updateRangeLabels();
  };

  const fields = [
    'enabled',
    'twitchEnabled',
    'uiLanguage',
    'translationProvider',
    'autoFailover',
    'batchTranslationEnabled',
    'batchSize',
    'googleCloudApiKey',
    'deeplApiKey',
    'azureTranslatorKey',
    'azureTranslatorRegion',
    'bergamotCloudFallback',
    'geminiApiKey',
    'geminiPrimaryModel',
    'geminiFallbackModel',
    'geminiModelFailover',
    'cloudV3ProxyUrl',
    'libreTranslateUrl',
    'libreTranslateApiKey',
    'lingvaInstanceUrl',
    'learningMode',
    'targetLang',
    'sourceLang',
    'showOriginal',
    'showTranslation',
    'hideNativeCaptions',
    'requireNativeCaptions',
    'autoEnableNativeCaptions',
    'stableAutoCaptions',
    'mergeManualCaptions',
    'transcriptFirstMode',
    'interactiveLookup',
    'dictionaryMode',
    'showWordUnderline',
    'fontSize',
    'bottomPercent',
    'maxWidthPercent',
    'recalculateOnScroll',
    'recalculateOnViewportResize',
    'observePlayerResize',
    'debug'
  ];

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
  const sendMessage = (message) => callMaybePromise(EXT.runtime.sendMessage, EXT.runtime, message);

  const setStatus = (text, timeout = 2200) => {
    $('status').textContent = text;
    clearTimeout(setStatus.timer);
    setStatus.timer = setTimeout(() => {
      $('status').textContent = '';
    }, timeout);
  };

  const explainError = (message) => {
    if (!message) return t('unknownError');
    if (message === 'NO_GOOGLE_CLOUD_API_KEY') return t('errNoCloudKey');
    if (message === 'NO_GEMINI_API_KEY') return t('errNoGeminiKey');
    if (message === 'NO_GEMINI_PRIMARY_MODEL') return t('errNoGeminiModel');
    if (message === 'NO_CLOUD_V3_PROXY_URL') return t('errNoCloudV3');
    if (/NO_DEEPL_API_KEY/.test(message)) return t('errNoDeeplKey');
    if (/DEEPL_QUOTA_EXCEEDED/.test(message)) return t('errDeeplQuota');
    if (/NO_AZURE_TRANSLATOR_KEY/.test(message)) return t('errNoAzureKey');
    const bergamotCode = String(message).match(/BERGAMOT_[A-Z_]+/);
    if (bergamotCode) return t(`err_${bergamotCode[0]}`);
    if (/API key not valid|API_KEY_INVALID|invalid api key/i.test(message)) return t($('translationProvider')?.value === 'gemini' ? 'errInvalidGeminiKey' : 'errInvalidKey');
    if (/billing|Billing/i.test(message)) return t('errBilling');
    if (/disabled|has not been used/i.test(message)) return t('errApiDisabled');
    if (/All translation providers failed/i.test(message)) return t('errAllProviders');
    if (/Google Free Translate failed/i.test(message)) return t('errGoogleFree');
    return message.length > 100 ? `${message.slice(0, 100)}…` : message;
  };

  const updateRangeLabels = () => {
    if ($('fontSizeLabel') && $('fontSize')) $('fontSizeLabel').textContent = `${$('fontSize').value}px`;
    if ($('bottomPercentLabel') && $('bottomPercent')) $('bottomPercentLabel').textContent = `${$('bottomPercent').value}%`;
    if ($('maxWidthPercentLabel') && $('maxWidthPercent')) $('maxWidthPercentLabel').textContent = `${$('maxWidthPercent').value}%`;
  };

  const updateProviderUi = () => {
    const provider = $('translationProvider').value;
    document.body.dataset.provider = provider;
    const help = $('providerHelp');
    const providerHelpKey = {
      'auto-free': 'providerHelpAutoFree',
      'deepl': 'providerHelpDeepL',
      'microsoft-azure': 'providerHelpAzure',
      'bergamot': 'providerHelpBergamot',
      'google-free': 'providerHelpGoogleFree',
      'gemini': 'providerHelpGemini',
      'cloud-v2': 'providerHelpCloudV2',
      'cloud-v3-proxy': 'providerHelpCloudV3',
      'libretranslate': 'providerHelpLibre',
      'lingva': 'providerHelpLingva'
    }[provider];
    const text = providerHelpKey ? t(providerHelpKey) : '';
    if (help) help.textContent = text;
    if (provider === 'bergamot') startBergamotStatusPolling();
  };

  // Hosts each provider needs. They are optional permissions, requested only
  // when the user picks that provider, so other users never see a prompt.
  const PROVIDER_ORIGINS = {
    'deepl': ['https://api-free.deepl.com/*', 'https://api.deepl.com/*'],
    'microsoft-azure': ['https://api.cognitive.microsofttranslator.com/*'],
    'bergamot': ['https://firefox.settings.services.mozilla.com/*', 'https://firefox-settings-attachments.cdn.mozilla.net/*']
  };

  // Must run synchronously inside the click handler: Firefox only shows the
  // permission prompt for calls made directly from a user action.
  const requestProviderPermission = (provider) => {
    const origins = PROVIDER_ORIGINS[provider];
    if (!origins || !EXT.permissions?.request) return Promise.resolve(true);
    return Promise.resolve(EXT.permissions.request({ origins })).catch(() => false);
  };

  const BERGAMOT_STATE_KEYS = {
    'idle': 'bergamotStateIdle',
    'downloading-model': 'bergamotStateDownloading',
    'loading-engine': 'bergamotStateLoadingEngine',
    'loading-model': 'bergamotStateLoadingModel',
    'ready': 'bergamotStateReady',
    'error': 'bergamotStateError'
  };

  const renderBergamotStatus = (info) => {
    const node = $('bergamotStatus');
    if (!node || !info) return;
    const lines = [];
    const percent = info.total ? Math.floor((info.received / info.total) * 100) : 0;
    lines.push(t(BERGAMOT_STATE_KEYS[info.state] || 'bergamotStateIdle', {
      pair: String(info.pair || '').replace('|', ' → '),
      percent,
      mb: (info.total / 1e6).toFixed(1)
    }));
    if (info.state === 'error' && info.error) lines.push(explainError(info.error.code || info.error.message));
    if (!info.permission) lines.push(t('bergamotNeedsPermission'));
    node.textContent = lines.join('\n');
    node.dataset.state = info.state === 'error' ? 'error' : (info.state === 'ready' ? '' : 'warn');
  };

  let bergamotPollTimer = 0;
  const refreshBergamotStatus = async () => {
    try {
      const response = await sendMessage({ type: 'YTBBI_BERGAMOT_STATUS' });
      if (response?.ok) renderBergamotStatus(response.status);
      return response?.status;
    } catch (_error) {
      return null;
    }
  };
  const startBergamotStatusPolling = () => {
    if (bergamotPollTimer) return;
    refreshBergamotStatus();
    bergamotPollTimer = setInterval(() => {
      if ($('translationProvider')?.value !== 'bergamot') {
        clearInterval(bergamotPollTimer);
        bergamotPollTimer = 0;
        return;
      }
      refreshBergamotStatus();
    }, 1000);
  };

  const prepareBergamot = () => {
    const permission = requestProviderPermission('bergamot');
    (async () => {
      if (!(await permission)) {
        setStatus(t('bergamotNeedsPermission'), 6000);
        return;
      }
      await save(true);
      startBergamotStatusPolling();
      try {
        const response = await sendMessage({
          type: 'YTBBI_BERGAMOT_PREPARE',
          sourceLang: $('bergamotSourceLang')?.value || 'en',
          targetLang: $('targetLang')?.value || DEFAULT_SETTINGS.targetLang
        });
        if (!response?.ok) throw new Error(response?.error || t('unknownError'));
        renderBergamotStatus(response.status);
      } catch (error) {
        setStatus(explainError(error.message), 8000);
        refreshBergamotStatus();
      }
    })();
  };

  const clearBergamotModels = async () => {
    await sendMessage({ type: 'YTBBI_BERGAMOT_CLEAR' }).catch(() => undefined);
    refreshBergamotStatus();
  };


  const setGeminiStatus = (text, state = '') => {
    const node = $('geminiStatus');
    if (!node) return;
    node.textContent = text || '';
    if (state) node.dataset.state = state;
    else delete node.dataset.state;
  };

  const ensureGeminiModelOption = (select, value, allowEmpty = false) => {
    if (!select) return;
    const model = String(value || '').trim().replace(/^models\//, '');
    if (!model) {
      if (allowEmpty) select.value = '';
      return;
    }
    let option = Array.from(select.options).find((item) => item.value === model);
    if (!option) {
      option = document.createElement('option');
      option.value = model;
      option.textContent = `${model} (${t('geminiSavedModel')})`;
      select.appendChild(option);
    }
    select.value = model;
  };

  const getGeminiModelById = (id) => geminiModelsCache.find((model) => model.id === String(id || '').replace(/^models\//, ''));

  const updateGeminiModelInfo = () => {
    const render = (selectId, infoId) => {
      const selected = $(selectId)?.value || '';
      const info = $(infoId);
      if (!info) return;
      const model = getGeminiModelById(selected);
      if (!model) {
        info.textContent = selected ? t('geminiModelNotLoaded') : '';
        return;
      }
      const limits = [];
      if (model.inputTokenLimit) limits.push(`in ${model.inputTokenLimit}`);
      if (model.outputTokenLimit) limits.push(`out ${model.outputTokenLimit}`);
      info.textContent = [model.displayName || model.id, limits.join(' / '), model.thinking ? t('geminiThinkingModel') : '']
        .filter(Boolean)
        .join(' · ');
    };
    render('geminiPrimaryModel', 'geminiPrimaryModelInfo');
    render('geminiFallbackModel', 'geminiFallbackModelInfo');
  };

  const populateGeminiModels = (models, selectedPrimary = '', selectedFallback = '') => {
    geminiModelsCache = Array.isArray(models) ? models.slice() : [];
    const primary = $('geminiPrimaryModel');
    const fallback = $('geminiFallbackModel');
    if (!primary || !fallback) return;

    const oldPrimary = selectedPrimary || primary.value;
    const oldFallback = selectedFallback || fallback.value;
    primary.textContent = '';
    fallback.textContent = '';

    const primaryPlaceholder = document.createElement('option');
    primaryPlaceholder.value = '';
    primaryPlaceholder.textContent = t('geminiChooseModel');
    primary.appendChild(primaryPlaceholder);

    const fallbackNone = document.createElement('option');
    fallbackNone.value = '';
    fallbackNone.textContent = t('geminiNoFallback');
    fallback.appendChild(fallbackNone);

    geminiModelsCache.forEach((model) => {
      const label = model.displayName && model.displayName !== model.id
        ? `${model.displayName} — ${model.id}`
        : model.id;
      const p = document.createElement('option');
      p.value = model.id;
      p.textContent = label;
      primary.appendChild(p);
      const f = p.cloneNode(true);
      fallback.appendChild(f);
    });

    if (oldPrimary && geminiModelsCache.some((model) => model.id === oldPrimary)) primary.value = oldPrimary;
    else if (geminiModelsCache.length) primary.value = geminiModelsCache[0].id;

    if (oldFallback && oldFallback !== primary.value && geminiModelsCache.some((model) => model.id === oldFallback)) {
      fallback.value = oldFallback;
    } else {
      const next = geminiModelsCache.find((model) => model.id !== primary.value);
      fallback.value = next?.id || '';
    }
    updateGeminiModelInfo();
  };

  const loadGeminiModels = async () => {
    const apiKey = $('geminiApiKey')?.value.trim() || '';
    if (!apiKey) {
      setGeminiStatus(t('errNoGeminiKey'), 'error');
      return null;
    }
    setGeminiStatus(t('geminiLoadingModels'));
    try {
      const response = await sendMessage({ type: 'YTBBI_GEMINI_LIST_MODELS', apiKey });
      if (!response?.ok) throw new Error(response?.error || t('testFailed'));
      const primary = $('geminiPrimaryModel')?.value || '';
      const fallback = $('geminiFallbackModel')?.value || '';
      populateGeminiModels(response.models || [], primary, fallback);
      setGeminiStatus(t('geminiModelsLoaded', { count: response.count || response.models?.length || 0 }));
      return response.models || [];
    } catch (error) {
      setGeminiStatus(t('geminiKeyTestFailed', { error: explainError(error.message) }), 'error');
      return null;
    }
  };

  const saveGeminiSettings = async () => {
    try {
      await save(true);
      setGeminiStatus(t('geminiSaved'));
      setStatus(t('statusSaved'));
    } catch (error) {
      setGeminiStatus(explainError(error.message), 'error');
    }
  };

  const testGeminiSettings = async () => {
    const apiKey = $('geminiApiKey')?.value.trim() || '';
    const primaryModel = $('geminiPrimaryModel')?.value || '';
    const fallbackModel = $('geminiFallbackModel')?.value || '';
    if (!apiKey) {
      setGeminiStatus(t('errNoGeminiKey'), 'error');
      return;
    }
    if (!primaryModel) {
      setGeminiStatus(t('errNoGeminiModel'), 'error');
      return;
    }

    setGeminiStatus(t('geminiTestingModels'));
    try {
      const response = await sendMessage({
        type: 'YTBBI_GEMINI_TEST',
        apiKey,
        primaryModel,
        fallbackModel,
        targetLang: $('targetLang')?.value || DEFAULT_SETTINGS.targetLang
      });
      if (!response?.ok) throw new Error(response?.error || t('testFailed'));
      if (Array.isArray(response.models) && response.models.length) {
        populateGeminiModels(response.models, primaryModel, fallbackModel);
      }
      const lines = [t('geminiKeyValid', { count: response.modelCount || 0 })];
      if (response.primary) {
        lines.push(response.primary.ok
          ? t('geminiPrimaryTestOk', { model: response.primary.model })
          : t('geminiPrimaryTestFailed', { model: response.primary.model, error: explainError(response.primary.error) }));
      }
      if (response.fallback) {
        lines.push(response.fallback.ok
          ? t('geminiFallbackTestOk', { model: response.fallback.model })
          : t('geminiFallbackTestFailed', { model: response.fallback.model, error: explainError(response.fallback.error) }));
      }
      if (response.translatedText) lines.push(t('geminiTestResult', { text: response.translatedText }));
      const hasFailure = (response.primary && !response.primary.ok) || (response.fallback && !response.fallback.ok);
      const failoverWorked = response.primary && !response.primary.ok && response.fallback?.ok;
      setGeminiStatus(lines.join('\n'), failoverWorked ? 'warn' : (hasFailure ? 'warn' : ''));
    } catch (error) {
      setGeminiStatus(t('geminiKeyTestFailed', { error: explainError(error.message) }), 'error');
    }
  };

  const readForm = () => ({
    enabled: $('enabled').checked,
    twitchEnabled: $('twitchEnabled') ? $('twitchEnabled').checked : true,
    uiLanguage: $('uiLanguage') ? $('uiLanguage').value : 'zh-TW',
    translationProvider: $('translationProvider').value,
    autoFailover: $('autoFailover').checked,
    batchTranslationEnabled: $('batchTranslationEnabled').checked,
    batchSize: Number($('batchSize').value),
    googleCloudApiKey: $('googleCloudApiKey').value.trim(),
    deeplApiKey: $('deeplApiKey')?.value.trim() || '',
    azureTranslatorKey: $('azureTranslatorKey')?.value.trim() || '',
    azureTranslatorRegion: $('azureTranslatorRegion')?.value.trim() || '',
    bergamotCloudFallback: $('bergamotCloudFallback') ? $('bergamotCloudFallback').checked : false,
    geminiApiKey: $('geminiApiKey')?.value.trim() || '',
    geminiPrimaryModel: $('geminiPrimaryModel')?.value || '',
    geminiFallbackModel: $('geminiFallbackModel')?.value || '',
    geminiModelFailover: $('geminiModelFailover') ? $('geminiModelFailover').checked : true,
    cloudV3ProxyUrl: $('cloudV3ProxyUrl').value.trim(),
    libreTranslateUrl: $('libreTranslateUrl').value.trim(),
    libreTranslateApiKey: $('libreTranslateApiKey').value.trim(),
    lingvaInstanceUrl: $('lingvaInstanceUrl').value.trim(),
    learningMode: $('learningMode') ? $('learningMode').value : 'auto-target',
    targetLang: $('targetLang') ? $('targetLang').value : DEFAULT_SETTINGS.targetLang,
    sourceLang: 'auto',
    showOriginal: $('showOriginal').checked,
    showTranslation: $('showTranslation').checked,
    hideNativeCaptions: $('enabled').checked,
    requireNativeCaptions: $('requireNativeCaptions') ? $('requireNativeCaptions').checked : true,
    autoEnableNativeCaptions: $('autoEnableNativeCaptions') ? $('autoEnableNativeCaptions').checked : false,
    stableAutoCaptions: $('stableAutoCaptions').checked,
    mergeManualCaptions: $('mergeManualCaptions') ? $('mergeManualCaptions').checked : true,
    transcriptFirstMode: $('transcriptFirstMode') ? $('transcriptFirstMode').checked : true,
    interactiveLookup: $('interactiveLookup').checked,
    dictionaryMode: $('dictionaryMode').value,
    showWordUnderline: $('showWordUnderline').checked,
    fontSize: Number($('fontSize').value),
    bottomPercent: Number($('bottomPercent').value),
    maxWidthPercent: Number($('maxWidthPercent').value),
    recalculateOnScroll: $('recalculateOnScroll') ? $('recalculateOnScroll').checked : true,
    recalculateOnViewportResize: $('recalculateOnViewportResize') ? $('recalculateOnViewportResize').checked : true,
    observePlayerResize: $('observePlayerResize') ? $('observePlayerResize').checked : true,
    debug: $('debug').checked
  });

  const writeForm = (settings) => {
    $('enabled').checked = !!settings.enabled;
    if ($('twitchEnabled')) $('twitchEnabled').checked = settings.twitchEnabled !== false;
    if ($('uiLanguage')) $('uiLanguage').value = settings.uiLanguage || 'zh-TW';
    // Providers removed in later versions fall back to the key-free mode.
    const provider = settings.translationProvider || 'auto-free';
    $('translationProvider').value = $('translationProvider').querySelector(`option[value="${provider}"]`) ? provider : 'auto-free';
    $('autoFailover').checked = settings.autoFailover !== false;
    $('batchTranslationEnabled').checked = settings.batchTranslationEnabled !== false;
    $('batchSize').value = settings.batchSize || 8;
    $('googleCloudApiKey').value = settings.googleCloudApiKey || '';
    if ($('deeplApiKey')) $('deeplApiKey').value = settings.deeplApiKey || '';
    if ($('azureTranslatorKey')) $('azureTranslatorKey').value = settings.azureTranslatorKey || '';
    if ($('azureTranslatorRegion')) $('azureTranslatorRegion').value = settings.azureTranslatorRegion || '';
    if ($('bergamotCloudFallback')) $('bergamotCloudFallback').checked = settings.bergamotCloudFallback === true;
    if ($('geminiApiKey')) $('geminiApiKey').value = settings.geminiApiKey || '';
    if ($('geminiModelFailover')) $('geminiModelFailover').checked = settings.geminiModelFailover !== false;
    if ($('geminiPrimaryModel')) ensureGeminiModelOption($('geminiPrimaryModel'), settings.geminiPrimaryModel || '', false);
    if ($('geminiFallbackModel')) ensureGeminiModelOption($('geminiFallbackModel'), settings.geminiFallbackModel || '', true);
    $('cloudV3ProxyUrl').value = settings.cloudV3ProxyUrl || '';
    $('libreTranslateUrl').value = settings.libreTranslateUrl || 'https://libretranslate.com';
    $('libreTranslateApiKey').value = settings.libreTranslateApiKey || '';
    $('lingvaInstanceUrl').value = settings.lingvaInstanceUrl || 'https://lingva.ml';
    updateProviderUi();
    if ($('learningMode')) $('learningMode').value = settings.learningMode || 'auto-target';
    if ($('targetLang')) $('targetLang').value = settings.targetLang || DEFAULT_SETTINGS.targetLang;
    if ($('sourceLang')) $('sourceLang').value = 'auto';
    $('showOriginal').checked = !!settings.showOriginal;
    $('showTranslation').checked = !!settings.showTranslation;
    $('hideNativeCaptions').checked = !!settings.enabled;
    $('hideNativeCaptions').disabled = true;
    if ($('requireNativeCaptions')) $('requireNativeCaptions').checked = settings.requireNativeCaptions !== false;
    if ($('autoEnableNativeCaptions')) $('autoEnableNativeCaptions').checked = !!settings.autoEnableNativeCaptions;
    $('stableAutoCaptions').checked = settings.stableAutoCaptions !== false;
    if ($('mergeManualCaptions')) $('mergeManualCaptions').checked = settings.mergeManualCaptions !== false;
    if ($('transcriptFirstMode')) $('transcriptFirstMode').checked = settings.transcriptFirstMode !== false;
    $('interactiveLookup').checked = !!settings.interactiveLookup;
    $('dictionaryMode').value = settings.dictionaryMode || 'both';
    $('showWordUnderline').checked = !!settings.showWordUnderline;
    $('fontSize').value = settings.fontSize;
    $('bottomPercent').value = settings.bottomPercent;
    $('maxWidthPercent').value = settings.maxWidthPercent;
    if ($('recalculateOnScroll')) $('recalculateOnScroll').checked = settings.recalculateOnScroll !== false;
    if ($('recalculateOnViewportResize')) $('recalculateOnViewportResize').checked = settings.recalculateOnViewportResize !== false;
    if ($('observePlayerResize')) $('observePlayerResize').checked = settings.observePlayerResize !== false;
    $('debug').checked = !!settings.debug;
    updateRangeLabels();
  };

  const notifyActiveSupportedTab = async () => {
    try {
      const tabs = await callMaybePromise(EXT.tabs.query, EXT.tabs, { active: true, currentWindow: true });
      const tab = tabs && tabs[0];
      if (!tab || !tab.id || !/(youtube\.com|twitch\.tv)/.test(tab.url || '')) return;
      await callMaybePromise(EXT.tabs.sendMessage, EXT.tabs, tab.id, { type: 'YTBBI_SETTINGS_UPDATED' });
    } catch (_error) {
      // Content script may not be available on the current tab yet; storage change is enough.
    }
  };

  const save = async (silent = false) => {
    const settings = readForm();
    settings.hideNativeCaptions = !!settings.enabled;
    $('hideNativeCaptions').checked = !!settings.enabled;
    if (!settings.showOriginal && !settings.showTranslation) {
      settings.showTranslation = true;
      $('showTranslation').checked = true;
    }
    await storageSet(settings);
    await notifyActiveSupportedTab();
    if (!silent) setStatus(t('statusSaved'));
  };

  const reset = async () => {
    await storageSet(DEFAULT_SETTINGS);
    writeForm(DEFAULT_SETTINGS);
    applyI18n();
    await notifyActiveSupportedTab();
    setStatus(t('statusReset'));
  };

  const renderVocabulary = async () => {
    const list = $('vocabList');
    const count = $('vocabCount');
    let response;
    try {
      response = await sendMessage({ type: 'YTBBI_GET_VOCAB' });
    } catch (_error) {
      response = { items: [], count: 0 };
    }

    const items = response.items || [];
    count.textContent = String(items.length);
    if (!items.length) {
      list.innerHTML = '';
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = t('vocabEmpty');
      list.appendChild(empty);
      return;
    }

    list.textContent = '';
    items.slice(0, 25).forEach((item) => {
      const row = document.createElement('article');
      row.className = 'vocab-item';
      row.innerHTML = `
        <div>
          <strong></strong>
          <span></span>
          <p></p>
        </div>
        <button type="button" title="">×</button>
      `;
      row.querySelector('strong').textContent = item.word || item.term || '';
      row.querySelector('span').textContent = item.meaningZh || '';
      row.querySelector('p').textContent = item.definitionEn || item.context || '';
      row.querySelector('button').title = t('delete');
      row.querySelector('button').addEventListener('click', async () => {
        await sendMessage({ type: 'YTBBI_REMOVE_VOCAB', id: item.id });
        await renderVocabulary();
      });
      list.appendChild(row);
    });
  };

  const exportVocabulary = async () => {
    const response = await sendMessage({ type: 'YTBBI_GET_VOCAB' });
    const items = response.items || [];
    const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `youtube-vocabulary-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(t('statusExported'));
  };

  const clearVocabulary = async () => {
    if (!confirm(t('confirmClearVocab'))) return;
    await sendMessage({ type: 'YTBBI_CLEAR_VOCAB' });
    await renderVocabulary();
    setStatus(t('statusCleared'));
  };

  const panelOrder = ['panel-general', 'panel-translation', 'panel-subtitle', 'panel-learning', 'panel-performance', 'panel-advanced'];

  const activatePanel = (panelId) => {
    if (!panelId) return;
    const nextPanel = $(panelId);
    if (!nextPanel) return;

    const stack = $('panelStack');
    const currentPanel = document.querySelector('.panel.active:not(.leaving)');
    if (currentPanel?.id === panelId) return;

    const currentIndex = Math.max(0, panelOrder.indexOf(currentPanel?.id || panelOrder[0]));
    const nextIndex = Math.max(0, panelOrder.indexOf(panelId));
    if (stack) stack.dataset.direction = nextIndex >= currentIndex ? 'forward' : 'backward';

    document.querySelectorAll('.tab').forEach((tab) => {
      const isActive = tab.dataset.panel === panelId;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    document.querySelectorAll('.panel.leaving').forEach((panel) => {
      panel.classList.remove('leaving', 'active');
      panel.style.removeProperty('min-height');
    });

    if (currentPanel) {
      currentPanel.classList.add('leaving');
      currentPanel.classList.remove('active');
      const cleanup = () => {
        currentPanel.classList.remove('leaving');
        currentPanel.style.removeProperty('min-height');
      };
      currentPanel.addEventListener('animationend', cleanup, { once: true });
      setTimeout(cleanup, 320);
    }

    nextPanel.classList.remove('leaving');
    // Restart the entrance animation even when Firefox keeps the popup DOM alive.
    void nextPanel.offsetWidth;
    nextPanel.classList.add('active');
  };

  const setOnboardingStep = (step) => {
    if (!$('onboardingStep1') || !$('onboardingStep2')) return;
    $('onboardingStep1').hidden = step !== 1;
    $('onboardingStep2').hidden = step !== 2;
    if ($('onboardingStepBadge')) $('onboardingStepBadge').textContent = `${step} / 2`;
  };

  const showOnboardingIfNeeded = (settings) => {
    if (!$('onboarding') || (settings.onboardingDone && !IS_FIRST_INSTALL_SETUP)) return;
    fillTargetLanguageSelects();
    $('onboardingUiLanguage').value = settings.uiLanguage || DEFAULT_SETTINGS.uiLanguage;
    $('onboardingTargetLang').value = settings.targetLang || DEFAULT_SETTINGS.targetLang;
    setOnboardingStep(1);
    $('onboarding').hidden = false;
  };

  const syncOnboardingUiLanguage = async () => {
    const uiLang = $('onboardingUiLanguage')?.value || DEFAULT_SETTINGS.uiLanguage;
    if ($('uiLanguage')) $('uiLanguage').value = uiLang;
    applyI18n();
    await storageSet({ uiLanguage: uiLang });
  };

  const finishOnboarding = async () => {
    const uiLang = $('onboardingUiLanguage')?.value || DEFAULT_SETTINGS.uiLanguage;
    const target = $('onboardingTargetLang')?.value || DEFAULT_SETTINGS.targetLang;
    if ($('uiLanguage')) $('uiLanguage').value = uiLang;
    if ($('targetLang')) $('targetLang').value = target;
    applyI18n();
    await storageSet({ ...readForm(), uiLanguage: uiLang, targetLang: target, onboardingDone: true });
    if ($('onboarding')) $('onboarding').hidden = true;
    await notifyActiveSupportedTab();
    setStatus(t('statusSaved'));
    if (IS_FIRST_INSTALL_SETUP) {
      setTimeout(() => {
        try { globalThis.close(); } catch (_error) { /* Keep the settings page open if closing is unavailable. */ }
      }, 500);
    }
  };

  const testTranslation = async () => {
    try {
      await save(true);
      setStatus(t('statusTesting'), 8000);
      const response = await sendMessage({ type: 'YTBBI_TEST_TRANSLATION' });
      if (!response?.ok) throw new Error(response?.error || t('testFailed'));
      setStatus(t('statusTestSuccess', { text: response.translatedText }), 6000);
    } catch (error) {
      setStatus(t('statusTestFailed', { error: explainError(error.message) }), 8000);
    }
  };


  const clearTranslationCache = async () => {
    try {
      const response = await sendMessage({ type: 'YTBBI_CLEAR_TRANSLATION_CACHE' });
      if (!response?.ok) throw new Error(response?.error || t('unknownError'));
      setStatus(t('statusCacheCleared'), 4000);
    } catch (error) {
      setStatus(t('statusTestFailed', { error: explainError(error.message) }), 8000);
    }
  };

  const bindExternalLinks = () => {
    document.querySelectorAll('a[data-external-link]').forEach((link) => {
      link.addEventListener('click', async (event) => {
        event.preventDefault();
        const url = link.getAttribute('href');
        if (!url) return;
        try {
          await callMaybePromise(EXT.tabs.create, EXT.tabs, { url });
        } catch (_error) {
          globalThis.open(url, '_blank', 'noopener,noreferrer');
        }
      });
    });
  };

  const init = async () => {
    const stored = await storageGet(DEFAULT_SETTINGS);
    const settings = { ...DEFAULT_SETTINGS, ...stored };
    fillTargetLanguageSelects();
    writeForm(settings);
    applyI18n();
    showOnboardingIfNeeded(settings);

    document.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => activatePanel(tab.dataset.panel));
    });

    $('onboardingUiLanguage')?.addEventListener('change', () => {
      syncOnboardingUiLanguage().catch(() => {});
    });
    $('onboardingNext')?.addEventListener('click', async () => {
      await syncOnboardingUiLanguage();
      setOnboardingStep(2);
    });
    $('onboardingBack')?.addEventListener('click', () => setOnboardingStep(1));
    $('onboardingDone')?.addEventListener('click', finishOnboarding);

    fields.forEach((field) => {
      const el = $(field);
      if (!el) return;
      el.addEventListener('change', () => {
        updateRangeLabels();
        if (field === 'uiLanguage') { applyI18n(); renderVocabulary(); }
        if (field === 'translationProvider') updateProviderUi();
        if (field === 'geminiPrimaryModel' || field === 'geminiFallbackModel') updateGeminiModelInfo();
        save();
      });
      if (el.type === 'range') {
        el.addEventListener('input', updateRangeLabels);
      }
    });

    $('save').addEventListener('click', () => {
      // Ask for the provider's host permission inside the click (user gesture).
      const permission = requestProviderPermission($('translationProvider').value);
      permission.then((granted) => save().then(() => {
        if (!granted) setStatus(t('providerPermissionDenied'), 6000);
      }));
    });
    $('bergamotPrepare')?.addEventListener('click', prepareBergamot);
    $('bergamotClear')?.addEventListener('click', clearBergamotModels);
    $('reset').addEventListener('click', reset);
    $('testTranslation').addEventListener('click', testTranslation);
    $('clearTranslationCache')?.addEventListener('click', clearTranslationCache);
    $('loadGeminiModels')?.addEventListener('click', loadGeminiModels);
    $('saveGeminiSettings')?.addEventListener('click', saveGeminiSettings);
    $('testGeminiSettings')?.addEventListener('click', testGeminiSettings);
    $('toggleGeminiApiKey')?.addEventListener('click', () => {
      const input = $('geminiApiKey');
      if (!input) return;
      const visible = input.type === 'text';
      input.type = visible ? 'password' : 'text';
      $('toggleGeminiApiKey').textContent = t(visible ? 'showKey' : 'hideKey');
    });
    $('geminiPrimaryModel')?.addEventListener('change', updateGeminiModelInfo);
    $('geminiFallbackModel')?.addEventListener('change', updateGeminiModelInfo);
    $('exportVocab').addEventListener('click', exportVocabulary);
    $('clearVocab').addEventListener('click', clearVocabulary);

    bindExternalLinks();

    await renderVocabulary();
  };

  init();
})();
