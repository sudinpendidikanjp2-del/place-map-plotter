import {
  filterToParams,
  type ClusterFeature,
  type Location,
  type LocationFilter,
  type LocationInput,
  type LocationKind,
  type Summary,
  type UserRole,
} from "@peta/domain";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, string> | undefined;
  constructor(status: number, code: string, message: string, details?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

async function parseError(res: Response): Promise<ApiError> {
  try {
    const body = await res.json();
    const e = body?.error;
    return new ApiError(res.status, e?.code ?? "error", e?.message ?? "Terjadi kesalahan.", e?.details);
  } catch {
    return new ApiError(res.status, "error", res.status >= 500 ? "Server sedang bermasalah. Coba lagi sebentar lagi." : "Permintaan gagal.");
  }
}

async function request<T>(path: string, init: { method?: string; json?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? "GET",
      credentials: "same-origin",
      signal: init.signal ?? null,
      headers: init.json !== undefined ? { "content-type": "application/json" } : {},
      body: init.json !== undefined ? JSON.stringify(init.json) : null,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(0, "network", "Tidak dapat terhubung ke server. Periksa koneksi Anda.");
  }
  if (!res.ok) {
    const err = await parseError(res);
    if (res.status === 401 && path !== "/api/auth/login" && path !== "/api/auth/me") onUnauthorized?.();
    throw err;
  }
  return (await res.json()) as T;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export interface UserRow extends SessionUser {
  disabled: boolean;
  createdAt: string;
}

export interface ImportBatch {
  id: string;
  filename: string;
  defaultKind: LocationKind;
  status: "menunggu" | "berjalan" | "selesai" | "gagal" | "dibatalkan";
  total: number;
  inserted: number;
  failed: number;
  errors: { row: number; message: string }[];
  message: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface Facets {
  categories: { category: string; count: number }[];
  provinces: { value: string; count: number }[];
  cities: { value: string; count: number }[];
  districts: { value: string; count: number }[];
}

export interface ListResult {
  items: Location[];
  nextCursor: string | null;
  total: number;
  totalCapped: boolean;
}

const qs = (p: URLSearchParams) => (p.size ? `?${p}` : "");

export const api = {
  me: (signal?: AbortSignal) => request<{ user: SessionUser }>("/api/auth/me", signal ? { signal } : {}),
  login: (email: string, password: string) => request<{ user: SessionUser }>("/api/auth/login", { method: "POST", json: { email, password } }),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  changePassword: (current: string, next: string) => request<{ ok: true }>("/api/auth/change-password", { method: "POST", json: { current, next } }),

  clusters: (f: LocationFilter, zoom: number, signal: AbortSignal) => {
    const p = filterToParams(f);
    p.set("zoom", String(zoom));
    return request<{ features: ClusterFeature[]; total: number; truncated: boolean }>(`/api/locations/clusters${qs(p)}`, { signal });
  },
  list: (f: LocationFilter, o: { sort: "baru" | "nama"; limit?: number; cursor?: string | null }, signal?: AbortSignal) => {
    const p = filterToParams(f);
    p.set("sort", o.sort);
    p.set("limit", String(o.limit ?? 50));
    if (o.cursor) p.set("cursor", o.cursor);
    return request<ListResult>(`/api/locations${qs(p)}`, signal ? { signal } : {});
  },
  extent: (f: LocationFilter, signal?: AbortSignal) =>
    request<{ count: number; bbox: { west: number; south: number; east: number; north: number } | null }>(`/api/locations/extent${qs(filterToParams(f))}`, signal ? { signal } : {}),
  get: (id: string, signal?: AbortSignal) => request<Location>(`/api/locations/${id}`, signal ? { signal } : {}),
  create: (input: LocationInput) => request<Location>("/api/locations", { method: "POST", json: input }),
  update: (id: string, input: LocationInput, version: number) => request<Location>(`/api/locations/${id}`, { method: "PATCH", json: { ...input, version } }),
  remove: (id: string) => request<{ ok: true }>(`/api/locations/${id}`, { method: "DELETE" }),
  bulkUpdate: (sel: { ids: string[] } | { filter: LocationFilter }, patch: { category?: string; kind?: LocationKind }) =>
    request<{ updated: number }>("/api/locations/bulk-update", { method: "POST", json: { ...("ids" in sel ? sel : { filter: Object.fromEntries(filterToParams(sel.filter)) }), ...patch } }),
  bulkDelete: (sel: { ids: string[] } | { filter: LocationFilter }) =>
    request<{ deleted: number }>("/api/locations/bulk-delete", { method: "POST", json: "ids" in sel ? sel : { filter: Object.fromEntries(filterToParams(sel.filter)) } }),
  facets: (scope: { province?: string | undefined; city?: string | undefined }, signal?: AbortSignal) => {
    const p = new URLSearchParams();
    if (scope.province) p.set("province", scope.province);
    if (scope.city) p.set("city", scope.city);
    return request<Facets>(`/api/locations/facets${qs(p)}`, signal ? { signal } : {});
  },
  summary: (f: LocationFilter, signal?: AbortSignal) => request<Summary>(`/api/reports/summary${qs(filterToParams(f))}`, signal ? { signal } : {}),

  imports: {
    list: (signal?: AbortSignal) => request<{ items: ImportBatch[] }>("/api/imports", signal ? { signal } : {}),
    get: (id: string) => request<ImportBatch>(`/api/imports/${id}`),
    create: (filename: string, defaultKind: LocationKind) => request<ImportBatch>("/api/imports", { method: "POST", json: { filename, defaultKind } }),
    cancel: (id: string) => request<{ removed: number }>(`/api/imports/${id}`, { method: "DELETE" }),
    /** Mengunggah berkas dengan XHR agar kemajuan unggahan bisa ditampilkan. */
    upload: (id: string, file: File, onProgress: (fraction: number) => void) =>
      new Promise<ImportBatch>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", `/api/imports/${id}/file`);
        xhr.setRequestHeader("content-type", "text/csv");
        xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
        xhr.onerror = () => reject(new ApiError(0, "network", "Unggahan terputus. Periksa koneksi Anda."));
        xhr.onload = () => {
          let body: unknown = null;
          try {
            body = JSON.parse(xhr.responseText);
          } catch {
            /* tubuh respons kosong */
          }
          if (xhr.status >= 200 && xhr.status < 300) resolve(body as ImportBatch);
          else {
            const e = (body as { error?: { code?: string; message?: string } } | null)?.error;
            reject(new ApiError(xhr.status, e?.code ?? "error", e?.message ?? "Impor gagal."));
          }
        };
        xhr.send(file);
      }),
  },

  users: {
    list: (signal?: AbortSignal) => request<{ items: UserRow[] }>("/api/users", signal ? { signal } : {}),
    create: (v: { email: string; name: string; role: UserRole; password: string }) => request<UserRow>("/api/users", { method: "POST", json: v }),
    update: (id: string, v: { name?: string; role?: UserRole; disabled?: boolean; password?: string }) => request<UserRow>(`/api/users/${id}`, { method: "PATCH", json: v }),
  },

  exportCsvUrl: (f: LocationFilter) => `/api/export/csv${qs(filterToParams(f))}`,
  backupUrl: "/api/export/backup",
  staticMapUrl: (f: LocationFilter, zoom: number, size = "640x400") => {
    const p = filterToParams(f);
    p.set("zoom", String(zoom));
    p.set("size", size);
    return `/api/export/static-map?${p}`;
  },
};
