import { loadConfig } from "../config.ts";
import { createSql } from "./client.ts";
import { rebuildClusterCells } from "./rebuild-cells.ts";

const sql = createSql(loadConfig().databaseUrl, 1);
try {
  const n = await rebuildClusterCells(sql);
  console.log(`Pra-agregasi cluster dibangun ulang: ${n.toLocaleString("id-ID")} sel.`);
} finally {
  await sql.end();
}
