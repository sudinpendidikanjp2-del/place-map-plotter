// Data UJI sintetis untuk pengembangan dan benchmark. Bukan data nyata dan tidak boleh dipakai di produksi.
// Pemakaian: DATABASE_URL=... node scripts/seed.ts [jumlah] [--reset]
import { createSql } from "../apps/server/src/db/client.ts";
import { migrate } from "../apps/server/src/db/migrate.ts";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL belum diatur.");
const count = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 5000);
const reset = process.argv.includes("--reset");

const REGIONS = [
  { province: "DKI Jakarta", city: "Kota Jakarta Pusat", districts: ["Gambir", "Menteng", "Tanah Abang"], lat: -6.19, lng: 106.83, spread: 0.05 },
  { province: "Jawa Barat", city: "Kota Bandung", districts: ["Coblong", "Cicendo", "Sukajadi"], lat: -6.91, lng: 107.61, spread: 0.08 },
  { province: "Jawa Tengah", city: "Kota Semarang", districts: ["Semarang Tengah", "Candisari"], lat: -7.0, lng: 110.42, spread: 0.08 },
  { province: "Jawa Timur", city: "Kota Surabaya", districts: ["Genteng", "Tegalsari"], lat: -7.26, lng: 112.75, spread: 0.08 },
  { province: "Sumatera Utara", city: "Kota Medan", districts: ["Medan Baru", "Medan Petisah"], lat: 3.59, lng: 98.67, spread: 0.08 },
  { province: "Sulawesi Selatan", city: "Kota Makassar", districts: ["Panakkukang", "Rappocini"], lat: -5.15, lng: 119.43, spread: 0.08 },
  { province: "Bali", city: "Kota Denpasar", districts: ["Denpasar Barat", "Denpasar Timur"], lat: -8.67, lng: 115.21, spread: 0.06 },
  { province: "Kalimantan Timur", city: "Kota Balikpapan", districts: ["Balikpapan Kota", "Balikpapan Selatan"], lat: -1.24, lng: 116.85, spread: 0.1 },
];
const SCHOOL = ["TK", "SD", "SMP", "SMA", "SMK"];
const FACILITY = ["Perpustakaan", "Laboratorium", "Lapangan olahraga", "Aula"];
const ASSET = ["Tanah", "Gedung", "Kendaraan dinas"];

const sql = createSql(url, 2);
try {
  await migrate(sql);
  if (reset) await sql`truncate locations, import_batches restart identity cascade`;
  const batch = 20_000;
  for (let done = 0; done < count; done += batch) {
    const n = Math.min(batch, count - done);
    await sql`
      insert into locations (kind, name, category, address, students, teachers, founded_year, geom, province, city, district)
      select kind, name, category, address, students, teachers, founded_year, geom, province, city, district from (
        select g,
          case when r < 0.7 then 'sekolah' when r < 0.88 then 'fasilitas' else 'aset' end as kind,
          reg, r
        from (select g, random() as r, floor(random() * ${REGIONS.length})::int as reg from generate_series(1, ${n}) g) a
      ) b
      cross join lateral (
        select
          (${sql.json(REGIONS)}::jsonb -> reg) as j
      ) x
      cross join lateral (
        select
          case kind when 'sekolah' then (${sql.json(SCHOOL)}::jsonb ->> floor(random() * ${SCHOOL.length})::int)
                    when 'fasilitas' then (${sql.json(FACILITY)}::jsonb ->> floor(random() * ${FACILITY.length})::int)
                    else (${sql.json(ASSET)}::jsonb ->> floor(random() * ${ASSET.length})::int) end as category,
          (x.j ->> 'province') as province,
          (x.j ->> 'city') as city,
          (x.j -> 'districts' ->> floor(random() * jsonb_array_length(x.j -> 'districts'))::int) as district
      ) c
      cross join lateral (
        select
          (case kind when 'sekolah' then 'Sekolah Uji ' when 'fasilitas' then 'Fasilitas Uji ' else 'Aset Uji ' end) || (${done} + g) as name,
          'Jl. Uji No. ' || (1 + floor(random() * 200))::int || ', Kec. ' || c.district || ', ' || c.city || ', ' || c.province as address,
          case when kind = 'sekolah' then (40 + floor(random() * 900))::int end as students,
          case when kind = 'sekolah' then (4 + floor(random() * 50))::int end as teachers,
          case when kind = 'sekolah' then (1950 + floor(random() * 70))::smallint end as founded_year,
          ST_SetSRID(ST_MakePoint((x.j ->> 'lng')::float8 + (random() - 0.5) * 2 * (x.j ->> 'spread')::float8,
                                  (x.j ->> 'lat')::float8 + (random() - 0.5) * 2 * (x.j ->> 'spread')::float8), 4326) as geom
      ) d`;
  }
  await sql`update locations set level = category where kind = 'sekolah' and level is null`;
  await sql`analyze locations`;
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from locations`;
  console.log(`Data uji siap: ${n.toLocaleString("id-ID")} lokasi.`);
} finally {
  await sql.end();
}
