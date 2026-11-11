import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sampleLocation, start, type Harness } from "./helpers.ts";

let h: Harness;
let fake: Server;
let fakeSeen: { key?: string; mask?: string; body?: any } = {};
let media: string;

// JPEG minimal (SOI + APP0 + EOI) cukup untuk lolos pengenalan jenis berkas.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9]);

before(async () => {
  media = await mkdtemp(join(tmpdir(), "peta-media-"));
  fake = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      fakeSeen = { key: String(req.headers["x-goog-api-key"]), mask: String(req.headers["x-goog-fieldmask"]), body: JSON.parse(Buffer.concat(chunks).toString() || "{}") };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ places: [
        { displayName: { text: "SDN Menteng 01" }, formattedAddress: "Jl. Besuki No.4, Menteng, Jakarta Pusat", location: { latitude: -6.1951, longitude: 106.8319 } },
        { displayName: { text: "Tanpa lokasi" }, formattedAddress: "x" },
      ] }));
    });
  });
  await new Promise<void>((r) => fake.listen(0, r));
  h = await start({ GOOGLE_SERVER_KEY: "kunci-uji", PLACES_ENDPOINT: `http://127.0.0.1:${(fake.address() as AddressInfo).port}/v1/places:searchText`, MEDIA_DIR: media });
});
after(async () => {
  await h.close();
  await new Promise<void>((r) => fake.close(() => r()));
  await rm(media, { recursive: true, force: true });
});

test("filter jenjang dan kecamatan (tanpa memilih kota) bekerja di daftar, cluster, dan fasetnya", async () => {
  const admin = await h.client("admin");
  await h.sql`truncate locations restart identity cascade`;
  await h.sql`
    insert into locations (kind, name, category, level, province, city, district, geom) values
    ('sekolah', 'A', 'SD', 'SD', 'Jawa Barat', 'Kota Bandung', 'Coblong', ST_SetSRID(ST_MakePoint(107.6, -6.9), 4326)),
    ('sekolah', 'B', 'SMP', 'SMP', 'Jawa Barat', 'Kota Bandung', 'Coblong', ST_SetSRID(ST_MakePoint(107.61, -6.91), 4326)),
    ('sekolah', 'C', 'SD', 'SD', 'Jawa Barat', 'Kota Bekasi', 'Coblong', ST_SetSRID(ST_MakePoint(107.0, -6.2), 4326)),
    ('sekolah', 'D', 'SD', 'SD', 'Bali', 'Kota Denpasar', 'Denpasar Barat', ST_SetSRID(ST_MakePoint(115.2, -8.6), 4326))`;
  const names = async (q: string) => (await admin.json(`/api/locations?sort=nama&${q}`)).body.items.map((x: { name: string }) => x.name);
  assert.deepEqual(await names("level=SD"), ["A", "C", "D"]);
  assert.deepEqual(await names("province=Jawa%20Barat&district=Coblong"), ["A", "B", "C"]);
  assert.deepEqual(await names("province=Jawa%20Barat&district=Coblong&level=SMP"), ["B"]);
  assert.equal((await admin.json("/api/locations?level=XYZ")).status, 400);
  const f = (await admin.json("/api/locations/facets?province=Jawa%20Barat")).body;
  assert.deepEqual(f.levels.map((x: { value: string }) => x.value), ["SD", "SMP"]);
  assert.deepEqual(f.districts.map((x: { value: string }) => x.value), ["Coblong"]);
  const clusters = await admin.json("/api/locations/clusters?west=100&south=-12&east=120&north=6&zoom=5&level=SD");
  assert.equal(clusters.body.total, 3);
  const live = await h.app.repo.clustersLive({ level: "SD" }, 5);
  const cells = await h.app.repo.clustersFromCells({ level: "SD" }, 5);
  assert.equal(cells.reduce((n, x) => n + x.count, 0), live.reduce((n, x) => n + x.count, 0));
});

test("mode titik menampilkan lokasi satu per satu pada zoom jauh, lengkap dengan nama", async () => {
  const admin = await h.client("admin");
  const r = await admin.json("/api/locations/clusters?west=100&south=-12&east=120&north=6&zoom=5&points=1");
  assert.equal(r.status, 200);
  assert.equal(r.body.features.length, 4);
  assert.ok(r.body.features.every((x: { count: number; name: string; id: string }) => x.count === 1 && x.name && x.id));
});

test("impor gaya Dapodik: kolom wilayah dan NPSN dipakai, tarik ulang memperbarui tanpa menggandakan", async () => {
  const editor = await h.client("editor");
  await h.sql`truncate locations, import_batches restart identity cascade`;
  const csv = (students: number) => [
    "NPSN,Nama Satuan Pendidikan,Bentuk Pendidikan,Status Sekolah,Alamat Jalan,Kecamatan,Kabupaten/Kota,Provinsi,Lintang,Bujur,Jumlah PD,Jumlah PTK",
    `20100001,SDN 1 Contoh,SD,Negeri,Jl. Pendidikan 1,Cibeunying,Kota Bandung,Jawa Barat,-6.9,107.6,${students},12`,
    "20100002,SMPN 2 Contoh,SMP,Swasta,Jl. Ilmu 2,Coblong,Kota Bandung,Jawa Barat,-6.91,107.61,300,20",
  ].join("\n");
  const run = async (body: string) => {
    const batch = (await editor.json("/api/imports", { method: "POST", json: { filename: "dapodik.csv", defaultKind: "sekolah" } })).body;
    return (await editor.json(`/api/imports/${batch.id}/file`, { method: "PUT", body })).body;
  };
  const first = await run(csv(250));
  assert.equal(first.inserted, 2);
  assert.equal(first.updated, 0);
  const row = (await h.sql`select level, district, city, province, students, teachers, attributes from locations where npsn = '20100001'`)[0]!;
  assert.deepEqual([row.level, row.district, row.city, row.province, row.students, row.teachers], ["SD", "Cibeunying", "Kota Bandung", "Jawa Barat", 250, 12]);
  assert.equal(row.attributes["Status Sekolah"], "Negeri");
  const second = await run(csv(275));
  assert.equal(second.inserted, 0);
  assert.equal(second.updated, 2);
  assert.equal(Number((await h.sql`select count(*) from locations`)[0]!.count), 2);
  assert.equal((await h.sql`select students from locations where npsn = '20100001'`)[0]!.students, 275);
  // pra-agregasi ikut diperbarui
  const s = (await editor.json("/api/reports/summary?kind=sekolah")).body;
  assert.equal(s.students, 275 + 300);
});

test("NPSN harus unik dan 8 digit", async () => {
  const editor = await h.client("editor");
  await h.sql`truncate locations restart identity cascade`;
  const a = await editor.json("/api/locations", { method: "POST", json: sampleLocation({ npsn: "12345678", level: "SD" }) });
  assert.equal(a.status, 201);
  assert.equal(a.body.level, "SD");
  const dup = await editor.json("/api/locations", { method: "POST", json: sampleLocation({ name: "Lain", npsn: "12345678" }) });
  assert.equal(dup.status, 409);
  const bad = await editor.json("/api/locations", { method: "POST", json: sampleLocation({ npsn: "123", level: "SMX" }) });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.error.details.npsn && bad.body.error.details.level);
});

test("pencarian tempat memakai kunci server dan mengembalikan koordinat", async () => {
  const editor = await h.client("editor");
  const viewer = await h.client("viewer");
  const r = await editor.json("/api/places/search?q=SDN%20Menteng%2001");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items, [{ name: "SDN Menteng 01", address: "Jl. Besuki No.4, Menteng, Jakarta Pusat", latitude: -6.1951, longitude: 106.8319 }]);
  assert.equal(fakeSeen.key, "kunci-uji");
  assert.match(fakeSeen.mask ?? "", /location/);
  assert.equal(fakeSeen.body.textQuery, "SDN Menteng 01");
  assert.deepEqual((await editor.json("/api/places/search?q=ab")).body.items, []);
  assert.equal((await viewer.json("/api/places/search?q=SDN")).status, 403);
});

test("gambar lokasi: unggah, tampil, tolak berkas palsu, batas jumlah, hapus, dan pembersihan yatim", async () => {
  const editor = await h.client("editor");
  const viewer = await h.client("viewer");
  await h.sql`truncate locations, location_images restart identity cascade`;
  const loc = (await editor.json("/api/locations", { method: "POST", json: sampleLocation() })).body;

  const made = await editor.json(`/api/locations/${loc.id}/images`, { method: "POST", json: { mime: "image/jpeg", width: 1200, height: 800 } });
  assert.equal(made.status, 201);
  const id = made.body.id;
  // belum siap sampai kedua varian ada
  assert.equal((await editor.fetch(`/api/images/${id}/full`)).status, 404);
  const putFull = await editor.fetch(`/api/images/${id}/full`, { method: "PUT", body: JPEG, headers: { "content-type": "image/jpeg" } });
  assert.equal(putFull.status, 200);
  assert.equal(((await putFull.json()) as { ready: boolean }).ready, false);
  const putThumb = await editor.fetch(`/api/images/${id}/thumb`, { method: "PUT", body: JPEG, headers: { "content-type": "image/jpeg" } });
  assert.equal(((await putThumb.json()) as { ready: boolean }).ready, true);

  const got = await viewer.fetch(`/api/images/${id}/thumb`);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get("content-type"), "image/jpeg");
  assert.equal((await got.arrayBuffer()).byteLength, JPEG.length);
  assert.equal((await viewer.fetch(`/api/images/${id}/thumb`, { headers: { "if-none-match": got.headers.get("etag")! } })).status, 304);
  assert.equal((await h.anonymous().fetch(`/api/images/${id}/thumb`)).status, 401);
  assert.deepEqual((await editor.json(`/api/locations/${loc.id}`)).body.images, [{ id, width: 1200, height: 800, caption: null }]);
  assert.equal((await viewer.json(`/api/locations/${loc.id}/images`, { method: "POST", json: { mime: "image/jpeg", width: 1, height: 1 } })).status, 403);

  // berkas yang bukan gambar ditolak walau mengaku JPEG
  const fake2 = (await editor.json(`/api/locations/${loc.id}/images`, { method: "POST", json: { mime: "image/jpeg", width: 10, height: 10 } })).body.id;
  const html = await editor.fetch(`/api/images/${fake2}/full`, { method: "PUT", body: "<html><script>alert(1)</script></html>" });
  assert.equal(html.status, 400);
  assert.equal((await editor.json(`/api/locations/${loc.id}/images`, { method: "POST", json: { mime: "image/gif", width: 1, height: 1 } })).status, 400);

  // batas delapan gambar per lokasi
  for (let i = 0; i < 6; i++) await editor.json(`/api/locations/${loc.id}/images`, { method: "POST", json: { mime: "image/png", width: 1, height: 1 } });
  assert.equal((await editor.json(`/api/locations/${loc.id}/images`, { method: "POST", json: { mime: "image/png", width: 1, height: 1 } })).status, 400);

  // hapus satu gambar menghapus berkasnya
  assert.equal((await editor.json(`/api/images/${id}`, { method: "DELETE" })).status, 200);
  assert.equal((await h.app.images.store.size(id, "full")), null);

  // menghapus lokasi menghapus berkas gambarnya, dan berkas yatim dibersihkan
  const loc2 = (await editor.json("/api/locations", { method: "POST", json: sampleLocation({ name: "Dua" }) })).body;
  const id2 = (await editor.json(`/api/locations/${loc2.id}/images`, { method: "POST", json: { mime: "image/jpeg", width: 10, height: 10 } })).body.id;
  await editor.fetch(`/api/images/${id2}/full`, { method: "PUT", body: JPEG });
  await editor.fetch(`/api/images/${id2}/thumb`, { method: "PUT", body: JPEG });
  assert.notEqual(await h.app.images.store.size(id2, "full"), null);
  await h.sql`delete from locations where id = ${loc2.id}`; // penghapusan massal tidak lewat rute
  assert.notEqual(await h.app.images.store.size(id2, "full"), null, "berkas masih ada sebelum disapu");
  const swept = await h.app.images.sweep();
  assert.ok(swept >= 1);
  assert.equal(await h.app.images.store.size(id2, "full"), null);
  void readdir; void writeFile; void mkdir;
});
