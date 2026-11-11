import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createSql } from "./db/client.ts";
import { migrate } from "./db/migrate.ts";

const config = loadConfig();
const sql = createSql(config.databaseUrl, config.dbPoolSize);
const applied = await migrate(sql);
if (applied.length) console.log(`Migrasi diterapkan: ${applied.join(", ")}`);

const app = createApp(config, sql);
app.server.listen(config.port, () => console.log(`Server berjalan di http://localhost:${config.port}`));

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} diterima, menutup server.`);
  await app.close();
  await sql.end({ timeout: 10 });
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
