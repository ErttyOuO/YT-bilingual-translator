# 貢獻指南

感謝你想協助改善 YT 雙語字幕翻譯器。

## 專案方向

這個專案目前的優先目標是：

1. 讓 YouTube 雙語字幕顯示穩定。
2. 優先使用 transcript / timedtext，避免只依賴畫面字幕 DOM。
3. 透過快取、批次、排隊、retry、cooldown 降低翻譯請求量。
4. 保持 Firefox-first、輕量、無打包依賴。
5. 保持語言學習用途：原文、翻譯、單字卡、單字本。

## 開發原則

- 不要讓新功能破壞字幕穩定性。
- 不要在每次字幕 DOM 變動時直接發翻譯請求。
- 所有外部請求都應考慮 timeout、cache、fallback。
- 不要將私人 API key、測試帳號、token 上傳到 repo。
- 不要直接複製 GPL 授權專案的實作程式碼到本 MIT 專案。

## 建議開發流程

1. Fork 或 clone repo。
2. 在 Firefox 使用 `about:debugging` 載入 `manifest.json`。
3. 修改功能。
4. 至少測試：
   - 英文手動字幕影片
   - 英文自動字幕影片
   - 日文字幕影片
   - 單字卡
   - 字幕拖曳
   - popup 設定頁
5. 更新 README 或 docs。
6. 提交 PR。

## 發 Issue 時建議提供

- Firefox 版本
- 作業系統
- YouTube 影片網址
- 使用的字幕語言
- 是否為自動產生字幕
- 問題截圖或錄影
- Console debug log，如果方便提供
