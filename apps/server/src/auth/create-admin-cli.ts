import { loadConfig } from "../config.ts";
import { createSql } from "../db/client.ts";
import { migrate } from "../db/migrate.ts";
import { createUser, validateUserFields } from "./users.ts";

// Pemakaian: ADMIN_PASSWORD='...' npm run create-admin -w @peta/server -- email@contoh.id "Nama Admin"
const [email, name] = process.argv.slice(2);
const password = process.env.ADMIN_PASSWORD;
if (!email || !name || !password) {
  console.error("Pemakaian: ADMIN_PASSWORD='kata-sandi' npm run create-admin -w @peta/server -- email \"Nama\"");
  process.exit(1);
}
const sql = createSql(loadConfig().databaseUrl, 1);
try {
  await migrate(sql);
  const v = validateUserFields({ email, name, role: "admin", password }, true);
  const user = await createUser(sql, v);
  console.log(`Admin dibuat: ${user.email}`);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await sql.end();
}
