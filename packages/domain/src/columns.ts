import type { LocationInput } from "./types.ts";

export type MappedField = Exclude<keyof LocationInput, "attributes">;

export const FIELD_LABEL: Record<MappedField, string> = {
  kind: "Jenis",
  name: "Nama",
  category: "Kategori",
  latitude: "Lintang",
  longitude: "Bujur",
  address: "Alamat",
  description: "Keterangan",
  foundedYear: "Tahun berdiri",
  photoUrl: "Tautan foto",
  students: "Jumlah murid",
  teachers: "Jumlah guru",
};

const SYNONYMS: Record<MappedField, string[]> = {
  kind: ["jenis", "kind", "tipe data", "jenis data"],
  name: ["nama", "name", "nama lokasi", "nama sekolah", "nama fasilitas", "nama aset", "title", "judul", "label"],
  category: ["kategori", "category", "tipe", "type", "jenjang", "grup", "group"],
  latitude: ["latitude", "lat", "lintang", "koordinat y", "y"],
  longitude: ["longitude", "lng", "lon", "long", "bujur", "koordinat x", "x"],
  address: ["alamat", "address", "lokasi", "tempat"],
  description: ["keterangan", "deskripsi", "description", "info", "catatan", "notes", "detail"],
  foundedYear: ["tahun berdiri", "tahun didirikan", "tahun", "founded", "tahun resmi", "tahun diresmikan"],
  photoUrl: ["foto", "photo", "gambar", "image", "url foto", "url gambar", "tautan foto"],
  students: ["jumlah murid", "murid", "siswa", "jumlah siswa", "peserta didik", "students"],
  teachers: ["jumlah guru", "guru", "pendidik", "teachers"],
};

export function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[_\-./()]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Mengembalikan indeks kolom per bidang (-1 jika tidak ada). Pencocokan persis dulu, lalu awalan kata. */
export function mapHeaders(headers: string[]): Record<MappedField, number> {
  const norm = headers.map(normalizeHeader);
  const used = new Set<number>();
  const result = {} as Record<MappedField, number>;
  const fields = Object.keys(SYNONYMS) as MappedField[];
  for (const f of fields) result[f] = -1;
  for (const f of fields) {
    const idx = norm.findIndex((h, i) => !used.has(i) && SYNONYMS[f].includes(h));
    if (idx !== -1) {
      result[f] = idx;
      used.add(idx);
    }
  }
  return result;
}

/** Mengubah satu baris CSV menjadi objek mentah untuk `validateLocationInput`. */
export function rowToRaw(
  row: string[],
  headers: string[],
  mapping: Record<MappedField, number>,
  defaults: { kind: string },
): Record<string, unknown> {
  const mapped = new Set(Object.values(mapping).filter((i) => i >= 0));
  const get = (f: MappedField): string | undefined => {
    const i = mapping[f];
    return i >= 0 ? row[i] : undefined;
  };
  const attributes: Record<string, string> = {};
  headers.forEach((h, i) => {
    const v = row[i];
    if (!mapped.has(i) && h.trim() && v !== undefined && v.trim() !== "") attributes[h.trim()] = v;
  });
  return {
    kind: get("kind") || defaults.kind,
    name: get("name"),
    category: get("category"),
    latitude: get("latitude"),
    longitude: get("longitude"),
    address: get("address"),
    description: get("description"),
    foundedYear: get("foundedYear"),
    photoUrl: get("photoUrl"),
    students: get("students"),
    teachers: get("teachers"),
    attributes,
  };
}

export const EXPORT_HEADERS = [
  "Jenis", "Nama", "Kategori", "Lintang", "Bujur", "Alamat", "Provinsi", "Kota/Kabupaten", "Kecamatan",
  "Tahun berdiri", "Jumlah murid", "Jumlah guru", "Keterangan", "Tautan foto",
] as const;
