# Deploy ke VPS

Satu VPS menjalankan tiga kontainer: PostgreSQL + PostGIS, aplikasi, dan Caddy (HTTPS otomatis).

> Berkas di folder ini belum dijalankan di lingkungan pengembangan (tidak ada Docker di sana). Uji di VPS percobaan sebelum produksi.

## Spesifikasi

| Data | vCPU | RAM | Disk | `shared_buffers` | `effective_cache_size` |
|---|---|---|---|---|---|
| sampai 1 juta lokasi | 2 | 4 GB | 20 GB NVMe | 1 GB | 2,5 GB |
| sampai 10 juta lokasi | 4 | 8 GB | 100 GB NVMe | 2 GB | 5 GB |
| di atas 10 juta | 8+ | 32 GB+ | 500 GB+ NVMe | 8 GB | 24 GB |

Pengukuran di mesin 4 vCPU dan 16 GB pada 1 juta lokasi: 571 MB di disk (tabel dan indeks). Angka lain adalah perkiraan, ukur ulang dengan `scripts/bench.ts`.

## Langkah

1. Pasang Docker dan Compose. Buka hanya port 22 (kunci SSH), 80, dan 443 di firewall. Arahkan DNS domain ke IP VPS.
2. `git clone` repositori, lalu `cd deploy && cp .env.example .env` dan isi nilainya.
3. `docker compose up -d --build`. Migrasi skema berjalan otomatis saat server mulai.
4. Buat admin pertama:
   ```bash
   docker compose exec -e ADMIN_PASSWORD='kata-sandi-panjang' app node apps/server/src/auth/create-admin-cli.ts admin@contoh.id "Nama Admin"
   ```
5. Buka `https://DOMAIN`, masuk, lalu tambah pengguna lain dari layar Admin.

## Cadangan dan pemulihan

- `deploy/backup.sh` membuat `pg_dump` terkompresi, menyimpan 14 hari terakhir, dan menyalin ke luar VPS bila `BACKUP_REMOTE` diisi. Pasang di cron harian.
- **Uji pemulihan** ke VPS cadangan minimal sebulan sekali dengan `deploy/restore.sh`. Cadangan yang belum pernah dipulihkan belum bisa dianggap cadangan.
- Layar Laporan (admin) menyediakan cadangan NDJSON untuk memindahkan data antar instalasi.

## Operasi

- Pembaruan: `git pull && docker compose up -d --build`. Migrasi baru dijalankan otomatis.
- Log: `docker compose logs -f app`.
- Pemantauan dasar: `/api/health` mengembalikan 200 bila server dan basis data hidup. Pasang pemeriksa eksternal (mis. UptimeRobot) ke alamat itu.
- Keamanan: `unattended-upgrades` aktif, login SSH hanya dengan kunci, PostgreSQL tidak membuka port ke luar.

## Jalur pertumbuhan

Bila satu VPS tidak cukup: (1) naikkan RAM dan `shared_buffers`, (2) jalankan beberapa kontainer `app` di belakang Caddy (server tidak menyimpan state, versi data dibagi lewat PostgreSQL), (3) partisi tabel `locations`, (4) replika baca PostgreSQL, (5) pra-agregasi cluster per zoom atau tile vektor (`ST_AsMVT`).
