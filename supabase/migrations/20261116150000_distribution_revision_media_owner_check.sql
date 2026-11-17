-- ============================================================================
-- 통합 배포 — 리비전 미디어 소유권·중복·잠금 재검사(forward only)
-- BE-REVISION-MEDIA-037 · 2026-11-17 · CC-BACKEND-01 Claude(Backend)
-- 상태: 로컬 PGlite 대역(revision-media.pglite.test.ts)으로만 검증. 실제 Supabase 미적용.
-- 의존: 030000(distribution_draft_revision_media·distribution_draft_revisions.created_by), 050000(append — p_actor_id를 created_by로 기록),
--       120000(distribution_media_assets·variants, distribution_revision_media_asset_check). 기존 객체는 바꾸지 않는다.
--
-- 문제(PGlite 재현): 120000 트리거는 자산 존재·미보관·ready·변형 소속만 보고 잠금 없이 읽는다.
--   ① 다른 관리자 소유 자산도 첨부된다. ② 같은 리비전에 같은 자산이 중복된다. ③ 검사와 보관 사이 경합 보호가 없다.
--
-- 새 BEFORE INSERT 트리거 distribution_revision_media_owner_check(이름 순서상 120000 asset_check 뒤에 실행)
--   1) 자산 행을 FOR SHARE로 잠근 뒤(보관·상태 전이의 FOR UPDATE와 직렬화) **잠근 최신 행으로** 다시 검사:
--      존재·미보관·ready(MEDIA_NOT_READY), variant_id가 있으면 그 자산 소속(VARIANT_MISMATCH).
--      → 보관이 먼저 커밋되면 첨부 거부, 첨부가 먼저 커밋되면 보관이 ASSET_REFERENCED(120000)로 거부.
--   2) 소유: asset.owner_id = 리비전 created_by(= append의 p_actor_id) 이거나,
--      같은 draft의 직전 리비전(revision_no - 1)에 같은 asset_id·variant_id로 이미 첨부돼 있으면 허용(본문만 수정 시 이어받기).
--      그 밖은 MEDIA_NOT_OWNED. alt_text·position 변경은 판정에 쓰지 않는다.
--   3) 같은 revision_id에 같은 asset_id가 이미 들어갔으면 MEDIA_DUPLICATE
--      (BEFORE ROW 트리거의 VOLATILE 질의는 같은 INSERT 문에서 먼저 들어간 행을 본다).
-- 권리 상태는 검사하지 않는다(첨부 허용, 게시 직전 서명 단계에서 권리·채널·기한 검사 — 기존 정책).
-- 기존 행 삭제·제약 완화 없음. 리비전 쪽 잠금(원문 FOR SHARE → 초안 FOR UPDATE)은 050000 그대로.
-- 오류: 모두 check_violation(23514), 메시지 앞 토큰.
-- ============================================================================

create or replace function public.distribution_revision_media_owner_check()
returns trigger
language plpgsql
volatile
set search_path = ''
as $$
declare
  r record;
  a public.distribution_media_assets%rowtype;
begin
  select x.draft_id, x.revision_no, x.created_by into r
    from public.distribution_draft_revisions x where x.id = new.revision_id;
  if not found then
    raise exception 'distribution revision % not found', new.revision_id using errcode = 'foreign_key_violation';
  end if;

  select * into a from public.distribution_media_assets x where x.id = new.asset_id for share;
  if not found or a.archived_at is not null or a.status <> 'ready' then
    raise exception 'MEDIA_NOT_READY: revision media must reference a ready, active asset' using errcode = 'check_violation';
  end if;
  if new.variant_id is not null and not exists (
    select 1 from public.distribution_media_variants v where v.id = new.variant_id and v.asset_id = a.id
  ) then
    raise exception 'VARIANT_MISMATCH: variant does not belong to the asset' using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from public.distribution_draft_revision_media m
     where m.revision_id = new.revision_id and m.asset_id = new.asset_id
  ) then
    raise exception 'MEDIA_DUPLICATE: an asset can be attached once per revision' using errcode = 'check_violation';
  end if;

  if a.owner_id is distinct from r.created_by and not exists (
    select 1
      from public.distribution_draft_revisions p
      join public.distribution_draft_revision_media pm on pm.revision_id = p.id
     where p.draft_id = r.draft_id and p.revision_no = r.revision_no - 1
       and pm.asset_id = new.asset_id and pm.variant_id is not distinct from new.variant_id
  ) then
    raise exception 'MEDIA_NOT_OWNED: only your own media assets can be newly attached' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger distribution_revision_media_owner_check before insert on public.distribution_draft_revision_media
  for each row execute function public.distribution_revision_media_owner_check();

revoke all on function public.distribution_revision_media_owner_check() from public, anon, authenticated, service_role;
