# PRD: Redesign dan Refactor CSV Pinpoint Map Plotter

Status: **Draft v2 untuk diskusi** (belum ada kode aplikasi yang diubah)
Mode antislop: **DURING** (pilihan sesi ini)
Skill acuan: `antislop`, `better-interface` (hanya `better-interface` terpasang)

Perubahan dari v1: **tanpa Firebase/Firestore**, dan **anggaran pihak ketiga dikurangi seminimal mungkin** (bagian 7).

---

## 1. Ringkasan

Aplikasi memplot titik lokasi dari CSV, pencarian tempat, input manual, atau impor batch ke peta. Pengguna memfilter berdasarkan kategori, wilayah, dan bentuk gambar di peta, menghitung rute, lalu mengekspor CSV atau laporan.

Fungsinya lengkap, tetapi kodenya sulit dirawat, antarmukanya belum punya identitas, dan ia bergantung pada layanan pihak ketiga (Firebase, Google Fonts, banyak paket npm) untuk hal-hal yang bisa dikerjakan peramban sendiri. PRD ini mengusulkan:

1. Refactor ke arsitektur berlapis berbasis fitur.
2. Penyimpanan **lokal-pertama** di peramban (IndexedDB), tanpa backend dan tanpa akun.
3. Pengurangan dependensi, dengan prinsip: standar web lebih dulu, paket npm hanya jika alasannya tertulis.
4. Redesign antarmuka yang lolos antislop dan review `better-interface`.

## 2. Kondisi sekarang (temuan dari kode)

| Area | Temuan | Dampak |
|---|---|---|
| Struktur | `App.tsx` 1.234 baris: state, Firestore, filter wilayah, screenshot, dan UI bercampur | Sulit diuji dan diubah |
| Komponen | 9 komponen 130 sampai 474 baris, UI dan logika bercampur | Logika tidak bisa dipakai ulang |
| Data | UI memanggil Firestore langsung. Aturan Firestore mengizinkan siapa pun menghapus dan menulis | Terikat ke vendor dan tidak aman |
| Pihak ketiga | 16 dependensi runtime dan dev. `express`, `@google/genai`, `dotenv`, `motion` tidak diimpor. Font dimuat dari Google Fonts | Bobot, risiko rantai pasok, pelacakan pihak ketiga |
| Konfigurasi | API key Maps dibaca lewat 3 jalur dengan `as any` | Membingungkan |
| Ekspor | `html2canvas` + `jspdf` + `recharts` + `html2canvasSafe.ts` (258 baris tambalan warna `oklch`) | Rapuh dan berat |
| Pengujian | Tidak ada tes | Refactor tanpa jaring pengaman |
| Antarmuka | Ikon Lucide, tiga font tanpa alasan, tanpa token desain | Tampilan generik |
| Metadata | `package.json` bernama `react-example`, README bawaan AI Studio | Tidak profesional |

## 3. Tujuan dan non-tujuan

**Tujuan**
- G1. Tidak ada file komponen di atas 200 baris, tidak ada logika bisnis di dalam komponen.
- G2. Logika domain (CSV, alamat, filter, rute) berupa fungsi murni dengan tes unit.
- G3. UI penuh bisa dipakai dengan keyboard, kontras WCAG AA, layar 360px tanpa overflow (R-03, R-25, R-32).
- G4. Setiap tampilan punya state kosong, memuat, dan galat (R-27).
- G5. **Tidak ada layanan backend pihak ketiga.** Data tetap di perangkat pengguna dan bisa dibawa lewat ekspor dan impor.
- G6. Dependensi runtime turun dari 14 menjadi 3 atau kurang (bagian 7).
- G7. Paritas fitur, kecuali yang disepakati dihapus.

**Non-tujuan**
- Tidak mengganti penyedia peta (lihat Pertanyaan no. 2).
- Tidak menambah kolaborasi waktu nyata atau akun pengguna.
- Tidak membuat logo, foto, statistik, atau testimoni karangan (R-17, R-18, R-23).

## 4. Pengguna dan skenario utama

Pengguna kemungkinan staf yang mengelola daftar lokasi (mis. sekolah atau fasilitas) dan butuh peta, laporan, dan rute. **Perlu konfirmasi** (Pertanyaan no. 1).

Alur inti:
1. Mengimpor lokasi (CSV, pencarian tempat, impor batch, atau input manual).
2. Menelusuri dan memfilter di peta dan daftar.
3. Memilih beberapa pin untuk edit massal atau hapus.
4. Menghitung rute antar pin.
5. Mengekspor CSV, JSON cadangan, atau laporan cetak.

## 5. Fitur yang dipertahankan

| Fitur | Sumber sekarang | Catatan |
|---|---|---|
| Impor CSV dengan deteksi kolom | `CSVUploader`, `csvParser` | Parser RFC 4180 sendiri, diuji |
| Pencarian tempat | `PlaceSearchBox` | Places API |
| Impor batch nama tempat | `PlaceBatchImporter` | Antrean, batas laju, progres |
| Input pin manual | `ManualPinForm` | Validasi fungsi murni |
| Daftar pin, pilih massal, ubah kategori, hapus | `PinList` | Daftar besar dengan `content-visibility` atau paginasi |
| Filter kategori, wilayah, bentuk gambar | `App`, `MapDrawingManager`, `addressParser` | Modul filter murni |
| Hitung rute | `RouteCalculator` | Isolasi di fitur `route` |
| Ekspor CSV | `App` | Pertahankan |
| **Ekspor laporan** | `ReportSummary`, `html2canvasSafe` | Diganti laporan cetak (CSS print, simpan sebagai PDF lewat peramban) |
| **Cadangan dan pemulihan** | baru | Ekspor dan impor JSON, pengganti sinkronisasi cloud |
| Mode layar penuh, jenis peta | `App` | Pertahankan |

Yang dihapus bila disetujui: ekspor gambar peta lewat `html2canvas`, grafik `recharts`, dan PDF lewat `jspdf`. Laporan tetap ada lewat cetak peramban (Pertanyaan no. 3).

## 6. Arsitektur target

Prinsip: ketergantungan hanya mengarah ke dalam (UI → aplikasi → domain). Domain tidak tahu React maupun penyimpanan.

```
src/
  app/                  # composition root, konfigurasi env, penyedia
  domain/               # fungsi murni + tipe, tanpa dependensi
    pin/                #   PinPoint, validasi, kategori
    geo/                #   parseAddress, filter wilayah, bentuk gambar
    csv/                #   parse dan serialisasi RFC 4180
  data/
    pin-repository.ts   #   antarmuka PinRepository
    indexeddb-pin-repository.ts
    memory-pin-repository.ts   # untuk tes
  features/             # ui + hooks per kemampuan
    pins/  map/  import/  filters/  route/  report/  backup/
  shared/
    ui/                 # Button, Dialog (native <dialog>), Field, Toast, EmptyState
    lib/
    styles/             # token desain, tema, font lokal
```

Keputusan dan alasannya (R-31):
- **Repository pattern**: UI hanya tahu `PinRepository`. Hari ini IndexedDB, besok bisa API milik sendiri tanpa menyentuh UI.
- **IndexedDB langsung** (API bawaan peramban, dibungkus ±80 baris): tidak perlu akun, tidak ada biaya, tidak ada vendor, bekerja offline.
- **Domain murni**: logika dites cepat tanpa DOM.
- **State dengan React bawaan** (`useReducer`, `useSyncExternalStore`, context): cukup untuk filter, seleksi, dan data lokal. Tidak perlu pustaka state atau cache.
- **Satu modul env** yang divalidasi saat boot: gagal cepat dengan pesan jelas, bukan `as any` tiga jalur.

## 7. Anggaran pihak ketiga

Aturan: sebuah paket masuk hanya jika (a) standar web tidak bisa melakukannya, atau (b) menulis sendiri lebih berisiko daripada memakainya, dan alasannya tertulis di sini.

**Runtime**

| Paket | Status | Alasan |
|---|---|---|
| `react`, `react-dom` | Tetap | Dasar UI |
| `@vis.gl/react-google-maps` | Tetap (sementara) | Pembungkus Maps yang dirawat Google, mengurus siklus hidup peta dan marker. Alternatif: memuat Maps JS API langsung dengan pembungkus tipis sendiri, dibahas di Pertanyaan no. 2 |
| Google Maps JS API | Tetap | Inti produk (peta, Places, Directions). Ini layanan, bukan paket |
| `firebase` | **Dihapus** | Diganti IndexedDB |
| `jspdf`, `html2canvas`, `recharts` | **Dihapus** | Diganti laporan cetak dan grafik sederhana dari SVG/CSS |
| `lucide-react` | **Dihapus** | Ikon SVG inline yang relevan, hanya yang dipakai (R-04) |
| `motion` | **Dihapus** | CSS transition cukup |
| `express`, `@google/genai`, `dotenv` | **Dihapus** | Tidak dipakai |
| Google Fonts | **Dihapus** | Font sistem atau font yang di-host sendiri (tanpa permintaan ke pihak ketiga, tanpa pelacakan) |

**Dibuat sendiri, bukan paket:** parser CSV, validasi, dialog (elemen `<dialog>` bawaan), toast, tab, daftar, penyimpanan, kelas `cn()`.

**Dev:** `vite`, `typescript`, `@vitejs/plugin-react`, `tailwindcss` + `@tailwindcss/vite`, `vitest`. Playwright opsional (Pertanyaan no. 7). Tailwind dipertahankan karena murni build-time dan tidak menambah kode runtime. Alternatifnya CSS biasa dengan token variabel, dibahas di Pertanyaan no. 6.

Hasil: dependensi runtime dari 14 menjadi **3** (`react`, `react-dom`, `@vis.gl/react-google-maps`), atau 2 bila pembungkus Maps ditulis sendiri.

## 8. Arah desain (antislop dan better-interface)

**Belum ada `DESIGN.md`.** Menurut R-37, saya tidak membangun UI tanpa arah dari Anda. Jika arah tidak diberikan, hasil berlabel *draft without direction* dengan dial ENERGY 1 / RHYTHM 1 / MOTION 1.

**Usulan Design Read (menunggu konfirmasi):**
> Reading this as: alat kerja peta data untuk staf operasional, dengan bahasa visual tenang dan padat informasi, dial ENERGY 1 / RHYTHM 1 / MOTION 1.

Alasan dial rendah: alat kerja harian, bukan halaman pemasaran. Peta adalah titik fokus; panel lain mengalah. Ritme seragam adalah pilihan sadar karena tugasnya berulang.

**Prinsip:**
- Satu titik fokus per layar: peta.
- Satu aksen warna untuk aksi utama dan pin terpilih. Warna kategori pin memakai palet terbatas yang lolos kontras.
- Token desain (warna, jarak, radius, bayangan, tipografi) dalam satu sumber. Tema terang dan gelap sama-sama berfungsi (R-34).
- Font sistem untuk antarmuka. Monospace sistem hanya untuk koordinat dan data tabular, alasan tertulis (R-06).
- Tanpa glassmorphism, glow, gradien dekoratif, badge kapsul, atau animasi templat. Gerak hanya untuk transisi panel dan umpan balik, menghormati `prefers-reduced-motion`.
- Teks antarmuka berbahasa Indonesia, spesifik, tanpa kata pemasaran (R-15, R-16).
- Desktop: peta penuh dengan panel samping yang bisa diciutkan. Mobile: peta dengan lembar bawah untuk daftar dan filter, target sentuh minimal 44px (R-03).

**Review `better-interface`:** setelah implementasi saya jalankan review lintas domain dan laporkan hasil berperingkat. Domain yang skill-nya belum terpasang ditandai *Not reviewed*.

## 9. Persyaratan non-fungsional

- **Aksesibilitas:** keyboard penuh, fokus terlihat, dialog tertutup dengan Escape, label pada tombol ikon, kontras minimal 4,5:1.
- **State:** daftar, peta, impor, dan ekspor punya state kosong, memuat, dan galat yang bisa ditindaklanjuti.
- **Kinerja:** daftar 5.000 pin tetap responsif. Target diukur di fase 4.
- **Responsif:** tanpa overflow horizontal dari 360px sampai desktop lebar.
- **Pengujian:** tes unit untuk `domain/` dan `data/`, tes komponen untuk alur kritis.
- **Privasi:** tidak ada permintaan jaringan selain Google Maps API. Data pin tidak pernah meninggalkan perangkat.

## 10. Data dan keamanan

- Data pin disimpan di IndexedDB peramban pengguna. Tidak ada server, jadi tidak ada aturan akses yang bisa salah konfigurasi.
- Keterbatasan yang harus diterima: data hanya ada di satu peramban dan satu perangkat. Mitigasinya fitur **cadangan dan pemulihan JSON** serta ekspor CSV. Membuka di perangkat lain berarti mengimpor cadangan.
- Penyimpanan peramban bisa dihapus pengguna atau sistem. UI meminta `navigator.storage.persist()` dan menampilkan pengingat cadangan terakhir.
- API key Google Maps dibatasi referrer HTTP di Google Cloud Console (tindakan di luar kode, prasyarat rilis). Key berada di variabel `VITE_*` dan memang terlihat di klien, jadi pembatasan referrer wajib.
- Migrasi data lama: ekspor pin dari Firestore sekali (CSV atau JSON) lalu impor ke aplikasi baru. Saya akan menyediakan skrip ekspor satu kali bila Anda ingin (Pertanyaan no. 4).
- Impor CSV dan JSON divalidasi ketat, dan teks pengguna tidak pernah dirender sebagai HTML (mencegah XSS).

## 11. Rencana bertahap

| Fase | Isi | Kriteria selesai |
|---|---|---|
| 0 | Bersihkan dependensi, ganti metadata, pasang lint, Vitest, dan skrip build | `build`, `lint`, `test` hijau |
| 1 | Ekstrak `domain/` (CSV, alamat, filter) dan tes paritas terhadap perilaku lama | Tes paritas hijau |
| 2 | Lapisan `data/` (IndexedDB, memori), hook, modul env tunggal, hapus Firebase | Tidak ada impor `firebase` di repo |
| 3 | Sistem desain: token, primitif UI, tema, font lokal | Primitif lolos tes aksesibilitas |
| 4 | Pecah `App.tsx` dan komponen besar menjadi `features/*` dengan UI baru, laporan cetak, cadangan JSON | Checklist bagian 5 terpenuhi, tidak ada file di atas 200 baris |
| 5 | Migrasi data dari Firestore (sekali jalan) dan dokumentasi pengguna | Data lama berhasil diimpor |
| 6 | Review `better-interface`, Delivery Gate antislop, klik-tembus tiap kontrol | Laporan PASS/FAIL dengan bukti (R-35), semua HIGH selesai |

## 12. Kriteria penerimaan

- Semua fitur bagian 5 berfungsi dan terverifikasi dengan menjalankan aplikasinya.
- `package.json` tidak memuat `firebase`, dan dependensi runtime sesuai bagian 7.
- Tidak ada permintaan jaringan ke host selain Google Maps (diperiksa di DevTools).
- Delivery Gate antislop lengkap dengan bukti per butir.
- Laporan `better-interface` tanpa temuan HIGH terbuka.
- `tsc --noEmit` bersih, tidak ada `any` tanpa komentar alasan.
- Bundle awal lebih kecil dari sekarang (diukur sebelum dan sesudah).

## 13. Risiko

| Risiko | Mitigasi |
|---|---|
| Data hilang karena penyimpanan peramban dibersihkan | Cadangan JSON, `storage.persist()`, pengingat cadangan |
| Tidak ada berbagi data antar pengguna | Diterima di v2. Cadangan JSON sebagai jembatan. Jika berbagi jadi wajib, tambahkan backend sendiri di balik `PinRepository` |
| Parser CSV buatan sendiri bug | Suite tes dengan kasus RFC 4180 (kutip, baris baru, BOM, pemisah `;`) |
| Laporan cetak berbeda dari PDF lama | Tinjau contoh bersama sebelum fase 4 |
| Regresi saat refactor | Tes paritas di fase 1 sebelum memindahkan kode |
| Kuota Maps/Places saat impor batch | Antrean, batas laju, progres, galat per baris |
| Tanpa arah desain, hasil generik | Menunggu jawaban no. 5 sebelum fase 3 |

## 14. Pertanyaan terbuka untuk diskusi

1. **Pengguna dan berbagi data:** satu orang, satu perangkat? Atau beberapa orang harus melihat data yang sama? Jika ya, penyimpanan lokal tidak cukup dan kita perlu backend sendiri yang kecil (mis. server Node + SQLite di server Anda). Ini keputusan terbesar.
2. **Peta:** tetap Google Maps? Mengganti ke Leaflet + OpenStreetMap menghapus ketergantungan pada kunci dan kuota Google, tetapi kehilangan Places, Directions, dan peta satelit Google. Dan: pakai `@vis.gl/react-google-maps` atau tulis pembungkus tipis sendiri?
3. **Ekspor laporan:** cukup laporan cetak lewat peramban (simpan sebagai PDF) tanpa grafik `recharts` dan ekspor gambar peta?
4. **Migrasi:** perlu saya siapkan skrip ekspor satu kali dari Firestore untuk data yang sudah ada, atau data lama boleh dibuang?
5. **Arah desain:** punya brand, warna, atau referensi? Atau saya ajukan tiga pertanyaan singkat lalu menuliskan `DESIGN.md` dari jawaban Anda? Apakah dial ENERGY 1 / RHYTHM 1 / MOTION 1 sesuai?
6. **Tailwind:** tetap (build-time saja) atau CSS biasa dengan token variabel agar tidak ada alat tambahan?
7. **Pengujian:** cukup Vitest, atau perlu e2e Playwright juga?
8. **Skill pendamping:** pasang skill `better-*` (accessibility, layout, writing, typography, colors, ui) agar review `better-interface` penuh?
9. **Bahasa, tema, dan nama produk:** hanya Bahasa Indonesia? Tema terang dan gelap? Ada nama resmi dan logo (tidak akan saya buat tanpa instruksi)?
10. **Hosting:** statis (Netlify, GitHub Pages, server sendiri) atau tetap AI Studio / Cloud Run?
