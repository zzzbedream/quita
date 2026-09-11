# Demo Runbook

Exact sequence for recording, with a fallback for every point that can fail.

---

## Before you start

| Check | Command | Expected |
|---|---|---|
| Contracts build | `npm run build` | compiles |
| Tests green | `npm test` | 79 passing |
| CC3 reachable | `npm run probe` | chainKey 1 = Sepolia, both provers 200 |
| Sepolia balance | in `deploy.origin` output | > 0.05 ETH |
| CC3 balance | in `deploy.creditcoin` output | > 5 CTC |
| Attestor balances | — | both > 0.02 ETH |

Have two browser tabs open, logged out, zoomed to ~150%:

- `https://sepolia.etherscan.io`
- `https://creditcoin-testnet.blockscout.com`

Set `DEMO_CHALLENGE_WINDOW_SECONDS=120` before deploying, so the wait on camera is two minutes,
not 24 hours. The dashboard labels this explicitly — do not hide it, say it out loud.

---

## Recording sequence

### 1. Prove the integration is live (30s, no funds needed)

```bash
npm run probe
```

Point at the ChainInfo output. This is the Creditcoin precompile itself telling you that
`chainKey 1` is Sepolia (`11155111`). It is the cheapest possible proof that the integration is
real and not a diagram.

### 2. Show the safety checks are tested, not claimed (30s)

```bash
npm test -- --grep "rejects"
```

Read two test names aloud:
- `rejects a transaction whose receipt status is not 1`
- `rejects a log emitted by a contract other than QuitaOrigin`

### 3. Full cycle (the main segment)

```bash
npx hardhat run scripts/demo.full.ts --network creditcoin
```

The script narrates itself with per-phase timings. Talk over the two long waits (see below).

Phases, in order: originate on Sepolia → prove → mirror → underwrite → repay → prove → two
attestations → prove both → challenge window → settle → lender paid.

### 4. Show both explorers (60s)

Take the Sepolia tx hash and the Creditcoin tx hash from the output. Open each. **This is the
segment that separates a real demo from an animation:** the same event, on two chains, with no
oracle in between.

### 5. Read the board (30s)

```bash
npx hardhat run scripts/demo.seed.ts --network creditcoin
```

Loss ratio, solvency ratio, claims paid — computed from counters that only moved because
something was proved.

---

## Covering the waits

There are two unavoidable pauses. Both are features, so narrate rather than cut.

**Wait 1 — Ethereum finality plus attestation (~13-15 min).** Longest gap, occurs after each
Sepolia transaction. Talk track:

> "We are waiting for Ethereum finality. This is not our latency — it is the cost of not
> trusting anyone. A centralised oracle would answer in two seconds and you would have to take
> its word for it. What we are waiting for is the moment the fact becomes provable."

Use the time for: the verified-vs-trusted table, the receiptStatus attack vector, the clone
attack, why the beneficiary is the lender.

**Wait 2 — challenge window (2 min as configured).** Talk track:

> "Death is the one thing the protocol cannot verify. So we do not pretend to. Two of three
> attestors, then a window where any of them can block the payout. In production this is 24
> hours; it is a parameter, and I have set it to two minutes so you do not watch me wait."

---

## Failure plan

| Failure | Symptom | Response |
|---|---|---|
| Sepolia RPC rate limit | `429`, `missing response` | Switch `SEPOLIA_RPC_URL` to the backup provider. Keep a second key ready. |
| Prover slow to attest | `waitUntilHeightAttested` hangs past ~20 min | Timeout is 20 min. Say so on camera and cut to a pre-recorded run. **Record one full clean run in advance as insurance.** |
| Prover endpoint down | `getProof` fails | Switch `PROOF_BUILDER_URL` to `https://prover.cc3-testnet.creditcoin.network`. Both answered on 2026-09-11. |
| CC3 tx not confirming | pending > 2 min | Gas is computed, not estimated. Raise the floor in `computeGasLimit` and resubmit. |
| Out of CTC | revert on send | Discord faucet is manual and slow. **Request a surplus the day before.** |
| `UnauthorizedEmitter` revert | consumer rejects a valid-looking proof | The `SOURCE_EMITTER` does not match the deployed `QuitaOrigin`. Redeploy the Creditcoin side after `deployments/sepolia.json` is correct. |
| `Query already processed` | replay guard fires | That transaction was already verified. Emit a fresh one; do not fight it, it is working correctly. |
| Attestor has no ETH | attestation tx fails | Fund both attestor keys before recording. |
| Everything fails | — | Fall back to `npm test` plus `npm run probe` plus the explorer links from a previous run. A passing suite and a live precompile read still demonstrate the integration. |

---

## Non-negotiables

1. **Record one complete clean run before the real take.** It is the insurance policy for the
   whole submission.
2. **Never edit the video to hide a wait.** The wait is the argument.
3. **Say the words "this is trusted" when you reach death attestation.** Declaring the limitation
   is worth more than having it found.
4. **Show both explorers.** Without that, it is an animation.
