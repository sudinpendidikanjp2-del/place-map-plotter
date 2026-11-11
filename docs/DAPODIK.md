# Menarik data dari Dapodik

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
