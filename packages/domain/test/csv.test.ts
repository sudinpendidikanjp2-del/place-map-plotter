import { test } from "node:test";
import assert from "node:assert/strict";
import { CsvParser, parseCsv, csvEscape, detectDelimiter } from "../src/csv.ts";

test("mengurai kutip, koma, dan baris baru di dalam sel", () => {
  const rows = parseCsv('a,b,c\r\n"x, y","He said ""hi""","l1\nl2"\r\n');
  assert.deepEqual(rows, [["a", "b", "c"], ["x, y", 'He said "hi"', "l1\nl2"]]);
});

test("mendeteksi pemisah titik koma dan tab", () => {
  assert.equal(detectDelimiter("a;b;c"), ";");
  assert.equal(detectDelimiter("a\tb\tc"), "\t");
  assert.equal(detectDelimiter('"a,b";c'), ";");
});

test("membuang BOM dan baris kosong", () => {
  assert.deepEqual(parseCsv("﻿a,b\n\n1,2\n"), [["a", "b"], ["1", "2"]]);
});

test("hasil sama untuk potongan sekecil satu karakter", () => {
  const text = 'n;v\n"a;b";1\n"q""r";2\nlast;3';
  const p = new CsvParser();
  const rows: string[][] = [];
  for (const ch of text) rows.push(...p.push(ch));
  rows.push(...p.end());
  assert.deepEqual(rows, parseCsv(text));
  assert.equal(rows.length, 4);
});

test("CRLF yang terbelah antar potongan tidak menghasilkan baris kosong", () => {
  const p = new CsvParser(",");
  const rows = [...p.push("a,b\r"), ...p.push("\n1,2\r"), ...p.push("\n"), ...p.end()];
  assert.deepEqual(rows, [["a", "b"], ["1", "2"]]);
});

test("csvEscape mengutip dan menetralkan rumus", () => {
  assert.equal(csvEscape('a,"b"'), '"a,""b"""');
  assert.equal(csvEscape("=SUM(A1)"), "'=SUM(A1)");
  assert.equal(csvEscape("-6.2"), "-6.2");
  assert.equal(csvEscape(null), "");
});
