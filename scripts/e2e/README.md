# Uji peramban

Skrip Playwright untuk klik-tembus, keyboard, dan peta. Playwright tidak menjadi dependensi proyek, pasang terpisah (`npm i -g playwright`).

Butuh server yang sudah berjalan dengan akun admin dan sedikit data uji (`node scripts/seed.ts 3000 --reset`).
Untuk uji peta dan fitur, jalankan server kedua dengan `GOOGLE_MAPS_KEY=uji GOOGLE_MAP_ID=uji GOOGLE_SERVER_KEY=uji PLACES_ENDPOINT=http://127.0.0.1:3199/places MEDIA_DIR=/tmp/media PORT=3100` (`fitur.cjs` menyalakan server Places palsu di port 3199). `google-maps-mock.js` menggantikan Google Maps, jadi tidak perlu kunci asli.

```bash
E2E_BASE=http://localhost:3000 E2E_MAP_BASE=http://localhost:3100 E2E_OUT=/tmp/hasil node scripts/e2e/klik-tembus.cjs
node scripts/e2e/keyboard.cjs
node scripts/e2e/peta.cjs
node scripts/e2e/fitur.cjs
```

Variabel: `E2E_EMAIL`, `E2E_PASSWORD`, `E2E_OUT` (folder tangkapan layar).
Uji ini tidak menggantikan pemeriksaan dengan Google Maps asli.
