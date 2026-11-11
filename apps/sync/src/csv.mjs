export function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v).replace(/\r?\n/g, " ");
  return /[",;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns, rows) {
  return `${[columns, ...rows.map((r) => columns.map((c) => r[c]))].map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
