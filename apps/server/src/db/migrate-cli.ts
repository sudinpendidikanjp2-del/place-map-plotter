import { loadConfig } from "../config.ts";
import { createSql } from "./client.ts";
import { migrate } from "./migrate.ts";

const config = loadConfig();
const sql = createSql(config.databaseUrl, 1);
try {
  const applied = await migrate(sql);
  console.log(applied.length ? `Migrasi diterapkan: ${applied.join(", ")}` : "Skema sudah terbaru.");
} finally {
  await sql.end();
}
