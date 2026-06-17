-- ============================================================
-- JOHAN · Barbier — Création des tables Supabase
-- À exécuter UNE FOIS dans : Supabase → SQL Editor → New query → Run
-- ============================================================

-- Réservations (1 ligne = 1 RDV). La contrainte UNIQUE(date, time)
-- empêche au niveau de la base qu'un créneau soit pris deux fois.
create table if not exists public.bookings (
  id           text primary key,
  service      text not null,
  service_label text,
  price        int,
  date         text not null,
  date_label   text,
  time         text not null,
  name         text,
  phone        text,
  created_at   timestamptz default now(),
  unique (date, time)
);

-- Réglages (horaires par jour, congés, créneaux bloqués) : une seule ligne id=1.
create table if not exists public.settings (
  id   int primary key,
  data jsonb not null default '{}'::jsonb
);

insert into public.settings (id, data) values (1, '{}'::jsonb)
  on conflict (id) do nothing;

-- Sécurité : on active RLS. Le serveur utilise la clé SECRÈTE (service_role) qui
-- contourne RLS ; les clés publiques/anon n'ont donc aucun accès aux données.
alter table public.bookings enable row level security;
alter table public.settings enable row level security;
