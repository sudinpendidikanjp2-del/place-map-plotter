# PRD: Redesign dan Refactor CSV Pinpoint Map Plotter

Status: **Draft untuk diskusi** (belum ada kode yang diubah)
Mode antislop: **DURING** (pilihan sesi ini)
Skill acuan: `antislop`, `better-interface` (hanya `better-interface` terpasang, domain `better-*` lain belum)

---

## 1. Ringkasan

Aplikasi saat ini memplot titik lokasi dari CSV, pencarian tempat, input manual, atau impor batch ke Google Maps. Pin disimpan di Firestore. Pengguna bisa memfilter berdasarkan kategori, wilayah (provinsi, kota, kecamatan), dan bentuk gambar di peta, menghitung rute, lalu mengekspor CSV, gambar, atau PDF.

Fungsinya sudah lengkap, tetapi kodenya sulit dirawat dan antarmukanya belum punya identitas. Dokumen ini mengusulkan:

1. Refactor ke arsitektur berlapis berbasis fitur.
2. Redesign antarmuka dengan arah visual yang jelas, lolos antislop, dan lolos review `better-interface`.
3. Perbaikan keamanan data (aturan Firestore saat ini terbuka untuk siapa saja).

## 2. Kondisi sekarang (temuan dari kode)

| Area | Temuan | Dampak |
|---|---|---|
| Struktur | `App.tsx` 1.234 baris: state, Firestore, filter wilayah, screenshot peta, dan UI bercampur | Sulit diuji dan diubah |
| Komponen | 9 komponen 130 sampai 474 baris, mengurus UI sekaligus logika | Logika tidak bisa dipakai ulang |
| Data | `firebase.ts` dipanggil langsung dari `App.tsx` (`getDocs`, `setDoc`, `deleteDoc`) | UI terikat ke Firebase |
| Keamanan | `firestore.rules`: `allow delete: if true`, tulis tanpa autentikasi, baca publik | Siapa pun bisa menghapus semua pin |
| Konfigurasi | API key Maps dibaca lewat 3 jalur (`process.env`, `import.meta.env`, `globalThis`) dengan `as any` | Membingungkan dan rawan salah |
| Dependensi | `express`, `@google/genai`, `dotenv`, `motion` terpasang tetapi tidak diimpor | Bobot dan permukaan serangan sia-sia |
| Ekspor | `html2canvasSafe.ts` (258 baris) menambal masalah warna `oklch` | Rapuh, melanggar prinsip antislop R-33 jika berupa patch |
| Pengujian | Tidak ada tes, hanya `tsc --noEmit` | Refactor tanpa jaring pengaman |
| Antarmuka | Ikon Lucide di semua komponen, tiga font (Inter, Space Grotesk, JetBrains Mono) tanpa alasan tertulis, belum ada token desain | Tampilan generik |
| Metadata | `package.json` bernama `react-example`, README masih bawaan AI Studio | Tidak profesional |

## 3. Tujuan dan non-tujuan

**Tujuan**
- G1. Tidak ada file komponen di atas 200 baris, tidak ada logika bisnis di dalam komponen.
- G2. Seluruh logika domain (parsing CSV, parsing alamat, filter, rute) berupa fungsi murni dengan tes unit.
- G3. UI bisa dipakai penuh dengan keyboard, kontras WCAG AA, layar 360px tanpa overflow (R-03, R-25, R-32).
- G4. Setiap tampilan punya state kosong, memuat, dan galat (R-27).
- G5. Data pin hanya bisa diubah oleh pengguna terautentikasi sesuai kepemilikan.
- G6. Paritas fitur: tidak ada fitur yang hilang kecuali disepakati.

**Non-tujuan**
- Tidak mengganti Google Maps, Firebase, atau React.
- Tidak menambah fitur baru (mis. kolaborasi waktu nyata) di fase ini.
- Tidak membuat logo, foto, statistik, atau testimoni karangan (R-17, R-18, R-23).

## 4. Pengguna dan skenario utama

Pengguna kemungkinan staf yang mengelola daftar lokasi (mis. sekolah atau fasilitas) dan butuh peta, laporan, dan rute. **Perlu konfirmasi Anda** (lihat Pertanyaan Terbuka).

Alur inti:
1. Mengimpor lokasi (CSV, pencarian tempat, impor batch, atau input manual).
2. Menelusuri dan memfilter di peta dan daftar.
3. Memilih beberapa pin untuk edit massal atau hapus.
4. Menghitung rute antar pin.
5. Mengekspor CSV, gambar peta, atau laporan PDF.

## 5. Fitur yang dipertahankan (inventaris)

| Fitur | Sumber sekarang | Catatan |
|---|---|---|
| Impor CSV dengan deteksi kolom | `CSVUploader`, `csvParser` | Ganti parser buatan dengan PapaParse |
| Pencarian tempat | `PlaceSearchBox` | Places API |
| Impor batch nama tempat | `PlaceBatchImporter` | Perlu antrean dan progres |
| Input pin manual | `ManualPinForm` | Validasi dengan Zod |
| Daftar pin, pilih massal, ubah kategori, hapus | `PinList` | Virtualisasi untuk data besar |
| Filter kategori, wilayah, bentuk gambar | `App`, `MapDrawingManager`, `addressParser` | Pindah ke modul filter murni |
| Hitung rute | `RouteCalculator` | Isolasi di fitur `route` |
| Ekspor CSV, gambar, PDF | `App`, `ReportSummary`, `html2canvasSafe` | Isolasi, lihat Pertanyaan Terbuka no. 5 |
| Mode layar penuh, jenis peta | `App` | Pertahankan |

## 6. Arsitektur target

Prinsip: ketergantungan hanya mengarah ke dalam (UI → aplikasi → domain). Domain tidak tahu React maupun Firebase.

```
src/
  app/                  # composition root: providers, routing, config env
  domain/               # fungsi murni + tipe, tanpa dependensi framework
    pin/                #   PinPoint, validasi (Zod), kategori
    geo/                #   parseAddress, filter wilayah, bentuk gambar
    csv/                #   parse dan serialisasi CSV
  data/                 # adaptor infrastruktur
    pin-repository.ts   #   antarmuka PinRepository
    firestore-pin-repository.ts
  features/             # satu folder per kemampuan, berisi ui + hooks
    pins/  map/  import/  filters/  route/  report/
  shared/
    ui/                 # primitif: Button, Dialog, Field, Toast, EmptyState
    lib/                # util umum, formatter
    styles/             # token desain, tema
```

Keputusan arsitektur dan alasannya (R-31):
- **Repository pattern** untuk Firestore: UI memanggil hook, hook memanggil `PinRepository`. Alasan: Firebase bisa diganti atau ditiru di tes tanpa menyentuh UI.
- **Pemisahan domain murni**: alasannya agar logika filter dan parsing bisa dites cepat tanpa DOM.
- **Struktur per fitur**: alasannya agar perubahan satu fitur tidak menyentuh folder lain.
- **Satu modul konfigurasi env** dengan validasi Zod saat boot: gagal cepat dengan pesan jelas, bukan `as any` tiga jalur.

## 7. Stack yang diusulkan

Dipertahankan karena sudah mendukung: React 19, Vite, TypeScript, Tailwind 4, `@vis.gl/react-google-maps`, Firebase.

| Kebutuhan | Pilihan | Alasan |
|---|---|---|
| Data server | TanStack Query | Cache, loading, error, dan optimistic update bawaan, menggantikan `useState` manual |
| State UI (filter, seleksi) | Zustand | Kecil, tanpa boilerplate, mudah dites |
| Validasi | Zod | Satu skema untuk form, CSV, dan env |
| CSV | PapaParse | Menangani kutip, pemisah, dan encoding yang sering salah di parser buatan |
| Komponen aksesibel | Radix UI (dialog, select, tabs, toast) | Fokus, keyboard, dan ARIA benar sejak awal |
| Daftar besar | TanStack Virtual | Daftar pin ribuan tanpa lambat |
| Tes | Vitest + Testing Library, Playwright untuk alur utama | Unit domain, komponen, dan e2e |
| Kualitas kode | Biome (atau ESLint + Prettier), `tsc --noEmit` di CI | Konsistensi otomatis |
| Dihapus | `express`, `@google/genai`, `dotenv`, `motion` (sementara) | Tidak diimpor |

Ikon: pilih set yang relevan dengan konten peta dan beri alasan tertulis, bukan default Lucide (R-04).

## 8. Arah desain (antislop dan better-interface)

**Belum ada `DESIGN.md`.** Menurut R-37, saya tidak akan membangun UI tanpa arah dari Anda. Jika arah tidak diberikan, hasilnya harus berlabel *draft without direction* dengan dial ENERGY 1 / RHYTHM 1 / MOTION 1.

**Usulan Design Read (menunggu konfirmasi):**
> Reading this as: alat kerja peta data untuk staf operasional, dengan bahasa visual tenang dan padat informasi, dial ENERGY 1 / RHYTHM 1 / MOTION 1.

Alasan dial rendah: ini alat kerja harian, bukan halaman pemasaran. Peta adalah titik fokus utama, panel lain mengalah. Ritme seragam adalah pilihan sadar karena pengguna mengulang tugas yang sama.

**Prinsip yang saya pegang:**
- Satu titik fokus per layar: peta. Panel daftar dan filter tunduk padanya.
- Satu aksen warna untuk aksi utama dan pin terpilih. Warna kategori pin memakai palet terbatas yang lolos kontras.
- Token desain (warna, jarak, radius, bayangan, tipografi) dalam satu sumber, dengan tema terang dan gelap yang sama-sama berfungsi (R-34).
- Satu keluarga font untuk antarmuka, ditambah font monospace hanya untuk koordinat dan data tabular, dengan alasan tertulis (R-06).
- Tanpa glassmorphism, glow, gradien dekoratif, badge kapsul, atau animasi templat. Gerak hanya untuk transisi panel dan umpan balik, menghormati `prefers-reduced-motion`.
- Teks antarmuka berbahasa Indonesia, spesifik, tanpa kata pemasaran dan tanpa tanda pisah em dash (R-02, R-15, R-16).
- Tata letak desktop: peta penuh dengan panel samping yang bisa diciutkan. Mobile: peta dengan lembar bawah (bottom sheet) untuk daftar dan filter, target sentuh minimal 44px (R-03).

**Review `better-interface`:** setelah implementasi, saya jalankan review lintas domain dan laporkan hasilnya berperingkat. Domain yang skill-nya belum terpasang saya tandai *Not reviewed*.

## 9. Persyaratan non-fungsional

- **Aksesibilitas:** semua kontrol bisa dijangkau keyboard, fokus terlihat, dialog tertutup dengan Escape, label pada tombol ikon, kontras minimal 4,5:1.
- **State:** setiap daftar, peta, impor, dan ekspor punya state kosong, memuat, dan galat dengan pesan yang bisa ditindaklanjuti.
- **Kinerja:** daftar 5.000 pin tetap responsif (virtualisasi, klaster marker). Target konkret diukur di fase 4.
- **Keamanan:** lihat bagian 10.
- **Responsif:** tanpa overflow horizontal dari 360px sampai desktop lebar.
- **Pengujian:** cakupan tinggi untuk `domain/`, tes komponen untuk alur kritis, e2e untuk impor, filter, dan ekspor.

## 10. Keamanan dan data

- Aturan Firestore diperketat: baca dan tulis hanya untuk pengguna terautentikasi, setiap pin memiliki `ownerId`, hanya pemilik yang bisa mengubah atau menghapus, validasi skema lengkap (panjang string, rentang lat/lng).
- API key Google Maps dibatasi berdasarkan referrer HTTP di Google Cloud Console. Ini tindakan di luar kode, saya catat sebagai prasyarat rilis.
- `firebase-applet-config.json` diganti dengan variabel lingkungan `VITE_*` yang divalidasi.
- Migrasi: pin lama tanpa `ownerId` perlu ditetapkan pemiliknya. Lihat Pertanyaan Terbuka no. 2.

## 11. Rencana bertahap

| Fase | Isi | Keluaran | Kriteria selesai |
|---|---|---|---|
| 0 | Persiapan: bersihkan dependensi, perbaiki metadata, pasang lint, format, Vitest, CI | Repo bersih | `build`, `lint`, `test` hijau |
| 1 | Ekstrak `domain/` dan tes | Fungsi murni teruji | Tes paritas terhadap perilaku lama untuk CSV, alamat, filter |
| 2 | Lapisan `data/` dan hook TanStack Query, konfigurasi env tunggal | UI tidak lagi memanggil Firebase | Tidak ada impor `firebase` di luar `data/` |
| 3 | Sistem desain: token, primitif UI, tema terang dan gelap | `shared/ui` | Primitif lolos tes aksesibilitas |
| 4 | Pecah `App.tsx` dan komponen besar menjadi `features/*` dengan UI baru | Aplikasi baru berparitas | Checklist fitur bagian 5 terpenuhi, tidak ada file di atas 200 baris |
| 5 | Aturan Firestore, autentikasi, migrasi data | Data aman | Tes aturan dengan emulator lulus |
| 6 | Review `better-interface`, Delivery Gate antislop, e2e | Laporan PASS/FAIL dengan bukti klik-tembus (R-35) | Semua HIGH selesai |

Setiap fase menjadi satu cabang atau satu rangkaian commit yang bisa ditinjau sendiri.

## 12. Kriteria penerimaan

- Semua fitur di bagian 5 berfungsi dan terverifikasi dengan menjalankan aplikasinya, bukan hanya membaca kode.
- Delivery Gate antislop lengkap dengan bukti per butir.
- Laporan `better-interface` tanpa temuan HIGH yang terbuka.
- Tidak ada `any` tanpa komentar alasan, `tsc --noEmit` bersih.
- Bundle awal tidak lebih besar dari sekarang (diukur sebelum dan sesudah).

## 13. Risiko

| Risiko | Mitigasi |
|---|---|
| Regresi perilaku saat refactor | Tes paritas di fase 1 sebelum memindahkan kode |
| Ekspor gambar dan PDF rapuh | Isolasi di `features/report`, putuskan pendekatan di Pertanyaan no. 5 |
| Kuota Google Maps atau Places API saat impor batch | Antrean dengan batas laju, progres, dan penanganan galat per baris |
| Pengetatan aturan Firestore memutus pengguna lama | Fase 5 diberi migrasi dan rencana rollback |
| Tanpa arah desain, hasil jadi generik | Menunggu jawaban no. 1 sebelum fase 3 |

## 14. Pertanyaan terbuka untuk diskusi

1. **Arah desain:** apakah Anda punya brand, warna, atau referensi? Atau saya ajukan 3 pertanyaan singkat (identitas, suasana, palet) lalu mencatat jawaban Anda ke `DESIGN.md`? Apakah dial ENERGY 1 / RHYTHM 1 / MOTION 1 sudah sesuai?
2. **Autentikasi:** siapa pengguna dan siapa yang boleh mengubah data? Pilihan: (a) login Google, data per pengguna, (b) satu organisasi dengan peran, (c) tetap publik untuk dibaca, tulis hanya untuk login. Dan apa yang terjadi pada data yang ada sekarang?
3. **Bahasa dan tema:** hanya Bahasa Indonesia? Perlu tema gelap dan terang, atau satu tema tetap?
4. **Nama dan identitas:** nama produk resmi? Perlu logo (saya tidak akan membuatnya tanpa instruksi)?
5. **Ekspor:** laporan PDF dan gambar peta tetap dibutuhkan persis seperti sekarang? Kalau laporan cukup dicetak lewat browser (CSS print), `html2canvas` dan `jspdf` bisa dihapus.
6. **Skala data:** perkiraan jumlah pin terbesar? Menentukan perlu klaster marker dan virtualisasi atau tidak.
7. **Pengujian:** cukup tes unit dan komponen, atau perlu e2e Playwright juga?
8. **Pemasangan skill:** pasang skill `better-*` pendamping (accessibility, layout, writing, typography, colors, ui) agar review `better-interface` penuh?
9. **Hosting dan deploy:** tetap di AI Studio / Cloud Run, atau pindah (Firebase Hosting, Vercel)? Menentukan konfigurasi env dan CI.
