# Coin Desk 브랜드 자산

서비스 이름은 **Coin Desk**, 문구는 **시장의 전체 흐름을 읽다**입니다. 대시보드의 전체 역사·원천 구분·날짜 확인이라는 제품 방향을 표현합니다.

## 심볼과 색

열린 C 프레임 안에 서로 다른 길이의 선 세 개를 배치했습니다. 작은 파비콘에서도 인식할 수 있게 선·배경·색 수를 제한했습니다.

| 역할 | 색 |
|---|---|
| 브랜드 강조 | Amber `#F2BA72` |
| 데이터 탐색 | Teal `#70D4C4` |
| 기본 화면 | Midnight `#0D1118` |
| 글자 | `#E9EEF5` |

심볼 주변에 최소 심볼 폭의 1/8 여백을 둡니다. 심볼 비율·선 길이를 개별적으로 변형하지 않습니다. 차트의 상승·하락 색과 브랜드 색의 의미는 별개입니다.

## 파일

- [심볼 SVG](../public/brand/coin-desk-mark.svg), [워드마크 SVG](../public/brand/coin-desk-wordmark.svg)
- [32px 파비콘 PNG](../public/brand/favicon-32.png), [ICO](../public/favicon.ico)
- [Apple 180px](../public/brand/apple-touch-icon.png), [192px](../public/brand/icon-192.png), [512px](../public/brand/icon-512.png)
- [공유 썸네일 PNG](../public/brand/og-card-v1.png) — 1733×907
- [브라우저 설치 메타데이터](../public/site.webmanifest)

SVG 심볼은 코드로 작성했고 PNG·ICO는 `scripts/render_brand.py`로 같은 형태를 그립니다. 해당 선택 작업에는 Pillow가 필요하며, 이미 생성한 아이콘은 소스에 포함되므로 서비스 빌드에 Pillow가 필요하지 않습니다. 워드마크 SVG는 Segoe UI/Arial 계열의 글꼴을 사용합니다.

공유 썸네일은 기본 제공 image_gen 도구로 제작했습니다. 참조 이미지로 프로젝트의 512px 심볼을 사용했고, 결과를 프로젝트의 `public/brand/`로 복사했습니다. 썸네일의 곡선은 실제 가격 데이터가 아닌 일러스트입니다.

## 이미지 제작 프롬프트

> Use case: logo-brand. Create the final wide landscape social sharing thumbnail for the actual crypto analytics web application named "Coin Desk". Target 1200x630 aspect ratio, or closest wide landscape resolution; content safely within central 85%. Reference image is our finished canonical app icon: retain its exact C-frame shape, three teal round-ended vertical bars, dark navy square background, amber #F2BA72 and teal #70D4C4 palette. This is an independent new analytical dashboard, do not borrow any other company's logo. Place the canonical icon prominently next to a large meticulously typeset wordmark with exact text "Coin Desk". One Korean subtitle, exact text "시장의 전체 흐름을 읽다". Small exact supporting text "BTC · DOGE · ETH". Dark midnight background #0D1118, refined flat geometric financial data design, subtle grid and layered thin teal/amber/purple analytical curve illustrations on the right. The curves are abstract illustration only: no actual prices, no fake market data, no buy/sell arrows, no rocket, no coins flying, no photorealism, no shiny 3D, no watermark. High legibility, restrained premium editorial layout suitable for a public link preview, perfectly readable text, lots of breathing room, retain icon design faithfully. Deliver one finished thumbnail, no mockup or device framing.

## 적용

사이드바 심볼, 웹 파비콘, Apple 아이콘, Web App Manifest, Open Graph·Twitter 카드와 `/brand` 다운로드 화면에 적용합니다. 이미지 미리보기가 저장된 메신저에서는 기존 캐시의 갱신 시점에 따라 반영 시간이 달라질 수 있습니다.
