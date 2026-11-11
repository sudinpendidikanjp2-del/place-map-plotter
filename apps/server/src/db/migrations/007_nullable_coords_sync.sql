-- Lokasi boleh belum punya koordinat (mis. sekolah dari Dapodik). Koordinat bisa dicari otomatis dan ditandai perkiraan.
alter table locations alter column geom drop not null;
alter table locations
  add column coord_source text not null default 'manual' check (coord_source in ('manual', 'import', 'geocoded', 'none')),
  add column geocode_attempts smallint not null default 0,
  add column geocode_note text;
update locations set coord_source = 'import' where import_batch_id is not null;
create index locations_nocoord_idx on locations (id) where geom is null;
create index locations_geocoded_idx on locations (id) where coord_source = 'geocoded';

create table geocode_usage (
  day date primary key,
  n   integer not null default 0
);

-- Token API untuk pekerja terjadwal. Hanya hash yang disimpan, token asli ditampilkan sekali saat dibuat.
create table api_tokens (
  id           bigint generated always as identity primary key,
  name         text   not null,
  token_hash   text   not null unique,
  created_by   bigint references users (id) on delete set null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

-- Riwayat sinkronisasi dari sumber luar (Dapodik).
create table sync_runs (
  id              bigint generated always as identity primary key,
  source          text not null,
  scope           text not null,
  status          text not null default 'berjalan' check (status in ('berjalan', 'selesai', 'gagal', 'ditolak')),
  schools_seen    integer not null default 0,
  inserted        integer not null default 0,
  updated         integer not null default 0,
  failed          integer not null default 0,
  message         text,
  import_batch_id bigint references import_batches (id) on delete set null,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz
);
create index sync_runs_source_idx on sync_runs (source, id desc);

-- Pra-agregasi hanya menghitung lokasi yang punya koordinat.
create or replace function cc_rebuild_all() returns void language plpgsql as $$
begin
  truncate cluster_cells;
  insert into cluster_cells (z, cx, cy, kind, category, province, level, n, sum_lng, sum_lat, sum_students, sum_teachers)
  select z, floor(lng / (84.375 / power(2, z)))::int, floor(lat / (84.375 / power(2, z)))::int,
         kind, category, coalesce(province, ''), coalesce(level, ''), count(*), sum(lng), sum(lat),
         sum(coalesce(students, 0)), sum(coalesce(teachers, 0))
  from locations cross join generate_series(0, 14) as z
  where lng is not null
  group by 1, 2, 3, 4, 5, 6, 7;
  truncate stat_months;
  insert into stat_months (month, kind, category, province, level, n, students, teachers)
  select date_trunc('month', created_at)::date, kind, category, coalesce(province, ''), coalesce(level, ''), count(*),
         sum(coalesce(students, 0)), sum(coalesce(teachers, 0))
  from locations group by 1, 2, 3, 4, 5;
end $$;

create or replace function cc_insert() returns trigger language plpgsql as $$
begin
  insert into cluster_cells (z, cx, cy, kind, category, province, level, n, sum_lng, sum_lat, sum_students, sum_teachers)
  select z, floor(lng / (84.375 / power(2, z)))::int, floor(lat / (84.375 / power(2, z)))::int,
         kind, category, coalesce(province, ''), coalesce(level, ''), count(*), sum(lng), sum(lat),
         sum(coalesce(students, 0)), sum(coalesce(teachers, 0))
  from new_rows cross join generate_series(0, 14) as z
  where lng is not null
  group by 1, 2, 3, 4, 5, 6, 7
  on conflict (z, cx, cy, kind, category, province, level) do update
    set n = cluster_cells.n + excluded.n, sum_lng = cluster_cells.sum_lng + excluded.sum_lng,
        sum_lat = cluster_cells.sum_lat + excluded.sum_lat,
        sum_students = cluster_cells.sum_students + excluded.sum_students,
        sum_teachers = cluster_cells.sum_teachers + excluded.sum_teachers;
  insert into stat_months (month, kind, category, province, level, n, students, teachers)
  select date_trunc('month', created_at)::date, kind, category, coalesce(province, ''), coalesce(level, ''), count(*),
         sum(coalesce(students, 0)), sum(coalesce(teachers, 0))
  from new_rows group by 1, 2, 3, 4, 5
  on conflict (month, kind, category, province, level) do update
    set n = stat_months.n + excluded.n, students = stat_months.students + excluded.students,
        teachers = stat_months.teachers + excluded.teachers;
  return null;
end $$;

create or replace function cc_delete() returns trigger language plpgsql as $$
begin
  insert into cluster_cells (z, cx, cy, kind, category, province, level, n, sum_lng, sum_lat, sum_students, sum_teachers)
  select z, floor(lng / (84.375 / power(2, z)))::int, floor(lat / (84.375 / power(2, z)))::int,
         kind, category, coalesce(province, ''), coalesce(level, ''), -count(*), -sum(lng), -sum(lat),
         -sum(coalesce(students, 0)), -sum(coalesce(teachers, 0))
  from old_rows cross join generate_series(0, 14) as z
  where lng is not null
  group by 1, 2, 3, 4, 5, 6, 7
  on conflict (z, cx, cy, kind, category, province, level) do update
    set n = cluster_cells.n + excluded.n, sum_lng = cluster_cells.sum_lng + excluded.sum_lng,
        sum_lat = cluster_cells.sum_lat + excluded.sum_lat,
        sum_students = cluster_cells.sum_students + excluded.sum_students,
        sum_teachers = cluster_cells.sum_teachers + excluded.sum_teachers;
  delete from cluster_cells where n <= 0;
  insert into stat_months (month, kind, category, province, level, n, students, teachers)
  select date_trunc('month', created_at)::date, kind, category, coalesce(province, ''), coalesce(level, ''), -count(*),
         -sum(coalesce(students, 0)), -sum(coalesce(teachers, 0))
  from old_rows group by 1, 2, 3, 4, 5
  on conflict (month, kind, category, province, level) do update
    set n = stat_months.n + excluded.n, students = stat_months.students + excluded.students,
        teachers = stat_months.teachers + excluded.teachers;
  delete from stat_months where n <= 0;
  return null;
end $$;

create or replace function cc_update() returns trigger language plpgsql as $$
begin
  insert into cluster_cells (z, cx, cy, kind, category, province, level, n, sum_lng, sum_lat, sum_students, sum_teachers)
  select z, floor(o.lng / (84.375 / power(2, z)))::int, floor(o.lat / (84.375 / power(2, z)))::int,
         o.kind, o.category, coalesce(o.province, ''), coalesce(o.level, ''), -count(*), -sum(o.lng), -sum(o.lat),
         -sum(coalesce(o.students, 0)), -sum(coalesce(o.teachers, 0))
  from old_rows o join new_rows n using (id) cross join generate_series(0, 14) as z
  where o.lng is not null
    and (o.kind, o.category, o.province, o.level, o.lng, o.lat, o.students, o.teachers)
        is distinct from (n.kind, n.category, n.province, n.level, n.lng, n.lat, n.students, n.teachers)
  group by 1, 2, 3, 4, 5, 6, 7
  on conflict (z, cx, cy, kind, category, province, level) do update
    set n = cluster_cells.n + excluded.n, sum_lng = cluster_cells.sum_lng + excluded.sum_lng,
        sum_lat = cluster_cells.sum_lat + excluded.sum_lat,
        sum_students = cluster_cells.sum_students + excluded.sum_students,
        sum_teachers = cluster_cells.sum_teachers + excluded.sum_teachers;
  insert into cluster_cells (z, cx, cy, kind, category, province, level, n, sum_lng, sum_lat, sum_students, sum_teachers)
  select z, floor(n.lng / (84.375 / power(2, z)))::int, floor(n.lat / (84.375 / power(2, z)))::int,
         n.kind, n.category, coalesce(n.province, ''), coalesce(n.level, ''), count(*), sum(n.lng), sum(n.lat),
         sum(coalesce(n.students, 0)), sum(coalesce(n.teachers, 0))
  from old_rows o join new_rows n using (id) cross join generate_series(0, 14) as z
  where n.lng is not null
    and (o.kind, o.category, o.province, o.level, o.lng, o.lat, o.students, o.teachers)
        is distinct from (n.kind, n.category, n.province, n.level, n.lng, n.lat, n.students, n.teachers)
  group by 1, 2, 3, 4, 5, 6, 7
  on conflict (z, cx, cy, kind, category, province, level) do update
    set n = cluster_cells.n + excluded.n, sum_lng = cluster_cells.sum_lng + excluded.sum_lng,
        sum_lat = cluster_cells.sum_lat + excluded.sum_lat,
        sum_students = cluster_cells.sum_students + excluded.sum_students,
        sum_teachers = cluster_cells.sum_teachers + excluded.sum_teachers;
  delete from cluster_cells where n <= 0;

  insert into stat_months (month, kind, category, province, level, n, students, teachers)
  select date_trunc('month', o.created_at)::date, o.kind, o.category, coalesce(o.province, ''), coalesce(o.level, ''), -count(*),
         -sum(coalesce(o.students, 0)), -sum(coalesce(o.teachers, 0))
  from old_rows o join new_rows n using (id)
  where (o.kind, o.category, o.province, o.level, o.students, o.teachers) is distinct from (n.kind, n.category, n.province, n.level, n.students, n.teachers)
  group by 1, 2, 3, 4, 5
  on conflict (month, kind, category, province, level) do update
    set n = stat_months.n + excluded.n, students = stat_months.students + excluded.students,
        teachers = stat_months.teachers + excluded.teachers;
  insert into stat_months (month, kind, category, province, level, n, students, teachers)
  select date_trunc('month', n.created_at)::date, n.kind, n.category, coalesce(n.province, ''), coalesce(n.level, ''), count(*),
         sum(coalesce(n.students, 0)), sum(coalesce(n.teachers, 0))
  from old_rows o join new_rows n using (id)
  where (o.kind, o.category, o.province, o.level, o.students, o.teachers) is distinct from (n.kind, n.category, n.province, n.level, n.students, n.teachers)
  group by 1, 2, 3, 4, 5
  on conflict (month, kind, category, province, level) do update
    set n = stat_months.n + excluded.n, students = stat_months.students + excluded.students,
        teachers = stat_months.teachers + excluded.teachers;
  delete from stat_months where n <= 0;
  return null;
end $$;
