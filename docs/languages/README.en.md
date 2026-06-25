# YT Bilingual Subtitle Translator

A Firefox-first open-source browser extension for YouTube bilingual subtitles and language learning.

[繁體中文](../../README.md) · [日本語](./README.ja.md) · [한국어](./README.ko.md) · [Español](./README.es.md) · [简体中文](./README.zh-CN.md)

![Interface preview](../assets/hero-zh.png)

## What it does

- Shows original YouTube captions and a user-selected target-language translation together.
- Uses a transcript-first subtitle engine when timedtext / json3 data is available.
- Merges auto-generated caption fragments into more readable segments.
- Prefetches upcoming subtitles and translates them in batches.
- Automatically falls back across free translation providers when one fails or is rate-limited.
- Provides interactive English word cards with EN-EN and EN-ZH explanations.
- Saves vocabulary locally and exports it as JSON.
- Supports draggable subtitle position per video.

## Firefox installation for testing

1. Clone or download this repository.
2. Open Firefox and visit `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on**.
4. Select `manifest.json` from the project root.
5. Open YouTube and enable captions.

## How it works

```text
YouTube page
→ content script creates subtitle UI
→ page bridge reads player response and caption tracks
→ timedtext json3 is fetched and parsed
→ auto-caption fragments are merged
→ upcoming subtitles are batch-prefetched
→ background script translates with cache and failover
→ dual subtitles and word cards are rendered on the page
```

This repository is not affiliated with YouTube, Google, Microsoft, Wikipedia, Wikimedia, or LibreTranslate.


## v0.18 Update

The popup is now grouped into tabs, and the first-run onboarding asks for interface language and subtitle target language separately. Source subtitles are still auto-detected.
