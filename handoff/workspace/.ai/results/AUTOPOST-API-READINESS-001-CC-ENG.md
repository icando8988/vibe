# AUTOPOST-API-READINESS-001 결과 — 공식 API 출시 준비도 검증

- 작업 ID: AUTOPOST-API-READINESS-001 · 담당: CC-ENG (Claude Code, Orca task_1df353e241e0 / dispatch ctx_f850ff8e76e1)
- Master: CX-MASTER-01 · 기준: `docs/AUTOPOST_INTEGRATION_PLAN.md`, `web/src/lib/distribution/types.ts`
- 확인일: 2026-11-16 (Asia/Seoul) · 상태: ready_review
- 방법: Meta / NAVER / Vercel / Supabase 공식 문서만 웹으로 읽음. Meta·Vercel·Supabase는 웹 페치 도구로, NAVER는 웹 페치 도구가 developers/policy/help.naver.com 접근을 거부하여 공개 페이지를 curl로 받아 텍스트를 확인했다.
- 하지 않은 것: 키트 코드·NOTICE·프롬프트·schema·기존 분석 보고서 열람, 앱 생성, 계정 연결, 토큰/키 조회, API 호출, DB/코드 수정, 설치, 배포, 테스트. 아래 내용은 **문서 기준 확인**이며 실제 계정 동작 검증이 아니다.
- 표기: **확인** = 공식 문서에 명시 / **미확인** = 공식 문서에서 찾지 못함(출시 게이트) / **불일치** = 공식 문서끼리 값이 다름(출시 게이트).

---

## 1. 요약 판단

| 채널 | 판정 | 핵심 근거 |
|---|---|---|
| Threads (텍스트 단일 게시) | **구현 가능 — 단일 운영자 계정이면 앱 검수 없이 MVP 가능** | 앱 역할 "Threads Tester"로 등록된 계정에는 고급 액세스 승인 없이 게시 가능. OAuth `state` 지원, 60일 장기 토큰 + refresh, 컨테이너 상태 조회·자기 게시물 목록 조회로 대사 가능. |
| Instagram (단일 이미지) | **구현 가능 — 본인/관리 프로 계정이면 Standard Access로 검수 불필요** | Instagram Login 경로는 Facebook Page 불필요. 단 JPEG만 허용, 공개 URL 필수, 게시 한도 수치 문서 불일치(50 vs 100). |
| 네이버 블로그 | **API 자동 게시 불가 — 수동 게시만 공식적으로 성립** | 블로그 글쓰기 오픈 API 2020-05-06 종료, 현재 API 목록에 블로그 글쓰기 없음. 네이버 이용약관은 사전 허락 없는 자동화 수단으로 게시물 게재를 금지. |
| 운영(Vercel/Supabase) | **조건부** | Vercel Hobby Cron은 하루 1회·±59분이라 예약 게시 불가. Pro는 분 단위. Cron은 중복 호출·무재시도 → DB 원자적 claim 필수(통합 플랜과 일치). Queue는 MVP 규모에서 필수 아님. |

통합 플랜의 출시 순서(수동 블로그 → Threads 텍스트 → Instagram 단일 이미지)는 **유지 권고**. 변경 제안은 §6.

---

## 2. Threads readiness

### 2.1 표

| 항목 | 공식 문서 내용 | 상태 |
|---|---|---|
| 지원 기능 | 단일 게시 `media_type` TEXT / IMAGE / VIDEO, 부모 컨테이너 CAROUSEL(자식 2~20개, 1게시로 계산). `link_attachment`(텍스트 전용), GIPHY GIF, 토픽 태그 1개(1~50자), `is_made_with_ai=true` AI 라벨(컨테이너 생성 시에만). 답글·삭제·인사이트는 별도 권한. | 확인 |
| 인증 | 인가 `https://threads.com/oauth/authorize` (`client_id`, `redirect_uri`, `scope`, `response_type=code`, 선택 `state` — 문서가 CSRF 방어 용도로 예시). 코드 교환 `POST https://graph.threads.com/oauth/access_token`. 인가 코드는 1시간·1회용. 사용자 취소 시 `error=access_denied`. | 확인 |
| 권한 | `threads_basic`(모든 엔드포인트 필수), `threads_content_publish`(게시). 선택: `threads_manage_replies`, `threads_read_replies`, `threads_manage_insights`, `threads_delete`, `threads_location_tagging`. 자기 게시물 조회는 `threads_basic`만으로 가능. | 확인 |
| 앱 검수/개발 접근 | Threads Tester(App Dashboard > App roles > Roles, 초대 후 상대가 Threads 설정 > 웹사이트 권한에서 수락)는 언제든 권한 부여 가능. 테스터가 아닌 사용자는 권한별 App Review 승인과 **앱 게시(published)** 가 필요. `threads_content_publish` 고급 액세스 미승인 시 **테스터 계정에만 게시 가능**, `threads_basic` 고급 액세스 미승인 시 테스터가 만든 게시물만 조회 가능. | 확인 |
| 토큰 수명 | 단기 1시간 → `GET https://graph.threads.com/access_token?grant_type=th_exchange_token` (앱 시크릿, 서버 전용)으로 장기 60일. 갱신 `GET https://graph.threads.com/refresh_access_token?grant_type=th_refresh_token`: 토큰이 **24시간 이상 경과·미만료**, `threads_basic` 부여 상태여야 함. 갱신 후 60일 재시작, 60일 내 미갱신 시 만료(재인증). | 확인 |
| 권한 부여 유효기간 | 공개 프로필의 권한 부여는 90일, 장기 토큰 refresh 시 90일 연장. **비공개 프로필은 연장 불가**. | 확인 — 운영 영향 큼(§2.3) |
| 게시 단계 | ① `POST /v1.0/{user-id}/threads` → 컨테이너 ID ② 약 30초 대기 권장 ③ `POST /{user-id}/threads_publish` (`creation_id`) → 미디어 ID. 캐러셀은 자식 컨테이너(`is_carousel_item=true`) → 부모(`children`) → 게시. 미디어는 시도 시점에 공개 서버에 있어야 함(Threads가 내려받음). | 확인 |
| 상태 조회 | `GET /{container-id}?fields=status,error_message` → `EXPIRED`(24시간 내 미게시), `ERROR`, `FINISHED`, `IN_PROGRESS`, `PUBLISHED`. 오류 메시지 예: FAILED_DOWNLOADING_VIDEO, INVALID_ASPEC_RATIO 등. 폴링은 1분 1회, 최대 5분 권장. | 확인 |
| 결과 대사 | 게시 응답의 미디어 ID. 목록 `GET /v1.0/{user-id}/threads`(`since`/`until`/`limit`, 커서 페이징), 단건 `GET /{media-id}?fields=id,permalink,timestamp,text,...`. 저작권 플래그 미디어는 `permalink` 생략. | 확인 |
| 멱등성 | idempotency key·중복 게시 탐지 기능은 문서에 없음. | **미확인 → 사이트 측 보장 필요** |
| 컨테이너 상태로 미디어 ID 얻기 | `PUBLISHED` 컨테이너에서 게시된 미디어 ID를 돌려주는지 문서에 없음. 같은 `creation_id`로 재게시 시 동작도 없음. | **미확인** |
| 제한 | 게시 250건/24시간 이동창(게시 시점 적용, 캐러셀 1건), 답글 1,000, 삭제 100, 위치 검색 500. 사용량 `GET /{user-id}/threads_publishing_limit?fields=quota_usage,config`. 앱 전체 호출 수 = 4800 × 노출수(최소 10). 텍스트 500자(이모지는 UTF-8 바이트로 계산된다는 기재), 링크 5개 이하(2025-12-22부터 초과 시 컨테이너 생성에서 `THREADS_API__LINK_LIMIT_EXCEEDED`). | 확인 / 글자 수 계산 규칙 세부는 **미확인** |
| 미디어 규격 | 이미지 JPEG·PNG, 8MB, 비율 최대 10:1, 폭 320~1440px, sRGB. 동영상 MOV/MP4, H264/HEVC, AAC ≤48kHz, 23~60fps, 폭 ≤1920, 5분, 1GB. | 확인(MVP는 텍스트만) |
| 예약 게시 기능 | API 측 예약 파라미터를 문서에서 찾지 못함. | **미확인 → 사이트 스케줄러로 처리** |
| 앱 게시 요건(개인정보처리방침 URL, 데이터 삭제 콜백, 해제 콜백 등) | 이번에 확인하지 않음. | **미확인 → 다계정 확장 게이트** |

### 2.2 독립 구현 요구사항 (Threads)

1. OAuth: 서버에서 일회용 난수 `state`를 만들고 사용자 세션·만료(≤10분 권장, 사이트 정책)·redirect URI에 바인딩. 콜백에서 불일치·재사용·만료를 거부. 코드 교환·장기 토큰 교환은 서버에서만, 응답 전체를 로그에 남기지 않음.
2. 토큰 수명주기: 저장 시 `issued_at`, `expires_at` 기록. 발급 24시간 경과 후~만료 전 구간에서 주기적으로 refresh(예: 만료 7~14일 전, 값은 사이트 결정). refresh 실패·만료 시 연결 상태 `reauth_required`, 예약 작업 보류.
3. 권한 부여 90일: 운영 계정이 **공개 프로필인지** 연결 시 확인하고, 비공개면 90일마다 재인증 알림. 공개라도 refresh가 계속 성공하는지 운영 대시보드에 표시.
4. 게시 상태기계(사이트 측): `scheduled → container_created(컨테이너 ID 저장) → publishing → published | failed | unknown`. 컨테이너 ID를 **게시 호출 전에 DB에 커밋**한다. 이것이 대사의 핵심 근거다.
5. 대사 절차: 게시 호출 응답 유실 시 재호출 금지, `unknown`으로 저장 → 컨테이너 상태 조회. `PUBLISHED`면 게시된 것으로 보고 `GET /{user-id}/threads?since=<dispatch 시각>`에서 시각·본문으로 미디어 ID·permalink를 찾아 `published` 확정. `FINISHED`면 아직 게시 안 됨으로 판단할 수 있으나 같은 컨테이너 재게시 동작이 문서에 없으므로 **자동 재시도는 하지 않고 운영자 승인 후 1회** 진행. `EXPIRED`/`ERROR`는 실패로 분류하고 새 컨테이너 생성은 새 시도로 기록.
6. 사전 검증: 500자, 링크 ≤5, 토픽 태그 규칙, `link_attachment` 텍스트 전용. 글자 수 계산 규칙(이모지 바이트 계산)은 미확인이므로 경계값 근처 문안은 dry-run에서 경고.
7. 한도: 게시 전에 `threads_publishing_limit` 조회 또는 사이트 측 24시간 카운터로 250건 이하 보장(MVP 규모에선 사실상 무관).
8. AI 생성 콘텐츠는 `is_made_with_ai` 사용 여부를 콘텐츠 정책과 연결(통합 플랜 §8-5 결정 대상).

### 2.3 남은 결정 / 출시 게이트 (Threads)

- G-T1: Meta 앱 소유자·관리자와 Threads Tester 등록 대상 운영 계정(1개) 결정. 단일 운영자 범위를 넘으면 App Review + 앱 게시 필요.
- G-T2: 운영 계정 공개/비공개 여부(비공개면 90일 재인증 운영 필요).
- G-T3: 같은 컨테이너 재게시 동작, `PUBLISHED` 컨테이너→미디어 ID 매핑 — 미확인. 테스터 계정으로 승인된 검증 작업에서 확인 전까지 자동 재시도 금지.
- G-T4: 앱 게시용 정책 URL·데이터 삭제 요청 처리 요건 — 미확인(다계정 확장 시).

---

## 3. Instagram readiness

### 3.1 로그인 경로 비교 (공식 Overview / 각 경로 페이지)

| 경로 | 계정 조건 | Facebook Page | 호스트 / 토큰 | 권한 이름 | 비고 |
|---|---|---|---|---|---|
| Instagram API with **Instagram Login** | Instagram 프로페셔널 계정(비즈니스 또는 크리에이터) | 불필요 | `graph.instagram.com` / Instagram User access token | `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_comments`, `instagram_business_manage_messages` | 구 명칭 `business_*`는 2025-01-27 폐기 예정 공지 |
| Instagram API with **Facebook Login** | 프로페셔널 계정 + Facebook Page 연결, Page 관리자 수준 권한 | 필요 | `graph.facebook.com` / Facebook User 또는 Page token | `instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`, `instagram_manage_insights`, `instagram_manage_messages`, `pages_show_list`, `pages_read_engagement` | Overview상 "기존 Page 연결 통합"용 |
| Instagram API with **Unified Login** | 프로페셔널 계정, 비즈니스 포트폴리오 필요 | 불필요 | `graph.facebook.com` / Business Integration System User token | `instagram_*` 계열 + Facebook Login for Business 권한(정확한 목록은 미확인) | 문서상 신규 통합 권장, **신규 기능은 이 경로에만 출시** |

- **불일치**: App Review 페이지는 `instagram_business_content_publishing` / `instagram_content_publishing`(-ing)으로 표기, 다른 페이지는 `..._publish`. App Dashboard 실제 문자열로 확정 필요.

### 3.2 표

| 항목 | 공식 문서 내용 | 상태 |
|---|---|---|
| 지원 기능 | 피드 이미지, 동영상/릴스(`media_type=REELS`), 스토리(`STORIES`), 캐러셀(최대 20개, 첫 이미지 기준 크롭). 텍스트 단독 게시는 문서상 경로 없음(이미지는 `image_url` 필수). | 확인 |
| 인증(Instagram Login) | 인가 `https://www.instagram.com/oauth/authorize`, 선택 `state`(CSRF 예시). 코드 1시간·1회용, 교환 `POST https://api.instagram.com/oauth/access_token`. 단기 1시간 → `GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token`(서버 전용) 장기 60일. 갱신 `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token`: 24시간 이상·미만료·`instagram_business_basic` 부여 필요, 60일 미갱신 시 갱신 불가. | 확인 |
| 앱 검수 | Standard Access가 기본. "본인 또는 관리하는 프로페셔널 계정만 서비스"하면 Standard Access로 충분하며 App Dashboard에 해당 계정 추가 필요, App Review 불필요. 타인 계정·앱 역할 없는 사용자 대상은 Advanced Access + App Review + Business Verification. | 확인 |
| 게시 단계 | ① `POST /<IG_ID>/media` (`image_url`, `caption`) → 컨테이너 ID ② `GET /<CONTAINER_ID>?fields=status_code` ③ `POST /<IG_ID>/media_publish` (`creation_id`) → 미디어 ID(항상 반환). 이미지는 Meta가 URL을 cURL로 가져가므로 시도 시점에 공개 접근 가능해야 함. | 확인 |
| 상태 값 | `EXPIRED`(24시간 내 미게시), `ERROR`, `FINISHED`, `IN_PROGRESS`, `PUBLISHED`. 1분 1회·최대 5분 폴링 권장. 계정당 컨테이너 생성 400개/24시간. | 확인 |
| 부분 성공 | `media_publish` 응답에 `config_issue`(CAPTION_NOT_ATTACHED, USER_TAGGING_FAILURE) 등이 올 수 있으며 문서는 "게시 자체는 성공, 대사 신호로 처리"하라고 함. | 확인 — `published_with_issues` 표시 필요 |
| 결과 대사 | `GET /<IG_MEDIA_ID>?fields=permalink,timestamp,media_type`(Instagram Login: `instagram_business_basic`). `GET /<IG_ID>/media`(`since`/`until`, 최근 최대 10K). `caption` 필드는 문서 표에 "Facebook Login 전용"으로 표기 → Instagram Login에서는 본문 매칭 대사가 **미확인**, 시각·media_type·permalink 기반으로 대사. 앨범 자식에는 permalink 불가. | 확인 / caption 미확인 |
| 멱등성 | idempotency key·중복 방지·timeout 재시도 지침 문서에 없음. | **미확인 → 사이트 측 보장** |
| 이미지 규격 | **JPEG만**, 8MB 이하, 비율 4:5~1.91:1, 폭 320~1440, sRGB(그 외 변환). | 확인 |
| 캡션 | 2,200자, 해시태그 30개, @태그 20개. | 확인 |
| 게시 한도 | Content Publishing 본문 "100건/24시간" vs 같은 페이지 캐러셀 절·`media_publish`·`content_publishing_limit`(`config.quota_total` "currently 50") "50건". | **불일치 → 런타임에 `content_publishing_limit` 조회로 판단** |

### 3.3 독립 구현 요구사항 (Instagram)

1. 경로 선택: 단일 운영자 본인 계정이면 **Instagram Login + Standard Access** 권고(Page·포트폴리오·App Review 불필요, 구성 최소). 다수 고객사·신규 기능 필요 시 Unified Login 재평가(결정 G-I1).
2. OAuth `state`·토큰 수명주기는 Threads와 동일 원칙(공통 연결 모듈, 채널별 엔드포인트만 분리).
3. 미디어 파이프라인: 업로드 원본 → 서버에서 JPEG·sRGB·폭 320~1440·비율 4:5~1.91:1·8MB 검사/변환 → 권리 승인된 자산만 → 게시 시점에만 유효한 공개 URL(예: Supabase Storage 서명 URL, 유효시간은 컨테이너 처리 시간 + 여유) 발급. 컨테이너가 `FINISHED`/`ERROR`/`EXPIRED`가 되기 전에 URL이 만료되지 않게 한다. Meta가 외부에서 가져가므로 사이트 측 SSRF 위험은 "사용자가 입력한 외부 URL을 서버가 가져오는" 경우에만 해당 — 외부 URL 직접 전달은 금지하고 자체 저장소 URL만 사용.
4. 상태기계: `scheduled → container_created(ID 커밋) → processing(폴링: 다음 cron tick마다 1회, 5분 상한) → ready → publishing → published | published_with_issues | failed | unknown`.
5. 대사: publish 응답 유실 시 컨테이너 `status_code` 확인 → `PUBLISHED`면 `GET /<IG_ID>/media?since=<dispatch 시각>`과 permalink로 확정, 그 외는 Threads와 같은 운영자 승인 재시도 규칙.
6. 한도: 게시 전 `content_publishing_limit` 조회로 잔여량 확인(50/100 불일치 대응), 컨테이너 400/24h 카운트.

### 3.4 남은 결정 / 출시 게이트 (Instagram)

- G-I1: 로그인 경로(Instagram Login 권고 vs Unified Login). Unified Login은 비즈니스 포트폴리오 필요.
- G-I2: 운영 계정이 프로페셔널(비즈니스/크리에이터) 계정인지, 앱에 추가할 담당자.
- G-I3: 권한 문자열(-publish vs -publishing), 게시 한도(50 vs 100) — 불일치, 실제 앱에서 확인.
- G-I4: Instagram Login에서 `caption` 조회 가능 여부 — 미확인.
- G-I5: 공개 미디어 URL 발급 방식·유효시간·삭제/보존 정책(통합 플랜 §8-6).

---

## 4. 네이버 블로그 readiness

| 항목 | 공식 자료 | 상태 |
|---|---|---|
| 글쓰기 API | NAVER Developers 공지 「블로그 오픈 API 종료 안내」(2020-04-06 게시): 대상 "로그인 방식 블로그 오픈 API (글쓰기)", 적용 2020년 5월 6일 종료. 사유: "반복적, 기계적으로 유사한 내용 글을 대량 발행하는 등" 이용약관·게시물 운영정책 위반. 대체 API 안내 없음. | 확인 |
| 현재 API 목록 | 「오픈 API 목록」: 로그인 방식은 네이버 로그인·**카페**(가입·글쓰기) 등, 비로그인 방식은 데이터랩·검색(블로그 **검색** `/v1/search/blog`, 일 25,000회)·캡차·**네이버 공유하기**·오픈메인. **블로그 글쓰기 API는 목록에 없음.** | 확인 |
| 공식 보조 경로 | 「네이버 공유하기 개발가이드」: 사용자가 버튼으로 `https://share.naver.com/web/shareView?url=...&title=...`에 이동해 콘텐츠 URL을 블로그·카페에 공유. 로컬 경로 URL은 파싱 불가(공개 URL 필요). 사람의 조작으로 공유하는 링크 공유이며 본문 자동 입력이 아님. | 확인 |
| 자동화 정책 | 「네이버 이용약관」(policy.naver.com/policy/service.html): "네이버의 사전 허락 없이 자동화된 수단(예: 매크로 프로그램, 로봇(봇) …)을 이용하여 … 네이버 서비스에 로그인을 시도 또는 로그인하거나, 네이버 서비스 상에 게시물을 게재하거나" 하는 행위 금지, 자동화 수단 활용 게시물은 제한될 수 있음. | 확인 |
| 블로그별 운영정책 세부 | 블로그 서비스 개별 운영정책 페이지는 이번에 확인하지 못함. | 미확인(약관으로 결론은 충분) |
| 결과 대사 | 게시 결과를 서버가 받을 공식 경로 없음 → 운영자 URL 입력 증거가 유일한 확정 수단. 블로그 검색 API 결과(link, bloggerlink, postdate)로 보조 확인은 가능해 보이나 색인 지연·노출 보장이 문서에 없음. | 보조 확인은 미확인 |

**결론**: 통합 플랜의 "검토된 콘텐츠 내보내기 + 사람이 직접 게시 + 게시 URL 등록"이 공식 자료와 일치하는 유일한 경로다. 브라우저 확장·CDP·매크로로 로그인/입력/게시를 자동화하는 방식은 약관상 "사전 허락 없는 자동화 수단"에 해당할 위험이 있어 MVP 제외 유지가 맞다(최종 마지막 버튼을 사람이 누르더라도 로그인·입력 자동화 부분의 해석은 네이버 허락 없이 단정할 수 없음).

### 4.1 독립 구현 요구사항 (블로그 수동)

1. 내보내기: 승인된 채널 초안을 제목/본문(일반 텍스트 + 서식 HTML 선택)/이미지 묶음 다운로드/추적 링크로 제공. 복사 버튼은 브라우저 클립보드만 사용.
2. 체크리스트: 게시 전 확인(이미지 권리, 광고·협찬 표기, 링크, 반복·유사 글 대량 발행 금지 안내 — 약관·종료 사유 반영).
3. 증거 등록: 운영자가 HTTPS 게시 URL 입력 → 서버에서 호스트 허용목록(blog.naver.com, m.blog.naver.com 등, 목록은 사이트 결정) 검사 → `awaiting_evidence → published`. 서버가 해당 URL을 자동 크롤링하는 기능은 넣지 않음(약관의 자동 수집 금지 조항 고려).
4. 선택 기능: 사이트 공개 도메인 확정 후 "네이버 공유하기" 버튼(사이트 글 링크 공유). 블로그 검색 API 보조 확인은 후속 과제.
5. 카페 글쓰기 API는 공식 존재하지만 블로그가 아니므로 범위 밖(별도 제품 결정 필요 시에만 검토).

---

## 5. 운영 인프라 (Vercel / Supabase)

| 항목 | 공식 문서 | 영향 |
|---|---|---|
| Vercel Cron 플랜 제한 (「Usage & Pricing for Cron Jobs」, 2026-07-15 갱신) | 모든 플랜 프로젝트당 100개. Hobby: 하루 1회, 시간 단위 정확도(±59분), 하루 1회 초과 표현식은 배포 실패. Pro/Enterprise: 분 단위·분 정확도. 페이지에 "Cron Jobs are a legacy feature and will be migrated to Schedules" 기재. | **Hobby에서는 예약 게시 불가.** Pro 또는 외부 스케줄러 필요. Schedules 전환 시 재확인 게이트. |
| Vercel Cron 동작 (「Managing Cron Jobs」, 2026-08-11) | best effort, 같은 실행을 2번 이상 호출할 수 있음, 이전 실행 중 다음 인스턴스 가능, 실패 시 재시도 없음, `CRON_SECRET`(16자 이상)을 `Authorization: Bearer`로 전송, 리다이렉트 미추종. | 원자적 claim + lease + 멱등 처리 필수(통합 플랜 §4.3과 일치). 실패 재시도는 다음 tick이 DB 상태로 처리. |
| Vercel Functions (「Functions Limitations」, 「Configuring Maximum Duration」, 2026-08-24) | Fluid compute 기본 300s, 최대 Hobby 300s / Pro·Enterprise 800s(1800s 베타). | 30초 대기·최대 5분 폴링을 한 요청에서 하지 말고 tick 단위 단계 실행으로 분리하면 300s 안에서 충분. |
| Vercel Queues (「Vercel Queues」, 2026-09-03) | 모든 플랜 **Beta**, at-least-once, 자동 재시도. | 베타 + at-least-once라 중복 게시 방어는 여전히 DB 몫. MVP 필수 아님. |
| Supabase Cron (「Cron」) | pg_cron 기반, 초 단위~연 단위, SQL/함수/HTTP 요청 실행, 동시 8개 이하·10분 이하 권장. | Vercel Hobby 유지 시 대안: pg_cron이 1분마다 보호된 사이트 dispatch 엔드포인트를 호출. 플랜별 제공 조건은 **미확인**. |
| Supabase Queues (「Queues」) | pgmq 기반, RLS 접근 제어, 가시성 창 내 정확히 1회 전달. 베타/GA 여부 **미확인**. | 동시 처리량이 늘 때 후보. |
| Supabase Vault (「Vault」) | 암호화된 비밀 저장, `vault.decrypted_secrets` 뷰 접근 통제 필요, 루트 키는 DB 밖. | 채널 토큰 저장 후보. 뷰는 서버 전용 역할만 접근하도록 grant 최소화. |

**Queue 조건부 권고**: 단일 운영자·일 수십 건 이하 → DB job 테이블 + 원자적 claim + 1분 tick(Vercel Pro Cron 또는 Supabase pg_cron)으로 충분, Queue 불필요. 다음 중 하나가 생기면 Queue 도입 재검토: (a) 다계정·동시 게시 수백 건/시간, (b) 동영상 처리처럼 tick 1회 실행시간이 함수 한도를 넘는 단계, (c) 외부 이벤트(webhook) 기반 처리. 도입 시에도 at-least-once 전제이므로 DB claim·멱등키는 유지.

---

## 6. 권고 MVP 재검토 (통합 플랜 대비)

통합 플랜 순서 **수동 블로그 → Threads 텍스트 → Instagram 단일 이미지**는 유지. 차이·보완 제안:

1. **Threads 앱 검수 게이트 완화(근거: §2.1 앱 검수 행)**: 플랜은 "앱 검수 확인 후"로 되어 있으나, 단일 운영자 계정을 Threads Tester로 등록하면 검수 없이 live 게시 가능. MVP 게이트를 "App Review"에서 "Meta 앱 소유자·Tester 계정 확정(G-T1)"으로 바꾸고, App Review는 다계정 확장 게이트로 이동 제안. Instagram도 동일하게 Standard Access로 충분.
2. **권한 부여 90일 갱신 운영 추가(근거: Threads 장기 토큰 문서)**: 플랜의 토큰 수명주기에 "공개 프로필 여부, 90일 권한 연장" 항목 추가.
3. **컨테이너 ID 선커밋을 대사 표준으로(근거: 두 채널의 컨테이너 상태 API)**: 플랜 §4.3-4 "외부 조회가 있으면 대사"를 구체화 — 게시 호출 전 컨테이너 ID 저장, 응답 유실 시 상태 `PUBLISHED` 확인 → 목록 조회로 미디어 ID 확정. 두 API 모두 idempotency key가 없으므로 `AdapterCapabilities.lookupByIdempotencyKey`는 `unsupported`로 두고, 별도 capability(예: "컨테이너 상태 기반 대사")를 추가하는 방안을 데이터 작업(AUTOPOST-DATA-001)에 제안.
4. **Instagram 상태 추가**: `media_publish`의 `config_issue`는 "게시 성공 + 대사 필요" → 결과 타입에 경고 정보 필드(예: published + issues) 필요. 통합 플랜에 없음.
5. **Instagram 미디어 변환 필수화**: JPEG만 허용되므로 PNG/WebP 업로드는 서버 변환 단계가 MVP 범위에 포함되어야 함. 공개 URL 유효시간 = 컨테이너 처리 완료까지.
6. **스케줄러 플랜 결정 필요(근거: Vercel Cron 표)**: Hobby면 예약 게시가 하루 1회·±59분이라 사실상 불가 → (a) Vercel Pro(유료, 사용자 결정) 또는 (b) Supabase pg_cron → 보호된 엔드포인트 호출 중 선택. Queue는 MVP에서 불필요.
7. **네이버**: 플랜과 일치. 증거 URL 서버 자동 크롤링은 넣지 않고, 선택적으로 "네이버 공유하기" 링크 공유 버튼을 공개 도메인 확정 후 추가.
8. **capability 값 운영**: `types.ts` 주석대로 문서 확인만으로 `supported`로 바꾸지 않는다. 문서 확인 항목은 dry-run/테스터 실게시 검증 후 `supported`. 문서 기준 초안값:

| capability | threads | instagram | blog |
|---|---|---|---|
| publishText | 문서 지원(검증 전 unverified) | unsupported(텍스트 단독 경로 없음) | 수동 |
| publishImage | 문서 지원 | 문서 지원(JPEG) | 수동 |
| publishVideo | 문서 지원(MVP 외) | 문서 지원(MVP 외) | 수동 |
| publishLink | 문서 지원(`link_attachment`, 링크 ≤5) | 캡션 내 링크 동작 미확인 | 수동 |
| schedule (플랫폼 측) | 미확인 → 사이트 스케줄러 | 미확인 → 사이트 스케줄러 | 해당 없음 |
| delete | 문서상 `threads_delete` 존재(MVP 외) | 미확인 | 수동 |
| lookupByIdempotencyKey | unsupported | unsupported | unsupported |
| metrics | `threads_manage_insights` 존재(MVP 외) | 미확인(이번 범위 외) | 미확인 |
| limits.maxTextLength | 500(계산 규칙 일부 미확인) | 2200 | null |
| limits.maxMedia | 20(캐러셀) / MVP 0 | 20(캐러셀) / MVP 1 | null |

---

## 7. Master 할 일 / 사용자 결정 초안

- 결정 필요(사용자): Meta 앱 소유 주체·Tester/앱 역할 계정(G-T1, G-I2), Instagram 로그인 경로(G-I1, Instagram Login 권고), 스케줄러 방식(Vercel Pro 유료 vs Supabase pg_cron), 운영 계정 공개 여부(G-T2).
- 검증 작업 제안(별도 착수 승인 필요): 테스터 계정으로 G-T3·G-I3·G-I4 실측(권한 문자열, 한도, 재게시 동작, caption 조회).
- AUTOPOST-DATA-001 입력: 컨테이너 ID·상태 열, `reauth_required`·권한 부여 만료 시각, Instagram 게시 경고, 수동 증거 URL 허용 호스트.
- 출시 직전 재확인: Vercel Cron→Schedules 전환, Meta 권한명·한도 변경.

## 8. 공식 출처 (모두 2026-11-16 확인)

Meta — Threads
- Get started with the Threads API — https://developers.facebook.com/docs/threads/get-started
- Get access tokens — https://developers.facebook.com/docs/threads/get-started/get-access-tokens-and-permissions
- Threads long-lived access tokens — https://developers.facebook.com/docs/threads/get-started/long-lived-tokens
- Threads posts — https://developers.facebook.com/docs/threads/posts
- Threads API troubleshooting — https://developers.facebook.com/docs/threads/troubleshooting
- Threads API overview — https://developers.facebook.com/docs/threads/overview
- Retrieve user posts — https://developers.facebook.com/docs/threads/retrieve-and-discover-posts/retrieve-posts

Meta — Instagram Platform
- Instagram Platform overview — https://developers.facebook.com/docs/instagram-platform/overview
- Instagram API with Instagram Login — https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login
- Business Login for Instagram — https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login
- Instagram API with Facebook Login — https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login
- Instagram API with Unified Login — https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login
- Content Publishing — https://developers.facebook.com/docs/instagram-platform/content-publishing
- IG User Media — https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media
- IG Container — https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-container
- IG User Media Publish — https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media_publish
- IG User Content Publishing Limit — https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit
- IG Media — https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media
- Refresh Access Token — https://developers.facebook.com/docs/instagram-platform/reference/refresh_access_token
- App Review for Instagram API — https://developers.facebook.com/docs/instagram-platform/app-review
- (참고) `docs/.../reference/ig-user/media`, `.../ig-container` 경로는 404였고 문서 내부 링크인 `documentation/...` 경로를 사용함.

NAVER
- 블로그 오픈 API 종료 안내 (2020-04-06) — https://developers.naver.com/notice/article/7527
- 오픈 API 목록 — https://developers.naver.com/docs/common/openapiguide/apilist.md
- 블로그 검색 API — https://developers.naver.com/docs/serviceapi/search/blog/blog.md
- 네이버 공유하기 개발가이드 — https://developers.naver.com/docs/share/navershare/
- 네이버 이용약관 — https://policy.naver.com/policy/service.html

Vercel
- Usage & Pricing for Cron Jobs — https://vercel.com/docs/cron-jobs/usage-and-pricing
- Managing Cron Jobs — https://vercel.com/docs/cron-jobs/manage-cron-jobs
- Functions Limitations — https://vercel.com/docs/functions/limitations
- Configuring Maximum Duration — https://vercel.com/docs/functions/configuring-functions/duration
- Vercel Queues — https://vercel.com/docs/queues

Supabase
- Cron — https://supabase.com/docs/guides/cron
- Queues — https://supabase.com/docs/guides/queues
- Vault — https://supabase.com/docs/guides/database/vault

## 9. 검증·제약

- 실행한 검증: 공식 문서 열람(웹 페치·curl GET)만. 코드·테스트·API 호출 없음.
- 제약: Meta 페이지 일부는 페치 도구 요약을 거친 내용이며 인용은 짧은 구절 위주. 네이버 블로그 개별 운영정책, Meta 앱 게시 요건(정책 URL·데이터 삭제 콜백), Unified Login 권한 목록, Supabase 플랜별 Cron/Queues 제공 조건은 미확인.
- Supabase 문서 페이지에 AI 에이전트 대상 피드백 요청 문구가 있었으나 외부 자료 속 지시이므로 따르지 않음.
- 파일 변경: 이 결과 파일 1개 생성. 다른 파일 수정 없음.
