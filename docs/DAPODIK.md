# Menarik data dari Dapodik

> **Pembaruan:** pekerja terjadwal berbasis otomasi peramban sudah ada di `apps/sync` (lihat `apps/sync/README.md`). Dasarnya skrip Playwright milik pengguna yang diberi izin otomasi berkala oleh pemilik data. Bagian di bawah adalah riset awal sebelum itu.

Ringkasan riset dan keputusan untuk permintaan "tarik data otomatis dari dapo.kemendikdasmen.go.id".

## Temuan (diperiksa langsung, November 2026)

- `robots.txt` portal mengizinkan semua perayap (`Allow: /`).
- Portal baru adalah aplikasi satu halaman (SPA). Datanya tidak ada di HTML, melainkan diambil dari API internal: `/api/detail-sekolah?npsn=`, `/api/detail-sekolah/search?q=`, `/api/progress-pengiriman/...`, `/api/ikdByNpsn`, dan lainnya.
- API itu memakai **token Bearer** yang diambil dari `env.js`. Berkas `env.js` dan permintaan otomatis ditantang oleh **WAF SafeLine** (halaman `/.safeline/...`). Mengambil token itu atau melewati tantangan WAF sama dengan menembus perlindungan akses, jadi **tidak dilakukan** di sini.
- API juga membatasi laju (respons 429 "Too many requests").
- Endpoint lama yang sering dipakai skrip pihak ketiga (`rekap/dataSekolah`, `rekap/progresSP` di domain `dapo.dikdasmen.kemdikbud.go.id`) berasal dari tahun 2018 dan tidak ditemukan lagi pada portal baru. Formatnya tidak terverifikasi.
- Tautan di portal menunjuk ke layanan lain: Verval SP (`vervalsp.data.kemendikdasmen.go.id`), `sp.datadik...`, `ptk.datadik...`. Data referensi per kecamatan ada di `referensi.data.kemendikdasmen.go.id` sebagai tabel HTML (tidak diperiksa dalam riset ini, host tidak diizinkan di sesi).
- Katalog API Bappenas memuat entri "Data Dapodik Kemendikdasmen". Syarat aksesnya tidak bisa diperiksa dari sesi ini.

## Jalur yang tersedia

| Jalur | Status | Catatan |
|---|---|---|
| **Impor CSV hasil ekspor resmi** | **Sudah ada** | Kolom Dapodik dikenali otomatis. NPSN yang sama memperbarui data lama. Cocok untuk penarikan berkala manual. |
| API resmi dengan kredensial dari instansi | Belum dibangun | Perlu spesifikasi dan token dari Kemendikdasmen atau katalog Bappenas. Setelah ada, konektor tinggal memetakan responsnya ke `LocationInput` dan memakai pembaruan NPSN yang sama. |
| Mengambil tabel HTML Data Referensi | Belum dibangun | Halaman publik, tetapi perlu izin penggunaan, batas laju sopan, dan pemeriksaan `robots.txt` host itu. Tidak memuat koordinat. |
| Otomasi peramban terjadwal oleh operator yang berizin | **Sudah ada** (`apps/sync`) | Hanya menangkap respons yang dipanggil halaman portal sendiri, jeda sopan, berhenti bila ditolak. Belum diuji terhadap portal asli. |
| Menembus WAF atau memakai token dari `env.js` | **Tidak dilakukan** | Melewati perlindungan akses. |

## Kolom CSV yang dikenali

| Bidang | Judul kolom yang dikenali (tanpa membedakan huruf besar kecil, `_` dan `/` dianggap spasi) |
|---|---|
| NPSN | npsn |
| Nama | nama satuan pendidikan, nama sekolah, nama |
| Jenjang | bentuk pendidikan, jenjang, jenjang pendidikan |
| Alamat | alamat jalan, alamat |
| Kecamatan, Kota/Kabupaten, Provinsi | kecamatan, kabupaten/kota, kabupaten, kota, provinsi |
| Lintang, Bujur | lintang, bujur, latitude, longitude, lat, lng |
| Jumlah murid | jumlah pd, peserta didik, jumlah siswa |
| Jumlah guru | jumlah ptk, jumlah gtk, jumlah guru |

Kolom lain (mis. Status Sekolah, Akreditasi) disimpan sebagai data tambahan. Kolom wilayah yang terisi dipakai apa adanya (lebih akurat daripada menebak dari alamat). Impor ulang berkas yang lebih baru memperbarui baris ber-NPSN yang sama dan menambah baris baru, sehingga cocok untuk sinkronisasi berkala.

## Langkah yang disarankan

1. Mintalah akses data resmi ke Kemendikdasmen (Pusdatin) atau lewat katalog API Bappenas, sebutkan kebutuhan: daftar satuan pendidikan per wilayah dengan NPSN, jenjang, koordinat, jumlah PD dan PTK.
2. Sambil menunggu, unduh ekspor yang tersedia dan impor lewat layar Impor.
3. Bila API resmi sudah ada, kirimkan spesifikasi dan cara autentikasinya. Konektornya kecil karena penyimpanan, pembaruan NPSN, dan pengelompokan peta sudah tersedia.

## Koordinat

Respons `detail-sekolah` **memuat `lintang` dan `bujur`** (dikonfirmasi dari halaman Dapodik yang disimpan pengguna: SMKN 1 Mas Ubud, NPSN 20110502, -8.5416 & 115.2697, dan dari bundel portal). Riset awal di atas keliru menyatakan sebaliknya. Karena itu:
- Pekerja mengambil koordinat langsung dan mengimpornya (sumber `import`), jadi sekolah langsung tampil di peta.
- Koordinat dianggap tidak valid dengan aturan yang sama dengan portal sendiri: kosong, nol, atau di luar Indonesia (lintang -11 sampai 6, bujur 95 sampai 141). Lintang dan bujur yang tertukar juga jatuh ke aturan ini. Sekolah itu masuk tanpa koordinat dengan catatan "Koordinat Dapodik tidak valid", bukan dengan titik yang salah.
- Yang tanpa koordinat dicari lewat layar Sinkronisasi (Google Places) dari nama dan wilayah, dibatasi kuota harian (`GEOCODE_DAILY_LIMIT`, bawaan 500). Hasil ditolak bila di luar Indonesia atau alamatnya tidak memuat nama kota yang sama. Titiknya ditandai **perkiraan** sampai ada yang menekan "Tandai sudah benar".
- Titik yang diperbaiki manual tidak pernah ditimpa oleh sinkronisasi berikutnya.
- Pencarian otomatis berkala bisa dinyalakan dengan `GEOCODE_AUTO=true`. Bawaannya mati agar biaya tidak mengejutkan.

## Cara halaman detail diambil

Halaman `/sekolah?npsn=...` memanggil `/api/detail-sekolah?npsn=...` dengan header `Authorization` yang disiapkan portal. Pekerja membuka halamannya dan menangkap respons itu (tidak memanggil URL API langsung), jadi tidak perlu membaca atau memakai ulang token.
