// Portal Dapodik palsu untuk uji: halaman kecil yang memanggil API-nya sendiri, seperti SPA aslinya.
import { createServer } from "node:http";

export function startFakePortal({ perKecamatan = 3, behavior = {} } = {}) {
  const kecamatan = [
    { kode_kecamatan: "016001", kecamatan: "Kec. Senen" },
    { kode_kecamatan: "016002", kecamatan: "Kec. Kemayoran" },
  ];
  const schoolsOf = (kec) => Array.from({ length: perKecamatan }, (_, i) => ({ npsn: `${kec.slice(-2)}00${String(i + 1).padStart(4, "0")}`.padStart(8, "2"), nama: `SD UJI ${kec}-${i + 1}` }));
  const page = (api) => `<!doctype html><html><body><p>portal uji</p><script>fetch(${JSON.stringify(api)}).then(r=>r.text()).then(t=>{document.body.dataset.done='1'})</script></body></html>`;
  const calls = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    calls.push(url.pathname + url.search);
    const json = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const html = (api) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(page(api));
    };
    if (behavior.denyAll) return json(403, { message: "forbidden" });
    const parts = url.pathname.split("/").filter(Boolean);
    if (url.pathname === "/") return html("/api/ping");
    if (url.pathname === "/api/ping") return json(200, {});
    if (parts[0] === "progres" && parts.length === 3) return html(`/api/progress-pengiriman/kecamatan?kode_kabupaten=${parts[2]}`);
    if (parts[0] === "progres" && parts.length === 4) return html(`/api/progress-pengiriman/kecamatan/school?kode_kecamatan=${parts[3]}`);
    if (url.pathname === "/sekolah") return html(`/api/detail-sekolah?npsn=${url.searchParams.get("npsn")}`);
    if (url.pathname === "/api/progress-pengiriman/kecamatan") return json(200, { data: kecamatan });
    if (url.pathname === "/api/progress-pengiriman/kecamatan/school") {
      const kode = url.searchParams.get("kode_kecamatan");
      return json(200, { data: schoolsOf(kode), ...(behavior.pages ? { last_page: behavior.pages } : {}) });
    }
    if (url.pathname === "/api/detail-sekolah") {
      const npsn = url.searchParams.get("npsn");
      if (behavior.failNpsn === npsn) return json(429, { message: "too many" });
      const kec = kecamatan.find((k) => schoolsOf(k.kode_kecamatan).some((s) => s.npsn === npsn));
      const idx = Number(npsn.slice(-1));
      return json(200, { data: [
        { npsn, nama: `SD UJI ${npsn}`, bentuk_pendidikan: idx % 2 ? "SD" : "SMP", status_sekolah: "Negeri", alamat_jalan: "Jl. Uji No. 1", lintang: idx === 2 ? 0 : idx === 4 ? 40.7 : -6.17 - idx * 0.001, bujur: idx === 2 ? 0 : idx === 4 ? -74 : 106.84 + idx * 0.001, tlg_sk_pendirian_sekolah: "1990-05-01", nama_kepsek: "Kepala Uji", jum_ptk: 20, ruang_kelas: 12, kelas_berat: 1, semester: "20251", kecamatan: kec?.kecamatan ?? "Kec. Senen", kabupaten: "Kota Adm. Jakarta Pusat", provinsi: "Prov. D.K.I. Jakarta", pd: 100 * idx, jum_guru: 5 + idx, jum_tendik: 2, rombel: 4 },
        { npsn, nama: `SD UJI ${npsn}`, bentuk_pendidikan: "SD", semester: "20242", rombel: 0 },
      ] });
    }
    json(404, { message: "tidak ada" });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}`, calls, close: () => new Promise((r) => server.close(r)), schoolsOf, behavior })));
}
