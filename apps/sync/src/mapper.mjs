import { normalizeCity, normalizeDistrict, normalizeLevel, normalizeProvince, toInt } from "./normalize.mjs";

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
  "Jumlah PD",
  "Jumlah PTK",
  "Jumlah Tendik",
  "Jumlah Rombel",
  "Akreditasi",
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
  guru: ["jum_guru", "jumlah_guru", "guru", "jum_ptk"],
  tendik: ["jum_tendik", "jumlah_tendik", "tendik"],
  rombel: ["rombel", "jum_rombel"],
  akreditasi: ["akreditasi"],
};

const pick = (row, names) => {
  for (const n of names) if (row[n] !== undefined && row[n] !== null && row[n] !== "") return row[n];
  return "";
};

/** Mengubah satu respons detail sekolah menjadi satu baris CSV. Mengembalikan null bila tidak ada NPSN atau nama. */
export function mapSchool(row) {
  const npsn = String(pick(row, KEYS.npsn)).trim();
  const nama = String(pick(row, KEYS.nama)).trim();
  if (!/^\d{8}$/.test(npsn) || !nama) return null;
  const bentuk = String(pick(row, KEYS.bentuk)).trim();
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
    "Jumlah PD": toInt(pick(row, KEYS.pd)),
    "Jumlah PTK": toInt(pick(row, KEYS.guru)),
    "Jumlah Tendik": toInt(pick(row, KEYS.tendik)),
    "Jumlah Rombel": toInt(pick(row, KEYS.rombel)),
    Akreditasi: String(pick(row, KEYS.akreditasi)).trim(),
    Sumber: "Dapodik",
  };
}

/** Detail sering memuat beberapa semester. Ambil yang terbaru, dan lewati semester kosong (rombel 0) bila ada yang sebelumnya. */
export function latestDetail(rows) {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => String(b.semester ?? "").localeCompare(String(a.semester ?? "")));
  return sorted[0].rombel === 0 && sorted.length > 1 ? sorted[1] : sorted[0];
}
