# DEV-004A — 이메일 로그인·세션·viewer 연결 (1차)

- 책임 CC-ENG-01 / **사용자 직접 지시** / 2026-11-16
- 상태: **ready_review** — 배포됨(`2f551a9`), CI 통과. **실제 메일 수신·로그인 왕복은 사용자 확인 필요**

## 변경
- 패키지(정확 고정): `@supabase/ssr` 0.12.7, `@supabase/supabase-js` 2.119.0. prod audit 0.
- `src/lib/supabase/config.ts`(https·secret 키 거부) · `server.ts`(쿠키 기반 서버 클라이언트, 브라우저 클라이언트 없음)
- `src/proxy.ts`: sb- 쿠키 있을 때만 세션 갱신(getClaims). 인가 판단 안 함.
- `getViewer`: `auth.getUser()` 서버 검증 → 본인 profiles·role_assignments(열 명시). 실패·미상 값은 pending/역할 없음.
- `/login`: 매직 링크(server action, 계정 존재 비노출, returnTo는 safeReturnTo) · `/auth/callback`(PKCE code·token_hash, 내부 경로만) · `/auth/signout`(POST·동일 출처만, GET 405)
- `/me`: 미로그인·승인 대기·거절 상태 화면 + 로그아웃. `/auth/*` private no-store.
- migration 2건(private 함수 이동, 가입 트리거) — 실제 DB 적용.
- 시험: `tests/auth/auth.test.ts`(29건) → 11 files / 215 tests. lint·build·typecheck exit 0.

## 외부 설정(값 미기록)
- Supabase Auth: Site URL = Vercel 주소, Redirect 허용 = `https://vibe-ten-nu.vercel.app/auth/callback**`, `http://localhost:3000/auth/callback**`(프리뷰 와일드카드 없음).
- Vercel(Production): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`(Config 타입). secret key는 넣지 않음.
- 로컬 `.env.local`(추적 제외)에 같은 공개 값.

## 검증
- 로컬·프로덕션: status authConnected=true, 로그인 폼 표시, 콜백 실패 시 /login, 외부 next 차단, signout GET 405·교차 출처 POST 403.
- 실제 DB 매트릭스 77/77.

## 한계 / 남은 일
1. 메일 발송은 Supabase 기본 SMTP: **조직 구성원 주소로만, 시간당 소량**. 실사용 전 커스텀 SMTP(DEV-008) 필요.
2. 실제 로그인 왕복(메일 링크 → /me 승인 대기)은 사용자 메일로 확인 필요.
3. 카카오 로그인 미구현(콘솔 확인 전 숨김). 관리자 승인 화면·admin 부여 운영 절차·감사 기록(DEV-004B).
4. Preview 배포에는 Supabase 변수 없음 → 로그인 미연결로 표시(의도).
