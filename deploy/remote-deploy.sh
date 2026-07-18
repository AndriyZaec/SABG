#!/bin/sh
set -eu

fail() {
  printf 'Deploy failed: %s\n' "$*" >&2
  exit 1
}

deploy_path=${1:-}
image=${2:-}
revision=${3:-}
archive=${4:-}

case "$deploy_path" in
  /*) ;;
  *) fail "deploy path must be absolute" ;;
esac
case "$image" in
  ghcr.io/*@sha256:*) ;;
  *) fail "image must be an immutable GHCR digest" ;;
esac
digest=${image##*@sha256:}
case "$digest" in
  *[!0-9a-f]*|'') fail "image digest must be lowercase hexadecimal" ;;
esac
[ "${#digest}" -eq 64 ] || fail "image digest must contain 64 characters"
case "$revision" in
  *[!0-9a-f]*|'') fail "revision must be a lowercase hexadecimal commit SHA" ;;
esac
[ "${#revision}" -eq 40 ] || fail "revision must contain 40 characters"
[ -f "$archive" ] || fail "deployment archive does not exist"
command -v docker >/dev/null 2>&1 || fail "docker is not installed"
command -v flock >/dev/null 2>&1 || fail "flock is not installed"

mkdir -p "$deploy_path"
exec 9>"$deploy_path/.operation.lock"
flock -n 9 || fail "another event operation is running"

compose() {
  docker compose --project-directory "$deploy_path" -f "$deploy_path/compose.yml" "$@"
}

compose_with_live_profile() {
  docker compose --profile live --project-directory "$deploy_path" -f "$deploy_path/compose.yml" "$@"
}

read_staged_caddy_image() {
  in_caddy=false
  while IFS= read -r line; do
    case "$line" in
      '  caddy:') in_caddy=true ;;
      '    image: '* )
        if [ "$in_caddy" = true ]; then
          printf '%s\n' "${line#    image: }"
          return 0
        fi
        ;;
      '  '[![:space:]]*:)
        if [ "$in_caddy" = true ]; then
          return 1
        fi
        ;;
    esac
  done < "$staging_dir/compose.yml"
  return 1
}

inspect_deploy_arena() {
  inspected_fixture=$1
  compose up -d --wait --wait-timeout 60 postgres \
    || fail "could not start PostgreSQL to verify current arena status"
  # Variables in the command string expand inside the container's shell.
  # shellcheck disable=SC2016
  arena_table=$(compose exec -T postgres sh -ec \
    'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At --command="SELECT to_regclass(\$\$public.arena\$\$)"') \
    || fail "could not verify current arena status"
  if [ -n "$arena_table" ]; then
    # Variables in the command string expand inside the container's shell.
    # shellcheck disable=SC2016
    compose exec -T -e "INSPECTED_FIXTURE=$inspected_fixture" postgres sh -ec \
      'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At --command="SELECT concat(count(*), '\''|'\'', count(*) FILTER (WHERE a.active_players_count <> 0 OR a.onchain_arena_id IS NOT NULL), '\''|'\'', count(*) FILTER (WHERE a.status <> '\''lobby'\'')) FROM arena a JOIN \"match\" m ON m.id = a.match_id WHERE m.txodds_fixture_id = $INSPECTED_FIXTURE"' \
      || fail "could not verify current arena status"
  fi
}

assert_empty_offchain_arena() {
  arena_state=$1
  arena_count=0
  unsafe_arenas=0
  non_lobby_arenas=0
  [ -n "$arena_state" ] || return 0
  arena_count=${arena_state%%|*}
  arena_details=${arena_state#*|}
  unsafe_arenas=${arena_details%%|*}
  non_lobby_arenas=${arena_details#*|}
  case "$arena_count:$unsafe_arenas:$non_lobby_arenas" in
    *[!0-9:]*) fail "arena safety query returned an invalid result" ;;
  esac
  [ "$arena_count" = 0 ] && return 0
  [ "$unsafe_arenas" = 0 ] \
    || fail "$unsafe_arenas arena(s) have active players or on-chain state; deploy refused"
  if [ "$non_lobby_arenas" != 0 ] && [ "$game_source" != replay ]; then
    fail "$non_lobby_arenas live arena(s) are outside the lobby; deploy refused"
  fi
}

staging_dir="$deploy_path/.deploy-$revision"
rm -rf "$staging_dir"
mkdir -p "$staging_dir"
succeeded=false
rollback_needed=false
migration_may_have_started=false
game_source=
live_fixture_id=
had_compose=false
had_caddyfile=false
had_init_script=false
had_mongo_init_script=false
had_event_control_script=false
had_metadata=false
cleanup() {
  exit_code=$?
  set +e
  if [ "$rollback_needed" = true ] && [ "$succeeded" = false ]; then
    compose stop --timeout 60 app >/dev/null 2>&1
    if [ "$migration_may_have_started" = true ]; then
      printf 'Deployment failed after migrations may have started; attempted config retained and app stopped.\n' >&2
    else
      if [ "$had_compose" = true ]; then
        cp "$staging_dir/backup/compose.yml" "$deploy_path/compose.yml"
      else
        rm -f "$deploy_path/compose.yml"
      fi
      if [ "$had_caddyfile" = true ]; then
        cp "$staging_dir/backup/Caddyfile" "$deploy_path/deploy/Caddyfile"
      else
        rm -f "$deploy_path/deploy/Caddyfile"
      fi
      if [ "$had_init_script" = true ]; then
        cp "$staging_dir/backup/postgres-init.sh" "$deploy_path/deploy/postgres-init.sh"
      else
        rm -f "$deploy_path/deploy/postgres-init.sh"
      fi
      if [ "$had_mongo_init_script" = true ]; then
        cp "$staging_dir/backup/mongo-init.sh" "$deploy_path/deploy/mongo-init.sh"
      else
        rm -f "$deploy_path/deploy/mongo-init.sh"
      fi
      if [ "$had_event_control_script" = true ]; then
        cp "$staging_dir/backup/remote-event-control.sh" "$deploy_path/deploy/remote-event-control.sh"
      else
        rm -f "$deploy_path/deploy/remote-event-control.sh"
      fi
      if [ "$had_metadata" = true ]; then
        cp "$staging_dir/backup/.env" "$deploy_path/.env"
      else
        rm -f "$deploy_path/.env"
      fi
      printf 'Deployment failed before migration; previous config restored.\n' >&2
      if [ "$had_compose" = true ]; then
        compose up -d --wait --wait-timeout 180 app caddy >/dev/null 2>&1 \
          || printf 'Previous release could not be restarted automatically.\n' >&2
      fi
    fi
  fi
  rm -rf "$staging_dir"
  rm -f "$archive"
  exit "$exit_code"
}
trap cleanup EXIT HUP INT TERM

tar -xzf "$archive" -C "$staging_dir"
[ -f "$staging_dir/compose.yml" ] || fail "archive is missing compose.yml"
[ -f "$staging_dir/deploy/Caddyfile" ] || fail "archive is missing deploy/Caddyfile"
[ -f "$staging_dir/deploy/postgres-init.sh" ] || fail "archive is missing deploy/postgres-init.sh"
[ -f "$staging_dir/deploy/mongo-init.sh" ] || fail "archive is missing deploy/mongo-init.sh"
[ -f "$staging_dir/deploy/remote-event-control.sh" ] || fail "archive is missing deploy/remote-event-control.sh"
for required_env in app postgres mongo migrate caddy; do
  [ -f "$deploy_path/deploy/$required_env.env" ] || fail "missing deploy/$required_env.env"
  [ "$(stat -c %a "$deploy_path/deploy/$required_env.env")" = 600 ] \
    || fail "deploy/$required_env.env must have mode 0600"
done

while IFS='=' read -r key value; do
  case "$key" in
    GAME_SOURCE) game_source=$value ;;
    TXODDS_LIVE_FIXTURE_ID) live_fixture_id=$value ;;
  esac
done < "$deploy_path/deploy/app.env"
case "$game_source" in
  replay) ;;
  live)
    case "$live_fixture_id" in
      ''|*[!0-9]*) fail "TXODDS_LIVE_FIXTURE_ID must be set to a positive integer for live deploys" ;;
    esac
    [ "$live_fixture_id" -gt 0 ] || fail "TXODDS_LIVE_FIXTURE_ID must be positive"
    export COMPOSE_PROFILES=live
    ;;
  *) fail "GAME_SOURCE must be replay or live" ;;
esac

current_image=
current_revision=
deployed_revision=
fixture_id=18241006
if [ -f "$deploy_path/.env" ]; then
  while IFS='=' read -r key value; do
    case "$key" in
      SABG_IMAGE) current_image=$value ;;
      SABG_VCS_REF) current_revision=$value ;;
      GATEWAY_REPLAY_FIXTURE_ID) fixture_id=$value ;;
    esac
  done < "$deploy_path/.env"
fi
if [ -f "$deploy_path/.deployed-revision" ]; then
  IFS= read -r deployed_revision < "$deploy_path/.deployed-revision"
fi
case "$fixture_id" in
  18179764|18241006) ;;
  *) fail "stored fixture is not allowlisted" ;;
esac
if [ "$game_source" = live ]; then
  inspected_fixture_id=$live_fixture_id
else
  inspected_fixture_id=$fixture_id
fi

# Validate the staged proxy configuration before any runtime mutation, then reject games that have
# players or on-chain state. An empty replay can be reset safely after its runtime is stopped.
SABG_IMAGE="$image" SABG_PLATFORM=linux/amd64 SABG_VCS_REF="$revision" \
  GATEWAY_REPLAY_FIXTURE_ID="$fixture_id" \
  SABG_APP_ENV_FILE="$deploy_path/deploy/app.env" \
  SABG_POSTGRES_ENV_FILE="$deploy_path/deploy/postgres.env" \
  SABG_MONGO_ENV_FILE="$deploy_path/deploy/mongo.env" \
  SABG_MIGRATE_ENV_FILE="$deploy_path/deploy/migrate.env" \
  SABG_CADDY_ENV_FILE="$deploy_path/deploy/caddy.env" \
  docker compose --project-directory "$staging_dir" -f "$staging_dir/compose.yml" config --quiet
caddy_image=$(read_staged_caddy_image) || fail "staged compose file is missing the Caddy image"
case "$caddy_image" in
  caddy:*@sha256:*) ;;
  *) fail "staged Caddy image must be digest-pinned" ;;
esac
caddy_digest=${caddy_image##*@sha256:}
case "$caddy_digest" in
  *[!0-9a-f]*|'') fail "staged Caddy image digest must be lowercase hexadecimal" ;;
esac
[ "${#caddy_digest}" -eq 64 ] || fail "staged Caddy image digest must contain 64 characters"
docker pull "$caddy_image"
docker run --rm --network none --read-only --tmpfs /tmp --tmpfs /data --tmpfs /config \
  --env-file "$deploy_path/deploy/caddy.env" \
  --mount "type=bind,src=$staging_dir/deploy/Caddyfile,dst=/tmp/sabg-caddyfile,readonly" \
  "$caddy_image" caddy validate --config /tmp/sabg-caddyfile --adapter caddyfile
if [ -f "$deploy_path/compose.yml" ]; then
  arena_state=$(inspect_deploy_arena "$inspected_fixture_id")
  assert_empty_offchain_arena "$arena_state"
fi

docker pull "$image"

mkdir -p "$deploy_path/deploy"
mkdir -p "$staging_dir/backup"
if [ -f "$deploy_path/compose.yml" ]; then
  had_compose=true
  cp "$deploy_path/compose.yml" "$staging_dir/backup/compose.yml"
fi
if [ -f "$deploy_path/deploy/Caddyfile" ]; then
  had_caddyfile=true
  cp "$deploy_path/deploy/Caddyfile" "$staging_dir/backup/Caddyfile"
fi
if [ -f "$deploy_path/deploy/postgres-init.sh" ]; then
  had_init_script=true
  cp "$deploy_path/deploy/postgres-init.sh" "$staging_dir/backup/postgres-init.sh"
fi
if [ -f "$deploy_path/deploy/mongo-init.sh" ]; then
  had_mongo_init_script=true
  cp "$deploy_path/deploy/mongo-init.sh" "$staging_dir/backup/mongo-init.sh"
fi
if [ -f "$deploy_path/deploy/remote-event-control.sh" ]; then
  had_event_control_script=true
  cp "$deploy_path/deploy/remote-event-control.sh" "$staging_dir/backup/remote-event-control.sh"
fi
if [ -f "$deploy_path/.env" ]; then
  had_metadata=true
  cp "$deploy_path/.env" "$staging_dir/backup/.env"
fi
rollback_needed=true
if [ "$had_compose" = true ]; then
  compose stop --timeout 60 app
  arena_state=$(inspect_deploy_arena "$inspected_fixture_id")
  assert_empty_offchain_arena "$arena_state"
  if [ "$non_lobby_arenas" != 0 ]; then
    SABG_IMAGE="$image" docker compose --project-directory "$deploy_path" \
      -f "$deploy_path/compose.yml" run --rm --no-deps --interactive=false --no-TTY app \
      node dist/db/seeds/reset-replay.js "$fixture_id" --force \
      --require-empty-offchain --confirm-database=postgres:5432/arena \
      || fail "guarded replay reset refused during deploy"
    printf 'Reset %s empty replay arena(s) for fixture %s before deploy.\n' \
      "$non_lobby_arenas" "$fixture_id"
  fi
fi
install -m 0644 "$staging_dir/compose.yml" "$deploy_path/compose.yml"
install -m 0644 "$staging_dir/deploy/Caddyfile" "$deploy_path/deploy/Caddyfile"
install -m 0755 "$staging_dir/deploy/postgres-init.sh" "$deploy_path/deploy/postgres-init.sh"
install -m 0755 "$staging_dir/deploy/mongo-init.sh" "$deploy_path/deploy/mongo-init.sh"
install -m 0755 "$staging_dir/deploy/remote-event-control.sh" "$deploy_path/deploy/remote-event-control.sh"

umask 077
{
  printf 'SABG_IMAGE=%s\n' "$image"
  printf 'SABG_PLATFORM=linux/amd64\n'
  printf 'SABG_VCS_REF=%s\n' "$revision"
  printf 'GATEWAY_REPLAY_FIXTURE_ID=%s\n' "$fixture_id"
} > "$deploy_path/.env.tmp"
mv "$deploy_path/.env.tmp" "$deploy_path/.env"

if [ -n "$current_image" ] && [ "$current_image" != "$image" ] \
  && [ "$current_revision" = "$deployed_revision" ]; then
  {
    printf 'SABG_IMAGE=%s\n' "$current_image"
    printf 'SABG_VCS_REF=%s\n' "$current_revision"
  } > "$deploy_path/.previous-image.tmp"
  mv "$deploy_path/.previous-image.tmp" "$deploy_path/.previous-image"
fi
if [ "$game_source" = live ]; then
  compose up -d --wait --wait-timeout 120 mongo
  compose up --abort-on-container-exit --exit-code-from mongo-init mongo-init
fi
migration_may_have_started=true
compose up -d --wait --wait-timeout 180
compose exec -T app node -e \
  "fetch('http://127.0.0.1:4000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))" \
  || fail "application health check failed"
compose up -d --force-recreate --wait --wait-timeout 60 caddy
if [ "$game_source" = replay ]; then
  compose_with_live_profile stop mongo mongo-init >/dev/null 2>&1 || true
fi
if [ "$had_compose" = true ]; then
  previous_release="$deploy_path/.previous-release"
  rm -rf "$previous_release.tmp"
  mkdir -p "$previous_release.tmp/deploy"
  cp "$staging_dir/backup/compose.yml" "$previous_release.tmp/compose.yml"
  [ "$had_caddyfile" = false ] || cp "$staging_dir/backup/Caddyfile" "$previous_release.tmp/deploy/Caddyfile"
  [ "$had_init_script" = false ] || cp "$staging_dir/backup/postgres-init.sh" "$previous_release.tmp/deploy/postgres-init.sh"
  [ "$had_mongo_init_script" = false ] || cp "$staging_dir/backup/mongo-init.sh" "$previous_release.tmp/deploy/mongo-init.sh"
  [ "$had_event_control_script" = false ] || cp "$staging_dir/backup/remote-event-control.sh" "$previous_release.tmp/deploy/remote-event-control.sh"
  rm -rf "$previous_release"
  mv "$previous_release.tmp" "$previous_release"
fi
printf '%s\n' "$revision" > "$deploy_path/.deployed-revision.tmp"
mv "$deploy_path/.deployed-revision.tmp" "$deploy_path/.deployed-revision"
succeeded=true
printf 'Deployed revision %s as %s\n' "$revision" "$image"
