import postgres from "postgres";

export type Sql = ReturnType<typeof createSql>;

export function createSql(url: string, max = 10) {
  return postgres(url, {
    max,
    idle_timeout: 30,
    connect_timeout: 10,
    transform: postgres.camel,
    // Kolom bigint dikembalikan sebagai string agar tidak kehilangan presisi di JSON.
    types: {},
    onnotice: () => {},
  });
}
