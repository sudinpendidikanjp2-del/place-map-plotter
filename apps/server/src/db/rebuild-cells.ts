import type { Sql } from "./client.ts";

/** Membangun ulang seluruh pra-agregasi (sel cluster dan statistik bulanan) dari tabel lokasi. */
export async function rebuildClusterCells(sql: Sql): Promise<number> {
  return sql.begin(async (tx) => {
    await tx`lock table locations in share mode`;
    await tx`select cc_rebuild_all()`;
    const rows = await tx<{ n: number }[]>`select count(*)::int as n from cluster_cells`;
    return rows[0]!.n;
  });
}
