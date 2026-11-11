export interface Config {
  port: number;
  databaseUrl: string;
  secureCookies: boolean;
  /** Origin tambahan yang diizinkan untuk permintaan penulisan (selain host yang sama). */
  allowedOrigins: string[];
  staticMapsKey: string | null;
  webDist: string;
  maxUploadBytes: number;
  dbPoolSize: number;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Variabel ${name} harus bilangan bulat positif, diterima "${raw}".`);
  return n;
}

/** Membaca dan memvalidasi lingkungan sekali saat boot agar gagal cepat dengan pesan jelas. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL belum diatur. Contoh: postgres://pengguna:sandi@localhost:5432/peta");
  return {
    port: int("PORT", 3000),
    databaseUrl,
    secureCookies: env.COOKIE_SECURE !== "false" && env.NODE_ENV === "production",
    allowedOrigins: (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    staticMapsKey: env.STATIC_MAPS_KEY || null,
    webDist: env.WEB_DIST ?? new URL("../../web/dist", import.meta.url).pathname,
    maxUploadBytes: int("MAX_UPLOAD_MB", 2048) * 1024 * 1024,
    dbPoolSize: int("DB_POOL_SIZE", 10),
  };
}
