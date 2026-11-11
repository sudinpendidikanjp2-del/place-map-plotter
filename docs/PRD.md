# PRD: Redesign dan Refactor CSV Pinpoint Map Plotter

Status: **v5, sudah diimplementasikan** (lihat bagian 0). Bagian 1 sampai 14 adalah PRD asli yang menjadi acuan.
Mode antislop: **DURING** (pilihan sesi ini)
Skill acuan: `antislop`, `better-interface` (hanya `better-interface` terpasang)

Keputusan yang sudah diambil:

| # | Keputusan |
|---|---|
| 1 | Tanpa Firebase/Firestore. Pihak ketiga dikurangi seminimal mungkin |
| 2 | **Satu kumpulan data untuk semua pengguna**, login dan peran |
| 3 | Tetap **Google Maps** |
| 4 | **Ekspor lengkap**: CSV, gambar peta, PDF laporan dengan grafik, cadangan |
| 5 | Dijalankan di **VPS** milik sendiri |
| 6 | **Harus scalable**: akan menjadi pengumpulan big data. Performa cepat pada data sangat besar |
| 7 | Data lama di Firestore **boleh dibuang** |
| 8 | `jspdf` boleh dipertahankan, disesuaikan dengan fitur |
| 9 | Arah desain: empat tangkapan layar terlampir sebagai **inspirasi**, bukan untuk ditiru |

---

## 0. Status implementasi (v5)

Keputusan tambahan dari pemilik produk: warna **biru dongker dan kuning**, data tentang **sekolah, fasilitas, aset** (jumlah murid dan guru), skema data mengikuti praktik terbaik, data lama di Firestore dibuang, skala pengguna belum diketahui.

**Sudah dibangun dan diverifikasi**

| Area | Hasil | Bukti |
|---|---|---|
| Paket `domain` | Validasi, parser CSV bertahap, pemetaan kolom, parser alamat, filter | 11 tes unit lulus |
| Server | Auth (scrypt, sesi, peran, pembatas laju, CSRF), CRUD dengan kontrol versi, cluster PostGIS, daftar kursor, pencarian trigram, filter lingkaran dan area, impor COPY streaming dengan batch yang bisa dibatalkan, laporan, ekspor CSV streaming, cadangan NDJSON, proxy Static Maps | 18 tes integrasi terhadap PostgreSQL nyata lulus |
| Web | Layar Peta, Data, Impor, Laporan, Admin, Masuk. Tema terang dan gelap, pencarian cepat `Ctrl K`, rute, gambar bentuk, ekspor CSV, PDF, gambar peta | Klik-tembus di Chromium, uji keyboard, uji peta dengan Google Maps tiruan |
| Aksesibilitas | Semua pasangan warna lolos WCAG AA (24 pasangan), fokus terlihat di semua perhentian Tab, dialog `<dialog>` bawaan, tanpa overflow di 390px | Skrip audit |
| Deploy | Dockerfile, Compose (PostGIS, aplikasi, Caddy), cadangan dan pemulihan | **Belum dijalankan**: tidak ada Docker di lingkungan pengembangan |

**Skema data (praktik terbaik):** kolom bertipe untuk atribut yang diagregasi (`students`, `teachers`, `founded_year`), `kind` (sekolah, fasilitas, aset) dan `category` bebas, atribut lain di `attributes jsonb`, wilayah (`province`, `city`, `district`) diurai saat simpan dan diindeks, geometri `Point` dengan indeks GiST, `version` untuk kontrol konflik, `import_batch_id` untuk membatalkan impor.

**Hasil benchmark** (mesin 4 vCPU, 16 GB, PostgreSQL 16, satu klien serial, p95, cache hasil kosong). Data uji sintetis berpusat di 8 kota, jadi jauh lebih padat daripada data nyata.

| Kasus | 1 juta lokasi | 10 juta lokasi | Target |
|---|---|---|---|
| Cluster seluruh Indonesia, provinsi, kota, dengan filter | 2 sampai 12 ms | 2 sampai 4 ms | < 200 ms tercapai |
| Daftar 50 baris dengan filter | 11 ms | 11 ms | < 150 ms tercapai |
| Pencarian teks (trigram) | 18 ms | 78 ms | < 300 ms tercapai |
| Ringkasan laporan dan strip angka peta | 3 ms | 4 ms | tercapai |
| Filter lingkaran 5 km | 163 ms | 1.431 ms | tidak ada target, lihat catatan |
| Impor CSV | 14.800 baris/detik | | turun dari 22.800 karena pra-agregasi |
| Ekspor CSV | byte pertama 3 ms | byte pertama 2 ms (207 MB dialirkan) | tercapai |

Cara mencapainya:
- **Pra-agregasi** (`cluster_cells` zoom 0 sampai 14 dan `stat_months`), dijaga oleh pemicu per pernyataan dan diuji sama dengan hitungan langsung. 23 MB pada 10 juta lokasi.
- Cache hasil dengan kunci versi data di PostgreSQL, tidak pernah basi dan berlaku lintas replika.
- `plan_cache_mode=force_custom_plan`: setelah 5 eksekusi PostgreSQL beralih ke rencana generik yang 5 kali lebih lambat.
- Filter teks dan spasial memakai `order by id + 0`: tanpa itu perencana memindai seluruh tabel dari belakang (pencarian 12 detik menjadi 78 ms).
- Filter lingkaran memakai pendekatan ekuirektangular (galat di bawah 0,5% sampai 100 km).

Catatan: filter lingkaran 5 km pada 10 juta lokasi masih 1,4 detik karena data uji menaruh sekitar 800 ribu titik dalam satu lingkaran itu. Pada sebaran nyata jauh lebih ringan, tetapi belum diukur.

**Pembaruan v6 (permintaan lanjutan)**

| Permintaan | Hasil |
|---|---|
| Filter kecamatan dan jenjang | Jenjang jadi kolom tersendiri (`level`, daftar baku) dan dimensi pra-agregasi, jadi tetap secepat cluster biasa. Kecamatan kini bisa dipilih langsung setelah provinsi, tanpa memilih kota. Kolom wilayah dari berkas impor dipakai apa adanya. |
| Cari titik dari nama tempat | Di form tambah dan ubah lokasi. Server memanggil Google Places (New) dengan kunci server (`GOOGLE_SERVER_KEY`), dibatasi 30 pencarian per menit per pengguna. Menguji dengan server Places palsu; **belum diuji dengan Google asli**. |
| Label nama dan mode tanpa cluster | Tombol label di peta menampilkan setiap titik dengan namanya (maksimal 1.500 titik per area, ada pemberitahuan bila terpotong). Pilihan diingat di peramban. |
| Gambar lokasi | Hingga 8 gambar per lokasi, disimpan di volume `media` (ikut dicadangkan oleh `backup.sh`). Gambar dikecilkan di peramban (1600 px dan thumbnail 400 px) dan EXIF dibuang. Server memeriksa isi berkas, bukan klaim klien. Berkas yatim disapu setiap hari. |
| Tarik data dari Dapodik | **Tidak otomatis penuh.** API portal baru memerlukan token dan dilindungi WAF, sehingga tidak ditembus. Tersedia: impor CSV dengan kolom Dapodik dikenali dan pembaruan berdasarkan NPSN. Lihat `docs/DAPODIK.md`. |

Pengujian: 11 tes domain dan 26 tes server lulus (termasuk impor gaya Dapodik, unggah gambar, pencarian tempat, dan konsistensi pra-agregasi dengan jenjang). Skrip peramban `scripts/e2e/fitur.cjs` menguji alur filter, cari tempat, gambar, dan label.

**Belum dikerjakan atau berbeda dari PRD**
- **Pencarian tempat (Places) dan impor batch nama tempat dari aplikasi lama tidak dipindahkan.** Keduanya memakai Places API berkuota dan tidak cocok untuk jutaan baris. Impor besar memakai CSV berkoordinat. Bisa ditambahkan bila diperlukan.
- Kunci Maps web kini diberikan saat runtime lewat `/api/config` (`GOOGLE_MAPS_KEY`, `GOOGLE_MAP_ID`), bukan saat build, agar image Docker yang sama bisa dipakai di mana saja.
- Peta diuji dengan Google Maps **tiruan**. Rendering sungguhan, Directions, dan gaya peta belum diverifikasi karena tidak ada kunci API.
- Ekspor gambar peta dan PDF dengan gambar peta memerlukan `STATIC_MAPS_KEY`. Tanpa kunci, PDF tetap dibuat tanpa gambar.
- Nama produk "Peta Sekolah" dan penanda huruf "P" adalah **penampung sementara**. Tidak ada logo yang dibuat.
- Ukuran pengguna dan data sebenarnya belum diketahui, jadi spesifikasi VPS di `deploy/README.md` berupa perkiraan.
- Skill `better-*` pendamping tidak terpasang, jadi review `better-interface` tidak dijalankan penuh.

---

## 1. Ringkasan

Aplikasi memplot titik lokasi ke Google Maps, memfilter, menghitung rute, dan mengekspor laporan. Versi sekarang membaca seluruh koleksi pin ke memori peramban, memfilter di klien, dan menyimpan di Firestore dengan aturan terbuka. Pendekatan itu runtuh begitu data melewati puluhan ribu baris.

PRD ini mengubah fondasinya:

1. **PostgreSQL + PostGIS** di VPS sebagai penyimpanan utama, dengan kueri berbasis area peta.
2. **Server mengerjakan pekerjaan berat**: pengelompokan titik (cluster), filter, pencarian, agregasi laporan, impor massal, dan ekspor streaming. Klien hanya menerima apa yang terlihat.
3. **Arsitektur berlapis** dengan paket domain bersama untuk web dan server.
4. **Dependensi pihak ketiga seminimal mungkin**, setiap paket punya alasan tertulis.
5. **Redesign antarmuka** yang peta-pertama, lolos antislop dan review `better-interface`.

## 2. Kondisi sekarang (temuan dari kode)

| Area | Temuan | Dampak pada skala besar |
|---|---|---|
| Pengambilan data | `getDocs` memuat **semua** pin sekaligus, filter dijalankan di klien (`useMemo`) | Tidak jalan di atas ±50 ribu baris |
| Penulisan massal | Hapus dan ubah massal dikerjakan dokumen per dokumen dari klien | Lambat, bisa setengah jadi |
| Peta | Semua marker dirender langsung | Peramban macet |
| Struktur | `App.tsx` 1.234 baris, 9 komponen 130 sampai 474 baris, UI dan logika bercampur | Sulit diuji dan diubah |
| Keamanan | Aturan Firestore mengizinkan siapa pun menulis dan menghapus | Data terbuka |
| Pihak ketiga | 14 dependensi runtime, 4 di antaranya tidak diimpor, font dari Google Fonts | Bobot dan risiko rantai pasok |
| Konfigurasi | API key Maps dibaca lewat 3 jalur dengan `as any` | Membingungkan |
| Ekspor | `html2canvas` + tambalan `html2canvasSafe.ts` (258 baris) | Rapuh |
| Pengujian | Tidak ada tes | Refactor tanpa jaring pengaman |

## 3. Tujuan dan non-tujuan

**Tujuan**
- G1. Tidak ada file komponen di atas 200 baris, tanpa logika bisnis di komponen.
- G2. Logika domain (CSV, alamat, wilayah, validasi) berupa fungsi murni dengan tes, dipakai web dan server.
- G3. **Skala:** target di bagian 9, diukur dengan benchmark, bukan diasumsikan.
- G4. UI penuh bisa dipakai dengan keyboard, kontras WCAG AA, layar 360px tanpa overflow (R-03, R-25, R-32).
- G5. Setiap tampilan punya state kosong, memuat, dan galat (R-27).
- G6. Satu kumpulan data bersama, dengan login dan peran. Tanpa login tidak ada akses.
- G7. Tanpa layanan backend pihak ketiga. Semuanya berjalan di VPS sendiri.
- G8. Paritas fitur, termasuk seluruh ekspor.

**Non-tujuan**
- Bukan gudang data analitik (tidak ada OLAP, BI, atau data lake). Agregasi dilakukan di PostgreSQL.
- Tidak ada penyuntingan waktu nyata (kursor bersama). Pembaruan lewat muat ulang dan polling ringan.
- Tidak mengunggah foto ke server. Kolom `foto` tetap berupa URL.
- Tidak membuat logo, foto, statistik, atau testimoni karangan (R-17, R-18, R-23).

## 4. Pengguna dan alur utama

Beberapa staf berbagi satu kumpulan data. Peran diusulkan `viewer`, `editor`, `admin` (Pertanyaan no. 1).

1. Masuk dengan akun.
2. Menjelajah peta: cluster berubah mengikuti zoom, filter, dan bentuk yang digambar.
3. Memilih pin dan melihat detailnya, atau memilih banyak pin untuk edit dan hapus massal.
4. Mengimpor CSV berukuran besar dan memantau progresnya.
5. Menghitung rute antar pin terpilih.
6. Membuat laporan dan mengekspor.

## 5. Fitur dan layar

| Layar | Isi | Catatan skala |
|---|---|---|
| **Peta** (utama) | Peta penuh, filter melayang, ringkasan angka, kartu detail pin, gambar bentuk, rute | Cluster dari server per area dan zoom |
| **Data** | Tabel dengan pencarian, filter, pilih massal, edit massal, hapus | Paginasi kursor dan jendela virtual |
| **Impor** | Unggah CSV, pemetaan kolom, pratinjau validasi, progres, riwayat batch dan pembatalan batch | Streaming ke PostgreSQL lewat COPY, pekerjaan latar |
| **Laporan** | Ringkasan per kategori dan wilayah, tren penambahan, ekspor CSV, gambar peta, PDF | Agregasi SQL, bukan hitung di klien |
| **Admin** | Pengguna dan peran, token API (jika disetujui) | |
| **Masuk** | Email dan kata sandi | |

Fitur yang dipertahankan: impor CSV dengan deteksi kolom, pencarian tempat (Places), impor batch nama tempat (terbatas kuota, lihat bagian 13), input manual, hitung rute, filter kategori dan wilayah dan bentuk, layar penuh, jenis peta.

Yang berubah:
- Ekspor gambar peta: dari `html2canvas` menjadi Google Static Maps lewat proxy server.
- Ekspor PDF: `jspdf` (dimuat malas), isi laporan berupa **agregat dan N teratas**, bukan semua baris. Seluruh data tetap diekspor lewat CSV streaming.
- Cadangan dan pemulihan penuh untuk admin.

## 6. Arsitektur target

Ketergantungan hanya mengarah ke dalam (UI → aplikasi → domain). Domain tidak tahu React, HTTP, maupun basis data.

```
package.json              # npm workspaces
packages/
  domain/                 # fungsi murni + tipe, tanpa dependensi
    pin/ geo/ csv/ validation/
apps/
  web/                    # Vite + React
    src/ app/ data/ features/ shared/
  server/                 # Node 24, TypeScript
    src/
      http/               #   router tipis, middleware, galat
      auth/               #   scrypt, sesi, peran, pembatas laju
      pins/               #   handler, query, cluster
      imports/            #   unggah streaming, COPY, pekerjaan, batch
      reports/            #   agregasi, Static Maps proxy
      exports/            #   CSV streaming, cadangan
      db/                 #   koneksi, migrasi berurut
deploy/                   # docker-compose, Caddyfile, skrip cadangan
```

### 6.1 Topologi di VPS

```
Internet → Caddy (TLS, HTTP/3, kompresi) → Node server (statik + /api) → PostgreSQL + PostGIS
```

Semuanya Docker Compose dalam satu VPS. Server Node stateless, jadi bisa dijalankan beberapa replika di belakang Caddy bila CPU jadi batas. PostgreSQL adalah satu-satunya komponen berstatus.

### 6.2 Data

Tabel `pins` (garis besar):

| Kolom | Alasan |
|---|---|
| `id bigint identity` | Kunci kecil dan berurutan, murah diindeks |
| `name`, `category`, `description`, `address`, `tahun_didirikan`, `foto` | Sesuai skema sekarang |
| `geom geography(Point, 4326)` | Kueri area dan bentuk |
| `province`, `city`, `district` | Hasil `parseIndonesianAddress` disimpan saat impor, bukan dihitung ulang tiap filter |
| `custom_fields jsonb` | Kolom bebas dari CSV |
| `import_batch_id`, `created_by`, `updated_by`, `created_at`, `updated_at`, `version` | Jejak, pembatalan batch, dan kontrol konflik |

Indeks: GiST pada `geom`, B-tree pada `(category)`, `(province, city, district)`, `(created_at, id)` untuk paginasi kursor, GIN trigram (`pg_trgm`) pada `name` dan `address` untuk pencarian cepat, GIN pada `custom_fields`.

### 6.3 Pola yang membuat cepat

- **Cluster di server.** `GET /api/pins/clusters?bbox=&zoom=&filter...` mengelompokkan titik di dalam area pandang dengan `ST_SnapToGrid` sesuai zoom. Jumlah fitur yang dikirim dibatasi (±2.000), berapa pun total data. Pada zoom dekat, titik individual dikirim.
- **Filter dan bentuk di PostGIS.** Lingkaran dan poligon yang digambar pengguna menjadi `ST_DWithin` dan `ST_Covers`, bukan loop di klien.
- **Daftar dengan paginasi kursor** (keyset), bukan `OFFSET`. Tabel di klien memakai jendela virtual buatan sendiri.
- **Cache HTTP.** `ETag` dan `Cache-Control` pada hasil cluster dan agregat yang tidak sering berubah, dengan pembuangan berdasarkan `max(updated_at)`.
- **Impor streaming.** Berkas diunggah sebagai stream, diparsing bertahap, divalidasi, lalu dimasukkan dengan `COPY` ke tabel staging, kemudian dipindahkan dengan satu `INSERT ... SELECT`. Memori konstan berapa pun ukuran berkas. Progres disimpan di tabel `import_jobs`.
- **Ekspor streaming.** CSV ditulis sambil membaca kursor basis data, memori konstan.
- **Operasi massal di SQL.** Hapus dan ubah kategori massal menjadi satu pernyataan, bukan ribuan permintaan.
- **Konfigurasi PostgreSQL** disetel untuk ukuran RAM VPS (`shared_buffers`, `work_mem`, `effective_cache_size`), `autovacuum` dipantau.
- **Jalur pertumbuhan.** Bila data melewati kemampuan satu VPS: partisi tabel menurut waktu atau wilayah, replika baca, dan tile vektor (`ST_AsMVT`). Tidak dibangun sekarang, tetapi desain antarmuka `PinRepository` tidak menghalanginya.

### 6.4 Kontrak API (garis besar)

| Rute | Fungsi | Peran |
|---|---|---|
| `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` | Sesi | publik, publik, login |
| `GET /api/pins/clusters` | Cluster dan titik dalam area | viewer |
| `GET /api/pins` | Daftar kursor dengan filter, pencarian | viewer |
| `GET /api/pins/:id` | Detail | viewer |
| `POST /api/pins`, `PATCH /api/pins/:id`, `DELETE /api/pins/:id` | CRUD satu pin | editor |
| `POST /api/pins/bulk-update`, `POST /api/pins/bulk-delete` | Massal berdasarkan daftar id atau filter | editor |
| `POST /api/imports`, `GET /api/imports/:id`, `DELETE /api/imports/:id` | Unggah, progres, batalkan batch | editor |
| `GET /api/reports/summary` | Agregat untuk laporan | viewer |
| `GET /api/export/csv`, `GET /api/export/static-map` | Ekspor | viewer |
| `GET /api/export/backup`, `POST /api/export/restore` | Cadangan | admin |
| `/api/users` | Kelola pengguna | admin |

Kontrol konflik: setiap pin punya `version`. Ubah dengan versi lama ditolak (409), UI menawarkan muat ulang.

## 7. Stack dan anggaran pihak ketiga

Aturan: sebuah paket masuk hanya jika standar web atau Node tidak bisa melakukannya, atau menulis sendiri lebih berisiko. Alasannya tertulis.

**Web (runtime)**

| Paket | Alasan |
|---|---|
| `react`, `react-dom` | Dasar UI |
| `@vis.gl/react-google-maps` | Pembungkus Maps resmi dari Google, mengurus siklus hidup peta dan marker |
| `jspdf` (dimuat malas) | PDF multihalaman dengan teks dan gambar. Menulis penulis PDF sendiri berisiko untuk Unicode |

**Server (runtime)**

| Paket | Alasan |
|---|---|
| `postgres` (porsager) | Driver PostgreSQL **tanpa dependensi turunan**, mendukung `COPY` stream dan pool. Menulis protokol PostgreSQL sendiri tidak masuk akal |

Selebihnya server memakai bawaan Node 24: `node:http`, `node:crypto` (scrypt), `node:stream`, `node:test`, serta TypeScript lewat type stripping.

**Infrastruktur (bukan dependensi kode):** PostgreSQL 17 + PostGIS, Caddy, Docker Compose.

**Dev:** `vite`, `typescript`, `@vitejs/plugin-react`, `tailwindcss` + `@tailwindcss/vite` (build-time, tidak menambah kode runtime), `vitest`, `@types/node`.

**Dihapus:** `firebase`, `html2canvas`, `recharts`, `lucide-react`, `motion`, `express`, `@google/genai`, `dotenv`, Google Fonts.

**Dibuat sendiri:** parser CSV streaming, validasi, router dan auth, dialog (`<dialog>`), toast, tab, jendela virtual, grafik SVG, ikon SVG inline yang relevan (R-04).

Hasil: dependensi runtime **4 di web, 1 di server** (sebelumnya 14).

## 8. Arah desain (antislop dan better-interface)

### 8.1 Yang diambil dari referensi

Empat tangkapan layar dibaca sebagai bahan arah, bukan cetak biru (R-30: tidak meniru produk lain).

| Referensi | Yang diambil | Yang sengaja tidak diambil |
|---|---|---|
| 1. Peta pasar dengan panel melayang | Peta sebagai kanvas penuh, bilah atas melayang dengan kontrol segmen dan pencarian bertanda `⌘K`, kartu detail melayang di sudut bawah kanan, gaya dasar peta yang diredam agar penanda menonjol | Marker segi enam (identitas milik produk itu), wallet dan token |
| 2. Dasbor properti | Angka cluster di atas peta, strip ringkasan di atas filter, chip filter, status berlabel, kartu daftar dengan foto | Slider dengan efek buram, kartu bergaya kaca, label "Available/Sold/Booked" |
| 3. Dasbor laporan | Angka besar dengan tipografi tabular sebagai suara utama, permukaan hangat dan lembut, satu kartu gelap untuk penekanan, pola garis diagonal untuk data tidak aktif | Gradien, avatar manusia, logo merek, semua dalam bentuk pil |
| 4. Dasbor toko | Struktur sidebar plus konten, kartu KPI dengan perubahan dibanding periode lalu, tabel rapi, tombol ekspor di kanan atas | Kartu "Upgrade Premium", widget "AI Assistant", angka karangan |

Catatan antislop terhadap referensi: kotak glassmorphism dan blur (R-10) dibatasi paling banyak satu elemen. Semua pil (R-11) dihindari: pil hanya untuk kontrol segmen dan chip filter, kartu dan tombol memakai radius berbeda dengan alasan hierarki. Deretan kartu KPI identik (R-14) diganti: satu angka utama besar, sisanya ringkas. Semua angka yang tampil berasal dari data nyata (R-17), jika kosong tampil state kosong.

### 8.2 Design Read (menunggu konfirmasi)

> Reading this as: alat kerja peta data bersama untuk staf operasional, dengan bahasa visual peta-pertama yang lembut dan rapi, dial ENERGY 2 / RHYTHM 2 / MOTION 1.

- **ENERGY 2:** referensi memang halus dan berkarakter, lebih hidup dari alat internal biasa, tetapi tetap alat kerja.
- **RHYTHM 2:** konsisten antar layar dengan beberapa pengecualian terarah (Peta berbeda dari Data dan Laporan).
- **MOTION 1:** hanya transisi panel, hover, dan perubahan cluster. Menghormati `prefers-reduced-motion`.

### 8.3 Pengungkit (levers)

- **Satu titik fokus per layar:** di Peta, peta itu sendiri. Di Laporan, satu angka utama.
- **Satu aksen warna** untuk aksi utama dan pin terpilih. Warna dipilih Anda (Pertanyaan no. 4).
- **Motif identitas:** angka besar bertipografi tabular dan cluster berupa gelembung angka. Satu suara yang berulang di seluruh aplikasi.
- **Ruang kosong sebagai struktur:** panel melayang dengan jarak konsisten dari tepi.
- **Tema:** terang dan gelap, keduanya diuji (R-34). Gaya dasar peta mengikuti tema.

### 8.4 Tata letak

- **Desktop, layar Peta:** bilah atas melayang (kontrol segmen `Peta | Data | Laporan`, pencarian `⌘K`, menu pengguna). Filter dan strip ringkasan melayang di atas peta. Kartu detail pin di sudut kanan bawah. Panel daftar dapat diciutkan.
- **Layar Data dan Laporan:** sidebar tipis plus konten, tabel dan grafik di atas permukaan netral.
- **Mobile:** peta penuh dengan lembar bawah untuk daftar dan filter. Target sentuh minimal 44px (R-03).
- Navigasi hanya memuat layar yang benar-benar ada (R-24).
- Teks antarmuka berbahasa Indonesia, spesifik, tanpa kata pemasaran (R-15, R-16).
- Font: satu keluarga sans yang **di-host sendiri** (tanpa permintaan ke pihak ketiga) dan monospace sistem untuk koordinat. Pilihan keluarga dan alasannya di Pertanyaan no. 4 (R-06).
- Gaya dasar peta diredam melalui **Cloud-based map styling** di Google Cloud Console (`mapId`). Ini langkah di luar kode dan menjadi prasyarat. `AdvancedMarker` memang mensyaratkan `mapId`.

### 8.5 Review

Setelah implementasi saya menjalankan review `better-interface` dan Delivery Gate antislop, lengkap dengan klik-tembus tiap kontrol (R-35). Domain yang skill-nya belum terpasang ditandai *Not reviewed*.

## 9. Persyaratan non-fungsional dan target skala

Angka berikut adalah **target yang dibuktikan dengan benchmark di fase 3**, bukan jaminan. Perangkat uji: VPS 4 vCPU, 8 GB RAM, NVMe (Pertanyaan no. 3).

| Metrik | Target |
|---|---|
| Ukuran data uji | 1 juta pin (baseline), 10 juta pin (uji tekanan) |
| Kueri cluster per area pandang, p95 | < 200 ms pada 1 juta pin, sudah hangat |
| Halaman daftar (50 baris) dengan filter, p95 | < 150 ms pada 1 juta pin |
| Pencarian teks (trigram), p95 | < 300 ms pada 1 juta pin |
| Impor CSV | ≥ 20 ribu baris per detik di sisi server, memori konstan |
| Ekspor CSV | Mulai mengalir < 1 detik, memori konstan |
| Waktu muat awal Peta (jaringan cepat) | < 2 detik sampai peta interaktif |
| Aksesibilitas | Keyboard penuh, fokus terlihat, kontras ≥ 4,5:1 |
| Pengujian | Tes unit `domain`, tes integrasi API dengan PostgreSQL nyata di kontainer, tes komponen untuk alur kritis |

## 10. Keamanan dan data

- **Autentikasi:** kata sandi di-hash `scrypt`, sesi acak di tabel, cookie `HttpOnly`, `Secure`, `SameSite=Lax`, pembatas laju login.
- **Otorisasi:** peran dicek di server pada setiap rute.
- **CSRF:** `SameSite` plus pemeriksaan `Origin` pada metode yang mengubah data.
- **Validasi:** semua masukan divalidasi paket `domain` di server. Teks pengguna tidak pernah dirender sebagai HTML. Kueri memakai parameter terikat, tidak pernah penggabungan string.
- **Header:** CSP ketat (hanya host Google Maps), `X-Content-Type-Options`, `Referrer-Policy`.
- **Key Maps:** key web dibatasi referrer. Key Static Maps untuk proxy dibatasi IP server. Dilakukan di Google Cloud Console, prasyarat rilis.
- **Rahasia:** variabel lingkungan server, tidak masuk repo. `firebase-applet-config.json` dihapus.
- **VPS:** firewall hanya membuka 80/443 (dan SSH berbasis kunci), PostgreSQL tidak terpapar publik, pembaruan keamanan otomatis.
- **Cadangan:** `pg_dump` terjadwal ke penyimpanan di luar VPS dan **uji pemulihan berkala**. Cadangan JSON lewat aplikasi untuk subset data.
- **Jejak:** `created_by`, `import_batch_id` memungkinkan membatalkan impor yang salah dengan satu tindakan.

## 11. Rencana bertahap

| Fase | Isi | Kriteria selesai |
|---|---|---|
| 0 | Workspace npm, bersihkan dependensi, metadata, lint, Vitest, Docker Compose dev (PostgreSQL + PostGIS) | `build`, `lint`, `test` hijau, database jalan dari satu perintah |
| 1 | Paket `domain` (CSV streaming, alamat, wilayah, validasi) dan tes paritas dengan perilaku lama | Tes paritas hijau |
| 2 | Server: HTTP, migrasi, auth, peran, CRUD, kueri cluster dan daftar kursor | Tes integrasi hijau, 1 dependensi runtime |
| 3 | **Benchmark skala**: pembuat data sintetis 1 juta dan 10 juta pin, ukur target bagian 9, setel indeks dan PostgreSQL | Laporan benchmark, target tercapai atau dikoreksi bersama |
| 4 | Impor streaming, pekerjaan, riwayat dan pembatalan batch, ekspor CSV streaming, agregasi laporan | Impor 1 juta baris selesai dengan memori konstan |
| 5 | Sistem desain: token, primitif UI, tema, font lokal, gaya peta | Primitif lolos tes aksesibilitas |
| 6 | Web: layar Peta, Data, Impor, Laporan, Admin, Masuk, ekspor lengkap | Checklist bagian 5 terpenuhi, tidak ada file di atas 200 baris |
| 7 | Deploy VPS: Caddy, TLS, cadangan, pemantauan, dokumentasi | Aplikasi jalan di VPS, uji pemulihan cadangan lulus |
| 8 | Review `better-interface`, Delivery Gate antislop, klik-tembus | Laporan PASS/FAIL dengan bukti (R-35), semua HIGH selesai |

Benchmark ditempatkan **sebelum** UI dibangun, supaya arsitektur data terbukti dulu.

## 12. Kriteria penerimaan

- Semua fitur bagian 5 berfungsi dan terverifikasi dengan menjalankan aplikasi dan server.
- Target bagian 9 tercapai pada data 1 juta pin, dengan laporan benchmark.
- Impor CSV 1 juta baris selesai tanpa lonjakan memori.
- Tanpa login: 401 pada semua rute `/api` selain login. Viewer tidak bisa menulis (403). Keduanya punya tes.
- Dua editor mengubah pin yang sama: yang kedua mendapat 409.
- `package.json` tidak memuat `firebase`. Dependensi runtime sesuai bagian 7.
- Web hanya memanggil server sendiri dan host Google Maps (diperiksa di DevTools).
- Delivery Gate antislop lengkap dengan bukti. Laporan `better-interface` tanpa temuan HIGH terbuka.
- `tsc --noEmit` bersih di semua workspace.

## 13. Risiko

| Risiko | Mitigasi |
|---|---|
| Target skala tidak tercapai di VPS yang dipilih | Benchmark di fase 3 sebelum UI. Naikkan spesifikasi VPS, setel indeks, atau terapkan jalur pertumbuhan (partisi, tile vektor) |
| Cluster dengan `ST_SnapToGrid` terlihat kurang rapi dibanding algoritma klien | Uji visual di fase 3. Alternatifnya `ST_ClusterDBSCAN` pada zoom tertentu |
| Server dan basis data dirawat sendiri | Docker Compose, cadangan terjadwal, uji pemulihan, dokumentasi operasi |
| Impor batch nama tempat memakai Places API (kuota dan biaya, tidak cocok untuk jutaan baris) | Tetap di sisi klien dengan batas laju dan progres, hanya untuk volume kecil. Impor besar wajib berkoordinat |
| Static Maps terbatas jumlah marker | Ekspor gambar memakai marker terbatas atau cluster, beri tahu pengguna |
| Auth dan router buatan sendiri berisiko celah | Tes keamanan khusus dan `security-review` sebelum rilis |
| Regresi saat refactor | Tes paritas di fase 1 |
| Cloud-based map styling butuh pengaturan di Google Cloud Console | Dicatat sebagai prasyarat, dengan langkah tertulis |
| Tanpa keputusan warna dan font, desain generik | Menunggu jawaban no. 4 sebelum fase 5 |

## 14. Pertanyaan terbuka untuk diskusi

1. **Peran:** `viewer`, `editor`, `admin` cukup? Siapa yang boleh menghapus massal dan membatalkan batch impor?
2. **Masuknya data:** hanya lewat antarmuka web, atau perlu **API untuk sistem lain** (token API) agar data masuk dari sumber lain? Ini penting untuk "pengumpulan big data".
3. **Skala sebenarnya:** perkiraan jumlah pin dalam 1 tahun dan 3 tahun, laju penambahan (per hari), jumlah pengguna bersamaan, dan spesifikasi VPS yang tersedia. Angka ini menentukan apakah target 1 juta cukup atau perlu 10 juta sejak awal.
4. **Arah visual:** konfirmasi Design Read dan dial (ENERGY 2 / RHYTHM 2 / MOTION 1). Pilih **satu warna aksen** (referensi Anda memakai hijau, merah tua, dan biru), dan keluarga font yang akan di-host sendiri. Atau saya ajukan 3 opsi bergambar untuk dipilih.
5. **Skema data:** kolom tetap seperti sekarang ditambah `custom_fields` bebas, atau pengguna perlu mendefinisikan kolom sendiri per kumpulan data? Saya sarankan yang pertama.
6. **Kategori dan istilah:** data ini tentang apa (mis. sekolah, fasilitas, aset)? Menentukan kata di antarmuka dan isi strip ringkasan.
7. **Akun:** email dan kata sandi, admin pertama dibuat lewat perintah di server, lalu mengundang yang lain. Setuju?
8. **Domain, VPS, dan penyedia penyimpanan cadangan** (di luar VPS)?
9. **Tailwind:** tetap (build-time saja) atau CSS biasa dengan token variabel?
10. **Skill pendamping:** pasang skill `better-*` (accessibility, layout, writing, typography, colors, ui) agar review `better-interface` penuh?
11. **Nama produk, bahasa, logo:** hanya Bahasa Indonesia? Nama resmi? Logo tidak akan saya buat tanpa instruksi.
