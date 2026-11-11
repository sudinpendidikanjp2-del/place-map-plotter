// Normalisasi penulisan wilayah dan jenjang dari Dapodik agar sama dengan yang dipakai aplikasi.
// Tanpa normalisasi, "Prov. D.K.I. Jakarta" dan "DKI Jakarta" menjadi dua provinsi berbeda di filter.

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

const PROVINCE_ALIASES = new Map(
  [
    ["dki jakarta", "DKI Jakarta"],
    ["d.k.i. jakarta", "DKI Jakarta"],
    ["di yogyakarta", "DI Yogyakarta"],
    ["d.i. yogyakarta", "DI Yogyakarta"],
    ["d.i yogyakarta", "DI Yogyakarta"],
    ["bangka belitung", "Kepulauan Bangka Belitung"],
    ["kep. bangka belitung", "Kepulauan Bangka Belitung"],
    ["kep. riau", "Kepulauan Riau"],
    ["nusa tenggara barat", "Nusa Tenggara Barat"],
  ],
);

export function normalizeProvince(raw) {
  const s = clean(raw).replace(/^(provinsi|prov\.?)\s+/i, "");
  if (!s) return null;
  const hit = PROVINCE_ALIASES.get(s.toLowerCase());
  return hit ?? s.replace(/\b([a-z])([a-z]*)/gi, (_, a, b) => a.toUpperCase() + b.toLowerCase());
}

/** "Kota Adm. Jakarta Pusat" menjadi "Kota Jakarta Pusat", "Kab. Adm. Kepulauan Seribu" menjadi "Kabupaten Kepulauan Seribu". */
export function normalizeCity(raw) {
  let s = clean(raw);
  if (!s) return null;
  s = s.replace(/^kab\.?\s+/i, "Kabupaten ").replace(/\bAdm\.?\s+/i, "");
  const m = /^(kota|kabupaten)\s+(.*)$/i.exec(s);
  if (!m) return s;
  const name = m[2].replace(/\b([a-z])([a-z]*)/gi, (_, a, b) => a.toUpperCase() + b.toLowerCase());
  return `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${name}`;
}

/** "Kec. Senen" menjadi "Senen". */
export function normalizeDistrict(raw) {
  const s = clean(raw).replace(/^(kecamatan|kec\.?)\s+/i, "");
  if (!s) return null;
  return s.replace(/\b([a-z])([a-z]*)/gi, (_, a, b) => a.toUpperCase() + b.toLowerCase());
}

const LEVELS = ["PAUD", "KB", "TK", "TPA", "SPS", "SD", "SMP", "SMA", "SMK", "SLB", "SDLB", "SMPLB", "SMALB", "MI", "MTs", "MA", "PKBM", "SKB"];

/** Mengembalikan jenjang baku, atau null untuk bentuk pendidikan yang tidak dikenal (nilai aslinya tetap disimpan terpisah). */
export function normalizeLevel(raw) {
  const s = clean(raw).replace(/\./g, "").toUpperCase();
  const hit = LEVELS.find((l) => l.toUpperCase() === s);
  return hit ?? null;
}

export function toInt(v) {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(String(v).replace(/[.\s]/g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? String(Math.round(n)) : "";
}
