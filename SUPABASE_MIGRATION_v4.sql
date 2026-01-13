-- Pro Automobile Zeit - Erweiterungen (v3)
-- 1) jobs: neue Felder + Trigger für Auftragsnummer
alter table if exists public.jobs
  add column if not exists job_no text,
  add column if not exists odometer_km integer,
  add column if not exists dropoff_at timestamptz,
  add column if not exists pickup_at timestamptz,
  add column if not exists important boolean not null default false,
  add column if not exists checklist jsonb not null default '{}'::jsonb;

-- Optional: Notizen (falls du willst)
alter table if exists public.jobs
  add column if not exists notes text;

-- Auftragsnummer automatisch (PA-YYYY-0001)
do $$
begin
  if not exists (select 1 from pg_class where relname = 'job_no_seq') then
    create sequence public.job_no_seq;
  end if;
exception when others then
  -- ignore
end$$;

create or replace function public.set_job_no()
returns trigger as $$
declare
  yy text;
  n bigint;
begin
  if new.job_no is null or new.job_no = '' then
    yy := to_char(now(), 'YYYY');
    n := nextval('public.job_no_seq');
    new.job_no := 'PA-' || yy || '-' || lpad(n::text, 4, '0');
  end if;
  return new;
end;
$$ language plpgsql;

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_set_job_no'
  ) then
    create trigger trg_set_job_no
    before insert on public.jobs
    for each row execute function public.set_job_no();
  end if;
exception when others then
  -- ignore
end$$;

create unique index if not exists jobs_job_no_unique on public.jobs(job_no);

-- 2) Positionen (Arbeiten/Material)
create table if not exists public.job_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  item_type text not null default 'arbeit',
  description text not null default '',
  qty numeric not null default 1,
  unit_price numeric not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists job_items_job_id_idx on public.job_items(job_id);

-- 3) Fotos / Dokumente Metadaten
create table if not exists public.job_photos (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  path text not null,
  kind text not null default 'general', -- general | id
  created_at timestamptz not null default now()
);
create index if not exists job_photos_job_id_idx on public.job_photos(job_id);

-- 4) Storage Bucket anlegen: job-photos
-- Supabase UI: Storage -> Create bucket -> Name: job-photos -> Public: ON
-- Wenn du RLS eingeschaltet hast, bitte Policies anpassen oder RLS aus lassen.

-- 5) V4: RLS / Policies (damit Löschen & Upload sicher funktionieren)
-- Tabellen-RLS ausschalten (ohne Login: einfachste & stabilste Variante)
alter table if exists public.jobs disable row level security;
alter table if exists public.entries disable row level security;
alter table if exists public.signatures disable row level security;
alter table if exists public.job_items disable row level security;
alter table if exists public.job_photos disable row level security;

-- Storage Bucket "job-photos" sicherstellen & public setzen
do $$
begin
  insert into storage.buckets (id, name, public)
  values ('job-photos', 'job-photos', true)
  on conflict (id) do update set public = true;
exception when others then
  -- ignore if storage schema not available
end $$;

-- Storage Policies: Upload / Lesen / Löschen erlauben (für anon key, ohne Login)
do $$
begin
  -- SELECT
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='job_photos_select') then
    execute $$create policy job_photos_select on storage.objects for select
      using (bucket_id = 'job-photos');$$;
  end if;

  -- INSERT
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='job_photos_insert') then
    execute $$create policy job_photos_insert on storage.objects for insert
      with check (bucket_id = 'job-photos');$$;
  end if;

  -- DELETE
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='job_photos_delete') then
    execute $$create policy job_photos_delete on storage.objects for delete
      using (bucket_id = 'job-photos');$$;
  end if;

  -- UPDATE (optional)
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='job_photos_update') then
    execute $$create policy job_photos_update on storage.objects for update
      using (bucket_id = 'job-photos') with check (bucket_id = 'job-photos');$$;
  end if;
exception when others then
  -- ignore
end $$;
