-- 加固（2026-11-27）：评估正式版时查出来的几处，在 20261126c_m2_complete.sql 之后整段运行一次。
-- 只改函数、加字段、加表，不删数据；0.1.0 的客户端照旧能用（认领要的同意变多了，老客户端点了"同意"会显示还在等）。
--
-- 1. 认领"我是谁"不再只凭邀请码：
--    - 被认领的人自己别的电脑点"是我"，直接生效；
--    - 否则组里除了他以外的人都同意才算（和新人加入一样）；
--    - 组里只有他一个人时：他的电脑 7 天里有动静，就得那台点"是我"；7 天都没动静（电脑丢了）才凭邀请码直接生效。
--    - 新客户端每台电脑在本机留一把"认领钥匙"（服务器只存哈希）：登录丢了换了身份，凭它直接认回自己。
-- 2. 容量：全站每小时最多建 30 个组；没人在看时不收远程看它的小图；出发时带的状态、理由限长；
--    每小时清一次过期的试码记录、旧小图、旧投票。
-- 3. 请人离开的投票不再走实时推送（删除事件不受读权限限制，被请的人能看到是谁投的票）。
-- 4. 名字里的看不见的字符（零宽、左右反转）去掉，去掉以后也不能和组里别人重名。
-- 5. 认领别人被拒（或者还在等）以后，再点"第一次来，加入"能正常申请（以前会被当成那个人）。
-- 整段可以重复运行。

-- ---------- 表和字段 ----------
alter table public.devices add column if not exists recovery_hash text;   -- 这台电脑本机认领钥匙的哈希

-- 别人对"新电脑说自己是某某"的同意票：除了被认领的人，其他人都同意才算
create table if not exists public.device_votes (
  user_id uuid not null,
  member_id uuid not null references public.members(id) on delete cascade,
  voter uuid not null references public.members(id) on delete cascade,
  at timestamptz not null default now(),
  primary key (user_id, member_id, voter)
);
alter table public.device_votes enable row level security;
revoke all on public.device_votes from anon, authenticated;   -- 客户端不读这张表

-- 每小时打扫一次：只有一行，记上次打扫的时间
create table if not exists public.housekeeping (
  id int primary key default 1 check (id = 1),
  at timestamptz not null default now()
);
alter table public.housekeeping enable row level security;
revoke all on public.housekeeping from anon, authenticated;

create index if not exists pets_created on public.pets(created_at);
create index if not exists snapshots_at on public.snapshots(at);
create index if not exists join_attempts_at on public.join_attempts(at);

-- ---------- 小工具 ----------
create or replace function public.recovery_hash(p_secret text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(convert_to('desktop-pet-recovery:' || p_secret, 'UTF8'), 'sha256'), 'hex')
$$;

-- 打扫：过期的试码记录、一小时前的小图、三天前的认领同意票。每小时最多真正跑一次
create or replace function public.housekeep()
returns void language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  insert into public.housekeeping(id, at) values (1, now() - interval '2 hours') on conflict (id) do nothing;
  update public.housekeeping set at = now() where id = 1 and at < now() - interval '1 hour';
  get diagnostics n = row_count;
  if n = 0 then return; end if;
  delete from public.join_attempts where at < now() - interval '1 day';
  delete from public.snapshots where at < now() - interval '1 hour';
  delete from public.device_votes where at < now() - interval '3 days';
end $$;

-- 有人走了以后，等审批的新人、等确认的新电脑可能已经凑够了同意：重新算一遍
create or replace function public.settle_pending(p_pet uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r record; need int;
begin
  select count(*) into need from public.members where pet_id = p_pet and status = 'active';
  if need = 0 then return; end if;
  for r in select id from public.members where pet_id = p_pet and status = 'pending' loop
    if (select count(*) from public.approvals a join public.members m on m.id = a.approver
        where a.member_id = r.id and a.ok and m.status = 'active') >= need then
      update public.members set status = 'active', active_at = now(), seen_at = now() where id = r.id;
    end if;
  end loop;
  for r in select d.user_id, d.member_id from public.devices d join public.members m on m.id = d.member_id
      where m.pet_id = p_pet and m.status = 'active' and d.status = 'pending' loop
    select count(*) into need from public.members where pet_id = p_pet and status = 'active' and id <> r.member_id;
    if need > 0 and (select count(*) from public.device_votes v join public.members m on m.id = v.voter
        where v.user_id = r.user_id and v.member_id = r.member_id and m.status = 'active' and m.id <> r.member_id) >= need then
      update public.devices set status = 'active', seen_at = now() where user_id = r.user_id and member_id = r.member_id;
      delete from public.device_votes where user_id = r.user_id and member_id = r.member_id;
    end if;
  end loop;
end $$;

-- ---------- 认领钥匙：每台电脑第一次进组后设一次，之后不能改（冒认的人换不掉） ----------
create or replace function public.set_recovery(p_pet uuid, p_secret text)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := public.my_member(p_pet);
begin
  if me is null then raise exception 'not_member'; end if;
  if coalesce(char_length(p_secret), 0) not between 32 and 128 then raise exception 'bad_key'; end if;
  update public.devices set recovery_hash = public.recovery_hash(p_secret)
    where user_id = auth.uid() and member_id = me and recovery_hash is null;
end $$;

-- ---------- 认领"我是谁" ----------
drop function if exists public.claim_member(text, uuid);
create or replace function public.claim_member(p_code text, p_member uuid, p_secret text default null)
returns json language plpgsql security definer set search_path = '' as $$
declare c text := public.norm_code(p_code); p public.pets; others int; st text; d public.devices; had boolean;
  old public.devices; recent boolean;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if (select count(*) from public.join_attempts where user_id = auth.uid() and at > now() - interval '1 hour') >= 10 then
    raise exception 'too_many_tries';
  end if;
  insert into public.join_attempts(user_id) values (auth.uid());
  select * into p from public.pets where code_hash = public.code_hash(c);
  if not found then raise exception 'bad_code'; end if;
  if not exists (select 1 from public.members where id = p_member and pet_id = p.id and status = 'active') then raise exception 'bad_target'; end if;

  -- 认领钥匙对上了：就是原来那台电脑（登录丢了换了个身份）。直接认回，原来那条设备记录换成这台，狗在那台的也跟过来
  if p_secret is not null and char_length(p_secret) between 32 and 128 then
    select * into old from public.devices
      where member_id = p_member and recovery_hash is not null and recovery_hash = public.recovery_hash(p_secret) limit 1;
    if found then
      delete from public.devices where user_id = old.user_id and member_id = p_member;
      insert into public.devices(user_id, member_id, status, recovery_hash, active_at, seen_at, created_at)
        values (auth.uid(), p_member, 'active', old.recovery_hash, now(), now(), now())
        on conflict (user_id, member_id) do update set status = 'active', recovery_hash = excluded.recovery_hash, seen_at = now();
      delete from public.device_votes where user_id = auth.uid() and member_id = p_member;
      update public.pets set host_device = auth.uid() where id = p.id and host_device = old.user_id;
      return json_build_object('pet_id', p.id, 'member_id', p_member, 'status', 'active', 'key_wrap', p.key_wrap);
    end if;
  end if;

  -- 这台电脑已经在这个组里：照旧返回
  select d2.* into d from public.devices d2 join public.members m on m.id = d2.member_id
    where d2.user_id = auth.uid() and m.pet_id = p.id and d2.status = 'active' and m.status in ('active', 'pending') limit 1;
  if found then
    return json_build_object('pet_id', p.id, 'member_id', d.member_id, 'status', 'active', 'key_wrap', p.key_wrap);
  end if;

  -- 组里还有别人：等被认领的本人（他别的电脑）点"是我"，或者其他人都同意。
  -- 只有他一个人：他的电脑 7 天里有动静就得那台点"是我"；7 天都没动静（电脑丢了）才凭邀请码直接生效
  select count(*) into others from public.members where pet_id = p.id and status = 'active' and id <> p_member;
  select exists (select 1 from public.devices where member_id = p_member and status = 'active' and user_id <> auth.uid()
    and seen_at > now() - interval '7 days') into recent;
  st := case when others = 0 and not recent then 'active' else 'pending' end;
  select exists (select 1 from public.devices where user_id = auth.uid() and member_id = p_member and status = 'pending') into had;
  if not had then delete from public.device_votes where user_id = auth.uid() and member_id = p_member; end if;
  insert into public.devices(user_id, member_id, status, active_at, created_at) values (auth.uid(), p_member, st, now(), now())
    on conflict (user_id, member_id) do update set status = excluded.status,
      created_at = case when had and excluded.status = 'pending' then public.devices.created_at else now() end;
  return json_build_object('pet_id', p.id, 'member_id', p_member, 'status', st, 'key_wrap', p.key_wrap);
end $$;

-- 同意 / 不同意一台新电脑：本人（他别的电脑）点"是我"直接生效；别人点同意要凑齐除他以外所有人；任何一人不同意就作罢
create or replace function public.approve_device(p_user uuid, p_member uuid, p_ok boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare t public.members; me uuid; need int; got int;
begin
  select * into t from public.members where id = p_member;
  if not found then raise exception 'not_member'; end if;
  me := public.my_member(t.pet_id);
  if me is null or p_user = auth.uid() then raise exception 'not_member'; end if;
  if not exists (select 1 from public.devices where user_id = p_user and member_id = p_member and status = 'pending') then
    raise exception 'not_pending';
  end if;
  if not p_ok then
    update public.devices set status = 'rejected', seen_at = now() where user_id = p_user and member_id = p_member;
    delete from public.device_votes where user_id = p_user and member_id = p_member;
    return 'rejected';
  end if;
  if me <> p_member then
    insert into public.device_votes(user_id, member_id, voter) values (p_user, p_member, me) on conflict do nothing;
    select count(*) into need from public.members where pet_id = t.pet_id and status = 'active' and id <> p_member;
    select count(*) into got from public.device_votes v join public.members m on m.id = v.voter
      where v.user_id = p_user and v.member_id = p_member and m.status = 'active' and m.id <> p_member;
    if got < need then return 'pending'; end if;
  end if;
  update public.devices set status = 'active', seen_at = now() where user_id = p_user and member_id = p_member;
  delete from public.device_votes where user_id = p_user and member_id = p_member;
  return 'active';
end $$;

-- ---------- 心跳：顺带打扫 ----------
create or replace function public.heartbeat(p_pet uuid, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := public.my_member(p_pet);
begin
  if me is null then return; end if;
  update public.devices set seen_at = now(), active_at = case when p_active then now() else active_at end
    where user_id = auth.uid() and member_id = me;
  update public.members set seen_at = now(), active_at = case when p_active then now() else active_at end
    where id = me;
  -- 等了 3 天还没人理的：加入申请、新电脑认领、请人离开的投票，都作废
  update public.members set status = 'expired'
    where pet_id = p_pet and status = 'pending' and created_at < now() - interval '3 days';
  update public.devices d set status = 'rejected' from public.members m
    where m.id = d.member_id and m.pet_id = p_pet and d.status = 'pending' and d.created_at < now() - interval '3 days';
  delete from public.kick_votes k using public.members m
    where m.id = k.target and m.pet_id = p_pet and k.at < now() - interval '3 days';
  perform public.housekeep();
end $$;

-- ---------- 建组：全站每小时最多 30 个（防止有人用一堆匿名账号刷） ----------
create or replace function public.create_pet(p_code text, p_key_wrap text, p_nickname text)
returns json language plpgsql security definer set search_path = '' as $$
declare c text := public.norm_code(p_code); nick text := trim(coalesce(p_nickname, '')); pid uuid; mid uuid;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if length(c) <> 12 then raise exception 'bad_code'; end if;
  if char_length(nick) > 12 then raise exception 'bad_nickname'; end if;
  if coalesce(length(p_key_wrap), 0) not between 20 and 400 then raise exception 'bad_key'; end if;
  if (select count(*) from public.devices d join public.members m on m.id = d.member_id join public.pets p on p.id = m.pet_id
      where d.user_id = auth.uid() and p.created_at > now() - interval '1 hour') >= 5 then raise exception 'too_many'; end if;
  if (select count(*) from public.pets where created_at > now() - interval '1 hour') >= 30 then raise exception 'too_many'; end if;
  insert into public.pets(code_hash, key_wrap) values (public.code_hash(c), p_key_wrap) returning id into pid;
  insert into public.members(pet_id, nickname, status, last_with, active_at, seen_at)
    values (pid, nick, 'active', now(), now(), now()) returning id into mid;
  insert into public.devices(user_id, member_id, active_at) values (auth.uid(), mid, now());
  update public.pets set host = mid, host_device = auth.uid(), host_since = now() where id = pid;
  return json_build_object('pet_id', pid, 'member_id', mid);
end $$;

-- ---------- 出发：带的状态、理由限长 ----------
create or replace function public.start_travel(p_pet uuid, p_to uuid, p_reason text, p_note uuid, p_state jsonb)
returns json language plpgsql security definer set search_path = '' as $$
declare me uuid := public.my_member(p_pet); p public.pets; host_seen timestamptz; dev uuid;
begin
  if me is null then raise exception 'not_member'; end if;
  if char_length(coalesce(p_reason, '')) > 16 then raise exception 'bad_reason'; end if;
  if p_state is not null and octet_length(p_state::text) >= 8000 then raise exception 'bad_state'; end if;
  select * into p from public.pets where id = p_pet for update;
  if not exists (select 1 from public.members where id = p_to and pet_id = p_pet and status = 'active') then raise exception 'bad_target'; end if;
  if p_to = p.host then raise exception 'already_there'; end if;
  if me = p.host then
    if p.host_device is not null and p.host_device <> auth.uid() then raise exception 'not_host'; end if;
  else
    select seen_at into host_seen from public.members where id = p.host;
    if not (p_to = me and p_reason = 'reclaim' and (host_seen is null or host_seen < now() - interval '3 minutes')) then
      raise exception 'not_host';
    end if;
  end if;
  if p_note is not null and not exists (
      select 1 from public.notes where id = p_note and pet_id = p_pet and from_member = me and to_member = p_to and delivered_at is null) then
    raise exception 'bad_note';
  end if;
  if p_reason = 'reclaim' then dev := auth.uid();
  else
    select user_id into dev from public.devices where member_id = p_to and status = 'active'
      order by active_at desc nulls last, seen_at desc limit 1;
  end if;
  update public.members set last_with = now() where id = p.host;
  update public.pets set
    host = p_to, host_device = dev, host_since = now(),
    state = case when me = p.host and p_state is not null then p_state else state end,
    travel = jsonb_build_object('from', p.host, 'to', p_to, 'start', (extract(epoch from now()) * 1000)::bigint, 'reason', p_reason, 'note', p_note),
    call = case when (call ->> 'by') = p_to::text then null else call end,
    watch = null
  where id = p_pet;
  return (select to_json(x) from public.pets x where x.id = p_pet);
end $$;

-- ---------- 远程看它的小图：没人在看时不收（不报错，老客户端停得慢一点也没事） ----------
create or replace function public.post_snapshot(p_pet uuid, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := public.my_member(p_pet); p public.pets;
begin
  select * into p from public.pets where id = p_pet;
  if me is null or p.host is distinct from me or (p.host_device is not null and p.host_device <> auth.uid()) then raise exception 'not_host'; end if;
  if coalesce(char_length(p_body), 0) not between 10 and 399999 then raise exception 'bad_body'; end if;
  if p.watch is null or coalesce((p.watch ->> 'until')::bigint, 0) < (extract(epoch from now()) * 1000)::bigint then return; end if;
  insert into public.snapshots(pet_id, body, at) values (p_pet, p_body, now())
    on conflict (pet_id) do update set body = excluded.body, at = now()
    where public.snapshots.at < now() - interval '2 seconds';
end $$;

-- ---------- 加入：只把"这台电脑已经生效的身份"当成已经在组里 ----------
-- 以前没看设备状态：认领别人被拒（或者还在等）以后，再点"第一次来，加入"会被当成那个人，进不了组
create or replace function public.join_pet(p_code text, p_nickname text)
returns json language plpgsql security definer set search_path = '' as $$
declare c text := public.norm_code(p_code); nick text := trim(coalesce(p_nickname, '')); p public.pets; mid uuid; n int; st text;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if (select count(*) from public.join_attempts where user_id = auth.uid() and at > now() - interval '1 hour') >= 10 then
    raise exception 'too_many_tries';
  end if;
  insert into public.join_attempts(user_id) values (auth.uid());
  select * into p from public.pets where code_hash = public.code_hash(c);
  if not found then raise exception 'bad_code'; end if;
  select m.id, m.status into mid, st from public.devices d join public.members m on m.id = d.member_id
    where d.user_id = auth.uid() and d.status = 'active' and m.pet_id = p.id and m.status in ('active', 'pending') limit 1;
  if mid is null then
    if char_length(nick) > 12 then raise exception 'bad_nickname'; end if;
    select count(*) into n from public.members where pet_id = p.id and status in ('active', 'pending');
    if n >= 4 then raise exception 'full'; end if;
    if nick <> '' and exists (select 1 from public.members where pet_id = p.id and status in ('active', 'pending') and nickname = nick) then
      raise exception 'name_taken';
    end if;
    insert into public.members(pet_id, nickname, status) values (p.id, nick, 'pending') returning id into mid;
    insert into public.devices(user_id, member_id) values (auth.uid(), mid);
    st := 'pending';
  end if;
  return json_build_object('pet_id', p.id, 'member_id', mid, 'status', st, 'key_wrap', p.key_wrap);
end $$;

-- ---------- 名字：去掉看不见的字符；去掉以后也不能和组里别人重名 ----------
create or replace function public.clean_nickname() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.nickname := trim(regexp_replace(coalesce(new.nickname, ''), '[\u0001-\u001F\u007F­​-‏‪-‮⁠-⁤⁦-⁩﻿]', '', 'g'));
  if new.nickname <> '' and new.status in ('active', 'pending') and exists (
      select 1 from public.members m where m.pet_id = new.pet_id and m.id <> new.id
        and m.status in ('active', 'pending') and m.nickname = new.nickname) then
    raise exception 'name_taken';
  end if;
  return new;
end $$;
drop trigger if exists members_clean_nickname on public.members;
create trigger members_clean_nickname before insert or update of nickname on public.members
  for each row execute function public.clean_nickname();

-- ---------- 函数权限 ----------
revoke execute on function public.housekeep(), public.settle_pending(uuid), public.clean_nickname(), public.recovery_hash(text) from public, anon, authenticated;
revoke execute on function public.set_recovery(uuid, text), public.claim_member(text, uuid, text) from public, anon;
grant execute on function public.set_recovery(uuid, text), public.claim_member(text, uuid, text) to authenticated;

-- ---------- 实时推送：投票不再推（删除事件不受读权限限制），客户端定时刷新时看到 ----------
do $$ begin
  alter publication supabase_realtime drop table public.kick_votes;
exception when undefined_object then null; end $$;

-- 让接口层马上认出新函数
notify pgrst, 'reload schema';
