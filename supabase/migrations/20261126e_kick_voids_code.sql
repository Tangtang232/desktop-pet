-- 请人离开一通过，服务器自己先把邀请码作废（2026-11-26）：以前要等最后投票的那台换码，
-- 那台一分钟内换过码时会被频率限制挡住，被请走的人还能拿旧码申请。现在作废旧码、清掉频率限制，那台马上换上新码。
-- 20261126c 已经包含这一段；跑过旧版 c 的项目补跑这一段。可以重复跑。
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
revoke execute on function public.vote_kick(uuid, boolean) from public, anon;
grant execute on function public.vote_kick(uuid, boolean) to authenticated;
