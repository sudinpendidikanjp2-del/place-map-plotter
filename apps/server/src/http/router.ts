import type { IncomingMessage, ServerResponse } from "node:http";
import type { UserRole } from "@peta/domain";
import { roleAtLeast } from "@peta/domain";
import { HttpError, forbidden, unauthorized } from "./errors.ts";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  user: SessionUser | null;
}

export type Handler = (ctx: Ctx) => Promise<void> | void;

interface Route {
  method: string;
  parts: string[];
  handler: Handler;
  /** `null` berarti publik. */
  minRole: UserRole | "login" | null;
}

export class Router {
  private routes: Route[] = [];

  add(method: string, path: string, minRole: Route["minRole"], handler: Handler): this {
    this.routes.push({ method, parts: path.split("/").filter(Boolean), handler, minRole });
    return this;
  }

  get = (path: string, minRole: Route["minRole"], h: Handler) => this.add("GET", path, minRole, h);
  post = (path: string, minRole: Route["minRole"], h: Handler) => this.add("POST", path, minRole, h);
  put = (path: string, minRole: Route["minRole"], h: Handler) => this.add("PUT", path, minRole, h);
  patch = (path: string, minRole: Route["minRole"], h: Handler) => this.add("PATCH", path, minRole, h);
  delete = (path: string, minRole: Route["minRole"], h: Handler) => this.add("DELETE", path, minRole, h);

  match(method: string, pathname: string): { route: Route; params: Record<string, string> } | "method" | null {
    const parts = pathname.split("/").filter(Boolean);
    let pathMatched = false;
    for (const route of this.routes) {
      if (route.parts.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < parts.length; i++) {
        const rp = route.parts[i]!;
        if (rp.startsWith(":")) params[rp.slice(1)] = decodeURIComponent(parts[i]!);
        else if (rp !== parts[i]) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      pathMatched = true;
      if (route.method === method) return { route, params };
    }
    return pathMatched ? "method" : null;
  }
}

export function authorize(minRole: Route["minRole"], user: SessionUser | null): void {
  if (minRole === null) return;
  if (!user) throw unauthorized();
  if (minRole !== "login" && !roleAtLeast(user.role, minRole)) throw forbidden();
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

export async function readJson<T = Record<string, unknown>>(req: IncomingMessage, limitBytes = 1_000_000): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limitBytes) throw new HttpError(413, "too_large", "Isi permintaan terlalu besar.");
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {} as T;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    throw new HttpError(400, "bad_json", "Isi permintaan bukan JSON yang valid.");
  }
}
