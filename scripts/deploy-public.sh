#!/bin/bash
set -euo pipefail

# The dedicated SSH key can only submit an image for the current GitHub master.
revision=${SSH_ORIGINAL_COMMAND:-${1:-}}
if [[ ! $revision =~ ^[a-f0-9]{40}$ ]]; then
  echo 'Expected a full Git commit ID.' >&2
  exit 1
fi
exec 9>/run/lock/feedfold-deploy.lock
flock 9
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
if [[ -n $previous ]]; then
  /usr/local/sbin/feedfold-backup
fi
git checkout --detach "$revision"
export FEEDFOLD_IMAGE="$image"
compose=(docker compose --project-name feedfold --env-file /etc/feedfold/feedfold.env)
if ! "${compose[@]}" up --detach --no-build --wait --wait-timeout 120; then
  if [[ -n $previous ]]; then
    git checkout --detach "$previous"
    FEEDFOLD_IMAGE="feedfold:$previous" "${compose[@]}" up --detach --no-build --wait
  fi
  exit 1
fi
curl --fail --silent http://127.0.0.1:3000/health
printf '%s\n' "$revision" > /srv/feedfold/revision
install -m 700 scripts/deploy-public.sh /usr/local/sbin/feedfold-deploy
install -m 700 scripts/backup-public.sh /usr/local/sbin/feedfold-backup
# Keep the running image and the immediately preceding image for rollback.
for old_image in $(docker images feedfold --format '{{.Tag}}'); do
  if [[ $old_image != "$revision" && $old_image != "$previous" ]]; then
    docker image rm "feedfold:$old_image"
  fi
done
