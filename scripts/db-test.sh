#!/usr/bin/env bash
# Aplica el shim de Supabase y todas las migraciones sobre un Postgres local y
# despues corre las pruebas de supabase/tests/. Verifica el SQL sin depender de
# la nube ni del CLI de Supabase.
#
#   ./scripts/db-test.sh            aplica migraciones, datos demo y pruebas
#   ./scripts/db-test.sh --schema   solo aplica las migraciones
set -euo pipefail

PGDIR="${KS_PGDIR:-/var/lib/postgresql/ks-test}"
# PGDATA va en un subdirectorio: initdb exige un directorio vacío, y $PGDIR
# tambien guarda el socket y el SQL preparado.
PGDATA="$PGDIR/data"
PGBIN="${KS_PGBIN:-/usr/lib/postgresql/16/bin}"
PORT="${KS_PGPORT:-55432}"
DB="krealo_test"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="$PGDIR/sql"

run_sql() { su postgres -c "$PGBIN/psql -h $PGDIR/run -p $PORT -U postgres $*"; }

# --- Clúster local -----------------------------------------------------------
# El script levanta su propio clúster si hace falta. Antes asumía uno ya
# inicializado y corriendo, así que en una máquina nueva —o en un contenedor que
# se reinició— fallaba con un error de conexión que no decía qué hacer.
#
# Va a $PGDIR y NO a /tmp a propósito: el usuario `postgres` no puede atravesar
# el /tmp privado de esta sesión, y el socket tiene que estar en un directorio
# que sí pueda abrir.
ensure_cluster() {
  mkdir -p "$PGDIR" "$PGDIR/run"
  chown postgres:postgres "$PGDIR" "$PGDIR/run"

  if [ ! -f "$PGDATA/PG_VERSION" ]; then
    echo "== inicializando clúster en $PGDATA =="
    mkdir -p "$PGDATA"
    chown postgres:postgres "$PGDATA"
    chmod 700 "$PGDATA"
    su postgres -c "$PGBIN/initdb -D $PGDATA -U postgres --auth=trust --encoding=UTF8 --locale=C" >/dev/null
  fi

  if su postgres -c "$PGBIN/pg_ctl -D $PGDATA status" >/dev/null 2>&1; then
    return
  fi

  echo "== arrancando Postgres en $PGDIR/run:$PORT =="
  su postgres -c "$PGBIN/pg_ctl -D $PGDATA -l $PGDIR/server.log -o '-p $PORT -k $PGDIR/run -c listen_addresses=' start -w -t 60" >/dev/null

  # `pg_ctl -w` vuelve cuando el servidor acepta conexiones, pero si el arranque
  # falló el error útil está en el log, no en el código de salida.
  if ! run_sql "-d postgres -tAc 'select 1'" >/dev/null 2>&1; then
    echo "Postgres no aceptó conexiones. Últimas líneas de $PGDIR/server.log:" >&2
    tail -20 "$PGDIR/server.log" >&2 || true
    exit 1
  fi
}

if ! command -v "$PGBIN/initdb" >/dev/null 2>&1 && [ ! -x "$PGBIN/initdb" ]; then
  echo "No encuentro PostgreSQL 16 en $PGBIN. Instálalo o define KS_PGBIN." >&2
  exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "Este script usa 'su postgres', así que necesita root." >&2
  exit 1
fi

ensure_cluster

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
