<div align="center">

<img src="./icons/icon-128.png" alt="YouTube雙語字幕翻譯" width="128">

# YouTube雙語字幕翻譯

**Firefox-first 的開源雙語字幕學習擴充功能**

在 YouTube 上將原文字幕與翻譯字幕同步顯示，支援智慧斷句、提前預取、Gemini API、YouTube 原生自動翻譯、單字查詢、字幕拖曳，以及 Twitch Live 原生 CC 雙語字幕。

[![Firefox Add-ons](https://img.shields.io/badge/Firefox-Add--ons-FF7139?logo=firefoxbrowser&logoColor=white)](https://addons.mozilla.org/zh-TW/firefox/addon/youtube%E9%9B%99%E8%AA%9E%E5%AD%97%E5%B9%95%E7%BF%BB%E8%AD%AF/)
![Firefox](https://img.shields.io/badge/Firefox-First-orange?logo=firefoxbrowser)
![License](https://img.shields.io/badge/License-MIT-green)
![WebExtension](https://img.shields.io/badge/WebExtension-Firefox-blue)

**[前往 Firefox Add-ons 安裝](https://addons.mozilla.org/zh-TW/firefox/addon/youtube%E9%9B%99%E8%AA%9E%E5%AD%97%E5%B9%95%E7%BF%BB%E8%AD%AF/)**

</div>

---

## 專案簡介

「YouTube雙語字幕翻譯」是一個以 Firefox 為主要開發與測試目標的 WebExtension。

它不是單純把 YouTube 畫面上的 CC 逐行送去翻譯，而是盡可能先取得 YouTube timed-text 字幕時間軸，將自動產生字幕重新整理成較自然的句子，再提前翻譯並依影片時間顯示。

目標是讓雙語字幕更適合：

- 看英文 YouTube 影片
- 語言學習
- 比對原文與翻譯
- 快速查單字
- 長影片與高速播放
- YouTube Shorts
- 有原生 CC 的 Twitch Live

---

## 主要功能

### YouTube 雙語字幕

- 顯示「原文 + 翻譯」雙語字幕
- 可只顯示原文或只顯示翻譯
- 支援一般 YouTube 影片與 Shorts
- 原文與翻譯文字置中
- 字幕卡可整張拖曳
- 可以拖出影片範圍
- 拖曳後可跟著頁面捲動位置移動
- 字幕完全離開 viewport 時自動隱藏，捲回來後恢復
- 雙擊字幕控制點可重設位置
- Shorts 預設將字幕放在較上方，降低遮擋

### Timed Sentence Sync

針對 YouTube 自動產生 CC 常見的「逐字增加」形式：

```text
I
I think
I think this
I think this is
I think this is useful.
```

擴充功能會優先使用 timed-text 與 token 時間資料整理句子，而不是每增加一個單字就重新翻譯。

例如：

```text
I mean,
I kinda get it
because they've been working on
that game for so long.
```

會盡量整理為較完整的語句，再依真實字幕時間軸顯示，降低短片語快速跳動、翻譯追不上影片的情況。

### 自適應字幕預取

為避免高速播放時翻譯來不及，YouTube 字幕會提前預取：

| 播放速度 | 預取範圍 |
| --- | ---: |
| 1.0× | 約 90 秒 |
| 1.25× | 約 105 秒 |
| 1.5× | 約 120 秒 |
| 2.0× | 約 150 秒 |
| 2.0× 以上 | 最多約 150 秒 |

預取視窗會依播放速度調整，並使用翻譯快取避免重複請求。

目前預取 cue 範圍約為：

```text
最少：16 cues
最多：100 cues
```

---

## 翻譯來源

擴充功能支援多種翻譯來源，可以依需求在 Popup 的「翻譯」頁切換。

### YouTube 原生自動翻譯

**免 API Key。**

直接使用 YouTube 自己的 timed-text 自動翻譯結果，而不是模擬點擊播放器的：

```text
設定 → 字幕 → 自動翻譯
```

原文仍由本擴充功能的英文 Sentence Timeline 控制，翻譯字幕則依相同時間區間重新對齊。

例如：

```text
As some of you may know,
你們有些人可能知道，
```

目標語言設定會自動對應 YouTube 使用的語言代碼，例如：

```text
zh-TW → zh-Hant
zh-CN → zh-Hans
```

> YouTube 的 timed-text 服務可能出現 429 / 暫時限流。擴充功能包含 single-flight、冷卻與自動重試機制；限流期間會優先保留原文字幕，而不是讓整張字幕 UI 消失。

### Gemini API

可以填入自己的 Gemini API Key，並：

- 測試 API Key
- 自動取得目前可用模型
- 選擇「主要模型」
- 選擇「備援模型」
- 主要模型出現 429、過載、5xx、timeout 等錯誤時自動切換備援模型
- 不需要把 API Key 寫進原始碼

Gemini 批次翻譯使用結構化 ID 配對，降低多句翻譯回傳順序改變造成字幕錯配的機率。

### 其他翻譯來源

依目前版本設定，可使用或保留的 Provider 包含：

- 自動免費翻譯備援
- Microsoft 翻譯
- Google 免費翻譯端點
- Google Cloud Translation Basic v2（Legacy）
- Cloud Translation v3 Proxy
- LibreTranslate
- Lingva
- MyMemory

第三方服務的可用性、速率限制與政策由各服務自行決定。

---

## 批次翻譯

可以設定每次預取翻譯的句數：

| 每批句數 | 建議 |
| --- | --- |
| 3 句 | 最高穩定 |
| 5 句 | 保守 |
| **8 句** | **推薦** |
| 12 句 | 高效率 |
| 16 句 | Gemini／原生 Batch API 較適合 |

批次設定只影響「翻譯請求」，**不會決定字幕畫面如何切句**。

不同 Provider 會使用不同策略：

- Gemini：結構化 JSON + 固定 ID
- Microsoft / Google Cloud：原生多筆 Batch API
- 沒有正式 Batch API 的免費來源：自動限制每個實際請求的句數，並使用成對 ID frame 驗證
- 大批次解析失敗時，可縮小批次重新嘗試，再視需要退回逐句翻譯

---

## 單字學習

字幕不只是翻譯，也可以作為語言學習介面。

目前包含：

- 點擊英文單字查詢
- Click-only 單字卡，不使用 hover 自動跳出
- 字典解釋
- 單字圖片
- 發音
- 單字收藏／單字本
- 原文與翻譯對照

整張字幕卡可以拖曳，但保留點字行為；只有實際拖曳超過門檻時才會抑制點擊查字。

---

## Twitch Live 支援

除了 YouTube，本專案也包含獨立的 Twitch Live Caption Adapter。

目前 Twitch 功能：

- 僅處理 Twitch **Live**
- 需要直播本身提供原生 Closed Captions
- **不進行語音辨識**
- **不擷取直播音訊**
- TextTrack 優先
- Twitch 字幕 DOM fallback
- 自動嘗試啟用 Twitch CC
- 擴充功能啟用時可隱藏 Twitch 原字幕顯示
- 在 Twitch 原生 CC 旁提供雙語字幕開關
- Popup 也提供 Twitch Live 雙語字幕開關
- Twitch 字幕位置與 YouTube 分開保存

Twitch Live Caption 使用短時間穩定與合併機制，減少即時 CC 逐字更新造成的字幕閃爍。

> 如果 Twitch 直播本身沒有提供原生 CC，目前擴充功能不會啟動語音辨識。

---

## YouTube 與 Twitch 採分離架構

為降低其中一個平台改版後影響另一個平台，兩者的字幕來源邏輯刻意分開：

```text
YouTube
├─ content.js
├─ content.css
├─ timed-text / transcript
├─ Timed Sentence Sync
└─ Adaptive Prefetch

Twitch Live
├─ twitch-content.js
├─ twitch-content.css
├─ HTML5 TextTrack
└─ Native CC DOM fallback

共用
├─ background.js
│  ├─ Translation Providers
│  ├─ Gemini
│  ├─ Cache
│  └─ Batch Translation
├─ i18n.js
├─ Popup
└─ Dictionary / Wordbook
```

Twitch 功能不會直接使用 YouTube 的 timed-text 或 Adaptive Prefetch。

---

## 安裝

### 方法一：Firefox Add-ons

最推薦一般使用者使用官方 Firefox Add-ons 安裝：

**[安裝 YouTube雙語字幕翻譯](https://addons.mozilla.org/zh-TW/firefox/addon/youtube%E9%9B%99%E8%AA%9E%E5%AD%97%E5%B9%95%E7%BF%BB%E8%AD%AF/)**

Firefox Add-ons 商店上的版本可能因審核流程而與 GitHub 原始碼最新版本存在時間差。

### 方法二：Firefox 暫時載入原始碼

開發或測試最新原始碼時：

1. 下載或 Clone 此 Repository。
2. 在 Firefox 開啟：

   ```text
   about:debugging#/runtime/this-firefox
   ```

3. 點擊「載入暫時附加元件」。
4. 選擇專案根目錄中的：

   ```text
   manifest.json
   ```

5. 開啟 YouTube 影片測試。

Firefox 關閉後，暫時載入的擴充功能會被移除。

---

## 專案結構

```text
.
├─ manifest.json
├─ background.js
├─ content.js
├─ content.css
├─ page-bridge.js
├─ i18n.js
│
├─ twitch-content.js
├─ twitch-content.css
│
├─ popup/
│  ├─ popup.html
│  ├─ popup.css
│  └─ popup.js
│
├─ icons/
│  ├─ icon-48.png
│  ├─ icon-96.png
│  └─ icon-128.png
│
├─ README.md
├─ CHANGELOG.md
├─ PRIVACY.md
└─ LICENSE
```

其他版本的完整原始碼封包中，也可能包含 AMO Reviewer Notes 與測試報告，供 Firefox Add-ons 審核與開發驗證使用。

---

## 設定與本機資料

擴充功能可能在 Firefox extension storage 中保存：

- 擴充功能設定
- 介面語言
- 字幕目標語言
- YouTube／Twitch 字幕位置
- 單字本資料
- 翻譯快取
- API Provider 設定
- 使用者自行輸入的 API Key

API Key 不會硬編碼在擴充功能原始碼中。

如果使用 Gemini、Google Cloud、LibreTranslate 或其他需要 Key 的服務，請勿將自己的 Key 放入：

- GitHub Issue
- GitHub Commit
- 公開截圖
- 錄影
- README
- 公開 Release 設定檔

---

## 隱私

本專案不要求建立帳號，也不以廣告追蹤使用者。

依照使用者選擇的翻譯／查字功能，字幕文字、單字或查詢內容可能會傳送到所選的第三方服務。

詳細內容請閱讀：

**[PRIVACY.md](./PRIVACY.md)**

外部服務可能包含 Google、Microsoft、Gemini、LibreTranslate、Lingva、MyMemory、Dictionary API、Wikipedia / Wikimedia 等。

Twitch Live 功能目前只處理 Twitch 已提供的 Closed Captions，不擷取直播音訊，也不自行做語音辨識。

---

## 權限說明

擴充功能需要存取 YouTube／Twitch 頁面，才能：

- 讀取字幕狀態
- 取得 timed-text
- 顯示雙語字幕 Overlay
- 加入播放器字幕控制
- 在 SPA 路由切換時清理／重建字幕狀態

部分 Host Permission 則用於使用者選擇的翻譯、字典與圖片服務。

實際權限請以 [`manifest.json`](./manifest.json) 為準。

---

## 常見問題

### 為什麼 YouTube 原生自動翻譯偶爾只有英文？

YouTube timed-text 可能暫時回傳 `429 Too Many Requests`。

目前版本會：

1. 保留原文字幕。
2. 停止短時間重複打相同請求。
3. 進入共享 cooldown。
4. 在冷卻後自動重試。
5. 翻譯軌成功後補回目標語言。

如果 YouTube 長時間限制該字幕軌，可以暫時改用 Gemini 或其他翻譯 Provider。

### 為什麼 YouTube 的字幕不是照官方 CC 每一小段顯示？

這是刻意設計。

YouTube 自動 CC 常會逐字更新或因版面換行產生很短的 fragment。本擴充功能會盡量使用 timed-text token 與時間資訊重新整理成較完整句子，讓字幕更適合閱讀與翻譯。

### 為什麼 Twitch 沒有字幕？

目前 Twitch 模式只翻譯直播本身已提供的原生 CC。

如果直播沒有 Closed Captions，本擴充功能目前不會使用語音辨識補字幕。

### Gemini API Key 儲存在哪裡？

儲存在 Firefox 的 extension local storage，不會寫入 GitHub 原始碼。

仍建議使用者妥善管理自己的 API Key，並依服務供應商的安全政策設定限制。

### 8、12、16 句會影響畫面字幕切句嗎？

不會。

這些數字只影響翻譯 Batch 大小；字幕分句與時間軸由 Caption / Sentence 層獨立處理。

---

## 已知限制

- YouTube、Twitch 都可能隨時調整內部 DOM 或字幕服務。
- YouTube Native Auto-Translate 不是公開穩定 API，可能出現限流或暫時不可用。
- 免費翻譯端點可能調整速率限制或回傳格式。
- Gemini / Google Cloud 等服務的配額、價格與模型清單由服務供應商決定。
- Twitch 第一階段僅支援 Live 原生 CC，不支援以語音辨識產生字幕。
- Firefox Add-ons 商店版本可能比 GitHub 最新開發版本晚。

---

## 開發原則

這個專案在修改功能時優先遵守：

- Firefox-first
- 穩定性優先
- YouTube / Twitch 平台模組隔離
- 不使用遠端 JavaScript
- 不硬編碼 API Key
- 不要求不必要的網站權限
- 不讓首頁 hover preview 誤啟動字幕 Overlay
- 翻譯失敗不應破壞原文字幕
- 優先利用字幕時間軸，而不是以畫面 DOM 文字猜測句子
- 優先做可回歸驗證的小範圍修改

---

## 版本紀錄

完整版本變更請閱讀：

**[CHANGELOG.md](./CHANGELOG.md)**

目前原始碼的主要近期功能包含：

- Gemini API Provider
- Gemini 主要／備援模型
- 8／12／16 句 Provider-aware Batch
- 90～150 秒播放速度自適應預取
- YouTube Timed Sentence Sync
- YouTube 原生自動翻譯 Provider
- YouTube Native 429 Single-flight / Cooldown
- Twitch Live Native CC 雙語字幕

---

## 問題回報

如果遇到字幕不同步、翻譯來源錯誤、YouTube／Twitch 改版等問題，建議在 GitHub Issue 中附上：

```text
Firefox 版本：
擴充功能版本：
作業系統：
影片網址：
影片類型：一般 YouTube / Shorts / Twitch Live
字幕來源：人工 CC / 自動產生 CC
翻譯 Provider：
目標語言：
播放速度：
問題發生步驟：
Console 中 [YT Bilingual Translator] 的錯誤訊息：
```

請先移除：

- API Key
- 個人帳號資訊
- Cookie
- Authorization Token
- 不必要的私人資料

再公開貼出 Log。

---

## License

本專案使用 **MIT License**。

詳見：

**[LICENSE](./LICENSE)**

---

## 免責聲明

本專案為獨立開源專案，並非 YouTube、Google、Gemini、Twitch、Microsoft、Mozilla、Wikipedia、Wikimedia、LibreTranslate 或其他第三方服務的官方產品。

YouTube、Twitch 與各翻譯服務的名稱、商標、API 與服務內容均屬各自權利人所有。

---

<div align="center">

### 喜歡這個專案？

可以從 Firefox Add-ons 安裝並持續關注 GitHub 更新。

**[Firefox Add-ons｜YouTube雙語字幕翻譯](https://addons.mozilla.org/zh-TW/firefox/addon/youtube%E9%9B%99%E8%AA%9E%E5%AD%97%E5%B9%95%E7%BF%BB%E8%AD%AF/)**

</div>
