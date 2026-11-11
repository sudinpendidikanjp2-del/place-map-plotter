/**
 * Parser CSV bertahap (RFC 4180) yang aman untuk berkas besar.
 * Menerima potongan teks berapa pun ukurannya dan mengeluarkan baris yang sudah utuh.
 */
export class CsvParser {
  private delimiter: string | undefined;
  private headerBuffer = "";
  private field = "";
  private row: string[] = [];
  private inQuotes = false;
  private quotePending = false;
  private sawCr = false;
  private started = false;

  constructor(delimiter?: string) {
    this.delimiter = delimiter;
  }

  get detectedDelimiter(): string {
    return this.delimiter ?? ",";
  }

  push(chunk: string): string[][] {
    let text = chunk;
    if (!this.started) {
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      this.started = true;
    }
    if (this.delimiter === undefined) {
      this.headerBuffer += text;
      const nl = this.headerBuffer.indexOf("\n");
      if (nl === -1) return [];
      this.delimiter = detectDelimiter(this.headerBuffer.slice(0, nl));
      text = this.headerBuffer;
      this.headerBuffer = "";
    }
    return this.consume(text);
  }

  end(): string[][] {
    const out: string[][] = [];
    if (this.delimiter === undefined) {
      this.delimiter = detectDelimiter(this.headerBuffer);
      out.push(...this.consume(this.headerBuffer));
      this.headerBuffer = "";
    }
    if (this.quotePending) {
      this.inQuotes = false;
      this.quotePending = false;
    }
    if (this.field !== "" || this.row.length > 0) {
      this.row.push(this.field);
      out.push(this.row);
    }
    this.field = "";
    this.row = [];
    return out;
  }

  private consume(text: string): string[][] {
    const out: string[][] = [];
    const delim = this.delimiter ?? ",";
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      if (this.quotePending) {
        this.quotePending = false;
        if (ch === '"') {
          this.field += '"';
          continue;
        }
        this.inQuotes = false;
      }
      if (this.inQuotes) {
        if (ch === '"') this.quotePending = true;
        else this.field += ch;
        continue;
      }
      if (this.sawCr) {
        this.sawCr = false;
        if (ch === "\n") continue;
      }
      if (ch === '"' && this.field === "") this.inQuotes = true;
      else if (ch === delim) {
        this.row.push(this.field);
        this.field = "";
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r") this.sawCr = true;
        this.row.push(this.field);
        this.field = "";
        if (!(this.row.length === 1 && this.row[0] === "")) out.push(this.row);
        this.row = [];
      } else this.field += ch;
    }
    return out;
  }
}

export function detectDelimiter(headerLine: string): string {
  const candidates = [",", ";", "\t"];
  let best = ",";
  let bestCount = -1;
  for (const c of candidates) {
    let count = 0;
    let q = false;
    for (const ch of headerLine) {
      if (ch === '"') q = !q;
      else if (!q && ch === c) count++;
    }
    if (count > bestCount) {
      best = c;
      bestCount = count;
    }
  }
  return best;
}

export function parseCsv(text: string): string[][] {
  const p = new CsvParser();
  return [...p.push(text), ...p.end()];
}

export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  // Mencegah injeksi rumus saat dibuka di aplikasi spreadsheet.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s) ? `'${s}` : s;
  return /[",;\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsvLine(values: unknown[]): string {
  return values.map(csvEscape).join(",");
}
