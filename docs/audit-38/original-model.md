# BTC Original: 계산, 날짜 대응, 보존 계약

확인 기준: 2026-10-18. 이 문서는 내부 구현·운영 검증 기록이다. 공개 차트에 수집 과정이나 서버 상태를 추가하지 않는다.

## 어떤 모델인가

대상은 [BlockchainCenter 공개 페이지](https://www.blockchaincenter.net/bitcoin-rainbow-chart/)의 현재 **The Original Chart**다. 같은 페이지의 Dynamic과 구분한다. 본문에 등장하는 역사적 2022 V2와 현재 구현이 같다는 근거는 확보하지 않았으므로 V2로 표시하지 않는다.

공개 페이지가 직접 내려준 [JavaScript 자원](https://www.blockchaincenter.net/_next/static/chunks/f07b06cf8fa13d78.js)의 계산 계약을 확인하고 독립 수학 구현을 작성했다. 페이지 코드·HTML·공식 가격 배열을 제품에 복제하지 않았다. 공개 접근 가능성이 소스·데이터 전체의 자유로운 재배포 허가를 뜻하지는 않는다. 별도 포괄 라이선스나 상표 허가를 확인한 것으로 표현하지 않는다.

기존 `view:btc_rainbow`는 보리차트 자체 확장 회귀 모델로 보존한다. 새 `view:btc_rainbow_original`만 이 문서의 고정식과 공식 날짜 대응을 사용한다.

## 고정식과 실제 행 번호

각 중심선은 다음과 같다. 자연로그와 10의 거듭제곱을 혼동하지 않는다.

```text
L_i(n) = 10 ^ (a_i × ln(n + c_i) − 19.463)
a = [2.9, 2.886, 2.872, 2.859, 2.845, 2.8295, 2.815, 2.801, 2.788, 2.775]
c = [1400, 1375, 1350, 1320, 1293, 1275, 1250, 1225, 1200, 1175]
내부 분류 경계_i = sqrt(L_i × L_(i+1))
```

- 이 모델은 매일 가격으로 다시 맞추는 회귀가 아니다.
- `n`은 공식 날짜 배열에서 2012-01-01 이상인 행만 남긴 뒤의 0부터 시작하는 행 번호다.
- 중심선은 10개, 인접 중심선 사이 분류 경계는 9개다. 기존 자체 회귀의 ‘10개 경계·9개 색 구간’과 서로 다른 계약이다.
- 확인한 공개 렌더링은 `fill:false`, 두꺼운 중심선이다. 보리차트는 독립 선 렌더링을 사용하며 임의 외곽 밴드를 만들지 않는다.
- 기준 스냅샷은 2012-01-01~2026-10-18의 5,400행이다. 마지막 행 번호는 5,399다.
- 공식 배열에 없는 날짜는 2024-05-24, 2024-05-26, 2024-05-27, 2024-10-30, 2024-10-31이다. 달력 경과일로 근사하거나 자체 가격 배열의 순번으로 대체하지 않는다.
- 공식 페이지의 미래 연장은 재현하지 않는다. 기존 BTC USD 가격의 확정 일별 관측과 공식 날짜가 일치하는 과거 날짜에만 모델을 표시한다. 오늘 미완료 일봉과 미래 곡선은 제외한다.

독립 계산 표본은 다음과 같다. 가격 관측값이 아니라 고정식 출력이다.

| 공식 행 번호 | 날짜 | 최상단 중심선 USD | 최하단 중심선 USD |
|---|---|---:|---:|
| 0 | 2012-01-01 | 35.096175672804605 | 1.4240984336239124 |
| 3,977 | 2022-11-21 | 280,329.65513459465 | 18,001.729978377323 |
| 5,399 | 2026-10-18 | 1,343,195.9771489804 | 85,444.82565669004 |

## 기준 식별자

| 항목 | 고정값 |
|---|---|
| 초기 modelVersion | `bc-original-ceeeec89e244-fba19583282a` |
| 날짜 snapshotId | `fba19583282af6c97334f75250763355b4f0f7a0dc3c69ef83b7795790988414` |
| 공식 수학 계약 SHA-256 | `ceeeec89e244ac085be1e95e967a8674f2186d300655125668db862a46d1783a` |
| 확인한 공개 JS 전체 SHA-256 | `1d734930a9b59ff0471179f10df1ae4f3569e759a39c8abd2369fa953c8b3cb9` |

날짜 해시는 ISO 날짜를 줄바꿈 하나로 연결한 UTF-8 내용으로 계산한다. 끝에 줄바꿈을 붙이지 않는다. 수학 계약 해시는 공유 모듈에 명시한 상수·로그·행 번호·분류 방식의 정규 JSON에서 계산한다.

## 갱신과 조회

`server/rainbow-original.mjs`는 기존 단일 Node API 프로세스에서 작은 metadata 작업을 실행한다. 가격 수집기와 연구 워커는 수정하지 않는다. HTTP 요청 처리와 분리하고 UTC 하루 최대 한 번 확인한다.

- 허용된 공식 HTTPS 페이지·JS 두 요청만 사용한다. 리디렉션은 허용하지 않는다.
- 요청당 15초, HTML 1MiB, JS 256KiB, 날짜 최대 12,000개로 제한한다. JavaScript를 실행하지 않고 JSON/RSC 계약만 해석한다.
- JS 전체 해시·수학 해시·날짜 순서·날짜 해시·확인 시각을 검사한다.
- 원천 실패, 스크립트 변경, 공간 부족에서는 직전 검증본을 유지한다. 날짜를 만들어 보충하지 않는다.
- 같은 날짜 배열 뒤에만 추가되면 modelVersion을 유지하고 snapshotId를 새로 만든다. 기존 과거 날짜의 계산값은 그대로다.
- 과거 날짜가 추가·삭제·수정되면 새 modelVersion을 만든다. 이전 모델과 스냅샷 파일을 삭제하지 않는다.
- 120초 실행 잠금, 임시 파일→fsync→원자적 rename을 사용한다. 디스크 여유 8GiB, metadata 총 64MiB, snapshot 1,024개, 모델 64개 한도를 유지한다. 한도에 닿으면 갱신을 보류하며 기존 파일을 정리하지 않는다.

`GET /api/v1/rainbow/original-reference?model_version=…`는 읽기 전용이다. 요청 때문에 원천 수집을 시작하지 않는다. 기본 요청은 최신 검증본을 반환한다. 명시한 버전을 찾거나 검증할 수 없으면 404이며 다른 버전으로 대체하지 않는다.

최초 실행·파일 접근 실패·현재 실행부가 해석하지 못하는 저장본에는 배포물의 검증된 기본 스냅샷을 사용한다. 손상되거나 지원하지 않는 이전 파일·버전 연결은 보존한다. 명시적으로 그 이전 버전을 요청한 저장 분석에는 기본값을 대신 주지 않는다. 날짜 스냅샷을 보관해도 외부 가격 원천의 모든 과거 수정본을 보관하는 것은 아니므로 당시 전체 차트의 완전한 재현이라고 표현하지 않는다.

## 백업과 복원

운영 metadata 경로는 DB 옆의 `/app/data/rainbow-original`, VPS 호스트에서는 `/srv/services/coin-desk/shared/data/rainbow-original`이다. SQLite DB 안이나 연구 테이블에 넣지 않는다.

기존 `scripts/vps_backup.py`가 DB의 온라인 스냅샷과 함께 다음 파일을 보존한다.

- 원자적 `index.json`: 최신 모델과 모든 모델→스냅샷 연결.
- `snapshot-<sha256>.json`: 이전 모델·이전 append 스냅샷을 포함한 모든 불변 날짜 대응 파일.
- 제한된 상태 필드만 가진 `status.json`.

실행 잠금과 미완료 임시 파일은 복원하지 않는다. manifest의 `referenceMetadata`에 파일별 바이트 수·SHA-256·전체 크기·모델 연결을 기록한다. 백업 파일을 독립 폴더로 복원해 DB 내용 해시와 metadata 전체를 각각 대조해야 성공이다. 새 backup 상태에는 `backupContract: sqlite-original-v1`을 기록한다.

복원 예시는 기존 경로를 덮어쓰지 않는 새 디렉터리를 전제로 한다.

```sh
python3 scripts/vps_backup.py restore \
  --snapshot /srv/services/coin-desk/backups/<verified-backup>/snapshot.sqlite \
  --manifest /srv/services/coin-desk/backups/<verified-backup>/manifest.json \
  --destination /srv/services/coin-desk/recovery/<new-name>/coin-desk.sqlite
```

기본 metadata 목적지는 새 DB 옆의 `rainbow-original`이다. 분리 경로가 필요하면 `--metadata-destination`을 명시한다. 기존 목적지가 다르면 복원을 거부하고 내용을 덮어쓰지 않는다. 같은 파일 해시의 목적지는 재사용한다. 실제 운영 전환은 별도 중지·검증·소유권 설정 단계이며 위 명령이 운영 DB 경로를 전환하지 않는다. root로 복원했다면 운영 프로세스 UID 10001의 읽기·쓰기 권한을 새 복원 폴더에만 맞춰야 한다.

예전 DB 전용 백업도 복원할 수 있지만 결과는 `not_in_legacy_backup`이며 이전 metadata까지 복구했다는 의미가 아니다. 이전 metadata가 현재 릴리스와 호환되지 않아도 원본 파일·해시는 복원한다. 호환성 판정만 현재 실행부 기준으로 다시 산출하고 `stored_model_not_supported_by_current_release`로 기록한다. 앱은 검증된 내장 기본값을 사용하며 명시한 미지원 모델을 다른 모델로 바꾸지 않는다.

## 선택 배포와 롤백

`research-additive-v1`의 명시적 교체 목록에 `api`, `research-worker`, `backup`을 사용한다. API와 disabled 연구 워커의 기존 계약에 metadata-aware backup image 교체만 추가한다. quotes·background·recent·analysis·quote-hub·migrate와 다른 프로젝트는 기존 container identity·설정을 유지한다.

backup service는 기존 volume·메모리·retention·budget을 그대로 두고 image와 release만 바꾼다. 최초 실행 후 새 `sqlite-original-v1` 백업의 성공을 확인한 뒤 릴리스를 승격한다. 실패하면 backup→새 연구 워커→API 순으로 코드를 복구하고, live DB·추가형 연구 테이블·metadata를 되돌려 쓰지 않는다. 연구 기능 활성화는 여전히 별도 명시적 단계다.

선택 배포는 source manifest로 고정한 metadata 검증 도구를 사용한다. 준비 단계의 독립 복원뿐 아니라 활성화 직전과 후속 연구 활성화 전에도 백업 metadata 해시를 다시 검사한다. 이전 백업 프로세스로 코드 롤백하면 그 프로세스는 metadata 백업을 만들지 못할 수 있다. 이전의 metadata-aware 백업과 보존된 파일을 유지하고, 이를 전면 복구 완료라고 부르지 않는다.

## 검증과 잔여 조건

계산 검사는 날짜 공백, 독립 고정식, 경계, 확정 일봉, 미래 관측 추가, 잘못된 참조를 다룬다. Node 검사는 요청에 의한 수집 금지, 하루 한 번 갱신, append·과거 수정·재시작, 원천 실패·공간·예산·동시 실행, 미지원 저장 버전 보존을 다룬다. 복원 검사는 실제 임시 SQLite와 metadata 파일로 전체 해시 일치, 손상·index 불일치 차단, 기존 목적지 보존, 구형 백업과 다른 실행부 호환성을 검사한다. 배포 검사는 교체 범위·retention 보존·backup 실패 시 코드 복구를 mock으로 검사한다.

2026-10-18 로컬 실행 결과는 다음과 같다.

| 검사 | 결과 |
|---|---|
| TypeScript 타입 검사, Original·기존 레인보우 관련 Vitest | 앞선 구현 검사 통과, 관련 단위 32개 통과 |
| Node 서버 빌드 및 metadata 저장소 검사 | 빌드 통과, metadata 4개 통과 |
| `python -m unittest discover -s tests -p "test_vps*.py"` | 133개 통과. 신규 metadata 실제 복원 10개와 배포·롤백 회귀 포함 |
| 변경 Python 모듈·ignored bundle freezer 문법 검사 | 통과 |
| 변경 파일 diff whitespace 검사 | 오류 없음 |

신규 Python 복원 테스트의 첫 실행은 테스트 코드가 SQLite 연결을 닫지 않아 Windows 임시 파일 정리에 실패했다. 연결을 명시적으로 닫도록 수정한 뒤 같은 검사와 전체 VPS 회귀를 통과했다. 실패 주입 테스트가 출력하는 `backup_failed`는 예상한 손상·공간 부족 fixture 결과이며 운영 장애 관측이 아니다.

공식 사이트의 JS가 재빌드되어 **전체 파일 해시만 바뀌어도 일일 갱신은 중단**된다. 현재 허용된 최신 검증본은 계속 사용하며, 자동으로 새 JS를 신뢰하지 않는다. 새 공개 계약을 다시 검토하고 식별자·검사를 갱신한 릴리스를 배포하기 전에는 이후 날짜의 Original 곡선이 늘어나지 않을 수 있다. 모델명이나 날짜를 근사해 이 상태를 숨기지 않는다.

이 문서는 구현 계약이다. 실제 운영 배포, VPS의 첫 metadata-aware 백업, 배포 후 자연 날짜 갱신, 최신 PR·main CI는 최종 배포 기록에서 따로 확인한다. 코드 검사나 로컬 복원만으로 운영 완료를 주장하지 않는다.
