#!/usr/bin/env bash
# Memulihkan cadangan ke basis data. Pemakaian: ./restore.sh /var/backups/peta/peta-XXXX.dump
# PERINGATAN: menimpa seluruh isi basis data saat ini. Uji dulu di VPS cadangan.
set -euo pipefail
cd "$(dirname "$0")"
[ -f "${1:-}" ] || { echo "Pemakaian: $0 berkas.dump" >&2; exit 1; }
read -r -p "Ini menghapus data saat ini dan menggantinya dengan $1. Ketik 'pulihkan' untuk lanjut: " ok
[ "$ok" = "pulihkan" ] || { echo "Dibatalkan."; exit 1; }
docker compose stop app
docker compose exec -T db psql -U peta -d postgres -c "drop database if exists peta with (force)" -c "create database peta"
docker compose exec -T db pg_restore -U peta -d peta --no-owner < "$1"
docker compose start app
echo "Pemulihan selesai."
