#!/usr/bin/env bash
set -euo pipefail

# Copies the closed raw CS2 poll sessions (one per map) from prod Mongo into a local Mongo.
# Sessions already copied in full are skipped; nothing on prod is changed or deleted.
# LOCAL_MONGODB_URI picks the local target, EVENT_CONTROL_ENV_FILE the SSH config.

fail() {
  printf 'Raw poll export failed: %s\n' "$*" >&2
  exit 1
}

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
config_file=${EVENT_CONTROL_ENV_FILE:-$repo_root/deploy/event-control.env}
local_uri=${LOCAL_MONGODB_URI:-mongodb://localhost:27018/sabg_raw}
remote_script="$repo_root/deploy/remote-raw-polls-export.sh"

[ -f "$config_file" ] || fail "operator config not found: $config_file"
command -v mongosh >/dev/null 2>&1 || fail "mongosh is not installed"
command -v mongorestore >/dev/null 2>&1 || fail "mongorestore is not installed"

read_config() {
  local key value
  while IFS='=' read -r key value; do
    if [ "$key" = "$1" ]; then
      printf '%s\n' "$value"
      return 0
    fi
  done < "$config_file"
  fail "$1 is missing in $config_file"
}

host=$(read_config EVENT_HOST)
user=$(read_config EVENT_USER)
deploy_path=$(read_config EVENT_DEPLOY_PATH)
ssh_key=$(read_config EVENT_SSH_KEY)
[[ "$host" =~ ^[A-Za-z0-9:._-]+$ ]] || fail "EVENT_HOST is invalid"
[[ "$user" =~ ^[A-Za-z0-9._-]+$ ]] || fail "EVENT_USER is invalid"
[[ "$deploy_path" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail "EVENT_DEPLOY_PATH is invalid"

local_summary() {
  mongosh --quiet "$local_uri" --eval '
    const polls = db.cs2_raw_polls;
    print(polls.countDocuments() + " " + polls.distinct("sessionKey", { mapEnded: true }).length);
  '
}

# Prod TTL keeps 30 days, so older local sessions have nothing left to compare against.
skip=$(mongosh --quiet "$local_uri" --eval '
  const since = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
  const polls = db.cs2_raw_polls;
  const closed = polls.distinct("sessionKey", { mapEnded: true, receivedAt: { $gte: since } });
  polls.aggregate([
    { $match: { sessionKey: { $in: closed } } },
    { $group: { _id: "$sessionKey", documents: { $sum: 1 } } },
  ]).forEach((session) => print(session._id + ":" + session.documents));
')
remote_args="'$deploy_path'"
for pair in $skip; do
  [[ "$pair" =~ ^[A-Za-z0-9._:-]+:[0-9]+$ ]] || fail "local session key is invalid: $pair"
  remote_args="$remote_args '$pair'"
done

read -r before_documents before_maps <<< "$(local_summary)"

work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' EXIT
archive="$work_dir/cs2_raw_polls.archive.gz"

ssh -i "$ssh_key" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes \
  "$user@$host" "sh -s -- $remote_args" < "$remote_script" > "$archive"

if [ ! -s "$archive" ]; then
  printf 'No new closed maps to copy.\n'
  exit 0
fi

local_db=$(mongosh --quiet "$local_uri" --eval 'print(db.getName())')
# Indexes stay behind: the prod TTL index must never expire the local copy.
# shellcheck disable=SC2016
mongorestore --uri "$local_uri" --archive="$archive" --gzip --noIndexRestore \
  --nsInclude='*.cs2_raw_polls' --nsFrom='$db$.cs2_raw_polls' --nsTo="$local_db.cs2_raw_polls"

read -r after_documents after_maps <<< "$(local_summary)"
printf 'Copied %s documents; local closed maps: %s -> %s.\n' \
  "$((after_documents - before_documents))" "$before_maps" "$after_maps"
