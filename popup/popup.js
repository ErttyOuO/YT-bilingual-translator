(() => {
  'use strict';

  const IS_BROWSER_PROMISE_API = typeof browser !== 'undefined';
  const EXT = IS_BROWSER_PROMISE_API ? browser : chrome;
  const DEFAULT_SETTINGS = {
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
    transcriptFirstMode: true,
    onboardingDone: false
  };

  const $ = (id) => document.getElementById(id);
  const I18N = globalThis.YTBBI_I18N;
  const currentLang = () => $('uiLanguage')?.value || DEFAULT_SETTINGS.uiLanguage || 'zh-TW';
  const t = (key, vars) => I18N?.t(currentLang(), key, vars) || key;
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
    'uiLanguage',
    'translationProvider',
    'autoFailover',
    'batchTranslationEnabled',
    'batchSize',
    'googleCloudApiKey',
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
    'stableAutoCaptions',
    'transcriptFirstMode',
    'interactiveLookup',
    'dictionaryMode',
    'showWordUnderline',
    'fontSize',
    'bottomPercent',
    'maxWidthPercent',
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
    if (message === 'NO_CLOUD_V3_PROXY_URL') return t('errNoCloudV3');
    if (/API key not valid|API_KEY_INVALID/i.test(message)) return t('errInvalidKey');
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
      'google-html': 'providerHelpGoogleHtml',
      'microsoft-edge': 'providerHelpMicrosoft',
      'google-free': 'providerHelpGoogleFree',
      'cloud-v2': 'providerHelpCloudV2',
      'cloud-v3-proxy': 'providerHelpCloudV3',
      'libretranslate': 'providerHelpLibre',
      'lingva': 'providerHelpLingva'
    }[provider];
    const text = providerHelpKey ? t(providerHelpKey) : '';
    if (help) help.textContent = text;
  };

  const readForm = () => ({
    enabled: $('enabled').checked,
    uiLanguage: $('uiLanguage') ? $('uiLanguage').value : 'zh-TW',
    translationProvider: $('translationProvider').value,
    autoFailover: $('autoFailover').checked,
    batchTranslationEnabled: $('batchTranslationEnabled').checked,
    batchSize: Number($('batchSize').value),
    googleCloudApiKey: $('googleCloudApiKey').value.trim(),
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
    stableAutoCaptions: $('stableAutoCaptions').checked,
    transcriptFirstMode: $('transcriptFirstMode') ? $('transcriptFirstMode').checked : true,
    interactiveLookup: $('interactiveLookup').checked,
    dictionaryMode: $('dictionaryMode').value,
    showWordUnderline: $('showWordUnderline').checked,
    fontSize: Number($('fontSize').value),
    bottomPercent: Number($('bottomPercent').value),
    maxWidthPercent: Number($('maxWidthPercent').value),
    debug: $('debug').checked
  });

  const writeForm = (settings) => {
    $('enabled').checked = !!settings.enabled;
    if ($('uiLanguage')) $('uiLanguage').value = settings.uiLanguage || 'zh-TW';
    $('translationProvider').value = settings.translationProvider || 'auto-free';
    $('autoFailover').checked = settings.autoFailover !== false;
    $('batchTranslationEnabled').checked = settings.batchTranslationEnabled !== false;
    $('batchSize').value = settings.batchSize || 5;
    $('googleCloudApiKey').value = settings.googleCloudApiKey || '';
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
    $('stableAutoCaptions').checked = settings.stableAutoCaptions !== false;
    if ($('transcriptFirstMode')) $('transcriptFirstMode').checked = settings.transcriptFirstMode !== false;
    $('interactiveLookup').checked = !!settings.interactiveLookup;
    $('dictionaryMode').value = settings.dictionaryMode || 'both';
    $('showWordUnderline').checked = !!settings.showWordUnderline;
    $('fontSize').value = settings.fontSize;
    $('bottomPercent').value = settings.bottomPercent;
    $('maxWidthPercent').value = settings.maxWidthPercent;
    $('debug').checked = !!settings.debug;
    updateRangeLabels();
  };

  const notifyActiveYouTubeTab = async () => {
    try {
      const tabs = await callMaybePromise(EXT.tabs.query, EXT.tabs, { active: true, currentWindow: true });
      const tab = tabs && tabs[0];
      if (!tab || !tab.id || !/youtube\.com/.test(tab.url || '')) return;
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
    await notifyActiveYouTubeTab();
    if (!silent) setStatus(t('statusSaved'));
  };

  const reset = async () => {
    await storageSet(DEFAULT_SETTINGS);
    writeForm(DEFAULT_SETTINGS);
    applyI18n();
    await notifyActiveYouTubeTab();
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

  const panelOrder = ['panel-general', 'panel-translation', 'panel-subtitle', 'panel-learning', 'panel-advanced'];

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
    if (!$('onboarding') || settings.onboardingDone) return;
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
    await notifyActiveYouTubeTab();
    setStatus(t('statusSaved'));
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
        save();
      });
      if (el.type === 'range') {
        el.addEventListener('input', updateRangeLabels);
      }
    });

    $('save').addEventListener('click', () => save());
    $('reset').addEventListener('click', reset);
    $('testTranslation').addEventListener('click', testTranslation);
    $('exportVocab').addEventListener('click', exportVocabulary);
    $('clearVocab').addEventListener('click', clearVocabulary);

    bindExternalLinks();

    await renderVocabulary();
  };

  init();
})();
