-- 실제 Supabase 행 단위 RLS 매트릭스 (tests/db/rls-matrix.dbtest.ts 이식 + 트리거·노출 점검).
-- 사용법: Supabase SQL Editor(postgres)에 붙여 실행. 전체가 rollback 되어 DB에 흔적이 남지 않는다.
-- 시드 이메일은 example.invalid(전송 불가 도메인), UUID는 가짜 식별자다.
begin;
insert into auth.users (id, aud, role, email, instance_id) values
  ('00000000-0000-4000-8000-00000000000a','authenticated','authenticated','rls-a@example.invalid','00000000-0000-0000-0000-000000000000'),
  ('00000000-0000-4000-8000-00000000000b','authenticated','authenticated','rls-b@example.invalid','00000000-0000-0000-0000-000000000000'),
  ('00000000-0000-4000-8000-00000000000c','authenticated','authenticated','rls-p@example.invalid','00000000-0000-0000-0000-000000000000'),
  ('00000000-0000-4000-8000-0000000000ad','authenticated','authenticated','rls-adm@example.invalid','00000000-0000-0000-0000-000000000000');
insert into public.profiles (id, display_name, approval_status) values
  ('00000000-0000-4000-8000-00000000000a','tester-a','approved'),('00000000-0000-4000-8000-00000000000b','tester-b','approved'),
  ('00000000-0000-4000-8000-00000000000c','tester-p','pending'),('00000000-0000-4000-8000-0000000000ad','tester-admin','approved')
  on conflict (id) do update set display_name = excluded.display_name, approval_status = excluded.approval_status;
insert into public.role_assignments (user_id, role, granted_by) values ('00000000-0000-4000-8000-0000000000ad','admin','00000000-0000-4000-8000-0000000000ad');
insert into public.projects (id, slug, title, publication_status) values
  ('10000000-0000-4000-8000-000000000001','pub','published project','published'),
  ('10000000-0000-4000-8000-000000000002','draft','draft project','draft');
insert into public.books (id, project_id, slug, title, format, publication_status) values
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','book-pub','b1','print','published'),
  ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','book-draft','b2','print','draft'),
  ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','book-orphan','b3','ebook','published');
insert into public.campaigns (id, book_id, owner_id, channel, external_url, unit_price_krw, opens_at, closes_at, review_status, reservation_ttl) values
  ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-0000000000ad','direct',null,1000,now(),now()+interval '7 days','approved',interval '2 days'),
  ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-0000000000ad','direct',null,1000,now(),now()+interval '7 days','pending_review',null),
  ('30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-0000000000ad','external','https://example.invalid/x',null,null,null,'approved',null),
  ('30000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-0000000000ad','external','https://example.invalid/y',null,null,null,'approved',null);
insert into public.orders (id, campaign_id, user_id, book_format, quantity, unit_price_krw, subtotal_krw, total_krw, idempotency_key, order_status, payment_status, refund_status) values
  ('40000000-0000-4000-8000-00000000000a','30000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-00000000000a','print',1,1000,1000,1000,'key-aaaaaaaaaaaaaaaa','cancellation_requested','verified','requested'),
  ('40000000-0000-4000-8000-00000000000b','30000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-00000000000b','print',1,1000,1000,1000,'key-bbbbbbbbbbbbbbbb','active','reported','none');
insert into public.payment_records (order_id, expected_krw, received_krw, status, reconciliation_ref, verified_by, verified_at) values
  ('40000000-0000-4000-8000-00000000000a',1000,1000,'verified','INTERNAL-REF-A','00000000-0000-4000-8000-0000000000ad',now()),
  ('40000000-0000-4000-8000-00000000000b',1000,null,'reported',null,null,null);
insert into public.refunds (order_id, amount_krw, status, member_reason, internal_note) values
  ('40000000-0000-4000-8000-00000000000a',1000,'requested','member reason','internal ops note');
insert into public.audit_events (actor_id, actor_kind, action, target_type, target_id) values
  ('00000000-0000-4000-8000-0000000000ad','admin','payment.verify','order','40000000-0000-4000-8000-00000000000a');

-- trigger check: every seeded user got a profile
create temp table _r(n int, name text, expect text, got text, pass boolean) on commit drop;
alter table _r enable row level security;

do $do$
declare
  A text := '00000000-0000-4000-8000-00000000000a';
  B text := '00000000-0000-4000-8000-00000000000b';
  P text := '00000000-0000-4000-8000-00000000000c';
  ADM text := '00000000-0000-4000-8000-0000000000ad';
  t record; got text; rc bigint; i int := 0;
begin
  for t in select * from (values
    -- (role, sub, name, mode, sql, expect)   mode: ids | count | val | ok | denied
    ('anon','', 'anon projects = pub only','ids','select id from public.projects','10000000-0000-4000-8000-000000000001'),
    ('anon','', 'anon books = pub only','ids','select id from public.books','20000000-0000-4000-8000-000000000001'),
    ('anon','', 'anon campaigns = pub only','ids','select id from public.campaigns','30000000-0000-4000-8000-000000000001'),
    ('authenticated','A','member campaigns = pub only','ids','select id from public.campaigns','30000000-0000-4000-8000-000000000001'),
    ('anon','', 'anon public campaign cols','ok','select id, unit_price_krw, per_user_limit, payment_deadline_at, goal_basis from public.campaigns',''),
    ('anon','', 'anon owner_id denied','denied','select owner_id from public.campaigns',''),
    ('anon','', 'anon reservation_ttl denied','denied','select reservation_ttl from public.campaigns',''),
    ('anon','', 'anon campaigns * denied','denied','select * from public.campaigns',''),
    ('authenticated','A','member owner_id denied','denied','select owner_id from public.campaigns',''),
    ('anon','', 'anon update project denied','denied','update public.projects set title = ''x'' where id = ''10000000-0000-4000-8000-000000000001''',''),
    ('authenticated','A','member delete book denied','denied','delete from public.books where id = ''20000000-0000-4000-8000-000000000001''',''),
    ('anon','', 'anon profiles denied','denied','select 1 from public.profiles',''),
    ('anon','', 'anon role_assignments denied','denied','select 1 from public.role_assignments',''),
    ('anon','', 'anon orders denied','denied','select 1 from public.orders',''),
    ('anon','', 'anon payment_records denied','denied','select 1 from public.payment_records',''),
    ('anon','', 'anon refunds denied','denied','select 1 from public.refunds',''),
    ('anon','', 'anon audit_events denied','denied','select 1 from public.audit_events',''),
    ('anon','', 'anon auth.users denied','denied','select 1 from auth.users',''),
    ('authenticated','A','A sees own profile only','ids','select id from public.profiles','00000000-0000-4000-8000-00000000000a'),
    ('authenticated','P','P sees own pending','val','select id::text||'':''||approval_status from public.profiles','00000000-0000-4000-8000-00000000000c:pending'),
    ('authenticated','A','approval_changed_by denied','denied','select approval_changed_by from public.profiles',''),
    ('authenticated','A','A rename own = 1 row','count','update public.profiles set display_name = ''renamed'' where id = ''00000000-0000-4000-8000-00000000000a'' returning id','1'),
    ('authenticated','A','A rename B = 0 rows','count','update public.profiles set display_name = ''hijack'' where id = ''00000000-0000-4000-8000-00000000000b'' returning id','0'),
    ('authenticated','P','P self-approve denied','denied','update public.profiles set approval_status = ''approved'' where id = ''00000000-0000-4000-8000-00000000000c''',''),
    ('authenticated','A','profile delete denied','denied','delete from public.profiles where id = ''00000000-0000-4000-8000-00000000000a''',''),
    ('authenticated','A','profile insert denied','denied','insert into public.profiles (id) values (''00000000-0000-4000-8000-00000000000a'')',''),
    ('authenticated','A','self grant admin denied','denied','insert into public.role_assignments (user_id, role) values (''00000000-0000-4000-8000-00000000000a'', ''admin'')',''),
    ('authenticated','ADM','ADM sees own role','val','select user_id::text||'':''||role from public.role_assignments','00000000-0000-4000-8000-0000000000ad:admin'),
    ('authenticated','A','A sees no roles','count','select user_id from public.role_assignments','0'),
    ('authenticated','ADM','granted_by denied','denied','select granted_by from public.role_assignments',''),
    ('authenticated','A','is_admin(A)=false','val','select private.is_admin()::text','false'),
    ('authenticated','ADM','is_admin(ADM)=true','val','select private.is_admin()::text','true'),
    ('authenticated','P','is_approved_member(P)=false','val','select private.is_approved_member()::text','false'),
    ('authenticated','A','is_approved_member(A)=true','val','select private.is_approved_member()::text','true'),
    ('authenticated','A','A orders = own','ids','select id from (select id, user_id, order_status, payment_status, total_krw from public.orders) q','40000000-0000-4000-8000-00000000000a'),
    ('authenticated','B','B cannot see order A','count','select id from public.orders where id = ''40000000-0000-4000-8000-00000000000a''','0'),
    ('authenticated','P','P sees no orders','count','select id from public.orders','0'),
    ('authenticated','A','inventory_released_at denied','denied','select inventory_released_at from public.orders',''),
    ('authenticated','A','orders * denied','denied','select * from public.orders',''),
    ('authenticated','A','A payments = own','ids','select order_id from (select id, order_id, expected_krw, received_krw, status, verified_at from public.payment_records) q','40000000-0000-4000-8000-00000000000a'),
    ('authenticated','B','B cannot see payment A','count','select id from public.payment_records where order_id = ''40000000-0000-4000-8000-00000000000a''','0'),
    ('authenticated','A','reconciliation_ref denied','denied','select reconciliation_ref from public.payment_records',''),
    ('authenticated','A','verified_by denied','denied','select verified_by from public.payment_records',''),
    ('authenticated','A','A refunds = own','ids','select order_id from (select id, order_id, amount_krw, status, member_reason from public.refunds) q','40000000-0000-4000-8000-00000000000a'),
    ('authenticated','B','B sees no refunds','count','select id from public.refunds','0'),
    ('authenticated','A','internal_note denied','denied','select internal_note from public.refunds',''),
    ('authenticated','A','payout_ref denied','denied','select payout_ref from public.refunds',''),
    ('authenticated','A','processed_by denied','denied','select processed_by from public.refunds',''),
    ('authenticated','ADM','ADM orders = 2','count','select id from public.orders','2'),
    ('authenticated','ADM','ADM campaigns = 4','count','select id from public.campaigns','4'),
    ('authenticated','ADM','ADM profiles = 4','count','select id from public.profiles','4'),
    ('authenticated','ADM','ADM reconciliation_ref denied','denied','select reconciliation_ref from public.payment_records',''),
    ('authenticated','ADM','ADM internal_note denied','denied','select internal_note from public.refunds',''),
    ('authenticated','ADM','ADM audit_events denied','denied','select 1 from public.audit_events',''),
    ('service_role','', 'service_role internal col = 1','count','select reconciliation_ref from public.payment_records where reconciliation_ref is not null','1')
  ) v(r, who, name, mode, s, e)
  union all
  select r2, who2, name2, 'denied', s2, '' from (values
    ('insert into public.orders (campaign_id, user_id, book_format, quantity, unit_price_krw, subtotal_krw, total_krw, idempotency_key) values (''30000000-0000-4000-8000-000000000001'', ''00000000-0000-4000-8000-00000000000a'', ''print'', 1, 0, 0, 0, ''key-cccccccccccccccc'')'),
    ('update public.orders set payment_status = ''verified'' where id = ''40000000-0000-4000-8000-00000000000a'''),
    ('update public.orders set total_krw = 0 where id = ''40000000-0000-4000-8000-00000000000a'''),
    ('delete from public.orders where id = ''40000000-0000-4000-8000-00000000000a'''),
    ('insert into public.payment_records (order_id, expected_krw, status) values (''40000000-0000-4000-8000-00000000000a'', 1000, ''reported'')'),
    ('update public.payment_records set status = ''verified'' where order_id = ''40000000-0000-4000-8000-00000000000a'''),
    ('insert into public.refunds (order_id, amount_krw) values (''40000000-0000-4000-8000-00000000000a'', 1000)'),
    ('update public.refunds set status = ''completed'' where order_id = ''40000000-0000-4000-8000-00000000000a'''),
    ('insert into public.audit_events (actor_kind, action, target_type, target_id) values (''member'', ''x'', ''x'', ''x'')')
  ) w(s2)
  cross join (values ('authenticated','A','write denied A: '),('authenticated','ADM','write denied ADM: ')) who(r2, who2, name2)
  loop
    i := i + 1;
    begin
      perform set_config('request.jwt.claim.sub', case t.who when 'A' then A when 'B' then B when 'P' then P when 'ADM' then ADM else '' end, true);
      perform set_config('request.jwt.claims', case when t.who = '' then '{"role":"'||t.r||'"}' else json_build_object('sub', case t.who when 'A' then A when 'B' then B when 'P' then P else ADM end, 'role', t.r)::text end, true);
      execute format('set local role %I', t.r);
      if t.mode = 'ids' then
        execute format('select coalesce(string_agg(x::text, %L order by x::text), '''') from (%s) q(x)', ',', t.s) into got;
      elsif t.mode = 'val' then
        execute t.s into got;
      elsif t.mode = 'count' then
        execute t.s; get diagnostics rc = row_count; got := rc::text;
      else
        execute t.s; got := 'ok';
      end if;
    exception when others then
      got := 'denied:' || sqlstate;
    end;
    reset role;
    insert into _r values (i,
      case when t.name like 'write denied%' then t.name || left(t.s, 40) else t.name end,
      case t.mode when 'denied' then 'denied:42501' when 'ok' then 'ok' else t.e end,
      got,
      got = case t.mode when 'denied' then 'denied:42501' when 'ok' then 'ok' else t.e end);
  end loop;
end $do$;

insert into _r select 900, 'no public definer funcs', '0', (select count(*)::text from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef), (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef)=0;
insert into _r select 901, 'anon no usage on private', 'false', has_schema_privilege('anon','private','USAGE')::text, not has_schema_privilege('anon','private','USAGE');
insert into auth.users (id, aud, role, email, instance_id) values ('00000000-0000-4000-8000-0000000000ee','authenticated','authenticated','rls-new@example.invalid','00000000-0000-0000-0000-000000000000');
insert into _r select 902, 'signup trigger -> pending profile', 'pending', (select approval_status from public.profiles where id='00000000-0000-4000-8000-0000000000ee'), (select approval_status from public.profiles where id='00000000-0000-4000-8000-0000000000ee')='pending';
insert into _r select 903, 'trigger fn not executable by clients', 'false', (has_function_privilege('anon','private.handle_new_user()','EXECUTE') or has_function_privilege('authenticated','private.handle_new_user()','EXECUTE'))::text, not (has_function_privilege('anon','private.handle_new_user()','EXECUTE') or has_function_privilege('authenticated','private.handle_new_user()','EXECUTE'));
select (select count(*) from _r where pass) || ' pass / ' || (select count(*) from _r) || ' total' as summary,
       coalesce((select string_agg(n||') '||name||' => expect '||expect||' / got '||coalesce(got,'NULL'), ' ;; ' order by n) from _r where not pass or pass is null), 'none') as failures;
rollback;
