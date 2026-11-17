-- OPS-READY-033: 선택한 Supabase 프로젝트에서 권한 있는 운영자가 실행하는 읽기전용 점검.
-- 이 파일은 앱 migration이 아니다. 생성/변경/삭제 및 사용자 데이터 조회 없음.
-- 결과에는 migration 버전, 객체 이름, bucket 설정과 함수 ACL만 포함한다.
begin transaction read only;

-- 이전 SQL Editor 수동 적용은 이력에 없을 수 있다. 파일 존재/버전만으로 적용 완료 판정 금지.
-- 이 테이블이 없는 환경에서는 전체 트랜잭션이 실패한다. 환경을 확인하고 나머지 SELECT만 별도 실행한다.
select version
from supabase_migrations.schema_migrations
where version >= '20261116000000' and version <= '20261116140000'
order by version;

select name, to_regclass('public.' || name) is not null as present
from (values
  ('distribution_media_assets'),
  ('distribution_media_variants'),
  ('distribution_media_upload_grants')
) as expected(name);

-- 정식 시그니처/인자/서비스 실행 권한과 사용자 역할 차단을 함께 대조한다.
select p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'distribution_expire_media_upload_grants',
    'distribution_recover_stalled_media_uploads'
  )
order by p.proname, arguments;

-- 0행이면 bucket 미구성이다. 객체 경로/바이트/서명 URL은 조회하지 않는다.
select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id in ('distribution-media', 'distribution-media-intake')
order by id;

-- 정책 존재 목록만 확인한다. 실제 익명/타 사용자 접근 거부는 별도 HTTP 시험이 필요하다.
select policyname, cmd, roles
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by policyname;

rollback;
