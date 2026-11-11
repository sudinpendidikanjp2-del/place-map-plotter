# Peta Sekolah

Aplikasi web untuk memetakan, mengelola, dan melaporkan data **sekolah, fasilitas, dan aset** pendidikan di Google Maps. Satu kumpulan data dipakai bersama oleh semua pengguna, dengan login dan peran. Dirancang untuk jutaan lokasi.

Hasil refactor dari "CSV Pinpoint Map Plotter". Latar belakang dan keputusan ada di [`docs/PRD.md`](docs/PRD.md), arah visual di [`DESIGN.md`](DESIGN.md).

## Arsitektur

```
packages/domain   Fungsi murni dan tipe (validasi, CSV, alamat, filter). Dipakai web dan server.
apps/server       Node 24, tanpa framework. PostgreSQL + PostGIS lewat satu paket: postgres.
apps/sync         Pekerja Playwright terjadwal untuk sinkronisasi Dapodik (lihat apps/sync/README.md).
apps/web          React 19 + Vite + Tailwind 4. Google Maps lewat @vis.gl/react-google-maps.
deploy            Docker Compose (PostGIS, aplikasi, Caddy), cadangan, pemulihan.
scripts           Seed data uji dan benchmark skala.
```

Dependensi runtime: web `react`, `react-dom`, `@vis.gl/react-google-maps`, `jspdf` (dimuat malas). Server `postgres`.

Cara kerja skala besar: cluster peta, filter, pencarian, agregasi laporan, impor, dan ekspor dikerjakan di PostgreSQL. Peramban hanya menerima yang terlihat (maksimal 1.500 fitur per area).

## Menjalankan untuk pengembangan

Prasyarat: Node 22.18 atau lebih baru (disarankan 24), PostgreSQL 16+ dengan ekstensi PostGIS dan pg_trgm.

```bash
npm install
cp .env.example .env            # isi DATABASE_URL dan kunci Google Maps
npm run dev:server              # http://localhost:3000, migrasi berjalan otomatis
ADMIN_PASSWORD='kata-sandi-panjang' npm run create-admin -w @peta/server -- admin@contoh.id "Nama Admin"
npm run dev:web                 # http://localhost:5173, meneruskan /api ke server
```

Data uji sintetis (bukan data nyata): `node scripts/seed.ts 5000 --reset`

## Perintah

| Perintah | Fungsi |
|---|---|
| `npm test` | Tes unit domain dan tes integrasi server (butuh PostgreSQL, lihat `DATABASE_URL_TEST`) |
| `npm run typecheck` | Pemeriksaan tipe semua workspace |
| `npm run build` | Membangun web ke `apps/web/dist` |
| `node scripts/bench.ts` | Benchmark skala (setelah seed 1 juta baris) |
| `node scripts/e2e/*.cjs` | Uji peramban Playwright, lihat `scripts/e2e/README.md` |

Tes server memakai basis data `peta_test` (bawaan `postgres://sekolah:dev@localhost:5432/peta_test`) dan **mengosongkan tabelnya**. Jangan arahkan ke data nyata.

## Data Dapodik

Portal Dapodik baru (dapo.kemendikdasmen.go.id) tidak menyediakan API publik tanpa token, dan dilindungi WAF yang menantang klien otomatis. Aplikasi ini sengaja tidak menembusnya. Jalur yang tersedia: impor CSV hasil ekspor resmi (kolom Dapodik seperti NPSN, Nama Satuan Pendidikan, Bentuk Pendidikan, Kecamatan, Lintang, Bujur, Jumlah PD, Jumlah PTK dikenali otomatis, dan NPSN yang sama memperbarui data lama), atau API resmi bila instansi Anda memperoleh aksesnya (lihat docs/DAPODIK.md).

## Prasyarat Google Cloud

1. **Kunci web** (Maps JavaScript API, Places jika dipakai, Directions API): batasi *HTTP referrers* ke domain Anda.
2. **ID peta** (Map Management) dengan gaya diredam, lalu isi `GOOGLE_MAP_ID`. `AdvancedMarker` mensyaratkannya.
3. **Kunci server** (Static Maps API untuk ekspor gambar peta, dan Places API (New) untuk mencari titik dari nama tempat): batasi *IP addresses* ke IP VPS, isi `GOOGLE_SERVER_KEY`. `STATIC_MAPS_KEY` lama tetap dibaca.

## Rilis otomatis

Setiap push ke `main` menjalankan `.github/workflows/release.yml`: tes dan build (`ci.yml`), lalu membuat rilis GitHub `vMAYOR.MINOR.NOMOR_EKSEKUSI` dengan lampiran build web, dan mendorong image Docker ke `ghcr.io/<pemilik>/<repo>` bertag versi, `latest`, dan SHA. Image pekerja sinkronisasi terbit terpisah di `ghcr.io/<pemilik>/<repo>-sync` dengan tag yang sama. Mayor dan minor diambil dari `version` di `package.json`. Tambahkan `[skip release]` pada pesan commit untuk melewati rilis. Pull request menjalankan `ci.yml` saja.

Setelah rilis pertama, atur paket di GitHub (Packages) agar terlihat oleh VPS: buat publik, atau login `docker login ghcr.io` di VPS dengan token yang punya `read:packages`.

## Deploy ke VPS

Lihat [`deploy/README.md`](deploy/README.md).
