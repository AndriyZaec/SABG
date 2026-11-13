#!/bin/sh
set -eu

: "${MONGO_INITDB_ROOT_USERNAME:?MONGO_INITDB_ROOT_USERNAME is required}"
: "${MONGO_INITDB_ROOT_PASSWORD:?MONGO_INITDB_ROOT_PASSWORD is required}"
: "${MONGO_APP_USERNAME:?MONGO_APP_USERNAME is required}"
: "${MONGO_APP_PASSWORD:?MONGO_APP_PASSWORD is required}"
: "${MONGO_APP_DATABASE:?MONGO_APP_DATABASE is required}"

app_mongosh() {
  mongosh --host mongo --port 27017 \
    --authenticationDatabase "$MONGO_APP_DATABASE" \
    --username "$MONGO_APP_USERNAME" \
    --password "$MONGO_APP_PASSWORD" \
    --quiet "$@"
}

if ! app_mongosh --eval '
    const result = db.runCommand({ connectionStatus: 1 });
    const roles = result.authInfo?.authenticatedUserRoles ?? [];
    const expected = roles.length === 1
      && roles[0].role === "readWrite"
      && roles[0].db === process.env.MONGO_APP_DATABASE;
    quit(result.ok && expected ? 0 : 2);
  ' >/dev/null 2>&1; then
  mongosh --host mongo --port 27017 --authenticationDatabase admin \
    --username "$MONGO_INITDB_ROOT_USERNAME" \
    --password "$MONGO_INITDB_ROOT_PASSWORD" \
    --quiet --eval '
      const appDb = db.getSiblingDB(process.env.MONGO_APP_DATABASE);
      const user = process.env.MONGO_APP_USERNAME;
      const password = process.env.MONGO_APP_PASSWORD;
      const roles = [{ role: "readWrite", db: process.env.MONGO_APP_DATABASE }];
      if (appDb.getUser(user)) {
        appDb.updateUser(user, { pwd: password, roles });
      } else {
        appDb.createUser({ user, pwd: password, roles });
      }
    '
fi

# Prod keeps raw CS2 polls for 30 days; the operator exports them with deploy/raw-polls-export.sh.
# Only this deploy step owns the index, so local copies never expire.
app_mongosh --eval '
    db.getSiblingDB(process.env.MONGO_APP_DATABASE).cs2_raw_polls.createIndex(
      { receivedAt: 1 },
      { name: "cs2_raw_polls_ttl", expireAfterSeconds: 2592000 },
    );
  ' >/dev/null
