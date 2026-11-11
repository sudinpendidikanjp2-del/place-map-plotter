import type { Sql } from "./client.ts";

/** Membangun ulang pra-agregasi cluster dari tabel lokasi. Dipakai bila ada kecurigaan data sel menyimpang. */
export async function rebuildClusterCells(sql: Sql): Promise<number> {
  return sql.begin(async (tx) => {
    await tx`lock table locations in share mode`;
    await tx`truncate cluster_cells`;
    await tx`
      insert into cluster_cells (z, cx, cy, kind, category, province, n, sum_lng, sum_lat)
      select z, floor(lng / (84.375 / power(2, z)))::int, floor(lat / (84.375 / power(2, z)))::int,
             kind, category, coalesce(province, ''), count(*), sum(lng), sum(lat)
      from locations cross join generate_series(0, 14) as z
      group by 1, 2, 3, 4, 5, 6`;
    const rows = await tx<{ n: number }[]>`select count(*)::int as n from cluster_cells`;
    return rows[0]!.n;
  });
}
