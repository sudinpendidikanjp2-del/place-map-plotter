# Pekerja sinkronisasi Dapodik

Menarik data satuan pendidikan dari portal Dapodik lewat otomasi peramban, menormalkannya (wilayah dan jenjang), dan mengirimnya ke Peta Sekolah lewat token API. Jakarta Pusat adalah wilayah bawaan.

## Cara kerja

1. Membuka halaman portal seperti pengguna biasa dan menangkap respons API yang dipanggil halaman itu sendiri: daftar kecamatan, sekolah per kecamatan, lalu detail tiap NPSN.
2. Jeda acak 4 sampai 7 detik, satu tab, aset berat diblokir, cache tujuh hari (jalan ulang tidak mengulang yang sudah baru diambil), berhenti sendiri setelah gagal beruntun.
3. Memetakan ke CSV berjudul kolom Dapodik: `Prov. D.K.I. Jakarta` menjadi `DKI Jakarta`, `Kota Adm. Jakarta Pusat` menjadi `Kota Jakarta Pusat`, `Kec. Senen` menjadi `Senen`, bentuk pendidikan menjadi jenjang baku.
4. **Penjaga:** hasil ditolak (tidak diimpor) bila nol sekolah, atau kurang dari 70% jumlah penarikan berhasil sebelumnya. Sekolah yang hilang dari hasil tidak pernah dihapus.
5. Mengimpor lewat endpoint impor yang sama dengan impor manual. NPSN yang sama memperbarui data lama. Sekolah baru masuk **tanpa koordinat**, dan titiknya dicari lewat layar Sinkronisasi.
6. Melaporkan setiap eksekusi (berhasil, gagal, ditolak) ke layar Sinkronisasi.

## Yang sengaja tidak dilakukan

Tidak ada token portal yang dibaca atau dipakai ulang, tidak ada penyamaran peramban, dan tidak ada upaya melewati tantangan akses. Bila portal menjawab 401 atau 403, pekerja berhenti dan melapor. Itu tanda perlu memeriksa izin atau akun, bukan sesuatu yang diakali. Pastikan penarikan otomatis berkala sudah diizinkan oleh pemilik data.

## Status pengujian

Diuji terhadap **portal palsu** yang meniru alur halaman dan API, termasuk cache, kegagalan per sekolah, penolakan 403, dan daftar bertingkat halaman. **Belum pernah dijalankan terhadap portal Dapodik asli.** Dua hal perlu diperiksa pada jalan pertama:
- Nama bidang pada respons `detail-sekolah` (`mapper.mjs` mencoba beberapa kandidat per bidang). Jalankan dengan `--dry` dan periksa CSV-nya.
- Daftar sekolah per kecamatan yang bertingkat halaman: pengumpul **gagal dengan pesan jelas** (bukan terpotong diam-diam) bila respons menandakan lebih dari satu halaman, karena cara portal memuat halaman berikutnya belum diketahui.

## Menjalankan

Buat token di layar Sinkronisasi (admin), lalu:

```bash
cd apps/sync
npm install
npx playwright install chromium
node src/run.mjs --dry                      # hanya membuat CSV di out/, tidak mengirim
PETA_URL=https://peta.contoh.go.id PETA_TOKEN=peta_... node src/run.mjs
```

Pengaturan (variabel lingkungan): `DAPODIK_KODE_PROVINSI` (010000), `DAPODIK_KODE_KABUPATEN` (016000), `DAPODIK_KECAMATAN` (daftar nama atau kode dipisah koma, kosong = semua), `DAPODIK_PROVINSI` dan `DAPODIK_KABUPATEN` (untuk membuang detail wilayah lain), `SCOPE_LABEL`, `HEADLESS` (`false` untuk melihat peramban), `DELAY_MIN_MS`, `DELAY_MAX_MS`, `REFRESH_DAYS`, `MAX_PER_RUN`.

Kapasitas: sekitar 650 sekolah per jam. Seluruh Indonesia tidak mungkin dengan cara ini.

## Terjadwal di VPS

```bash
# crontab, setiap Minggu pukul 01.15
15 1 * * 0 cd /opt/peta/deploy && docker compose --profile sync run --rm sync >> /var/log/peta-sync.log 2>&1
```

Layanan `sync` ada di `deploy/docker-compose.yml` (profil `sync`, tidak ikut `up -d`). Isi `PETA_URL` dan `PETA_TOKEN` di `deploy/.env`. Layar Sinkronisasi memberi peringatan bila penarikan berhasil terakhir lebih dari 10 hari lalu.

## Uji

```bash
npm test          # normalisasi, pemetaan, penjaga, dan pengumpul terhadap portal palsu (butuh Playwright terpasang)
```
