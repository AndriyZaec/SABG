#!/bin/sh
set -eu

fail() {
  printf 'Event control failed: %s\n' "$*" >&2
  exit 1
}

deploy_path=${1:-}
command_name=${2:-status}
argument=${3:-}
confirmation=${4:-}

case "$deploy_path" in
  /*) ;;
  *) fail "deploy path must be absolute" ;;
esac
[ -f "$deploy_path/compose.yml" ] || fail "event stack is not installed"
[ -f "$deploy_path/.env" ] || fail "deployment metadata is missing"
[ -f "$deploy_path/deploy/app.env" ] || fail "application environment is missing"
command -v docker >/dev/null 2>&1 || fail "docker is not installed"
command -v flock >/dev/null 2>&1 || fail "flock is not installed"

compose() {
  docker compose --project-directory "$deploy_path" -f "$deploy_path/compose.yml" "$@"
}

compose_live() {
  docker compose --profile live --project-directory "$deploy_path" -f "$deploy_path/compose.yml" "$@"
}

read_env_value() {
  target_file=$1
  target_key=$2
  while IFS='=' read -r key value; do
    if [ "$key" = "$target_key" ]; then
      printf '%s\n' "$value"
      return 0
    fi
  done < "$target_file"
  return 1
}

seed_txline_cache() {
  seed_file="$deploy_path/.txline-cache.seed.json"
  [ -f "$seed_file" ] || return 0
  [ "$(stat -c %a "$seed_file")" = 600 ] || fail "TxLine cache seed must have mode 0600"
  [ "$(stat -c %u "$seed_file")" = 1000 ] || fail "TxLine cache seed must be owned by UID 1000"
  compose_live run --rm --no-deps -v "$seed_file:/seed/txline-cache.json:ro" app \
    node --input-type=module -e '
      import { copyFileSync, existsSync } from "node:fs";
      const target = "/app/state/txline-cache.json";
      if (!existsSync(target)) copyFileSync("/seed/txline-cache.json", target);
    '
}

prepare_live_dependencies() {
  compose_live up -d --wait --wait-timeout 120 mongo
  compose_live up --abort-on-container-exit --exit-code-from mongo-init mongo-init
  seed_txline_cache
}

run_live_preflight() {
  fixture_id=${1:-}
  if [ -n "$fixture_id" ]; then
    compose_live run --rm --no-deps -e "TXODDS_LIVE_FIXTURE_ID=$fixture_id" app \
      node dist/live/preflight.js
  else
    compose_live run --rm --no-deps app \
      node dist/live/preflight.js
  fi
}

assert_replay_replaceable() {
  replay_fixture=$1
  compose up -d --wait --wait-timeout 60 postgres \
    || fail "could not start PostgreSQL to verify replay state"
  # Variables in the command string expand inside the container's shell.
  # shellcheck disable=SC2016
  arena_state=$(compose exec -T -e "REPLAY_FIXTURE_ID=$replay_fixture" postgres sh -ec \
    'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At --command="SELECT concat(a.status::text, '\''|'\'', a.active_players_count, '\''|'\'', coalesce(a.onchain_arena_id::text, '\'''\'')) FROM arena a JOIN \"match\" m ON m.id = a.match_id WHERE m.txodds_fixture_id = $REPLAY_FIXTURE_ID ORDER BY a.created_at DESC LIMIT 1"') \
    || fail "could not verify replay arena state"
  [ -n "$arena_state" ] || return 0
  arena_status=${arena_state%%|*}
  state_rest=${arena_state#*|}
  active_players=${state_rest%%|*}
  onchain_arena_id=${state_rest#*|}
  if [ "$arena_status" = finished ]; then
    return 0
  fi
  if [ "$arena_status" = lobby ] && [ "$active_players" = 0 ] && [ -z "$onchain_arena_id" ]; then
    return 0
  fi
  fail "replay arena is not safely replaceable (status=$arena_status, players=$active_players, onchain=${onchain_arena_id:-none})"
}

write_app_source() {
  source=$1
  fixture_id=${2:-}
  source_file="$deploy_path/deploy/app.env"
  target_file="$source_file.tmp"
  umask 077
  : > "$target_file"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      GAME_SOURCE=*|TXODDS_LIVE_FIXTURE_ID=*|REPLAY_AUTO_RESTART=*) continue ;;
      *) printf '%s\n' "$line" >> "$target_file" ;;
    esac
  done < "$source_file"
  printf 'GAME_SOURCE=%s\n' "$source" >> "$target_file"
  if [ "$source" = live ]; then
    printf 'TXODDS_LIVE_FIXTURE_ID=%s\n' "$fixture_id" >> "$target_file"
    printf 'REPLAY_AUTO_RESTART=false\n' >> "$target_file"
  else
    printf 'REPLAY_AUTO_RESTART=true\n' >> "$target_file"
  fi
  chmod 0600 "$target_file"
  mv "$target_file" "$source_file"
}

case "$command_name" in
  status)
    source=$(read_env_value "$deploy_path/deploy/app.env" GAME_SOURCE || printf 'unknown')
    fixture=$(read_env_value "$deploy_path/deploy/app.env" TXODDS_LIVE_FIXTURE_ID || true)
    replay_fixture=$(read_env_value "$deploy_path/.env" GATEWAY_REPLAY_FIXTURE_ID || true)
    revision=$(read_env_value "$deploy_path/.env" SABG_VCS_REF || printf 'unknown')
    app_state=$(compose ps --format json app 2>/dev/null || true)
    printf 'SOURCE=%s\n' "$source"
    printf 'LIVE_FIXTURE_ID=%s\n' "$fixture"
    printf 'REPLAY_FIXTURE_ID=%s\n' "$replay_fixture"
    printf 'REVISION=%s\n' "$revision"
    if [ -n "$app_state" ]; then
      printf 'APP_PRESENT=true\n'
    else
      printf 'APP_PRESENT=false\n'
    fi
    ;;
  discover-live)
    exec 9>"$deploy_path/.operation.lock"
    flock -n 9 || fail "another event operation is running"
    cleanup_discovery() {
      exit_code=$?
      set +e
      compose_live stop mongo mongo-init >/dev/null 2>&1 || true
      exit "$exit_code"
    }
    trap cleanup_discovery EXIT HUP INT TERM
    prepare_live_dependencies
    run_live_preflight
    ;;
  switch-live)
    case "$argument" in
      ''|*[!0-9]*) fail "fixture id must be a positive integer" ;;
    esac
    [ "$argument" -gt 0 ] || fail "fixture id must be a positive integer"
    [ "$confirmation" = "GO LIVE $argument" ] \
      || fail "confirmation must exactly match GO LIVE $argument"
    exec 9>"$deploy_path/.operation.lock"
    flock -n 9 || fail "another event operation is running"
    current_source=$(read_env_value "$deploy_path/deploy/app.env" GAME_SOURCE || true)
    [ "$current_source" = replay ] || fail "event source must be replay before switching live"
    replay_fixture=$(read_env_value "$deploy_path/.env" GATEWAY_REPLAY_FIXTURE_ID || true)
    case "$replay_fixture" in
      18179764|18241006) ;;
      *) fail "deployed replay fixture is not allowlisted" ;;
    esac

    switched=false
    backup_created=false
    cleanup_switch() {
      exit_code=$?
      set +e
      if [ "$switched" = false ] && [ "$backup_created" = true ]; then
        compose_live stop --timeout 60 app >/dev/null 2>&1
        mv "$deploy_path/deploy/app.env.before-live" "$deploy_path/deploy/app.env"
        compose up -d --wait --wait-timeout 180 app caddy >/dev/null 2>&1 \
          || printf 'Replay could not be restarted automatically.\n' >&2
      elif [ "$switched" = true ]; then
        rm -f "$deploy_path/deploy/app.env.before-live"
      fi
      if [ "$switched" = false ]; then
        compose_live stop mongo mongo-init >/dev/null 2>&1 || true
      fi
      exit "$exit_code"
    }
    trap cleanup_switch EXIT HUP INT TERM

    assert_replay_replaceable "$replay_fixture"
    prepare_live_dependencies
    run_live_preflight "$argument" || fail "pinned live preflight failed"
    assert_replay_replaceable "$replay_fixture"
    cp "$deploy_path/deploy/app.env" "$deploy_path/deploy/app.env.before-live"
    backup_created=true
    compose stop --timeout 60 app
    assert_replay_replaceable "$replay_fixture"
    compose run --rm --no-deps app node dist/db/seeds/reset-replay.js \
      "$replay_fixture" --force --confirm-database=postgres:5432/arena \
      || fail "guarded replay reset refused"
    write_app_source live "$argument"
    compose_live up -d --wait --wait-timeout 180 app caddy
    compose exec -T app node -e \
      "fetch('http://127.0.0.1:4000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
    switched=true
    printf 'Event switched live on fixture %s\n' "$argument"
    ;;
  logs)
    compose logs --since 15m app
    ;;
  *) fail "unknown command: $command_name" ;;
esac
