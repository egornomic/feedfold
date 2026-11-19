#!/bin/bash
set -euo pipefail
umask 077
# Keep the database, configuration and image tied to one completed deployment.
exec 9>/run/lock/feedfold-deploy.lock
flock --shared 9
exec 8>/run/lock/feedfold-backup.lock
flock 8
mkdir -p /srv/feedfold/backups
# Enforce the age limit even if this run cannot create a new snapshot.
find /srv/feedfold/backups -maxdepth 1 -name 'feedfold-*.db.gz' -mmin +8639 -delete
staging=$(mktemp -d /srv/feedfold/backups/.staging-XXXXXX)
trap 'rm -rf -- "$staging"' EXIT
trap 'exit 1' HUP INT TERM
volume=$(docker volume inspect feedfold_feedfold-data --format '{{.Mountpoint}}')
database="$staging/feedfold.db"
sqlite3 -batch -bail -cmd '.timeout 10000' "$volume/feedfold.db" ".backup '$database'"
sqlite3 -batch -bail "$database" < /srv/feedfold/app/scripts/sanitize-youtube-backup.sql > /dev/null
checks=$(sqlite3 -batch -bail "$database" 'PRAGMA integrity_check; PRAGMA foreign_key_check;')
if [[ $checks != ok ]]; then
  echo 'Database backup failed its integrity check.' >&2
  exit 1
fi
gzip "$database"
backup="/srv/feedfold/backups/feedfold-$(date -u +%Y%m%dT%H%M%S%NZ).db.gz"
mv -- "$database.gz" "$backup"

# The timer and export can run on the same day. Keep one snapshot per day.
mapfile -t backups < <(find /srv/feedfold/backups -maxdepth 1 -name 'feedfold-*.db.gz' | sort -r)
last_day=
kept=0
for snapshot in "${backups[@]}"; do
  day=${snapshot##*/feedfold-}
  day=${day%%T*}
  if [[ $day != "$last_day" ]] && (( kept < 2 )); then
    last_day=$day
    kept=$((kept + 1))
  else
    rm -- "$snapshot"
  fi
done

if [[ ${1:-} == export ]]; then
  cp /srv/feedfold/revision "$staging/revision"
  revision=$(cat "$staging/revision")
  image="feedfold:$revision"
  docker image inspect --format '{{.Id}}' "$image" > "$staging/image-id"
  docker save "$image" | gzip -1 > "$staging/image.tar.gz"
  ln -- "$backup" "$staging/feedfold.db.gz"
  cp /etc/feedfold/feedfold.env "$staging/feedfold.env"
  tar -cf - -C "$staging" feedfold.db.gz feedfold.env revision image-id image.tar.gz \
    | age --recipients-file /etc/feedfold/backup-recipient.txt
fi
