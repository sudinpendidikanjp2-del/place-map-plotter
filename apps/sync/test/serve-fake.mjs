// Menyalakan portal palsu untuk uji manual: node test/serve-fake.mjs [port]
import { startFakePortal } from "./fake-portal.mjs";
const p = await startFakePortal({ perKecamatan: 4 });
console.log(p.url);
setInterval(() => {}, 1 << 30);
