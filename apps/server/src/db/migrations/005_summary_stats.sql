-- Jumlah murid dan guru ikut diagregasi per sel, dan tabel bulanan baru melayani ringkasan tanpa area.
-- Ringkasan laporan dan strip angka di peta jadi tidak bergantung pada jumlah baris.
alter table cluster_cells
  add column sum_students bigint not null default 0,
  add column sum_teachers bigint not null default 0;

create table stat_months (
  month    date    not null,
  kind     text    not null,
  category text    not null,
  province text    not null default '',
  n        integer not null,
  students bigint  not null default 0,
  teachers bigint  not null default 0,
  primary key (month, kind, category, province)
);
create index stat_months_empty_idx on stat_months (n) where n <= 0;

create function cc_rebuild_all() returns void language plpgsql as $$
begin
  truncate cluster_cells;
  insert into cluster_cells (z, cx, cy, kind, category, province, n, sum_lng, sum_lat, sum_students, sum_teachers)
  select z, floor(lng / (84.375 / power(2, z)))::int, floor(lat / (84.375 / power(2, z)))::int,
         kind, category, coalesce(province, ''), count(*), sum(lng), sum(lat),
         sum(coalesce(students, 0)), sum(coalesce(teachers, 0))
  from locations cross join generate_series(0, 14) as z
  group by 1, 2, 3, 4, 5, 6;
  truncate stat_months;
  insert into stat_months (month, kind, category, province, n, students, teachers)
  select date_trunc('month', created_at)::date, kind, category, coalesce(province, ''), count(*),
         sum(coalesce(students, 0)), sum(coalesce(teachers, 0))
  from locations group by 1, 2, 3, 4;
end $$;

select cc_rebuild_all();

create or replace function cc_insert() returns trigger language plpgsql as $$
begin
  insert into cluster_cells (z, cx, cy, kind, category, province, n, sum_lng, sum_lat, sum_students, sum_teachers)
  select z, floor(lng / (84.375 / power(2, z)))::int, floor(lat / (84.375 / power(2, z)))::int,
         kind, category, coalesce(province, ''), count(*), sum(lng), sum(lat),
         sum(coalesce(students, 0)), sum(coalesce(teachers, 0))
  from new_rows cross join generate_series(0, 14) as z
  group by 1, 2, 3, 4, 5, 6
  on conflict (z, cx, cy, kind, category, province) do update
    set n = cluster_cells.n + excluded.n, sum_lng = cluster_cells.sum_lng + excluded.sum_lng,
        sum_lat = cluster_cells.sum_lat + excluded.sum_lat,
        sum_students = cluster_cells.sum_students + excluded.sum_students,
        sum_teachers = cluster_cells.sum_teachers + excluded.sum_teachers;
  insert into stat_months (month, kind, category, province, n, students, teachers)
  select date_trunc('month', created_at)::date, kind, category, coalesce(province, ''), count(*),
         sum(coalesce(students, 0)), sum(coalesce(teachers, 0))
  from new_rows group by 1, 2, 3, 4
  on conflict (month, kind, category, province) do update
    set n = stat_months.n + excluded.n, students = stat_months.students + excluded.students,
        teachers = stat_months.teachers + excluded.teachers;
  return null;
end $$;

create or replace function cc_delete() returns trigger language plpgsql as $$
begin
  insert into cluster_cells (z, cx, cy, kind, category, province, n, sum_lng, sum_lat, sum_students, sum_teachers)
  select z, floor(lng / (84.375 / power(2, z)))::int, floor(lat / (84.375 / power(2, z)))::int,
         kind, category, coalesce(province, ''), -count(*), -sum(lng), -sum(lat),
         -sum(coalesce(students, 0)), -sum(coalesce(teachers, 0))
  from old_rows cross join generate_series(0, 14) as z
  group by 1, 2, 3, 4, 5, 6
  on conflict (z, cx, cy, kind, category, province) do update
    set n = cluster_cells.n + excluded.n, sum_lng = cluster_cells.sum_lng + excluded.sum_lng,
        sum_lat = cluster_cells.sum_lat + excluded.sum_lat,
        sum_students = cluster_cells.sum_students + excluded.sum_students,
        sum_teachers = cluster_cells.sum_teachers + excluded.sum_teachers;
  delete from cluster_cells where n <= 0;
  insert into stat_months (month, kind, category, province, n, students, teachers)
  select date_trunc('month', created_at)::date, kind, category, coalesce(province, ''), -count(*),
         -sum(coalesce(students, 0)), -sum(coalesce(teachers, 0))
  from old_rows group by 1, 2, 3, 4
  on conflict (month, kind, category, province) do update
    set n = stat_months.n + excluded.n, students = stat_months.students + excluded.students,
        teachers = stat_months.teachers + excluded.teachers;
  delete from stat_months where n <= 0;
  return null;
end $$;

create or replace function cc_update() returns trigger language plpgsql as $$
begin
  insert into cluster_cells (z, cx, cy, kind, category, province, n, sum_lng, sum_lat, sum_students, sum_teachers)
  select z, floor(o.lng / (84.375 / power(2, z)))::int, floor(o.lat / (84.375 / power(2, z)))::int,
         o.kind, o.category, coalesce(o.province, ''), -count(*), -sum(o.lng), -sum(o.lat),
         -sum(coalesce(o.students, 0)), -sum(coalesce(o.teachers, 0))
  from old_rows o join new_rows n using (id) cross join generate_series(0, 14) as z
  where (o.kind, o.category, o.province, o.lng, o.lat, o.students, o.teachers)
        is distinct from (n.kind, n.category, n.province, n.lng, n.lat, n.students, n.teachers)
  group by 1, 2, 3, 4, 5, 6
  on conflict (z, cx, cy, kind, category, province) do update
    set n = cluster_cells.n + excluded.n, sum_lng = cluster_cells.sum_lng + excluded.sum_lng,
        sum_lat = cluster_cells.sum_lat + excluded.sum_lat,
        sum_students = cluster_cells.sum_students + excluded.sum_students,
        sum_teachers = cluster_cells.sum_teachers + excluded.sum_teachers;
  insert into cluster_cells (z, cx, cy, kind, category, province, n, sum_lng, sum_lat, sum_students, sum_teachers)
  select z, floor(n.lng / (84.375 / power(2, z)))::int, floor(n.lat / (84.375 / power(2, z)))::int,
         n.kind, n.category, coalesce(n.province, ''), count(*), sum(n.lng), sum(n.lat),
         sum(coalesce(n.students, 0)), sum(coalesce(n.teachers, 0))
  from old_rows o join new_rows n using (id) cross join generate_series(0, 14) as z
  where (o.kind, o.category, o.province, o.lng, o.lat, o.students, o.teachers)
        is distinct from (n.kind, n.category, n.province, n.lng, n.lat, n.students, n.teachers)
  group by 1, 2, 3, 4, 5, 6
  on conflict (z, cx, cy, kind, category, province) do update
    set n = cluster_cells.n + excluded.n, sum_lng = cluster_cells.sum_lng + excluded.sum_lng,
        sum_lat = cluster_cells.sum_lat + excluded.sum_lat,
        sum_students = cluster_cells.sum_students + excluded.sum_students,
        sum_teachers = cluster_cells.sum_teachers + excluded.sum_teachers;
  delete from cluster_cells where n <= 0;

  insert into stat_months (month, kind, category, province, n, students, teachers)
  select date_trunc('month', o.created_at)::date, o.kind, o.category, coalesce(o.province, ''), -count(*),
         -sum(coalesce(o.students, 0)), -sum(coalesce(o.teachers, 0))
  from old_rows o join new_rows n using (id)
  where (o.kind, o.category, o.province, o.students, o.teachers) is distinct from (n.kind, n.category, n.province, n.students, n.teachers)
  group by 1, 2, 3, 4
  on conflict (month, kind, category, province) do update
    set n = stat_months.n + excluded.n, students = stat_months.students + excluded.students,
        teachers = stat_months.teachers + excluded.teachers;
  insert into stat_months (month, kind, category, province, n, students, teachers)
  select date_trunc('month', n.created_at)::date, n.kind, n.category, coalesce(n.province, ''), count(*),
         sum(coalesce(n.students, 0)), sum(coalesce(n.teachers, 0))
  from old_rows o join new_rows n using (id)
  where (o.kind, o.category, o.province, o.students, o.teachers) is distinct from (n.kind, n.category, n.province, n.students, n.teachers)
  group by 1, 2, 3, 4
  on conflict (month, kind, category, province) do update
    set n = stat_months.n + excluded.n, students = stat_months.students + excluded.students,
        teachers = stat_months.teachers + excluded.teachers;
  delete from stat_months where n <= 0;
  return null;
end $$;

create or replace function cc_truncate() returns trigger language plpgsql as $$
begin
  truncate cluster_cells;
  truncate stat_months;
  return null;
end $$;
