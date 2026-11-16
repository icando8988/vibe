-- ============================================================================
-- 가입 시 프로필(승인 대기) 자동 생성 — DEV-004
-- 2026-11-16 · CC-ENG-01
-- auth.users 에 행이 생기면 public.profiles(id, approval_status='pending')를 만든다.
-- * 함수는 API 비노출 스키마(private), security definer, search_path='' 고정.
-- * 이메일 등 auth 원본은 복제하지 않는다(display_name 도 비워 둔다).
-- * 승인 상태는 항상 pending 으로 시작한다. 클라이언트가 보낸 메타데이터를 신뢰하지 않는다.
-- * POLICY-PENDING(DEC-005): 사전승인 유지 여부. 바뀌면 이 기본값만 조정한다.
-- ============================================================================

create schema if not exists private;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, approval_status)
  values (new.id, 'pending')
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();
