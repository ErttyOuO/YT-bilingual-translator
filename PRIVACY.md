# 隱私政策

YT 雙語字幕翻譯器是一個在瀏覽器本機執行的擴充功能。它不需要建立帳號，不主動追蹤使用者，也不販售資料。

## 本機儲存的資料

擴充功能可能會在瀏覽器 extension storage 中保存：

- 擴充功能設定
- 每支影片的字幕位置
- 你加入的單字本資料
- 使用期間的翻譯快取或顯示快取

## 可能送出的外部請求

依照你啟用的功能，擴充功能可能會把字幕文字或單字送到外部服務，用於翻譯、字典查詢或圖片查詢。

可能使用的服務包含：

- Google translateHtml / Google Translate free endpoints
- Microsoft Edge Translate endpoints
- Google Cloud Translation，如果你自行設定
- LibreTranslate，如果你自行設定
- Lingva
- MyMemory
- Free Dictionary API
- Wikipedia / Wikimedia Commons / Wikimedia image endpoints

## API Key

如果你在設定中輸入 Google Cloud 或 LibreTranslate API Key，資料會儲存在你自己的瀏覽器 extension storage 中。請不要把 API Key 放在 GitHub issue、截圖或公開影片中。

## 第三方服務

本專案不是 YouTube、Google、Microsoft、Wikipedia、Wikimedia 或 LibreTranslate 的官方產品。外部服務的可用性、限流與隱私政策由各服務自行決定。


## v0.19 補充：可自訂翻譯目標語言

使用者可以在第一次使用導引或 popup「一般」分頁中選擇字幕翻譯目標語言。擴充功能仍只會在需要翻譯時，把目前字幕文字與目標語言設定送到使用者選擇或自動備援的翻譯服務。介面語言、字幕目標語言、單字本與字幕位置設定會儲存在瀏覽器本機 extension storage。
