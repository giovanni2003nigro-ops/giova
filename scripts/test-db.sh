#!/usr/bin/env bash
# Testet die Supabase-Migrationen gegen ein frisches, temporäres Postgres (ab Version 15).
# Nutzung: npm run test:db
set -euo pipefail
cd "$(dirname "$0")/.."

BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "$BIN/initdb" ] || BIN="$(dirname "$(command -v initdb || command -v pg_ctl)")"
[ -x "$BIN/initdb" ] || { echo "Postgres (initdb) nicht gefunden – PG_BIN setzen."; exit 1; }

DIR="$(mktemp -d)"
PORT="${PG_PORT:-54329}"
AS=()
if [ "$(id -u)" = "0" ]; then
  chown postgres "$DIR"
  AS=(runuser -u postgres --)
fi
cleanup() { "${AS[@]}" "$BIN/pg_ctl" -D "$DIR/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT

"${AS[@]}" "$BIN/initdb" -D "$DIR/data" -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null
"${AS[@]}" "$BIN/pg_ctl" -D "$DIR/data" -o "-p $PORT -k $DIR -c listen_addresses=''" -l "$DIR/log" -w start >/dev/null

export PSQL_ARGS="-h $DIR -p $PORT -U postgres -d postgres"
run() { psql $PSQL_ARGS -v ON_ERROR_STOP=1 -q -X "$@"; }

run -f supabase/tests/00_supabase_stub.sql
for f in supabase/migrations/*.sql; do echo "▸ $f"; run -f "$f"; done
for f in supabase/tests/*.test.sql; do echo "▸ $f"; run -o /dev/null -f "$f"; echo "  ✓ bestanden"; done

echo "▸ Abgleich App ↔ Server (Punkte, Liga-Einstufung, Saisonabschluss)"
DB_PSQL="psql $PSQL_ARGS" npx vitest run src/lib/db.parity.test.ts
