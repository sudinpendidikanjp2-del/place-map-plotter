-- Jenjang (level) sebagai kolom tersendiri, NPSN sebagai kunci pembaruan dari Dapodik, dan gambar lokasi.
alter table locations
  add column level text,
  add column npsn  text;

-- Jenjang yang selama ini tersimpan di kategori untuk sekolah dipindahkan ke kolom jenjang.
update locations set level = upper(category)
where kind = 'sekolah' and upper(category) in
  ('PAUD','KB','TK','TPA','SPS','SD','SMP','SMA','SMK','SLB','SDLB','SMPLB','SMALB','MI','MTS','MA','PKBM','SKB');

create unique index locations_npsn_key on locations (npsn) where npsn is not null;
create index locations_level_idx on locations (level) where level is not null;
create index locations_district_idx on locations (district) where district is not null;

create table location_images (
  id          bigint generated always as identity primary key,
  location_id bigint not null references locations (id) on delete cascade,
  mime        text   not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  width       integer not null check (width between 1 and 20000),
  height      integer not null check (height between 1 and 20000),
  bytes       integer not null default 0,
  thumb_bytes integer not null default 0,
  ready       boolean not null default false,
  caption     text,
  position    integer not null default 0,
  created_by  bigint references users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index location_images_location_idx on location_images (location_id, position, id);

alter table import_batches add column updated integer not null default 0;

-- Jenjang ikut menjadi dimensi pra-agregasi.
alter table cluster_cells add column level text not null default '';
alter table cluster_cells drop constraint cluster_cells_pkey;
alter table cluster_cells add primary key (z, cx, cy, kind, category, province, level);
alter table stat_months add column level text not null default '';
alter table stat_months drop constraint stat_months_pkey;
alter table stat_months add primary key (month, kind, category, province, level);

create or replace function cc_rebuild_all() returns void language plpgsql as $$
begin
  truncate cluster_cells;
  insert into cluster_cells (z, cx, cy, kind, category, province, level, n, sum_lng, sum_lat, sum_students, sum_teachers)
  select z, floor(lng / (84.375 / power(2, z)))::int, floor(lat / (84.375 / power(2, z)))::int,
         kind, category, coalesce(province, ''), coalesce(level, ''), count(*), sum(lng), sum(lat),
         sum(coalesce(students, 0)), sum(coalesce(teachers, 0))
  from locations cross join generate_series(0, 14) as z
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
  where (o.kind, o.category, o.province, o.level, o.lng, o.lat, o.students, o.teachers)
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
  where (o.kind, o.category, o.province, o.level, o.lng, o.lat, o.students, o.teachers)
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

select cc_rebuild_all();
