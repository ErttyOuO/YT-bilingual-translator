# YT 双语字幕翻译器

Firefox-first 的开源 YouTube 双语字幕学习扩展。目标是把 YouTube 字幕变成「原文字幕 + 可选目标语言翻译 + 单词学习」的轻量工具。

[繁體中文](../../README.md) · [English](./README.en.md) · [日本語](./README.ja.md) · [한국어](./README.ko.md) · [Español](./README.es.md)

![界面预览](../assets/hero-zh.png)

## 主要功能

- 同时显示 YouTube 原文字幕与所选目标语言翻译。
- 优先使用 timedtext / json3 的 transcript-first 字幕引擎。
- 合并自动生成字幕的零碎片段，让字幕更容易阅读。
- 批量预取后续字幕翻译，减少等待时间。
- 免费翻译来源失败或限流时自动切换备用来源。
- 英文单词卡支持英英、英中、例句和发音。
- 本地单词本与 JSON 导出。
- 每个视频可保存拖拽后的字幕位置。

## Firefox 测试安装

1. 下载或 clone 本仓库。
2. 打开 Firefox，进入 `about:debugging#/runtime/this-firefox`。
3. 点击 **Load Temporary Add-on**。
4. 选择项目根目录中的 `manifest.json`。
5. 打开 YouTube 并开启字幕。

## 运作流程

```text
YouTube 页面
→ content script 建立字幕 UI
→ page bridge 读取 player response 与 captionTracks
→ 取得并解析 timedtext json3
→ 合并自动字幕片段
→ 批量预翻译后续字幕
→ background script 使用缓存与 failover 翻译
→ 页面显示双语字幕与单词卡
```


## v0.18 更新

popup 设置页已改为分页分类。第一次使用时会先选择插件界面语言，再选择字幕翻译目标语言；来源字幕仍会自动检测。
