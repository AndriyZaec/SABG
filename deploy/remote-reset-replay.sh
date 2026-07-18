#!/bin/sh
set -eu

fail() {
  printf 'Reset failed: %s\n' "$*" >&2
  exit 1
}

deploy_path=${1:-}
fixture_id=${2:-}
confirmation=${3:-}

case "$deploy_path" in
  /*) ;;
  *) fail "deploy path must be absolute" ;;
esac
case "$fixture_id" in
  18179764|18241006) ;;
  *) fail "fixture is not allowlisted" ;;
esac
[ "$confirmation" = "RESET $fixture_id" ] || fail "confirmation must exactly match RESET $fixture_id"
[ -f "$deploy_path/compose.yml" ] || fail "event stack is not installed"
[ -f "$deploy_path/.env" ] || fail "deployment metadata is missing"
command -v docker >/dev/null 2>&1 || fail "docker is not installed"
command -v flock >/dev/null 2>&1 || fail "flock is not installed"

exec 9>"$deploy_path/.operation.lock"
flock -n 9 || fail "another event operation is running"

compose() {
  docker compose --project-directory "$deploy_path" -f "$deploy_path/compose.yml" "$@"
}

current_source=
while IFS='=' read -r key value; do
  if [ "$key" = GAME_SOURCE ]; then
    current_source=$value
    break
  fi
done < "$deploy_path/deploy/app.env"
[ "$current_source" = replay ] || fail "replay reset requires GAME_SOURCE=replay"

image=
revision=
current_fixture=
while IFS='=' read -r key value; do
  case "$key" in
    SABG_IMAGE) image=$value ;;
    SABG_VCS_REF) revision=$value ;;
    GATEWAY_REPLAY_FIXTURE_ID) current_fixture=$value ;;
  esac
done < "$deploy_path/.env"
case "$image" in
  ghcr.io/*@sha256:*) ;;
  *) fail "deployed image is not an immutable GHCR digest" ;;
esac
digest=${image##*@sha256:}
case "$digest" in
  *[!0-9a-f]*|'') fail "deployed image digest is invalid" ;;
esac
[ "${#digest}" -eq 64 ] || fail "deployed image digest must contain 64 characters"
case "$revision" in
  *[!0-9a-f]*|'') fail "deployed revision is invalid" ;;
esac
[ "${#revision}" -eq 40 ] || fail "deployed revision must contain 40 characters"
case "$current_fixture" in
  18179764|18241006) ;;
  *) fail "deployed fixture is not allowlisted" ;;
esac

compose stop --timeout 60 app
if ! compose run --rm --no-deps app node dist/db/seeds/reset-replay.js \
  "$current_fixture" --force --confirm-database=postgres:5432/arena; then
  fail "guarded reset refused; app remains stopped for investigation"
fi
if [ "$fixture_id" != "$current_fixture" ] && ! compose run --rm --no-deps app \
  node dist/db/seeds/reset-replay.js "$fixture_id" --force --confirm-database=postgres:5432/arena; then
  fail "target fixture reset refused; app remains stopped for investigation"
fi

umask 077
cp "$deploy_path/.env" "$deploy_path/.env.before-reset"
reset_succeeded=false
cleanup() {
  exit_code=$?
  set +e
  if [ "$reset_succeeded" = false ]; then
    compose stop --timeout 60 app >/dev/null 2>&1
    mv "$deploy_path/.env.before-reset" "$deploy_path/.env"
    printf 'Restart failed; previous deployment metadata restored and app stopped.\n' >&2
  else
    rm -f "$deploy_path/.env.before-reset"
  fi
  exit "$exit_code"
}
trap cleanup EXIT HUP INT TERM
{
  printf 'SABG_IMAGE=%s\n' "$image"
  printf 'SABG_PLATFORM=linux/amd64\n'
  printf 'SABG_VCS_REF=%s\n' "$revision"
  printf 'GATEWAY_REPLAY_FIXTURE_ID=%s\n' "$fixture_id"
} > "$deploy_path/.env.tmp"
mv "$deploy_path/.env.tmp" "$deploy_path/.env"

compose up -d --wait --wait-timeout 180 app caddy
compose exec -T app node -e \
  "fetch('http://127.0.0.1:4000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))" \
  || fail "application health check failed after reset"
reset_succeeded=true
printf 'Reset fixture %s and restarted revision %s\n' "$fixture_id" "$revision"
