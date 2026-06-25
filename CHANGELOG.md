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
