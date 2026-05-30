create table if not exists public.music_analysis_notes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  entries jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.music_analysis_notes enable row level security;

drop policy if exists "Users can read own music analysis" on public.music_analysis_notes;
create policy "Users can read own music analysis"
on public.music_analysis_notes
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own music analysis" on public.music_analysis_notes;
create policy "Users can insert own music analysis"
on public.music_analysis_notes
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own music analysis" on public.music_analysis_notes;
create policy "Users can update own music analysis"
on public.music_analysis_notes
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own music analysis" on public.music_analysis_notes;
create policy "Users can delete own music analysis"
on public.music_analysis_notes
for delete
to authenticated
using ((select auth.uid()) = user_id);
