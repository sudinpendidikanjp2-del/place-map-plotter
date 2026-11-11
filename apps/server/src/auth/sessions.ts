import type { IncomingMessage, ServerResponse } from "node:http";
import type { UserRole } from "@peta/domain";
import type { Sql } from "../db/client.ts";
import type { SessionUser } from "../http/router.ts";
import { hashToken, newToken } from "./password.ts";

const COOKIE = "sid";
const TTL_DAYS = 14;

export function readCookie(req: IncomingMessage, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function setSessionCookie(res: ServerResponse, token: string, secure: boolean): void {
  const attrs = [`${COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${TTL_DAYS * 86400}`];
  if (secure) attrs.push("Secure");
  res.setHeader("set-cookie", attrs.join("; "));
}

export function clearSessionCookie(res: ServerResponse, secure: boolean): void {
  const attrs = [`${COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) attrs.push("Secure");
  res.setHeader("set-cookie", attrs.join("; "));
}

export async function createSession(sql: Sql, userId: string): Promise<string> {
  const { token, hash } = newToken();
  await sql`
    insert into sessions (token_hash, user_id, expires_at)
    values (${hash}, ${userId}, now() + make_interval(days => ${TTL_DAYS}))`;
  return token;
}

export async function destroySession(sql: Sql, token: string): Promise<void> {
  await sql`delete from sessions where token_hash = ${hashToken(token)}`;
}

export async function userFromRequest(sql: Sql, req: IncomingMessage): Promise<SessionUser | null> {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const rows = await sql<{ id: string; email: string; name: string; role: UserRole }[]>`
    select u.id::text, u.email, u.name, u.role
    from sessions s join users u on u.id = s.user_id
    where s.token_hash = ${hashToken(token)} and s.expires_at > now() and not u.disabled`;
  return rows[0] ?? null;
}

export function sessionToken(req: IncomingMessage): string | null {
  return readCookie(req, COOKIE);
}

export async function purgeExpiredSessions(sql: Sql): Promise<void> {
  await sql`delete from sessions where expires_at < now()`;
}
