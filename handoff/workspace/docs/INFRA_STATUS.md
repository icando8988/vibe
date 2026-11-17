# 외부 서비스 연결 상태

2026-11-16 · CC-ENG-01 · 사용자 직접 지시로 진행. 키·비밀번호 값은 기록하지 않는다.

| 서비스 | 상태 |
|---|---|
| GitHub | `icando8988/vibe` (public), main 첫 커밋 `854285e`. 작성자는 저장소 로컬 설정 `icando8988` + GitHub noreply 이메일. CI 첫 실행 통과(Node v24.22.2, run `43821977238`) |
| Vercel | Hobby, 프로젝트 `vibe`, GitHub 저장소 연결. Deploy 클릭은 사용자가 함(Claude 클릭은 권한 정책에 거부됨). 주소 `https://vibe-ten-nu.vercel.app` |
| Supabase | Free 조직. 서울(`ap-northeast-2`) 프로젝트 `vibe`(id `pudkzpmvafkapammevbz`) 생성(사용자가 비밀번호 설정·생성). 기존 싱가포르 프로젝트 `icando8988`은 public 테이블 0개 확인 후 사용자 지시로 삭제. **앱 연결됨(이메일+비밀번호 로그인, DEV-004P `4ad84db`; 비밀번호 최소 8자)**. migration 3건 적용(SQL Editor), 실제 DB RLS 매트릭스 77/77, Advisor 경고 0. Auth Site URL·Redirect 허용 목록 설정. Vercel Production에 공개 변수 2개(URL·publishable key) |

## 배포 사이트 확인 (curl, 2026-11-16)

- `/` 200, `<title>` 정상, `noindex` 포함
- `POST /api/participations` 503 (거래 차단 유지)
- `/stories/nope` 404

## 남은 일

- Supabase 연결(DEV-004): SDK 추가, Vercel 환경변수 설정, 마이그레이션 실행 — Master 지시 후.
- ~~Vercel 프로젝트 Node 버전~~ → 26.x에서 **24.x로 변경**(사용자 지시 "같은 버전으로 맞춰"). 커밋 `ba66d71` 재배포 Ready, 같은 커밋 CI 통과(Node v24.22.2).
- Vercel 계정 2FA 미설정(대시보드 경고) — 사용자 설정 권장.
