#!/bin/bash
set -euo pipefail
umask 077
exec 8>/run/lock/feedfold-backup.lock
flock 8
mkdir -p /srv/feedfold/backups
volume=$(docker volume inspect feedfold_feedfold-data --format '{{.Mountpoint}}')
backup="/srv/feedfold/backups/feedfold-$(date -u +%Y%m%dT%H%M%SZ).db"
sqlite3 "$volume/feedfold.db" ".backup '$backup'"
if [[ $(sqlite3 "$backup" 'PRAGMA integrity_check;') != ok ]]; then
  echo 'Database backup failed its integrity check.' >&2
  exit 1
fi
gzip "$backup"
# Retain two complete backups alongside the live database on the 50 GB droplet.
mapfile -t backups < <(find /srv/feedfold/backups -maxdepth 1 -name 'feedfold-*.db.gz' | sort -r)
for old_backup in "${backups[@]:2}"; do
  rm -- "$old_backup"
done
