-- 两个人才算开始一起养（2026-11-27）：在 20261127_hardening.sql 之后运行，可以重复运行。
-- 点"邀请朋友一起养"只是发出邀请：组里只有发起的人时还不算一起养；第二个人被同意进组的那一刻才开始（记下 started_at）。
-- 邀请不会过期：一直有效，直到发起的人点"不邀请了"（退出，组就删了）或者有人加入。
-- 只加字段和触发器，不删数据；0.1.0 客户端照旧能用（它们不知道"还没开始"）。

alter table public.pets add column if not exists started_at timestamptz;   -- 凑够两个人、开始一起养的时间；null = 还只是邀请

-- 已经有两个人以上的组：算从建组那天开始
update public.pets p set started_at = p.created_at
where p.started_at is null
  and (select count(*) from public.members m where m.pet_id = p.id and m.status = 'active') >= 2;

-- 有人变成正式成员时：组里凑够两个人，就记下开始的时间（只记第一次）
create or replace function public.mark_started() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    update public.pets set started_at = now()
    where id = new.pet_id and started_at is null
      and (select count(*) from public.members where pet_id = new.pet_id and status = 'active') >= 2;
  end if;
  return null;
end $$;
drop trigger if exists members_mark_started on public.members;
create trigger members_mark_started after insert or update of status on public.members
  for each row execute function public.mark_started();

revoke execute on function public.mark_started() from public, anon, authenticated;

notify pgrst, 'reload schema';
