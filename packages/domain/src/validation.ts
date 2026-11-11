import type { FieldErrors, LocationInput, Validation } from "./types.ts";
import { LEVELS, LOCATION_KINDS, type Level } from "./types.ts";

const MAX_NAME = 200;
const MAX_TEXT = 2000;

function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

function intOrNull(v: unknown, min: number, max: number): number | null | "invalid" {
  const s = text(v).replace(/[.\s]/g, "");
  if (s === "") return null;
  if (!/^-?\d+$/.test(s)) return "invalid";
  const n = Number(s);
  return n < min || n > max ? "invalid" : n;
}

function numberOrNaN(v: unknown): number {
  if (typeof v === "number") return v;
  const s = text(v).replace(",", ".");
  return s === "" ? NaN : Number(s);
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Satu sumber validasi untuk form web, impor CSV, dan API server. */
export function validateLocationInput(raw: Record<string, unknown>): Validation<LocationInput> {
  const errors: FieldErrors = {};

  const kindRaw = text(raw.kind).toLowerCase();
  const kind = (LOCATION_KINDS as readonly string[]).includes(kindRaw)
    ? (kindRaw as LocationInput["kind"])
    : null;
  if (!kind) errors.kind = "Pilih jenis: sekolah, fasilitas, atau aset.";

  const name = text(raw.name);
  if (!name) errors.name = "Nama wajib diisi.";
  else if (name.length > MAX_NAME) errors.name = `Nama maksimal ${MAX_NAME} karakter.`;


  const levelRaw = text(raw.level);
  const level = levelRaw ? (LEVELS.find((l) => l.toLowerCase() === levelRaw.toLowerCase()) ?? null) : null;
  if (levelRaw && !level) errors.level = `Jenjang tidak dikenal. Pilihan: ${LEVELS.join(", ")}.`;

  const category = text(raw.category) || level || "Umum";
  if (category.length > 100) errors.category = "Kategori maksimal 100 karakter.";

  const npsnRaw = text(raw.npsn);
  if (npsnRaw && !/^\d{8}$/.test(npsnRaw)) errors.npsn = "NPSN harus 8 digit angka.";
  const npsn = npsnRaw || null;

  const region = (v: unknown): string | null => {
    const t = text(v).replace(/\s+/g, " ");
    return t ? t.slice(0, 100) : null;
  };

  const latitude = numberOrNaN(raw.latitude);
  const longitude = numberOrNaN(raw.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    errors.latitude = "Lintang harus berupa angka antara -90 dan 90.";
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    errors.longitude = "Bujur harus berupa angka antara -180 dan 180.";
  }

  const address = text(raw.address) || null;
  if (address && address.length > MAX_TEXT) errors.address = "Alamat terlalu panjang.";
  const description = text(raw.description) || null;
  if (description && description.length > MAX_TEXT) errors.description = "Keterangan terlalu panjang.";

  const foundedYear = intOrNull(raw.foundedYear, 1000, 2100);
  if (foundedYear === "invalid") errors.foundedYear = "Tahun berdiri harus berupa angka empat digit.";

  const photoUrl = text(raw.photoUrl) || null;
  if (photoUrl && !isHttpUrl(photoUrl)) errors.photoUrl = "Tautan foto harus diawali http:// atau https://.";

  const students = intOrNull(raw.students, 0, 10_000_000);
  if (students === "invalid") errors.students = "Jumlah murid harus berupa bilangan bulat 0 atau lebih.";
  const teachers = intOrNull(raw.teachers, 0, 1_000_000);
  if (teachers === "invalid") errors.teachers = "Jumlah guru harus berupa bilangan bulat 0 atau lebih.";

  const attributes: Record<string, string> = {};
  if (raw.attributes && typeof raw.attributes === "object" && !Array.isArray(raw.attributes)) {
    for (const [k, v] of Object.entries(raw.attributes as Record<string, unknown>)) {
      const key = k.trim().slice(0, 80);
      const val = text(v).slice(0, 500);
      if (key && val) attributes[key] = val;
    }
  }

  if (Object.keys(errors).length > 0 || !kind) return { ok: false, errors };

  return {
    ok: true,
    value: {
      kind,
      name,
      category,
      level: level as Level | null,
      npsn,
      province: region(raw.province),
      city: region(raw.city),
      district: region(raw.district),
      latitude,
      longitude,
      address,
      description,
      foundedYear: foundedYear as number | null,
      photoUrl,
      students: students as number | null,
      teachers: teachers as number | null,
      attributes,
    },
  };
}
