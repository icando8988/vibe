# OPS-READY-024 — 미디어 운영 반영 준비

2026-11-17 · 책임 CX-MASTER-01 · 상태: 준비 문서 작성, 실제 환경 확인 전.
입력: 현재 `src/server/distribution/media/{session,policy,storage-supabase,recovery}.ts`, 업로드 API, 120000~140000 SQL, MEDIA_UPLOAD_CONTRACT 및 026/029/031 결과.

현재 HEAD는 `8f0691c`이며 미디어 후속 변경은 미커밋이다. 이 문서는 배포 묶음 확정이나 SQL 적용 증거가 아니다. Backend 030과 Front 032 결과를 인수한 뒤 release SHA를 기록한다. 기존 파일과 다른 담당의 변경은 보존한다.

## 반영 대상과 선행 조건

| 범위 | 파일/조건 | 현재 확인 |
|---|---|---|
| 기반 DB | `20261116000000`~`20261116110000` 총 12개 migration | 로컬 파일 존재, 실제 DB 이력 미조회 |
| 미디어 자산/권리 | `20261116120000_distribution_media_assets.sql` | 실제 DB 적용 미확인 |
| 직접 업로드 grant | `20261116130000_distribution_media_upload_grants.sql` | 실제 DB 적용 미확인 |
| 소비 후 고착 복구 | `20261116140000_distribution_media_upload_stall_recovery.sql` | Backend 030 로컬 인수, 실제 DB 적용·동시성 검증 전 |
| 앱 | metadata 화면/액션, upload API, media 서버/시험 | 후속 미커밋 변경 포함, 업로드 UI 비활성 |
| 호출 주체 | 만료 정리/고착 복구/sweep | 운영 주체·주기 미정, 자동 실행 없음 |

SQL Editor에서 수동 적용한 이력이 있을 수 있으므로 migration 이력 부재만으로 전체 파일을 다시 실행하지 않는다. 실제 객체·함수·제약과 migration 이력을 대조해 누락분만 확정한다. 기존 적용 SQL 수정이나 제약 완화로 차이를 덮지 않는다.

## 환경 확인 순서

1. 대상 Supabase 프로젝트와 Vercel 프로젝트·환경을 먼저 식별한다. 운영판과 시험 환경을 구분하고 같은 Supabase origin을 사용하는지 확인한다. 이름/설정 유무만 결과에 남긴다.
2. 실제 DB의 migration 이력과 아래 읽기 전용 점검으로 객체/권한을 대조한다. 비밀값·사용자 원문·nonce·토큰은 조회하지 않는다.
3. 적용할 SQL 목록·검토된 release SHA·백업 또는 복구 지점·실행 담당을 확정한다. 기존 고아 참조가 있으면 별도 목록/정리 방안을 검토하고 자동 삭제하지 않는다.
4. 확정한 대상 환경에서 누락 migration을 순서대로 적용한다. 앱이 새 함수를 호출하기 전에 DB 준비를 확인한다. 실패하면 다음 단계로 진행하지 않는다.
5. private bucket 설정과 서버 환경변수를 확인한 뒤 승인 admin 실세션 시험을 수행한다. 설정 유무나 `directUpload=true`만으로 Storage 검증 완료로 표시하지 않는다.

환경변수: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, 서버 전용 `SUPABASE_SECRET_KEY`. 서버 factory는 현재 `sb_secret_…` 형식을 수락하며 legacy JWT 키는 수락하지 않는다. 사이트 주소는 현재 앱 계약의 `NEXT_PUBLIC_SITE_URL`을 대조한다. 실제 값은 이 문서나 결과에 기록하지 않는다.

## 읽기 전용 DB·Storage 대조 예시

아래 쿼리는 아직 실행하지 않았다. 대상 프로젝트를 확인한 뒤 관리자 SQL 환경에서 읽기 용도로 사용한다. 이력 스키마가 없으면 그 오류와 수동 적용 여부를 기록한다.

```sql
select version from supabase_migrations.schema_migrations order by version;

select table_name, row_security
from (
  select c.relname as table_name, c.relrowsecurity as row_security
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('distribution_media_assets', 'distribution_media_variants',
                     'distribution_media_upload_grants')
) checked order by table_name;

select p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as security_definer, p.proconfig,
       pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') as service_execute
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'distribution_%media%'
order by p.proname, args;

select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id in ('distribution-media-intake', 'distribution-media');

select policyname, roles, cmd, qual, with_check
from pg_catalog.pg_policies
where schemaname = 'storage' and tablename = 'objects';
```

정책은 두 bucket에 적용되는 조건을 확인한다. 기존의 다른 용도 정책은 삭제하지 않는다.

| bucket | public | file_size_limit | allowed_mime_types |
|---|---|---|---|
| `distribution-media-intake` | false | 20971520 | image/jpeg, image/png, image/webp |
| `distribution-media` | false | 8388608 | image/jpeg |

기존의 넓은 범위 정책을 포함해 anon/authenticated의 직접 접근을 허용하지 않는지 확인한다. 원본은 intake, 정제 JPEG는 변형 bucket에 저장하는 현재 코드 경계를 유지한다.

## 실세션 시험과 기록

- 승인 admin의 목록/상세 조회·권리 결정·보관을 검증한다. 비관리자 거부, 버전 충돌, 사용 중 자산 보관 거부, 오류와 0건 구분도 확인한다.
- 시험용 정지 PNG 한 건으로 `POST /api/distribution/media/upload/grant` → 반환 URL에 지정 headers/raw PUT → `complete`를 1회 수행한다. URL·nonce·서명 token은 로그/스크린샷/결과에 남기지 않는다. 실제 CORS·전송 형식·응답을 확인하고 계약의 미검증 전제를 갱신한다.
- `ready`·권리 승인·게시 가능은 각각 확인한다. nonce 재사용/다른 actor/버전 불일치/중복 complete, 취소·만료 후 complete 거부를 시험한다. `uncertain`은 새로고침으로 확인하며 자동 재전송하지 않는다.
- grant 앱 기한과 Storage 서명 기한은 다르다. 취소/만료 후에도 원본이 도착할 수 있으므로 삭제 성공·정리 완료를 보장하지 않는다. 원본 삭제 시도와 고아 정리 미구현을 결과에 구분한다.
- 030 복구는 최종 인수 후 승인된 수동 시험부터 한다. 현재 구현의 런타임 시간 제한 전제를 검증하고, 강제 종료 보장이 없는 환경에서는 실행하지 않는다. SQL RPC 직접 호출은 앱의 비활성 판정을 우회하므로 같은 전제를 실행 담당이 확인해야 한다. 단일 연결 PGlite 결과는 실제 동시성 증거로 쓰지 않는다.
- 브라우저 320/700/960px, 키보드/초점/오류 안내, 충돌 시 입력 보존·최신 상태 새 탭 왕복을 확인한다. 업로드 UI 활성화는 계약·실Storage 시험과 별도 코드 검토 후 진행한다.

결과 필수 항목: 환경 식별(비밀 제외), release SHA/배포 ID, DB 적용 버전, bucket 대조 결과, 시험별 실제/모의 구분, pass/fail/미실행, 남은 결함과 복구 지점. 외부 채널 게시 gate는 기존 관문을 따른다.

## 실패 시 대응

DB 일부 적용 실패 시 적용 이력/객체 상태를 읽고 누락분을 다시 계획한다. 자동 down migration·테이블 삭제·스토리지 일괄 삭제는 하지 않는다. 앱 문제는 확인된 이전 배포로 되돌릴 수 있으나 forward DB 변경은 그대로 남으므로 이전 앱과의 호환성을 확인한다. 응답 유실 시 자산/작업 상태부터 조회하며 같은 publish/complete를 자동 재실행하지 않는다. 고아 원본/변형은 후속 sweep 설계 대상으로 남긴다.
