-- ============================================================================
-- Migration 0001 — Fundação: contas, créditos, buscas e dedup (Épico 0.2)
--
-- Aplicar via SQL Editor do dashboard OU `npx supabase db push` (ver supabase/README.md)
--
-- Convenções:
--  - Escritas em credit_ledger/purchases/searches/delivered_leads acontecem
--    SOMENTE pelo backend (service_role, que ignora RLS).
--  - Usuário autenticado só LÊ as próprias linhas (policies de SELECT).
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- profiles — 1 linha por usuário do auth.users (criada por trigger)
-- ────────────────────────────────────────────────────────────────────────────
create table public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  email             text,
  role              text not null default 'user' check (role in ('user', 'admin')),
  termos_aceitos_em timestamptz,          -- registro do aceite dos Termos de Uso (1.1)
  criado_em         timestamptz not null default now()
);

comment on table public.profiles is 'Perfil de aplicação. role=admin é atribuído manualmente no banco (história 1.4).';

-- ────────────────────────────────────────────────────────────────────────────
-- credit_ledger — extrato de créditos (saldo = sum(delta))
-- ────────────────────────────────────────────────────────────────────────────
create table public.credit_ledger (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  delta           integer not null,       -- positivo = crédito, negativo = consumo
  motivo          text not null check (motivo in ('trial', 'compra', 'consumo', 'estorno', 'ajuste')),
  referencia_tipo text check (referencia_tipo in ('purchase', 'search')),
  referencia_id   text,                   -- id da purchase ou search relacionada
  criado_em       timestamptz not null default now()
);

create index idx_credit_ledger_user on public.credit_ledger (user_id, criado_em desc);

-- Impede conceder o trial duas vezes para o mesmo usuário
create unique index idx_credit_ledger_trial_unico
  on public.credit_ledger (user_id) where (motivo = 'trial');

-- ────────────────────────────────────────────────────────────────────────────
-- purchases — compras de pacotes via Pix
-- ────────────────────────────────────────────────────────────────────────────
create table public.purchases (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  pacote         text not null,           -- ex: '200', '500', '1000'
  creditos       integer not null,
  valor_centavos integer not null,
  status         text not null default 'pendente' check (status in ('pendente', 'pago', 'expirado', 'cancelado')),
  pix_txid       text,
  criado_em      timestamptz not null default now(),
  pago_em        timestamptz
);

create index idx_purchases_user on public.purchases (user_id, criado_em desc);

-- ────────────────────────────────────────────────────────────────────────────
-- searches — histórico de buscas
-- ────────────────────────────────────────────────────────────────────────────
create table public.searches (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  nicho          text not null,
  regiao         text not null,
  qtd_solicitada integer not null,
  qtd_entregue   integer,
  custo_creditos integer,
  arquivo        text,
  status         text not null default 'executando' check (status in ('executando', 'concluida', 'erro')),
  criado_em      timestamptz not null default now()
);

create index idx_searches_user on public.searches (user_id, criado_em desc);

-- ────────────────────────────────────────────────────────────────────────────
-- delivered_leads — base do dedup de 6 meses por usuário
-- ────────────────────────────────────────────────────────────────────────────
create table public.delivered_leads (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  cnpj         text not null,
  search_id    uuid references public.searches(id) on delete set null,
  delivered_at timestamptz not null default now()
);

-- Índices exigidos pela história 0.2 — sustentam a consulta de dedup:
-- "esse CNPJ já foi entregue a esse usuário nos últimos 6 meses?"
create index idx_delivered_leads_user_cnpj on public.delivered_leads (user_id, cnpj);
create index idx_delivered_leads_user_data on public.delivered_leads (user_id, delivered_at);

-- ────────────────────────────────────────────────────────────────────────────
-- RLS — usuário só lê os próprios dados; escrita só via service_role
-- ────────────────────────────────────────────────────────────────────────────
alter table public.profiles        enable row level security;
alter table public.credit_ledger   enable row level security;
alter table public.purchases       enable row level security;
alter table public.searches        enable row level security;
alter table public.delivered_leads enable row level security;

create policy "usuario le o proprio perfil"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

create policy "usuario le o proprio extrato"
  on public.credit_ledger for select
  to authenticated
  using (auth.uid() = user_id);

create policy "usuario le as proprias compras"
  on public.purchases for select
  to authenticated
  using (auth.uid() = user_id);

create policy "usuario le as proprias buscas"
  on public.searches for select
  to authenticated
  using (auth.uid() = user_id);

create policy "usuario le os proprios leads entregues"
  on public.delivered_leads for select
  to authenticated
  using (auth.uid() = user_id);

-- Sem policies de INSERT/UPDATE/DELETE: apenas o service_role (backend) escreve.

-- ────────────────────────────────────────────────────────────────────────────
-- saldo_creditos() — soma do extrato.
-- SECURITY INVOKER: com o token do usuário a RLS limita ao próprio extrato;
-- o backend (service_role) pode consultar qualquer uid.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.saldo_creditos(uid uuid default auth.uid())
returns integer
language sql
stable
set search_path = public
as $$
  select coalesce(sum(delta), 0)::integer
  from public.credit_ledger
  where user_id = uid;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Trigger: cria o profile quando um usuário se cadastra no Auth.
-- Lê o aceite dos termos enviado no signUp (options.data.termos_aceitos_em).
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, termos_aceitos_em)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'termos_aceitos_em', '')::timestamptz
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ────────────────────────────────────────────────────────────────────────────
-- Trigger: concede 20 créditos de trial quando o email é confirmado
-- (decisão de negócio: trial após confirmação). O índice único acima
-- garante idempotência mesmo em corrida.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.conceder_trial()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null then
    insert into public.credit_ledger (user_id, delta, motivo)
    values (new.id, 20, 'trial')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_confirmed
  after update on auth.users
  for each row execute function public.conceder_trial();
