# AUTOPOST-BLOG-UX-FIX-008 — CC-ENG 결과

담당 Claude Code(CC-ENG-01, 기존 세션) · HANDOFF-007 dispatch(ctx_1232c1fd98f6) 안에서 수행 · 2026-11-17
근거: `docs/AUTOPOST_BLOG_CONNECTION_UX_REVIEW.md`(BC-01~08), `.ai/results/AUTOPOST-BLOG-UX-RECHECK-010-CX-DESIGN.md`(R010)
상태: **코드 수정 완료(정적·단위 검증). 브라우저·키보드·스크린리더 실측은 하지 않았다.**

## 수정 파일
`web/src/app/admin/distribution/connections/blog-extension/`
- `token-issue-form.tsx`(TokenIssuePanel)
- `actions.ts`
- `revoke-button.tsx`(신규)
- `format.ts`(신규)
- `page.tsx`

그 밖의 파일:
- `web/src/server/distribution/blog/token-service.ts`(결과 분류)
- `web/src/components/distribution-console/console-shell.tsx`: 선택 prop `gateNotice`만 추가. 기본 문구는 그대로
- `web/src/app/admin/distribution/connections/page.tsx`: Blog 링크 문단만
- `web/extension/naver-blog/SETUP.md`
- `web/tests/distribution-server/blog-token.test.ts`

## 항목별 결과

| ID | 수정 | 상태 |
|---|---|---|
| BC-01 (P1) | 발급 폼과 결과를 `IssueSession` 하나의 수명 안에 두었다. "값 표시 종료"를 누르면 부모가 세션을 **언마운트**한다(key 기반, CSS 숨김 아님) → useActionState 결과(원문)와 복사 상태가 트리에서 함께 사라진다. 부모에는 원문 없이 이름·발급·만료만 남고 "다른 토큰 발급"은 별도 진입이다. 결과 화면에는 발급 폼이 없다. 문구에 "종료 ≠ 철회", 클립보드·확장 저장값을 지우지 않음, 메모리 소거를 보장하지 않음을 밝혔다 | 완료 |
| BC-02 | 복사 상태를 idle·pending·succeeded·failed로 나눴다. 세션이 바뀌면 초기화된다(재마운트). Clipboard API가 없거나 거절되면 "직접 선택해 복사" 오류가 뜨고 재발급은 없다. 읽기 전용 값 칸에 label이 있고, 포커스 시 전체 선택된다 | 완료 |
| BC-03 (P1) + R010-03A/B | `tokenNoticeOf`: 미발급을 **확정할 수 있는 거절만** whitelist로 분류한다(TOKEN_LIMIT, DUPLICATE 23505, 42501, P0002, 22023, already_revoked, RPC 전 거절). 응답 유실, bad_response, 식별 못 한 DB 오류는 모두 `uncertain`이다. 화면 처리는 아래 참조 | 완료 |
| BC-04 + R010-04 | 철회는 확인 단계를 거친다(대상 이름·만료·최근 사용·영향, 입력·게시·증거는 취소되지 않음을 고지). 초점은 열 때 확인 제목, 닫을 때 같은 철회 버튼으로 간다(열림·닫힘 전이에서만 이동). 제출 중에는 확인·닫기를 모두 잠그고 "보낸 요청은 취소할 수 없음"을 표시한다. 철회 응답이 유실되면 uncertain 안내가 뜬다. 만료·철회된 행에는 철회 버튼이 없다 | 완료 |
| BC-05 | 발급 결과·목록·철회 확인을 모두 KST(Asia/Seoul)로 표시하고 기준을 글자로 붙였다. 최근 사용이 없으면 "사용 기록 없음" | 완료 |
| BC-06 + R010-06 | 상태 표시를 바꾸고 준비 단계 표를 추가했다(아래 참조). 공통 셸에 `gateNotice`를 두어, 이 화면은 "토큰 관리는 서버 준비 시 실제 동작, 게시 gate는 닫힘"으로 표시한다. 연결 화면의 Blog 문구는 "수동 게시는 계정 연결 없음 / 확장 인증 토큰은 별도 관리"로 바꿨다 | 완료 |
| BC-07 | live 영역은 "발급 결과가 준비되었습니다" 한 문장만이다(값은 live 영역 밖). 새 결과·오류 제목으로 초점을 옮긴다(useEffect). 서버 invalid의 필드 코드는 `aria-invalid`와 `aria-describedby`로 연결한다. 권한 오류에는 로그인 링크를 둔다 | 완료(실측 미실행) |
| BC-08 | SETUP.md를 실제 계약에 맞췄다(whoami `{ok, connected}`=인증만, task·heartbeat·input-result는 구현됐으나 미검증, `API_READY=false` 유지, 리스 만료 시 자동 재전송 없음). 설치 절은 개발·진단용으로 분리했다. 관리 화면은 "관리자용 설치 안내·배포본 준비 전" + 복귀 링크만 둔다(저장소 경로 노출 제거) | 완료 |

**BC-03 화면 처리:** uncertain이면 **발급 폼을 내리고** 아래 순서로 안내한다. "새 발급 시작"은 새 표시 세션을 열 뿐이며 자동 재요청은 0회다. 이름만으로 철회 대상을 단정하지 말라고 고지한다.
1. 요청 시각(KST)을 보여 준다.
2. "목록 다시 불러오기"
3. 대상을 확인하고 필요하면 철회한다.
4. "목록을 확인했습니다 — 새 발급 시작"을 명시적으로 누른다.

**BC-06 화면 처리:**
- 상태 표시를 "사용 중"에서 **"유효"**로 바꾸고, 최근 사용은 별도 열로 둔다.
- 준비 단계 표(현재 근거만):

| 단계 | 표시 |
|---|---|
| ① 토큰 발급 | 목록 조회 성공일 때만 "준비됨"이며 실제 발급은 발급 결과로만 확인 |
| ② 서버 인증 | 목록 조회가 ok일 때만 기록 있음·없음을 판단. 실패·준비 전은 "확인 불가" |
| ③ 블로그·버전 확인 | 미구현 |
| ④ 인계 API | 서버 구현·미검증·확장 비활성 |
| ⑤ 실행·증거 | 미실측 |

## 검증
- 단위 테스트(`blog-token.test.ts`):
  - 응답 유실·잘못된 성공 응답·식별 못 한 DB 오류(XX000, SQLSTATE 없음, 57014) → uncertain, 확정 실패 아님
  - TOKEN_LIMIT·42501·DUPLICATE·22023 → 확정 실패
  - 철회 응답 유실 → uncertain
  - KST 표시가 같은 시각을 다른 오프셋으로 넣어도 같음, "사용 기록 없음"
- `npm.cmd test` 360/360, lint 오류 0, typecheck 0, build 0(명령·종료코드는 HANDOFF-007 보고서).

## 미검증·한계
- 실제 브라우저 렌더, 키보드 Tab 순서, 스크린리더 낭독, 클립보드 권한 동작은 측정하지 않았다(설계 검토 후속 측정 대상).
- React 언마운트로 참조를 끊는 것까지만 보장한다. JS 엔진 메모리의 즉시 소거, 브라우저 개발자도구·확장이 이미 본 값은 보장 범위 밖이다.
- 공통 셸의 다른 화면 기본 문구는 그대로다. 실제 기능이 붙는 화면이 생기면 `gateNotice`로 개별 지정해야 한다.
- 사용자가 A안을 선택했다(msg_95d6a1009def). 이번 수정은 기존 디자인 토큰 그대로이며 A안 적용은 다음 지시로 진행한다.
