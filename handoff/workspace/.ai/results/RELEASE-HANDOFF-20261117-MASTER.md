# RELEASE-HANDOFF-20261117

담당: CX-MASTER-01. 범위: 현재 앱 변경과 원본 세 키트·지침·계획·이력을 공개 저장소로 보존하고 기존 Vercel production 배포 결과를 확인한다. 앱 런타임 추가 구현·실제 DB migration·실제 외부 게시 제외. 완료 조건: 비밀정보 제외 확인, 검증, commit/push, 배포 상태·URL 확인.

사용자가 공개 상태 유지와 전체 작업 파일 업로드를 명시 승인했다. 이전의 파생 코드 공개 제외 방침은 변경한다. NOTICE를 보존한다. 실제 API KEY.txt·비밀번호 파일은 읽지 않았고 업로드하지 않는다.

## 최종 스냅샷 검증

- 스테이징 인덱스를 checkout-index로 별도 임시 폴더에 추출. 실제 .env 없이 npm ci 성공.
- PGLITE_PROJECT=독립 임시 PGlite 설치를 지정한 전체 Vitest: 37개 파일·622개 시험 통과, skip 0, 실패 0. upload PGlite 포함.
- build·typecheck 성공. lint 오류 0/기존 경고 3(background stored, sidepanel api, m2-run defect).
- git whitespace 검사: 원본 보존 문서의 기존 공백과 OAuth flow.ts EOF 추가 공백을 관찰. 의미 없는 원본 재작성은 하지 않는다.
- 실제 Supabase·Storage·Meta·live 게시 동작 증거는 아니다. 담당자의 진행 중 작업도 보존하며 최종 실서비스 검증은 남긴다.

## 인계 구조

앱은 저장소 루트. PROJECT_HANDOFF.md가 시작점이다. handoff/workspace 안에 원래 루트의 .ai·docs·세 키트 원본·기획 입력을 보존한다. handoff/FILE_MANIFEST.json에 파일 hash·크기·제외 목록을 기록한다. 보존된 이전 terminal/run/절대경로는 역사 자료이며 새 계정에서 재연결한다.

푸시/배포 SHA·URL·CI 결과는 아래 후속 기록과 사용자 보고로 확정한다.
