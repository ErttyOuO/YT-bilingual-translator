# Translation Providers

## Recommended default

Use `免費 Google 翻譯` for personal testing. It does not require API Key or Google Cloud Project.

## Provider comparison

| Provider | API Key | Cloud Project | Notes |
|---|---:|---:|---|
| Free Google | No | No | Best MVP quality, unofficial endpoint |
| Google Cloud v2 | Yes | Yes | Official API, better for production |
| Google Cloud v3 Proxy | Proxy auth | Yes | Best production design, requires backend |
| LibreTranslate | Optional | No | Open source, quality varies |
| Lingva | No | No | Public instance stability varies |

## Important

Free providers may fail because of rate limits, CORS, endpoint changes, or public instance outages. For a public release, keep Google Cloud / backend proxy as an optional production path.
