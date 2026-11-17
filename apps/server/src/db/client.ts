import postgres from "postgres";

export type Sql = ReturnType<typeof createSql>;

export function createSql(url: string, max = 10) {
  return postgres(url, {
    max,
    idle_timeout: 30,
    connect_timeout: 10,
    transform: postgres.camel,
    // Rencana khusus per permintaan: tanpa ini, setelah 5 eksekusi PostgreSQL memakai rencana generik yang
    // 5 kali lebih lambat untuk kueri peta. JIT dimatikan karena kueri pendek lebih lambat dengannya.
    // Ambang pencarian mirip (salah ketik) pada nama: 0,5 menangkap "kemayuran" untuk "kemayoran" tanpa banyak salah cocok.
    connection: { plan_cache_mode: "force_custom_plan", jit: "off", "pg_trgm.word_similarity_threshold": "0.5" },
    onnotice: () => {},
  });
}
