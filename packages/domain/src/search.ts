/**
 * Pencarian teks yang memaafkan salah ketik dan singkatan satuan pendidikan.
 * Domain hanya menguraikan kueri. Server yang menerjemahkannya ke SQL (pg_trgm).
 */

export interface SearchToken {
  /** Bentuk yang dianggap sama, mis. "sdn" dan "sd negeri". Dicocokkan sebagai potongan teks. */
  alts: string[];
  /** Kata untuk pencocokan mirip (typo). Kosong untuk kata pendek atau mengandung angka. */
  fuzzy: string | null;
}

export interface ParsedSearch {
  /** Kueri yang sudah dirapikan (huruf kecil, spasi tunggal). */
  phrase: string;
  tokens: SearchToken[];
  /** Terisi bila kueri tepat berupa NPSN (8 digit). */
  npsn: string | null;
}

const LEVEL_WORDS = ["tk", "sd", "smp", "sma", "smk", "mi", "mts", "ma", "slb", "paud", "kb", "tpa"];
const STATUS_WORDS: Record<string, string> = { n: "negeri", s: "swasta" };

/** Singkatan penuh yang umum dalam nama satuan pendidikan, mis. sdn = sd negeri. */
const ABBREVIATIONS: Record<string, string> = {};
for (const level of LEVEL_WORDS) {
  for (const [short, word] of Object.entries(STATUS_WORDS)) ABBREVIATIONS[`${level}${short}`] = `${level} ${word}`;
}
Object.assign(ABBREVIATIONS, { sdit: "sd islam terpadu", smpit: "smp islam terpadu", smait: "sma islam terpadu", tkit: "tk islam terpadu", ra: "raudhatul athfal" });

const MAX_TOKENS = 6;
const MIN_FUZZY_LENGTH = 4;

export function parseSearch(input: string): ParsedSearch {
  const phrase = input.toLowerCase().replace(/\s+/g, " ").trim();
  const words = phrase.split(" ").filter(Boolean);
  const tokens: SearchToken[] = [];

  for (let i = 0; i < words.length && tokens.length < MAX_TOKENS; i++) {
    const w = words[i]!;
    const next = words[i + 1];
    // "sd negeri" dan "sdn" menunjuk nama yang sama, jadi keduanya diterima untuk pasangan kata itu.
    if (next && LEVEL_WORDS.includes(w) && (next === "negeri" || next === "swasta")) {
      tokens.push({ alts: [`${w} ${next}`, `${w}${next === "negeri" ? "n" : "s"}`], fuzzy: null });
      i++;
      continue;
    }
    const expanded = ABBREVIATIONS[w];
    const alts = expanded ? [w, expanded] : [w];
    const fuzzy = !expanded && w.length >= MIN_FUZZY_LENGTH && !/\d/.test(w) ? w : null;
    tokens.push({ alts, fuzzy });
  }
  return { phrase, tokens, npsn: /^\d{8}$/.test(phrase) ? phrase : null };
}
