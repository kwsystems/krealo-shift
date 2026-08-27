#!/usr/bin/env bash
# Aplica el shim de Supabase y todas las migraciones sobre un Postgres local y
# despues corre las pruebas de supabase/tests/. Verifica el SQL sin depender de
# la nube ni del CLI de Supabase.
#
#   ./scripts/db-test.sh            aplica migraciones, datos demo y pruebas
#   ./scripts/db-test.sh --schema   solo aplica las migraciones
set -euo pipefail

PGDIR="${KS_PGDIR:-/var/lib/postgresql/ks-test}"
PGBIN="${KS_PGBIN:-/usr/lib/postgresql/16/bin}"
PORT="${KS_PGPORT:-55432}"
DB="krealo_test"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="$PGDIR/sql"

run_sql() { su postgres -c "$PGBIN/psql -h $PGDIR/run -p $PORT -U postgres $*"; }

mkdir -p "$STAGE"
cp "$REPO/supabase/tests/"*.sql "$STAGE/" 2>/dev/null || true
cp "$REPO/supabase/migrations/"*.sql "$STAGE/" 2>/dev/null || true
[ -f "$REPO/supabase/seed.sql" ] && cp "$REPO/supabase/seed.sql" "$STAGE/"
chown -R postgres:postgres "$STAGE"

echo "== recreando base $DB =="
run_sql "-d postgres -tAc 'drop database if exists $DB'" >/dev/null
run_sql "-d postgres -tAc 'create database $DB'" >/dev/null

echo "== shim de Supabase =="
run_sql "-d $DB -q -v ON_ERROR_STOP=1 -f $STAGE/00_supabase_shim.sql"

echo "== migraciones =="
for f in $(ls "$REPO/supabase/migrations/"*.sql | sort); do
  base="$(basename "$f")"
  printf '   %s ... ' "$base"
  run_sql "-d $DB -q -v ON_ERROR_STOP=1 -f $STAGE/$base"
  echo "ok"
done

if [ "${1:-}" = "--schema" ]; then
  echo "== solo esquema, listo =="
  exit 0
fi

if [ -f "$REPO/supabase/seed.sql" ]; then
  echo "== datos demo =="
  run_sql "-d $DB -q -v ON_ERROR_STOP=1 -f $STAGE/seed.sql"
fi

echo "== pruebas =="
for f in $(ls "$REPO/supabase/tests/"*.sql | sort | grep -v 00_supabase_shim); do
  base="$(basename "$f")"
  printf '   %s\n' "$base"
  run_sql "-d $DB -q -v ON_ERROR_STOP=1 -f $STAGE/$base"
done
echo "== todo verde =="
