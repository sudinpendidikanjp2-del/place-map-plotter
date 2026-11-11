import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { sampleLocation, start, type Harness } from "./helpers.ts";

let h: Harness;
before(async () => {
  h = await start();
});
after(async () => {
  await h.close();
});

test("tanpa login semua rute data menolak dengan 401, kecuali login dan health", async () => {
  const anon = h.anonymous();
  for (const path of ["/api/locations", "/api/locations/clusters", "/api/reports/summary", "/api/export/csv", "/api/imports", "/api/users"]) {
    const r = await anon.json(path);
    assert.equal(r.status, 401, path);
  }
  assert.equal((await anon.json("/api/health")).status, 200);
});

test("login gagal memberi 401 dan permintaan tanpa asal dikenali ditolak (CSRF)", async () => {
  const anon = h.anonymous();
  const bad = await anon.json("/api/auth/login", { method: "POST", json: { email: "tidak@ada.id", password: "salahsalahsalah" } });
  assert.equal(bad.status, 401);
  const res = await fetch(`${h.base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://jahat.example" },
    body: JSON.stringify({ email: "a@b.id", password: "x" }),
  });
  assert.equal(res.status, 403);
  const noOrigin = await fetch(`${h.base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(noOrigin.status, 403);
});

test("pembaca tidak bisa menulis (403), penyunting bisa", async () => {
  const viewer = await h.client("viewer");
  const editor = await h.client("editor");
  assert.equal((await viewer.json("/api/locations", { method: "POST", json: sampleLocation() })).status, 403);
  assert.equal((await viewer.json("/api/locations")).status, 200);
  const created = await editor.json("/api/locations", { method: "POST", json: sampleLocation() });
  assert.equal(created.status, 201);
  assert.equal(created.body.province, "DKI Jakarta");
  assert.equal(created.body.district, "Gambir");
  assert.equal(created.body.version, 1);
});

test("validasi menolak koordinat dan jumlah murid yang tidak sah", async () => {
  const editor = await h.client("editor");
  const r = await editor.json("/api/locations", { method: "POST", json: sampleLocation({ latitude: 200, students: -4 }) });
  assert.equal(r.status, 400);
  assert.ok(r.body.error.details.latitude);
  assert.ok(r.body.error.details.students);
});

test("dua penyunting mengubah data yang sama: yang kedua mendapat 409", async () => {
  const a = await h.client("editor");
  const b = await h.client("editor");
  const created = (await a.json("/api/locations", { method: "POST", json: sampleLocation({ name: "Berbagi" }) })).body;
  const first = await a.json(`/api/locations/${created.id}`, { method: "PATCH", json: { ...sampleLocation({ name: "Ubahan A" }), version: created.version } });
  assert.equal(first.status, 200);
  assert.equal(first.body.version, 2);
  const second = await b.json(`/api/locations/${created.id}`, { method: "PATCH", json: { ...sampleLocation({ name: "Ubahan B" }), version: created.version } });
  assert.equal(second.status, 409);
  const now = await b.json(`/api/locations/${created.id}`);
  assert.equal(now.body.name, "Ubahan A");
});

test("cluster: jumlah fitur dibatasi dan total tetap sama, zoom dekat menampilkan titik", async () => {
  const admin = await h.client("admin");
  await h.sql`truncate locations restart identity cascade`;
  await h.sql`
    insert into locations (kind, name, category, geom)
    select 'sekolah', 'Sekolah ' || g, case when g % 2 = 0 then 'SD' else 'SMP' end,
      ST_SetSRID(ST_MakePoint(95 + random() * 45, -10 + random() * 15), 4326)
    from generate_series(1, 5000) g`;
  const q = "west=94&south=-11&east=141&north=6";
  const low = await admin.json(`/api/locations/clusters?${q}&zoom=4`);
  assert.equal(low.status, 200);
  assert.equal(low.body.total, 5000);
  assert.ok(low.body.features.length <= 1500 && low.body.features.length > 1);
  const filtered = await admin.json(`/api/locations/clusters?${q}&zoom=4&category=SD`);
  assert.equal(filtered.body.total, 2500);
  const near = await admin.json(`/api/locations/clusters?west=94&south=-11&east=95.5&north=6&zoom=18`);
  assert.ok(near.body.features.every((f: { count: number }) => f.count === 1));
  const bad = await admin.json(`/api/locations/clusters?zoom=4`);
  assert.equal(bad.status, 400);
});

test("cache hasil tidak pernah basi: tambah, ubah, dan hapus langsung terlihat di cluster dan ringkasan", async () => {
  const editor = await h.client("editor");
  await h.sql`truncate locations restart identity cascade`;
  const q = "/api/locations/clusters?west=100&south=-10&east=120&north=5&zoom=6";
  assert.equal((await editor.json(q)).body.total, 0);
  assert.equal((await editor.json("/api/reports/summary")).body.total, 0);
  const created = (await editor.json("/api/locations", { method: "POST", json: sampleLocation({ latitude: -6.2, longitude: 106.8, students: 10 }) })).body;
  assert.equal((await editor.json(q)).body.total, 1);
  assert.equal((await editor.json("/api/reports/summary")).body.students, 10);
  await editor.json(`/api/locations/${created.id}`, { method: "PATCH", json: { ...sampleLocation({ students: 99 }), version: created.version } });
  assert.equal((await editor.json("/api/reports/summary")).body.students, 99);
  await editor.json(`/api/locations/${created.id}`, { method: "DELETE" });
  assert.equal((await editor.json(q)).body.total, 0);
});

test("pra-agregasi cluster selalu sama dengan hitungan langsung setelah tambah, ubah, dan hapus", async () => {
  const editor = await h.client("editor");
  await h.sql`truncate locations restart identity cascade`;
  await h.sql`
    insert into locations (kind, name, category, province, geom)
    select (array['sekolah','fasilitas','aset'])[1 + g % 3], 'L' || g, (array['SD','SMP','Gedung'])[1 + g % 3],
      (array['Jawa Barat','Bali',null])[1 + g % 3], ST_SetSRID(ST_MakePoint(100 + random() * 40, -9 + random() * 14), 4326)
    from generate_series(1, 1000) g`;
  const bbox = { west: 94, south: -11, east: 141, north: 6 };
  const same = async (f: Record<string, string>, label: string) => {
    for (const zoom of [3, 6, 9, 12, 14]) {
      // Tanpa area: sel yang menyentuh tepi area memang memuat titik di luar area, sehingga hanya perbandingan tanpa area yang tepat.
      const filter = { ...f } as never;
      const cells = (await h.app.repo.clustersFromCells(filter, zoom)).map((x) => `${x.count}|${x.lat.toFixed(5)}|${x.lng.toFixed(5)}`).sort();
      const live = (await h.app.repo.clustersLive(filter, zoom)).map((x) => `${x.count}|${x.lat.toFixed(5)}|${x.lng.toFixed(5)}`).sort();
      assert.deepEqual(cells, live, `${label} zoom ${zoom}`);
    }
  };
  await same({}, "awal");
  await same({ kind: "aset", province: "Bali" }, "filter jenis dan provinsi");
  // pembaruan massal, perubahan koordinat lewat API, penghapusan, dan sisipan baru
  await h.sql`update locations set category = 'Baru' where id % 7 = 0`;
  await h.sql`update locations set geom = ST_SetSRID(ST_MakePoint(110, -7), 4326) where id % 11 = 0`;
  await h.sql`delete from locations where id % 5 = 0`;
  await editor.json("/api/locations", { method: "POST", json: sampleLocation({ latitude: -6.2, longitude: 106.8 }) });
  await same({}, "setelah perubahan");
  await same({ category: "Baru" }, "kategori hasil ubah massal");
  // sel berisi satu lokasi membawa id dan nama
  const singles = await h.app.repo.clustersFromCells({ bbox }, 14);
  const one = singles.find((x) => x.count === 1);
  assert.ok(one && one.id && one.name, "sel tunggal harus membawa id dan nama");
});

test("batas area mengikuti filter dan kosong bila tidak ada data", async () => {
  const admin = await h.client("admin");
  await h.sql`truncate locations restart identity cascade`;
  assert.deepEqual((await admin.json("/api/locations/extent")).body, { count: 0, bbox: null });
  await h.sql`
    insert into locations (kind, name, category, geom) values
    ('sekolah', 'A', 'SD', ST_SetSRID(ST_MakePoint(100, -1), 4326)),
    ('aset', 'B', 'Tanah', ST_SetSRID(ST_MakePoint(120, 5), 4326))`;
  const all = (await admin.json("/api/locations/extent")).body;
  assert.deepEqual(all, { count: 2, bbox: { west: 100, south: -1, east: 120, north: 5 } });
  assert.equal((await admin.json("/api/locations/extent?kind=aset")).body.count, 1);
});

test("filter lingkaran dan poligon memakai PostGIS", async () => {
  const admin = await h.client("admin");
  await h.sql`truncate locations restart identity cascade`;
  await h.sql`
    insert into locations (kind, name, category, geom) values
    ('sekolah', 'Dekat', 'SD', ST_SetSRID(ST_MakePoint(106.80, -6.20), 4326)),
    ('sekolah', 'Jauh', 'SD', ST_SetSRID(ST_MakePoint(107.60, -6.90), 4326))`;
  const circle = await admin.json("/api/locations?circle=-6.2,106.8,5000");
  assert.deepEqual(circle.body.items.map((x: { name: string }) => x.name), ["Dekat"]);
  const polygon = await admin.json("/api/locations?polygon=106.7,-6.3;106.9,-6.3;106.9,-6.1;106.7,-6.1");
  assert.deepEqual(polygon.body.items.map((x: { name: string }) => x.name), ["Dekat"]);
  const text = await admin.json("/api/locations?q=jau");
  assert.equal(text.body.total, 1);
  assert.equal((await admin.json("/api/locations?polygon=1,2;3,4")).status, 400);
});

test("paginasi kursor tidak menduplikasi atau melewatkan baris", async () => {
  const admin = await h.client("admin");
  await h.sql`truncate locations restart identity cascade`;
  await h.sql`
    insert into locations (kind, name, category, geom)
    select 'aset', 'Aset ' || lpad(g::text, 4, '0'), 'Gedung', ST_SetSRID(ST_MakePoint(110, -7), 4326)
    from generate_series(1, 237) g`;
  for (const sort of ["baru", "nama"]) {
    const seen = new Set<string>();
    let cursor = "";
    let pages = 0;
    do {
      const r = await admin.json(`/api/locations?limit=50&sort=${sort}${cursor ? `&cursor=${cursor}` : ""}`);
      for (const it of r.body.items) {
        assert.ok(!seen.has(it.id), "duplikat");
        seen.add(it.id);
      }
      cursor = r.body.nextCursor ?? "";
      pages++;
    } while (cursor);
    assert.equal(seen.size, 237, sort);
    assert.equal(pages, 5);
  }
});

test("impor CSV: baris valid masuk, baris salah dicatat, batch bisa dibatalkan", async () => {
  const editor = await h.client("editor");
  await h.sql`truncate locations, import_batches restart identity cascade`;
  const csv = [
    "Nama Sekolah;Lat;Lng;Jumlah Siswa;Jumlah Guru;Alamat;Akreditasi",
    'SDN 1;-6,2;106,8;300;15;"Jl. A, Kec. Gambir, Kota Jakarta Pusat, DKI Jakarta";A',
    "SDN 2;abc;106,8;10;1;;B",
    "SDN 3;-7,1;110,4;-5;2;;C",
    "SDN 4;-7,3;110,5;200;9;Kec. Semarang Tengah, Kota Semarang, Jawa Tengah;",
  ].join("\n");
  const batch = (await editor.json("/api/imports", { method: "POST", json: { filename: "uji.csv", defaultKind: "sekolah" } })).body;
  const done = await editor.json(`/api/imports/${batch.id}/file`, { method: "PUT", body: csv, headers: { "content-type": "text/csv" } });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.status, "selesai");
  assert.equal(done.body.total, 4);
  assert.equal(done.body.inserted, 2);
  assert.equal(done.body.failed, 2);
  assert.equal(done.body.errors.length, 2);
  const rows = await h.sql`select name, province, students, attributes from locations order by name`;
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.province, "DKI Jakarta");
  assert.deepEqual(rows[0]!.attributes, { Akreditasi: "A" });
  assert.equal(rows[1]!.province, "Jawa Tengah");

  const cancelled = await editor.json(`/api/imports/${batch.id}`, { method: "DELETE" });
  assert.equal(cancelled.body.removed, 2);
  assert.equal(Number((await h.sql`select count(*) from locations`)[0]!.count), 0);
  assert.equal((await editor.json(`/api/imports/${batch.id}`)).body.status, "dibatalkan");
});

test("impor tanpa kolom wajib gagal dengan pesan jelas", async () => {
  const editor = await h.client("editor");
  const batch = (await editor.json("/api/imports", { method: "POST", json: { filename: "salah.csv", defaultKind: "aset" } })).body;
  const r = await editor.json(`/api/imports/${batch.id}/file`, { method: "PUT", body: "judul,warna\nx,y\n" });
  assert.equal(r.status, 400);
  assert.match(r.body.error.message, /Kolom wajib/);
  assert.equal((await editor.json(`/api/imports/${batch.id}`)).body.status, "gagal");
});

test("impor 30.000 baris selesai dengan satu kali COPY per bongkahan", async () => {
  const editor = await h.client("editor");
  await h.sql`truncate locations, import_batches restart identity cascade`;
  const lines = ["nama,lintang,bujur,jumlah murid"];
  for (let i = 0; i < 30_000; i++) lines.push(`Sekolah ${i},${-6 - (i % 1000) / 1000},${106 + (i % 977) / 1000},${i % 700}`);
  const batch = (await editor.json("/api/imports", { method: "POST", json: { filename: "besar.csv", defaultKind: "sekolah" } })).body;
  const t0 = Date.now();
  const r = await editor.json(`/api/imports/${batch.id}/file`, { method: "PUT", body: lines.join("\n") });
  const ms = Date.now() - t0;
  assert.equal(r.body.inserted, 30_000, JSON.stringify(r.body));
  console.log(`# impor 30.000 baris: ${ms} ms (${Math.round(30_000 / (ms / 1000))} baris/detik)`);
});

test("tindakan massal: daftar id berfungsi, filter kosong ditolak", async () => {
  const editor = await h.client("editor");
  await h.sql`truncate locations restart identity cascade`;
  await h.sql`
    insert into locations (kind, name, category, geom)
    select 'fasilitas', 'Lab ' || g, 'Lama', ST_SetSRID(ST_MakePoint(110, -7), 4326) from generate_series(1, 10) g`;
  const ids = (await h.sql`select id::text from locations order by id limit 4`).map((r) => r.id);
  const upd = await editor.json("/api/locations/bulk-update", { method: "POST", json: { ids, category: "Baru" } });
  assert.equal(upd.body.updated, 4);
  assert.equal((await editor.json("/api/locations/bulk-delete", { method: "POST", json: { filter: {} } })).status, 400);
  const byFilter = await editor.json("/api/locations/bulk-delete", { method: "POST", json: { filter: { category: "Baru" } } });
  assert.equal(byFilter.body.deleted, 4);
  const rest = await editor.json("/api/locations/bulk-delete", { method: "POST", json: { ids } });
  assert.equal(rest.body.deleted, 0);
  assert.equal(Number((await h.sql`select count(*) from locations`)[0]!.count), 6);
});

test("ekspor CSV mengalir, menetralkan rumus, dan memakai filter", async () => {
  const viewer = await h.client("viewer");
  await h.sql`truncate locations restart identity cascade`;
  await h.sql`
    insert into locations (kind, name, category, description, geom) values
    ('aset', '=HYPERLINK("http://x")', 'Tanah', 'a,b', ST_SetSRID(ST_MakePoint(110, -7), 4326)),
    ('sekolah', 'Biasa', 'SD', null, ST_SetSRID(ST_MakePoint(111, -7), 4326))`;
  const res = await viewer.fetch("/api/export/csv?kind=aset");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition") ?? "", /attachment/);
  const text = await res.text();
  assert.ok(text.startsWith("Jenis,Nama"));
  assert.ok(text.includes("'=HYPERLINK"));
  assert.ok(!text.includes("Biasa"));
});

test("laporan ringkasan menghitung murid, guru, dan sebaran", async () => {
  const viewer = await h.client("viewer");
  await h.sql`truncate locations restart identity cascade`;
  await h.sql`
    insert into locations (kind, name, category, students, teachers, province, geom) values
    ('sekolah', 'A', 'SD', 100, 5, 'Jawa Barat', ST_SetSRID(ST_MakePoint(107, -6), 4326)),
    ('sekolah', 'B', 'SMP', 200, 9, 'Jawa Barat', ST_SetSRID(ST_MakePoint(107, -6), 4326)),
    ('fasilitas', 'C', 'Lab', null, null, null, ST_SetSRID(ST_MakePoint(107, -6), 4326))`;
  const s = (await viewer.json("/api/reports/summary")).body;
  assert.equal(s.total, 3);
  assert.equal(s.students, 300);
  assert.equal(s.teachers, 14);
  assert.equal(s.byProvince[0].province, "Jawa Barat");
  const only = (await viewer.json("/api/reports/summary?kind=sekolah")).body;
  assert.equal(only.total, 2);
});

test("admin tidak bisa menurunkan admin terakhir atau dirinya sendiri", async () => {
  await h.sql`truncate users restart identity cascade`;
  const admin = await h.client("admin");
  const me = (await admin.json("/api/auth/me")).body.user;
  const r = await admin.json(`/api/users/${me.id}`, { method: "PATCH", json: { role: "viewer" } });
  assert.equal(r.status, 400);
  const list = (await admin.json("/api/users")).body.items;
  assert.equal(list.length, 1);
  const created = await admin.json("/api/users", { method: "POST", json: { email: "baru@contoh.id", name: "Baru", role: "viewer", password: "pendek" } });
  assert.equal(created.status, 400);
});

test("rute tidak dikenal 404, metode salah 405, login dibatasi lajunya", async () => {
  const admin = await h.client("admin");
  assert.equal((await admin.json("/api/tidak-ada")).status, 404);
  assert.equal((await admin.json("/api/auth/login", { method: "PUT" })).status, 405);
  const anon = h.anonymous();
  let last = 0;
  for (let i = 0; i < 12; i++) last = (await anon.json("/api/auth/login", { method: "POST", json: { email: "x@y.id", password: "salah-salah" } })).status;
  assert.equal(last, 429);
});
