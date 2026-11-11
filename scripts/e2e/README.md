# Uji peramban

Skrip Playwright untuk klik-tembus, keyboard, dan peta. Playwright tidak menjadi dependensi proyek, pasang terpisah (`npm i -g playwright`).

Butuh server yang sudah berjalan dengan akun admin dan sedikit data uji (`node scripts/seed.ts 3000 --reset`).
Untuk uji peta, jalankan server kedua dengan `GOOGLE_MAPS_KEY=uji GOOGLE_MAP_ID=uji PORT=3100`. `google-maps-mock.js` menggantikan Google Maps, jadi tidak perlu kunci asli.

```bash
E2E_BASE=http://localhost:3000 E2E_MAP_BASE=http://localhost:3100 E2E_OUT=/tmp/hasil node scripts/e2e/klik-tembus.cjs
node scripts/e2e/keyboard.cjs
node scripts/e2e/peta.cjs
```

Variabel: `E2E_EMAIL`, `E2E_PASSWORD`, `E2E_OUT` (folder tangkapan layar).
Uji ini tidak menggantikan pemeriksaan dengan Google Maps asli.
