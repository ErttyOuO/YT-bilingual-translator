# v0.11 技術筆記

## Transcript Engine

v0.11 會先嘗試透過 `page-bridge.js` 從 YouTube 主世界取得 player response 與目前選擇的 caption track。這是因為 WebExtension content script 常常處在 isolated world，直接讀 `ytInitialPlayerResponse` 不一定穩定。

流程：

```txt
page-bridge.js
→ player.getPlayerResponse()
→ captionTracks / selected track
→ content.js fetch timedtext fmt=json3
→ parse json3 events / segs / tOffsetMs
→ stable cue list
→ video.currentTime 找目前 cue
→ 預載後方 30 秒翻譯
```

## timedtext token hints

YouTube 有些 timedtext 請求會帶 `pot`、`cpn` 等參數。v0.11 會在 page bridge 中觀察 YouTube 自己發出的 timedtext URL，content script 再把這些參數補到自己的 timedtext 請求。

## ASR Parser

自動字幕可能是 scrolling ASR 或 karaoke ASR。v0.11 會從 json3 `segs[].tOffsetMs` 建立 token timeline，並用時間差、標點、長度上限重新分段。這比讀畫面上的 `.ytp-caption-segment` 穩定。

## Translation queue

背景腳本做三層控制：

1. translate cache / inflight 去重
2. prefetch request coalescing
3. provider-level queue + retry + cooldown

短時間內多個 prefetch 請求會先合併，避免 playback watcher 每 260ms 觸發時重複打 API。
