# YT 이중 자막 번역기

YouTube 자막을 원문 자막, 선택한 대상 언어 번역, 단어 학습 레이어로 보여주는 Firefox-first 오픈소스 확장 기능입니다.

[繁體中文](../../README.md) · [English](./README.en.md) · [日本語](./README.ja.md) · [Español](./README.es.md) · [简体中文](./README.zh-CN.md)

![인터페이스 미리보기](../assets/hero-zh.png)

## 주요 기능

- YouTube 원문 자막과 선택한 대상 언어 번역 동시 표시
- timedtext / json3 기반 transcript-first 자막 엔진
- 자동 생성 자막 조각을 읽기 쉬운 문장 단위로 병합
- 다음 자막을 미리 배치 번역
- 무료 번역 제공자가 실패하면 자동으로 다른 제공자로 전환
- 영어 단어 카드: 영영 / 영중 설명, 예문, 발음
- 로컬 단어장 및 JSON 내보내기
- 영상별 자막 위치 드래그 저장

## Firefox 테스트 설치

1. 저장소를 다운로드하거나 clone 합니다.
2. Firefox에서 `about:debugging#/runtime/this-firefox` 를 엽니다.
3. **Load Temporary Add-on** 을 클릭합니다.
4. 프로젝트 루트의 `manifest.json` 을 선택합니다.
5. YouTube에서 자막을 켭니다.

## 동작 흐름

```text
YouTube 페이지
→ content script가 자막 UI 생성
→ page bridge가 player response와 captionTracks 읽기
→ timedtext json3 가져오기 및 파싱
→ 자동 자막 조각 병합
→ 다음 자막을 배치로 미리 번역
→ background script가 캐시와 failover로 번역
→ 이중 자막과 단어 카드를 페이지에 표시
```


## v0.18 업데이트

popup 설정이 탭으로 정리되었고, 첫 실행 시 인터페이스 언어와 자막 번역 대상 언어를 따로 선택할 수 있습니다. 원본 자막 언어는 자동 감지됩니다.
