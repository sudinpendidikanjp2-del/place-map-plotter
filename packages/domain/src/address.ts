export interface ParsedAddress {
  district: string | null;
  city: string | null;
  province: string | null;
}

const PROVINCES: Record<string, string> = {
  aceh: "Aceh",
  "sumatera utara": "Sumatera Utara", sumut: "Sumatera Utara",
  "sumatera barat": "Sumatera Barat", sumbar: "Sumatera Barat",
  riau: "Riau", jambi: "Jambi",
  "sumatera selatan": "Sumatera Selatan", sumsel: "Sumatera Selatan",
  bengkulu: "Bengkulu", lampung: "Lampung",
  "bangka belitung": "Kepulauan Bangka Belitung", "kepulauan bangka belitung": "Kepulauan Bangka Belitung",
  "kepulauan riau": "Kepulauan Riau", kepri: "Kepulauan Riau",
  "dki jakarta": "DKI Jakarta", jakarta: "DKI Jakarta",
  "jawa barat": "Jawa Barat", jabar: "Jawa Barat",
  "jawa tengah": "Jawa Tengah", jateng: "Jawa Tengah",
  "di yogyakarta": "DI Yogyakarta", yogyakarta: "DI Yogyakarta", jogja: "DI Yogyakarta", diy: "DI Yogyakarta",
  "jawa timur": "Jawa Timur", jatim: "Jawa Timur",
  banten: "Banten", bali: "Bali",
  "nusa tenggara barat": "Nusa Tenggara Barat", ntb: "Nusa Tenggara Barat",
  "nusa tenggara timur": "Nusa Tenggara Timur", ntt: "Nusa Tenggara Timur",
  "kalimantan barat": "Kalimantan Barat", kalbar: "Kalimantan Barat",
  "kalimantan tengah": "Kalimantan Tengah", kalteng: "Kalimantan Tengah",
  "kalimantan selatan": "Kalimantan Selatan", kalsel: "Kalimantan Selatan",
  "kalimantan timur": "Kalimantan Timur", kaltim: "Kalimantan Timur",
  "kalimantan utara": "Kalimantan Utara", kaltara: "Kalimantan Utara",
  "sulawesi utara": "Sulawesi Utara", sulut: "Sulawesi Utara",
  "sulawesi tengah": "Sulawesi Tengah", sulteng: "Sulawesi Tengah",
  "sulawesi selatan": "Sulawesi Selatan", sulsel: "Sulawesi Selatan",
  "sulawesi tenggara": "Sulawesi Tenggara", sultra: "Sulawesi Tenggara",
  gorontalo: "Gorontalo",
  "sulawesi barat": "Sulawesi Barat", sulbar: "Sulawesi Barat",
  maluku: "Maluku", "maluku utara": "Maluku Utara",
  papua: "Papua", "papua barat": "Papua Barat", "papua barat daya": "Papua Barat Daya",
  "papua selatan": "Papua Selatan", "papua tengah": "Papua Tengah", "papua pegunungan": "Papua Pegunungan",
};

// Nama terpanjang lebih dulu agar "Papua Barat Daya" menang atas "Papua".
const PROVINCE_KEYS = Object.keys(PROVINCES).sort((a, b) => b.length - a.length);

function titleCase(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Mengurai provinsi, kota/kabupaten, dan kecamatan dari alamat berbahasa Indonesia. Hasil kosong berupa null. */
export function parseAddress(address: string | null | undefined): ParsedAddress {
  const result: ParsedAddress = { district: null, city: null, province: null };
  if (!address) return result;

  const district = address.match(/\b(?:Kec\.|Kecamatan)\s+([A-Za-z][A-Za-z\s-]*?)(?=,|$|\d)/i);
  if (district?.[1]) result.district = titleCase(district[1]);

  const city = address.match(/\b(Kota|Kabupaten|Kab\.)\s+([A-Za-z][A-Za-z\s-]*?)(?=,|$|\d)/i);
  if (city?.[1] && city[2]) {
    const prefix = city[1].toLowerCase() === "kota" ? "Kota" : "Kabupaten";
    result.city = `${prefix} ${titleCase(city[2])}`;
  } else {
    const jakarta = address.match(/\bJakarta\s+(Pusat|Selatan|Barat|Timur|Utara)\b/i);
    if (jakarta?.[1]) result.city = `Jakarta ${titleCase(jakarta[1])}`;
  }

  const lower = address.toLowerCase();
  for (const key of PROVINCE_KEYS) {
    if (new RegExp(`(?<![a-z])${escapeRe(key)}(?![a-z])`).test(lower)) {
      result.province = PROVINCES[key] ?? null;
      break;
    }
  }
  return result;
}
