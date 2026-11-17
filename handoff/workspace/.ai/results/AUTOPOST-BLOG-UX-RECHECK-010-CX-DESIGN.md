# AUTOPOST-BLOG-UX-RECHECK-010 결과

- 담당 AG-UI-01 / Codex Design(배정 작업자), Master CX-MASTER-01.
- Task `task_aa6a40c4800f` / dispatch `ctx_ff34dc23a67b` / terminal `term_06c0d06f656b67cc0965c09eedd854d7`.
- 작성 2026-11-17, Asia/Seoul. 상태 **ready_review / 소스 스냅샷 기준 잠정 재검토**.
- 허용 변경: 본 결과 파일 하나. 앱·SQL·확장·기존 검토 문서 수정 없음. 추가 위임 없음.

## 1. 판정 요약과 범위

기존 BC-01~08 중 **소스상 해결 5건(01/02/05/07/08), 부분 해결 3건(03/04/06), 전체 미해결 0건**이다. 여기서 해결은 기존 지적에 대한 코드 구조/문구 보완이 확인됐다는 뜻이며 브라우저·접근성·발급/철회·실DB 통과 판정이 아니다. 특히 일회 값 표시를 끝낼 때 actionState를 부모에 옮겨 보관하는 패턴은 발견하지 않았다.

원 담당의 수정 종료/최종 동결은 확인하지 않았다. UX-FIX-008 이름의 결과 파일은 제한된 파일명 검색에서 발견하지 못했고, 이 사실만으로 작업 중/종료를 판단하지 않는다. 공유 폴더이므로 이 결과는 아래 해시 시점에 대한 잠정 판정이다. 첫 읽기 시각은 2026-11-17T02:40:58+09:00, 기준 해시 캡처는 2026-11-16T17:41:50.6509791Z, 대조 캡처는 2026-11-16T17:42:41.3039444Z다. 두 해시 캡처 사이 기본 10개 파일 변화는 없었다. write-runner/whoami는 보충 열람 후 마지막 캡처에 포함했다. 이후 변경본에는 재대조가 필요하다.

필수 전체: connections/blog-extension의 page·token-issue-form·actions·revoke-button·format, connections/page, server/blog/token-service, 확장 SETUP. 보충: 공통 console-shell, 오류 매핑 errors, write-runner, whoami. 실제 토큰/계정·키/env·DB·브라우저·네트워크·API·테스트/빌드는 열람/실행하지 않았다. 표시 값 대신 소스의 필드/심벌·분기만 확인했고 비밀 예시도 만들지 않았다.

## 2. 기준 파일 SHA-256 / 수정 시각

시각은 UTC, 해시는 파일 전체 내용 기준이다. 민감한 값의 해시가 아니라 **소스 파일 해시**다.

| 파일 | LastWriteTimeUtc | SHA-256 |
|---|---|---|
| `web/src/app/admin/distribution/connections/blog-extension/page.tsx` | 2026-11-16T16:23:57.5708797Z | `AD68441968C4B3C97DA623281E27CB285AF4F15E743EDDAE4E37024BA6061C60` |
| `web/src/app/admin/distribution/connections/blog-extension/token-issue-form.tsx` | 2026-11-16T16:23:24.9240630Z | `0B2647E4502AD946A2EA6148E8C3A4AF7CCC0DB88B7BA1C4E3D21D3EE9EF4E76` |
| `web/src/app/admin/distribution/connections/blog-extension/actions.ts` | 2026-11-16T16:22:32.0652331Z | `5026ABD1CD74C0CD3E8B34EDB08DC0DF8DDE4B741DC8BF3DB912745765DAC27A` |
| `web/src/app/admin/distribution/connections/blog-extension/revoke-button.tsx` | 2026-11-16T16:23:57.4133434Z | `6849D7A76F6526D3B6E9A9C1A1CE8B513483CD962E8AC63908CEB54FC25AABC2` |
| `web/src/app/admin/distribution/connections/blog-extension/format.ts` | 2026-11-16T16:22:18.3935222Z | `D066DCE0587E045909693B88D3A15EC9A46088C1879D40C392C9611DE4A8AF31` |
| `web/src/app/admin/distribution/connections/page.tsx` | 2026-11-16T16:24:05.2766071Z | `127DCCAF729A8421631FB72845F6F6489677E427DE902D5CA208DD6E21DB27AE` |
| `web/src/server/distribution/blog/token-service.ts` | 2026-11-16T16:22:18.2215834Z | `DAFBC4F786D595A4011A2E8ABA5D29C030098F90D095643F2EE4460CDE143D32` |
| `web/extension/naver-blog/SETUP.md` | 2026-11-16T16:24:30.4908114Z | `22BB7C2C46F054CA4F4D319B3225BAFB1755E172AF91B26874BA39382A67A9C6` |
| `web/src/components/distribution-console/console-shell.tsx` | 2026-11-16T12:32:38.5975674Z | `63D9ED70B21EC9304A46166E91017F38AE59BA9D0215499EF76134C3EAF867A9` |
| `web/src/server/distribution/errors.ts` | 2026-11-16T15:58:28.6975011Z | `9E4690DDB5FC7BB4928406FD98167330B88556FA92211236CEC38E0B27480F92` |
| `web/src/server/distribution/write-runner.ts` | 2026-11-16T14:25:50.5721336Z | `CC832D22B3FE8EE5B0DC18238D75D6D3D0C5B8FFCF8AE43550A0F09610CCEACC` |
| `web/src/server/distribution/blog/whoami.ts` | 2026-11-16T16:08:56.8971386Z | `DAA06F14E4A1A1E34E37DA98F6C862C7ACC5DD6D132E4B8E7BC80E2256981914` |

## 3. BC별 재검토

| 항목 | 판정 | 현재 코드 근거 | 남은 조건/Claude 제안 |
|---|---|---|---|
| BC-01 일회 표시 종료/수명주기 | **해결(소스)** | token-issue-form:33~78의 부모는 session 번호와 ClosedMeta(이름·발급·만료)만 저장. IssueSession:83~85 안에 useActionState/copy가 있고, 종료:139는 필요한 메타데이터만 새 객체로 전달. closed 분기에서 자식을 렌더하지 않아 언마운트, 새 세션은 key 증가 | React/브라우저의 메모리 완전 소거·클립보드 삭제를 보장하지 않는 설명 유지. 아래 §4의 비동기/초점 한계는 실제 검증 전 미확인 |
| BC-02 복사 실패·상태 초기화 | **해결(소스)** | token-issue-form:81~106의 idle/pending/succeeded/failed, 미지원/Promise 거절→failed, :144~147 오류와 수동 선택 대안. 새 세션 언마운트/마운트로 idle 시작. issued 분기에는 추가 발급 폼 없음 | 클립보드 권한/미지원·거절/성공과 수동 선택은 실제 브라우저 미측정. 실패가 재발급을 유도하지 않는 문구 유지 |
| BC-03 불확실 발급 실패 단정 | **부분** | token-service:159~162의 bad_response/unavailable→uncertain, actions:38~41이 요청 시각만 담은 uncertain 반환. token-issue-form:158~175는 발급 여부 확인 필요·재조회/식별·철회 안내. 자동 재발급 경로 없음 | 알려진 불확실 경로의 기존 제목 문제는 해결. 다만 미분류 db_error까지 failed로 묶어 ‘아무 토큰도 만들어지지 않음’을 단정하는 경계와 uncertain에서 즉시 재제출 가능한 폼은 §5 권고 |
| BC-04 철회 확인/진행·복귀 | **부분** | revoke-button:36~76 대상 이름·만료·최근 사용/영향을 보여 주는 inline 확인, ConfirmSubmit:12~17은 pending 잠금, 취소 버튼 제공. page:21~37 결과/불확실 안내. 만료·철회 항목에 철회 버튼 없음(:149~154) | 취소 뒤 opener 포커스 복귀 코드 없음. 취소는 서버 제출 pending에도 활성이라 요청 취소로 오인할 수 있음. §5 권고 |
| BC-05 시간대 | **해결(소스)** | format:7~20이 Asia/Seoul/KST로 통일. page:126/139~150, token-issue-form:48/116/233에서 공유. formatLastUsed는 사용 기록 없음 표시 | 실제 다른 시간대 브라우저 렌더 미측정. 형식 함수 존재만으로 실측 통과 선언 안 함 |
| BC-06 연결/readiness 혼동 | **부분** | page:40은 active=유효, :69~103 단계표, 부모 connections:31~36은 수동 게시와 확장 인증 별도 설명, page:59~61 조건부 동작 설명 | 공통 shell:93~95의 ‘어떤 저장·연결도 실행 안 함/상태는 실제 결과 아님’ 안내가 여전히 존재. 목록 오류/준비 전을 인증 기록 없음으로 바꾸는 분기도 남음. §5 권고 |
| BC-07 live·label/결과 초점 | **해결(소스)** | token-issue-form:110~128은 제목 초점·짧은 status와 값 input 분리. :91~94 결과/오류 제목 focus, :194~225 label·aria-invalid·필드 오류 연결. 값은 status/alert의 자손이 아님 | 실제 스크린리더의 자동 낭독/중복·Tab·focus 링·선택 동작은 미측정. 전체 접근성 통과가 아님 |
| BC-08 SETUP/설치 동선 | **해결(현재 준비 전 범위의 소스/문서)** | SETUP:20~22 관리자 배포/설치 준비 전·개발 절차 구분, :36~47 실제 코드 계약/미검증 명시. :42 whoami 최소 인증 확인을 현재 핸들러:20~24와 정합화. page:176~183 설치 준비 전과 복귀 링크 | 실제 설치본/클라이언트 소비·배포/인계 통합은 미검증. 지금 설치 완료를 요구하지 않으며 API 코드 존재를 실행 성공으로 승격하지 않음 |

줄 번호는 해시 시점 파일 기준이다. 이전 DQ-01~08은 기존 QA/작업표를 참조하며 새 결함으로 중복 등록하지 않았다.

## 4. 표시 세션 종료 뒤 원문 참조의 구체적 검토

이름만 ClosedMeta로 선언한 것이 아니라 실제 전달 객체도 메타데이터 세 필드만 명시한다. `onClose(state)` 또는 spread로 전체 actionState를 부모로 전달하는 코드가 없다. 부모의 `setClosed(meta)`가 실행되면 closed 분기의 별도 JSX로 돌아가고 IssueSession이 제거된다. useActionState는 부모가 아니라 그 자식에 선언되어 있다. 다시 열면 session key가 증가해 이전 result/copy 상태를 재사용하지 않는다. issued 결과 분기는 폼 대신 값 표시 UI를 반환하므로 같은 세션의 이전 issued state를 둔 채 추가 발급 폼을 제출하는 구조도 아니다.

따라서 **앱이 작성한 부모 상태에 토큰 원문을 계속 저장한다는 우려는 소스상 해소**됐다. 단, 비동기 clipboard Promise가 완료 전이면 해당 콜백/클로저가 잠시 참조를 가질 수 있고 React 내부/브라우저 메모리나 이미 복사된 값까지 즉시 사라진다고 입증하지 않았다. 닫기가 클립보드 삭제/철회가 아니라는 현재 문구는 이 한계와 맞는다. ‘토큰은 그대로 유효’ 문구는 외부 철회/만료와 경합하면 실제 유효성 보장이 아니므로 향후 ‘표시 종료 자체로는 철회되지 않습니다’처럼 행위의 효과로 좁히면 더 정확하다(부가 P2 문구 권고).

부모의 closed 제목 callback ref는 렌더 시 focus를 요청한다. 다른 토큰 발급 버튼으로 새 세션을 열면 새 폼/제목으로 초점을 명시적으로 옮기는 처리는 없다. 이는 원문 보존 결함과 별개로 키보드 복귀 실측/보완 대상이다. 포커스용 ref가 선언되어 있다는 사실만으로 실제 복귀가 완료됐다고 판단하지 않았다.

## 5. 남은 수정 제안

### R010-03A / BC-03: 미분류 오류의 미발급 단정 — P2, 실제 발급 경계 재확인

- **위치:** token-service.ts:161~167, errors.ts:92~98, write-runner.ts:46~54, token-issue-form.tsx:21~27.
- **코드 사실:** 서버 RPC의 response.error는 unknown 형이고 공통 mapper는 식별 못 하는 오류를 unexpected로 돌려준다. tokenNoticeOf는 unavailable만 uncertain으로 분기하고 나머지 db_error를 기본 failed로 보낸다. 이 failed 문구는 아무 토큰도 만들어지지 않았다고 단정한다.
- **영향/한계:** 코드 주석은 DB 오류 응답이면 트랜잭션 롤백이라고 가정하지만 미분류/SQLSTATE 없는 응답까지 확정 거절이라는 증거는 이 함수 경계에 없다. 실제로 발급 후 오류가 발생했다고 재현한 것은 아니다.
- **Claude 권고:** 미발급을 확정할 수 있는 거절만 whitelist로 분류하고 나머지는 uncertain 또는 비단정 안내로 보낸다. 확정 가능한 DB 오류 범위를 근거로 정한다.
- **수락:** bad_response/unavailable뿐 아니라 식별 불가 오류에서도 근거 없이 미발급을 확정하지 않는다. 알려진 권한/입력/상한 거부는 적절한 거절 안내를 유지한다.

### R010-03B / BC-03: uncertain 분기 재조회 절차의 실행 가능성 — P2

- **위치:** token-issue-form.tsx:158~175,193~230.
- **사실:** uncertain 안내와 목록 재조회 버튼은 있지만 폼은 그대로 렌더되고 제출 잠금은 pending만 본다. 재조회/대상 식별을 하지 않고 사용자가 즉시 다시 제출할 수 있다. 자동 재발급은 없다.
- **권고:** uncertain에서는 새 발급을 확인 단계로 분리하고 조회 실패 동안은 불확실 상태를 유지한다. 단순 ‘확인함’ 클릭이나 refresh만으로 성공을 만들어내지 않는다.
- **수락:** 목록 확인→필요한 대상 철회/확인→명시적 새 발급 동선이 분리된다. 불확실 응답 후 자동 재요청은 계속 0이다.

### R010-04 / BC-04: 취소 초점·pending 의미 — P2

- **위치:** revoke-button.tsx:32~45,54,61~75.
- **사실:** openerRef는 ref에 연결만 되어 취소 후 focus 호출이 없다. 확인 title은 inline callback ref로 초점을 요청하며, 제출 진행 중에도 취소 버튼은 별도 잠금이 없다.
- **권고:** pending을 취소 버튼에도 전달하거나 ‘확인창 닫기이며 요청 취소 아님’으로 명확히 한다. 닫은 뒤 재마운트된 opener로 effect/ref를 통해 초점을 돌린다. callback ref가 렌더마다 반복 초점을 끌지 않도록 초기 열림/닫힘 전이에 한정한다.
- **수락:** 열기→제목/확인→취소→동일 opener의 키보드 위치 복귀. 제출 중 닫기/재열기가 새 서버 제출을 유도하지 않고 이미 전송된 철회가 취소됐다고 표현되지 않는다. 실제 Tab/스크린리더는 후속 측정한다.

### R010-06 / BC-06: 준비도·조회 실패/기록 없음 분리 — P2

- **위치:** page.tsx:49~51,81~99; console-shell.tsx:93~95.
- **사실:** 목록이 ok가 아니면 tokens=[]여서 anyUsed=false다. 그 상태에서도 ② 단계는 ‘인증 기록 없음’으로 나온다. 서버 준비 전/목록 오류의 기록 미확인을 확정된 기록 없음으로 바꾸고 있다. 전역 shell의 실제 결과 아님 안내도 그대로다.
- **권고:** listed.status가 ok일 때만 기록 있음/없음을 도출하고 다른 분기에는 ‘확인 불가/준비 전’을 쓴다. 토큰 발급 가능은 목록 RPC 성공에서 도출한 준비 신호임을 구별하고 실제 발급 성공은 해당 액션 응답으로만 확인한다. 공통 shell은 실제 가능한 토큰 관리와 실제 게시 gate를 별개로 설명한다.
- **수락:** 목록 실패/준비 전에서 인증 기록 0 또는 없음 확정 금지. 유효·과거 인증 기록·현재 인계 준비가 독립적으로 읽힌다. 실제 발급된 결과를 샘플/미실행으로 부정하지 않는다.

## 6. 실측하지 않은 항목과 반환

브라우저/실토큰/키/env/계정/실DB/네트워크·API·테스트/빌드·React 메모리 측정·클립보드 호출을 하지 않았다. 스크린리더·200% 확대·대비·focus 실제 이동·취소 경합·화면 갱신 후 값 잔존 여부는 **미측정**이며 통과라고 쓰지 않는다. 이번 ‘해결’은 스냅샷 소스 구조의 보완 확인이다. 새 handoff 구현/SQL/확장 실행 코드는 검토하지 않아 SETUP의 API 구현 완료 주장을 독립 검증하지 않았다.

본 파일만 생성했다. 기존 검토 결과/작성분은 보존한다. Master는 부분 해결 항목을 Claude 수정에 넘기고 원 담당의 최종 버전이 나오면 해시를 대조하면 된다. 후속 메시지 `msg_602e7613faa9`의 비교 디자인 3안 요청은 수신했으나 이 보고서에 섞어 앱/디자인 최종 선택을 진행하지 않았다. 현재 재검토를 반환한 뒤 별도 디자인 작업으로 이어갈 범위이며 사용자 선택 전 앱 적용은 하지 않는다.

