#!/usr/bin/env bash
#
# Brings the whole stack up locally: the Postgres container, the API, and the
# Vite dev server, with both logs streamed to this terminal and both shut down
# together on Ctrl-C.
#
#   ./scripts/dev.sh              starts everything
#   ./scripts/dev.sh --no-db      assumes Postgres is already running
#
# Unlike scripts/reset-db.sh this never destroys anything. An existing container
# is started back up with its volume intact, so the ledger survives a restart.
# The container is also left running on exit, since it is a service the rest of
# your tooling talks to rather than part of this session.

set -euo pipefail

# Job control puts each background child in its own process group, which is what
# lets the cleanup below take down pnpm and the node process it spawns together
# rather than orphaning the one doing the actual work.
set -m

CONTAINER=${CONTAINER:-finance-db}
VOLUME=${VOLUME:-finance_pgdata}
IMAGE=${IMAGE:-postgres:16-alpine}
POSTGRES_USER=${POSTGRES_USER:-postgres}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-postgres}
POSTGRES_DB=${POSTGRES_DB:-financedb}
HOST_PORT=${HOST_PORT:-5432}
API_PORT=${API_PORT:-3001}
WEB_PORT=${WEB_PORT:-8443}

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

start_db=true
while [ $# -gt 0 ]; do
  case "$1" in
    --no-db) start_db=false ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is not on PATH." >&2
  exit 1
fi

# ── Postgres ─────────────────────────────────────────────────────────────────

if [ "$start_db" = true ]; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "docker is not on PATH. Start Postgres yourself and rerun with --no-db." >&2
    exit 1
  fi

  if ! docker info >/dev/null 2>&1; then
    echo "The Docker daemon is not responding. Is Docker Desktop running?" >&2
    exit 1
  fi

  if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
    echo "==> Postgres container '$CONTAINER' is already running"
  elif docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
    echo "==> Starting the existing '$CONTAINER' container"
    docker start "$CONTAINER" >/dev/null
  else
    echo "==> Creating '$CONTAINER' from $IMAGE on port $HOST_PORT"
    docker run --name "$CONTAINER" \
      -e POSTGRES_USER="$POSTGRES_USER" \
      -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
      -e POSTGRES_DB="$POSTGRES_DB" \
      -p "$HOST_PORT:5432" \
      -v "$ROOT/init.sql:/docker-entrypoint-initdb.d/init.sql:ro" \
      -v "$VOLUME:/var/lib/postgresql/data" \
      -d "$IMAGE" >/dev/null
  fi

  # On a first run the image serves over the unix socket only until init.sql has
  # finished, so probing over TCP is what tells us the schema is actually there.
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
fi

# ── Dependencies ─────────────────────────────────────────────────────────────

[ -d "$ROOT/node_modules" ] || (echo "==> Installing frontend dependencies" && pnpm install)
[ -d "$ROOT/server/node_modules" ] || (echo "==> Installing API dependencies" && cd "$ROOT/server" && pnpm install)

if [ ! -f "$ROOT/server/.env" ] && [ -f "$ROOT/server/.env.example" ]; then
  echo "==> Creating server/.env from .env.example"
  cp "$ROOT/server/.env.example" "$ROOT/server/.env"
fi

# The API does this on startup too, but doing it here means a new account, card,
# or category shows up in the first page load rather than after a reload.
echo "==> Applying server/config/finance.config.json"
(cd "$ROOT/server" && pnpm sync-config)

# ── Dev servers ──────────────────────────────────────────────────────────────

pids=()

cleanup() {
  trap - EXIT INT TERM
  echo
  echo "==> Stopping dev servers"
  for pid in ${pids[@]+"${pids[@]}"}; do
    # Negative PID targets the whole process group, so pnpm's node child goes
    # down with it instead of holding the port open.
    kill -- "-$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  echo "The '$CONTAINER' container is still running. Stop it with: docker stop $CONTAINER"
}
trap cleanup EXIT INT TERM

start() {
  label=$1
  directory=$2
  (cd "$directory" && pnpm dev 2>&1 | awk -v l="$label" '{ printf "[%s] %s\n", l, $0; fflush() }') &
  pids+=($!)
}

echo "==> Starting the API on http://localhost:$API_PORT"
start api "$ROOT/server"

echo "==> Starting the dashboard on http://localhost:$WEB_PORT"
start web "$ROOT"

echo
echo "Both servers are starting. Press Ctrl-C to stop them."
echo

# `wait -n` would be the natural way to notice a crash, but it needs bash 4.3
# and macOS still ships 3.2, so this polls instead. Either server going down
# takes the other with it rather than leaving a half-running stack behind.
while :; do
  for pid in "${pids[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "A dev server exited. Shutting the other one down." >&2
      exit 1
    fi
  done
  sleep 1
done
