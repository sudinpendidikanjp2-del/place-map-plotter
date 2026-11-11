-- Pra-agregasi cluster: jumlah dan jumlah koordinat per sel grid, per zoom 0 sampai 14, per (jenis, kategori, provinsi).
-- Dijaga oleh pemicu per pernyataan, jadi impor besar tetap satu agregasi, bukan satu pembaruan per baris.
-- Ukuran sel sama dengan kueri langsung: 84,375 / 2^zoom derajat (kira-kira 60 piksel).
create table cluster_cells (
  z        smallint         not null,
  cx       integer          not null,
  cy       integer          not null,
  kind     text             not null,
  category text             not null,
  province text             not null default '',
  n        integer          not null,
  sum_lng  double precision not null,
  sum_lat  double precision not null,
  primary key (z, cx, cy, kind, category, province)
);
create index cluster_cells_empty_idx on cluster_cells (n) where n <= 0;

insert into cluster_cells (z, cx, cy, kind, category, province, n, sum_lng, sum_lat)
select z, floor(lng / (84.375 / power(2, z)))::int, floor(lat / (84.375 / power(2, z)))::int,
       kind, category, coalesce(province, ''), count(*), sum(lng), sum(lat)
from locations cross join generate_series(0, 14) as z
group by 1, 2, 3, 4, 5, 6;

create function cc_insert() returns trigger language plpgsql as $$
begin
  insert into cluster_cells (z, cx, cy, kind, category, province, n, sum_lng, sum_lat)
  select z, floor(lng / (84.375 / power(2, z)))::int, floor(lat / (84.375 / power(2, z)))::int,
         kind, category, coalesce(province, ''), count(*), sum(lng), sum(lat)
  from new_rows cross join generate_series(0, 14) as z
  group by 1, 2, 3, 4, 5, 6
  on conflict (z, cx, cy, kind, category, province) do update
    set n = cluster_cells.n + excluded.n,
        sum_lng = cluster_cells.sum_lng + excluded.sum_lng,
        sum_lat = cluster_cells.sum_lat + excluded.sum_lat;
  return null;
end $$;

create function cc_delete() returns trigger language plpgsql as $$
begin
  insert into cluster_cells (z, cx, cy, kind, category, province, n, sum_lng, sum_lat)
  select z, floor(lng / (84.375 / power(2, z)))::int, floor(lat / (84.375 / power(2, z)))::int,
         kind, category, coalesce(province, ''), -count(*), -sum(lng), -sum(lat)
  from old_rows cross join generate_series(0, 14) as z
  group by 1, 2, 3, 4, 5, 6
  on conflict (z, cx, cy, kind, category, province) do update
    set n = cluster_cells.n + excluded.n,
        sum_lng = cluster_cells.sum_lng + excluded.sum_lng,
        sum_lat = cluster_cells.sum_lat + excluded.sum_lat;
  delete from cluster_cells where n <= 0;
  return null;
end $$;

-- Pembaruan hanya menyentuh sel bila atribut yang memengaruhi cluster benar-benar berubah.
create function cc_update() returns trigger language plpgsql as $$
begin
  insert into cluster_cells (z, cx, cy, kind, category, province, n, sum_lng, sum_lat)
  select z, floor(o.lng / (84.375 / power(2, z)))::int, floor(o.lat / (84.375 / power(2, z)))::int,
         o.kind, o.category, coalesce(o.province, ''), -count(*), -sum(o.lng), -sum(o.lat)
  from old_rows o join new_rows n using (id) cross join generate_series(0, 14) as z
  where (o.kind, o.category, o.province, o.lng, o.lat) is distinct from (n.kind, n.category, n.province, n.lng, n.lat)
  group by 1, 2, 3, 4, 5, 6
  on conflict (z, cx, cy, kind, category, province) do update
    set n = cluster_cells.n + excluded.n,
        sum_lng = cluster_cells.sum_lng + excluded.sum_lng,
        sum_lat = cluster_cells.sum_lat + excluded.sum_lat;
  insert into cluster_cells (z, cx, cy, kind, category, province, n, sum_lng, sum_lat)
  select z, floor(n.lng / (84.375 / power(2, z)))::int, floor(n.lat / (84.375 / power(2, z)))::int,
         n.kind, n.category, coalesce(n.province, ''), count(*), sum(n.lng), sum(n.lat)
  from old_rows o join new_rows n using (id) cross join generate_series(0, 14) as z
  where (o.kind, o.category, o.province, o.lng, o.lat) is distinct from (n.kind, n.category, n.province, n.lng, n.lat)
  group by 1, 2, 3, 4, 5, 6
  on conflict (z, cx, cy, kind, category, province) do update
    set n = cluster_cells.n + excluded.n,
        sum_lng = cluster_cells.sum_lng + excluded.sum_lng,
        sum_lat = cluster_cells.sum_lat + excluded.sum_lat;
  delete from cluster_cells where n <= 0;
  return null;
end $$;

create function cc_truncate() returns trigger language plpgsql as $$
begin
  truncate cluster_cells;
  return null;
end $$;

create trigger locations_cc_insert after insert on locations
  referencing new table as new_rows for each statement execute function cc_insert();
create trigger locations_cc_update after update on locations
  referencing old table as old_rows new table as new_rows for each statement execute function cc_update();
create trigger locations_cc_delete after delete on locations
  referencing old table as old_rows for each statement execute function cc_delete();
create trigger locations_cc_truncate after truncate on locations
  for each statement execute function cc_truncate();
