-- 名字改成选填（2026-11-26）：建组、加入时不用填名字，没起名的人别人看到的是"TA"；进组以后随时可以给自己起名、改名。
-- 在 Supabase 控制台 SQL Editor 里整段运行一次（在 20261126_m2_together.sql 之后）。

alter table public.members drop constraint if exists members_nickname_check;
alter table public.members add constraint members_nickname_check check (char_length(nickname) <= 12);
alter table public.members alter column nickname set default '';

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
  update public.pets set host = mid, host_since = now() where id = pid;
  return json_build_object('pet_id', pid, 'member_id', mid);
end $$;

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
    where d.user_id = auth.uid() and m.pet_id = p.id and m.status in ('active', 'pending') limit 1;
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

-- 给自己起名、改名（留空就是没名字，别人看到"TA"）；组里不能重名
create or replace function public.set_nickname(p_pet uuid, p_nickname text)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := public.my_member(p_pet); nick text := trim(coalesce(p_nickname, ''));
begin
  if me is null then raise exception 'not_member'; end if;
  if char_length(nick) > 12 then raise exception 'bad_nickname'; end if;
  if nick <> '' and exists (select 1 from public.members where pet_id = p_pet and id <> me and status in ('active', 'pending') and nickname = nick) then
    raise exception 'name_taken';
  end if;
  update public.members set nickname = nick where id = me;
end $$;

revoke execute on function public.set_nickname(uuid, text) from public, anon;
grant execute on function public.set_nickname(uuid, text) to authenticated;
