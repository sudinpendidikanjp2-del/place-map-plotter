import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sampleLocation, start, type Harness } from "./helpers.ts";

let h: Harness;
let fake: Server;
let media: string;
const queries: string[] = [];

before(async () => {
  media = await mkdtemp(join(tmpdir(), "peta-media-"));
  fake = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const q = String(JSON.parse(Buffer.concat(chunks).toString() || "{}").textQuery ?? "");
      queries.push(q);
      res.setHeader("content-type", "application/json");
      const wrongCity = q.includes("Salah Kota");
      res.end(JSON.stringify({ places: q.includes("Tidak Ada") ? [] : [{
        displayName: { text: q.split(",")[0] },
        formattedAddress: wrongCity ? "Jl. Lain, Surabaya, Jawa Timur" : "Jl. Contoh, Kec. Senen, Kota Jakarta Pusat, DKI Jakarta",
        location: { latitude: -6.18, longitude: 106.84 },
      }] }));
    });
  });
  await new Promise<void>((r) => fake.listen(0, r));
  h = await start({ GOOGLE_SERVER_KEY: "kunci", PLACES_ENDPOINT: `http://127.0.0.1:${(fake.address() as AddressInfo).port}/p`, MEDIA_DIR: media, GEOCODE_DAILY_LIMIT: "4" });
});
after(async () => {
  await h.close();
  await new Promise<void>((r) => fake.close(() => r()));
  await rm(media, { recursive: true, force: true });
});

const DAPODIK = (extra = "") => [
  "NPSN,Nama,Bentuk Pendidikan,Status Sekolah,Kecamatan,Kabupaten,Provinsi,PD,Jumlah Guru" + extra.split("|")[0],
  "30000001,SDN Senen 01,SD,Negeri,Kec. Senen,Kota Adm. Jakarta Pusat,Prov. D.K.I. Jakarta,300,12" + (extra.split("|")[1] ?? ""),
  "30000002,SMPN Senen 02,SMP,Negeri,Kec. Senen,Kota Adm. Jakarta Pusat,Prov. D.K.I. Jakarta,400,20" + (extra.split("|")[2] ?? ""),
].join("\n");

async function importCsv(client: { json: Function }, csv: string) {
  const batch = (await client.json("/api/imports", { method: "POST", json: { filename: "dapodik.csv", defaultKind: "sekolah" } })).body;
  return (await client.json(`/api/imports/${batch.id}/file`, { method: "PUT", body: csv })).body;
}

test("sekolah tanpa koordinat bisa diimpor, tidak muncul di peta, tetapi terhitung di ringkasan dan daftar", async () => {
  const editor = await h.client("editor");
  await h.sql`truncate locations, import_batches restart identity cascade`;
  const r = await importCsv(editor, DAPODIK());
  assert.equal(r.inserted, 2, JSON.stringify(r));
  assert.equal(r.failed, 0);
  const row = (await h.sql`select coord_source, geom is null as nogeom from locations where npsn = '30000001'`)[0]!;
  assert.deepEqual([row.coordSource, row.nogeom], ["none", true]);
  assert.equal((await editor.json("/api/locations/clusters?west=90&south=-12&east=142&north=7&zoom=5")).body.total, 0);
  assert.equal((await editor.json("/api/locations/clusters?west=90&south=-12&east=142&north=7&zoom=5&points=1")).body.total, 0);
  assert.equal((await editor.json("/api/reports/summary")).body.students, 700);
  const list = (await editor.json("/api/locations?coords=none")).body;
  assert.equal(list.total, 2);
  assert.equal(list.items[0].latitude, null);
  assert.equal((await editor.json("/api/locations?coords=bukan")).status, 400);
});

test("hanya satu koordinat terisi ditolak, keduanya kosong diterima", async () => {
  const editor = await h.client("editor");
  const one = await editor.json("/api/locations", { method: "POST", json: sampleLocation({ latitude: -6.2, longitude: "" }) });
  assert.equal(one.status, 400);
  const none = await editor.json("/api/locations", { method: "POST", json: sampleLocation({ name: "Tanpa titik", latitude: "", longitude: "" }) });
  assert.equal(none.status, 201);
  assert.equal(none.body.latitude, null);
  assert.equal(none.body.coordSource, "none");
});

test("impor ulang menambah koordinat, tetapi tidak menimpa koordinat manual", async () => {
  const editor = await h.client("editor");
  await h.sql`truncate locations, import_batches restart identity cascade`;
  await importCsv(editor, DAPODIK());
  const withCoords = DAPODIK(",Lintang,Bujur|,-6.17,106.84|,-6.18,106.85");
  const second = await importCsv(editor, withCoords);
  assert.equal(second.updated, 2);
  const a = (await h.sql`select lat, lng, coord_source from locations where npsn = '30000001'`)[0]!;
  assert.deepEqual([a.lat, a.lng, a.coordSource], [-6.17, 106.84, "import"]);
  // koreksi manual lalu impor ulang dengan koordinat lain
  const loc = (await h.sql`select id::text, version from locations where npsn = '30000001'`)[0]!;
  const full = (await editor.json(`/api/locations/${loc.id}`)).body;
  await editor.json(`/api/locations/${loc.id}`, { method: "PATCH", json: { ...full, latitude: -6.2, longitude: 106.9, version: full.version } });
  assert.equal((await h.sql`select coord_source from locations where npsn = '30000001'`)[0]!.coordSource, "manual");
  await importCsv(editor, DAPODIK(",Lintang,Bujur|,-1,100|,-6.18,106.85"));
  const b = (await h.sql`select lat, lng, coord_source from locations where npsn = '30000001'`)[0]!;
  assert.deepEqual([b.lat, b.lng, b.coordSource], [-6.2, 106.9, "manual"]);
  // impor ulang tanpa koordinat tidak menghapus koordinat yang ada
  await importCsv(editor, DAPODIK());
  assert.equal((await h.sql`select lat from locations where npsn = '30000002'`)[0]!.lat, -6.18);
});

test("pra-agregasi tetap sama dengan hitungan langsung saat koordinat ditambah, diubah, dan dikosongkan", async () => {
  const editor = await h.client("editor");
  await h.sql`truncate locations restart identity cascade`;
  await h.sql`insert into locations (kind, name, category, level, geom) select 'sekolah', 'L' || g, 'SD', 'SD', case when g % 3 = 0 then null else ST_SetSRID(ST_MakePoint(106 + g * 0.001, -6 - g * 0.001), 4326) end from generate_series(1, 300) g`;
  const same = async (label: string) => {
    for (const zoom of [4, 9, 14]) {
      const cells = (await h.app.repo.clustersFromCells({}, zoom)).map((x) => `${x.count}|${x.lat.toFixed(5)}|${x.lng.toFixed(5)}`).sort();
      const live = (await h.app.repo.clustersLive({}, zoom)).map((x) => `${x.count}|${x.lat.toFixed(5)}|${x.lng.toFixed(5)}`).sort();
      assert.deepEqual(cells, live, `${label} zoom ${zoom}`);
    }
  };
  await same("awal");
  await h.sql`update locations set geom = ST_SetSRID(ST_MakePoint(110, -7), 4326) where id % 3 = 0 and id < 100`;
  await h.sql`update locations set geom = null where id % 7 = 0`;
  await h.sql`delete from locations where id % 11 = 0`;
  await editor.json("/api/locations", { method: "POST", json: sampleLocation({ latitude: "", longitude: "" }) });
  await same("setelah perubahan");
});

test("pencarian koordinat otomatis: terisi sebagai perkiraan, hasil kota salah ditolak, kuota harian dihormati", async () => {
  const admin = await h.client("admin");
  const editor = await h.client("editor");
  await h.sql`truncate locations, geocode_usage restart identity cascade`;
  await h.sql`
    insert into locations (kind, name, category, level, city, district, province, geom) values
    ('sekolah', 'SDN Cari 01', 'SD', 'SD', 'Kota Jakarta Pusat', 'Senen', 'DKI Jakarta', null),
    ('sekolah', 'SDN Salah Kota 02', 'SD', 'SD', 'Kota Jakarta Pusat', 'Senen', 'DKI Jakarta', null),
    ('sekolah', 'SDN Tidak Ada 03', 'SD', 'SD', 'Kota Jakarta Pusat', 'Senen', 'DKI Jakarta', null),
    ('sekolah', 'SDN Cari 04', 'SD', 'SD', 'Kota Jakarta Pusat', 'Senen', 'DKI Jakarta', null),
    ('sekolah', 'SDN Cari 05', 'SD', 'SD', 'Kota Jakarta Pusat', 'Senen', 'DKI Jakarta', null)`;
  assert.equal((await editor.json("/api/geocode/status")).status, 403);
  const before = (await admin.json("/api/geocode/status")).body;
  assert.equal(before.missing, 5);
  const run = (await admin.json("/api/geocode/run", { method: "POST", json: { limit: 10 } })).body;
  assert.equal(run.tried, 4, JSON.stringify(run));
  assert.equal(run.found, 2);
  assert.equal(run.notFound, 2);
  assert.match(run.stopped, /Batas harian 4/);
  assert.match(queries[0]!, /SDN Cari 01, Kecamatan Senen, Kota Jakarta Pusat, DKI Jakarta/);
  const after = (await admin.json("/api/geocode/status")).body;
  assert.deepEqual([after.geocoded, after.missing, after.usedToday], [2, 3, 4]);
  const geo = (await admin.json("/api/locations?coords=geocoded")).body;
  assert.equal(geo.total, 2);
  assert.equal(geo.items[0].coordSource, "geocoded");
  assert.match(geo.items[0].geocodeNote, /Kota Jakarta Pusat/);
  assert.equal((await admin.json("/api/locations/clusters?west=100&south=-10&east=110&north=0&zoom=8")).body.total, 2);
  // memeriksa lalu menandai benar
  const confirmed = (await editor.json(`/api/locations/${geo.items[0].id}/confirm-coords`, { method: "POST", json: {} })).body;
  assert.equal(confirmed.coordSource, "manual");
  // pencarian ulang tidak menyentuh lokasi yang sudah punya koordinat, kuota habis hari ini
  const again = (await admin.json("/api/geocode/run", { method: "POST", json: { limit: 10 } })).body;
  assert.equal(again.tried, 0);
});

test("token API: boleh untuk impor dan sinkronisasi saja, bisa dicabut, tanpa cookie dan tanpa CSRF", async () => {
  const admin = await h.client("admin");
  const editor = await h.client("editor");
  await h.sql`truncate locations, import_batches, sync_runs, api_tokens restart identity cascade`;
  assert.equal((await editor.json("/api/tokens", { method: "POST", json: { name: "x" } })).status, 403);
  const made = (await admin.json("/api/tokens", { method: "POST", json: { name: "Pekerja Dapodik" } })).body;
  assert.match(made.token, /^peta_/);
  const stored = (await h.sql`select token_hash from api_tokens`)[0]!;
  assert.notEqual(stored.tokenHash, made.token);
  assert.ok(!JSON.stringify((await admin.json("/api/tokens")).body).includes(made.token));

  const raw = (path: string, init: RequestInit = {}) => fetch(h.base + path, { ...init, headers: { authorization: `Bearer ${made.token}`, "content-type": "application/json", ...(init.headers ?? {}) } });
  const run = await (await raw("/api/sync/runs", { method: "POST", body: JSON.stringify({ source: "dapodik", scope: "Jakarta Pusat" }) })).json() as { id: string };
  assert.ok(run.id);
  const batch = await (await raw("/api/imports", { method: "POST", body: JSON.stringify({ filename: "sync.csv", defaultKind: "sekolah" }) })).json() as { id: string };
  const done = await (await raw(`/api/imports/${batch.id}/file`, { method: "PUT", body: DAPODIK(), headers: { "content-type": "text/csv" } })).json() as { inserted: number };
  assert.equal(done.inserted, 2);
  assert.equal((await h.sql`select created_by from locations limit 1`)[0]!.createdBy, null);
  const fin = await (await raw(`/api/sync/runs/${run.id}`, { method: "PATCH", body: JSON.stringify({ status: "selesai", schoolsSeen: 2, inserted: 2, importBatchId: batch.id }) })).json() as { status: string };
  assert.equal(fin.status, "selesai");
  const list = await (await raw("/api/sync/runs?source=dapodik")).json() as { items: unknown[]; lastSuccess: { inserted: number } };
  assert.equal(list.items.length, 1);
  assert.equal(list.lastSuccess.inserted, 2);

  assert.equal((await raw("/api/locations")).status, 403, "token tidak boleh membaca daftar lokasi");
  assert.equal((await raw("/api/users")).status, 403);
  assert.equal((await raw("/api/tokens", { method: "POST", body: "{}" })).status, 403);
  assert.equal((await fetch(h.base + "/api/imports", { method: "POST", headers: { authorization: "Bearer peta_salah", "content-type": "application/json" }, body: "{}" })).status, 401);

  await admin.json(`/api/tokens/${made.id}`, { method: "DELETE" });
  assert.equal((await raw("/api/sync/runs")).status, 401, "token yang dicabut ditolak");
});

test("sinkronisasi dari web: permintaan menunggu, diambil pekerja, tidak ganda, bisa dibatalkan", async () => {
  const admin = await h.client("admin");
  const editor = await h.client("editor");
  await h.sql`truncate sync_runs, sync_workers restart identity`;
  const made = (await admin.json("/api/tokens", { method: "POST", json: { name: "Pekerja antrean" } })).body as { token: string };
  const worker = (path: string, body: unknown = {}) => fetch(h.base + path, { method: "POST", headers: { authorization: `Bearer ${made.token}`, "content-type": "application/json" }, body: JSON.stringify(body) });

  assert.equal((await editor.json("/api/sync/request", { method: "POST" })).status, 403, "hanya admin yang boleh meminta");
  assert.equal(((await (await worker("/api/sync/claim", { source: "dapodik" })).json()) as { run: unknown }).run, null, "belum ada permintaan");

  const req = await admin.json("/api/sync/request", { method: "POST" });
  assert.equal(req.status, 201);
  assert.equal(req.body.status, "menunggu");
  assert.equal((await admin.json("/api/sync/request", { method: "POST" })).status, 409, "tidak boleh ganda");

  const claimed = (await (await worker("/api/sync/claim", { source: "dapodik", scope: "Jakarta Pusat" })).json()) as { run: { id: string; status: string; scope: string } };
  assert.equal(claimed.run.id, req.body.id);
  assert.equal(claimed.run.status, "berjalan");
  assert.equal(claimed.run.scope, "Jakarta Pusat");
  assert.equal(((await (await worker("/api/sync/claim", { source: "dapodik" })).json()) as { run: unknown }).run, null, "satu permintaan hanya diambil sekali");
  assert.equal((await admin.json("/api/sync/request", { method: "POST" })).status, 409, "masih berjalan");

  const list = (await admin.json("/api/sync/runs?source=dapodik")).body as { workerSeenAt: string | null };
  assert.ok(list.workerSeenAt, "denyut pekerja tercatat");

  await h.sql`update sync_runs set status = 'selesai', finished_at = now()`;
  const second = await admin.json("/api/sync/request", { method: "POST" });
  assert.equal(second.status, 201);
  assert.equal((await admin.json(`/api/sync/runs/${second.body.id}/cancel`, { method: "POST" })).body.status, "dibatalkan");
  assert.equal((await admin.json(`/api/sync/runs/${second.body.id}/cancel`, { method: "POST" })).status, 409);
});

test("impor ulang tanpa alamat atau jenjang tidak menghapus yang sudah ada", async () => {
  const editor = await h.client("editor");
  await h.sql`truncate locations, import_batches restart identity cascade`;
  await importCsv(editor, "NPSN,Nama,Jenjang,Alamat,Kecamatan,Kabupaten,Provinsi,PD,Jumlah Guru\n30000009,SDN Lengkap,SD,Jl. Asli 1,Senen,Kota Jakarta Pusat,DKI Jakarta,250,10");
  await importCsv(editor, "NPSN,Nama,Jenjang,Alamat,Kecamatan,Kabupaten,Provinsi,PD,Jumlah Guru\n30000009,SDN Lengkap,,,Senen,Kota Jakarta Pusat,DKI Jakarta,,");
  const r = (await h.sql`select address, level, students, teachers from locations where npsn = '30000009'`)[0]!;
  assert.deepEqual([r.address, r.level, r.students, r.teachers], ["Jl. Asli 1", "SD", 250, 10]);
});
