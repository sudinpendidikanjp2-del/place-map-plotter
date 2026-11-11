#!/usr/bin/env bash
# Cadangan harian basis data. Pasang di cron: 15 2 * * * /opt/peta/deploy/backup.sh
# Hasil disimpan di BACKUP_DIR dan, bila BACKUP_REMOTE diisi, disalin ke luar VPS (rsync/scp).
set -euo pipefail
cd "$(dirname "$0")"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/peta}"
KEEP_DAYS="${KEEP_DAYS:-14}"
mkdir -p "$BACKUP_DIR"
file="$BACKUP_DIR/peta-$(date +%Y%m%d-%H%M%S).dump"
docker compose exec -T db pg_dump -U peta -d peta --format=custom --compress=6 > "$file.partial"
mv "$file.partial" "$file"
find "$BACKUP_DIR" -name 'peta-*.dump' -mtime +"$KEEP_DAYS" -delete
if [ -n "${BACKUP_REMOTE:-}" ]; then rsync -a "$BACKUP_DIR/" "$BACKUP_REMOTE/"; fi
echo "Cadangan selesai: $file ($(du -h "$file" | cut -f1))"
