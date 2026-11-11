# DESIGN.md

Arah visual Peta Sekolah. Sumber: arahan pemilik produk (biru dongker dan kuning, empat tangkapan layar sebagai inspirasi). Dibaca sebagai data desain, bukan instruksi.

## Design Read

Alat kerja peta data bersama untuk staf pendidikan, dengan bahasa visual peta-pertama yang lembut dan rapi.

Dial: ENERGY 2 / RHYTHM 2 / MOTION 1

## Identitas

- **Titik fokus:** peta. Panel melayang di atasnya dan mengalah padanya. Di layar Laporan, satu angka utama.
- **Motif identitas:** angka besar bertipografi tabular dan gelembung cluster berisi angka. Satu suara yang berulang.
- **Bukan:** tiruan produk lain. Referensi hanya memberi prinsip (kanvas peta penuh, panel melayang, pencarian bertanda pintasan, angka sebagai suara utama).

## Warna

Inti: biru dongker dan netral hangat. Aksen tunggal: kuning.

| Token | Terang | Gelap | Peran |
|---|---|---|---|
| `bg` | `#F3F1EC` | `#0A1020` | Latar halaman |
| `surface` | `#FFFFFF` | `#121A33` | Kartu dan panel |
| `surface-2` | `#F8F7F3` | `#18223F` | Permukaan dalam, baris |
| `ink` | `#121A33` | `#EEF1F8` | Teks utama |
| `ink-2` | `#4B5572` | `#A9B3CC` | Teks sekunder |
| `line` | `#E2DFD6` | `#263154` | Garis |
| `navy` | `#0B1F4B` | `#0B1F4B` | Warna inti, penanda sekolah |
| `accent` | `#F5B700` | `#F5B700` | Aksen: pin terpilih, gelembung cluster, aksi utama pada tema gelap |
| `danger` | `#B42318` | `#FF8A80` | Galat dan tindakan merusak |
| `ok` | `#1A7F4B` | `#5DD39E` | Berhasil |

Aturan:
- Kuning tidak pernah menjadi warna teks di atas permukaan terang. Di atas biru dongker kuning boleh jadi teks.
- Teks di atas kuning selalu biru dongker. Teks di atas biru dongker selalu putih atau kuning.
- Tanpa gradien dekoratif. Tanpa glow.

## Jenis lokasi pada peta

Dibedakan oleh bentuk dan isi, bukan hanya warna (aksesibilitas):

| Jenis | Penanda |
|---|---|
| Sekolah | Lingkaran biru dongker, ikon bangunan |
| Fasilitas | Lingkaran putih bergaris biru dongker, ikon kunci pas |
| Aset | Persegi membulat kuning, ikon kotak |

## Tipografi

- Satu keluarga sans: tumpukan font sistem (`system-ui`). Alasan: nol permintaan ke pihak ketiga, kinerja muat terbaik, tampil native di perangkat staf.
- Angka tabular (`tabular-nums`) untuk semua angka data dan koordinat.
- Skala: 12, 13, 14 (isi), 16, 20, 28, 40 (angka utama).
- Tanpa huruf kapital dengan jarak lebar sebagai label.

## Bentuk dan kedalaman

- Radius: kontrol 10px, kartu 16px, panel melayang 20px, pil hanya untuk kontrol segmen dan chip filter.
- Bayangan hanya untuk elemen yang melayang di atas peta (alasan: penanda ketinggian). Kartu biasa memakai garis, bukan bayangan.
- Efek buram dan kaca: maksimal satu elemen (bilah atas melayang), dengan latar sekurang-kurangnya 88% buram agar kontras terjaga.

## Gerak

MOTION 1: transisi panel 160ms, perubahan hover dan fokus, kemunculan cluster. Semua dimatikan dengan `prefers-reduced-motion`.

## Tata letak

- Peta: kanvas penuh, bilah atas melayang, filter dan ringkasan melayang, kartu detail di kanan bawah (desktop) atau lembar bawah (mobile).
- Data, Impor, Laporan, Admin: bilah atas tetap, konten di atas permukaan netral, satu kolom utama.
- Navigasi hanya memuat layar yang ada.

## Bahasa

Bahasa Indonesia. Spesifik dan singkat. Tanpa kata pemasaran. Tanpa tanda pisah em dash.
