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

read_runtime_mode() {
  read_env_value "$deploy_path/deploy/app.env" CS2_RUNTIME_MODE || printf 'catalog\n'
}

assert_safe_grid_id() {
  value=$1
  label=$2
  case "$value" in
    ''|*[!A-Za-z0-9._:-]*) fail "$label is invalid" ;;
  esac
  [ "${#value}" -le 200 ] || fail "$label is too long"
}

unfinished_cs2_arenas() {
  compose up -d --wait --wait-timeout 60 postgres >/dev/null \
    || fail "could not start PostgreSQL to verify CS2 Arena state"
  # shellcheck disable=SC2016
  arena_table=$(compose exec -T postgres sh -ec \
    'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At --command="SELECT to_regclass(\$\$public.arena\$\$)"') \
    || fail "could not inspect the Arena table"
  if [ -z "$arena_table" ]; then
    printf '0\n'
    return
  fi
  compose exec -T postgres sh -ec \
    'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At --command="SELECT count(*) FROM arena a JOIN \"match\" m ON m.id = a.match_id WHERE m.discipline = '\''cs2'\'' AND a.status NOT IN ('\''finished'\'', '\''cancelled'\'')"' \
    || fail "could not inspect CS2 Arena state"
}

assert_no_unfinished_cs2_arenas() {
  count=$(unfinished_cs2_arenas)
  case "$count" in
    ''|*[!0-9]*) fail "CS2 Arena safety query returned an invalid result" ;;
  esac
  [ "$count" = 0 ] || fail "$count unfinished CS2 Arena(s) exist; operation refused"
}

write_app_runtime() {
  mode=$1
  tournament_id=${2:-}
  series_id=${3:-}
  scheduled_start_time=${4:-}
  source_file="$deploy_path/deploy/app.env"
  target_file="$source_file.tmp.$$"
  umask 077
  : > "$target_file"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      CS2_RUNTIME_MODE=*|CS2_CATALOG_TOURNAMENT_IDS=*|GRID_SERIES_ID=*|CS2_SCHEDULED_START_TIME=*) continue ;;
      *) printf '%s\n' "$line" >> "$target_file" ;;
    esac
  done < "$source_file"
  printf 'CS2_RUNTIME_MODE=%s\n' "$mode" >> "$target_file"
  [ -z "$tournament_id" ] || printf 'CS2_CATALOG_TOURNAMENT_IDS=%s\n' "$tournament_id" >> "$target_file"
  if [ "$mode" = live ]; then
    printf 'GRID_SERIES_ID=%s\n' "$series_id" >> "$target_file"
    printf 'CS2_SCHEDULED_START_TIME=%s\n' "$scheduled_start_time" >> "$target_file"
  fi
  chmod 0600 "$target_file"
  mv "$target_file" "$source_file"
}

prepare_raw_storage() {
  raw_recording=$(read_env_value "$deploy_path/deploy/app.env" CS2_RAW_RECORDING_ENABLED || printf 'false')
  [ "$raw_recording" = true ] || return 0
  compose_live up -d --wait --wait-timeout 120 mongo
  compose_live up --abort-on-container-exit --exit-code-from mongo-init mongo-init
}

assert_app_healthy() {
  compose exec -T app node -e \
    "fetch('http://127.0.0.1:4000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))" \
    || fail "application health check failed"
}

print_status() {
  mode=$(read_runtime_mode)
  tournament_id=$(read_env_value "$deploy_path/deploy/app.env" CS2_CATALOG_TOURNAMENT_IDS || true)
  series_id=$(read_env_value "$deploy_path/deploy/app.env" GRID_SERIES_ID || true)
  scheduled_start_time=$(read_env_value "$deploy_path/deploy/app.env" CS2_SCHEDULED_START_TIME || true)
  if [ "$mode" != live ]; then
    series_id=
    scheduled_start_time=
  fi
  revision=$(read_env_value "$deploy_path/.env" SABG_VCS_REF || printf 'unknown')
  container_id=$(compose ps -q app 2>/dev/null || true)
  app_health=absent
  if [ -n "$container_id" ]; then
    app_health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || printf 'unknown')
  fi
  printf 'MODE=%s\n' "$mode"
  printf 'TOURNAMENT_ID=%s\n' "$tournament_id"
  printf 'SERIES_ID=%s\n' "$series_id"
  printf 'SCHEDULED_START_TIME=%s\n' "$scheduled_start_time"
  printf 'REVISION=%s\n' "$revision"
  printf 'APP_HEALTH=%s\n' "$app_health"
}

case "$command_name" in
  status)
    print_status
    ;;
  discover-cs2)
    compose run --rm --no-deps app node dist/cs2/operator-discovery.js
    ;;
  start-cs2)
    assert_safe_grid_id "$argument" "GRID Series ID"
    [ "$confirmation" = "START CS2 $argument" ] \
      || fail "confirmation must exactly match START CS2 $argument"
    exec 9>"$deploy_path/.operation.lock"
    flock -n 9 || fail "another event operation is running"
    [ "$(read_runtime_mode)" = catalog ] || fail "stop the active CS2 Series before selecting another"
    assert_no_unfinished_cs2_arenas

    activation_file="$deploy_path/.cs2-activation.$$"
    backup_file="$deploy_path/deploy/app.env.before-cs2"
    switched=false
    backup_created=false
    cleanup_start() {
      exit_code=$?
      trap - EXIT HUP INT TERM
      set +e
      rm -f "$activation_file"
      if [ "$switched" = true ]; then
        rm -f "$backup_file"
      elif [ "$backup_created" = true ]; then
        compose_live stop --timeout 60 app >/dev/null 2>&1 || true
        mv "$backup_file" "$deploy_path/deploy/app.env"
        compose up -d --force-recreate --wait --wait-timeout 180 app caddy >/dev/null 2>&1 \
          || printf 'Catalog runtime could not be restored automatically.\n' >&2
      fi
      [ "$switched" = true ] || compose_live stop mongo mongo-init >/dev/null 2>&1 || true
      exit "$exit_code"
    }
    trap cleanup_start EXIT HUP INT TERM

    umask 077
    compose run --rm --no-deps -e "CS2_OPERATOR_SERIES_ID=$argument" app \
      node dist/cs2/operator-activate.js > "$activation_file"
    tournament_id=
    series_id=
    scheduled_start_time=
    synced_series=
    while IFS='=' read -r key value; do
      case "$key" in
        SABG_CS2_TOURNAMENT_ID) tournament_id=$value ;;
        SABG_CS2_SERIES_ID) series_id=$value ;;
        SABG_CS2_SCHEDULED_START_TIME) scheduled_start_time=$value ;;
        SABG_CS2_SYNCED_SERIES) synced_series=$value ;;
      esac
    done < "$activation_file"
    assert_safe_grid_id "$tournament_id" "GRID tournament ID"
    [ "$series_id" = "$argument" ] || fail "remote validation returned a different GRID Series"
    case "$scheduled_start_time" in
      ''|*[!0-9TZ:.-]*) fail "remote validation returned an invalid schedule" ;;
    esac
    case "$synced_series" in
      ''|*[!0-9]*) fail "remote validation returned an invalid synchronization count" ;;
    esac
    [ "$synced_series" -gt 0 ] || fail "remote validation synchronized no Series"

    prepare_raw_storage
    cp "$deploy_path/deploy/app.env" "$backup_file"
    backup_created=true
    compose stop --timeout 60 app
    assert_no_unfinished_cs2_arenas
    write_app_runtime live "$tournament_id" "$series_id" "$scheduled_start_time"
    compose_live up -d --force-recreate --wait --wait-timeout 180 app caddy
    assert_app_healthy
    switched=true
    printf 'Started CS2 Series %s in tournament %s (%s synchronized)\n' "$series_id" "$tournament_id" "$synced_series"
    ;;
  stop-cs2)
    mode=$(read_runtime_mode)
    if [ "$mode" = catalog ]; then
      printf 'CS2 runtime is already catalog-only\n'
      exit 0
    fi
    [ "$mode" = live ] || fail "unknown CS2 runtime mode: $mode"
    series_id=$(read_env_value "$deploy_path/deploy/app.env" GRID_SERIES_ID || true)
    assert_safe_grid_id "$series_id" "active GRID Series ID"
    [ "$confirmation" = "STOP CS2 $series_id" ] \
      || fail "confirmation must exactly match STOP CS2 $series_id"
    exec 9>"$deploy_path/.operation.lock"
    flock -n 9 || fail "another event operation is running"
    assert_no_unfinished_cs2_arenas

    tournament_id=$(read_env_value "$deploy_path/deploy/app.env" CS2_CATALOG_TOURNAMENT_IDS || true)
    assert_safe_grid_id "$tournament_id" "active GRID tournament ID"
    backup_file="$deploy_path/deploy/app.env.before-catalog"
    switched=false
    cleanup_stop() {
      exit_code=$?
      trap - EXIT HUP INT TERM
      set +e
      if [ "$switched" = true ]; then
        rm -f "$backup_file"
      elif [ -f "$backup_file" ]; then
        compose stop --timeout 60 app >/dev/null 2>&1 || true
        mv "$backup_file" "$deploy_path/deploy/app.env"
        prepare_raw_storage >/dev/null 2>&1 || true
        compose_live up -d --force-recreate --wait --wait-timeout 180 app caddy >/dev/null 2>&1 \
          || printf 'Live CS2 runtime could not be restored automatically.\n' >&2
      fi
      exit "$exit_code"
    }
    trap cleanup_stop EXIT HUP INT TERM

    cp "$deploy_path/deploy/app.env" "$backup_file"
    compose stop --timeout 60 app
    assert_no_unfinished_cs2_arenas
    write_app_runtime catalog "$tournament_id"
    compose up -d --force-recreate --wait --wait-timeout 180 app caddy
    assert_app_healthy
    compose_live stop mongo mongo-init >/dev/null 2>&1 || true
    switched=true
    printf 'Stopped CS2 Series %s; catalog remains online\n' "$series_id"
    ;;
  logs)
    print_status
    printf '%s\n' '--- APP LOGS (last 15 minutes) ---'
    compose logs --since 15m app
    ;;
  *) fail "unknown command: $command_name" ;;
esac
