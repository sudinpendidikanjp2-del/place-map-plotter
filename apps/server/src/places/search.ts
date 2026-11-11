import { HttpError } from "../http/errors.ts";

export interface PlaceResult {
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
}

interface PlacesResponse {
  places?: { displayName?: { text?: string }; formattedAddress?: string; location?: { latitude?: number; longitude?: number } }[];
}

/**
 * Mencari tempat berdasarkan nama lewat Google Places (New) Text Search. Dipanggil dari server agar kunci tidak
 * terlihat di peramban dan kuota bisa dibatasi per pengguna.
 */
export async function searchPlaces(opts: { key: string | null; endpoint: string; query: string; fetchImpl?: typeof fetch }): Promise<PlaceResult[]> {
  if (!opts.key) throw new HttpError(503, "not_configured", "Pencarian tempat belum tersedia: GOOGLE_SERVER_KEY belum diatur di server.");
  const q = opts.query.trim();
  if (q.length < 3) return [];
  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(opts.endpoint, {
      method: "POST",
      signal: AbortSignal.timeout(8000),
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": opts.key,
        "x-goog-fieldmask": "places.displayName,places.formattedAddress,places.location",
      },
      body: JSON.stringify({ textQuery: q, languageCode: "id", regionCode: "ID", maxResultCount: 6 }),
    });
  } catch {
    throw new HttpError(502, "upstream", "Layanan pencarian tempat tidak dapat dihubungi. Coba lagi sebentar lagi.");
  }
  if (!res.ok) {
    throw new HttpError(502, "upstream", res.status === 403 || res.status === 400 ? "Google menolak permintaan. Pastikan Places API (New) aktif untuk kunci server." : "Layanan pencarian tempat sedang bermasalah.");
  }
  const body = (await res.json()) as PlacesResponse;
  const out: PlaceResult[] = [];
  for (const p of body.places ?? []) {
    const lat = p.location?.latitude;
    const lng = p.location?.longitude;
    if (typeof lat === "number" && typeof lng === "number" && p.displayName?.text) {
      out.push({ name: p.displayName.text, address: p.formattedAddress ?? null, latitude: lat, longitude: lng });
    }
  }
  return out;
}
