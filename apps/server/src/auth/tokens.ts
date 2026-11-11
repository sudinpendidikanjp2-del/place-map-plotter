import { randomBytes } from "node:crypto";
import type { Sql } from "../db/client.ts";
import { badRequest, notFound } from "../http/errors.ts";
import { hashToken } from "./password.ts";

export interface TokenRow {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/** Token API untuk pekerja terjadwal. Hanya hash yang disimpan, token asli ditampilkan sekali saat dibuat. */
export class TokenService {
  private readonly sql: Sql;

  constructor(sql: Sql) {
    this.sql = sql;
  }

  async create(name: string, userId: string): Promise<{ token: string } & TokenRow> {
    const n = name.trim();
    if (!n || n.length > 100) throw badRequest("Nama token wajib diisi, maksimal 100 karakter.");
    const token = `peta_${randomBytes(32).toString("base64url")}`;
    const rows = await this.sql<TokenRow[]>`
      insert into api_tokens (name, token_hash, created_by) values (${n}, ${hashToken(token)}, ${userId})
      returning id::text, name, created_at, last_used_at, revoked_at`;
    return { ...rows[0]!, token };
  }

  async list(): Promise<TokenRow[]> {
    return this.sql<TokenRow[]>`select id::text, name, created_at, last_used_at, revoked_at from api_tokens order by id desc`;
  }

  async revoke(id: string): Promise<void> {
    if (!/^\d+$/.test(id)) throw notFound("Token tidak ditemukan.");
    const rows = await this.sql`update api_tokens set revoked_at = coalesce(revoked_at, now()) where id = ${id} returning id`;
    if (rows.length === 0) throw notFound("Token tidak ditemukan.");
  }

  async verify(token: string): Promise<{ id: string; name: string } | null> {
    if (!token.startsWith("peta_") || token.length > 200) return null;
    const rows = await this.sql<{ id: string; name: string }[]>`
      update api_tokens set last_used_at = now()
      where token_hash = ${hashToken(token)} and revoked_at is null
      returning id::text, name`;
    return rows[0] ?? null;
  }
}
