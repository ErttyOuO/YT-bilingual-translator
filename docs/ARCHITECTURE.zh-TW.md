# 系統架構說明

本文件說明 YT 雙語字幕翻譯器目前的設計方式，目的是讓後續開發者可以理解「現有功能為什麼這樣寫」，以及新增功能時應該接在哪一層。

## 1. 架構目標

本專案要解決的核心問題不是單純翻譯文字，而是：

1. YouTube 自動字幕常常是一詞一詞變動。
2. 免費翻譯服務容易限流或失敗。
3. 字幕如果每句都即時翻譯，使用者會看到等待與閃爍。
4. 語言學習需要保留原文、翻譯、單字查詢與單字本。

因此目前架構採用：

```text
Transcript-first 字幕資料
+ 穩定分段
+ 批次預取翻譯
+ 多翻譯來源備援
+ 本機快取
+ 互動單字卡
```

## 2. 執行環境

目前主要目標是 Firefox WebExtension MV2：

- `manifest.json`：Firefox MV2 版本
- `background.js`：背景請求與快取
- `content.js`：YouTube 頁面 UI 與字幕邏輯
- `page-bridge.js`：注入 YouTube 主世界取得 player 資料
- `popup/`：設定介面

Chrome / Edge 的 MV3 manifest 只放在 `chrome-mv3-template/` 作為參考，不是主要保證版本。

## 3. 資料流總覽

```text
[YouTube Page]
      ↓
[content.js]
  建立 overlay / 注入 bridge / 監聽影片狀態
      ↓
[page-bridge.js]
  讀取 player response、captionTracks、timedtext URL
      ↓
[content.js]
  取得 timedtext json3 → 解析 cue → 穩定分段
      ↓
[content.js]
  根據 video.currentTime 選擇目前 cue
      ↓
[content.js]
  將未來 30 秒 cue 送 background 預翻
      ↓
[background.js]
  cache → batch → provider queue → failover → 回傳翻譯
      ↓
[content.js]
  顯示雙語字幕，避免重複 render 與閃爍
      ↓
[Word Card]
  點擊單字 → 查字典 / 翻譯 / 圖片 / 加入單字本
```

## 4. 字幕取得策略

### 第一優先：YouTube transcript / timedtext

`content.js` 會透過 `page-bridge.js` 取得 YouTube player response 中的 captionTracks，並嘗試抓取 `fmt=json3` 的 timedtext。

優點：

- 有完整時間軸
- 可以預取未來字幕
- 比單純畫面字幕穩定
- 較容易避免逐字跳動

### 第二優先：observed timedtext URL

`page-bridge.js` 會 patch `fetch` 與 `XMLHttpRequest.open`，觀察 YouTube 自己發出的 timedtext URL。這些 URL 有時包含 YouTube 需要的參數，因此可以提高抓取成功率。

### 第三優先：可見字幕 fallback

如果 transcript 失敗，才退回讀取畫面字幕 DOM。這個模式較不穩，所以只作為備用。

## 5. 自動字幕分段

YouTube 自動字幕常見格式：

```text
maybe
maybe their
maybe their whole life
maybe their whole life.
```

如果每次畫面變動都翻譯，會造成重複請求與閃爍。因此目前會：

1. 優先解析 json3 中的 `events` / `segs` / `tOffsetMs`。
2. 建立 token timeline。
3. 根據時間間隔、句尾標點、長度、soft boundary 合併片段。
4. 產生較適合閱讀的 cue window。

## 6. 翻譯預取與快取

字幕顯示時不應等到畫面出現才開始翻譯。因此目前設計：

- 播放時從目前時間向後抓約 30 秒字幕。
- 最多抓一段固定數量 cue。
- 批次送到 background 翻譯。
- 翻譯完成後寫入 background cache 與 content display cache。
- 顯示時先查快取，命中就直接顯示。
- 未命中才顯示延遲的 `Translating...` 狀態。

這樣可以降低字幕閃爍與等待。

## 7. Provider failover

`background.js` 中的 provider 順序目前是：

```text
Google Translate Web endpoint
→ Microsoft Edge Translate
→ Google Free
→ Google Dictionary endpoint
→ Lingva
→ LibreTranslate
→ MyMemory
```

每個 provider 有：

- timeout
- delay
- cooldown
- failure count
- queue

當 provider 回傳 403、429、5xx、timeout 或網路錯誤時，會暫時冷卻並切換下一個來源。

## 8. 顯示層設計

字幕 overlay 由 `content.js` 建立，樣式在 `content.css`。

設計原則：

- 不直接修改 YouTube 原生字幕內容
- 另外建立獨立 overlay
- 原文單字可點擊
- no-op render guard 避免相同內容重複重建 DOM
- 翻譯尚未回來時延遲顯示 loading，避免快取回來太快時閃爍
- 拖曳位置以 videoId 儲存，只影響目前影片

## 9. 單字卡與單字本

點擊字幕單字後：

1. `content.js` 清理單字。
2. 發送 lookup 訊息給 `background.js`。
3. `background.js` 查字典 API。
4. 使用翻譯 provider 補英中意思與例句翻譯。
5. 若適合，查 Wikipedia / Wikimedia 圖片。
6. `content.js` 顯示單字卡。
7. 使用者可加入本機單字本。

單字本保存在 browser extension storage，並可由 popup 匯出 JSON。

## 10. 多語系 UI

`i18n.js` 提供介面字串。設定中的 `uiLanguage` 會影響：

- popup 設定頁
- 影片內單字卡標籤
- 部分狀態文字

但不影響字幕翻譯目標。字幕翻譯目標由 `targetLang` 控制，預設為繁體中文 `zh-TW`，使用者可在初次導引或一般設定中修改。

## 11. 新功能應該接在哪裡？

| 新功能類型 | 建議修改位置 |
|---|---|
| 字幕顯示樣式 | `content.css`, `content.js` overlay render |
| 翻譯來源 | `background.js` provider 區塊 |
| 字幕分段策略 | `content.js` transcript parser / merge logic |
| 單字卡欄位 | `content.js` popover render, `background.js` lookup |
| 設定項目 | `popup/popup.html`, `popup/popup.js`, `DEFAULT_SETTINGS` |
| UI 語言 | `i18n.js` |
| Chrome MV3 支援 | `chrome-mv3-template/`, background service worker 化 |

## 12. 目前限制

- 免費翻譯來源不是正式商用 API，可能限流或變動。
- 某些影片可能無法取得 transcript，只能 fallback 到可見字幕。
- 單字圖片只適合具體名詞，抽象詞不一定有準確圖片。
- Chrome / Edge MV3 仍需額外測試。
- 字幕翻譯目標已可選多種常用語言，但不同免費翻譯來源對部分語言的品質與穩定度不同。


## v0.19 Popup 與語言設定流程

v0.19 將 popup 從單一路徑的長表單改成分頁式設定，讓功能依使用情境分組。這樣做的目的是降低後續新增功能時的混亂：新的字幕功能應放在「字幕」，新的翻譯 provider 應放在「翻譯」或「進階」，新的單字學習功能應放在「學習」。

第一次使用時會進入 onboarding：

```text
popup.js 檢查 onboardingDone
  ↓
尚未完成 → 顯示 onboarding modal
  ↓
Step 1：選擇 uiLanguage
  ↓
Step 2：選擇 targetLang
  ↓
儲存到 storage.local，並通知 YouTube content script 重新讀取設定
```

`targetLang` 現在是字幕翻譯流程的正式設定值。`content.js` 在翻譯目前字幕、預取未來字幕、查單字卡目標語言解釋時，會把 `targetLang` 傳給 `background.js`。`background.js` 再依照 provider 的需求將語言代碼轉換成 Google / Microsoft / LibreTranslate / Lingva / MyMemory 可接受的格式。

重要原則：

- `uiLanguage` 只改變外掛介面。
- `targetLang` 改變字幕翻譯目標語言。
- `sourceLang` 維持 `auto`，避免使用者需要手動判斷影片語言。
- 翻譯快取 key 必須包含 `targetLang`，避免同一句字幕在不同目標語言下拿到錯誤快取。


## 初次使用導引流程（v0.19）

Popup 第一次開啟時會檢查 `storage.local.onboardingDone`。若尚未完成，會顯示 onboarding modal。流程分成兩步：

1. **選擇介面語言**：第一步固定以中英雙語顯示，避免使用者尚未設定語言前看不懂畫面。使用者一選擇語言，Popup 會立即把 `uiLanguage` 寫入 `storage.local`，並重新套用 `i18n.js` 的介面文字。
2. **選擇字幕翻譯目標語言**：第二步會使用剛才選擇的介面語言顯示說明，並設定 `targetLang`。字幕來源語言仍由翻譯引擎自動偵測。

完成後會寫入 `onboardingDone: true`，並通知目前的 YouTube 分頁重新讀取設定。這個設計讓「插件介面語言」與「字幕翻譯目標語言」分離，方便日後支援更多語言與更細的學習方向。


## 參考來源與後續開發說明

本專案在設計字幕資料讀取、批次預取、翻譯備援與互動單字卡時，參考了 Read Frog、yt-dual-sub、BilingualTube、YouTube Subtitle Translator、multi-subs-yt、youtube-live-translate 等開源專案的架構方向。

目前實作以本專案自有程式碼重寫為主，避免直接複製 GPL 專案內容。日後新增功能時，建議優先維持以下原則：

1. 字幕來源優先使用 transcript / timedtext，不直接依賴畫面逐字跳動。
2. 翻譯請求需經過快取、去重、節流與備援。
3. 互動學習功能應維持可關閉，不影響字幕基本顯示。
4. 商店版封包只保留執行必要檔案；完整文件與研究說明放在 GitHub。


## v0.21 Popup 動畫層

Popup 分類切換仍由 `popup/popup.js` 的 `activatePanel()` 控制，但新增了方向判斷與離場狀態：

1. 依照分類順序判斷使用者是往下一個分類前進，或返回前一個分類。
2. 舊 panel 會加上 `.leaving`，以絕對定位短暫保留並播放淡出動畫。
3. 新 panel 加上 `.active`，播放淡入與滑動動畫。
4. 動畫結束後移除舊 panel 的 `.leaving`。
5. CSS 使用 `prefers-reduced-motion` 偵測使用者偏好，必要時停用動畫。

這一層只處理 Popup 呈現，不碰翻譯、字幕或背景佇列流程。


## 專案連結

- GitHub：<https://github.com/ErttyOuO/YT-bilingual-translator>

## v0.23 播放器內切換與原生字幕同步

為避免 YouTube 原生字幕與本外掛雙語字幕同時顯示，v0.23 將「是否使用本外掛雙語字幕」設計為播放器內快速切換流程：

```text
使用者點擊 YouTube CC 旁的「雙 / OFF」按鈕
  ↓
更新 storage.local：enabled / hideNativeCaptions
  ↓
content.js 立即套用設定
  ↓
ON：顯示本外掛字幕 + 隱藏 YouTube 原字幕
OFF：隱藏本外掛字幕 + 恢復 YouTube 原字幕
```

這個開關不使用外部圖片或遠端資源，而是由 content script 直接建立一個簡潔的文字型按鈕，插入 YouTube 播放器右側控制列的 CC 字幕按鈕旁。


## v0.24 播放器切換穩定性

播放器內的雙語字幕開關不再於每次 YouTube UI 變動時重新移動位置。現在會透過節流的方式檢查按鈕是否存在，只有在控制列重建或按鈕被移除時才重新插入，避免造成 YouTube 播放器卡頓。
