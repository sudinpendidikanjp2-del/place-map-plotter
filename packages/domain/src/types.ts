export const LOCATION_KINDS = ["sekolah", "fasilitas", "aset"] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

export const KIND_LABEL: Record<LocationKind, string> = {
  sekolah: "Sekolah",
  fasilitas: "Fasilitas",
  aset: "Aset",
};

/** Jenjang pendidikan baku. Nilai lain ditolak agar filter jenjang tidak terpecah oleh variasi penulisan. */
export const LEVELS = ["PAUD", "KB", "TK", "TPA", "SPS", "SD", "SMP", "SMA", "SMK", "SLB", "SDLB", "SMPLB", "SMALB", "MI", "MTs", "MA", "PKBM", "SKB"] as const;
export type Level = (typeof LEVELS)[number];

export interface LocationInput {
  kind: LocationKind;
  name: string;
  category: string;
  /** Jenjang, hanya bermakna untuk sekolah. */
  level: Level | null;
  /** Nomor Pokok Sekolah Nasional (8 digit). Dipakai sebagai kunci pembaruan dari Dapodik. */
  npsn: string | null;
  /** Wilayah eksplisit. Bila kosong, diurai dari alamat. */
  province: string | null;
  city: string | null;
  district: string | null;
  latitude: number;
  longitude: number;
  address: string | null;
  description: string | null;
  foundedYear: number | null;
  photoUrl: string | null;
  students: number | null;
  teachers: number | null;
  attributes: Record<string, string>;
}

export interface LocationImage {
  id: string;
  width: number;
  height: number;
  caption: string | null;
}

export interface Location extends LocationInput {
  id: string;
  version: number;
  images: LocationImage[];
  createdAt: string;
  updatedAt: string;
}

export type FieldErrors = Partial<Record<keyof LocationInput | "row", string>>;

export type Validation<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

export const USER_ROLES = ["viewer", "editor", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_LABEL: Record<UserRole, string> = {
  viewer: "Pembaca",
  editor: "Penyunting",
  admin: "Admin",
};

export function roleAtLeast(role: UserRole, min: UserRole): boolean {
  return USER_ROLES.indexOf(role) >= USER_ROLES.indexOf(min);
}

export interface BBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface LocationFilter {
  kind?: LocationKind;
  category?: string;
  level?: Level;
  province?: string;
  city?: string;
  district?: string;
  q?: string;
  bbox?: BBox;
  circle?: { lat: number; lng: number; radiusM: number };
  polygon?: [number, number][];
}

export interface ClusterFeature {
  lat: number;
  lng: number;
  count: number;
  /** Terisi hanya jika count === 1 */
  id: string | null;
  kind: LocationKind | null;
  name: string | null;
}

export interface Summary {
  total: number;
  students: number;
  teachers: number;
  byKind: { kind: LocationKind; count: number }[];
  byCategory: { category: string; count: number; students: number }[];
  byProvince: { province: string; count: number }[];
  addedPerMonth: { month: string; count: number }[];
}
