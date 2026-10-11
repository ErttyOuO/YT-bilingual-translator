## v0.61.0 - 2026-10-12

### 新增翻譯來源
- **DeepL API（自備 Key）**：使用 `/v2/translate` 原生批次；免費方案金鑰（結尾 `:fx`）自動使用 `api-free.deepl.com`。繁體送 `ZH-HANT`、簡體送 `ZH-HANS`。額度用完（HTTP 456）會顯示提示並冷卻。
- **Microsoft Translator（Azure，自備 Key + 區域）**：取代已失效的免費 Edge 端點，使用官方 `api.cognitive.microsofttranslator.com`。
- **本機翻譯 Bergamot**：在擴充功能自己的 Worker 中執行 WebAssembly 翻譯引擎，字幕不會送到任何伺服器。
  - 引擎：`@browsermt/bergamot-translator` 0.4.9 的 worker 檔案，原封不動收在 `vendor/bergamot/`（MPL-2.0）。
  - 模型：Firefox Translations 使用的模型（Mozilla Remote Settings `translations-models`），第一次使用時下載（每個方向約 50 MB），以 SHA-256 驗證後存在擴充功能的 IndexedDB。
  - 已確認有 en→zh-Hant（繁體）與 en→zh-Hans（簡體）模型；其他語言若沒有直接模型，會經英文轉換（例如 ja→en→zh-Hant）。
  - 來源語言取自 YouTube 字幕軌標示，不自動猜測；不知道語言時明確顯示錯誤。
  - 預設**不會**在失敗時改用雲端翻譯；需在設定中勾選「本機翻譯失敗時改用免費雲端翻譯」才會。
  - 設定頁可「準備本機模型」、查看下載／載入狀態、刪除已下載的模型。
  - 中文輸出的半形標點（`嗎?`、`收看,下週見!`）會轉成全形。

### 變更
- 免 Key 模式改為 Google Free → Google Dictionary → MyMemory；移除失效的 Microsoft Edge 免費端點與其權限。原本選 Microsoft Edge 的使用者會自動改用免 Key 模式。
- DeepL、Azure 與模型下載需要的網站權限改為**選用權限**，只在選擇該翻譯來源時詢問；其他使用者更新時不會看到權限提示。
- manifest 宣告 `content_security_policy: script-src 'self' 'wasm-unsafe-eval'`（MDN 建議使用 WebAssembly 的擴充功能明確宣告）。

### 驗證
- 回歸測試 38 項全數通過（新增 DeepL、Azure、免 Key 順序、Bergamot 來源語言與模型挑選）。
- 在 Firefox 157（無頭模式、全新設定檔）實際安裝並經由背景頁執行：模型下載 49.5 MB 並驗證、約 7–10 秒就緒，每句翻譯 0.35–0.7 秒；重新啟動後從快取載入模型約 0.45 秒。

## v0.60.0 - 2026-10-12

翻譯核心重寫版。外觀、拖曳、播放器按鈕與 Popup 沿用，問題集中的翻譯引擎與斷句重新整理。

### 中英翻譯正確性
- 修正繁簡中文混用：新增共用語言代碼表 `lang-codes.js`。Microsoft 先前把簡體目標也送成 `zh-Hant`；Lingva／LibreTranslate 把繁體目標送成簡體 `zh`；MyMemory 一律送 `zh-TW`。現在各來源都依目標語言送出正確的繁體或簡體代碼（LibreTranslate 依版本嘗試 `zh-Hant`／`zt`）。
- 修正 Google Dictionary 端點的譯文尾端被接上偵測語言代碼（例如「…討論它。en」）。
- 修正 MyMemory 額度用盡時，警告文字「MYMEMORY WARNING…」被當成譯文顯示並寫入快取。
- MyMemory 來源語言改依主要文字系統判斷，不再因為句中有一個英文字母就判定為英文。
- Microsoft 改用純文字模式，`<3`、`&` 等字元不再被當成 HTML；token 被拒（401／403）時會重新取得一次。
- 單字卡翻譯固定以英文為來源，避免 die、gift、chef 被誤判成德文或法文；字典、圖片與三段翻譯改為並行，並加上字典逾時。

### 斷句與時間軸
- 手動字幕也會合併成完整句子再翻譯（可在 Popup 關閉「手動字幕合併成完整句子再翻譯」）。
- `Mr.`、`Dr.`、`U.S.`、`etc.` 等縮寫不再被當成句尾。
- 日文、中文自動字幕的 token 不再被插入空格。
- 修正字幕在長時間靜音或配樂時一直殘留到下一句；超過 1.5 秒的空檔後，上一句會在 0.7 秒內消失。
- 字幕軌語言與目標語言相同（例如英文影片、目標英文）時只顯示原文，不送出翻譯請求。

### 排程與效能
- 每個翻譯來源改用優先佇列：最多 1～4 個並行請求、請求間距沿用原設定，畫面上的字幕會插隊到等待中的預取前面。先前同一來源完全串行，當前字幕可能卡在預取批次後面。
- 當前字幕在同一來源不重試，直接換下一個來源；預取最多重試一次，且 403 不再重試。
- 預取最多佔 1 個工作名額，當前字幕另有 3 個名額，不再互搶。
- 免費端點的標記批次失敗時只花 1 個請求，之後該來源 10 分鐘內不再嘗試標記批次，直接改逐句；不再拆半重試、也不會連續嘗試多個來源的批次（先前最壞情況約 30 個請求）。
- 自動免費模式順序改為 Google Free → Microsoft Edge → Google Dictionary → Lingva → LibreTranslate → MyMemory。2026 年 10 月實測 Microsoft 免費授權端點回傳 404；回傳 404 的來源會冷卻 30 分鐘。
- 修正暫時性錯誤判斷誤把含 "generate"、"separate" 的錯誤訊息當成限流。
- 翻譯快取保存在本機 storage（最多 2,500 句），背景頁被卸載後不必重翻；Popup 新增「清除翻譯快取」。
- 切換播放器上的雙語按鈕、字體大小等純顯示設定時，不再重新下載字幕與清空譯文。

### 開發
- 回歸測試由 24 項增為 34 項；測試若卡住未完成會判定失敗，不再無聲通過。
- 新增 `tests/live-provider-smoke.cjs`，可手動對真實免費端點檢查繁簡輸出。
- 新增 `tools/build-xpi.py`，產生 AMO 上架用 `.xpi`（路徑使用 `/`、只含執行檔案）。
- Chrome MV3 範本新增 `background-sw.js`，以 `importScripts` 載入 `lang-codes.js` 與 `background.js`。

## v0.53.0 - 2026-10-05

- 修正翻譯請求排隊時提前逾時，網路 timeout 現在從連線開始計算，並涵蓋回應本文。
- 當前字幕優先於遠處預取；保留預取處理與當前字幕處理的容量，避免預取占滿工作名額。
- 預取所有句子先登記去重；批次失敗轉逐句時，每句完成便立即交回等待者。
- 同一句暫時翻譯失敗後最多重試兩次；預取補回成功譯文時立即更新畫面。
- 跳轉／換片時取消尚未開始且無其他消費者的舊預取，防止空白字幕區間或跳轉後出現舊譯文。
- 快取保留大小寫、標點與數字格式；更換翻譯來源、模型或目標語言後重新取得譯文。
- 高頻字幕／timeupdate 事件改用固定節流，避免事件持續重設等待時間而讓字幕讀取或預取無法開始。
- DOM 字幕備援的最長組句等待由 6 秒降至 2.5 秒，並依播放速度縮短；仍保留標點與穩定文字判斷。
- 加入完整字幕下載 timeout／失敗冷卻，修正同語言不同字幕軌切換時沿用舊資料。
- 保留 Gemini 原生 `x-goog-api-key` 呼叫方式，接受完整 `AQ.` 金鑰；同步 Chrome 範本 Gemini 權限。
- 加入可在 Node 執行的翻譯回歸測試，並接入 CI；真實 YouTube／API 的使用效果仍需實際播放確認。

## v0.29.0

- 將播放器內切換按鈕改為 inline SVG，不再使用圖片檔嵌入播放器控制列。
- 移除圓形玻璃底與狀態點，改成更接近 YouTube 原生控制列的簡潔線條 icon。
- 開啟狀態顯示青綠色；關閉狀態顯示灰白色，避免不同語言使用者依賴文字判斷。

## v0.28.0

- 優化播放器內雙語字幕切換按鈕外觀。
- 將原本較生硬的方形視覺調整為較圓潤的玻璃感圓形按鈕。
- 保留本專案 icon，並以彩色 / 黑白切換狀態呈現。
- 新增小狀態點與較自然的 hover / focus 視覺。

## v0.27.0

- 修正單字卡圖片在 YouTube 頁面可能無法顯示的問題：背景腳本會先抓取縮圖並轉成 data URL，再交給 content script 顯示。
- 新增 `upload.wikimedia.org` 權限，用於 Wikimedia / Wikipedia 圖片縮圖讀取。
- 放寬 Commons SVG 圖片支援，但仍過濾 logo、flag、map、diagram 等低相關圖片。
- 修正影片暫停後字幕仍可能繼續切到後續片段的問題：暫停狀態會凍結字幕推進，只有播放或使用者 seek 後才更新。

## v0.26.0

- 移除硬編碼的 Google API Key。
- 移除內建 Google Web Translate provider 與 `removed Google Web API endpoint` 權限。
- 自動免費翻譯順序調整為 Microsoft Edge Translate → Google Free → Google Dictionary → Lingva → LibreTranslate → MyMemory。
- 若舊版設定仍選到 `google-html`，會自動回退到 `auto-free`。

## v0.25.0

- 將播放器內雙語字幕開關由文字 `雙 / OFF` 改為使用本專案 icon 顯示狀態。
- 開啟時顯示彩色 icon；關閉時顯示黑白／灰階 icon。
- 讓不同語言使用者不需依賴文字即可理解開關狀態。

# Changelog

## 0.24.0 - 2026-06-25

### Fixed
- Reduced YouTube player freezes caused by the v0.23 in-player toggle.
- Removed a mutation feedback loop where the extension repeatedly moved the bilingual toggle button inside YouTube controls.
- Throttled player-toggle reinsertion and limited caption re-reading to actual caption mutations.

### Changed
- The in-player toggle is now inserted only when missing or detached, instead of being repositioned on every YouTube UI mutation.


## 0.23.0 - In-player toggle and native-caption sync

- 在 YouTube 播放器的 CC 字幕按鈕旁新增「雙 / OFF」快速切換鍵。
- 開啟本外掛雙語字幕時會自動隱藏 YouTube 原字幕，避免原版字幕與外掛字幕重疊。
- 關閉本外掛雙語字幕時會恢復 YouTube 原字幕顯示，保留原本的 YouTube CC 使用方式。
- Popup 的「隱藏 YouTube 原字幕」改為跟隨雙語字幕開關的自動行為。
- 既有字幕翻譯、批次預取、翻譯備援、單字卡與單字本功能不變。

## 0.22.0 - GitHub Link Update

- 更新 Popup 進階分類中的本專案 GitHub 連結：`https://github.com/ErttyOuO/YT-bilingual-translator`。
- 更新 `manifest.json` 的 `homepage_url`，讓 Firefox 商店與專案資訊指向正式 GitHub repository。
- 功能邏輯不變，延續 v0.21 的 Popup 動畫、字幕翻譯、單字卡、批次預取與翻譯備援。


## v0.21.0

- 優化 Popup 分類切換體驗，新增淡入、滑動與卡片漸進動畫。
- 分類切換時會依照前進 / 返回方向套用不同滑動方向，讓設定頁切換更自然。
- 保留使用者系統的「減少動態效果」偏好；若啟用 reduced motion，動畫會自動停用。
- 功能邏輯不變，保留 v0.20 的專案連結、參考專案連結、初次導引、可選目標語言與字幕學習功能。


## 0.20.0

- 在 Popup 進階頁新增「專案資訊」區塊。
- 加入本專案 GitHub 與 ErttyOuO 協助製作連結。
- 加入參考與學習的開源專案連結：Read Frog、yt-dual-sub、BilingualTube、YouTube Subtitle Translator、multi-subs-yt、youtube-live-translate。
- 更新 README 內的參考來源與授權說明。


## v0.19.0

- 修正初次使用導引中第 1 步與第 2 步同時顯示的問題。
- 初次使用第 1 步改為中英雙語說明，讓不同語言使用者知道目前正在選擇介面語言。
- 選擇介面語言後會立即切換 Popup 介面語言；按「下一步 / Next」後才進入字幕翻譯目標語言設定。
- 保留 v0.18 的 Popup 分類、可選字幕翻譯目標語言、Transcript-first 引擎、批次預取、翻譯備援、互動單字卡與單字圖片功能。


## 0.19.0

- Reorganized popup settings into clear categories: General, Translation, Subtitles, Learning, and Advanced.
- Added first-run onboarding: choose extension UI language first, then choose subtitle translation target language.
- Added configurable subtitle target language instead of forcing Traditional Chinese.
- Updated subtitle translation, batch prefetch, display cache, and word-card translation flow to respect the selected target language.
- Kept transcript-first engine, no-flicker rendering, draggable subtitles, word images, vocabulary list, failover, and batch prefetch behavior.
- Updated README / architecture / project-structure documentation for future development reference.


## 0.16.0

- Reworked the repository into a GitHub-ready open-source package.
- Rewrote `README.md` in Traditional Chinese as the default entry point.
- Added multilingual README links: English, Japanese, Korean, Spanish, Simplified Chinese.
- Added README images under `docs/assets/`.
- Added architecture and project structure documentation for future development.
- Clarified Firefox-first usage, current feature purpose, technical flow, and extension design.
- Kept v0.15 functionality unchanged.

## 0.15.0

- Prepared a GitHub-friendly open-source release package.
- Added selectable extension UI language.
- Added UI localization for popup settings and in-video word card labels.
- Supported UI languages: Traditional Chinese, English, Japanese, Korean, Spanish, Simplified Chinese.
- Kept subtitle translation target fixed to Traditional Chinese for stability.
- Kept all v0.14 features unchanged: transcript-first subtitles, drag position, word images, batch prefetch, translation failover, word cards, vocabulary export.

## 0.14.0

- Added draggable subtitle position per video.
- Added word image lookup through Wikipedia / Wikimedia Commons.

## 0.13.0

- Improved transcript time-window matching to reduce missing subtitle segments.

## 0.12.0

- Reduced subtitle flicker by syncing display cache and avoiding duplicate renders.
