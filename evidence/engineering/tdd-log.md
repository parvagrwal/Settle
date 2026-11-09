# TDD execution log

## Slice 1 RED — durable transaction store

Command: `node --test tests/transactionStore.test.ts`

```text
TAP version 13
# node:internal/modules/esm/resolve:275
#     throw new ERR_MODULE_NOT_FOUND(
#           ^
# Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/user/Settle/src/server/transactionStore.ts' imported from /home/user/Settle/tests/transactionStore.test.ts
#     at finalizeResolution (node:internal/modules/esm/resolve:275:11)
#     at moduleResolve (node:internal/modules/esm/resolve:861:10)
#     at defaultResolve (node:internal/modules/esm/resolve:985:11)
#     at \#cachedDefaultResolve (node:internal/modules/esm/loader:747:20)
#     at ModuleLoader.resolve (node:internal/modules/esm/loader:724:38)
#     at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:320:38)
#     at ModuleJob._link (node:internal/modules/esm/module_job:182:49) {
#   code: 'ERR_MODULE_NOT_FOUND',
#   url: 'file:///home/user/Settle/src/server/transactionStore.ts'
# }
# Node.js v22.22.3
# Subtest: tests/transactionStore.test.ts
not ok 1 - tests/transactionStore.test.ts
  ---
  duration_ms: 74.141815
  type: 'test'
  location: '/home/user/Settle/tests/transactionStore.test.ts:1:1'
  failureType: 'testCodeFailure'
  exitCode: 1
  signal: ~
  error: 'test failed'
  code: 'ERR_TEST_FAILURE'
  ...
1..1
# tests 1
# suites 0
# pass 0
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 81.271376
```

## Slice 1 GREEN — durable transaction store

```text
ok 6 - invalid event is rejected atomically without event or transaction rows
  ---
  duration_ms: 0.95662
  type: 'test'
  ...
1..6
# tests 6
# suites 0
# pass 6
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 114.94576
```

## Slice 2 RED — verified webhook API

```text
    async Test.run (node:internal/test_runner/test:1054:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
# Subtest: malformed JSON is not stored even when verifier is available
not ok 4 - malformed JSON is not stored even when verifier is available
  ---
  duration_ms: 4.518404
  type: 'test'
  location: '/home/user/Settle/tests/webhook.test.ts:92:1'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    
    404 !== 400
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 400
  actual: 404
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (file:///home/user/Settle/tests/webhook.test.ts:97:12)
    process.processTicksAndRejections (node:internal/process/task_queues:103:5)
    async Test.run (node:internal/test_runner/test:1054:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
1..4
# tests 4
# suites 0
# pass 0
# fail 4
# cancelled 0
# skipped 0
# todo 0
# duration_ms 225.714424
```

## Slice 2 GREEN — verified webhook API

```text
  duration_ms: 3.951331
  type: 'test'
  ...
1..4
# tests 4
# suites 0
# pass 4
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 264.718528
```

## Slice 3 RED — grounded investigation

```text
#   code: 'ERR_MODULE_NOT_FOUND',
#   url: 'file:///home/user/Settle/src/server/investigation.ts'
# }
# Node.js v22.22.3
# Subtest: tests/investigation.test.ts
not ok 1 - tests/investigation.test.ts
  ---
  duration_ms: 73.599268
  type: 'test'
  location: '/home/user/Settle/tests/investigation.test.ts:1:1'
  failureType: 'testCodeFailure'
  exitCode: 1
  signal: ~
  error: 'test failed'
  code: 'ERR_TEST_FAILURE'
  ...
1..1
# tests 1
# suites 0
# pass 0
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 80.398714
```

## Slice 3 GREEN — grounded investigation

```text
  duration_ms: 0.820951
  type: 'test'
  ...
1..4
# tests 4
# suites 0
# pass 4
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 117.731678
```

## Financial core extracted from patch 3, rebased onto dc72c98 — verified by extraction run, 2026-11-09

Patch 3 (base 4a384d2) was analysed, not applied. Only its financial core was
taken: the durable SQLite ledger, provider-confirmed rolling cap, reservations,
outcome_unknown recovery, and owner-versioned policy. The three files the patch
would have regressed (README, AGENTIC-IMPLEMENTATION.md, comparison.json) were
excluded; comparison.json keeps the live model result from dc72c98.

Strict type check initially failed with 9 errors the author's arena branch did
not catch (its build only type-checked the dashboard): the audit correlation
parameter was inferred as a UUID template type, one untyped row field reached
a SQL call, the active policy missed the required windowMs field, and two
assignments wrote a transaction ID onto a job type that has no such field
(the grid never reads it; the ID already lives in the ledger and the audit
rows). All six fixes are minimal type corrections; no behaviour changed.
After the fixes: strict type check exit 0.

```text
# Node.js v24.22.1
# Full suite: node --test tests/*.test.ts
# tests 194
# pass 194
# fail 0
# Dashboard build: cd app && npm run build, exit 0, built in 3.43s
# Evidence regenerated from these runs, not carried over from the patch:
# evidence/engineering/financial-store.tap (11/11),
# financial-payments.tap (3/3), financial-http-adversarial.tap (7/7),
# plan-execution.tap (4/4), full-regression.tap (194/194),
# frontend-build.txt
```
