import { test } from "node:test";
import assert from "node:assert/strict";
import { validateLocationInput } from "../src/validation.ts";
import { mapHeaders, rowToRaw } from "../src/columns.ts";
import { parseAddress } from "../src/address.ts";

const base = { kind: "sekolah", name: "SDN 1", latitude: "-6,2", longitude: "106.8" };

test("menerima masukan valid dan memakai nilai bawaan", () => {
  const r = validateLocationInput({ ...base, students: "1.250", teachers: "40" });
  assert.ok(r.ok);
  assert.equal(r.value.latitude, -6.2);
  assert.equal(r.value.students, 1250);
  assert.equal(r.value.category, "Umum");
});

test("menolak koordinat di luar jangkauan dan nama kosong", () => {
  const r = validateLocationInput({ kind: "aset", name: " ", latitude: 95, longitude: "abc" });
  assert.ok(!r.ok);
  assert.ok(r.errors.name && r.errors.latitude && r.errors.longitude);
});

test("menolak jumlah murid negatif dan tautan foto bukan http", () => {
  const r = validateLocationInput({ ...base, students: "-3", photoUrl: "javascript:alert(1)" });
  assert.ok(!r.ok);
  assert.ok(r.errors.students && r.errors.photoUrl);
});

test("memetakan header CSV dan menyimpan kolom lain sebagai atribut", () => {
  const headers = ["Nama Sekolah", "Lat", "Lng", "Jumlah Siswa", "Akreditasi"];
  const m = mapHeaders(headers);
  assert.equal(m.name, 0);
  assert.equal(m.students, 3);
  const raw = rowToRaw(["SMPN 2", "-6.1", "106.7", "300", "A"], headers, m, { kind: "sekolah" });
  assert.deepEqual(raw.attributes, { Akreditasi: "A" });
  assert.equal(raw.kind, "sekolah");
});

test("mengurai alamat Indonesia", () => {
  const a = parseAddress("Jl. Merdeka 1, Kec. Gambir, Kota Jakarta Pusat, DKI Jakarta");
  assert.deepEqual(a, { district: "Gambir", city: "Kota Jakarta Pusat", province: "DKI Jakarta" });
  assert.equal(parseAddress("Jl. X, Papua Barat Daya").province, "Papua Barat Daya");
  assert.deepEqual(parseAddress(null), { district: null, city: null, province: null });
});
