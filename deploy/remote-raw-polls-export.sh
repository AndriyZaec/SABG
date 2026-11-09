#!/bin/sh
set -eu

# Streams a gzip mongodump archive of the closed raw CS2 poll sessions to stdout; everything else
# goes to stderr. Read-only: it never writes to or deletes from prod Mongo.
# Arguments: <deploy path> [<sessionKey>:<local document count> ...] — sessions to skip when prod
# holds exactly that many documents, so a partly copied session is sent again.

fail() {
  printf 'Raw poll export failed: %s\n' "$*" >&2
  exit 1
}

deploy_path=${1:-}
[ "$#" -gt 0 ] && shift

case "$deploy_path" in
  /*) ;;
  *) fail "deploy path must be absolute" ;;
esac
[ -f "$deploy_path/compose.yml" ] || fail "event stack is not installed"
command -v docker >/dev/null 2>&1 || fail "docker is not installed"

skip=""
for pair in "$@"; do
  case "$pair" in
    *:*) ;;
    *) fail "session pair is invalid" ;;
  esac
  key=${pair%:*}
  count=${pair##*:}
  case "$key" in
    ''|*[!A-Za-z0-9._:-]*) fail "session key is invalid" ;;
  esac
  [ "${#key}" -le 260 ] || fail "session key is too long"
  case "$count" in
    ''|*[!0-9]*) fail "session count is invalid" ;;
  esac
  skip="$skip $key:$count"
done

compose() {
  docker compose --project-directory "$deploy_path" -f "$deploy_path/compose.yml" "$@"
}

# shellcheck disable=SC2016
compose exec -T -e RAW_EXPORT_SKIP="$skip" mongo sh -ec '
  app_mongosh() {
    mongosh --host 127.0.0.1 --port 27017 \
      --authenticationDatabase "$MONGO_APP_DATABASE" \
      --username "$MONGO_APP_USERNAME" \
      --password "$MONGO_APP_PASSWORD" \
      --quiet "$@"
  }

  # mongosh prints console.error to stdout without a TTY: line 1 is the key list, line 2 the summary.
  selection=$(app_mongosh --eval "
    const skip = new Map(process.env.RAW_EXPORT_SKIP.split(\" \").filter(Boolean).map((pair) => {
      const separator = pair.lastIndexOf(\":\");
      return [pair.slice(0, separator), Number(pair.slice(separator + 1))];
    }));
    const polls = db.getSiblingDB(process.env.MONGO_APP_DATABASE).cs2_raw_polls;
    const closed = polls.distinct(\"sessionKey\", { mapEnded: true });
    const sessions = polls.aggregate([
      { \$match: { sessionKey: { \$in: closed } } },
      { \$group: { _id: \"\$sessionKey\", documents: { \$sum: 1 } } },
    ]).toArray().filter((session) => skip.get(session._id) !== session.documents);
    const documents = sessions.reduce((sum, session) => sum + session.documents, 0);
    print(JSON.stringify(sessions.map((session) => session._id)));
    print(\"Closed maps to copy: \" + sessions.length + \" (\" + documents + \" documents)\");
  ")
  keys=$(printf "%s\n" "$selection" | sed -n 1p)
  printf "%s\n" "$selection" | sed -n 2p >&2

  [ "$keys" = "[]" ] && exit 0

  mongodump --host 127.0.0.1 --port 27017 \
    --authenticationDatabase "$MONGO_APP_DATABASE" \
    --username "$MONGO_APP_USERNAME" \
    --password "$MONGO_APP_PASSWORD" \
    --db "$MONGO_APP_DATABASE" --collection cs2_raw_polls \
    --query "{\"sessionKey\":{\"\$in\":$keys}}" \
    --archive --gzip
' < /dev/null
