import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import {
  EXPORT_HEADERS,
  LOCATION_KINDS,
  toCsvLine,
  validateLocationInput,
  type LocationFilter,
  type LocationKind,
  type UserRole,
} from "@peta/domain";
import type { Config } from "./config.ts";
import type { Sql } from "./db/client.ts";
import { HttpError, badRequest, notFound, tooMany, unauthorized } from "./http/errors.ts";
import { Router, authorize, readJson, sendJson, type Ctx } from "./http/router.ts";
import { RateLimiter } from "./auth/rate-limit.ts";
import { hashPassword, verifyPassword } from "./auth/password.ts";
import { clearSessionCookie, createSession, destroySession, purgeExpiredSessions, sessionToken, setSessionCookie, userFromRequest } from "./auth/sessions.ts";
import { createUser, listUsers, updateUser, validateUserFields } from "./auth/users.ts";
import { LocationRepository } from "./locations/repository.ts";
import { parseBBox, parseFilter } from "./locations/filter.ts";
import { ImportService } from "./imports/service.ts";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const CSP = [
  "default-src 'self'",
  "script-src 'self' https://maps.googleapis.com https://*.gstatic.com https://*.google.com blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://maps.googleapis.com https://*.googleapis.com https://*.google.com https://*.gstatic.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "worker-src blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

function securityHeaders(res: ServerResponse, secure: boolean): void {
  res.setHeader("content-security-policy", CSP);
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "strict-origin-when-cross-origin");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("permissions-policy", "geolocation=(self), camera=(), microphone=()");
  if (secure) res.setHeader("strict-transport-security", "max-age=31536000; includeSubDomains");
}

function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = req.headers["x-forwarded-for"];
    const first = (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? "unknown";
}

function filterFromBody(raw: unknown): LocationFilter {
  if (!raw || typeof raw !== "object") throw badRequest("Filter tidak valid.");
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === "string" || typeof v === "number") q.set(k, String(v));
  return parseFilter(q);
}

function idList(raw: unknown): string[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || !raw.every((x) => typeof x === "string" || typeof x === "number")) throw badRequest("Daftar id tidak valid.");
  return raw.map(String);
}

export interface App {
  server: Server;
  repo: LocationRepository;
  close(): Promise<void>;
}

export function createApp(config: Config, sql: Sql, opts: { trustProxy?: boolean } = {}): App {
  const trustProxy = opts.trustProxy ?? process.env.TRUST_PROXY === "true";
  const repo = new LocationRepository(sql);
  const imports = new ImportService(sql, config.maxUploadBytes);
  const loginLimiter = new RateLimiter(10, 15 * 60_000);
  const ipLimiter = new RateLimiter(60, 15 * 60_000);
  const router = new Router();
  // Hash tiruan agar waktu respons login sama untuk email yang tidak ada.
  const dummyHash = hashPassword("kata-sandi-tiruan-untuk-waktu-konstan");

  const me = (c: Ctx) => c.user!;

  // ---------- Kesehatan dan sesi ----------
  router.get("/api/health", null, async (c) => {
    await sql`select 1`;
    sendJson(c.res, 200, { ok: true });
  });

  // Publik: kunci Maps web memang terlihat di peramban dan wajib dibatasi referrer di Google Cloud Console.
  router.get("/api/config", null, (c) => sendJson(c.res, 200, { mapsKey: config.mapsKey, mapId: config.mapId }, { "cache-control": "no-cache" }));

  router.post("/api/auth/login", null, async (c) => {
    const body = await readJson<{ email?: string; password?: string }>(c.req, 10_000);
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const ip = clientIp(c.req, trustProxy);
    if (!ipLimiter.take(ip) || !loginLimiter.take(`${ip}|${email}`)) throw tooMany();
    const rows = await sql<{ id: string; email: string; name: string; role: UserRole; passwordHash: string; disabled: boolean }[]>`
      select id::text, email, name, role, password_hash, disabled from users where lower(email) = ${email}`;
    const row = rows[0];
    const ok = await verifyPassword(password, row ? row.passwordHash : await dummyHash);
    if (!row || !ok || row.disabled) throw unauthorized("Email atau kata sandi salah.");
    loginLimiter.reset(`${ip}|${email}`);
    const token = await createSession(sql, row.id);
    setSessionCookie(c.res, token, config.secureCookies);
    sendJson(c.res, 200, { user: { id: row.id, email: row.email, name: row.name, role: row.role } });
  });

  router.post("/api/auth/logout", null, async (c) => {
    const token = sessionToken(c.req);
    if (token) await destroySession(sql, token);
    clearSessionCookie(c.res, config.secureCookies);
    sendJson(c.res, 200, { ok: true });
  });

  router.get("/api/auth/me", "login", (c) => sendJson(c.res, 200, { user: me(c) }));

  router.post("/api/auth/change-password", "login", async (c) => {
    const body = await readJson<{ current?: string; next?: string }>(c.req, 10_000);
    const rows = await sql<{ passwordHash: string }[]>`select password_hash from users where id = ${me(c).id}`;
    if (!rows[0] || !(await verifyPassword(String(body.current ?? ""), rows[0].passwordHash))) throw badRequest("Kata sandi saat ini salah.");
    validateUserFields({ email: me(c).email, name: me(c).name, role: me(c).role, password: body.next }, true);
    await updateUser(sql, me(c).id, { password: body.next });
    const token = await createSession(sql, me(c).id);
    setSessionCookie(c.res, token, config.secureCookies);
    sendJson(c.res, 200, { ok: true });
  });

  // ---------- Pengguna (admin) ----------
  router.get("/api/users", "admin", async (c) => sendJson(c.res, 200, { items: await listUsers(sql) }));
  router.post("/api/users", "admin", async (c) => {
    const v = validateUserFields(await readJson(c.req, 10_000), true);
    sendJson(c.res, 201, await createUser(sql, v));
  });
  router.patch("/api/users/:id", "admin", async (c) => {
    const body = await readJson<Record<string, unknown>>(c.req, 10_000);
    const patch: Parameters<typeof updateUser>[2] = {};
    if (body.name !== undefined || body.role !== undefined || body.password !== undefined) {
      const current = (await listUsers(sql)).find((u) => u.id === c.params.id);
      if (!current) throw notFound("Pengguna tidak ditemukan.");
      const v = validateUserFields({ email: current.email, name: body.name ?? current.name, role: body.role ?? current.role, password: body.password }, false);
      if (body.name !== undefined) patch.name = v.name;
      if (body.role !== undefined) patch.role = v.role;
      if (body.password) patch.password = v.password;
    }
    if (typeof body.disabled === "boolean") patch.disabled = body.disabled;
    if (c.params.id === me(c).id && (patch.disabled || (patch.role && patch.role !== "admin"))) {
      throw badRequest("Anda tidak bisa menonaktifkan atau menurunkan peran akun sendiri.");
    }
    sendJson(c.res, 200, await updateUser(sql, c.params.id!, patch));
  });

  // ---------- Lokasi ----------
  router.get("/api/locations/clusters", "viewer", async (c) => {
    const q = c.url.searchParams;
    const zoom = Number(q.get("zoom"));
    if (!Number.isInteger(zoom) || zoom < 0 || zoom > 22) throw badRequest("Parameter zoom harus bilangan bulat 0 sampai 22.");
    const filter = parseFilter(q);
    if (!filter.bbox) throw badRequest("Parameter west, south, east, north wajib diisi.");
    sendJson(c.res, 200, await repo.clusters(filter, zoom), { "cache-control": "private, max-age=15" });
  });

  router.get("/api/locations/extent", "viewer", async (c) => sendJson(c.res, 200, await repo.extent(parseFilter(c.url.searchParams)), { "cache-control": "private, max-age=15" }));

  router.get("/api/locations/facets", "viewer", async (c) => {
    const q = c.url.searchParams;
    const scope: { province?: string; city?: string } = {};
    const province = q.get("province")?.slice(0, 100);
    const city = q.get("city")?.slice(0, 100);
    if (province) scope.province = province;
    if (city) scope.city = city;
    sendJson(c.res, 200, await repo.facets(scope), { "cache-control": "private, max-age=30" });
  });

  router.get("/api/locations", "viewer", async (c) => {
    const q = c.url.searchParams;
    const sort = q.get("sort") === "nama" ? "nama" : "baru";
    const limit = Math.min(Math.max(Number(q.get("limit") ?? 50) || 50, 1), 200);
    const cursor = q.get("cursor") ?? undefined;
    sendJson(c.res, 200, await repo.list(parseFilter(q), { sort, limit, ...(cursor ? { cursor } : {}) }));
  });

  router.get("/api/locations/:id", "viewer", async (c) => sendJson(c.res, 200, await repo.get(c.params.id!)));

  router.post("/api/locations", "editor", async (c) => {
    const v = validateLocationInput(await readJson(c.req));
    if (!v.ok) throw badRequest("Data lokasi belum valid.", v.errors);
    const created = await repo.create(v.value, me(c).id);
    repo.invalidate();
    sendJson(c.res, 201, created);
  });

  router.patch("/api/locations/:id", "editor", async (c) => {
    const body = await readJson<Record<string, unknown>>(c.req);
    const version = Number(body.version);
    if (!Number.isInteger(version) || version < 1) throw badRequest("Versi data wajib disertakan.");
    const v = validateLocationInput(body);
    if (!v.ok) throw badRequest("Data lokasi belum valid.", v.errors);
    const updated = await repo.update(c.params.id!, v.value, version, me(c).id);
    repo.invalidate();
    sendJson(c.res, 200, updated);
  });

  router.delete("/api/locations/:id", "editor", async (c) => {
    await repo.remove(c.params.id!);
    repo.invalidate();
    sendJson(c.res, 200, { ok: true });
  });

  router.post("/api/locations/bulk-update", "editor", async (c) => {
    const body = await readJson<Record<string, unknown>>(c.req, 2_000_000);
    const patch: { category?: string; kind?: LocationKind } = {};
    if (typeof body.category === "string" && body.category.trim()) patch.category = body.category.trim().slice(0, 100);
    if (body.kind !== undefined) {
      if (!(LOCATION_KINDS as readonly string[]).includes(String(body.kind))) throw badRequest("Jenis tidak dikenal.");
      patch.kind = body.kind as LocationKind;
    }
    const ids = idList(body.ids);
    const sel = ids ? { ids } : { filter: filterFromBody(body.filter) };
    const updated = await repo.bulkUpdate(sel, patch, me(c).id);
    repo.invalidate();
    sendJson(c.res, 200, { updated });
  });

  router.post("/api/locations/bulk-delete", "editor", async (c) => {
    const body = await readJson<Record<string, unknown>>(c.req, 2_000_000);
    const ids = idList(body.ids);
    const sel = ids ? { ids } : { filter: filterFromBody(body.filter) };
    const deleted = await repo.bulkDelete(sel);
    repo.invalidate();
    sendJson(c.res, 200, { deleted });
  });

  // ---------- Impor ----------
  router.get("/api/imports", "viewer", async (c) => sendJson(c.res, 200, { items: await imports.list() }));
  router.get("/api/imports/:id", "viewer", async (c) => sendJson(c.res, 200, await imports.get(c.params.id!)));
  router.post("/api/imports", "editor", async (c) => {
    const body = await readJson<{ filename?: string; defaultKind?: string }>(c.req, 10_000);
    sendJson(c.res, 201, await imports.create(String(body.filename ?? ""), String(body.defaultKind ?? "sekolah"), me(c).id));
  });
  router.put("/api/imports/:id/file", "editor", async (c) => {
    const declared = Number(c.req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > config.maxUploadBytes) throw new HttpError(413, "too_large", "Berkas melebihi batas ukuran unggahan.");
    const result = await imports.run(c.params.id!, c.req, me(c).id);
    repo.invalidate();
    sendJson(c.res, 200, result);
  });
  router.delete("/api/imports/:id", "editor", async (c) => {
    const r = await imports.cancel(c.params.id!);
    repo.invalidate();
    sendJson(c.res, 200, r);
  });

  // ---------- Laporan dan ekspor ----------
  router.get("/api/reports/summary", "viewer", async (c) => sendJson(c.res, 200, await repo.summary(parseFilter(c.url.searchParams))));

  router.get("/api/export/csv", "viewer", async (c) => {
    const filter = parseFilter(c.url.searchParams);
    const date = new Date().toISOString().slice(0, 10);
    c.res.writeHead(200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="lokasi-${date}.csv"`,
      "cache-control": "no-store",
    });
    let open = true;
    c.res.on("close", () => (open = false));
    c.res.write(`﻿${toCsvLine([...EXPORT_HEADERS])}\r\n`);
    for await (const rows of repo.stream(filter)) {
      if (!open) break;
      let out = "";
      for (const r of rows as Record<string, unknown>[]) {
        out += `${toCsvLine([r.kind, r.name, r.category, r.latitude, r.longitude, r.address, r.province, r.city, r.district, r.foundedYear, r.students, r.teachers, r.description, r.photoUrl])}\r\n`;
      }
      if (!c.res.write(out)) await new Promise<void>((resolve) => c.res.once("drain", resolve).once("close", resolve));
    }
    c.res.end();
  });

  router.get("/api/export/static-map", "viewer", async (c) => {
    if (!config.staticMapsKey) throw new HttpError(503, "not_configured", "Gambar peta belum tersedia: STATIC_MAPS_KEY belum diatur di server.");
    const q = c.url.searchParams;
    const filter = parseFilter(q);
    const bbox = parseBBox(q);
    if (!bbox) throw badRequest("Parameter west, south, east, north wajib diisi.");
    const zoom = Math.min(Math.max(Number(q.get("zoom")) || 10, 0), 21);
    const size = /^\d{2,3}x\d{2,3}$/.test(q.get("size") ?? "") ? q.get("size")! : "640x400";
    const { features } = await repo.clusters({ ...filter, bbox }, zoom);
    const top = features.slice(0, 80);
    const params = new URLSearchParams({ size, scale: "2", maptype: "roadmap", key: config.staticMapsKey });
    params.set("visible", `${bbox.south},${bbox.west}|${bbox.north},${bbox.east}`);
    const singles = top.filter((f) => f.count === 1).map((f) => `${f.lat.toFixed(5)},${f.lng.toFixed(5)}`);
    const groups = top.filter((f) => f.count > 1).map((f) => `${f.lat.toFixed(5)},${f.lng.toFixed(5)}`);
    if (singles.length) params.append("markers", `color:0x0b1f4b|size:small|${singles.join("|")}`);
    if (groups.length) params.append("markers", `color:0xf5b700|size:mid|${groups.join("|")}`);
    const upstream = await fetch(`https://maps.googleapis.com/maps/api/staticmap?${params}`, { signal: AbortSignal.timeout(10_000) });
    if (!upstream.ok) throw new HttpError(502, "upstream", "Layanan peta tidak dapat membuat gambar saat ini.");
    const buf = Buffer.from(await upstream.arrayBuffer());
    c.res.writeHead(200, { "content-type": upstream.headers.get("content-type") ?? "image/png", "content-length": buf.length, "cache-control": "private, max-age=300" });
    c.res.end(buf);
  });

  router.get("/api/export/backup", "admin", async (c) => {
    const date = new Date().toISOString().slice(0, 10);
    c.res.writeHead(200, {
      "content-type": "application/x-ndjson; charset=utf-8",
      "content-disposition": `attachment; filename="cadangan-${date}.ndjson"`,
      "cache-control": "no-store",
    });
    let open = true;
    c.res.on("close", () => (open = false));
    const cursor = sql`
      select kind, name, category, address, description, founded_year, photo_url, students, teachers, attributes,
        ST_Y(geom) as latitude, ST_X(geom) as longitude
      from locations order by id`.cursor(2000);
    for await (const rows of cursor) {
      if (!open) break;
      const out = (rows as Record<string, unknown>[]).map((r) => JSON.stringify(r)).join("\n") + "\n";
      if (!c.res.write(out)) await new Promise<void>((resolve) => c.res.once("drain", resolve).once("close", resolve));
    }
    c.res.end();
  });

  // ---------- Berkas statik ----------
  async function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
    const rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, "");
    const root = config.webDist;
    let file = join(root, rel);
    if (!file.startsWith(root + sep) && file !== root) throw notFound();
    let info = await stat(file).catch(() => null);
    if (info?.isDirectory()) {
      file = join(file, "index.html");
      info = await stat(file).catch(() => null);
    }
    const isAsset = rel.startsWith("assets/");
    if (!info) {
      if (isAsset || extname(rel)) throw notFound();
      file = join(root, "index.html");
      info = await stat(file).catch(() => null);
      if (!info) throw notFound("Antarmuka web belum dibangun. Jalankan: npm run build");
    }
    res.writeHead(200, {
      "content-type": MIME[extname(file)] ?? "application/octet-stream",
      "content-length": info.size,
      "cache-control": isAsset ? "public, max-age=31536000, immutable" : "no-cache",
    });
    if (req.method === "HEAD") return void res.end();
    createReadStream(file).pipe(res);
  }

  const server = createServer(async (req, res) => {
    securityHeaders(res, config.secureCookies);
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const method = req.method ?? "GET";
      if (!url.pathname.startsWith("/api/")) {
        if (method !== "GET" && method !== "HEAD") throw new HttpError(405, "method_not_allowed", "Metode tidak diizinkan.");
        return await serveStatic(req, res, url.pathname);
      }

      if (method !== "GET" && method !== "HEAD") {
        const origin = req.headers.origin;
        const host = req.headers.host;
        let ok = false;
        if (origin) {
          try {
            ok = new URL(origin).host === host || config.allowedOrigins.includes(origin);
          } catch {
            ok = false;
          }
        } else {
          const site = req.headers["sec-fetch-site"];
          ok = site === "same-origin" || site === "none";
        }
        if (!ok) throw new HttpError(403, "csrf", "Permintaan ditolak karena asal tidak dikenali.");
      }

      const matched = router.match(method === "HEAD" ? "GET" : method, url.pathname);
      if (!matched) throw notFound("Rute tidak ditemukan.");
      if (matched === "method") throw new HttpError(405, "method_not_allowed", "Metode tidak diizinkan.");
      const user = await userFromRequest(sql, req);
      authorize(matched.route.minRole, user);
      res.setHeader("cache-control", "no-store");
      await matched.route.handler({ req, res, url, params: matched.params, user });
    } catch (e) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (e instanceof HttpError) {
        sendJson(res, e.status, { error: { code: e.code, message: e.message, details: e.details } });
      } else {
        console.error(e);
        sendJson(res, 500, { error: { code: "internal", message: "Terjadi kesalahan di server." } });
      }
    }
  });
  server.requestTimeout = 0; // unggahan besar dapat berlangsung lama
  server.headersTimeout = 30_000;

  const sweep = setInterval(() => void purgeExpiredSessions(sql).catch(() => {}), 3_600_000);
  sweep.unref();

  return {
    server,
    repo,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(sweep);
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
