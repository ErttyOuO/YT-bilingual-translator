# AMO 上架說明（v0.61.0）

## 上傳步驟

1. 產生套件：

   ```bash
   python tools/build-xpi.py
   ```

   輸出 `dist/yt-bilingual-translator-0.61.0.xpi`（約 2 MB，含 Bergamot WASM 引擎）。

2. 前往 Firefox Add-on Developer Hub → 你的附加元件 → **Upload New Version**，上傳該 `.xpi`。
3. 「Do you need to submit source code?」選 **No**。擴充功能自己的 JavaScript 沒有壓縮或轉譯；`vendor/bergamot/` 是未修改的第三方檔案，依 AMO 第三方函式庫規定在下方「Notes to Reviewer」附上原始位置與原始碼連結即可。
4. 將下方「Release notes」與「Notes to Reviewer」分別貼到對應欄位。

上傳前自行檢查（與 AMO 相同的 linter）：

```bash
npx --yes addons-linter@latest dist/yt-bilingual-translator-0.61.0.xpi
```

v0.61.0 檢查結果：0 errors、9 warnings。
- 8 個 `UNSAFE_VAR_ASSIGNMENT`：單字卡沿用的 `innerHTML`，內容都經過 `escapeText`。
- 1 個 `DANGEROUS_EVAL`：`vendor/bergamot/translator-worker.js` 第 49 行，屬於該套件的 Node.js 相容分支（只在 `typeof self === 'undefined'` 時執行），瀏覽器 Worker 中不會執行。依第三方規定不修改該檔案。

## Release notes（版本說明，給使用者看）

### 繁體中文

新增 DeepL API 與 Microsoft Translator（Azure）兩個自備 Key 的翻譯來源，以及在瀏覽器內執行、不送出字幕的本機翻譯（Bergamot，使用 Firefox Translations 模型，第一次需下載約 50 MB）。免 Key 模式改為 Google → Google Dictionary → MyMemory，移除已失效的 Microsoft Edge 端點。新來源需要的網站權限改為選用，只在選擇時詢問。

### English

Adds DeepL API and Microsoft Translator (Azure) as bring-your-own-key providers, plus local in-browser translation with Bergamot that never sends subtitles anywhere (uses the Firefox Translations models; first use downloads about 50 MB). Key-free mode is now Google → Google Dictionary → MyMemory; the defunct Microsoft Edge endpoint is removed. Site permissions for the new providers are optional and only requested when you choose them.

## Notes to Reviewer

```text
No build step for the extension's own code. Repository: https://github.com/ErttyOuO/YT-bilingual-translator

THIRD-PARTY LIBRARY (unmodified):
vendor/bergamot/translator-worker.js
vendor/bergamot/bergamot-translator-worker.js
vendor/bergamot/bergamot-translator-worker.wasm
  = package/worker/* from npm @browsermt/bergamot-translator 0.4.9
  Original files: https://registry.npmjs.org/@browsermt/bergamot-translator/-/bergamot-translator-0.4.9.tgz
  Readable source (npm gitHead): https://github.com/browsermt/bergamot-translator/tree/8cc5d0495479c9ec56eafafd6bcd7fb5b929ca98
  WASM build: build-wasm.sh and wasm/ in that repository. License: MPL-2.0.
  SHA-256 of each file is listed in vendor/bergamot/README.md.
  The eval warning (translator-worker.js:49) is the package's Node.js branch, only taken when
  `self` is undefined; it never runs in the browser Worker.

LOCAL TRANSLATION (bergamot-engine.js):
- Runs the WASM engine in a dedicated Worker created by the background page.
- Translation models are DATA, not code: the Firefox Translations models from Mozilla Remote
  Settings (collection "translations-models"), downloaded only after the user picks local
  translation and grants the optional host permissions below. Each file is verified against the
  published SHA-256 and stored in the extension's IndexedDB.
- CSP declares 'wasm-unsafe-eval' as recommended by MDN for WebAssembly.

OPTIONAL PERMISSIONS (requested only when the user selects the matching provider):
- https://api-free.deepl.com/*, https://api.deepl.com/*  -> DeepL API with the user's own key
- https://api.cognitive.microsofttranslator.com/*        -> Microsoft Translator with the user's own key
- https://firefox.settings.services.mozilla.com/*,
  https://firefox-settings-attachments.cdn.mozilla.net/* -> model download for local translation
Removed: edge.microsoft.com and api-edge.cognitive.microsofttranslator.com.

Testing: open a YouTube video with captions (e.g. a TED talk) and turn on CC. The default mode
needs no account or key. For local translation: Settings > Translation > "本機翻譯 Bergamot" >
"準備本機模型", accept the permission prompt, wait for "ready".
```
