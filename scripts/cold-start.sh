#!/usr/bin/env bash
# One-command setup for Settle: install, build the dashboard, start the server.
# Run from anywhere: bash scripts/cold-start.sh
# Needs Node.js 22 or newer. No account is needed to look at the dashboard.
# To pay live in the sandbox, fill in .env first (copy .env.example) and run again.
# The server stays in the foreground. Open http://localhost:3000/ in a browser.
# Stop it with Ctrl+C.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is missing. Install Node.js 22 or newer, then run this script again."
  exit 1
fi
node_major="$(node --version | sed 's/^v//; s/\..*//')"
if [ "$node_major" -lt 22 ]; then
  echo "Node.js $(node --version) is too old. Settle needs Node.js 22 or newer."
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "npm is missing. Install npm (it comes with Node.js), then run this script again."
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "No .env file found, so a blank one was made from .env.example."
  echo "It holds key names only, no values. The dashboard will open with seeded demo data."
  echo "To pay live in the sandbox, fill in the keys in .env and run this script again."
fi

db_path="${SETTLE_DB_PATH:-}"
if [ -z "$db_path" ] && [ -f .env ]; then
  db_path="$(grep -E '^SETTLE_DB_PATH=' .env | tail -n 1 | cut -d= -f2- | tr -d '[:space:]' || true)"
fi
db_path="${db_path:-data/settle.db}"
if [ "$db_path" != ":memory:" ]; then
  echo "Resetting local database ($db_path) for a clean 8-row demo start..."
  rm -f "$db_path" "${db_path}-wal" "${db_path}-shm"
fi

echo "Installing dependencies... (first run takes about a minute in total)"
npm install
cd app
npm install
echo "Building the dashboard..."
npm run build
cd ..

echo ""
echo "Starting the server. Open http://localhost:${PORT:-3000}/ in a browser."
echo "What to check: the landing page loads; the 8-row demonstration grid"
echo "(4 paid, 2 waiting, 1 over the cap, 1 waiting for approval) is at /legacy."
echo "Paying stays off until .env has keys."
exec npm start
