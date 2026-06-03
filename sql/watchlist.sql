-- ════════════════════════════════════════════════════════════════
--  WATCHLIST — sledované nabídky (srdíčko v marketu)
--  Spustit v Supabase SQL editoru.
-- ════════════════════════════════════════════════════════════════

create table if not exists public.watchlist (
  user_id     uuid        not null references auth.users(id) on delete cascade,
  listing_id  uuid        not null references public.listings(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, listing_id)
);

-- Rychlé počítání "kolik lidí sleduje tuto nabídku"
create index if not exists watchlist_listing_idx on public.watchlist(listing_id);

alter table public.watchlist enable row level security;

-- Každý vidí jen své sledované záznamy
drop policy if exists "watchlist_select_own" on public.watchlist;
create policy "watchlist_select_own" on public.watchlist
  for select using (auth.uid() = user_id);

-- Přidat do sledovaných smí jen sám sobě
drop policy if exists "watchlist_insert_own" on public.watchlist;
create policy "watchlist_insert_own" on public.watchlist
  for insert with check (auth.uid() = user_id);

-- Odebrat smí jen své
drop policy if exists "watchlist_delete_own" on public.watchlist;
create policy "watchlist_delete_own" on public.watchlist
  for delete using (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────────
--  Veřejný počet sledujících na nabídku (bez prozrazení kdo)
--  Volá se přes RPC, SECURITY DEFINER obejde RLS jen pro count.
-- ────────────────────────────────────────────────────────────────
create or replace function public.watch_counts(p_listing_ids uuid[])
returns table(listing_id uuid, cnt bigint)
language sql
security definer
set search_path = public
as $$
  select listing_id, count(*)::bigint
  from public.watchlist
  where listing_id = any(p_listing_ids)
  group by listing_id;
$$;

grant execute on function public.watch_counts(uuid[]) to anon, authenticated;
