-- 修 20261126c 的读权限（2026-11-26）：设备表的读权限里查了成员表，成员表的读权限又查设备表，互相套住了，
-- 读成员表直接报 infinite recursion。改成用一个 security definer 的小函数查"这个成员属于哪只宠物"，不再经过成员表的读权限。
-- 20261126c 已经改成用这个函数；已经跑过旧版 c 的项目，补跑这一段。可以重复跑。
create or replace function public.pet_of(p_member uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select pet_id from public.members where id = p_member
$$;
revoke execute on function public.pet_of(uuid) from public, anon;
grant execute on function public.pet_of(uuid) to authenticated;

drop policy if exists devices_read on public.devices;
create policy devices_read on public.devices for select to authenticated
  using (user_id = auth.uid() or public.my_member(public.pet_of(member_id)) is not null);

drop policy if exists kick_votes_read on public.kick_votes;
create policy kick_votes_read on public.kick_votes for select to authenticated
  using (public.my_member(public.pet_of(target)) is not null and public.my_member(public.pet_of(target)) <> target);
