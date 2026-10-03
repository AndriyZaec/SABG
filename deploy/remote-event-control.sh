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

# SQL list of the configured tournament ids, each validated; empty when none is configured.
configured_tournaments_sql() {
  ids=$(read_env_value "$deploy_path/deploy/app.env" CS2_CATALOG_TOURNAMENT_IDS || true)
  list=
  old_ifs=$IFS
  IFS=,
  for id in $ids; do
    assert_safe_grid_id "$id" "configured GRID tournament ID"
    list="${list:+$list,}'$id'"
  done
  IFS=$old_ifs
  printf '%s\n' "$list"
}

# Series the autopilot is running: an active series of a configured tournament that already ran an arena,
# also between maps when none is open. Older active series of other tournaments are never resumed.
running_series_sql() {
  select_list=$1
  tournaments=$(configured_tournaments_sql)
  [ -n "$tournaments" ] || tournaments="''"
  printf "SELECT %s FROM series s JOIN cs2_competition c ON c.id = s.competition_id JOIN \"match\" m ON m.series_id = s.id JOIN arena a ON a.match_id = m.id WHERE s.status = 'active' AND c.grid_tournament_id IN (%s);\n" \
    "$select_list" "$tournaments"
}

assert_no_running_cs2_series() {
  start_postgres
  running=$(running_series_sql "count(DISTINCT s.id)" | run_sql) \
    || fail "could not inspect running CS2 Series"
  case "$running" in
    ''|*[!0-9]*) fail "CS2 Series safety query returned an invalid result" ;;
  esac
  [ "$running" = 0 ] || fail "a CS2 Series is still running; skip it or wait for it to end before publishing"
}

assert_no_unfinished_cs2_arenas() {
  count=$(unfinished_cs2_arenas)
  case "$count" in
    ''|*[!0-9]*) fail "CS2 Arena safety query returned an invalid result" ;;
  esac
  [ "$count" = 0 ] || fail "$count unfinished CS2 Arena(s) exist; operation refused"
}

inspect_unfinished_cs2_arenas() {
  postgres_id=$(compose ps -q postgres 2>/dev/null || true)
  [ -n "$postgres_id" ] || { printf 'unknown\n'; return; }
  postgres_running=$(docker inspect --format '{{.State.Running}}' "$postgres_id" 2>/dev/null || printf 'false')
  [ "$postgres_running" = true ] || { printf 'unknown\n'; return; }
  # shellcheck disable=SC2016
  compose exec -T postgres sh -ec \
    'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At --command="SELECT count(*) FROM arena a JOIN \"match\" m ON m.id = a.match_id WHERE m.discipline = '\''cs2'\'' AND a.status NOT IN ('\''finished'\'', '\''cancelled'\'')"' \
    2>/dev/null || printf 'unknown\n'
}

write_app_tournament() {
  tournament_id=$1
  source_file="$deploy_path/deploy/app.env"
  target_file="$source_file.tmp.$$"
  umask 077
  : > "$target_file"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      # The last three belong to the removed per-series live mode; dropped so they don't linger.
      CS2_CATALOG_TOURNAMENT_IDS=*|CS2_RUNTIME_MODE=*|GRID_SERIES_ID=*|CS2_SCHEDULED_START_TIME=*) continue ;;
      *) printf '%s\n' "$line" >> "$target_file" ;;
    esac
  done < "$source_file"
  printf 'CS2_CATALOG_TOURNAMENT_IDS=%s\n' "$tournament_id" >> "$target_file"
  chmod 0600 "$target_file"
  mv "$target_file" "$source_file"
}

# Runs SQL from stdin as the migrator; the caller validates every value it embeds (assert_safe_grid_id).
run_sql() {
  # shellcheck disable=SC2016
  compose exec -T postgres sh -ec \
    'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -v ON_ERROR_STOP=1'
}

start_postgres() {
  compose up -d --wait --wait-timeout 60 postgres >/dev/null \
    || fail "could not start PostgreSQL"
}

# Prints the row count of an UPDATE; fails when nothing matched.
update_one() {
  description=$1
  statement=$2
  start_postgres
  count=$(printf 'WITH changed AS (%s RETURNING 1) SELECT count(*) FROM changed;\n' "$statement" | run_sql) \
    || fail "could not update $description"
  case "$count" in
    ''|*[!0-9]*) fail "update of $description returned an invalid result" ;;
  esac
  [ "$count" -gt 0 ] || fail "no $description matched"
  printf '%s row(s) updated\n' "$count"
}

assert_app_healthy() {
  compose exec -T app node -e \
    "fetch('http://127.0.0.1:4000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))" \
    || fail "application health check failed"
}

inspect_autopilot() {
  postgres_id=$(compose ps -q postgres 2>/dev/null || true)
  [ -n "$postgres_id" ] || { printf 'AUTOPILOT=unknown\nRUNNING_SERIES=\nPRIORITY_SERIES=\n'; return; }
  # Missing tables (before the first migration) read as unknown rather than failing status.
  {
    printf '%s\n' "SELECT 'AUTOPILOT=' || coalesce((SELECT CASE WHEN enabled THEN 'on' ELSE 'off' END FROM settings WHERE name = 'cs2_autopilot'), 'unknown');"
    running_series_sql "'RUNNING_SERIES=' || coalesce(string_agg(DISTINCT s.grid_series_id, ','), '')"
    printf '%s\n' "SELECT 'PRIORITY_SERIES=' || coalesce(string_agg(grid_series_id, ',' ORDER BY scheduled_start_time), '') FROM series WHERE priority AND status = 'active' AND scheduled_start_time >= now() - interval '30 minutes';"
  } | run_sql 2>/dev/null || printf 'AUTOPILOT=unknown\nRUNNING_SERIES=\nPRIORITY_SERIES=\n'
}

print_status() {
  tournament_id=$(read_env_value "$deploy_path/deploy/app.env" CS2_CATALOG_TOURNAMENT_IDS || true)
  revision=$(read_env_value "$deploy_path/.env" SABG_VCS_REF || printf 'unknown')
  container_id=$(compose ps -q app 2>/dev/null || true)
  app_health=absent
  if [ -n "$container_id" ]; then
    app_health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || printf 'unknown')
  fi
  unfinished_arenas=$(inspect_unfinished_cs2_arenas)
  printf 'TOURNAMENT_ID=%s\n' "$tournament_id"
  inspect_autopilot
  printf 'REVISION=%s\n' "$revision"
  printf 'APP_HEALTH=%s\n' "$app_health"
  printf 'UNFINISHED_ARENAS=%s\n' "$unfinished_arenas"
}

case "$command_name" in
  status)
    print_status
    ;;
  discover-cs2)
    compose run --rm --no-deps app node dist/cs2/operator-discovery.js
    ;;
  inspect-cs2)
    assert_safe_grid_id "$argument" "GRID Series ID"
    compose run --rm --no-deps -e "CS2_OPERATOR_SERIES_ID=$argument" app node dist/cs2/operator-discovery.js
    ;;
  publish-cs2)
    assert_safe_grid_id "$argument" "GRID Series ID"
    tournament_id=${confirmation#PUBLISH CS2 }
    assert_safe_grid_id "$tournament_id" "GRID tournament ID"
    [ "$confirmation" = "PUBLISH CS2 $tournament_id" ] \
      || fail "confirmation must exactly match PUBLISH CS2 $tournament_id"
    exec 9>"$deploy_path/.operation.lock"
    flock -n 9 || fail "another event operation is running"
    assert_no_unfinished_cs2_arenas
    assert_no_running_cs2_series

    publication_file="$deploy_path/.cs2-publication.$$"
    backup_file="$deploy_path/deploy/app.env.before-publish"
    switched=false
    backup_created=false
    cleanup_publish() {
      exit_code=$?
      trap - EXIT HUP INT TERM
      set +e
      rm -f "$publication_file"
      if [ "$switched" = true ]; then
        rm -f "$backup_file"
      elif [ "$backup_created" = true ]; then
        compose stop --timeout 60 app >/dev/null 2>&1 || true
        mv "$backup_file" "$deploy_path/deploy/app.env"
        compose up -d --force-recreate --wait --wait-timeout 180 app caddy >/dev/null 2>&1 \
          || printf 'Previous runtime could not be restored automatically.\n' >&2
      fi
      exit "$exit_code"
    }
    trap cleanup_publish EXIT HUP INT TERM

    umask 077
    compose run --rm --no-deps -e "CS2_OPERATOR_SERIES_ID=$argument" app \
      node dist/cs2/operator-activate.js > "$publication_file"
    validated_tournament_id=
    series_id=
    synced_series=
    while IFS='=' read -r key value; do
      case "$key" in
        SABG_CS2_TOURNAMENT_ID) validated_tournament_id=$value ;;
        SABG_CS2_SERIES_ID) series_id=$value ;;
        SABG_CS2_SYNCED_SERIES) synced_series=$value ;;
      esac
    done < "$publication_file"
    [ "$validated_tournament_id" = "$tournament_id" ] || fail "remote validation returned a different GRID tournament"
    [ "$series_id" = "$argument" ] || fail "remote validation returned a different GRID Series"
    case "$synced_series" in
      ''|*[!0-9]*) fail "remote validation returned an invalid synchronization count" ;;
    esac
    [ "$synced_series" -gt 0 ] || fail "remote validation synchronized no Series"

    cp "$deploy_path/deploy/app.env" "$backup_file"
    backup_created=true
    compose stop --timeout 60 app
    assert_no_unfinished_cs2_arenas
    write_app_tournament "$tournament_id"
    compose up -d --force-recreate --wait --wait-timeout 180 app caddy
    assert_app_healthy
    switched=true
    printf 'Published CS2 tournament %s (%s synchronized); the autopilot runs its series\n' \
      "$tournament_id" "$synced_series"
    ;;
  prioritize-cs2|unprioritize-cs2)
    assert_safe_grid_id "$argument" "GRID Series ID"
    priority=true
    [ "$command_name" = prioritize-cs2 ] || priority=false
    update_one "CS2 Series $argument" "UPDATE series SET priority = $priority WHERE grid_series_id = '$argument'"
    printf 'CS2 Series %s priority: %s\n' "$argument" "$priority"
    ;;
  autopilot-on|autopilot-off)
    enabled=true
    [ "$command_name" = autopilot-on ] || enabled=false
    update_one "autopilot setting" "UPDATE settings SET enabled = $enabled, updated_at = now() WHERE name = 'cs2_autopilot'"
    if [ "$enabled" = true ]; then
      printf 'Autopilot on: the next due CS2 Series launches within a minute\n'
    else
      printf 'Autopilot off: the running CS2 Series plays to its end, no new Series launch\n'
    fi
    ;;
  skip-cs2)
    assert_safe_grid_id "$argument" "GRID Series ID"
    [ "$confirmation" = "SKIP CS2 $argument" ] \
      || fail "confirmation must exactly match SKIP CS2 $argument"
    update_one "active CS2 Series $argument" "UPDATE series SET skip_requested = true WHERE grid_series_id = '$argument' AND status = 'active'"
    printf 'Skip requested for CS2 Series %s: the autopilot applies it within a minute, and refuses if players paid\n' "$argument"
    ;;
  logs)
    print_status
    printf '%s\n' '--- APP LOGS (last 15 minutes) ---'
    compose logs --since 15m app
    ;;
  *) fail "unknown command: $command_name" ;;
esac
