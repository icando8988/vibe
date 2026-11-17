# BE-UPLOAD-RECOVERY-030 — 소비 후 고착 복구 설계 및 forward migration (결과)

담당: CC-BACKEND-01 Claude(Backend) / term_0dacb0de-23ca-43f4-a7d2-7bf514a82ae8
지시: CX-MASTER-01 (dispatch ctx_f3d695e6c6c7, msg_ffa5d18317d2 · 검토 msg_ddc02bbb526e · 회수 msg_1fe7b86901cd)
상태: **ready_review** (통합 수락·운영 완료 아님). 착수·설계 보고: msg_3504a37087ce.
커밋·실제 DB 적용·Storage/bucket·Cron·배포·외부 게시 없음. Front 점유 파일·공유 설정(package/lock/config/auth) 수정 없음.

## 1. 수정 파일
| 파일 | 구분 | 내용 |
|---|---|---|
| `supabase/migrations/20261116140000_distribution_media_upload_stall_recovery.sql` | 신규 | 복구 RPC + consumed 부분 인덱스. 120000/130000 무수정 |
| `src/server/distribution/media/recovery.ts` | 신규 | 시스템 래퍼 `recoverStalledUploads`, `runtimeEnforcesMaxDuration(env)`, `STALL_POLICY`. 호출 주체 없음 |
| `src/server/distribution/media/upload.ts` | 수정 | 원본 삭제를 **실패 기록 확인 시에만**(DECLARED_MISMATCH·M4 failed). `asset:null`이면 보존 |
| `tests/distribution-server/media-upload-recovery.pglite.test.ts` | 신규 | PGlite 8건 |
| `tests/distribution-server/media-upload.test.ts` | 수정 | 단위 1건(실패 기록 거부 → 원본 미삭제) |
| `tests/distribution-server/media.pglite.test.ts` | 수정 | `%media%` RPC ACL 목록에 신규 RPC 1개 추가(같은 service_role 전용 단언 유지 — 완화 아님) |
| `tests/distribution-server/media-upload.pglite.test.ts` | 수정 | RESUME-026 재현 시험 주석만(140000 안내) |
| `scripts/distribution-local-verify/upload-run.mjs` | 수정 | 140000 시험 파일이 있으면 함께 실행 |
| `handoff/workspace/docs/contracts/MEDIA_UPLOAD_CONTRACT.md` | 수정 | §3.2 `asset:null` 원본 보존·`UPLOAD_STALLED` 표시, §5.1-2 해결 표시, **§7 복구 계약 신설** |

## 2. 설계 (복구 계약 정본: 계약 문서 §7)
- RPC `distribution_recover_stalled_media_uploads(p_limit 1..500, p_stall_seconds 600..86400) returns integer`. service_role 전용 SECURITY DEFINER, `search_path=''`, 범위 밖 `22023`.
- 전이: 자산 `pending_upload|processing` → `failed('UPLOAD_STALLED')`, `row_version+1`. grant `consumed` 유지. Storage 삭제 없음.
- 대상: grant consumed ∧ consumed_at ≤ now−stall ∧ **asset.updated_at ≤ now−stall** ∧ owner=grant.actor ∧ 미보관 ∧ pending_upload|processing.
- 잠금 순서: 자산 행만 `FOR UPDATE OF a SKIP LOCKED`(대기 없음). consumed grant는 종단 상태(130000 가드가 변경 거부)라 잠그지 않음. 정상 흐름은 grant→asset 순서로 잠그지만 복구는 grant를 잠그지 않고 asset은 skip locked라 **교착 경로 없음**. 갱신은 `id ∧ row_version=잠근 값 ∧ 상태` 이중 조건.
- **정상 처리 보호 전제**: ① 완료 라우트 `maxDuration=60`(sharp 10초)이 플랫폼에서 강제될 때만 하한 600초(10배)가 성립 — 권장 900초. ② 진행 중 processing은 mark_received가 갱신한 `updated_at`으로 제외. ③ 모든 정상 전이(mark_received/complete/fail)는 expected row_version + FOR UPDATE라 순서와 무관하게 덮어쓰기 불가.
- **runtime 미강제 시 비활성**: 래퍼는 `runtimeEnforcesMaxDuration=true`일 때만 RPC 호출, 아니면 `disabled`(RPC 0회). 헬퍼는 `VERCEL === "1"`만 true. 자가 호스팅(`next start` 등)은 자동 호출 비활성 — 문서화(계약 §7, migration 머리 주석).
- 경합 결과: 복구 먼저 → 늦은 complete = `VERSION_CONFLICT` → 응답 `uncertain`, 변형 행 0, ready 아님, 원본 보존 / 늦은 fail = `failed asset:null`, **원본 보존**(이번 수정 전에는 삭제됐음 — 이미 failed 자산이라 데이터 손상은 아니었으나 삭제 오판 소지를 제거). 정상 먼저 → 복구 0건, 상태·버전 불변.

## 3. 검증 (Node 24.22.3, PGlite 0.5.16, `PGLITE_PROJECT=%TEMP%\vibe-resume-20261117`)
| 명령 | exit | 결과 |
|---|---|---|
| `node scripts/distribution-local-verify/run.mjs --pglite-project <tools>` (전체 migration 000000~140000 적용 + M1 회귀) | 0 | 224/224 |
| `node scripts/distribution-local-verify/m2-run.mjs --pglite-project <tools>` (전체 migration + M2) | 0 | 334/334 |
| `node scripts/distribution-local-verify/upload-run.mjs --pglite-project <tools>` | 0 | 19/19 (130000 11 + 140000 8) |
| `npx vitest run tests/distribution-server` | 0 | 25파일 381 통과 |
| `npm test` (PGLITE_PROJECT 설정) ×2 연속 | 0 / 0 | **38파일 657 통과, 실패·skip 0** |
| `npm run lint` | 0 | 오류 0, 기존 경고 3 |
| `npm run typecheck` | 0 | 성공 |
| `npm run build` | 0 | 성공 |

PGlite 8건: ACL·인자 범위 / pending 고착 복구·기준 전 비대상·버전+1·grant 유지·멱등 / 비대상(ready·failed·archived·issued·grant 없음·진행 중 processing) 및 이후 기준 경과 시 복구 / 순서 A 늦은 complete / 순서 A 늦은 fail(TOO_SMALL·DECLARED_MISMATCH) 원본 보존 / 순서 B 정상 먼저 / 대기 상한 20 회복(limit 7 분할 → 7,7,6,0) / 래퍼 disabled·인자·호출.

**정직한 기록**
- 중간 실행에서 두 건이 관찰됐다. ① 대기 상한 시험이 전체 병렬 부하에서 기본 5초 시간 제한을 넘었다(단독 0.4초). 단언은 바꾸지 않고 이미지 1회 생성 + 시험별 60초 제한으로 고친 뒤 2회 연속 통과했다. ② 한 번은 Front 범위 `tests/distribution-front/media-ui.test.ts` D028-03이 실패했다. Front가 진행 중인 미커밋 변경 때문으로 보이며, 내가 손대지 않았는데 이후 실행에서 통과했다.
- "순서 A/B"는 단일 연결 PGlite에서 호출 사이에 복구를 끼워 넣은 **순서 재현**이다. 실제 다중 연결 동시성(SKIP LOCKED 동작 포함)은 검증하지 않았다.
- 시간 경과는 일회성 DB에서 가드를 잠시 끄고 타임스탬프를 옮겨 모사했다.
- 실/대역: DB=PGlite 대역, Storage=메모리 mock, sharp=실제. 실제 Supabase·Storage 미검증.
- 657 = RESUME-026 시점 631 + 이번 작업 9(단위 1 + PGlite 8) + 나머지 17(Front 미커밋 시험 변경분, 내 범위 아님). 기존 시험 삭제·skip 추가 없음.

## 4. 남은 공백
1. 호출 주체 없음(Vercel Cron 등). 실행 환경이 maxDuration을 강제하는지 운영에서 확인한 뒤 연결해야 한다. 자가 호스팅이면 비활성 유지 또는 lease/heartbeat 설계(별도)가 필요하다.
2. 만료 정리 `distribution_expire_media_upload_grants`의 호출 주체도 없음.
3. Storage sweep 미구현: 복구로 닫힌 자산의 intake 원본, 순서 A에서 남는 기록 없는 변형 객체, 토큰 미철회 후 업로드분, 삭제 실패분.
4. grant 없는 자산(서버 직접 바이트 경로 `createAndProcessFromBytes`)이 고착되는 경우는 이번 대상 밖이다(화면 미사용 경로).
5. 실제 Storage 전제 6건(RESUME-026 §4-1)은 그대로 미검증.

## 5. Front 영향
공개 API·DTO·HTTP 계약 변경 없음. 변경점은 두 가지다. ① complete `failed` + `asset:null`이면 원본을 보존한다(화면 동작은 같고 목록에서 확인). ② 목록 `failureCode`에 `UPLOAD_STALLED`가 나올 수 있다. 표시 권장 문구는 "처리가 끝나지 않아 닫힘 — 새로 올리기"이며, Front 라벨 반영은 Front 담당이 맡는다.

## 6. hash
- 내 수정 5개 기존 파일 `git diff` sha256: `eca571daca944e00881ec032886dd43fb4ae002ef82278d5756d4281cab3b057`
- 140000 migration `70c909b0c3f431ecd046953abfbbce74e29e97a56efe250378976f620c763077`
- recovery.ts `570cbc8b532d52f14993255bcf8c9f7c5bf86e9ec1d80d698e1b4d6972e0850a`
- upload.ts `2843b49988aa4ea5b220a200f1d909e71852be5f85d2d19946b19a3a9f1d4f6b`
- media-upload-recovery.pglite.test.ts `db045eaa8878ad893a73fd035e2efc5c0655e8c6dfd2ed42d3a781479a6ed11f`
- media-upload.test.ts `240cdd0d2cbed3aeb1cbf64c37f54e5a3bf6dbb2f0fe7a5743d3c5c6b828fbd5`
- media-upload.pglite.test.ts `561c0965689d75575ad955d8168ac71146f2642b35d6b0b5c85cf29ec85f0e51`
- media.pglite.test.ts `6a380afbd519f736011c3703cf860de63fac67fd8d14e8a7d2562e12749c3a41`
- upload-run.mjs `3542540ee101537e9c6c6da5df85d5263920ed29d18c4f8a5b258f0e2e7dff55`
- MEDIA_UPLOAD_CONTRACT.md `c7c29851531320191cbf7d50b122de000d17b08a4dd46ffc9e12ab8bcb837a3c`
