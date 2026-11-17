import { test } from "node:test";
import assert from "node:assert/strict";
import { filterToParams, hasActiveFilter, parseSearch } from "../src/index.ts";

test("kueri dipecah per kata, singkatan diperluas, dan kata pendek tidak dicocokkan mirip", () => {
  const s = parseSearch("  SDN   Kemayoran 01 ");
  assert.equal(s.phrase, "sdn kemayoran 01");
  assert.deepEqual(s.tokens, [
    { alts: ["sdn", "sd negeri"], fuzzy: null },
    { alts: ["kemayoran"], fuzzy: "kemayoran" },
    { alts: ["01"], fuzzy: null },
  ]);
  assert.equal(s.npsn, null);
});

test("pasangan 'sd negeri' juga cocok dengan bentuk 'sdn'", () => {
  const s = parseSearch("smp negeri senen");
  assert.deepEqual(s.tokens[0], { alts: ["smp negeri", "smpn"], fuzzy: null });
  assert.deepEqual(s.tokens[1], { alts: ["senen"], fuzzy: "senen" });
});

test("NPSN dikenali dan jumlah kata dibatasi", () => {
  assert.equal(parseSearch("20110502").npsn, "20110502");
  assert.equal(parseSearch("a b c d e f g h").tokens.length, 6);
  assert.deepEqual(parseSearch("   ").tokens, []);
});

test("beberapa kecamatan dikirim sebagai parameter berulang", () => {
  const p = filterToParams({ province: "DKI Jakarta", districts: ["Senen", "Kemayoran"] });
  assert.deepEqual(p.getAll("district"), ["Senen", "Kemayoran"]);
  assert.equal(hasActiveFilter({ districts: ["Senen"] }), true);
  assert.equal(hasActiveFilter({ districts: [] }), false);
});
