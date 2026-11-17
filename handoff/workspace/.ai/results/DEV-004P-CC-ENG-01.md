# DEV-004P 이메일+비밀번호 로그인 — CC-ENG-01

- 상태: ready_review
- 지시: 사용자 직접 지시("카카오 로그인 방식 말고" → 선택 "이메일+비밀번호", 참고 화면 첨부 후 "이방식으로 진행해").
- 범위 충돌: Master(msg_0215a594c0b8, msg_0d64478eacd2)는 MKT-009만 하라고 지시함. 충돌 내용을 사용자에게 그대로 알리고 결정을 받음. 사용자가 "로그인 작업 계속"을 골라 그 결정을 따름(msg_f7174881eff3, msg_e43f6a4ce46a로 Master에 통보).
- 커밋: `4ad84db` (web). 다른 세션의 미커밋 파일(src/lib/distribution/*, distribution 마이그레이션 2건)은 포함하지 않음.

## 변경
- `/login`: 탭 2개(로그인 / 회원가입, `?mode=signup`)와 비밀번호 찾기(`?mode=reset`). JS 없이 서버 액션으로 동작.
- `/login/update-password`: 재설정 메일 링크(→ `/auth/callback?next=/login/update-password`)로 로그인된 상태에서 새 비밀번호를 저장.
- 서버 액션 `signInWithPassword`, `signUpWithPassword`(메일 인증), `requestPasswordReset`, `updatePassword`. 매직 링크 폼은 제거했고, callback 라우트는 유지(가입 인증·재설정에 쓰임).
- 오류는 허용 목록의 notice 코드로만 전달. 계정 없음과 비밀번호 틀림은 같은 안내. 가입·재설정 응답으로 계정이 있는지 드러나지 않음. 비밀번호는 URL에 담지 않음.
- 비밀번호 8자 이상 72바이트 이하. Supabase Auth 최소 길이도 6→8로 변경(사용자 지시 범위 내, 대시보드 확인).
- `/login/:path*`에 no-store 헤더 추가.

## 검사
- 깨끗한 작업 트리(HEAD와 이 변경만): lint, typecheck, build 통과. 테스트 11 files / 224 tests 통과.
- 공유 작업 트리에서는 distribution 테스트 41건이 실패함. 다른 세션의 미커밋 변경 때문이며 이 작업과 관계없음.
- 로컬 next start에서 실제 Supabase로 확인: 잘못된 비밀번호 → `notice=invalid_login`, 비밀번호 확인 불일치 → `password_mismatch`. 4개 화면 모두 200, `Cache-Control: private, no-store`.
- 미확인: 실제 가입 인증 메일과 재설정 메일 왕복(사용자 메일함 필요). 기본 SMTP는 조직 구성원 주소로만, 그것도 소량만 발송됨.
