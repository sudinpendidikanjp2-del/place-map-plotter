import type { AddressInfo } from "node:net";
import { createApp, type App } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createSql, type Sql } from "../src/db/client.ts";
import { migrate } from "../src/db/migrate.ts";
import { createUser } from "../src/auth/users.ts";
import type { UserRole } from "@peta/domain";

export const TEST_URL = process.env.DATABASE_URL_TEST ?? "postgres://sekolah:dev@localhost:5432/peta_test";

export interface Harness {
  sql: Sql;
  app: App;
  base: string;
  close(): Promise<void>;
  client(role?: UserRole): Promise<Client>;
  anonymous(): Client;
}

export interface Client {
  fetch(path: string, init?: RequestInit & { json?: unknown }): Promise<Response>;
  json<T = any>(path: string, init?: RequestInit & { json?: unknown }): Promise<{ status: number; body: T }>;
}

export async function start(): Promise<Harness> {
  const sql = createSql(TEST_URL, 5);
  await migrate(sql);
  await sql`truncate locations, import_batches, sessions, users restart identity cascade`;
  const config = loadConfig({ DATABASE_URL: TEST_URL, WEB_DIST: "/nonexistent" } as NodeJS.ProcessEnv);
  const app = createApp(config, sql, { trustProxy: false });
  await new Promise<void>((r) => app.server.listen(0, r));
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;

  const make = (cookie: () => string | null): Client => {
    const doFetch: Client["fetch"] = (path, init = {}) => {
      const headers = new Headers(init.headers);
      headers.set("origin", base);
      const c = cookie();
      if (c) headers.set("cookie", c);
      let body = init.body;
      if (init.json !== undefined) {
        headers.set("content-type", "application/json");
        body = JSON.stringify(init.json);
      }
      return fetch(base + path, { ...init, headers, body: body as RequestInit["body"] });
    };
    return {
      fetch: doFetch,
      async json(path, init) {
        const res = await doFetch(path, init);
        const text = await res.text();
        return { status: res.status, body: text ? JSON.parse(text) : null };
      },
    };
  };

  let n = 0;
  return {
    sql,
    app,
    base,
    anonymous: () => make(() => null),
    async client(role = "admin") {
      const email = `${role}${++n}@contoh.id`;
      await createUser(sql, { email, name: `Uji ${role}`, role, password: "kata-sandi-uji-1" });
      let cookie: string | null = null;
      const login = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: base },
        body: JSON.stringify({ email, password: "kata-sandi-uji-1" }),
      });
      if (login.status !== 200) throw new Error(`login gagal: ${login.status}`);
      cookie = login.headers.get("set-cookie")!.split(";")[0]!;
      return make(() => cookie);
    },
    async close() {
      await app.close();
      await sql.end({ timeout: 5 });
    },
  };
}

export const sampleLocation = (over: Record<string, unknown> = {}) => ({
  kind: "sekolah",
  name: "SDN Contoh 1",
  category: "SD",
  latitude: -6.2,
  longitude: 106.8,
  address: "Jl. Merdeka 1, Kec. Gambir, Kota Jakarta Pusat, DKI Jakarta",
  students: 320,
  teachers: 18,
  ...over,
});
