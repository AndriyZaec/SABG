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
# Not "value": the assert_* helpers below assign that name globally.
stream_url=${5:-}

case "$deploy_path" in
  /*) ;;
  *) fail "deploy path must be absolute" ;;
esac
[ -f "$deploy_path/compose.yml" ] || fail "event stack is not installed"
[ -f "$deploy_path/.env" ] || fail "deployment metadata is missing"
[ -f "$deploy_path/deploy/app.env" ] || fail "application environment is missing"
command -v docker >/dev/null 2>&1 || fail "docker is not installed"

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

# Series the autopilot is running: an active series of a configured tournament that already ran an arena,
# also between maps when none is open. Older active series of other tournaments are never resumed.
running_series_from() {
  printf "FROM series s JOIN cs2_competition c ON c.id = s.competition_id JOIN \"match\" m ON m.series_id = s.id JOIN arena a ON a.match_id = m.id WHERE s.status = 'active' AND c.grid_tournament_id = coalesce((SELECT value FROM settings WHERE name = 'cs2_active_tournament'), '')"
}

running_series_sql() {
  printf 'SELECT %s %s;\n' "$1" "$(running_series_from)"
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

# Runs SQL from stdin as the migrator; the caller validates every value it embeds (assert_safe_grid_id).
run_sql() {
  # shellcheck disable=SC2016
  compose exec -T postgres sh -ec \
    'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -v ON_ERROR_STOP=1'
}

control_mutation() {
  compose exec -T app node dist/control/legacy-client.js "$@"
}

inspect_autopilot() {
  postgres_id=$(compose ps -q postgres 2>/dev/null || true)
  [ -n "$postgres_id" ] || { printf 'AUTOPILOT=unknown\nRUNNING_SERIES=\nPRIORITY_SERIES=\nSERIES_STREAMS=\n'; return; }
  # Missing tables (before the first migration) read as unknown rather than failing status.
  {
    printf '%s\n' "SELECT 'AUTOPILOT=' || coalesce((SELECT CASE WHEN enabled THEN 'on' ELSE 'off' END FROM settings WHERE name = 'cs2_autopilot'), 'unknown');"
    running_series_sql "'RUNNING_SERIES=' || coalesce(string_agg(DISTINCT s.grid_series_id, ','), '')"
    printf '%s\n' "SELECT 'PRIORITY_SERIES=' || coalesce(string_agg(grid_series_id, ',' ORDER BY scheduled_start_time), '') FROM series WHERE priority AND status = 'active' AND scheduled_start_time >= now() - interval '30 minutes';"
  } | run_sql 2>/dev/null || printf 'AUTOPILOT=unknown\nRUNNING_SERIES=\nPRIORITY_SERIES=\n'
  # The streams of the running and the prioritized series, as <grid id>=<url>. Queried on its own: the operator
  # sends this script from its checkout, so it may reach a server without the stream_url column yet.
  printf "SELECT 'SERIES_STREAMS=' || coalesce(string_agg(grid_series_id || '=' || stream_url, ',' ORDER BY scheduled_start_time), '') FROM series WHERE stream_url IS NOT NULL AND (grid_series_id IN (SELECT s.grid_series_id %s) OR (priority AND status = 'active' AND scheduled_start_time >= now() - interval '30 minutes'));\n" \
    "$(running_series_from)" | run_sql 2>/dev/null || printf 'SERIES_STREAMS=\n'
}

print_status() {
  tournament_id=$(printf '%s\n' "SELECT coalesce((SELECT value FROM settings WHERE name = 'cs2_active_tournament'), '');" | run_sql 2>/dev/null || printf 'unknown\n')
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
    control_mutation tournament.publish "$tournament_id" "$argument" >/dev/null
    printf 'Published CS2 tournament %s; the autopilot runs its series\n' "$tournament_id"
    ;;
  prioritize-cs2|unprioritize-cs2)
    assert_safe_grid_id "$argument" "GRID Series ID"
    priority=true
    [ "$command_name" = prioritize-cs2 ] || priority=false
    control_mutation series.priority.set "$argument" "$priority" >/dev/null
    printf 'CS2 Series %s priority: %s\n' "$argument" "$priority"
    ;;
  set-stream-cs2)
    assert_safe_grid_id "$argument" "GRID Series ID"
    control_mutation series.stream.set "$argument" "$stream_url" >/dev/null
    printf 'CS2 Series %s stream: %s\n' "$argument" "$stream_url"
    ;;
  clear-stream-cs2)
    assert_safe_grid_id "$argument" "GRID Series ID"
    control_mutation series.stream.set "$argument" "" >/dev/null
    printf 'CS2 Series %s stream cleared\n' "$argument"
    ;;
  autopilot-on|autopilot-off)
    enabled=true
    [ "$command_name" = autopilot-on ] || enabled=false
    control_mutation autopilot.set "" "$enabled" >/dev/null
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
    control_mutation series.skip.request "$argument" "" >/dev/null
    printf 'Skip requested for CS2 Series %s: the autopilot applies it within a minute, and refuses if players paid\n' "$argument"
    ;;
  logs)
    print_status
    printf '%s\n' '--- APP LOGS (last 15 minutes) ---'
    compose logs --since 15m app
    ;;
  *) fail "unknown command: $command_name" ;;
esac
