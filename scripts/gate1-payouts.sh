#!/usr/bin/env bash
# Gate 1 spike, S1 — Payouts sandbox, curl only, no app code.
# Plan: implementation-plan.md S1. Tracker: S1.1-S1.4.
# Run from the repo root: bash scripts/gate1-payouts.sh
# Needs a local .env with PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET,
# PAYPAL_SANDBOX_RECEIVER_EMAIL. Secrets live in .env only.
# Never paste the Client Secret or access token in chat.
# Never commit evidence/gate1-payouts/token-response.json — it holds a token.
set -u
cd "$(dirname "$0")/.."

EVIDENCE="evidence/gate1-payouts"
mkdir -p "$EVIDENCE"

if [ ! -f .env ]; then
  echo "Missing .env — copy .env.example to .env and fill it in locally."
  exit 1
fi

# shellcheck disable=SC1091
set -a; . ./.env; set +a

for v in PAYPAL_CLIENT_ID PAYPAL_CLIENT_SECRET PAYPAL_SANDBOX_RECEIVER_EMAIL; do
  if [ -z "${!v:-}" ]; then
    echo "Missing $v in .env"
    exit 1
  fi
done

echo "Step 1 — access token"
curl -s -X POST https://api-m.sandbox.paypal.com/v1/oauth2/token \
  -H "Accept: application/json" \
  -u "$PAYPAL_CLIENT_ID:$PAYPAL_CLIENT_SECRET" \
  -d "grant_type=client_credentials" \
  -o "$EVIDENCE/token-response.json" -w "HTTP %{http_code}\n"

PAYPAL_TOKEN=$(python3 -c "import json,sys; print(json.load(open('$EVIDENCE/token-response.json')).get('access_token',''))")
if [ -z "$PAYPAL_TOKEN" ]; then
  echo "No access_token in $EVIDENCE/token-response.json — check credentials (401 = fix and re-run once, NOT a fail)."
  cat "$EVIDENCE/token-response.json"; echo
  exit 1
fi
echo "Token saved to $EVIDENCE/token-response.json (do NOT commit, do NOT paste in chat)."

export BATCH_ID="settle-test-$(date +%s)"
echo "Step 2 — payout batch, BATCH_ID=$BATCH_ID"
curl -s -X POST https://api-m.sandbox.paypal.com/v1/payments/payouts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $PAYPAL_TOKEN" \
  -d "{
    \"sender_batch_header\": {
      \"sender_batch_id\": \"$BATCH_ID\",
      \"email_subject\": \"Settle test payout\"
    },
    \"items\": [
      {
        \"recipient_type\": \"EMAIL\",
        \"amount\": { \"value\": \"1.00\", \"currency\": \"USD\" },
        \"receiver\": \"$PAYPAL_SANDBOX_RECEIVER_EMAIL\",
        \"note\": \"Settle test 1\",
        \"sender_item_id\": \"settle-1\"
      },
      {
        \"recipient_type\": \"EMAIL\",
        \"amount\": { \"value\": \"1.00\", \"currency\": \"USD\" },
        \"receiver\": \"$PAYPAL_SANDBOX_RECEIVER_EMAIL\",
        \"note\": \"Settle test 2\",
        \"sender_item_id\": \"settle-2\"
      }
    ]
  }" \
  -o "$EVIDENCE/payout-create.json" -w "HTTP %{http_code}\n"

python3 -c "import json; d=json.load(open('$EVIDENCE/payout-create.json')); print('payout_batch_id:', d.get('batch_header',{}).get('payout_batch_id')); print('batch_status:', d.get('batch_header',{}).get('batch_status'))" || cat "$EVIDENCE/payout-create.json"

PAYOUT_BATCH_ID=$(python3 -c "import json; print(json.load(open('$EVIDENCE/payout-create.json')).get('batch_header',{}).get('payout_batch_id',''))")
if [ -z "$PAYOUT_BATCH_ID" ]; then
  echo "No payout_batch_id — read $EVIDENCE/payout-create.json. 403 = real fail, flip to KeepSub tonight. 400 duplicate = fresh BATCH_ID, re-run."
  cat "$EVIDENCE/payout-create.json"; echo
  exit 1
fi

echo "Waiting ~60 seconds, then polling..."
sleep 60

echo "Step 3 — poll batch $PAYOUT_BATCH_ID"
curl -s -X GET "https://api-m.sandbox.paypal.com/v1/payments/payouts/$PAYOUT_BATCH_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $PAYPAL_TOKEN" \
  -o "$EVIDENCE/payout-poll.json" -w "HTTP %{http_code}\n"

python3 -c "import json; d=json.load(open('$EVIDENCE/payout-poll.json')); print('batch_status:', d.get('batch_header',{}).get('batch_status'))" || cat "$EVIDENCE/payout-poll.json"

echo "Done. Evidence in $EVIDENCE/ — payout-create.json and payout-poll.json."
echo "Pass = payout_batch_id present, poll shows SUCCESS. UNCLAIMED = receiver is not a sandbox account, swap email, re-run with a fresh BATCH_ID."
echo "Reply to Muse with pass/fail plus error code only: 401, 403, or 400 duplicate."
