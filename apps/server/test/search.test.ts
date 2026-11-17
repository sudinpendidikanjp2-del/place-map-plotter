import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { start, type Harness } from "./helpers.ts";

let h: Harness;
before(async () => {
  h = await start({});
});
after(async () => {
  await h.close();
});

async function seed() {
  await h.sql`truncate locations restart identity cascade`;
  await h.sql`
    insert into locations (kind, name, category, level, address, province, city, district, npsn) values
    ('sekolah', 'SD NEGERI KEMAYORAN 01', 'SD', 'SD', 'Jl. Kemayoran Raya', 'DKI Jakarta', 'Kota Jakarta Pusat', 'Kemayoran', '20100001'),
    ('sekolah', 'SDN KEMAYORAN 03', 'SD', 'SD', 'Jl. Kemayoran Gempol', 'DKI Jakarta', 'Kota Jakarta Pusat', 'Kemayoran', '20100002'),
    ('sekolah', 'SMP NEGERI 5 SENEN', 'SMP', 'SMP', 'Jl. Kwini', 'DKI Jakarta', 'Kota Jakarta Pusat', 'Senen', '20100003'),
    ('sekolah', 'SDIT INSAN MULIA', 'SD', 'SD', 'Jl. Medan Merdeka', 'DKI Jakarta', 'Kota Jakarta Pusat', 'Gambir', '20100004'),
    ('fasilitas', 'Perpustakaan Daerah', 'Perpustakaan', null, 'Jl. Kemayoran Baru', 'DKI Jakarta', 'Kota Jakarta Pusat', 'Kemayoran', null)`;
}

async function names(admin: { json: Function }, q: string, extra = ""): Promise<string[]> {
  const r = await admin.json(`/api/locations?sort=relevan&q=${encodeURIComponent(q)}${extra}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.items.map((x: { name: string }) => x.name);
}

test("pencarian memaafkan salah ketik dan memahami singkatan sdn = sd negeri", async () => {
  const admin = await h.client("admin");
  await seed();
  assert.deepEqual((await names(admin, "kemayoran")).sort(), ["Perpustakaan Daerah", "SD NEGERI KEMAYORAN 01", "SDN KEMAYORAN 03"]);
  assert.deepEqual((await names(admin, "kemayuran sd")).sort(), ["SD NEGERI KEMAYORAN 01", "SDN KEMAYORAN 03"], "salah ketik tetap ketemu");
  assert.deepEqual((await names(admin, "sdn kemayoran")).sort(), ["SD NEGERI KEMAYORAN 01", "SDN KEMAYORAN 03"], "sdn dan sd negeri dianggap sama");
  assert.deepEqual((await names(admin, "sd negeri kemayoran")).sort(), ["SD NEGERI KEMAYORAN 01", "SDN KEMAYORAN 03"]);
  assert.deepEqual(await names(admin, "negri senen"), ["SMP NEGERI 5 SENEN"], "negri -> negeri");
  assert.deepEqual(await names(admin, "20100004"), ["SDIT INSAN MULIA"], "NPSN");
  assert.deepEqual(await names(admin, "insan mulya"), ["SDIT INSAN MULIA"]);
  assert.deepEqual(await names(admin, "zzzz tidak ada"), []);
  assert.deepEqual(await names(admin, "   "), (await admin.json("/api/locations")).body.items.map((x: { name: string }) => x.name), "kueri kosong = tanpa pencarian");
});

test("hasil diurutkan menurut kecocokan: nama diawali kueri, lalu nama memuatnya, lalu alamat atau mirip", async () => {
  const admin = await h.client("admin");
  await seed();
  const r = await names(admin, "kemayoran");
  assert.equal(r[r.length - 1], "Perpustakaan Daerah", "hanya alamat yang cocok, jadi paling akhir");
  assert.deepEqual((await names(admin, "sd negeri")).slice(0, 1), ["SD NEGERI KEMAYORAN 01"], "awalan nama paling atas");
});

test("halaman berikutnya pada urutan kecocokan tidak menduplikasi dan tidak melewatkan", async () => {
  const admin = await h.client("admin");
  await seed();
  const all = await names(admin, "kemayoran");
  const seen: string[] = [];
  let cursor = "";
  for (let i = 0; i < 5; i++) {
    const r = await admin.json(`/api/locations?sort=relevan&q=kemayoran&limit=1${cursor ? `&cursor=${cursor}` : ""}`);
    seen.push(...r.body.items.map((x: { name: string }) => x.name));
    if (!r.body.nextCursor) break;
    cursor = r.body.nextCursor;
  }
  assert.deepEqual(seen, all);
  assert.equal((await admin.json(`/api/locations?sort=relevan&q=kemayoran&cursor=${Buffer.from(JSON.stringify({ r: 9, id: "1" })).toString("base64url")}`)).status, 400);
});

test("filter kecamatan boleh lebih dari satu, dan tidak ikut pra-agregasi peta", async () => {
  const admin = await h.client("admin");
  await seed();
  const q = (qs: string) => names(admin, "", qs);
  assert.deepEqual((await q("&district=Senen&district=Gambir")).sort(), ["SDIT INSAN MULIA", "SMP NEGERI 5 SENEN"]);
  assert.deepEqual(await q("&district=Senen"), ["SMP NEGERI 5 SENEN"]);
  assert.deepEqual((await q("&district=Kemayoran&district=Senen&level=SD")).sort(), ["SD NEGERI KEMAYORAN 01", "SDN KEMAYORAN 03"]);
  assert.equal((await admin.json("/api/locations?district=" + "x".repeat(10) + "&district=y")).status, 200);
  const many = Array.from({ length: 51 }, (_, i) => `district=K${i}`).join("&");
  assert.equal((await admin.json(`/api/locations?${many}`)).status, 400);
});
