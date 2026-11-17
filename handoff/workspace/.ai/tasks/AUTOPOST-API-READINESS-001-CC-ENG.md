# AUTOPOST-API-READINESS-001 — 공식 API 출시 준비도 검증

- 작업 ID: AUTOPOST-API-READINESS-001
- 담당: Claude Code 엔지니어 (CC-ENG)
- Master: CX-MASTER-01
- 출력: `.ai/results/AUTOPOST-API-READINESS-001-CC-ENG.md`
- 기준 통합안: `docs/AUTOPOST_INTEGRATION_PLAN.md`

## 목표

Threads와 Instagram을 현재 사이트에 새로 구현할 수 있는지 공식 문서만으로 확인한다. 블로그는 네이버 수동 게시 흐름이 공식적으로 뒷받침되는지 확인한다. 기존 키트 소스/보고서는 다시 열지 않는다.

## 읽기/실행 범위

- Meta, NAVER, Vercel, Supabase의 공식 문서만 웹에서 확인한다.
- URL, 문서 제목, 확인 날짜, 구체적인 권한/API 조건, 불확실성을 기록한다.
- Threads: OAuth/state, 필수 permissions, app review/development access, long-lived token 만료·refresh, 게시 단계/조회·대사 API, 제한/콘텐츠 유형.
- Instagram: Instagram Login과 Facebook Login 차이, permission 명칭, 앱 검수, 프로 계정 조건, 이미지 컨테이너/게시/상태 확인, 미디어 URL/규격/대사 가능성.
- NAVER: 공개된 글쓰기 API 또는 공식 게시 경로의 현재 상태와 정책상 자동화 제한. 확인되지 않은 대체 API를 상상하지 않는다.
- 배포 운영에 영향 있는 경우 Vercel Cron/Function 제한은 현재 공식 문서만 인용한다. 대안 Queue가 필요한지 조건부 권고한다.
- 사이트가 이미 제공하는 배포 타입을 참고해야 하면 `web/src/lib/distribution/types.ts`와 공식 사이트의 일반 구조만 읽는다.

## 금지 범위

- 키트 코드, NOTICE, 프롬프트, schema 또는 기존 분석 산출물 재열람/인용 금지.
- 앱 생성, 계정 연결, 토큰/키 조회, API 호출, DB/코드 수정, 설치, 배포, 테스트 금지.
- 공식 문서에서 확인 못 한 항목은 `미확인`으로 표시하고 출시 게이트로 올린다.

## 완료 조건

- 채널별 readiness 표: 지원 기능, 인증/권한, 게시 전제, 결과 대사 가능성, 제한·심사, 남은 결정, 공식 출처.
- 권고 MVP를 현재 통합 플랜에 맞춰 재검토하고 차이가 있으면 근거와 함께 제안.
- 독립 재구현 요구사항 수준만 기술한다. 키트 고유 설계·코드 형태를 묘사하지 않는다.
- 보고서를 UTF-8 Markdown으로 작성하고 worker_done으로 Master에게 알린다.
