# AUTOPOST-SERVER-BRIDGE-PLAN-001 — CC-ENG 결과

담당 Claude Code(CC-ENG-01) · task_e4a6b9150278 / dispatch ctx_91996d36ebed · 2026-11-16 · 상태: **ready_review**
산출물: `docs/AUTOPOST_SERVER_BRIDGE_PLAN.md`

## 한 일
- 콘솔 UI(W1~W9)를 M1·M2·050000 SQL과 현행 인증 서버 패턴에 맞춰 UI → 서버 → DB 연결 명세로 만들었다.
- SQL 함수 시그니처, 반환 jsonb 키, 오류 토큰, SQLSTATE, GRANT, RLS를 파일에서 직접 대조했다.

## 핵심 결론
- **조회**: service_role 없이 사용자 세션으로 한다. authenticated 열 GRANT와 RLS `private.is_distribution_admin()`이 D1을 강제한다.
- **쓰기**: 050000의 8개, M2의 admin RPC가 전부 service_role 전용이다. 서버 액션은 `auth.getUser()`로 검증한 user.id만 `p_actor_id`로 넘기고, 앱에서 D1을 다시 검사한다. DB의 `distribution_assert_admin_actor`가 3번째 검사다.
- **동시성 토큰**:
  - 원문: `expected_version_no`
  - 초안: `expected_revision_no` + `expected_content_version_id`
  - 승인: `expected_subject_hash`
  - 작업: `expected_version`
  - 토큰은 렌더 시점 값을 hidden input으로 넘긴다.
- **우선 출시 액션 A1~A14**: 원문 저장 → 채널 초안 → 승인·반려·철회 → Blog manual 작업·게시 표시·증거·중단·불명·대사·취소. 각 액션을 실제 SQL 시그니처와 1:1로 맞췄다.
- **오류 매핑 표**: 메시지 토큰을 먼저 보고 SQLSTATE는 보조로 쓴다. 원문 메시지는 보이지 않는다.

## 대조 중 발견한 결함·공백 (필요 작업)
- **N2**: `distribution_effective_approval_id`는 service_role까지 EXECUTE가 회수돼 있어 조회 경로에서 쓸 수 없다. 앱에서 판정 규칙을 재현하고 SQL과 일치하는지 검증해야 한다(또는 view 신규).
- **N3**: 초안 리비전에 title 열이 없다. Blog 제목을 어디에 저장할지 결정이 필요하다.
- **N4**: dry_run은 워커가 실행해야 하는데 워커와 스케줄러가 없다. `claim_jobs`는 전역 큐라 특정 작업을 지정할 수 없다. 특정 작업 선점 함수(SQL)나 별도 워커를 결정해야 한다. 우선 출시는 Blog manual을 먼저 하도록 권장했다.
- **N5**: `server-only` 패키지가 없다. 서버 전용 모듈을 강제할 방법을 결정해야 한다.
- **N6**: W4 디자인에 철회 버튼, 반려 사유, 보관 UI가 없다.
- 그 외 N1(검색 view, 선택), N7(증거 시각 시간대), N8~N10(M3·M4·정책).

## 선행 차단
- B1: 로컬 DB 실행기가 없고 SQL 실행 검증이 0건이다.
- B2: 실제 DB에 적용하지 않았다.
- B3: service_role 키가 서버 env에 없다. 지금 Vercel에는 공개 변수 2개뿐이다.
- B1과 무관하게 지금 할 수 있는 일은 **P0**로 분리했다: actor, errors, dto, 입력 검증, admin 클라이언트(키가 없으면 null), 서버 액션 골격과 그 단위 테스트, client bundle에 secret이 없는지 검사.

## 추가: 원본 키트 기반 이식 작업표 (msg_cea4fe3cd7e2, task_12381b3c1c01 / ctx_e3ffd01ee478)
명세 §10을 추가했다.

**원본 확인 결과(코드 파일 열람, `.env`·키 실값 미열람, 원본 미수정)**
- Blog: Next 앱과 MV3 크롬 확장. 확장은 네이버 편집기에 "발행 직전"까지 입력하고 발행은 사람이 한다 → 우리 Blog manual 경로와 그대로 맞는다.
- Threads·Instagram: 공식 Graph API와 OAuth를 쓴다.

**파일 매핑:** 원본 실제 경로 → 우리 앱 위치, 그리고 구분(그대로 재사용 / 서버 추출 / 대체 수정 / 제외).

**수정 대상 K1~K6**
- K1: state = user.id
- K2: 토큰·앱 Secret 평문
- K3: Threads가 게시 후 예외를 failed로 기록해 중복 위험
- K4: Instagram이 media_publish를 Timeout 재시도해 중복 게시
- K5: 토큰이 URL 쿼리에 실림
- K6: 리스 없는 선점

**이식 순서 I0~I5와 단계별 수락 조건:** Blog 확장 → Threads 텍스트 → Threads 이미지 → Instagram 단일 이미지.

**기술·배포 조건(C1~C3)**
- C1(중요): 키트는 GitHub 저장소 안에 두지 말라고 안내하는데 `icando8988/vibe`는 **public**이다. 키트 유래 코드를 커밋하기 전에 저장소를 private로 전환해야 한다.
- C2: 출처 주석과 NOTICE 보존.
- C3: 확장 zip을 공개 배포하지 않는다.

**승인 필요 의존성:** sharp(Instagram), archiver(선택), server-only(선택). env 이름 목록 포함.

## 하지 않은 것
- 앱, SQL, package, env, 키를 변경하거나 열람하지 않았다.
- 네트워크, DB, 게시, commit은 없다.
- PostgREST 임베드와 오류 code가 실제로 어떻게 오는지 확인하지 않았다(B1 이후).
