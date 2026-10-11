## v0.53.0 翻譯回歸

自動檢查：`node tests/translation-regression.cjs`。使用模擬字幕、時鐘與網路，驗證排隊／本文 timeout、預取去重與優先處理、批次逐句回傳、有限次重試、快取語意、跳轉、字幕軌及設定變更。此檢查不呼叫真實 Gemini，也不代表以下人工項目已通過。

- [ ] Firefox 重新載入擴充功能並重新整理影片，版本為 0.53.0。
- [ ] 在相同影片以 1×、1.5×、2× 播放，分別確認人工與自動字幕的譯文出現時機。
- [ ] 模擬一次暫時失敗後恢復：同一句可以補回譯文；持續失敗時不無限重試。
- [ ] 快速跳轉、切換影片、關閉雙語字幕後，舊請求不把先前字幕重新顯示。
- [ ] 英文人工字幕與英文自動字幕切換後，時間軸重新載入。
- [ ] 切換翻譯來源、Gemini 模型或目標語言，同一句重新翻譯；Twitch 改語言也更新譯文。
- [ ] 使用本機已設定的完整 AQ. 金鑰測試 Gemini 模型清單與翻譯；不要記錄完整金鑰。

# v0.9 Quick Test

1. Open a YouTube video with English auto-generated captions.
2. Enable the extension and optionally hide native YouTube captions.
3. Confirm visible captions do not update word-by-word.
4. Confirm segments cut at comma or period, for example: `maybe now and a while,` then the next segment starts after the comma.
5. Confirm batch prefetch and free-provider failover still work.

---

# v0.4 Test Checklist

1. 載入外掛後打開 YouTube 影片。
2. 開啟 YouTube 原字幕。
3. 確認字幕會翻譯成 popup 中選擇的目標語言，預設為繁體中文。
4. 測英文字幕：原文英文 + 中文翻譯。
5. 測日文字幕：原文日文 + 中文翻譯。
6. 看 30 秒以上，確認第二句之後翻譯等待時間應該比 v0.3 短。
7. 打開 Debug log 後可看 `timedtext loaded` 與 `prefetch queued`。
8. 點英文單字，確認英英 / 英中單字卡出現。
9. 加入單字本，確認 popup 內可看到並匯出 JSON。


## v0.7 自動字幕分段測試

- 開啟英文（自動產生）字幕影片。
- 確認外掛不會隨 YouTube 每個字更新而立即翻譯。
- 觀察字幕是否以一小段一小段出現，通常會有約 0.9 秒緩衝。
- 若字幕消失，確認最後一段仍會被送出翻譯，而不是直接遺失。


## v0.19 初次使用導引測試

1. 清除 extension storage 後重新開啟 popup。
2. 確認第一步只顯示「選擇介面語言 / Choose display language」，不會同時顯示第二步。
3. 在第一步切換介面語言，確認背景設定頁與第二步文字會立即切換語言。
4. 點「下一步 / Next」，確認才進入字幕翻譯目標語言選擇。
5. 選擇目標語言後點「開始使用」，確認 `onboardingDone`、`uiLanguage`、`targetLang` 會保存。


## Popup 動畫測試

- [ ] 點擊一般 / 翻譯 / 字幕 / 學習 / 進階時，分類內容有柔和淡入與滑動效果。
- [ ] 往右切換與往左返回時，動畫方向不同。
- [ ] 快速連續切換分類時，不會出現兩個分類內容長時間重疊。
- [ ] Footer 的「套用設定 / 重設」仍固定在底部。
- [ ] 系統啟用 reduced motion 時，Popup 不會播放明顯動畫。
- [ ] 字幕、翻譯、單字卡、單字本、專案連結功能不受影響。


## v0.23 播放器內切換測試

- [ ] YouTube 播放器 CC 字幕按鈕旁會出現「雙 / OFF」切換鍵。
- [ ] 按下「雙」開啟本外掛字幕後，YouTube 原生字幕會被隱藏。
- [ ] 按下「OFF」關閉本外掛字幕後，本外掛字幕會消失，YouTube 原生字幕會恢復。
- [ ] 切換影片或重新整理頁面後，切換鍵仍會重新出現在 CC 字幕按鈕旁。
- [ ] Popup 內的主開關與播放器內切換鍵狀態一致。


## v0.24 播放器切換穩定性

播放器內的雙語字幕開關不再於每次 YouTube UI 變動時重新移動位置。現在會透過節流的方式檢查按鈕是否存在，只有在控制列重建或按鈕被移除時才重新插入，避免造成 YouTube 播放器卡頓。

## v0.60.0 手動驗證

- [ ] 目標語言「繁體中文」：觀看英文影片，譯文全部為繁體（可在 Popup 切換到 Lingva／LibreTranslate 再確認一次）。
- [ ] 目標語言「简体中文」：譯文全部為簡體。
- [ ] 有手動字幕的影片（例如 TED）：一句被拆成兩段的字幕，會合併顯示成一整句並整句翻譯。
- [ ] 長時間配樂或靜音段落：上一句字幕約 1 秒內消失，不會殘留到下一句。
- [ ] 目標語言「English」觀看英文影片：只顯示原文，DevTools Network 沒有翻譯請求。
- [ ] 日文自動字幕影片：原文沒有被插入空格。
- [ ] 點播放器上的雙語按鈕關閉再開啟：字幕立即恢復，不出現「翻譯中…」。
- [ ] 播放 1 分鐘後暫停 2 分鐘再播放：已看過的句子直接顯示譯文（本機快取）。
- [ ] Popup「清除翻譯快取」顯示成功訊息。
- [ ] 點英文單字 die、gift：單字卡顯示英文意思（不是德文）。


## v0.61.0 手動驗證

- [ ] 更新後沒有出現新的權限提示（選用權限）。
- [ ] 原本選 Microsoft Edge 的設定，開啟設定頁後顯示「自動免費模式」。
- [ ] DeepL：填入 `:fx` 金鑰並儲存，允許權限提示；英文影片譯文為繁體。
- [ ] Azure：填入金鑰與區域並儲存，允許權限提示；「測試目前翻譯來源」成功。
- [ ] Bergamot：選擇後按「準備本機模型」，允許權限；狀態顯示下載百分比，最後顯示「已就緒」。
- [ ] Bergamot：播放英文影片，DevTools Network 沒有任何翻譯服務請求，字幕為繁體。
- [ ] Bergamot：目標改為簡體中文，第一次出現「本機翻譯模型下載中…」，完成後字幕為簡體。
- [ ] Bergamot：關閉再開啟 Firefox 後，不需重新下載模型。
- [ ] Bergamot：「刪除已下載的模型」後狀態回到「尚未載入」。
- [ ] Bergamot：Twitch 直播顯示翻譯錯誤（不知道字幕語言），且沒有送出雲端請求。
