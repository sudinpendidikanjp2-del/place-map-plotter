import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeCity, normalizeDistrict, normalizeLevel, normalizeProvince, toInt, validCoordinates, yearOf } from "../src/normalize.mjs";
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
  assert.equal(row["Jumlah Guru"], "14");
  assert.equal(row.Sumber, "Dapodik");
  const odd = mapSchool({ npsn: "20100002", nama: "X", bentuk_pendidikan: "Akademi Komunitas" });
  assert.equal(odd.Jenjang, "");
  assert.equal(odd["Bentuk Pendidikan Asli"], "Akademi Komunitas");
  assert.equal(mapSchool({ npsn: "123", nama: "NPSN pendek" }), null);
  assert.equal(mapSchool({ npsn: "20100003" }), null);
  assert.equal(latestDetail([{ semester: "20242", rombel: 5 }, { semester: "20251", rombel: 0 }]).semester, "20242");
  assert.equal(latestDetail([{ semester: "20251", rombel: 7 }, { semester: "20242", rombel: 5 }]).semester, "20251");
});

// Nilai diambil dari halaman Dapodik yang disimpan pengguna (/sekolah?npsn=20110502). Nama bidang dari respons detail-sekolah.
const SMKN_UBUD = {
  semester: "20252", npsn: "20110502", nama: "SMKN 1 MAS UBUD", bentuk_pendidikan: "SMK", jenjang: "SMK", status_sekolah: "Negeri",
  provinsi: "Prov. Bali", kabupaten: "Kab. Gianyar", kecamatan: "Kec. Ubud", desa_kelurahan: "Mas", alamat_jalan: "JL. AMBARAWATI, MAS UBUD",
  tlg_sk_pendirian_sekolah: "2004-07-14", status_kepemilikan: "Pemerintah Daerah", kode_pos: "80571", lintang: -8.5416, bujur: 115.2697,
  akreditasi: "A", sumber_listrik: "PLN", daya_listrik: "5500", internet_jenis_layanan: "Fibre Optic", internet_provider: "Biznet",
  internet_bandwidth: "600", partisipasi_bos: "Ya", nama_kepsek: "I Komang Purwata", pd: 1345, rombel: 41, jum_ptk: 103, jum_guru: 90, jum_tendik: 13,
  ruang_kelas: 29, kelas_berat: 4, perpus: 1, wc_siswa: 3,
};

test("koordinat dan detail lengkap dipetakan dari respons detail-sekolah", () => {
  const row = mapSchool(SMKN_UBUD);
  assert.equal(row.Lintang, "-8.5416");
  assert.equal(row.Bujur, "115.2697");
  assert.equal(row["Catatan Koordinat"], "");
  assert.equal(row["Tahun Berdiri"], "2004");
  assert.equal(row.Jenjang, "SMK");
  assert.equal(row.Provinsi, "Bali");
  assert.equal(row["Kabupaten/Kota"], "Kabupaten Gianyar");
  assert.equal(row.Kecamatan, "Ubud");
  assert.equal(row["Jumlah PD"], "1345");
  assert.equal(row["Jumlah Guru"], "90");
  assert.equal(row["PTK Total"], "103");
  assert.equal(row["Kepala Sekolah"], "I Komang Purwata");
  assert.equal(row["Kelas Rusak Berat"], "4");
});

test("koordinat tidak valid mengikuti aturan portal: nol, kosong, di luar Indonesia, atau bukan angka", () => {
  assert.deepEqual(validCoordinates(-8.5416, 115.2697), { lat: -8.5416, lng: 115.2697 });
  assert.deepEqual(validCoordinates("-8,54", "115,27"), { lat: -8.54, lng: 115.27 });
  assert.equal(validCoordinates(0, 0), null);
  assert.equal(validCoordinates(null, 115), null);
  assert.equal(validCoordinates("", ""), null);
  assert.equal(validCoordinates(115.2697, -8.5416), null, "lintang dan bujur tertukar");
  assert.equal(validCoordinates(40.7, -74), null);
  assert.equal(validCoordinates("abc", 110), null);
  const bad = mapSchool({ ...SMKN_UBUD, lintang: 0, bujur: 0 });
  assert.equal(bad.Lintang, "");
  assert.match(bad["Catatan Koordinat"], /tidak valid/);
  const none = mapSchool({ ...SMKN_UBUD, lintang: null, bujur: null });
  assert.equal(none["Catatan Koordinat"], "Dapodik tidak memuat koordinat");
  assert.equal(yearOf("2004-07-14"), "2004");
  assert.equal(yearOf(null), "");
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
