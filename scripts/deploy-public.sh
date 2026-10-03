#!/bin/bash
set -euo pipefail

# The dedicated SSH key can deploy GitHub master or verify the running revision.
request=${SSH_ORIGINAL_COMMAND:-${1:-}}
revision=${request#verify }
if [[ ! $revision =~ ^[a-f0-9]{40}$ ]]; then
  echo 'Expected a full Git commit ID.' >&2
  exit 1
fi
exec 9>/run/lock/feedfold-deploy.lock
flock 9
if [[ $request == "verify $revision" ]]; then
  if [[ $(cat /srv/feedfold/revision) != "$revision" ]]; then
    echo 'The running revision does not match the requested verification.' >&2
    exit 1
  fi
  curl --fail --silent --show-error --retry 5 --retry-all-errors --dump-header /dev/stderr https://feedfold.com/health | jq --exit-status '.status == "ok"'
  curl --fail --silent --show-error --dump-header /dev/stderr https://feedfold.com/api/auth/config | jq --exit-status '.registrationMode == "invite"'
  exit 0
fi
cd /srv/feedfold/app
git fetch --depth=1 origin master
if [[ $(git rev-parse origin/master) != "$revision" ]]; then
  echo 'Refusing to deploy a revision that is no longer GitHub master.' >&2
  exit 1
fi

gzip -dc | docker load
image="feedfold:$revision"
if [[ $(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image") != "$revision" ]]; then
  echo 'The image does not match the requested revision.' >&2
  exit 1
fi

previous=$(cat /srv/feedfold/revision 2>/dev/null || true)
compose=(docker compose --project-name feedfold --env-file /etc/feedfold/feedfold.env)
if [[ -n $previous ]]; then
  # A migration can commit before startup fails. Roll back the database too.
  # This private, short-lived copy retains YouTube tokens unlike daily backups.
  umask 077
  rollback=$(mktemp -d /srv/feedfold/rollback-XXXXXX)
  volume=$(docker volume inspect feedfold_feedfold-data --format '{{.Mountpoint}}')
  "${compose[@]}" stop
  if ! sqlite3 "$volume/feedfold.db" ".backup '$rollback/feedfold.db'" || \
     [[ $(sqlite3 "$rollback/feedfold.db" 'PRAGMA integrity_check;') != ok ]]; then
    "${compose[@]}" up --detach --no-build --wait
    rm -rf -- "$rollback"
    echo 'Deployment stopped: rollback database failed its integrity check.' >&2
    exit 1
  fi
fi
git checkout --detach "$revision"
export FEEDFOLD_IMAGE="$image"
if ! "${compose[@]}" up --detach --no-build --wait --wait-timeout 120; then
  if [[ -n $previous ]]; then
    "${compose[@]}" stop
    cp "$rollback/feedfold.db" "$volume/feedfold.db"
    chown 1000:1000 "$volume/feedfold.db"
    rm -f "$volume/feedfold.db-wal" "$volume/feedfold.db-shm"
    git checkout --detach "$previous"
    FEEDFOLD_IMAGE="feedfold:$previous" "${compose[@]}" up --detach --no-build --wait
    rm -rf -- "$rollback"
  fi
  exit 1
fi
curl --fail --silent http://127.0.0.1:3000/health
printf '%s\n' "$revision" > /srv/feedfold/revision
if [[ -n $previous ]]; then rm -rf -- "$rollback"; fi
install -m 700 scripts/deploy-public.sh /usr/local/sbin/feedfold-deploy
install -m 700 scripts/backup-public.sh /usr/local/sbin/feedfold-backup
# Keep the running image and the immediately preceding image for rollback.
for old_image in $(docker images feedfold --format '{{.Tag}}'); do
  if [[ $old_image != "$revision" && $old_image != "$previous" ]]; then
    docker image rm "feedfold:$old_image"
  fi
done
