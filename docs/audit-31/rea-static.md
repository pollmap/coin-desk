# REA 공개 정적 산출물 조사

공개 HTML 13개와 HTML에 명시된 JS URL 최대 3개씩을 조사했습니다. 10개 서비스에서 30개 URL의 바이트를 확보했고, 로그인·보안 우회·비공개 API 추측·대상 앱 실행은 하지 않았습니다. 서버 DB·데이터 구매 계약·전처리 구현·유료 기능은 확인하지 못했습니다.

| 서비스 | 범위 및 결과 | REA Evidence ID |
|---|---|---|
| coingecko | JS 최대 3개 정적 분석; 그래프와 한계 보존 | ev_98dbe0430796949920feffa2e5173a6e04afd56df32d8435675dedc8551782df |
| coinmarketcap | JS 최대 3개 정적 분석; 그래프와 한계 보존 | ev_1effe52f2d3336f962309103fc48fc0b15b4ead94e98202a19adf25eb983f1c9 |
| coinglass | JS 최대 3개 정적 분석; 그래프와 한계 보존 | ev_47403aec7feb67e1578ea52fba833854db1d718f5db61ffbc6f55be5882b17bc |
| cryptoquant | 익명 GET 403 | — |
| glassnode | 익명 GET 403 | — |
| tradingview | 전체 출력 시간제한 후 Evidence·그래프 식별자 투영; 노드 전체는 미보존 | ev_a2f08ad26801ab7e00d0c1af593932f2779310703ba30f6c7f0391e5a9168d74 |
| santiment | HTML에 외부 JS 입력 없음 | — |
| defillama | JS 최대 3개 정적 분석; 그래프와 한계 보존 | ev_1f97882f50e1a8cdf5c69dbd6715702257648a444fd49a69da3cc6c19a2910ce |
| tokenterminal | JS 최대 3개 정적 분석; 그래프와 한계 보존 | ev_3cbecc059a8aca07a5b5e18716131242a30e00ff87effec7a8543e5460f358c6 |
| tokenomist | JS 최대 3개 정적 분석; 그래프와 한계 보존 | ev_4ddda71683f55921bf3046610da410d9474dd3fa4ec6a5919d565c524a6e3f15 |
| cryptorank | JS 최대 3개 정적 분석; 그래프와 한계 보존 | ev_6e58053ce5fa803663cfb428be7b54ed1eca8f1438733ec1e97cab12d1bf673a |
| upbit-datalab | JS 최대 3개 정적 분석; 그래프와 한계 보존 | ev_b00eee35caa9fd179b26a9c8cde5d8a7c6209f160f7900375fa5ecae7fc69860 |
| tossinvest | gzip 원본 때문에 JS 해석 불가; 압축해제 뷰는 보존했지만 추가 REA 분석하지 않음 | ev_30af97b16db0f97996bb373623de3dae913fd596e85c53d0056bf688c9188204 |

## 포크와 실행

사용한 포크: https://github.com/pollmap/rea · HEAD `6020a0b3683ce16e1441963473605f870c247e29` · REA `6.1.0` · MIT. Node 24.18.0·npm 11.16.0에서 포크를 직접 빌드했습니다. 앱 저장소의 의존성이나 글로벌 MCP 설정은 변경하지 않았습니다.

`npm ci --ignore-scripts --no-audit --no-fund` → `npm run build:cached` → `node scripts/rea.mjs analyze-javascript-application <site-directory> --json`. 순차 실행에는 1.5GiB 프로세스 힙과 210초 상한을 적용했습니다. 초기에 두 개로 실행하던 조사를 중단하고 한 개로 제한했습니다. 먼저 완성된 결과는 재분석하지 않았습니다.

TradingView 첫 전체 출력은 210초 제한에 걸렸습니다. 누락된 Evidence ID를 확인하는 한 번의 좁은 후속 출력에서 `--filter-output`으로 ID·다이제스트·요약·통계·한계만 회수했습니다. 첫 실패와 최종 투영을 함께 기록했습니다.

## 해석 경계

- Next 배포 URL·Webpack 문자열·React·차트 라이브러리·요청·저장 관련 문자열은 전송 바이트의 후보입니다. 실제 호출이나 서버 구조를 확정하지 않습니다.
- CoinGecko의 Turnstile·광고 파일 두 개는 제품 엔지니어링 근거에서 제외했습니다.
- Toss의 압축 전후 SHA와 크기, UTF8 검증을 기록했습니다. 서버가 전송한 gzip을 처음에는 텍스트로 취급한 수집 표현 문제이며, 이를 사이트의 동작 오류나 REA의 분석 능력 부족으로 단정하지 않습니다.
- 선택한 홈페이지·마켓 스크립트 몇 개는 전체 기능·가격 상세·유료 로그인 내부의 조사 범위를 대표하지 않습니다.
- REA 자체 한계: 그래프 범위 불완전, 동적·난독화 참조 미해결, 정적 경로·요청·스토리지는 실행 증거가 아님. 대상 코드는 실행하지 않았습니다.
- 원본 HTML·JS·전체 그래프는 Git에서 제외된 work에만 보존했습니다. 공개 문서에는 코드 바이트를 넣지 않습니다.

## 보리차트에 적용할 판단

가격과 지표를 한 상세 화면에서 선택하고 같은 기간·날짜·비교·저장 조작을 유지하는 방향을 권합니다. 실제 OHLC는 캔들, 일별 참조가격은 종가선으로 구분하고 원천·통화를 보존해야 합니다. 이는 사용자 요청·별도 UI 관찰·기존 데이터 정의에 기초한 설계 판단이며, 경쟁 서비스의 비공개 DB·수집 시스템을 알아냈다는 뜻이 아닙니다.
