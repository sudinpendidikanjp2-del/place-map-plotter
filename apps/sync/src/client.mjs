/** Klien API Peta Sekolah dengan token API. Token hanya boleh dipakai untuk impor dan riwayat sinkronisasi. */
export class PetaClient {
  constructor(baseUrl, token) {
    this.base = baseUrl.replace(/\/$/, "");
    this.token = token;
  }

  async #request(path, init = {}) {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${this.token}`, ...(init.json !== undefined ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    });
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* tubuh bukan JSON */
    }
    if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} gagal: ${res.status} ${body?.error?.message ?? text.slice(0, 200)}`);
    return body;
  }

  listRuns(source) {
    return this.#request(`/api/sync/runs?source=${encodeURIComponent(source)}`);
  }
  startRun(source, scope) {
    return this.#request("/api/sync/runs", { method: "POST", json: { source, scope } });
  }
  finishRun(id, result) {
    return this.#request(`/api/sync/runs/${id}`, { method: "PATCH", json: result });
  }
  async importCsv(filename, csv) {
    const batch = await this.#request("/api/imports", { method: "POST", json: { filename, defaultKind: "sekolah" } });
    return this.#request(`/api/imports/${batch.id}/file`, { method: "PUT", body: csv, headers: { "content-type": "text/csv" } });
  }
}
