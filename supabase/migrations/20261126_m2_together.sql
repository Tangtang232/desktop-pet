-- 合养（M2）第一版：组、成员、审批、设备、带话纸条、狗在谁那儿。
-- 在 Supabase 控制台 SQL Editor 里整段运行一次。
-- 设计要点：
--   * 不注册不登录：每台电脑用 Supabase 匿名登录拿一个身份（auth.uid()），宠物码就是进组的钥匙
--   * 所有表都开 RLS，客户端只能读自己组的数据；写一律走下面的函数（security definer），在函数里校验
--   * 纸条正文在客户端加密后才上传，这里只存乱码
--   * 狗在谁那儿以服务器为准（pets.host），走的时候写 pets.travel，双方客户端据此播离开、到达的动画

create extension if not exists pgcrypto with schema extensions;

-- ---------- 表 ----------
create table if not exists public.pets (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,            -- 宠物码的哈希（服务器不存宠物码本身）
  key_wrap text not null,                    -- 组钥，用宠物码派生的钥匙包着（客户端才解得开）
  name text not null default '小比格',
  host uuid,                                 -- 狗现在在哪个成员那儿（members.id）
  host_since timestamptz,
  travel jsonb,                              -- 正在路上：{from,to,start(毫秒),reason,note}
  state jsonb not null default '{}'::jsonb,  -- 肚子、需求、心情：狗所在那台定时上传，换人时带过去
  call jsonb,                                -- 有人呼唤：{by, at(毫秒)}
  called_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  nickname text not null check (char_length(nickname) between 1 and 12),
  status text not null default 'pending' check (status in ('pending', 'active', 'rejected', 'left')),
  heart real not null default 0.3 check (heart between 0 and 1),   -- 心动值
  last_with timestamptz,                      -- 狗上次在他那儿（算想念值）
  active_at timestamptz,                      -- 人最近一次在电脑前
  seen_at timestamptz,                        -- 客户端最近一次报平安
  created_at timestamptz not null default now()
);
create index if not exists members_pet on public.members(pet_id);

create table if not exists public.devices (
  user_id uuid not null,                      -- auth.uid()：每台电脑一个匿名身份
  member_id uuid not null references public.members(id) on delete cascade,
  seen_at timestamptz not null default now(),
  active_at timestamptz,
  primary key (user_id, member_id)
);

create table if not exists public.approvals (
  member_id uuid not null references public.members(id) on delete cascade,   -- 等审批的新人
  approver uuid not null references public.members(id) on delete cascade,
  ok boolean not null,
  at timestamptz not null default now(),
  primary key (member_id, approver)
);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  from_member uuid not null references public.members(id),
  to_member uuid not null references public.members(id),
  body text not null check (char_length(body) < 4000),   -- 加密后的乱码
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  read_at timestamptz
);
create index if not exists notes_pet on public.notes(pet_id, created_at);

create table if not exists public.join_attempts (
  user_id uuid not null,
  at timestamptz not null default now()
);
create index if not exists join_attempts_user on public.join_attempts(user_id, at);

-- ---------- 小工具 ----------
create or replace function public.code_hash(c text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(convert_to('desktop-pet:' || c, 'UTF8'), 'sha256'), 'hex')
$$;

create or replace function public.norm_code(c text) returns text
language sql immutable set search_path = '' as $$
  select upper(regexp_replace(coalesce(c, ''), '[^A-Za-z0-9]', '', 'g'))
$$;

-- 当前这台电脑在这只宠物的组里是哪个成员（只算已经通过审批的）
create or replace function public.my_member(p uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select m.id from public.devices d join public.members m on m.id = d.member_id
  where d.user_id = auth.uid() and m.pet_id = p and m.status = 'active'
  limit 1
$$;

-- ---------- 读权限 ----------
alter table public.pets enable row level security;
alter table public.members enable row level security;
alter table public.devices enable row level security;
alter table public.approvals enable row level security;
alter table public.notes enable row level security;
alter table public.join_attempts enable row level security;

drop policy if exists pets_read on public.pets;
create policy pets_read on public.pets for select to authenticated
  using (public.my_member(id) is not null);

-- 组员能看到全组成员；还在等审批的新人只能看到自己那一行（好知道自己通过了没有）
drop policy if exists members_read on public.members;
create policy members_read on public.members for select to authenticated
  using (public.my_member(pet_id) is not null
         or exists (select 1 from public.devices d where d.member_id = members.id and d.user_id = auth.uid()));

drop policy if exists devices_read on public.devices;
create policy devices_read on public.devices for select to authenticated
  using (user_id = auth.uid());

drop policy if exists approvals_read on public.approvals;
create policy approvals_read on public.approvals for select to authenticated
  using (exists (select 1 from public.members m where m.id = approvals.member_id and public.my_member(m.pet_id) is not null));

-- 纸条只有写的人和收的人看得到
drop policy if exists notes_read on public.notes;
create policy notes_read on public.notes for select to authenticated
  using (public.my_member(pet_id) in (from_member, to_member));

revoke all on public.pets, public.members, public.devices, public.approvals, public.notes, public.join_attempts from anon, authenticated;
grant select on public.pets, public.members, public.devices, public.approvals, public.notes to authenticated;

-- ---------- 建组、加入、审批 ----------
create or replace function public.create_pet(p_code text, p_key_wrap text, p_nickname text)
returns json language plpgsql security definer set search_path = '' as $$
declare c text := public.norm_code(p_code); nick text := trim(coalesce(p_nickname, '')); pid uuid; mid uuid;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if length(c) <> 12 then raise exception 'bad_code'; end if;
  if char_length(nick) not between 1 and 12 then raise exception 'bad_nickname'; end if;
  if coalesce(length(p_key_wrap), 0) not between 20 and 400 then raise exception 'bad_key'; end if;
  -- 防刷：一台电脑一小时最多建 5 只
  if (select count(*) from public.devices d join public.members m on m.id = d.member_id join public.pets p on p.id = m.pet_id
      where d.user_id = auth.uid() and p.created_at > now() - interval '1 hour') >= 5 then raise exception 'too_many'; end if;
  insert into public.pets(code_hash, key_wrap) values (public.code_hash(c), p_key_wrap) returning id into pid;
  insert into public.members(pet_id, nickname, status, last_with, active_at, seen_at)
    values (pid, nick, 'active', now(), now(), now()) returning id into mid;
  insert into public.devices(user_id, member_id, active_at) values (auth.uid(), mid, now());
  update public.pets set host = mid, host_since = now() where id = pid;
  return json_build_object('pet_id', pid, 'member_id', mid);
end $$;

-- 输宠物码加入：先进等待名单，组里其他人都同意才算进组（任何一人否决就不行）
create or replace function public.join_pet(p_code text, p_nickname text)
returns json language plpgsql security definer set search_path = '' as $$
declare c text := public.norm_code(p_code); nick text := trim(coalesce(p_nickname, '')); p public.pets; mid uuid; n int; st text;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  -- 防猜码：一台电脑一小时最多试 10 次
  if (select count(*) from public.join_attempts where user_id = auth.uid() and at > now() - interval '1 hour') >= 10 then
    raise exception 'too_many_tries';
  end if;
  insert into public.join_attempts(user_id) values (auth.uid());
  select * into p from public.pets where code_hash = public.code_hash(c);
  if not found then raise exception 'bad_code'; end if;
  -- 这台电脑已经在这个组里（或者在等审批）：照旧返回
  select m.id, m.status into mid, st from public.devices d join public.members m on m.id = d.member_id
    where d.user_id = auth.uid() and m.pet_id = p.id and m.status in ('active', 'pending') limit 1;
  if mid is null then
    if char_length(nick) not between 1 and 12 then raise exception 'bad_nickname'; end if;
    select count(*) into n from public.members where pet_id = p.id and status in ('active', 'pending');
    if n >= 4 then raise exception 'full'; end if;
    if exists (select 1 from public.members where pet_id = p.id and status in ('active', 'pending') and nickname = nick) then
      raise exception 'name_taken';
    end if;
    insert into public.members(pet_id, nickname, status) values (p.id, nick, 'pending') returning id into mid;
    insert into public.devices(user_id, member_id) values (auth.uid(), mid);
    st := 'pending';
  end if;
  return json_build_object('pet_id', p.id, 'member_id', mid, 'status', st, 'key_wrap', p.key_wrap);
end $$;

create or replace function public.approve(p_member uuid, p_ok boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare t public.members; me uuid; need int; got int;
begin
  select * into t from public.members where id = p_member;
  if not found or t.status <> 'pending' then raise exception 'not_pending'; end if;
  me := public.my_member(t.pet_id);
  if me is null then raise exception 'not_member'; end if;
  insert into public.approvals(member_id, approver, ok) values (p_member, me, p_ok)
    on conflict (member_id, approver) do update set ok = excluded.ok, at = now();
  if not p_ok then
    update public.members set status = 'rejected' where id = p_member;
    return 'rejected';
  end if;
  select count(*) into need from public.members where pet_id = t.pet_id and status = 'active';
  select count(*) into got from public.approvals a join public.members m on m.id = a.approver
    where a.member_id = p_member and a.ok and m.status = 'active';
  if got >= need then
    update public.members set status = 'active', active_at = now(), seen_at = now() where id = p_member;
    return 'active';
  end if;
  return 'pending';
end $$;

-- ---------- 在不在：客户端开着时 30 秒报一次；人在电脑前时顺带报"在" ----------
create or replace function public.heartbeat(p_pet uuid, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := public.my_member(p_pet);
begin
  if me is null then return; end if;
  update public.devices set seen_at = now(), active_at = case when p_active then now() else active_at end
    where user_id = auth.uid() and member_id = me;
  update public.members set seen_at = now(), active_at = case when p_active then now() else active_at end
    where id = me;
end $$;

-- ---------- 狗换地方 ----------
-- 只有狗所在那台能让它走（p_state 是它带走的肚子、心情）；那台 3 分钟没动静时，在线的人可以把它接到自己这儿（reclaim）
create or replace function public.start_travel(p_pet uuid, p_to uuid, p_reason text, p_note uuid, p_state jsonb)
returns json language plpgsql security definer set search_path = '' as $$
declare me uuid := public.my_member(p_pet); p public.pets; host_seen timestamptz;
begin
  if me is null then raise exception 'not_member'; end if;
  select * into p from public.pets where id = p_pet for update;
  if not exists (select 1 from public.members where id = p_to and pet_id = p_pet and status = 'active') then raise exception 'bad_target'; end if;
  if p_to = p.host then raise exception 'already_there'; end if;
  if me <> p.host then
    select seen_at into host_seen from public.members where id = p.host;
    if not (p_to = me and p_reason = 'reclaim' and (host_seen is null or host_seen < now() - interval '3 minutes')) then
      raise exception 'not_host';
    end if;
  end if;
  if p_note is not null and not exists (
      select 1 from public.notes where id = p_note and pet_id = p_pet and from_member = me and to_member = p_to and delivered_at is null) then
    raise exception 'bad_note';
  end if;
  update public.members set last_with = now() where id = p.host;
  update public.pets set
    host = p_to, host_since = now(),
    state = case when me = p.host and p_state is not null then p_state else state end,
    travel = jsonb_build_object('from', p.host, 'to', p_to, 'start', (extract(epoch from now()) * 1000)::bigint, 'reason', p_reason, 'note', p_note),
    call = case when (call ->> 'by') = p_to::text then null else call end
  where id = p_pet;
  return (select to_json(x) from public.pets x where x.id = p_pet);
end $$;

-- 到了：清掉路上的标记；带着纸条的，纸条算送到
create or replace function public.arrived(p_pet uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := public.my_member(p_pet); p public.pets;
begin
  select * into p from public.pets where id = p_pet for update;
  if me is null or p.host is distinct from me then return; end if;
  if p.travel is not null and (p.travel ->> 'note') is not null then
    update public.notes set delivered_at = now() where id = (p.travel ->> 'note')::uuid and delivered_at is null;
  end if;
  update public.pets set travel = null where id = p_pet;
  update public.members set last_with = now() where id = me;
end $$;

-- 呼唤：冷却 10 分钟；它刚到别人那儿不满 5 分钟、并且那边人在时叫不动。真正走由狗所在那台发起（好播离开的动画）
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

-- 狗所在那台定时上传肚子、心情
create or replace function public.save_state(p_pet uuid, p_state jsonb)
returns void language sql security definer set search_path = '' as $$
  update public.pets set state = p_state where id = p_pet and host = public.my_member(p_pet) and octet_length(p_state::text) < 8000
$$;

-- 心动值：客户端算好报上来，服务器只做夹紧（一次最多变 0.2）
create or replace function public.set_heart(p_pet uuid, p_heart real)
returns void language sql security definer set search_path = '' as $$
  update public.members set heart = greatest(0, least(1, greatest(heart - 0.2, least(heart + 0.2, p_heart))))
  where id = public.my_member(p_pet)
$$;

-- ---------- 纸条 ----------
create or replace function public.send_note(p_pet uuid, p_to uuid, p_body text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid := public.my_member(p_pet); nid uuid;
begin
  if me is null then raise exception 'not_member'; end if;
  if p_to = me or not exists (select 1 from public.members where id = p_to and pet_id = p_pet and status = 'active') then
    raise exception 'bad_target';
  end if;
  if coalesce(char_length(p_body), 0) not between 10 and 3999 then raise exception 'bad_body'; end if;
  -- 防刷：一个人一小时最多 30 张
  if (select count(*) from public.notes where from_member = me and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'too_many';
  end if;
  insert into public.notes(pet_id, from_member, to_member, body) values (p_pet, me, p_to, p_body) returning id into nid;
  return nid;
end $$;

create or replace function public.read_note(p_note uuid)
returns void language sql security definer set search_path = '' as $$
  update public.notes set read_at = coalesce(read_at, now()), delivered_at = coalesce(delivered_at, now())
  where id = p_note and to_member = public.my_member(pet_id)
$$;

-- ---------- 函数权限：只给登录（含匿名登录）的客户端用 ----------
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.my_member(uuid),
  public.create_pet(text, text, text), public.join_pet(text, text), public.approve(uuid, boolean),
  public.heartbeat(uuid, boolean), public.start_travel(uuid, uuid, text, uuid, jsonb), public.arrived(uuid),
  public.call_pet(uuid), public.save_state(uuid, jsonb), public.set_heart(uuid, real),
  public.send_note(uuid, uuid, text), public.read_note(uuid)
to authenticated;

-- ---------- 实时推送：狗换地方、成员变化、新纸条 ----------
do $$ begin
  alter publication supabase_realtime add table public.pets, public.members, public.notes;
exception when duplicate_object then null; end $$;
