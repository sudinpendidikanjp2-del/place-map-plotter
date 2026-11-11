# PRD: Redesign dan Refactor CSV Pinpoint Map Plotter

Status: **Draft v3 untuk diskusi** (belum ada kode aplikasi yang diubah)
Mode antislop: **DURING** (pilihan sesi ini)
Skill acuan: `antislop`, `better-interface` (hanya `better-interface` terpasang)

Keputusan yang sudah diambil:
- Tanpa Firebase/Firestore. Pihak ketiga dikurangi seminimal mungkin.
- Data **dibagi antar pengguna**, jadi ada backend sendiri.
- Tetap **Google Maps**.
- **Ekspor lengkap**: CSV, gambar peta, PDF laporan (dengan grafik), dan cadangan penuh.

---

## 1. Ringkasan

Aplikasi memplot titik lokasi dari CSV, pencarian tempat, input manual, atau impor batch ke Google Maps. Pengguna memfilter berdasarkan kategori, wilayah, dan bentuk gambar, menghitung rute, lalu mengekspor hasilnya.

Fungsinya lengkap, tetapi kodenya sulit dirawat, antarmukanya belum punya identitas, dan datanya bergantung pada Firestore dengan aturan akses yang terbuka untuk siapa pun. PRD ini mengusulkan:

1. Refactor ke arsitektur berlapis, memakai workspace npm dengan paket domain bersama.
2. **Backend sendiri yang kecil** (Node + SQLite) untuk data bersama dan login, tanpa layanan vendor.
3. Dependensi pihak ketiga ditekan: standar web dan bawaan Node lebih dulu.
4. Redesign antarmuka yang lolos antislop dan review `better-interface`.

## 2. Kondisi sekarang (temuan dari kode)

| Area | Temuan | Dampak |
|---|---|---|
| Struktur | `App.tsx` 1.234 baris: state, Firestore, filter wilayah, screenshot, dan UI bercampur | Sulit diuji dan diubah |
| Komponen | 9 komponen 130 sampai 474 baris, UI dan logika bercampur | Logika tidak bisa dipakai ulang |
| Data | UI memanggil Firestore langsung. Aturan mengizinkan siapa pun menulis dan menghapus | Terikat vendor dan tidak aman |
| Pihak ketiga | 14 dependensi runtime. `express`, `@google/genai`, `dotenv`, `motion` tidak diimpor. Font dari Google Fonts | Bobot, rantai pasok, pelacakan |
| Konfigurasi | API key Maps dibaca lewat 3 jalur dengan `as any` | Membingungkan |
| Ekspor | `html2canvas` menangkap peta, ditambal `html2canvasSafe.ts` (258 baris, warna `oklch`) | Rapuh |
| Pengujian | Tidak ada tes | Refactor tanpa jaring pengaman |
| Antarmuka | Ikon Lucide, tiga font tanpa alasan, tanpa token desain | Tampilan generik |
| Metadata | Nama paket `react-example`, README bawaan AI Studio | Tidak profesional |

## 3. Tujuan dan non-tujuan

**Tujuan**
- G1. Tidak ada file komponen di atas 200 baris, tidak ada logika bisnis di dalam komponen.
- G2. Logika domain (CSV, alamat, filter, validasi) berupa fungsi murni dengan tes unit, dipakai bersama oleh web dan server.
- G3. UI bisa dipakai penuh dengan keyboard, kontras WCAG AA, layar 360px tanpa overflow (R-03, R-25, R-32).
- G4. Setiap tampilan punya state kosong, memuat, dan galat (R-27).
- G5. Data dibagi antar pengguna dengan login dan peran. Siapa pun tanpa login tidak bisa membaca atau mengubah data.
- G6. Tidak ada layanan backend pihak ketiga. Server dijalankan sendiri.
- G7. Dependensi runtime: web 4 (lihat bagian 7), server 0.
- G8. Paritas fitur, termasuk seluruh ekspor.

**Non-tujuan**
- Tidak mengganti penyedia peta.
- Tidak ada kolaborasi sunting waktu nyata (kursor bersama, penguncian dokumen). Pembaruan lewat muat ulang dan polling ringan.
- Tidak membuat logo, foto, statistik, atau testimoni karangan (R-17, R-18, R-23).

## 4. Pengguna dan skenario utama

Beberapa staf berbagi satu kumpulan data lokasi. **Perlu konfirmasi** peran dan cara pendaftaran (Pertanyaan no. 1 dan 2).

Alur inti:
1. Masuk dengan akun.
2. Mengimpor lokasi (CSV, pencarian tempat, impor batch, atau input manual).
3. Menelusuri dan memfilter di peta dan daftar.
4. Memilih beberapa pin untuk edit massal atau hapus.
5. Menghitung rute antar pin.
6. Mengekspor CSV, gambar peta, laporan PDF, atau cadangan penuh.

## 5. Fitur yang dipertahankan

| Fitur | Sumber sekarang | Catatan |
|---|---|---|
| Impor CSV dengan deteksi kolom | `CSVUploader`, `csvParser` | Parser RFC 4180 sendiri, diuji, di paket domain |
| Pencarian tempat | `PlaceSearchBox` | Places API |
| Impor batch nama tempat | `PlaceBatchImporter` | Antrean, batas laju, progres |
| Input pin manual | `ManualPinForm` | Validasi bersama web dan server |
| Daftar pin, pilih massal, ubah kategori, hapus | `PinList` | Paginasi dan `content-visibility` |
| Filter kategori, wilayah, bentuk gambar | `App`, `MapDrawingManager`, `addressParser` | Modul filter murni |
| Hitung rute | `RouteCalculator` | Fitur `route` terisolasi |
| Ekspor CSV | `App` | Pertahankan |
| Ekspor gambar peta | `html2canvas` | Diganti Google Static Maps lewat proxy server, lihat bagian 6 |
| Ekspor laporan PDF dengan grafik | `ReportSummary`, `jspdf`, `recharts` | `jspdf` dipertahankan (dimuat malas), grafik SVG buatan sendiri |
| Cadangan dan pemulihan penuh | baru | JSON lengkap, hanya admin |
| Login, peran, kelola pengguna | baru | Pengganti aturan Firestore |
| Mode layar penuh, jenis peta | `App` | Pertahankan |

## 6. Arsitektur target

Prinsip: ketergantungan hanya mengarah ke dalam (UI → aplikasi → domain). Domain tidak tahu React, HTTP, maupun penyimpanan.

```
package.json            # npm workspaces
packages/
  domain/               # fungsi murni + tipe, tanpa dependensi
    pin/ geo/ csv/ validation/
apps/
  web/                  # Vite + React
    src/
      app/              #   composition root, env, router sederhana
      data/             #   ApiPinRepository (fetch), MemoryPinRepository (tes)
      features/         #   pins, map, import, filters, route, export, auth, admin
      shared/           #   ui (dialog native, field, toast), lib, styles
  server/               # Node, tanpa dependensi runtime
    src/
      http/             #   router tipis, middleware, penanganan galat
      auth/             #   scrypt, sesi, peran, pembatas laju login
      pins/             #   handler, repository SQLite
      export/           #   proxy Static Maps, cadangan
      db/               #   koneksi SQLite, migrasi berurut
```

Keputusan dan alasannya (R-31):
- **Server Node tanpa dependensi**: `node:http`, `node:sqlite`, `node:crypto` (scrypt), `node:test`. Alasan: permukaan serangan rantai pasok nol dan seluruh server cukup kecil untuk dibaca satu orang. Pengorbanan: router, cookie, dan validasi ditulis sendiri (±300 baris, diuji). Risiko `node:sqlite` dibahas di bagian 13.
- **Paket `domain` bersama**: validasi satu sumber untuk form web, impor CSV, dan API server. Tidak ada skema ganda yang bisa berbeda.
- **Repository pattern** di web dan server: UI hanya tahu `PinRepository`. Server bisa memindahkan SQLite ke Postgres nanti tanpa menyentuh handler.
- **Proxy Static Maps di server**: gambar peta untuk ekspor dibuat server dengan key terpisah yang dibatasi IP server. Key di klien tidak dipakai untuk ekspor, dan `html2canvas` yang rapuh hilang.
- **State dengan React bawaan** (`useReducer`, `useSyncExternalStore`, context) dan `fetch` bawaan.
- **Satu modul env** di web dan server yang divalidasi saat boot, bukan `as any` tiga jalur.

### Kontrak API (garis besar)

| Metode dan rute | Fungsi | Peran minimal |
|---|---|---|
| `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` | Sesi | publik, publik, login |
| `GET /api/pins` | Daftar pin (mendukung `If-None-Match`) | viewer |
| `POST /api/pins`, `POST /api/pins/bulk` | Tambah, impor massal | editor |
| `PATCH /api/pins/:id`, `PATCH /api/pins/bulk` | Ubah, ubah kategori massal | editor |
| `DELETE /api/pins/:id`, `DELETE /api/pins/bulk` | Hapus | editor |
| `GET /api/export/static-map` | Gambar peta untuk laporan | viewer |
| `GET /api/export/backup`, `POST /api/export/restore` | Cadangan dan pemulihan | admin |
| `GET/POST/PATCH/DELETE /api/users` | Kelola pengguna | admin |

Konflik penyuntingan: setiap pin punya `version`. Ubah dengan versi lama ditolak (409) dan UI menampilkan pilihan muat ulang. Alasan: dua staf menyunting pin yang sama tanpa saling menimpa diam-diam.

## 7. Anggaran pihak ketiga

Aturan: sebuah paket masuk hanya jika (a) standar web atau Node tidak bisa melakukannya, atau (b) menulis sendiri lebih berisiko daripada memakainya. Alasannya tertulis di sini.

**Runtime web**

| Paket | Status | Alasan |
|---|---|---|
| `react`, `react-dom` | Tetap | Dasar UI |
| `@vis.gl/react-google-maps` | Tetap | Pembungkus Maps resmi dari Google, mengurus siklus hidup peta dan marker |
| `jspdf` | Tetap, dimuat malas | Membuat PDF multihalaman dengan gambar dan teks. Menulis penulis PDF sendiri berisiko untuk teks Unicode dan font. Hanya dimuat saat pengguna menekan ekspor PDF |
| Google Maps JS API | Tetap | Inti produk (peta, Places, Directions). Layanan, bukan paket |

**Dihapus:** `firebase`, `html2canvas`, `recharts`, `lucide-react`, `motion`, `express`, `@google/genai`, `dotenv`, serta Google Fonts (diganti font sistem).

**Dibuat sendiri:** parser CSV, validasi, router dan auth server, dialog (`<dialog>` bawaan), toast, tab, grafik SVG untuk laporan, ikon SVG inline yang relevan (R-04).

**Server runtime:** nol dependensi. Wajib Node 24 LTS (menjalankan TypeScript lewat type stripping, `node:sqlite`).

**Dev:** `vite`, `typescript`, `@vitejs/plugin-react`, `tailwindcss` + `@tailwindcss/vite` (build-time saja, tidak menambah kode runtime), `vitest`, `@types/node`. Playwright opsional.

Hasil: dependensi runtime dari 14 menjadi **4** di web dan **0** di server.

## 8. Arah desain (antislop dan better-interface)

**Belum ada `DESIGN.md`.** Menurut R-37, saya tidak membangun UI tanpa arah dari Anda. Tanpa arah, hasil berlabel *draft without direction* dengan dial ENERGY 1 / RHYTHM 1 / MOTION 1.

**Usulan Design Read (menunggu konfirmasi):**
> Reading this as: alat kerja peta data bersama untuk staf operasional, dengan bahasa visual tenang dan padat informasi, dial ENERGY 1 / RHYTHM 1 / MOTION 1.

Alasan dial rendah: alat kerja harian, bukan halaman pemasaran. Peta adalah titik fokus, panel lain mengalah. Ritme seragam adalah pilihan sadar karena tugasnya berulang.

**Prinsip:**
- Satu titik fokus per layar: peta.
- Satu aksen warna untuk aksi utama dan pin terpilih. Warna kategori pin memakai palet terbatas yang lolos kontras.
- Token desain (warna, jarak, radius, bayangan, tipografi) dalam satu sumber. Tema terang dan gelap sama-sama berfungsi (R-34).
- Font sistem untuk antarmuka. Monospace sistem hanya untuk koordinat dan data tabular, alasan tertulis (R-06).
- Tanpa glassmorphism, glow, gradien dekoratif, badge kapsul, atau animasi templat. Gerak hanya untuk transisi panel dan umpan balik, menghormati `prefers-reduced-motion`.
- Teks antarmuka berbahasa Indonesia, spesifik, tanpa kata pemasaran (R-15, R-16).
- Desktop: peta penuh dengan panel samping yang bisa diciutkan. Mobile: peta dengan lembar bawah untuk daftar dan filter, target sentuh minimal 44px (R-03).
- Layar baru karena login dan admin: halaman masuk, daftar pengguna, dan peran. Semuanya dengan state kosong, memuat, dan galat.

**Review `better-interface`:** setelah implementasi saya jalankan review lintas domain dan laporkan hasil berperingkat. Domain yang skill-nya belum terpasang ditandai *Not reviewed*.

## 9. Persyaratan non-fungsional

- **Aksesibilitas:** keyboard penuh, fokus terlihat, dialog tertutup dengan Escape, label pada tombol ikon, kontras minimal 4,5:1.
- **State:** daftar, peta, impor, ekspor, dan login punya state kosong, memuat, dan galat yang bisa ditindaklanjuti.
- **Kinerja:** daftar 5.000 pin tetap responsif. Target diukur di fase 4.
- **Responsif:** tanpa overflow horizontal dari 360px sampai desktop lebar.
- **Pengujian:** tes unit untuk `domain`, tes integrasi API server dengan SQLite memori, tes komponen untuk alur kritis.
- **Privasi:** web hanya memanggil server sendiri dan Google Maps API.

## 10. Keamanan dan data

- **Autentikasi:** kata sandi di-hash dengan `scrypt` (bawaan Node), sesi acak di tabel SQLite, cookie `HttpOnly`, `Secure`, `SameSite=Lax`. Pembatas laju login per akun dan IP.
- **Otorisasi:** tiga peran, `viewer`, `editor`, `admin`, dicek di server pada setiap rute. Pengecekan di UI hanya kenyamanan, bukan pengaman.
- **Pendaftaran:** hanya lewat undangan admin, tanpa pendaftaran terbuka (Pertanyaan no. 2).
- **CSRF:** `SameSite` plus pemeriksaan `Origin` pada metode yang mengubah data.
- **Validasi:** semua masukan divalidasi oleh paket `domain` di server. Teks pengguna tidak pernah dirender sebagai HTML.
- **Header:** CSP ketat (hanya host Google Maps yang diizinkan), `X-Content-Type-Options`, `Referrer-Policy`.
- **Key Maps:** key web dibatasi referrer HTTP. Key Static Maps untuk proxy dibatasi IP server. Pembatasan dilakukan di Google Cloud Console, di luar kode, dan menjadi prasyarat rilis.
- **Rahasia:** lewat variabel lingkungan server, tidak pernah masuk repo. `firebase-applet-config.json` dihapus dari repo.
- **Cadangan:** `GET /api/export/backup` menghasilkan JSON lengkap. Untuk basis data, disarankan salinan terjadwal berkas SQLite di server.
- **Migrasi:** data lama dari Firestore diekspor sekali, lalu diimpor lewat `restore` atau impor CSV (Pertanyaan no. 5).

## 11. Rencana bertahap

| Fase | Isi | Kriteria selesai |
|---|---|---|
| 0 | Ubah ke workspace npm, bersihkan dependensi, ganti metadata, pasang lint dan Vitest | `build`, `lint`, `test` hijau |
| 1 | Paket `domain`: CSV, alamat, filter, validasi, dan tes paritas terhadap perilaku lama | Tes paritas hijau |
| 2 | Server: HTTP, SQLite, migrasi, auth, peran, CRUD pin, tes integrasi | Semua rute dites, tidak ada dependensi runtime |
| 3 | Web: lapisan `data/` ke API, modul env, hapus Firebase | Tidak ada impor `firebase` di repo |
| 4 | Sistem desain: token, primitif UI, tema, font sistem | Primitif lolos tes aksesibilitas |
| 5 | Pecah `App.tsx` dan komponen besar menjadi `features/*` dengan UI baru, login, admin, ekspor lengkap (CSV, gambar, PDF, cadangan) | Checklist bagian 5 terpenuhi, tidak ada file di atas 200 baris |
| 6 | Migrasi data Firestore, dokumentasi deploy, Docker | Data lama berhasil diimpor, aplikasi jalan dari satu perintah |
| 7 | Review `better-interface`, Delivery Gate antislop, klik-tembus tiap kontrol | Laporan PASS/FAIL dengan bukti (R-35), semua HIGH selesai |

Setiap fase menjadi rangkaian commit yang bisa ditinjau sendiri.

## 12. Kriteria penerimaan

- Semua fitur bagian 5 berfungsi dan terverifikasi dengan menjalankan aplikasi dan server, bukan hanya membaca kode.
- `package.json` tidak memuat `firebase`. Dependensi runtime sesuai bagian 7.
- Pengguna tanpa login ditolak dengan 401 di setiap rute `/api` selain login. Viewer tidak bisa menulis (403). Keduanya punya tes.
- Dua editor yang mengubah pin yang sama mendapat 409, bukan penimpaan diam-diam.
- Web hanya meminta jaringan ke server sendiri dan host Google Maps (diperiksa di DevTools).
- Delivery Gate antislop lengkap dengan bukti per butir.
- Laporan `better-interface` tanpa temuan HIGH terbuka.
- `tsc --noEmit` bersih di semua workspace, tidak ada `any` tanpa komentar alasan.
- Bundle awal web lebih kecil dari sekarang (diukur sebelum dan sesudah).

## 13. Risiko

| Risiko | Mitigasi |
|---|---|
| `node:sqlite` masih berstatus aktif dikembangkan | Akses lewat antarmuka repository. Jika bermasalah, ganti ke `better-sqlite3` (satu dependensi native) tanpa menyentuh handler |
| Auth dan router buatan sendiri berisiko celah | Tes keamanan khusus (sesi, peran, CSRF, laju), review `security-review`, cakupan kecil karena hanya yang dibutuhkan |
| Server harus dijalankan dan dirawat sendiri | Satu kontainer Docker dengan volume SQLite, salinan cadangan terjadwal, dokumentasi deploy |
| Parser CSV buatan sendiri bug | Suite tes RFC 4180 (kutip, baris baru, BOM, pemisah `;`) |
| Gambar peta ekspor lewat Static Maps terbatas (jumlah marker, ukuran) | Batasi dan beri tahu pengguna, atau bagi menjadi beberapa gambar. Tinjau contoh sebelum fase 5 |
| Kuota Maps/Places saat impor batch | Antrean, batas laju, progres, galat per baris |
| Regresi saat refactor | Tes paritas di fase 1 sebelum memindahkan kode |
| Tanpa arah desain, hasil generik | Menunggu jawaban no. 4 sebelum fase 4 |

## 14. Pertanyaan terbuka untuk diskusi

1. **Peran:** cukup `viewer`, `editor`, `admin`? Apakah semua pengguna melihat satu kumpulan data yang sama, atau ada beberapa ruang kerja terpisah (mis. per wilayah atau per unit)?
2. **Akun:** admin pertama dibuat lewat perintah di server, lalu mengundang yang lain? Perlu login Google (OAuth, menambah ketergantungan) atau cukup email dan kata sandi? Saya sarankan email dan kata sandi.
3. **Hosting server:** server sendiri, VPS, atau layanan kontainer? Node 24 dan satu volume untuk SQLite sudah cukup. Ini menentukan dokumentasi deploy dan strategi cadangan.
4. **Arah desain:** punya brand, warna, atau referensi? Atau saya ajukan tiga pertanyaan singkat lalu menuliskan `DESIGN.md` dari jawaban Anda? Apakah dial ENERGY 1 / RHYTHM 1 / MOTION 1 sesuai?
5. **Migrasi data lama:** siapkan skrip ekspor satu kali dari Firestore, atau data lama boleh dibuang?
6. **Skala:** perkiraan jumlah pin terbesar dan jumlah pengguna bersamaan? Satu SQLite cukup untuk puluhan pengguna dan puluhan ribu pin.
7. **Tailwind:** tetap (build-time saja) atau CSS biasa dengan token variabel agar tanpa alat tambahan?
8. **Pengujian:** Vitest dan tes integrasi server cukup, atau perlu e2e Playwright juga?
9. **Skill pendamping:** pasang skill `better-*` (accessibility, layout, writing, typography, colors, ui) agar review `better-interface` penuh?
10. **Bahasa, tema, dan nama produk:** hanya Bahasa Indonesia? Tema terang dan gelap? Ada nama resmi dan logo (tidak akan saya buat tanpa instruksi)?
11. **Kebijakan `jspdf`:** boleh dipertahankan sebagai satu-satunya pustaka berat, dimuat malas? Atau ekspor PDF memakai cetak peramban saja agar nol pustaka?
