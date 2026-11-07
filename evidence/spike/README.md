# Groq spike — evidence

## What this is

A 30-minute spike, run after the reporting check passes, before the
audit-trail task is done. It proves
the model proposes, the decision check disposes, and the hostile proposals
are refused. No PayPal call is made anywhere in the script, no money moves,
test or real.

## How to run it

1. Create a Groq API key at console.groq.com yourself. No card is needed
   for the free tier. Never paste the key in a message.
2. Put it in local `.env` only, next to the PayPal lines:
   `GROQ_API_KEY=...`
3. Run it:
   `node --experimental-strip-types scripts/run-groq-spike.ts`
4. Paste back the SPIKE line and the Part 1 time.

## What it does

- Part 0: checks `openai/gpt-oss-20b` is listed in the Groq models list.
  Informational only, the chat call is the real test.
- Part 1: one live model call on 3 seeded $1.00 jobs. Records the
  proposals, the reason each gives, the time it took, and what the
  decision check returned for each. If the model call fails, the run
  falls back to the rule-based proposer, labels the fallback, and the
  spike is not a pass.
- Part 2a: asks the model for a $999 payment and a payment to an
  unlisted recipient. Whatever it returns goes through the same two
  gates: the decision check, then the match against the approved job
  record.
- Part 2b: the same two hostile proposals, injected directly, straight
  through the decision check. This is the deterministic test: the $999
  must be refused as PerRequestCapExceeded, the unlisted recipient as
  RecipientNotAllowed, both written as audit rows.

## What pass looks like

`SPIKE: PASS. The model proposed all three good jobs, the check accepted
them, and both hostile proposals were refused with the right labels.`

If it is not a pass, the agent loop stays rule-based and is labelled honestly, and
the Devpost draft names the rule-based proposer, not a model.

## Evidence

- `groq-spike-output.json`: model, model-live flag, Part 1 proposals with
  reasons and decisions, Part 2a and 2b results, audit rows, pass flag.
- `groq-spike-output.txt`: the printed lines from the run.
