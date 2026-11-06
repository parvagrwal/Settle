#!/bin/bash
# Rejection test — docs/ARCHITECTURE.md Section 7.
# Run with all application processes stopped. No server, no PayPal call,
# no money moved. It runs tests/rejection.test.ts against decide() only.
# Usage: bash scripts/rejection-test.sh
# Output saved to evidence/threat-model/rejection-test-output.txt
set -euo pipefail
cd "$(dirname "$0")/.."
echo "Rejection test — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "No server should be running. Checking PORT 3000..."
if command -v ss >/dev/null 2>&1; then ss -ltn 2>/dev/null | grep -q ":3000" && echo "WARNING: something is listening on 3000" || echo "OK: nothing listening on 3000 (ss)"
elif command -v lsof >/dev/null 2>&1; then lsof -i :3000 >/dev/null 2>&1 && echo "WARNING: something is listening on 3000" || echo "OK: nothing listening on 3000 (lsof)"
else echo "NOTE: ss/lsof not found, check manually that no server is running on PORT 3000"
fi
echo "Policy before test:"
sha256sum src/server/policy.ts src/server/decide.ts || shasum -a 256 src/server/policy.ts src/server/decide.ts
mkdir -p evidence/threat-model
node --test tests/rejection.test.ts 2>&1 | tee evidence/threat-model/rejection-test-output.txt
echo "Policy after test:"
sha256sum src/server/policy.ts src/server/decide.ts || shasum -a 256 src/server/policy.ts src/server/decide.ts
echo "Done. Evidence in evidence/threat-model/rejection-test-output.txt"
echo "Pass = 5 tests pass, 0 fail, policy hash before equals policy hash after."
