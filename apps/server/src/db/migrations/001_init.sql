create extension if not exists postgis;
create extension if not exists pg_trgm;

create table users (
  id            bigint generated always as identity primary key,
  email         text not null,
  name          text not null,
  password_hash text not null,
  role          text not null check (role in ('viewer', 'editor', 'admin')),
  disabled      boolean not null default false,
  created_at    timestamptz not null default now()
);
create unique index users_email_key on users (lower(email));

create table sessions (
  token_hash text primary key,
  user_id    bigint not null references users (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index sessions_user_idx on sessions (user_id);
create index sessions_expires_idx on sessions (expires_at);

create table import_batches (
  id           bigint generated always as identity primary key,
  filename     text not null,
  default_kind text not null check (default_kind in ('sekolah', 'fasilitas', 'aset')),
  status       text not null default 'menunggu'
               check (status in ('menunggu', 'berjalan', 'selesai', 'gagal', 'dibatalkan')),
  total        integer not null default 0,
  inserted     integer not null default 0,
  failed       integer not null default 0,
  errors       jsonb not null default '[]',
  message      text,
  created_by   bigint references users (id) on delete set null,
  created_at   timestamptz not null default now(),
  finished_at  timestamptz
);

create table locations (
  id              bigint generated always as identity primary key,
  kind            text not null check (kind in ('sekolah', 'fasilitas', 'aset')),
  name            text not null check (length(name) between 1 and 200),
  category        text not null default 'Umum',
  address         text,
  description     text,
  founded_year    smallint check (founded_year between 1000 and 2100),
  photo_url       text,
  students        integer check (students >= 0),
  teachers        integer check (teachers >= 0),
  attributes      jsonb not null default '{}',
  geom            geometry(Point, 4326) not null,
  province        text,
  city            text,
  district        text,
  import_batch_id bigint references import_batches (id) on delete set null,
  created_by      bigint references users (id) on delete set null,
  updated_by      bigint references users (id) on delete set null,
  version         integer not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index locations_geom_idx     on locations using gist (geom);
create index locations_kind_idx     on locations (kind);
create index locations_category_idx on locations (category);
create index locations_region_idx   on locations (province, city, district);
create index locations_created_idx  on locations (created_at desc, id desc);
create index locations_name_idx     on locations (name, id);
create index locations_batch_idx    on locations (import_batch_id) where import_batch_id is not null;
create index locations_name_trgm    on locations using gin (name gin_trgm_ops);
create index locations_addr_trgm    on locations using gin (address gin_trgm_ops);
