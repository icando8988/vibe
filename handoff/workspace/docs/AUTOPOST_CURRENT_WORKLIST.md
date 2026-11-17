# 자동 포스팅 통합 작업 목록

최신 총괄기준: docs/MASTER_EXECUTION_PLAN_20261117.md 및 HTML, 역할 .ai/TEAM_CURRENT.md, 점유 .ai/WORK_OWNERSHIP.md, 취합이력 .ai/history/WORK_HISTORY.md. 2026-11-17 사용자 지시로 Claude(Front)/Claude(Backend)를 분리했다. M4서버 인계 후 Backend BE-BASE-023은 fixture회귀복구·Front계약문서, Front는 UI를 맡는다. 아래 일부 단계/후속배정은 역사기록이며 최신 총괄기준을 우선한다.

2026-11-16 / Codex master CX-MASTER-01 / run_eaedc8d53618.

| 순서 | 작업 | 상태 | 담당·근거 |
|---|---|---|---|
| 1 | 통합 메뉴·UI 설계 | 구현 입력으로 수락 | Codex Design, AUTOPOST_CONSOLE_UI_PLAN.md |
| 2 | 관리자 통합 콘솔 UI | 코드 작성·검사 완료, 렌더 미검증 | Claude, AUTOPOST-CONSOLE-VERIFY-001; page 14개, typecheck/lint/build 성공, 역할 판정 8/8 |
| 3 | 구현 UI 디자인 QA·비교 3안 | A안 사용자 선택 확정, 앱 적용 대기 | docs/design-options/AUTOPOST_DESIGN_A.html; 기존 Claude 담당이 이어서 구현 |
| 4 | 서버 연결 구현 명세·공통 서버 기반 | 명세와 P0 코드 제출 완료 | actor/검증/RPC 인자 매핑 기반 있음. 실제 원문/초안/승인 화면 연결은 미완료 |
| 5 | M1/M2/쓰기 RPC 실행 검증 | 로컬 대역 검증 및 070000 수정 제출 | M2 334·사전점검 21·M1 206 통과. 실제 Supabase·다중 연결 미검증 |
| 6 | A안 UI 적용 및 원문·초안·승인 서버 연결 | 코드·로컬 검증 완료、실Supabase 미검증 | CONTENT-CONNECT-014: 전체408 통과·PGlite왕복2/2·타입/lint/build 성공. 충돌시 입력유실 보완은 다음 단계 |
| 7 | Blog 수동 작업·확장 인계·증거 화면 연결 | FLOW-015 코드·로컬 왕복 제출 완료 | PGlite5/5·콘텐츠회귀2/2·전체437통과/7별도skip·타입/lint/build 성공. 실세션·네이버·실Supabase 미검증 |
| 8 | Threads 연결·텍스트 게시 | PORT/M3/OAUTH-019 코드·로컬 검증 완료, DRYRUN-EXEC-020 배정 | OAuth PGlite6/6·전체487pass/21전용skip·빌드성공. 실제 Meta/Supabase미연결. 대상 모의작업 수동실행기·OAuth no-referrer 헤더 다음 구현 |
| 9 | Instagram 단일 이미지 게시 | PORT-021 코드·mock검증 완료, M4-MEDIA-022 기존 Claude에 배정 | 단일이미지4단계·publish재전송0·전체511pass/28전용skip·빌드성공. 자산/권리/JPEG/비공개저장 기반→OAuth→실행기·실계정검증 남음 |
| 10 | 예약 워커·운영 중지·실제 게시 검증 | 후속 대기 | 앞선 저장/어댑터 검증 및 운영 조건 선행 |

최신 사용자 결정: A안 확정. 새 세션 생성 없이 기존 Claude Code 담당에게 계속 지시한다. DEC-AUTOPOST-DESIGN-A-20261117.md가 과거의 디자인 선택 대기·실패 검토 세션 재생성 계획보다 우선한다.

공통 수락 조건: 승인 admin만 배포 접근, 가짜 저장/게시 성공 없음, unknown 자동 재게시 없음, 비밀 노출 없음. 현재 외부 게시 gate 닫힘. UI 코드 검사는 실제 계정·HTTP 헤더·브라우저·DB 검증을 대신하지 않는다.

Master 역할: 산출물 검토, 결함 수정 배정, 선행 차단 해소, 범위 충돌 조정 및 통합 수락. 실제 코딩 Claude Code, 디자인 UI 검토 Codex Design.

## 최신 후속 배정

- 원본 소스 기반 적용: AUTOPOST-SOURCE-PORT-001, Claude ctx_ad926d15a609. 2026-11-17 로컬 코드 제출: 공통 서버 기반과 Blog 확장 이식, 관련 테스트 144개·타입/lint/build 통과. 확장 API·토큰·실제 DB 연결은 없음. 전체 테스트 41건 실패는 후속 회귀 수정 대상으로 배정. 공개 저장소 push 없음.
- 원본 전체 기능 UI: Codex Design ctx_ca0e923a7728. 수집·생성·서식·이미지·예약을 단계별 기능 매핑에 포함. 기존 QA에서 P2 개선 8건과 기능 갭 3영역 보고.
- M2 잔여 상태 전이 검증: AUTOPOST-M2-VERIFY-003으로 Blog manual·증거·unknown 대사·dry_run·리스와 재시도 정책을 검증하도록 후속 배정. SQL 변경은 별도 검토한다.

2026-11-17: M2 검증 worker의 응답 통신 오류로 턴 종료 알림을 수신해 동일 작업 재개 지시(msg_62ab57268a4f)를 보냈다. 전체 도메인 테스트 41건 실패는 AUTOPOST-DOMAIN-REGRESSION-004로 기존 Claude에 수정 지시했다. 이는 원인 분석 전 단계이며 기존 코드/테스트 어느 쪽이 잘못됐는지 아직 판정하지 않았다.

2026-11-17 후속 검토: REGRESSION-004 보고서와 jobs 테스트 변경을 대조했다. 41건은 최신 채널 모드/운영자 재실행/요청 전 실패 조건을 반영하지 못한 데이터·기대값 문제로 분류됐고, 테스트 삭제·skip 없이 경계 검사를 보강했다. 전체 308/308, typecheck/lint/build 성공. 다음 AUTOPOST-BLOG-TOKEN-005로 토큰 migration·D1 인증·whoami API·발급/철회 UI와 로컬 검증 구현을 요청했다. 작업 인계 receipt와 실제 착수는 별도 확인한다. 확장 API_READY는 아직 false다.

최신 결과: BLOG-TOKEN-005는 토큰 SQL·서버 인증·whoami·관리 UI를 제출했고 PGlite token 71/71, 전체 단위 335/335 및 빌드를 통과했다. 실제 DB 적용/브라우저 미검증. HANDOFF-007(ctx_1232c1fd98f6)은 task/heartbeat/input-result 구현을 배정했다. M2-FIX-006(ctx_e2bc425ffa2e)은 URL 증거 정규화 우회와 dry_run 리스 회수 배치 차단을 070000에서 수정 중이다. Design 연결 UX 검토에서 BC-01~08을 제출했고 값 표시 종료·불확실 발급 안내 P1 두 건을 우선하여 Claude에 수정 지시했다. 운영 수락은 해당 수정과 전체 migration 재검증 후 판단한다.

후속 결과: FIX-006은 070000 수정 제출 및 M2 334/334·사전점검 21/21·M1 206/206 통과. 토큰 러너의 마지막 migration 가정 1건 수정은 원 담당에게 전달했다. HANDOFF-SQL-REVIEW-009 독립 검토는 080000 잠정 hash 기준 F1(만료 검사 순서), F2(내용 미전달 rejected 영구 차단), F3(만료 상태 정리·조회 부재)를 보고했다. 원 담당에게 현재 hash 대조 후 F1/F2 수정과 F3 최소 관리자 조회·만료 정리를 지시했다. needs_check 이후 자동 재인계는 금지하고 실제 Supabase/다중연결 검증은 여전히 미완료다.

## 예약 재개와 사용자 디자인 결정

- 사용자 지시: Claude는 크레딧 회복을 기다려 2026-11-17 04:16 KST 재개. Orca automation 534ea2ef-360f-4952-ba96-602fd42acb52 설정. 실행 첫 단계에서 자신을 disabled로 바꾸는 단발 작업이다.
- 사용자 지시: Codex Design의 비교 시안 3개(A 콘텐츠/B 채널 작업실/C 캠페인·캘린더)를 HTML로 보고 사용자가 결정한 뒤 새 디자인 앱 적용. AUTOPOST-DESIGN-3OPTIONS-012, 전달 msg_602e7613faa9. Design이 재검토 보고에서 수신을 명시했다.
- UX 재검토 AUTOPOST-BLOG-UX-RECHECK-010: BC-01/02/05/07/08은 소스 기준 해결, BC-03/04/06 부분. 실측 통과 아님.
- 예약 재개 때 Claude 후속 수정: 미분류 발급 오류의 미발급 단정 제거, uncertain 새 발급 동선 분리, 철회 취소의 포커스/pending 의미, 목록 오류를 인증 기록 없음으로 표시하는 분기 및 전역 shell의 실제 토큰 관리 부정 문구 수정. .ai/results/AUTOPOST-BLOG-UX-RECHECK-010-CX-DESIGN.md의 R010 항목을 기준으로 한다. 이 수정은 기능 정확성 보완이며 비교 시안 선택에 따른 재디자인은 사용자 선택 전 보류.

예약 재개 결과 수신: automation은 enabled=false로 단발 종료했고, 기존 Claude 한도 회복 화면을 해제한 뒤 msg_30ef540444a5로 후속 지시를 전달했다. 중복 코딩 worker는 없다. 기존 HANDOFF-007의 최종 수정·검증 완료 보고는 아직 미수신이며 착수 상태 표시는 불확실하다. 수정 동결 후 독립 검토 task_b228a7accebe를 동일 task/retry-of로 한 번 재개하는 게이트를 유지한다.

최신 완료 보고: HANDOFF-007/UX-FIX-008은 최종 080000 hash 6b750a38 기준 구현 제출, 전체360·handoff91·token74·M2 334·M1 206 통과. DESIGN-A-013에서 검토 러너의 구버전 가정을 정리해 최종 인계 회귀101/101 통과, A안 실제 콘솔 적용과 DQ 개선, 전체376/376·타입/lint/build 통과. 미인증 HTTP는 거부화면·no-store·확장401 확인. 승인 admin 실제 브라우저/실Supabase/네이버는 미검증. 기존 Claude에 CONTENT-CONNECT-014를 배정해 A1~A7 조회·쓰기·승인 연결을 이어간다. 위 과거의 완료 미수신/디자인 적용 대기 문구보다 이 기록과 사용자 기존 담당 유지 결정이 우선한다.

## 운영 프론트 배포 완료

DRYRUN-EXEC-020 완료 보고 검토: 지정 Threads 모의작업 수동 실행→dry_run_succeeded, 외부fetch0·PGlite7/7·전체499pass/28전용skip·타입/lint/build 성공. OAuth no-referrer 로컬HTTP 확인. 이 후속 코드는 아직 운영release에 포함되지 않았다. 실제DB/키설정·live실행기·스케줄러는 미완료다.

최종 GitHub CI44011566196 success: lint/test/build/typecheck 전부 통과. 아래 기록의 확인 중 상태는 해소됐다.

RELEASE-FRONT-018: main 3a20194d4f351195f4beff370997ef20555eb9f3 push, Vercel 27Fn2BbKrCnB6zTMKVzG15cqxBr8 success. 운영 https://vibe-ten-nu.vercel.app/admin/distribution 응답과 미로그인 거부/no-store, 확장whoami401 확인. 공개 repo에는 자체 작성 release만 포함하고 원본 확장·Threads·connections 모듈은 untracked 보존. 최종release snapshot416pass/10skip·lint/typecheck/build 성공. GitHub CI44011566196 최종 확인 중. 실Supabase 자동화SQL 적용·서버키·OAuth·실행기는 미완료. 상세 .ai/results/RELEASE-FRONT-018-MASTER.md.
