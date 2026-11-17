# 작업 점유·충돌 조정

관리 Codex master / 2026-11-17. 선언형 기록이며 파일시스템 잠금은 아니다. 사용자 직접지시 우선.

현재 재개 범위: Front FE-MEDIA-NOTICE-032는 두 미디어 페이지의 query notice와 보관 오류 문구/관련 시험만, Backend BE-UPLOAD-RECOVERY-030은 신규 140000·복구 서버/시험/계약만 담당한다. Master는 OPS_READY_024_MEDIA_RUNBOOK.md·공통 상태 기록·결과 통합을 담당하며 두 담당의 코드 점유를 침범하지 않는다. 과거 표와 충돌 시 이 범위가 우선한다.

후속: Front032·Backend030 로컬 인수 후 코드 점유 종료. Front033은 media-labels.ts의 UPLOAD_STALLED 라벨 및 관련 Front 회귀만 점유한다. Backend는 lifecycle 보고 정정 후 대기, 추가 서버 수정은 새 배정에 따른다.

Front033 반환·로컬 통합 인수 완료로 해당 라벨/회귀 점유도 종료했다. 다음 담당 수정은 새 범위 배정 후 진행한다.

| 범위 | 기본 담당 | 현재 조정 |
|---|---|---|
| app UI·components·폼연결 | Claude(Front) | API 제외, Design 완료구간 보존 |
| 시안·스타일·접근성 | Codex Design | 같은파일은 사전 심벌/구간 공유 |
| 신규 media-* UI 검토 | Codex Design UI-MEDIA-025 | 읽기전용·고유결과파일만. Front 페이지/컴포넌트 수정금지 |
| tests/distribution-front/media-ui.test.ts:162 M025-01 단언 | Codex Design RELEASE-UI-TEST-026 완료 | 두Claude한도대기확인후Master가UI검증1건재배정. 속성순서독립의미검사·required유지,19개통과. 코드수정점유종료·release검증Master |
| ActionForm 공용컴포넌트 | Claude(Front), M025-05 필요시만 | Master 최소추가허용: 선택props/기본동작호환·타페이지회귀. write-notice/globals 비수정 |
| server·API·domain·DB·OAuth·실행기 | Claude(Backend) | M4 인계완료, 개별작업의 명시수정범위 준수 |
| media/session.ts·storage-supabase.ts·M4 errors매핑·관련서버시험 | Claude(Backend) BE-MEDIA-024 | export/준비도 계약 먼저 공유, Front UI/SQL/package 비수정 |
| media업로드확장·API/media/upload/**·새130000·upload시험/계약 | Claude(Backend) BE-UPLOAD-025 | 확정metadata exports보존, FrontUI/공유설정 비수정. 실제bucket생성금지 |
| app/admin/distribution/media/page.tsx·[assetId]/page.tsx·새 media-* 컴포넌트/media.module.css·tests/distribution-front/media-ui.test.ts | Claude(Front) FE-MEDIA-024 | msg_924bc434fb3c 착수확인. 순수UI 먼저, Backend session계약 후 실연결. upload/preview 미준비 활성금지. 공유action-form은 import만 |
| media/**·120000·media시험 | Claude(Backend) | M4제출검토 후 인계 확정. BE-BASE-023은 run.mjs fixture복구/Front계약문서만 수정 허용. 구현/SQL추가수정은 별도배정 |
| sharp package/lock | Master 조정 | M4에서 고정한 0.35.5 보존, 추가변경은 단일담당 지정 |
| states.tsx ChannelCards 제목링크·console-shell.tsx DistributionDenied 로그인링크 | Codex Design | ds-text-link 수정완료, eslint/typecheck0 보고. 코드 점유 해제, 통합검토 대기. 후속수정은 새 범위공유 |
| globals.css·next.config·package/lock·공통auth | Master 조정 후 단일담당 | 수정목적·의존성·검증 공유 |
| TEAM·현재계획·통합히스토리 | Codex master | 각 담당은 고유results 작성 |

시작보고→점유확인→독립작업→결과→Master통합검토→해제/인계. 사용자 지시를 임의취소하지 않고 충돌구간만 조정. 기존 미커밋 작업 보존, 무관한 전체 덮어쓰기/초기화 금지.
