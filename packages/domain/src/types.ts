export const LOCATION_KINDS = ["sekolah", "fasilitas", "aset"] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

export const KIND_LABEL: Record<LocationKind, string> = {
  sekolah: "Sekolah",
  fasilitas: "Fasilitas",
  aset: "Aset",
};

export interface LocationInput {
  kind: LocationKind;
  name: string;
  category: string;
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

export interface Location extends LocationInput {
  id: string;
  province: string | null;
  city: string | null;
  district: string | null;
  version: number;
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
