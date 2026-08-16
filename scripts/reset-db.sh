#!/usr/bin/env bash
#
# Destroys the Postgres container and its volume and recreates both, leaving
# every account and credit card in server/config/finance.config.json at its
# opening balance with no transactions recorded against it.
#
# Transactions are immutable by design, so recreating the volume is the only way
# to clear them. A fresh volume also means init.sql runs again, which is what
# installs the reconciliation trigger; migrations/ only exists for databases
# created before a schema change.
#
#   ./scripts/reset-db.sh          prompts, then resets to an empty ledger
#   ./scripts/reset-db.sh --yes    skips the prompt
#   ./scripts/reset-db.sh --seed   also loads the 35-row sample ledger
#
# Opening balances are not flags here: they live in finance.config.json next to
# the accounts they belong to, so editing them there covers both a reset and the
# first run against an empty database.

set -euo pipefail

CONTAINER=${CONTAINER:-finance-db}
VOLUME=${VOLUME:-finance_pgdata}
IMAGE=${IMAGE:-postgres:16-alpine}
POSTGRES_USER=${POSTGRES_USER:-postgres}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-postgres}
POSTGRES_DB=${POSTGRES_DB:-financedb}
HOST_PORT=${HOST_PORT:-5432}

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

assume_yes=false
seed=false
while [ $# -gt 0 ]; do
  case "$1" in
    --yes|-y) assume_yes=true ;;
    --seed) seed=true ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is not on PATH." >&2
  exit 1
fi

if [ "$assume_yes" = false ]; then
  echo "This deletes container '$CONTAINER' and volume '$VOLUME'."
  echo "Every transaction currently in '$POSTGRES_DB' will be lost."
  read -r -p "Continue? [y/N] " reply
  case "$reply" in
    [yY]|[yY][eE][sS]) ;;
    *) echo "Aborted."; exit 1 ;;
  esac
fi

echo "==> Removing existing container and volume"
docker rm --force "$CONTAINER" >/dev/null 2>&1 || true
docker volume rm "$VOLUME" >/dev/null 2>&1 || true

echo "==> Starting $IMAGE as '$CONTAINER' on port $HOST_PORT"
docker run --name "$CONTAINER" \
  -e POSTGRES_USER="$POSTGRES_USER" \
  -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  -e POSTGRES_DB="$POSTGRES_DB" \
  -p "$HOST_PORT:5432" \
  -v "$ROOT/init.sql:/docker-entrypoint-initdb.d/init.sql:ro" \
  -v "$VOLUME:/var/lib/postgresql/data" \
  -d "$IMAGE" >/dev/null

# During initialisation the image runs a temporary server on the unix socket
# only, so probing over TCP is what tells us init.sql has finished.
echo "==> Waiting for Postgres to accept connections"
for attempt in $(seq 1 60); do
  if docker exec "$CONTAINER" pg_isready -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
    break
  fi
  if [ "$attempt" -eq 60 ]; then
    echo "Postgres did not become ready in 60s. Container logs:" >&2
    docker logs "$CONTAINER" >&2
    exit 1
  fi
  sleep 1
done

psql() { docker exec -i "$CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"; }

server() { (cd "$ROOT/server" && { [ -d node_modules ] || pnpm install; } && pnpm "$@"); }

# init.sql creates the schema and nothing else. Accounts come from the config,
# applied here rather than by waiting for the API to restart. They arrive as
# inserts, which the reconciliation trigger does not watch, so each one starts at
# its opening balance with an empty ledger and no Adjustment row.
echo "==> Creating accounts from server/config/finance.config.json"
server sync-config

if [ "$seed" = true ]; then
  echo "==> Loading the sample ledger"
  server seed
fi

echo "==> Result"
psql -tAc "SELECT '    ' || name || ' (' || kind || '): ' || last_reconciled_balance FROM accounts ORDER BY created_at, name;"
psql -tAc "SELECT '    transactions: ' || count(*) FROM transactions;"

echo "Done."
