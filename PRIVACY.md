# 隱私政策

YT 雙語字幕翻譯器是一個在瀏覽器本機執行的擴充功能，支援 YouTube 與 Twitch Live 原生字幕。它不需要建立帳號，不主動追蹤使用者，也不販售資料。

## 本機儲存的資料

擴充功能可能會在瀏覽器 extension storage 中保存：

- 擴充功能設定
- 每支影片的字幕位置
- 你加入的單字本資料
- 翻譯快取：已翻譯的字幕句子與譯文（最多約 2,500 句），只存在本機 extension storage，用來避免重複翻譯；可在 Popup「清除翻譯快取」一鍵刪除

## 可能送出的外部請求

依照你啟用的功能，擴充功能可能會把字幕文字或單字送到外部服務，用於翻譯、字典查詢或圖片查詢。

可能使用的服務包含：

- Google Translate free endpoints
- DeepL API，如果你自行設定 DeepL API Key
- Microsoft Translator（Azure），如果你自行設定金鑰
- Google Cloud Translation，如果你自行設定
- Google Gemini API，如果你自行設定 Gemini API Key 與模型
- LibreTranslate，如果你自行設定
- Lingva
- MyMemory
- Free Dictionary API
- Wikipedia / Wikimedia Commons / Wikimedia image endpoints

## 本機翻譯（Bergamot）

選擇「本機翻譯 Bergamot」時，字幕文字只在你的瀏覽器內翻譯，不會送到任何伺服器。

擴充功能會向 Mozilla 下載翻譯模型（`firefox.settings.services.mozilla.com` 與 `firefox-settings-attachments.cdn.mozilla.net`）。下載請求不包含字幕內容，只有模型檔案名稱。模型存在擴充功能的 IndexedDB，可在設定頁刪除。

只有在你勾選「本機翻譯失敗時改用免費雲端翻譯」時，失敗的字幕才會改送到免費翻譯服務。

## 選用權限

DeepL、Microsoft Translator（Azure）與本機模型下載所需的網站權限是選用權限，只有在你選擇該翻譯來源時才會詢問，可隨時在 Firefox 附加元件管理頁撤銷。

## API Key

如果你在設定中輸入 Google Cloud、Gemini 或 LibreTranslate API Key，資料會儲存在你自己的瀏覽器 extension storage 中。Gemini API Key 只會在呼叫 `generativelanguage.googleapis.com` 時用於驗證，並不會寫入擴充功能原始碼或傳送到本專案自建伺服器。請不要把 API Key 放在 GitHub issue、截圖或公開影片中。

Gemini 翻譯啟用時，字幕文字會依使用者選擇的主要／備援 Gemini 模型送至 Google Gemini API。若主要模型因限流、過載、暫時服務錯誤或模型不可用而失敗，且使用者啟用了模型備援，外掛可能把同一段字幕送到使用者指定的備援 Gemini 模型。

## 第三方服務


### Twitch Live Closed Captions

在 Twitch Live 頁面中，擴充功能只處理 Twitch 本身已提供的 Closed Captions，不擷取直播音訊，也不自行進行語音辨識。為產生雙語字幕，原生 CC 文字會依使用者選擇的翻譯來源送至相同的外部翻譯服務。Twitch 的字幕位置與暫存狀態保存在瀏覽器本機，不會上傳到本專案自建伺服器。
v0.48 新增的 Twitch 播放器開關與字幕來源穩定化只在瀏覽器本機運作，不新增資料種類、外部服務或資料收集。

本專案不是 YouTube、Twitch、Google、Microsoft、Wikipedia、Wikimedia 或 LibreTranslate 的官方產品。外部服務的可用性、限流與隱私政策由各服務自行決定。


## v0.19 補充：可自訂翻譯目標語言

使用者可以在第一次使用導引或 popup「一般」分頁中選擇字幕翻譯目標語言。擴充功能仍只會在需要翻譯時，把目前字幕文字與目標語言設定送到使用者選擇或自動備援的翻譯服務。介面語言、字幕目標語言、單字本與字幕位置設定會儲存在瀏覽器本機 extension storage。
