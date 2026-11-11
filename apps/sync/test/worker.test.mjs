import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeCity, normalizeDistrict, normalizeLevel, normalizeProvince, toInt } from "../src/normalize.mjs";
import { COLUMNS, latestDetail, mapSchool } from "../src/mapper.mjs";
import { toCsv } from "../src/csv.mjs";
import { checkAgainstPrevious } from "../src/guard.mjs";
import { collectDapodik, ServerTroubleError } from "../src/dapodik.mjs";
import { startFakePortal } from "./fake-portal.mjs";

let hasPlaywright = true;
try {
  createRequire(import.meta.url)("playwright");
} catch {
  hasPlaywright = false;
}

test("normalisasi wilayah dan jenjang mengikuti penulisan aplikasi", () => {
  assert.equal(normalizeProvince("Prov. D.K.I. Jakarta"), "DKI Jakarta");
  assert.equal(normalizeProvince("Prov. Jawa Barat"), "Jawa Barat");
  assert.equal(normalizeProvince("Prov. D.I. Yogyakarta"), "DI Yogyakarta");
  assert.equal(normalizeCity("Kota Adm. Jakarta Pusat"), "Kota Jakarta Pusat");
  assert.equal(normalizeCity("Kab. Adm. Kepulauan Seribu"), "Kabupaten Kepulauan Seribu");
  assert.equal(normalizeCity("Kab. Bogor"), "Kabupaten Bogor");
  assert.equal(normalizeDistrict("Kec. Senen"), "Senen");
  assert.equal(normalizeDistrict("KEC. JOHAR BARU"), "Johar Baru");
  assert.equal(normalizeLevel("SD"), "SD");
  assert.equal(normalizeLevel("S.M.A"), "SMA");
  assert.equal(normalizeLevel("Akademi Komunitas"), null);
  assert.equal(toInt("1.250"), "1250");
  assert.equal(toInt(null), "");
  assert.equal(toInt("-3"), "");
});

test("pemetaan satu sekolah, termasuk bentuk pendidikan yang tidak dikenal", () => {
  const row = mapSchool({ npsn: "20100001", nama: "SDN SENEN 01", bentuk_pendidikan: "SD", status_sekolah: "Negeri", alamat_jalan: "Jl. A", kecamatan: "Kec. Senen", kabupaten: "Kota Adm. Jakarta Pusat", provinsi: "Prov. D.K.I. Jakarta", pd: 321, jum_guru: 14, jum_tendik: 3, rombel: 12 });
  assert.equal(row.Jenjang, "SD");
  assert.equal(row.Kecamatan, "Senen");
  assert.equal(row["Kabupaten/Kota"], "Kota Jakarta Pusat");
  assert.equal(row.Provinsi, "DKI Jakarta");
  assert.equal(row["Jumlah PD"], "321");
  assert.equal(row.Sumber, "Dapodik");
  const odd = mapSchool({ npsn: "20100002", nama: "X", bentuk_pendidikan: "Akademi Komunitas" });
  assert.equal(odd.Jenjang, "");
  assert.equal(odd["Bentuk Pendidikan Asli"], "Akademi Komunitas");
  assert.equal(mapSchool({ npsn: "123", nama: "NPSN pendek" }), null);
  assert.equal(mapSchool({ npsn: "20100003" }), null);
  assert.equal(latestDetail([{ semester: "20242", rombel: 5 }, { semester: "20251", rombel: 0 }]).semester, "20242");
  assert.equal(latestDetail([{ semester: "20251", rombel: 7 }, { semester: "20242", rombel: 5 }]).semester, "20251");
});

test("CSV hasil memakai judul kolom yang dikenali impor dan mengutip dengan benar", () => {
  const csv = toCsv(COLUMNS, [mapSchool({ npsn: "20100001", nama: 'SDN "Satu", Senen', bentuk_pendidikan: "SD" })]);
  const [head, line] = csv.trim().split("\r\n");
  assert.ok(head.startsWith("NPSN,Nama Satuan Pendidikan,Jenjang"));
  assert.ok(line.includes('"SDN ""Satu"", Senen"'));
});

test("penjaga menolak hasil kosong atau jauh lebih sedikit dari penarikan sebelumnya", () => {
  assert.equal(checkAgainstPrevious({ seen: 0, previousSeen: 0 }).ok, false);
  assert.equal(checkAgainstPrevious({ seen: 100, previousSeen: 0 }).ok, true);
  assert.equal(checkAgainstPrevious({ seen: 60, previousSeen: 100 }).ok, false);
  assert.equal(checkAgainstPrevious({ seen: 70, previousSeen: 100 }).ok, true);
});

const fast = (base, dir, extra = {}) => ({ base, kodeProvinsi: "010000", kodeKabupaten: "016000", kecamatan: [], delayMinMs: 1, delayMaxMs: 3, refreshDays: 7, retry: 0, backoffMs: 1, cacheDir: dir, ...extra });

test("pengumpul berbasis halaman mengambil semua sekolah dan memakai cache pada jalan kedua", { skip: !hasPlaywright && "Playwright tidak terpasang" }, async () => {
  const portal = await startFakePortal({ perKecamatan: 3 });
  const dir = mkdtempSync(join(tmpdir(), "sync-cache-"));
  try {
    const first = await collectDapodik(fast(portal.url, dir), () => {});
    assert.equal(first.kecamatanCount, 2);
    assert.equal(first.schoolsSeen, 6);
    assert.equal(first.details.length, 6);
    assert.equal(first.failed.length, 0);
    assert.ok(first.details.every((d) => d.semester === "20251" || d.semester === "20242"));
    const before = portal.calls.length;
    const second = await collectDapodik(fast(portal.url, dir), () => {});
    assert.equal(second.details.length, 6);
    assert.equal(portal.calls.length, before, "jalan kedua tidak boleh memanggil portal karena semua ada di cache");
    // satu kecamatan saja
    const dir2 = mkdtempSync(join(tmpdir(), "sync-cache-"));
    const one = await collectDapodik(fast(portal.url, dir2, { kecamatan: ["Kec. Senen"] }), () => {});
    assert.equal(one.schoolsSeen, 3);
    rmSync(dir2, { recursive: true, force: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await portal.close();
  }
});

test("sekolah yang gagal diambil dicatat tanpa menghentikan sisanya", { skip: !hasPlaywright && "Playwright tidak terpasang" }, async () => {
  const portal = await startFakePortal({ perKecamatan: 3 });
  const dir = mkdtempSync(join(tmpdir(), "sync-cache-"));
  try {
    portal.behavior.failNpsn = portal.schoolsOf("016001")[1].npsn;
    const r = await collectDapodik(fast(portal.url, dir, { maxConsecutiveFail: 10 }), () => {});
    assert.equal(r.details.length, 5);
    assert.equal(r.failed.length, 1);
    assert.match(r.failed[0].alasan, /429/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await portal.close();
  }
});

test("portal yang menolak akses (403) menghentikan penarikan, tidak dicoba dilewati", { skip: !hasPlaywright && "Playwright tidak terpasang" }, async () => {
  const portal = await startFakePortal();
  const dir = mkdtempSync(join(tmpdir(), "sync-cache-"));
  try {
    portal.behavior.denyAll = true;
    await assert.rejects(collectDapodik(fast(portal.url, dir), () => {}), (e) => e instanceof ServerTroubleError && /403/.test(e.message) && /penyamaran/.test(e.message));
    assert.equal(readdirSync(dir).length, 0, "tidak ada yang disimpan");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await portal.close();
  }
});

test("daftar sekolah bertingkat halaman gagal dengan jelas, bukan terpotong diam-diam", { skip: !hasPlaywright && "Playwright tidak terpasang" }, async () => {
  const portal = await startFakePortal({ behavior: { pages: 3 } });
  const dir = mkdtempSync(join(tmpdir(), "sync-cache-"));
  try {
    await assert.rejects(collectDapodik(fast(portal.url, dir), () => {}), /3 halaman data/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await portal.close();
  }
  void readFileSync;
});
