#!/bin/bash
set -euo pipefail
umask 077

# Decrypt on the recovery host. Never copy plaintext configuration to CI.
if [[ $# -lt 3 || $# -gt 4 ]]; then
  echo 'Usage: restore-isolated.sh <backup.tar.age> <age-identity> <new-directory> [youtube-secrets.json]' >&2
  exit 1
fi
archive=$(realpath "$1")
identity=$(realpath "$2")
destination=$3
youtube=${4:-}
mkdir -m 700 -- "$destination"
destination=$(realpath "$destination")
container=
trap 'if [[ -n $container ]]; then docker rm --force "$container" >/dev/null; fi' EXIT

age --decrypt --identity "$identity" "$archive" > "$destination/recovery.tar"
# Extract only the recovery payload, never arbitrary archive paths.
tar -xf "$destination/recovery.tar" -C "$destination" \
  feedfold.db.gz feedfold.env revision image-id image.tar.gz
rm "$destination/recovery.tar"
mkdir -m 700 "$destination/data"
gzip -dc "$destination/feedfold.db.gz" > "$destination/data/feedfold.db"
if [[ $(sqlite3 "$destination/data/feedfold.db" 'PRAGMA integrity_check;') != ok ]] || \
   [[ -n $(sqlite3 "$destination/data/feedfold.db" 'PRAGMA foreign_key_check;') ]]; then
  echo 'Recovery stopped: database checks failed.' >&2
  exit 1
fi
revision=$(cat "$destination/revision")
[[ $revision =~ ^[a-f0-9]{40}$ ]]
gzip -dc "$destination/image.tar.gz" | docker load >/dev/null
image="feedfold:$revision"
[[ $(docker image inspect --format '{{.Id}}' "$image") == "$(cat "$destination/image-id")" ]]
[[ $(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image") == "$revision" ]]

secrets=(--env FEEDFOLD_YOUTUBE_SECRETS_FILE=)
if [[ -n $youtube ]]; then
  secrets=(--mount "type=bind,src=$(realpath "$youtube"),dst=/run/secrets/youtube,readonly"
    --env FEEDFOLD_YOUTUBE_SECRETS_FILE=/run/secrets/youtube)
fi
chown -R 1000:1000 "$destination/data"
chmod 600 "$destination/data/feedfold.db"
# No published ports and no network: polling and OAuth cannot reach real services.
container=$(docker run --detach --network none --read-only --init \
  --cap-drop ALL --security-opt no-new-privileges:true \
  --tmpfs /tmp:rw,noexec,nosuid,size=256m \
  --env-file "$destination/feedfold.env" \
  --env DATABASE_PATH=/data/feedfold.db --env HOST=127.0.0.1 --env PORT=3000 \
  "${secrets[@]}" --mount "type=bind,src=$destination/data,dst=/data" "$image")
for attempt in {1..60}; do
  if docker exec "$container" node -e \
    "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    echo "Recovered revision $revision: database checks and offline startup passed."
    echo 'YouTube connections must be authorized again; their tokens are removed from backups.'
    exit 0
  fi
  sleep 1
done
echo 'Recovery stopped: the recorded image did not become healthy.' >&2
exit 1
