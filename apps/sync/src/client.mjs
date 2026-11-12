const isHtml = (text) => /^\s*(<!doctype html|<html|<!--)/i.test(text);

/** Ringkas jawaban error supaya log tidak penuh HTML (mis. halaman error Cloudflare) dan memberi petunjuk. */
export function describeFailure({ method = "GET", path, status, headers = new Headers(), text = "", body = null, base = "" }) {
  const head = `${method} ${path} gagal: HTTP ${status}`;
  if (body?.error?.message) return `${head} ${body.error.message}`;
  if (isHtml(text)) {
    const cloudflare = /cloudflare/i.test(headers.get?.("server") ?? "") || /cf-ray|cloudflare/i.test(text);
    const hint = status >= 502 && status <= 504
      ? `${cloudflare ? "Cloudflare tidak bisa menjangkau server Peta Sekolah" : "Server atau proxy di depannya tidak menjawab"}. Periksa bahwa aplikasi berjalan (docker compose ps). Di dalam Docker compose, pakai PETA_URL=http://app:3000 agar tidak lewat internet${base && !/\/\/(app|localhost|127\.)/.test(base) ? ` (sekarang: ${base})` : ""}.`
      : "Jawabannya halaman HTML, bukan API Peta Sekolah. Periksa PETA_URL.";
    return `${head}. ${hint}`;
  }
  return `${head} ${text.slice(0, 200)}`.trim();
}

/** Klien API Peta Sekolah dengan token API. Token hanya boleh dipakai untuk impor dan riwayat sinkronisasi. */
export class PetaClient {
  constructor(baseUrl, token) {
    this.base = baseUrl.replace(/\/$/, "");
    this.token = token;
  }

  async #request(path, init = {}) {
    let res;
    try {
      res = await fetch(`${this.base}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${this.token}`, ...(init.json !== undefined ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
        body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
      });
    } catch (err) {
      const code = err?.cause?.code ?? err?.code ?? "";
      throw new Error(`${init.method ?? "GET"} ${path} tidak terhubung ke ${this.base}${code ? ` (${code})` : ""}. Periksa PETA_URL dan bahwa aplikasi berjalan.`);
    }
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* tubuh bukan JSON */
    }
    if (!res.ok) throw new Error(describeFailure({ method: init.method, path, status: res.status, headers: res.headers, text, body, base: this.base }));
    return body;
  }

  listRuns(source) {
    return this.#request(`/api/sync/runs?source=${encodeURIComponent(source)}`);
  }
  startRun(source, scope) {
    return this.#request("/api/sync/runs", { method: "POST", json: { source, scope } });
  }
  claim(source, scope) {
    return this.#request("/api/sync/claim", { method: "POST", json: { source, scope } });
  }
  finishRun(id, result) {
    return this.#request(`/api/sync/runs/${id}`, { method: "PATCH", json: result });
  }
  async importCsv(filename, csv) {
    const batch = await this.#request("/api/imports", { method: "POST", json: { filename, defaultKind: "sekolah" } });
    return this.#request(`/api/imports/${batch.id}/file`, { method: "PUT", body: csv, headers: { "content-type": "text/csv" } });
  }
}
