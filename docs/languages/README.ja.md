# YT バイリンガル字幕翻訳ツール

YouTube の字幕を「原文字幕 + 選択した目標言語への翻訳 + 単語学習」に変える、Firefox 向けのオープンソース拡張機能です。

[繁體中文](../../README.md) · [English](./README.en.md) · [한국어](./README.ko.md) · [Español](./README.es.md) · [简体中文](./README.zh-CN.md)

![インターフェースプレビュー](../assets/hero-zh.png)

## 主な機能

- YouTube の原文字幕と選択した目標言語への翻訳を同時表示
- timedtext / json3 を優先する transcript-first 字幕エンジン
- 自動生成字幕の細かい断片を読みやすい字幕に統合
- 次の字幕を事前にまとめて翻訳
- 無料翻訳プロバイダーの自動フォールバック
- 英英・英中のインタラクティブ単語カード
- ローカル単語帳と JSON エクスポート
- 動画ごとに字幕位置をドラッグ保存

## Firefox でのテスト方法

1. このリポジトリをダウンロードまたは clone します。
2. Firefox で `about:debugging#/runtime/this-firefox` を開きます。
3. **Load Temporary Add-on** をクリックします。
4. ルートフォルダの `manifest.json` を選択します。
5. YouTube を開き、字幕を有効にします。

## 処理の流れ

```text
YouTube ページ
→ content script が字幕 UI を作成
→ page bridge が player response と captionTracks を取得
→ timedtext json3 を取得・解析
→ 自動字幕の断片を統合
→ 次の字幕をバッチで事前翻訳
→ background script がキャッシュとフォールバック付きで翻訳
→ ページ上に二言語字幕と単語カードを表示
```


## v0.18 更新

popup はタブで整理され、初回起動時にインターフェース言語と字幕の翻訳先言語を別々に選べるようになりました。字幕の元言語は自動検出されます。
