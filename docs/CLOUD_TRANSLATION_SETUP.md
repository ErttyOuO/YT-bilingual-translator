# Google Cloud Translation 設定說明

## 為什麼改用 Cloud Translation API？

上一版使用非正式的 `translate.googleapis.com/translate_a/single`。這種方式適合 MVP，但不適合正式上架或長期使用。

v0.2.0 改成以下兩種正式路線：

1. **Cloud Translation Basic v2 + API Key**：外掛可以直接呼叫，最容易測試。
2. **Cloud Translation Advanced v3 translateText + Proxy**：較適合正式產品，避免把 service account 或 OAuth token 放到瀏覽器端。

## Basic v2 API Key 模式

外掛會呼叫：

```txt
POST https://translation.googleapis.com/language/translate/v2?key=YOUR_API_KEY
```

Body 使用 `application/x-www-form-urlencoded`：

```txt
q=Hello&source=en&target=zh-TW&format=text
```

回傳中會讀取：

```json
{
  "data": {
    "translations": [
      {
        "translatedText": "你好"
      }
    ]
  }
}
```

## Advanced v3 translateText Proxy 模式

外掛會呼叫你填入的 proxy URL，送出：

```json
{
  "contents": ["Hello"],
  "sourceLanguageCode": "en",
  "targetLanguageCode": "zh-TW",
  "mimeType": "text/plain"
}
```

你的 proxy 可以再呼叫 Google 官方 v3 endpoint：

```txt
POST https://translation.googleapis.com/v3/projects/PROJECT_ID/locations/global:translateText
```

proxy 回傳格式可用 Google 原始格式：

```json
{
  "translations": [
    {
      "translatedText": "你好"
    }
  ]
}
```

也可以簡化為：

```json
{
  "translatedText": "你好"
}
```

## Cloud Run / Node.js Proxy 範例

這是一個最小範例，實際部署前請加上 CORS 白名單、速率限制與身份驗證。

```js
import express from 'express';
import { TranslationServiceClient } from '@google-cloud/translate';

const app = express();
const client = new TranslationServiceClient();
const projectId = process.env.GOOGLE_CLOUD_PROJECT;
const location = process.env.TRANSLATION_LOCATION || 'global';

app.use(express.json());

app.post('/translate', async (req, res) => {
  try {
    const { contents, sourceLanguageCode, targetLanguageCode, mimeType } = req.body;
    if (!Array.isArray(contents) || !targetLanguageCode) {
      res.status(400).json({ error: 'contents and targetLanguageCode are required' });
      return;
    }

    const [response] = await client.translateText({
      parent: `projects/${projectId}/locations/${location}`,
      contents,
      sourceLanguageCode,
      targetLanguageCode,
      mimeType: mimeType || 'text/plain'
    });

    res.json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(process.env.PORT || 8080);
```

## API Key 安全建議

若使用 Basic v2 API Key：

- 請在 Google Cloud Console 限制 API Key 只能使用 Cloud Translation API。
- 若有固定網站來源，也請加上 application restrictions。
- 不要把自己的 API Key 寫死在公開 repo。
- 不要把帶 key 的 XPI / ZIP 公開上架。

## 常見錯誤

### 尚未填入 Google Cloud API Key

請打開外掛 popup，填入 API Key。

### API key not valid

通常是 key 打錯，或 key 被限制到不允許 Cloud Translation API。

### Cloud Translation API has not been used or is disabled

請到 Google Cloud Console 啟用 Cloud Translation API。

### Billing 相關錯誤

Cloud Translation 需要 Google Cloud 專案啟用 Billing。
