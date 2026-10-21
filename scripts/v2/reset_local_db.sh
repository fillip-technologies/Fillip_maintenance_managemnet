#!/bin/sh
# Rebuild the local throwaway Fixly DB from a production dump, then apply every
# Prisma migration. Refuses to touch any database whose name does not start with
# `test_`, so it can never run against the live Hostinger DB.
#
#   scripts/v2/reset_local_db.sh [path/to/dump.sql]
set -eu
[ -f "${1:-../../../u516064072_fixly.sql}" ] || { echo "Dump not found: ${1:-../../../u516064072_fixly.sql}" >&2; exit 1; }

DUMP="${1:-../../../u516064072_fixly.sql}"
. ./.env 2>/dev/null || true
DB_NAME=$(printf '%s' "$DATABASE_URL" | sed -E 's#^[^/]*//[^/]*/([^?]*).*#\1#')

case "$DATABASE_URL" in
  *localhost*|*127.0.0.1*) ;;
  *) echo "DATABASE_URL is not local; refusing." >&2; exit 1 ;;
esac
case "$DB_NAME" in
  test_*) ;;
  *) echo "Database '$DB_NAME' does not start with test_; refusing." >&2; exit 1 ;;
esac

echo "Rebuilding $DB_NAME from $DUMP"
mariadb -e "DROP DATABASE IF EXISTS \`$DB_NAME\`; CREATE DATABASE \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mariadb "$DB_NAME" < "$DUMP"
npx prisma migrate deploy
