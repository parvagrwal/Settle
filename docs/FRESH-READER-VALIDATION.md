# Fresh-reader three-minute validation

## Research status

**NOT CONDUCTED — no usability claim is made.**

As of 2026-11-10, no external participants were available in the development environment. Zero people were recruited, observed or coached. There are no task-completion rates, participant quotations, confidence scores or time measurements to report. Automated tests and developer walkthroughs do not substitute for this research.

The implementation supplies the information and interactions to be tested; whether five unfamiliar people understand them remains an open usability hypothesis.

## Recruitment requirements

Recruit at least five participants who:

- have never seen Settle;
- did not develop it and are not hackathon teammates acting as substitute customers;
- receive no product explanation before or during the tasks;
- reasonably represent judges, studio owners, studio operations staff, or unfamiliar technical evaluators;
- give informed consent to notes and optional screen recording.

Record role and relevant familiarity, anonymize notes as P1–P5, and do not collect payment credentials. Use only the public demonstration workspace unless a participant already owns an isolated test account.

## Equipment and setup

- Fresh browser profile, desktop viewport, no developer narration.
- Start at `/` in the Demonstration workspace.
- Reset the demo before each participant using an authorized researcher account outside the observed session.
- Keep a visible timer and independent note-taker where possible.
- Record the screen and think-aloud audio only with consent.
- Do not correct terminology, point at controls, or answer navigation questions until the session ends.

## Part A — five-second first impression

Show only the initial Overview for five seconds, then hide it. Ask exactly:

1. “What is this product?”
2. “Who is it for?”
3. “What problem does it solve?”

Record answers verbatim. Do not suggest “studio,” “payment allocation,” “PayPal,” or “agent” in feedback.

## Part B — three-minute task exploration

Reopen the initial screen and start a three-minute timer. Say only:

> “Explore the product and try to answer the tasks on this sheet. Think aloud if you are comfortable. I cannot explain the interface during the test.”

Ask the participant to establish:

| ID | Task | Correct independent conclusion |
|---|---|---|
| Task 1 | Intended audience | Independent/small studios or their payment administrators. |
| Task 2 | Human problem | Coordinating and paying competing approved obligations without manual, opaque allocation. |
| Task 3 | Agent contribution | Recommends/prioritizes approved work within policies; does not approve itself. |
| Task 4 | Payment control | The authenticated workspace owner authorizes payment. |
| Task 5 | Safeguards | Per-payment cap, rolling 168-hour cap, approval expiry and recipient/policy checks. |
| Task 6 | Data provenance | Demo jobs are synthetic; historical receipt is a repository-seeded Sandbox reference, not a live payment. |
| Task 7 | Receipt inspection | Payments & receipts → Inspect receipt. |
| Task 8 | Reconciliation | Historical reference is not independently reconciled; provider confirmation alone would not mean reconciliation. |

Stop at three minutes even if tasks remain incomplete. Record unfinished tasks as failures, not partial successes.

## Observation sheet per participant

| Field | Record |
|---|---|
| Participant ID / role |  |
| Prior product exposure (must be none) |  |
| Task 1–8 correct/incorrect + seconds |  |
| First meaningful navigation path |  |
| Navigation errors/backtracks |  |
| Labels misunderstood |  |
| Incorrect assumptions |  |
| Questions asked |  |
| Confidence per conclusion (1–5) |  |
| Independent product explanation verbatim |  |
| Assistance requested/given (any coaching invalidates independence) |  |

## Acceptance thresholds

- At least 4/5 correctly identify the intended audience.
- At least 4/5 explain the agent’s actual contribution.
- At least 4/5 understand owner approval.
- At least 4/5 distinguish sample/seed records from provider-backed records.
- At least 4/5 locate and interpret a receipt.
- Zero participants mistake an unverified/provider-confirmed payment for a reconciled one.

These are proposed targets, not findings.

## Failure and iteration rule

For every failed threshold:

1. Quote or paraphrase the exact misunderstanding with participant ID.
2. Identify the label, hierarchy, navigation or evidence model responsible.
3. Write a failing regression test where the behavior can be automated.
4. Change the smallest relevant interaction or copy.
5. Run technical and accessibility regressions.
6. Repeat with fresh, uncoached participants where possible.

Do not reuse a coached participant as an independent success. A second session with the same person may measure learnability, but must be labelled separately.

## Results register

| Round | Participants | Date | Threshold result | Evidence location | Status |
|---|---|---|---|---|---|
| 0 | 0 recruited | 2026-11-10 | Not measured | This protocol | Uncompleted |

## Current automated support (not participant evidence)

- Node tests cover the product workspace store, the product API (sessions, approvals, payments, reconciliation), the financial ledger and the allocation rules.
- Direct SQLite inspection confirms the demo workspace, its synthetic jobs, the historical-only receipt and the workspace-isolation triggers.

These automated checks prove the software behaves as described, but they cannot establish human comprehension.
