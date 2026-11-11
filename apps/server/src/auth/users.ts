import { USER_ROLES, type UserRole } from "@peta/domain";
import type { Sql } from "../db/client.ts";
import { badRequest, conflict, notFound } from "../http/errors.ts";
import { MIN_PASSWORD_LENGTH, hashPassword } from "./password.ts";

export interface UserRow {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  disabled: boolean;
  createdAt: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateUserFields(
  input: { email?: unknown; name?: unknown; role?: unknown; password?: unknown },
  requirePassword: boolean,
) {
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const role = input.role as UserRole;
  const password = typeof input.password === "string" ? input.password : "";
  const errors: Record<string, string> = {};
  if (!EMAIL_RE.test(email) || email.length > 200) errors.email = "Alamat email tidak valid.";
  if (!name || name.length > 100) errors.name = "Nama wajib diisi, maksimal 100 karakter.";
  if (!USER_ROLES.includes(role)) errors.role = "Peran tidak dikenal.";
  if ((requirePassword || password) && password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Kata sandi minimal ${MIN_PASSWORD_LENGTH} karakter.`;
  }
  if (Object.keys(errors).length) throw badRequest("Data pengguna belum valid.", errors);
  return { email, name, role, password };
}

export async function createUser(
  sql: Sql,
  input: { email: string; name: string; role: UserRole; password: string },
): Promise<UserRow> {
  const hash = await hashPassword(input.password);
  try {
    const rows = await sql<UserRow[]>`
      insert into users (email, name, role, password_hash)
      values (${input.email}, ${input.name}, ${input.role}, ${hash})
      returning id::text, email, name, role, disabled, created_at`;
    return rows[0]!;
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw conflict("Email sudah terdaftar.");
    throw e;
  }
}

export async function listUsers(sql: Sql): Promise<UserRow[]> {
  return sql<UserRow[]>`select id::text, email, name, role, disabled, created_at from users order by created_at`;
}

export async function updateUser(
  sql: Sql,
  id: string,
  patch: { name?: string; role?: UserRole; disabled?: boolean; password?: string },
): Promise<UserRow> {
  if (patch.role !== undefined || patch.disabled !== undefined) {
    const target = await sql<{ role: string; disabled: boolean }[]>`select role, disabled from users where id = ${id}`;
    const t = target[0];
    if (!t) throw notFound("Pengguna tidak ditemukan.");
    const others = await sql<{ n: number }[]>`
      select count(*)::int as n from users where role = 'admin' and not disabled and id <> ${id}`;
    const staysAdmin = (patch.role ?? t.role) === "admin" && !(patch.disabled ?? t.disabled);
    if (t.role === "admin" && !t.disabled && !staysAdmin && others[0]!.n === 0) {
      throw conflict("Harus ada minimal satu admin aktif.");
    }
  }
  const hash = patch.password ? await hashPassword(patch.password) : null;
  const rows = await sql<UserRow[]>`
    update users set
      name = coalesce(${patch.name ?? null}, name),
      role = coalesce(${patch.role ?? null}, role),
      disabled = coalesce(${patch.disabled ?? null}, disabled),
      password_hash = coalesce(${hash}, password_hash)
    where id = ${id}
    returning id::text, email, name, role, disabled, created_at`;
  if (!rows[0]) throw notFound("Pengguna tidak ditemukan.");
  if (patch.disabled || patch.password) await sql`delete from sessions where user_id = ${id}`;
  return rows[0];
}
