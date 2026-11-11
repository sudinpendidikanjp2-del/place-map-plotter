import { normalizeCity, normalizeDistrict, normalizeLevel, normalizeProvince, toInt, validCoordinates, yearOf } from "./normalize.mjs";

/** Kolom CSV hasil. Judulnya dikenali otomatis oleh impor Peta Sekolah (lihat docs/DAPODIK.md). */
export const COLUMNS = [
  "NPSN",
  "Nama Satuan Pendidikan",
  "Jenjang",
  "Bentuk Pendidikan Asli",
  "Status Sekolah",
  "Alamat Jalan",
  "Kelurahan",
  "Kecamatan",
  "Kabupaten/Kota",
  "Provinsi",
  "Lintang",
  "Bujur",
  "Tahun Berdiri",
  "Jumlah PD",
  "Jumlah Guru",
  // Kolom di bawah ini disimpan sebagai data tambahan pada tiap lokasi.
  "Catatan Koordinat",
  "Kepala Sekolah",
  "Status Kepemilikan",
  "Akreditasi",
  "Kode Pos",
  "RT",
  "RW",
  "PD Laki-laki",
  "PD Perempuan",
  "Rombel",
  "PTK Total",
  "Tenaga Kependidikan",
  "Ruang Kelas",
  "Kelas Rusak Berat",
  "Perpustakaan",
  "Lab Komputer",
  "Toilet Siswa",
  "Sumber Listrik",
  "Daya Listrik",
  "Layanan Internet",
  "Penyedia Internet",
  "Bandwidth Internet",
  "Partisipasi BOSP",
  "Semester Data",
  "Sumber",
];

// Nama bidang di respons detail-sekolah bisa berubah. Beberapa kandidat dicoba berurutan.
const KEYS = {
  npsn: ["npsn"],
  nama: ["nama", "nama_sekolah", "nama_satuan_pendidikan"],
  bentuk: ["bentuk_pendidikan", "bentuk", "jenjang"],
  status: ["status_sekolah", "status"],
  alamat: ["alamat_jalan", "alamat"],
  kelurahan: ["desa_kelurahan", "kelurahan", "desa"],
  kecamatan: ["kecamatan"],
  kabupaten: ["kabupaten", "kabupaten_kota", "kota"],
  provinsi: ["provinsi"],
  pd: ["pd", "jumlah_pd", "jum_pd", "peserta_didik"],
  guru: ["jum_guru", "jumlah_guru", "guru"],
  tendik: ["jum_tendik", "jumlah_tendik", "tendik"],
  rombel: ["rombel", "jum_rombel"],
  akreditasi: ["akreditasi"],
  lintang: ["lintang", "latitude", "lat"],
  bujur: ["bujur", "longitude", "lng", "lon"],
  tglPendirian: ["tlg_sk_pendirian_sekolah", "tgl_sk_pendirian_sekolah"],
};

const pick = (row, names) => {
  for (const n of names) if (row[n] !== undefined && row[n] !== null && row[n] !== "") return row[n];
  return "";
};

/** Mengubah satu respons detail sekolah menjadi satu baris CSV. Mengembalikan null bila tidak ada NPSN atau nama. */
export function mapSchool(row, { basic = false } = {}) {
  const npsn = String(pick(row, KEYS.npsn)).trim();
  const nama = String(pick(row, KEYS.nama)).trim();
  if (!/^\d{8}$/.test(npsn) || !nama) return null;
  const bentuk = String(pick(row, KEYS.bentuk)).trim();
  const rawLat = pick(row, KEYS.lintang);
  const rawLng = pick(row, KEYS.bujur);
  const coords = validCoordinates(rawLat, rawLng);
  const had = rawLat !== "" || rawLng !== "";
  const text = (k) => String(row[k] ?? "").trim();
  return {
    NPSN: npsn,
    "Nama Satuan Pendidikan": nama,
    Jenjang: normalizeLevel(bentuk) ?? "",
    "Bentuk Pendidikan Asli": bentuk,
    "Status Sekolah": String(pick(row, KEYS.status)).trim(),
    "Alamat Jalan": String(pick(row, KEYS.alamat)).trim(),
    Kelurahan: String(pick(row, KEYS.kelurahan)).trim(),
    Kecamatan: normalizeDistrict(pick(row, KEYS.kecamatan)) ?? "",
    "Kabupaten/Kota": normalizeCity(pick(row, KEYS.kabupaten)) ?? "",
    Provinsi: normalizeProvince(pick(row, KEYS.provinsi)) ?? "",
    Lintang: coords ? String(coords.lat) : "",
    Bujur: coords ? String(coords.lng) : "",
    "Tahun Berdiri": yearOf(pick(row, KEYS.tglPendirian)),
    "Jumlah PD": toInt(pick(row, KEYS.pd)),
    "Jumlah Guru": toInt(pick(row, KEYS.guru)),
    "Catatan Koordinat": coords ? "" : basic ? "Detail Dapodik belum terambil, koordinat menyusul" : had ? `Koordinat Dapodik tidak valid (${rawLat} & ${rawLng}), dicari ulang` : "Dapodik tidak memuat koordinat",
    "Kepala Sekolah": text("nama_kepsek"),
    "Status Kepemilikan": text("status_kepemilikan"),
    Akreditasi: String(pick(row, KEYS.akreditasi)).trim(),
    "Kode Pos": text("kode_pos"),
    RT: text("rt"),
    RW: text("rw"),
    "PD Laki-laki": toInt(row.pd_l),
    "PD Perempuan": toInt(row.pd_p),
    Rombel: toInt(pick(row, KEYS.rombel)),
    "PTK Total": toInt(row.jum_ptk),
    "Tenaga Kependidikan": toInt(pick(row, KEYS.tendik)),
    "Ruang Kelas": toInt(row.ruang_kelas),
    "Kelas Rusak Berat": toInt(row.kelas_berat),
    Perpustakaan: toInt(row.perpus),
    "Lab Komputer": toInt(row.lab_kom),
    "Toilet Siswa": toInt(row.wc_siswa),
    "Sumber Listrik": text("sumber_listrik"),
    "Daya Listrik": text("daya_listrik"),
    "Layanan Internet": text("internet_jenis_layanan"),
    "Penyedia Internet": text("internet_provider"),
    "Bandwidth Internet": text("internet_bandwidth"),
    "Partisipasi BOSP": text("partisipasi_bos"),
    "Semester Data": text("semester"),
    Sumber: "Dapodik",
  };
}

/** Detail sering memuat beberapa semester. Ambil yang terbaru, dan lewati semester kosong (rombel 0) bila ada yang sebelumnya. */
export function latestDetail(rows) {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => String(b.semester ?? "").localeCompare(String(a.semester ?? "")));
  return sorted[0].rombel === 0 && sorted.length > 1 ? sorted[1] : sorted[0];
}
