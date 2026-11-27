-- 合养补完（2026-11-26）：换邀请码、退出组、投票请人离开、等太久的申请作废、新电脑认领"我是谁"、
-- 一个人几台电脑（狗跟着最近在用的那台）、留它一次、远程看它（快照）、远程喂。
-- 在 20261126b_optional_nickname.sql 之后整段运行一次。只加不删：老版本客户端照旧能用。

-- ---------- 表和字段 ----------
-- 成员状态：加上 kicked（被请离开）、expired（申请等太久没人理，作废）
alter table public.members drop constraint if exists members_status_check;
alter table public.members add constraint members_status_check
  check (status in ('pending', 'active', 'rejected', 'left', 'kicked', 'expired'));

alter table public.pets add column if not exists code_box text;            -- 邀请码用组钥加密存一份：组里人都看得到最新的码，服务器看不懂
alter table public.pets add column if not exists code_changed_at timestamptz;
alter table public.pets add column if not exists host_device uuid;         -- 狗具体在哪台电脑上（auth.uid()）；一个人几台电脑时只在一台上出现
alter table public.pets add column if not exists watch jsonb;              -- 有人在远程看它：{by, until(毫秒)}
alter table public.pets add column if not exists feed jsonb;               -- 有人远程喂了一碗：{by, at(毫秒)}

-- 设备：新电脑说"我是某某"时先是 pending，组里有人同意才生效
alter table public.devices add column if not exists status text not null default 'active';
alter table public.devices drop constraint if exists devices_status_check;
alter table public.devices add constraint devices_status_check check (status in ('active', 'pending', 'rejected'));
alter table public.devices add column if not exists created_at timestamptz not null default now();

-- 请人离开的投票：除了被请的人，其他人都同意才算；任何一人不同意就作罢
create table if not exists public.kick_votes (
  target uuid not null references public.members(id) on delete cascade,
  voter uuid not null references public.members(id) on delete cascade,
  ok boolean not null,
  at timestamptz not null default now(),
  primary key (target, voter)
);

-- 远程看它：狗所在那台有人在看时，每几秒传一张狗的小图（加密后的乱码），只留最新一张
create table if not exists public.snapshots (
  pet_id uuid primary key references public.pets(id) on delete cascade,
  body text not null check (char_length(body) < 400000),
  at timestamptz not null default now()
);

-- 老数据补上"狗在哪台电脑"：狗所在那个人最近在用的那台
update public.pets p set host_device = (
  select d.user_id from public.devices d where d.member_id = p.host order by d.active_at desc nulls last, d.seen_at desc limit 1)
where p.host_device is null and p.host is not null;

-- ---------- 身份：只算已经生效的设备 ----------
create or replace function public.my_member(p uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select m.id from public.devices d join public.members m on m.id = d.member_id
  where d.user_id = auth.uid() and d.status = 'active' and m.pet_id = p and m.status = 'active'
  limit 1
$$;

-- ---------- 读权限 ----------
-- 这个成员属于哪只宠物。读权限里要用：直接查成员表会经过成员表的读权限，而成员表的读权限又查设备表，会互相套住
create or replace function public.pet_of(p_member uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select pet_id from public.members where id = p_member
$$;
revoke execute on function public.pet_of(uuid) from public, anon;
grant execute on function public.pet_of(uuid) to authenticated;

-- 设备：自己这台；组里成员能看到组里所有设备（好知道自己另外几台在不在用、有没有新电脑在等同意）
drop policy if exists devices_read on public.devices;
create policy devices_read on public.devices for select to authenticated
  using (user_id = auth.uid() or public.my_member(public.pet_of(member_id)) is not null);

alter table public.kick_votes enable row level security;
alter table public.snapshots enable row level security;
-- 投票：组里人能看到，被请的那个人看不到
drop policy if exists kick_votes_read on public.kick_votes;
create policy kick_votes_read on public.kick_votes for select to authenticated
  using (public.my_member(public.pet_of(target)) is not null and public.my_member(public.pet_of(target)) <> target);
drop policy if exists snapshots_read on public.snapshots;
create policy snapshots_read on public.snapshots for select to authenticated
  using (public.my_member(pet_id) is not null);

revoke all on public.kick_votes, public.snapshots from anon, authenticated;
grant select on public.kick_votes, public.snapshots to authenticated;

-- ---------- 内部小工具（客户端不能直接调） ----------
-- 狗所在的人走了（退出、被请离开）：交给组里最近在电脑前的人，按"到达"播动画
create or replace function public.rehome(p_pet uuid, p_from uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare nxt uuid; dev uuid;
begin
  select id into nxt from public.members where pet_id = p_pet and status = 'active'
    order by active_at desc nulls last, seen_at desc nulls last limit 1;
  if nxt is null then return; end if;
  select user_id into dev from public.devices where member_id = nxt and status = 'active'
    order by active_at desc nulls last, seen_at desc limit 1;
  update public.pets set host = nxt, host_device = dev, host_since = now(),
    travel = jsonb_build_object('from', p_from, 'to', nxt, 'start', (extract(epoch from now()) * 1000)::bigint, 'reason', p_reason, 'note', null),
    call = null, watch = null
  where id = p_pet;
end $$;

-- 有人走了以后，等审批的新人可能已经凑够了同意：重新算一遍
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
end $$;

-- ---------- 建组：顺带记下狗在哪台电脑 ----------
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
  insert into public.pets(code_hash, key_wrap) values (public.code_hash(c), p_key_wrap) returning id into pid;
  insert into public.members(pet_id, nickname, status, last_with, active_at, seen_at)
    values (pid, nick, 'active', now(), now(), now()) returning id into mid;
  insert into public.devices(user_id, member_id, active_at) values (auth.uid(), mid, now());
  update public.pets set host = mid, host_device = auth.uid(), host_since = now() where id = pid;
  return json_build_object('pet_id', pid, 'member_id', mid);
end $$;

-- ---------- 心跳：顺带把等太久的东西作废 ----------
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
end $$;

-- ---------- 狗换地方：只有狗所在的那台电脑能让它走；到了对方那儿，落在对方最近在用的那台 ----------
create or replace function public.start_travel(p_pet uuid, p_to uuid, p_reason text, p_note uuid, p_state jsonb)
returns json language plpgsql security definer set search_path = '' as $$
declare me uuid := public.my_member(p_pet); p public.pets; host_seen timestamptz; dev uuid;
begin
  if me is null then raise exception 'not_member'; end if;
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

create or replace function public.arrived(p_pet uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := public.my_member(p_pet); p public.pets;
begin
  select * into p from public.pets where id = p_pet for update;
  if me is null or p.host is distinct from me then return; end if;
  if p.host_device is not null and p.host_device <> auth.uid() then return; end if;
  if p.travel is not null and (p.travel ->> 'note') is not null then
    update public.notes set delivered_at = now() where id = (p.travel ->> 'note')::uuid and delivered_at is null;
  end if;
  update public.pets set travel = null where id = p_pet;
  update public.members set last_with = now() where id = me;
end $$;

create or replace function public.save_state(p_pet uuid, p_state jsonb)
returns void language sql security definer set search_path = '' as $$
  update public.pets set state = p_state
  where id = p_pet and host = public.my_member(p_pet) and (host_device is null or host_device = auth.uid())
    and octet_length(p_state::text) < 8000
$$;

-- 一个人几台电脑：在用的这台把狗接过来（狗现在那台 90 秒没人用、或者 3 分钟没动静时才接）
create or replace function public.follow_me(p_pet uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare me uuid := public.my_member(p_pet); p public.pets; hd public.devices;
begin
  if me is null then raise exception 'not_member'; end if;
  select * into p from public.pets where id = p_pet for update;
  if p.host is distinct from me then raise exception 'not_host'; end if;
  if p.host_device = auth.uid() then return (select to_json(x) from public.pets x where x.id = p_pet); end if;
  select * into hd from public.devices where user_id = p.host_device and member_id = me and status = 'active';
  if found and hd.active_at > now() - interval '90 seconds' and hd.seen_at > now() - interval '3 minutes' then raise exception 'busy'; end if;
  update public.pets set host_device = auth.uid(),
    travel = jsonb_build_object('from', me, 'to', me, 'start', (extract(epoch from now()) * 1000)::bigint, 'reason', 'follow', 'note', null)
  where id = p_pet;
  return (select to_json(x) from public.pets x where x.id = p_pet);
end $$;

-- ---------- 呼唤、留它一次 ----------
create or replace function public.call_pet(p_pet uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare me uuid := public.my_member(p_pet); p public.pets; hs timestamptz; ha timestamptz;
begin
  if me is null then raise exception 'not_member'; end if;
  select * into p from public.pets where id = p_pet for update;
  if p.host = me then return 'here'; end if;
  if p.called_at is not null and p.called_at > now() - interval '10 minutes' then raise exception 'cooldown'; end if;
  select seen_at, active_at into hs, ha from public.members where id = p.host;
  if hs > now() - interval '3 minutes' and ha > now() - interval '90 seconds' and p.host_since > now() - interval '5 minutes' then
    raise exception 'just_arrived';
  end if;
  update public.pets set called_at = now(), call = jsonb_build_object('by', me, 'at', (extract(epoch from now()) * 1000)::bigint) where id = p_pet;
  return 'called';
end $$;

-- 对方正在和它玩时被呼唤：可以留它 10 分钟，一次呼唤只能留一次
create or replace function public.keep_pet(p_pet uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare me uuid := public.my_member(p_pet); p public.pets;
begin
  select * into p from public.pets where id = p_pet for update;
  if me is null or p.host is distinct from me then raise exception 'not_host'; end if;
  if p.call is null then return 'no_call'; end if;
  if (p.call ->> 'kept') = 'true' then raise exception 'kept_once'; end if;
  update public.pets set call = p.call || jsonb_build_object('kept', true, 'until', (extract(epoch from now()) * 1000)::bigint + 600000)
  where id = p_pet;
  return 'kept';
end $$;

-- ---------- 邀请码：存一份加密的、换码 ----------
create or replace function public.set_code_box(p_pet uuid, p_box text)
returns void language sql security definer set search_path = '' as $$
  update public.pets set code_box = p_box
  where id = p_pet and code_box is null and public.my_member(p_pet) is not null and char_length(p_box) between 20 and 400
$$;

-- 换邀请码：旧码立刻作废；已经进组的电脑不受影响（组钥不变，只是换一把包它的锁）
create or replace function public.rotate_code(p_pet uuid, p_code text, p_key_wrap text, p_box text)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := public.my_member(p_pet); c text := public.norm_code(p_code); p public.pets;
begin
  if me is null then raise exception 'not_member'; end if;
  if length(c) <> 12 then raise exception 'bad_code'; end if;
  if coalesce(length(p_key_wrap), 0) not between 20 and 400 or coalesce(length(p_box), 0) not between 20 and 400 then raise exception 'bad_key'; end if;
  select * into p from public.pets where id = p_pet for update;
  if p.code_changed_at > now() - interval '1 minute' then raise exception 'too_many'; end if;
  update public.pets set code_hash = public.code_hash(c), key_wrap = p_key_wrap, code_box = p_box, code_changed_at = now() where id = p_pet;
end $$;

-- ---------- 退出、请人离开 ----------
-- 退出：这个人的所有电脑一起离开；狗在他那儿就交给别人；最后一个人也走了，组就散了
create or replace function public.leave_pet(p_pet uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare me uuid := public.my_member(p_pet); p public.pets;
begin
  if me is null then raise exception 'not_member'; end if;
  select * into p from public.pets where id = p_pet for update;
  update public.members set status = 'left' where id = me;
  delete from public.devices where member_id = me;
  delete from public.kick_votes where target = me or voter = me;
  if not exists (select 1 from public.members where pet_id = p_pet and status = 'active') then
    delete from public.pets where id = p_pet;
    return 'gone';
  end if;
  if p.host = me then perform public.rehome(p_pet, me, 'leave'); end if;
  perform public.settle_pending(p_pet);
  return 'left';
end $$;

-- 请人离开：两个人的组不行（只能自己退出）；除了被请的人，其他人都同意才算，任何一人不同意就作罢
create or replace function public.vote_kick(p_target uuid, p_ok boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare t public.members; me uuid; need int; got int; p public.pets;
begin
  select * into t from public.members where id = p_target;
  if not found or t.status <> 'active' then raise exception 'bad_target'; end if;
  me := public.my_member(t.pet_id);
  if me is null then raise exception 'not_member'; end if;
  if me = p_target then raise exception 'bad_target'; end if;
  select count(*) into need from public.members where pet_id = t.pet_id and status = 'active' and id <> p_target;
  if need < 2 then raise exception 'two_only'; end if;
  if not p_ok then delete from public.kick_votes where target = p_target; return 'kept'; end if;
  insert into public.kick_votes(target, voter, ok) values (p_target, me, true)
    on conflict (target, voter) do update set ok = true, at = now();
  select count(*) into got from public.kick_votes k join public.members m on m.id = k.voter
    where k.target = p_target and k.ok and m.status = 'active';
  if got < need then return 'voting'; end if;
  update public.members set status = 'kicked' where id = p_target;
  delete from public.devices where member_id = p_target;
  delete from public.kick_votes where target = p_target or voter = p_target;
  -- 被请走的人知道旧码：马上作废（换成谁也不知道的码），清掉换码的频率限制，最后投票的那台马上换上新码
  update public.pets set code_hash = public.code_hash(gen_random_uuid()::text), code_box = 'void', code_changed_at = null where id = t.pet_id;
  select * into p from public.pets where id = t.pet_id for update;
  if p.host = p_target then perform public.rehome(t.pet_id, p_target, 'leave'); end if;
  perform public.settle_pending(t.pet_id);
  return 'kicked';
end $$;

-- ---------- 新电脑："我是谁" ----------
-- 输对邀请码后先看看组里有谁（算一次试码）
create or replace function public.peek_pet(p_code text)
returns json language plpgsql security definer set search_path = '' as $$
declare c text := public.norm_code(p_code); p public.pets;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if (select count(*) from public.join_attempts where user_id = auth.uid() and at > now() - interval '1 hour') >= 10 then
    raise exception 'too_many_tries';
  end if;
  insert into public.join_attempts(user_id) values (auth.uid());
  select * into p from public.pets where code_hash = public.code_hash(c);
  if not found then raise exception 'bad_code'; end if;
  return json_build_object('pet_id', p.id, 'members', coalesce((
    select json_agg(json_build_object('id', id, 'nickname', nickname, 'since', created_at) order by created_at)
    from public.members where pet_id = p.id and status = 'active'), '[]'::json));
end $$;

-- 认领：这台电脑是组里的某某。组里只有他自己时直接生效（邀请码就是钥匙）；有别人时等一个人同意（他自己别的电脑也行）
create or replace function public.claim_member(p_code text, p_member uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare c text := public.norm_code(p_code); p public.pets; others int; st text; d public.devices;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if (select count(*) from public.join_attempts where user_id = auth.uid() and at > now() - interval '1 hour') >= 10 then
    raise exception 'too_many_tries';
  end if;
  insert into public.join_attempts(user_id) values (auth.uid());
  select * into p from public.pets where code_hash = public.code_hash(c);
  if not found then raise exception 'bad_code'; end if;
  if not exists (select 1 from public.members where id = p_member and pet_id = p.id and status = 'active') then raise exception 'bad_target'; end if;
  -- 这台电脑已经在这个组里（或者在等）：照旧返回
  select d2.* into d from public.devices d2 join public.members m on m.id = d2.member_id
    where d2.user_id = auth.uid() and m.pet_id = p.id and d2.status in ('active', 'pending') and m.status in ('active', 'pending') limit 1;
  if found then
    return json_build_object('pet_id', p.id, 'member_id', d.member_id, 'status', d.status, 'key_wrap', p.key_wrap);
  end if;
  select count(*) into others from public.members where pet_id = p.id and status = 'active' and id <> p_member;
  st := case when others = 0 then 'active' else 'pending' end;
  insert into public.devices(user_id, member_id, status, active_at, created_at) values (auth.uid(), p_member, st, now(), now())
    on conflict (user_id, member_id) do update set status = excluded.status, created_at = now();
  return json_build_object('pet_id', p.id, 'member_id', p_member, 'status', st, 'key_wrap', p.key_wrap);
end $$;

create or replace function public.approve_device(p_user uuid, p_member uuid, p_ok boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare t public.members;
begin
  select * into t from public.members where id = p_member;
  if not found or public.my_member(t.pet_id) is null then raise exception 'not_member'; end if;
  if not exists (select 1 from public.devices where user_id = p_user and member_id = p_member and status = 'pending') then
    raise exception 'not_pending';
  end if;
  update public.devices set status = case when p_ok then 'active' else 'rejected' end, seen_at = now()
    where user_id = p_user and member_id = p_member;
  return case when p_ok then 'active' else 'rejected' end;
end $$;

-- ---------- 远程看它、远程喂 ----------
-- 打开"看看它"窗口时每分钟续一次；关掉时清掉
create or replace function public.watch_pet(p_pet uuid, p_on boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := public.my_member(p_pet);
begin
  if me is null then raise exception 'not_member'; end if;
  update public.pets set watch = case when p_on
      then jsonb_build_object('by', me, 'until', (extract(epoch from now()) * 1000)::bigint + 90000) else null end
    where id = p_pet and host is distinct from me;
end $$;

-- 狗所在那台传一张小图（客户端加密过）；两次之间至少隔 2 秒
create or replace function public.post_snapshot(p_pet uuid, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := public.my_member(p_pet); p public.pets;
begin
  select * into p from public.pets where id = p_pet;
  if me is null or p.host is distinct from me or (p.host_device is not null and p.host_device <> auth.uid()) then raise exception 'not_host'; end if;
  if coalesce(char_length(p_body), 0) not between 10 and 399999 then raise exception 'bad_body'; end if;
  insert into public.snapshots(pet_id, body, at) values (p_pet, p_body, now())
    on conflict (pet_id) do update set body = excluded.body, at = now()
    where public.snapshots.at < now() - interval '2 seconds';
end $$;

-- 远程喂一碗：狗不在你这儿时；整个组 10 分钟最多一次（碗满了也不会撑着它，只是倒满）
create or replace function public.remote_feed(p_pet uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare me uuid := public.my_member(p_pet); p public.pets;
begin
  if me is null then raise exception 'not_member'; end if;
  select * into p from public.pets where id = p_pet for update;
  if p.host = me then return 'here'; end if;
  if p.feed is not null and (p.feed ->> 'at')::bigint > (extract(epoch from now()) * 1000)::bigint - 600000 then
    raise exception 'fed_recently';
  end if;
  update public.pets set feed = jsonb_build_object('by', me, 'at', (extract(epoch from now()) * 1000)::bigint) where id = p_pet;
  return 'fed';
end $$;

-- ---------- 函数权限 ----------
revoke execute on function public.rehome(uuid, uuid, text), public.settle_pending(uuid) from public, anon, authenticated;
revoke execute on function
  public.follow_me(uuid), public.keep_pet(uuid), public.set_code_box(uuid, text), public.rotate_code(uuid, text, text, text),
  public.leave_pet(uuid), public.vote_kick(uuid, boolean), public.peek_pet(text), public.claim_member(text, uuid),
  public.approve_device(uuid, uuid, boolean), public.watch_pet(uuid, boolean), public.post_snapshot(uuid, text), public.remote_feed(uuid)
from public, anon;
grant execute on function
  public.follow_me(uuid), public.keep_pet(uuid), public.set_code_box(uuid, text), public.rotate_code(uuid, text, text, text),
  public.leave_pet(uuid), public.vote_kick(uuid, boolean), public.peek_pet(text), public.claim_member(text, uuid),
  public.approve_device(uuid, uuid, boolean), public.watch_pet(uuid, boolean), public.post_snapshot(uuid, text), public.remote_feed(uuid)
to authenticated;

-- ---------- 实时推送：加上设备（新电脑等同意、认领通过）和投票 ----------
do $$ begin
  alter publication supabase_realtime add table public.devices;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.kick_votes;
exception when duplicate_object then null; end $$;
