# 다른 계정에서 작업 이어받기

2026-11-17 · Codex master. 사용자 명시 지시: 공개 저장소 유지, 현재 작업 소스·지침·전체 프로젝트 맥락 업로드. 이 지시는 과거의 원본 파생 코드 공개 제외라는 Master 작업 방침을 변경한다. 원본 NOTICE는 보존한다.

## 저장소 구조

- 저장소 루트: 원래 `D:/Vibe/web`. Next.js 앱·테스트·마이그레이션·이식 코드 전체.
- `extension/naver-blog/`: 이식된 네이버 확장. 기본 연결 비활성, 최종 발행은 사람.
- `handoff/workspace/.ai/`: 역할·지시·작업 결과·결정·히스토리·인계·사용한 보조 스크립트.
- `handoff/workspace/docs/`: 상세 계획·계약·A안·3개 디자인 시안·HTML·검토 근거.
- `handoff/workspace/Blog_Posting_Kit_v1.07/`, `Threads_Auto_Posting_Kit_v1.02/`, `Insta_Auto_Posting_Kit_v1.11/`: 원본 소스와 배포 지침·NOTICE.
- `handoff/workspace/`: 원래 최상위 AGENTS/CLAUDE/AI_TEAM_RULES, 기획서·추출 자료. 과거 경로·세션은 기록이며 현재 환경과 동일하지 않다.
- `handoff/FILE_MANIFEST.json`: 보존 파일 SHA-256·크기·제외 파일·고정밀 비밀 패턴 점검 결과. 실제 비밀값은 기록하지 않는다.

보존본의 다른 프로그램까지 현재 앱의 타입검사·린트 대상으로 섞지 않도록 `handoff/`만 제외했다. 실제 앱의 검사는 그대로다.

## 시작 순서

1. 다른 계정으로 저장소를 clone/fork하고 저장소 루트에서 작업한다. npm 기준 Node 버전은 `.nvmrc`를 따른다.
2. AGENTS.md → 보존된 TEAM_CURRENT/WORK_OWNERSHIP/WORK_HISTORY → MASTER_EXECUTION_PLAN_20261117 → CURRENT_WORKLIST → 관련 최신 results를 읽는다.
3. `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`로 현재 환경을 확인한다.
4. PGlite 전용 시험은 `scripts/distribution-local-verify/README.md`와 각 `*-run.mjs` 안내로 독립 PGlite 설치를 준비해 실행한다. 설치가 없어서 skip된 시험은 통과로 세지 않는다. 임시 설치·node_modules는 이전되지 않는다.
5. Front/Backend/Design/Master를 새 계정의 실제 세션에 다시 연결한다. 과거 terminal/dispatch/run ID로 자동 지시하지 않는다. 이미 끝난 예약 자동화도 복원·실행하지 않는다.
6. 실제 Supabase·Vercel·Meta 접근은 해당 서비스에서 새 계정에 적절한 권한을 제공하거나 별도 프로젝트로 연결한다. GitHub 소스 업로드만으로 외부 계정 소유권·DB·환경변수·사용자 데이터가 이전되지 않는다.

## 현재 기능 상태

A안·원문/초안/승인·Blog 수동 인계/증거·Threads OAuth/암호화 저장·모의 실행기·Instagram 단일 이미지 HTTP 부품·미디어 기반 코드가 있다. 실제 외부 서비스 동작이 모두 완료됐다는 의미가 아니다.

- 마지막 확인된 운영 배포 기준선: `3a20194`, https://vibe-ten-nu.vercel.app. 이후 변경의 배포 결과는 최신 release 결과/커밋과 대조한다.
- 실 Supabase 자동화 마이그레이션·서버 키·private bucket·Meta 앱·실계정 시험은 미완료 보고 상태다. 실제 DB 이력부터 재확인한다. SQL 파일 커밋은 DB 적용이 아니다.
- Backend BE-UPLOAD-025: 코드·테스트 작성 중 사용량 한도로 중단된 시점의 작업을 보존한다. 최종 PGlite/통합 결과 미보고. 스냅샷 검증 결과를 별도 확인한다.
- Front FE-MEDIA-024: metadata 연결·Design 보완 작업 중간 변경 포함. 아직 최종 완료 보고 전이며 실세션·브라우저 실측도 별도다.
- 원본 업로드: grant→브라우저 private intake 직접 전송→complete/cancel 계약. 업로드 UI는 계약 최종 검증 전 비활성 상태 유지.
- 실제 live 게시·Instagram OAuth·워커/예약/리스 회수 운영 주체·고아 Storage 정리·원문 media_asset_ids 검증은 남은 작업이다.

2026-11-17 Master 최종 인계 스냅샷 검증: PGLITE_PROJECT를 지정한 전체 시험 **37개 파일·622개 통과, skip 0, 실패 0**. 새 upload PGlite 시험도 포함한다. npm ci·build·typecheck 통과, lint 오류 0/기존 경고 3. 로컬 인메모리 대역 결과이며 실제 Supabase·Storage·OAuth·게시 검증은 아니다. 담당자 최종 완료 보고와 실서비스 검증은 이어서 수행한다.

## 포함하지 않은 파일

`API KEY.txt`, `SUPABASS DB 비번.txt`, 실제 `.env`·개인 인증서/자격정보·브라우저 쿠키/프로필·`.orca` 로컬 런타임·Git 내부 이력 복사본·node_modules·빌드 캐시·임시 엑셀 잠금 파일은 업로드하지 않는다. 새 계정에서는 필요한 값을 서비스의 안전한 설정 화면에서 직접 구성한다. 값을 채팅·기획·소스에 붙이지 않는다.

## 이어갈 작업

최신 스냅샷의 전체 시험 → BE-UPLOAD-025 완료/검증 → Front metadata·업로드 화면 연결 → 실제 DB/Storage/계정 환경 준비 → Blog 실제 검증 → Threads/Instagram 운영 검증 → 수집·AI 생성·이미지 확장·예약/관리 기능. 담당별 파일 점유와 사용자 직접 지시를 먼저 확인한다.
