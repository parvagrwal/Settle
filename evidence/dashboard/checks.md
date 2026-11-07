# Dashboard checks — mobile and accessibility

Run on the VM, Sat 2026-11-07, in headless Chromium (Playwright) against the
dashboard server with seed jobs and no PayPal credentials. The server was
started with `node --experimental-strip-types src/server/server.ts`, the
dashboard built with `npm run build` in `app/`.

## Mobile check

- One column below 600px: yes. Verified by the 375px screenshot: KPI tiles
  stack, the approval panel stacks, the filter and buttons go full width.
  The layout switch is the `@media (max-width: 600px)` block in
  `app/src/index.css`.
- Body text 16px: yes. Computed style of `body` at 375px width is 16px.
- Tap targets at least 44x44px: yes for every control the app owns, measured
  in the browser at 375px: "Pay approved jobs" 197x48, freelancer select
  325x44, "Use plain grid view" 325x48, "Back to the start" 156x48. The
  dashboard library's own "Filters" button was 210x36; a CSS rule
  (`.studio button { min-height: 44px; }`) lifts it to 210x44, measured after
  the fix. The library also renders a few 0x0 icon buttons; they are
  invisible chrome with no size, not tappable targets.
- No horizontal scroll: yes. Desktop 1280px: scrollWidth 1280, innerWidth
  1280. Mobile 375px: scrollWidth 375, innerWidth 375. The dashboard grid's
  own columns scroll inside the widget on a 375px screen; the page itself
  does not scroll sideways. The plain grid view is one tap away.

## Accessibility check

- Contrast 4.5:1, computed from the exact colours in `app/src/index.css`
  (WCAG relative luminance):
  - body text #16171d on white: 17.88:1
  - muted text #4d4d4d on white: 8.45:1
  - primary button, white on #0b3d91: 10.04:1
  - secondary button, #0b3d91 on white: 10.04:1
  - sandbox badge, #1b5e20 on #e8f5e9: 7.00:1
  - error text, #b00020 on #fdecea: 6.41:1
  - fallback note, #5d4037 on #fff8e1: 8.77:1
  - data badge, #0b3d91 on #e3f2fd: 8.79:1
  All pass 4.5:1.
- Colour never the only meaning: yes. Every status is a word (Paid, Waiting,
  Waiting for owner, Blocked, Unclaimed, Failed). The grid shows the word in
  the Status column, and the waiting queue repeats it in text.
- Keyboard Tab through the flow: yes. Tab moves focus through the page. The
  grid itself uses roving tabindex (arrow keys move between cells), which is
  the grid's standard keyboard pattern. Every button and the freelancer
  select are native controls and reachable by Tab. Focus is always visible
  (`:focus-visible` outline, 3px).
- Visible labels: yes. The freelancer filter has a visible `<label>`. Every
  button carries its own text. No placeholder-only input.

## Fee estimator check

Computed from PayPal's published rates (4.40% + $0.30 + about 3% currency
conversion). The fee is never claimed to be removed.

- $1.00: fee $0.37, net $0.63.
- $200.00: fee $15.10, net $184.90.
- $1,000.00: fee $74.30, net $925.70. Matches the plan's about $74.30 lost
  per $1,000.

## Browser run

- Zero page errors in the whole click-through (landing, dashboard, approve,
  pay attempt, plain grid toggle, mobile).
- Console errors: only two kinds. The dashboard library's trial license
  banner ("License Key Not Found... All AG Studio Core features are unlocked
  for trial"), expected on the 45-day free trial with no key. And one 503
  from the pay attempt, expected: the VM server had no PayPal credentials,
  so paying is off and the page shows the reason on screen.
- Live update: the dashboard polls the server every 5 seconds. The approve
  click updated the panel at once (approve button gone, pay count 2 to 3).
  The pay attempt without credentials failed gracefully on screen:
  "Paying failed: pay is not configured: sandbox credentials are missing,
  set them in local .env only".
- The pay flow itself (live sandbox payment through the dashboard) was
  proved at the HTTP level in `tests/server.test.ts` with a mock PayPal,
  not in the browser: the VM has no PayPal credentials, so the browser
  cannot pay. Parv's run with real sandbox credentials proves it live.

## Fixes made during this check

- The chart threw "No modules have been registered" and blanked the whole
  page. Fixed by registering the chart modules once
  (`ModuleRegistry.registerModules([AllCommunityModule])`) and by putting
  the chart behind its own error boundary, so a chart failure shows a note
  instead of a blank page.
- The pay button counted a job that still needed approval. Fixed: only
  approved, waiting jobs count toward "Pay approved jobs" and the fee
  summary, so the count matches what the pay run will actually pay.
- The grid showed raw status words (`waiting_for_meera`). Fixed: the grid
  now shows the plain-words status ("Waiting for owner").
- The dashboard library was tried in view mode instead of edit mode. The
  grid renders the same, and the edit-mode widget palette is gone. Kept.

## Leak check

The internal-terms grep over the new files returns 3 hits, all the same
real sandbox receipt id `JHG24Y874LK58` in `src/server/seed.ts` (two paid
seed rows and one comment). A receipt id is proof, not an internal term:
the same false-positive class was registered before for receipt ids.
Zero hits in any user-facing string otherwise.
