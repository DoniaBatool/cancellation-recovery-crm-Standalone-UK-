#!/usr/bin/env bash
# Runs the REAL migrations on a throwaway local Postgres and checks Row Level Security
# with simulated Supabase roles. Exit 0 + "RLS_ALL_OK" = pass. Exit 3 = no local Postgres.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)}"

if [ -z "${PG_BIN}" ] || [ ! -x "${PG_BIN}/initdb" ]; then
  echo "RLS_SKIPPED: no local PostgreSQL server found (set PG_BIN to its bin directory)"
  exit 3
fi

# Postgres refuses to run as root, so drop to another user when needed.
RUN_AS=()
if [ "$(id -u)" = "0" ]; then
  RUN_AS=(runuser -u "${PG_RUN_USER:-claude}" --)
fi

TMP="$(mktemp -d)"
if [ "$(id -u)" = "0" ]; then chown -R "${PG_RUN_USER:-claude}" "$TMP"; fi
PGDATA="$TMP/data"
SOCK="$TMP/sock"
mkdir -p "$SOCK"
if [ "$(id -u)" = "0" ]; then chown -R "${PG_RUN_USER:-claude}" "$SOCK"; fi

cleanup() {
  "${RUN_AS[@]}" "$PG_BIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

"${RUN_AS[@]}" "$PG_BIN/initdb" -D "$PGDATA" -A trust -U postgres >/dev/null
"${RUN_AS[@]}" "$PG_BIN/pg_ctl" -D "$PGDATA" \
  -o "-c listen_addresses='' -c unix_socket_directories=$SOCK -c fsync=off" \
  -w -l "$TMP/pg.log" start >/dev/null

psql_run() {
  "${RUN_AS[@]}" "$PG_BIN/psql" -h "$SOCK" -U postgres -v ON_ERROR_STOP=1 -q -X "$@"
}

psql_run -d postgres -c "CREATE DATABASE rlstest" >/dev/null
psql_run -d rlstest -f "$ROOT/tests/sql/supabase-stub.sql" >/dev/null

for f in "$ROOT"/supabase/migrations/*.sql; do
  psql_run -d rlstest -f "$f" >/dev/null
done

psql_run -d rlstest -t -A -f "$ROOT/tests/sql/rls-assertions.sql" | tail -1
