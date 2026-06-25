# 專案結構與開發參考

本文件提供給未來新增功能、修 Bug、整理 GitHub issue 時使用。

## 根目錄檔案

| 檔案 | 用途 |
|---|---|
| `manifest.json` | Firefox MV2 extension 設定，包含權限、content script、background script、popup |
| `background.js` | 翻譯、字典、圖片、單字本、快取、provider failover |
| `content.js` | YouTube 頁面主要邏輯，字幕 overlay、transcript engine、單字卡與拖曳 |
| `content.css` | YouTube 頁面注入 UI 的樣式 |
| `page-bridge.js` | 注入 YouTube 主世界，取得 player 與 timedtext 資訊 |
| `i18n.js` | UI 多語系字串 |
| `README.md` | GitHub 預設中文介紹文件 |
| `PRIVACY.md` | 隱私政策 |
| `CHANGELOG.md` | 版本紀錄 |
| `CONTRIBUTING.md` | 貢獻指南 |
| `LICENSE` | MIT 授權 |

## `popup/`

| 檔案 | 用途 |
|---|---|
| `popup.html` | 設定頁結構 |
| `popup.css` | 設定頁深色 UI 樣式 |
| `popup.js` | 讀寫設定、測試翻譯來源、匯出單字本、切換 UI 語言 |

## `docs/`

| 檔案 / 資料夾 | 用途 |
|---|---|
| `assets/` | GitHub README 圖片素材 |
| `languages/` | 其他語言 README |
| `ARCHITECTURE.zh-TW.md` | 架構與流程詳細說明 |
| `PROJECT_STRUCTURE.zh-TW.md` | 檔案結構與開發參考 |
| `TRANSLATION_PROVIDERS.md` | 翻譯來源與備援策略 |
| `TEST_CHECKLIST.md` | 手動測試清單 |
| `CLOUD_TRANSLATION_SETUP.md` | Google Cloud Translation 設定參考 |
| `TECH_NOTES.md` | 技術筆記 |

## 常見開發任務

### 新增一個 popup 設定

1. 在 `background.js` 與 `content.js` 的 `DEFAULT_SETTINGS` 補上預設值。
2. 在 `popup/popup.html` 新增控制項。
3. 在 `popup/popup.js` 加入讀取與儲存邏輯。
4. 在 `i18n.js` 補上多語系文字。
5. 如果會影響字幕顯示，確認 `content.js` 有處理設定變化。

### 新增翻譯來源

1. 在 `background.js` 的 `PROVIDERS` 加入 provider 設定。
2. 新增 provider 呼叫函式。
3. 加入 failover 順序。
4. 確認 timeout、delay、cooldown 合理。
5. 測試單句翻譯與批次翻譯。
6. 更新 `docs/TRANSLATION_PROVIDERS.md`。

### 修改字幕分段

1. 優先確認 transcript 是否成功抓到。
2. 修改 `content.js` 中 json3 parser、token timeline 或 merge 邏輯。
3. 用英文自動字幕、日文字幕、手動字幕各測一次。
4. 確認不會造成漏字、跳字、重複翻譯或閃爍。

### 新增單字卡欄位

1. `background.js` 補 lookup 資料來源。
2. `content.js` 補 popover render。
3. `content.css` 補樣式。
4. `i18n.js` 補標籤文字。
5. 確認抽象詞、具體名詞、查不到資料時都有 fallback。

## 發布前檢查

1. Firefox `about:debugging` 載入 `manifest.json`。
2. 開啟英文手動字幕影片。
3. 開啟英文自動字幕影片。
4. 開啟日文字幕影片。
5. 測試字幕拖曳與重設。
6. 測試單字卡、單字圖片、加入單字本。
7. 測試單字本 JSON 匯出。
8. 切換 UI 語言。
9. 打開 debug log 檢查是否有大量重複翻譯。
10. 壓縮 ZIP 前確認沒有私人 API Key 或測試資料。


## v0.19 設定頁分區規則

`popup/` 目前採用分頁式結構：

- `panel-general`：啟用狀態、介面語言、字幕翻譯目標語言、第一次使用導引。
- `panel-translation`：翻譯 provider、failover、批次預取。
- `panel-subtitle`：字幕顯示、transcript-first、字幕外觀。
- `panel-learning`：互動單字卡、單字本、匯出 JSON。
- `panel-advanced`：Cloud / Proxy / LibreTranslate / Lingva / Debug。

新增 popup 功能時，請優先放進對應 panel，不要直接接在頁面底部。若新增的設定會影響字幕翻譯結果，請同時檢查 `DEFAULT_SETTINGS`、`fields`、`readForm()`、`writeForm()`、content script 設定讀取與 background message payload。


## v0.19 Popup 導引相關檔案

- `popup/popup.html`：定義初次使用導引兩步驟、分類後的設定面板，以及字幕目標語言選單。
- `popup/popup.js`：負責 onboarding 狀態、即時切換介面語言、儲存 `uiLanguage` / `targetLang`、通知 YouTube 分頁更新設定。
- `popup/popup.css`：控制 onboarding modal 與 step 顯示狀態。特別注意 `.onboarding-step[hidden]` 需要強制隱藏，避免 CSS grid 覆蓋 HTML `hidden` 屬性。
- `i18n.js`：提供 Popup 與影片內單字卡的多語系文字。


## 參考來源與後續開發說明

本專案在設計字幕資料讀取、批次預取、翻譯備援與互動單字卡時，參考了 Read Frog、yt-dual-sub、BilingualTube、YouTube Subtitle Translator、multi-subs-yt、youtube-live-translate 等開源專案的架構方向。

目前實作以本專案自有程式碼重寫為主，避免直接複製 GPL 專案內容。日後新增功能時，建議優先維持以下原則：

1. 字幕來源優先使用 transcript / timedtext，不直接依賴畫面逐字跳動。
2. 翻譯請求需經過快取、去重、節流與備援。
3. 互動學習功能應維持可關閉，不影響字幕基本顯示。
4. 商店版封包只保留執行必要檔案；完整文件與研究說明放在 GitHub。


## v0.21 Popup 動畫相關檔案

```text
popup/popup.html  # 新增 panelStack 容器，讓 panel 切換可管理進出場
popup/popup.css   # 新增 panel / card / tab 過渡動畫與 reduced-motion 支援
popup/popup.js    # activatePanel() 新增方向判斷、leaving 狀態與動畫清理
```

新增功能時若要加入新的 Popup 分類，請同步更新 `panelOrder`，避免切換方向判斷錯誤。


## 專案連結

- GitHub：<https://github.com/ErttyOuO/YT-bilingual-translator>

## v0.23 相關結構補充

- `content.js`：新增播放器內「雙 / OFF」切換鍵，負責同步本外掛字幕啟用狀態與 YouTube 原生字幕顯示。
- `content.css`：新增播放器內切換鍵樣式，以及更完整的 YouTube 原生字幕隱藏規則。
- `popup/popup.js`：Popup 中的 YouTube 原字幕隱藏行為改為跟隨雙語字幕開關。
- `i18n.js`：新增播放器內切換鍵的提示文字與短標籤。


## v0.24 播放器切換穩定性

播放器內的雙語字幕開關不再於每次 YouTube UI 變動時重新移動位置。現在會透過節流的方式檢查按鈕是否存在，只有在控制列重建或按鈕被移除時才重新插入，避免造成 YouTube 播放器卡頓。
