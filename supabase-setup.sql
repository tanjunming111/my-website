-- 在 Supabase Dashboard → SQL Editor 中运行。
-- content_type 区分 diary（日期）与 essay（随笔数字 id）。

create table if not exists public.content_likes (
  content_type text not null check (content_type in ('diary', 'essay')),
  content_id text not null,
  visitor_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (content_type, content_id, visitor_id)
);

create table if not exists public.content_comments (
  id bigint generated always as identity primary key,
  content_type text not null check (content_type in ('diary', 'essay')),
  content_id text not null,
  visitor_id uuid not null,
  nickname text not null check (char_length(trim(nickname)) between 1 and 40),
  content text not null check (char_length(trim(content)) between 1 and 2000),
  created_at timestamptz not null default now()
);

-- 给已创建过旧版 content_comments 表的项目补上访客标识列。
alter table public.content_comments add column if not exists visitor_id uuid;

create index if not exists content_comments_target_created_idx
  on public.content_comments (content_type, content_id, created_at desc);

alter table public.content_likes enable row level security;
alter table public.content_comments enable row level security;

grant select, insert, delete on public.content_likes to anon, authenticated;
grant select, insert on public.content_comments to anon, authenticated;
grant usage, select on sequence public.content_comments_id_seq to anon, authenticated;

drop policy if exists "Anyone can read content likes" on public.content_likes;
drop policy if exists "Anyone can add a content like" on public.content_likes;
drop policy if exists "Visitors can remove content likes" on public.content_likes;
drop policy if exists "Anyone can read content comments" on public.content_comments;
drop policy if exists "Anyone can post a content comment" on public.content_comments;

create policy "Anyone can read content likes"
  on public.content_likes for select to anon, authenticated
  using (true);

create policy "Anyone can add a content like"
  on public.content_likes for insert to anon, authenticated
  with check (content_type in ('diary', 'essay'));

create policy "Visitors can remove content likes"
  on public.content_likes for delete to anon, authenticated
  using (true);

create policy "Anyone can read content comments"
  on public.content_comments for select to anon, authenticated
  using (true);

create policy "Anyone can post a content comment"
  on public.content_comments for insert to anon, authenticated
  with check (
    visitor_id is not null
    and content_type in ('diary', 'essay')
    and char_length(trim(nickname)) between 1 and 40
    and char_length(trim(content)) between 1 and 2000
  );

-- 数据库端也执行 10 秒间隔检查，避免仅依赖网页倒计时。
create or replace function public.enforce_comment_cooldown()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended(new.visitor_id::text, 0)
  );

  if exists (
    select 1
    from public.content_comments c
    where c.visitor_id = new.visitor_id
      and c.created_at > now() - interval '10 seconds'
  ) then
    raise exception 'Please wait 10 seconds before commenting again.';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_comment_cooldown() from public, anon, authenticated;
drop trigger if exists enforce_comment_cooldown on public.content_comments;
create trigger enforce_comment_cooldown
  before insert on public.content_comments
  for each row execute function public.enforce_comment_cooldown();
