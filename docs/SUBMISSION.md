# Submission answer sheet — BUIDL CTC 2026 Fall

Everything the submission form asks for, in the order it asks. Fields marked
**`TODO(BLOQUEO)`** need something only a human can supply (identity data, a recorded video,
testnet funds) and are listed again under [Open blockers](#open-blockers).

Deadline discipline: submit **before 18:00 ET Sunday 13**, not at 23:00.

---

## Critical path — what is actually left

Ordered by dependency. Everything above the line must happen in sequence; everything below it can
be done while waiting.

### Blocking, in order

- [x] **1. Sepolia ETH.** Topped up to 0.0511 ETH. `npm run preflight` returns **GO** on both
      chains (27x the measured cost).
- [x] **2. `PRIVATE_KEY` in `.env`** — set and gitignored.
- [x] **3. `npm run deploy:origin`** — `QuitaOrigin` live on Sepolia at
      `0xc7624150c28bF26cdF920A0715a7c0ba614faE16`, block 11,699,031.
- [x] **4. `npm run deploy:creditcoin`** — five contracts live on CC3, block 5,483,325, emitter
      pinned to the origin address above, `challengeWindow=120s` for the demo.
- [x] **5. `npm run emit:demo`** — real `LoanDisbursed` emitted in Sepolia block 11,699,049,
      status 1. Tx `0xabafe0f2866dd4e63e5afe982b33b046cfdfc9cc24ab11431eb5ef7a952435dd`.
- [x] **6. `verify:e2e` — PASSED ON THE FIRST ATTEMPT against the real prover.** 468.3s total,
      452.6s of it Ethereum finality. Proof: 8 siblings, 2 continuity roots. Verified in CC3
      block 5,483,358, gasUsed 257,039. Creditcoin tx
      `0xb7f0eb0d95a80c35b8ecc75c93e28033159df053468a89c7d4b9a2bb60c0932b`.
- [x] **7. Deployed-addresses table** in `README.md` — filled in with explorer links.
- [x] **7b. Capital seeded on live CC3** — 1,000,000 qUSD deposited, so the dashboard reads
      reserves 1,000,000 and solvency 10.00x against the real testnet rather than zeros.
      `demo.seed.ts` deliberately does not touch `LoanMirror`: loan state is reachable only
      through a verified proof.
- [ ] **8. Record the video.** Mandatory form field. Script: [`VIDEO_SCRIPT.md`](VIDEO_SCRIPT.md),
      talking points and judge Q&A: [`PITCH.md`](PITCH.md). Real hashes now exist for both
      explorers — see the table in the README.
- [ ] **9. Submit**, with the field text from this document.

### Non-blocking, do while waiting for finality

- [ ] Identity fields below — name, bio, country of residence, country of citizenship.
- [ ] Decide the PDF hosting for the deck (raw GitHub link may be enough).
- [ ] Run the secret-hygiene commands at the end of this document.
- [ ] Push the repo public and confirm the raw logo/deck URLs resolve.

### Fallback if step 6 will not cooperate — no longer needed

Step 6 passed. Kept for the record.

The requirement "must be deployed on a testnet" is **already satisfied** — six contracts are live
on two testnets with verifiable addresses. Step 6 is about proving the cross-chain path
end to end, which is the scoring criterion, not the eligibility one.

If the attestation does not land in time: say so plainly rather than implying otherwise. The
deployment is real, `npm run probe` shows the live precompile surface answering, and
`scripts/demo.local.ts` demonstrates the full cycle including the five rejected attacks. A
truthful "the proof was in flight at submission time, here is the tx and here is the contract
waiting for it" is worth more than a vague claim of success.

### Already done

- [x] **Deployed on two testnets** — the hard eligibility requirement, satisfied.
- [x] **Cross-chain verification proved end to end on live testnet.** Both tx hashes are in the
      README and on public explorers. This is the scoring criterion, not just eligibility.
- [x] 6 contracts, 4 events verified through 3 consumers.
- [x] 79 tests passing in ~1s, `tsc --noEmit` clean.
- [x] `npm run probe` confirms live: CC3 chainId 102031, ChainInfo reports `chainKey 1` =
      Sepolia, both Proof Builder endpoints answer 200.
- [x] `npm run preflight` — pre-deployment gas gate, so a half-finished deployment is not
      possible by accident.
- [x] `docs/ATTESTCOIN_INTEGRATION.md` — the document that scores.
- [x] Deck PDF, video script, demo runbook, pitch + judge Q&A.
- [x] Project overview page and live dashboard with wallet-gated LP panel.
- [x] Logo (SVG + PNG).

---

## Project information

### Project Name

    Quita

### Project Logo

`docs/brand/quita-logo.svg` · `docs/brand/quita-logo.png` (1280x320)

The form wants a URL. Once the repo is public these resolve:

    https://raw.githubusercontent.com/zzzbedream/quita/main/docs/brand/quita-logo.png
    https://raw.githubusercontent.com/zzzbedream/quita/main/docs/brand/quita-logo.svg

### Project Sector

    RWA (real-world asset) — insurance infrastructure

Secondary, if more than one may be selected: DeFi.

### Project Description

Short form (~50 words):

    Quita is on-chain infrastructure for credit life insurance — the cover that extinguishes a
    borrower's debt on death instead of passing it to the family. It reconstructs the insured
    balance on Creditcoin from cryptographically proved Ethereum events, so the loss ratio,
    reserves and solvency become computations anyone can verify rather than disclosures.

Long form (~180 words):

    Credit life insurance ("seguro prestamista" in Brazil, "desgravamen" across Spanish-speaking
    Latin America) is compulsory in practice for most consumer credit, and one of the least
    transparent lines in the market. The recurring complaints are a low share of premium returned
    as claims and a large share captured as distribution commission — and no way for anyone
    outside the insurer to check either figure. The structural problem is verifiability: a loss
    ratio is a disclosure about numbers nobody else can see.

    Quita is not an insurer. It is infrastructure a lender can put underneath a credit life book
    so the numbers become checkable. Loan events originate on Ethereum Sepolia; all insurance
    logic runs on Creditcoin CC3, where the Attestcoin BlockProver precompile verifies Merkle
    inclusion of those Ethereum transactions synchronously, inside the Creditcoin transaction,
    with no oracle operator in between. The insured balance, premium collected and claims paid
    are therefore on-chain counters that only move when something was proved, and the loss ratio
    is a view function over verified state.

### Attestcoin Protocol Integration Summary

    Quita's entire trust model rests on the Attestcoin Protocol. QuitaOrigin on Ethereum Sepolia
    (chainKey 1) is a minimal contract that only emits events. An off-chain worker observes them,
    builds inclusion proofs with @gluwa/usc-sdk, and submits them to Creditcoin CC3, where the
    BlockProver precompile at 0x0000000000000000000000000000000000000FD2 verifies them
    synchronously inside the transaction. State only mutates if the precompile returns true.

    All four source events are verified, landing in three consumer contracts: LoanDisbursed and
    RepaymentMade into LoanMirror, PremiumPaid into PolicyRegistry, DeathAttested into
    ClaimEngine. Every consumer derives from QuitaConsumer, which extends ASCBase from
    @gluwa/asc-contracts 0.2.1.

    We hardened three things the precompile deliberately does not do. It does not check whether
    the source transaction succeeded, so we decode the receipt and revert on receiptStatus != 1 —
    omitting this would let a reverted transaction's simulated logs settle a fraudulent claim. It
    does not tell you who emitted the log, so we validate the emitter address, not just the event
    signature, or anyone could deploy a clone of QuitaOrigin and emit whatever they liked. And we
    pin chainKey to the source chain rather than trusting a caller-supplied value.

    That last point exposed a gap: ASCBase.execute is external and not virtual, so it cannot be
    overridden and does not pass chainKey to the handler. Our entrypoint is therefore
    executeFromSource, with the inherited execute left deliberately inert (it reverts with
    DirectExecuteDisabled). This is written up in docs/ATTESTCOIN_INTEGRATION.md.

    The design is explicit about the boundary of what proofs can do. Death is a fact about the
    world; no protocol can verify it, so the death attestation is trusted, mitigated by a 2-of-3
    attestor threshold and a challenge window. But the financially consequential quantity is
    never trusted: payout = min(sumInsured, loanMirror.outstanding(loanId)), read from proved
    state, never from the attestation. An attestor who lies about the amount changes nothing.

    Writability (Creditcoin -> Ethereum) is not used: the documentation states it is undergoing
    third-party testing and audits, so the integration is read-only Ethereum -> Creditcoin.

    This is live, not a description. On 2026-09-13 a loan disbursed on Sepolia (tx
    0xabafe0f2866dd4e63e5afe982b33b046cfdfc9cc24ab11431eb5ef7a952435dd, block 11699049) was
    reconstructed on Creditcoin (tx
    0xb7f0eb0d95a80c35b8ecc75c93e28033159df053468a89c7d4b9a2bb60c0932b, block 5483358) through a
    proof with 8 Merkle siblings and 2 continuity roots, verified by the precompile for 257,039
    gas. End-to-end latency was 468 seconds, 453 of which were Ethereum finality. Both
    transactions are on public explorers.

### GitHub Repository URL

    https://github.com/zzzbedream/quita

Includes a README. OK

### Project Deck or Whitepaper (PDF URL)

Deck built: `docs/deck/Quita-Deck.pdf` (10 slides, generated from `docs/deck/deck.html`).

Once the repo is public:

    https://raw.githubusercontent.com/zzzbedream/quita/main/docs/deck/Quita-Deck.pdf

Note: GitHub raw serves PDFs as a download rather than an inline preview. If reviewers need an
inline view, upload the same file to Drive/Dropbox and use that link instead.

### Prototype Demo Video URL

**`TODO(BLOQUEO)`** — not recorded yet. Script ready at [`docs/VIDEO_SCRIPT.md`](VIDEO_SCRIPT.md),
runbook at [`docs/DEMO_RUNBOOK.md`](DEMO_RUNBOOK.md). 3-4 minutes, showing real hashes in both
explorers. **This is a mandatory form field — the one deliverable that cannot be skipped.**

---

## Team information

Team size: **1**.

| Field | Value |
|---|---|
| First & Last Name | **`TODO(BLOQUEO)`** |
| Email | `zzzbedream@gmail.com` |
| Telegram ID | optional — **`TODO`** |
| X / Twitter | optional — **`TODO`** |
| LinkedIn | optional — **`TODO`** |
| Resume (PDF URL) | optional — **`TODO`** |
| Short Bio | **`TODO(BLOQUEO)`** — draft below |
| Role within the team | Sole developer — architecture, contracts, worker, frontend, docs |
| Country of Residence | **`TODO(BLOQUEO)`** |
| Country of Citizenship | **`TODO(BLOQUEO)`** |

### Team Size

    1

Minimum is 1, so a solo entry is valid with no explanation needed.

Bio draft, to correct rather than invent (the personal specifics are deliberately left blank):

    Solo developer. Built Quita end to end for this hackathon: six Solidity contracts, an
    off-chain proving worker with crash-resumable state, 79 tests, and the technical
    documentation. Interested in where insurance actuarial practice meets verifiable
    computation — particularly the lines of cover where the customer has no way to audit
    what they are paying for.

---

## Project requirements checklist

| Requirement | Status |
|---|---|
| Original work created during the hackathon | OK |
| Deployed on a testnet | **`TODO(BLOQUEO)`** — see below |
| Integrates the Attestcoin Protocol as a core feature | OK — it is the trust model, not a feature |
| Respects third-party IP | OK — MIT; dependencies are `@gluwa/*`, OpenZeppelin, Hardhat |
| Technical documentation of the integration | OK — [`ATTESTCOIN_INTEGRATION.md`](ATTESTCOIN_INTEGRATION.md) |
| Working integration code in the project | OK — `contracts/creditcoin/`, `worker/src/` |

---

## Terms & Conditions

The form asks you to affirm two things. Both are worth checking rather than clicking through.

### "All submitted information is accurate and truthful"

This is the reason every market figure in this project carries a source caveat, every mock is
labelled a mock, and the death attestation is described as trusted rather than verified. The
things to keep true when filling the form:

- Do **not** describe the death attestation as verified. It is trusted, with a 2-of-3 threshold
  and a challenge window.
- Do **not** present the ~18% loss-ratio or 87% commission figures as audited. They come from
  Tema 972 litigation analysis and are pending cross-check against public SUSEP statistics.
- Do **not** imply the settlement asset or mortality table are real. Both are declared
  placeholders, marked as such in the contract source.
- The deployed-addresses table in the README must match what is actually on testnet.

### "They possess full rights and ownership to use all code, content, and materials submitted"

Our own code is MIT. Third-party components and their basis for use:

| Component | Licence / basis |
|---|---|
| OpenZeppelin Contracts | MIT |
| `@gluwa/asc-contracts`, `@gluwa/usc-sdk` | Published by the protocol for this purpose |
| Hardhat, ethers v6, TypeScript | MIT |
| `EvmV1Decoder.sol` | Adapted from Gluwa's public reference repo, noted in the file |
| Inter, JetBrains Mono, Space Grotesk | SIL Open Font License / Apache 2.0 |
| ethers UMD build via cdnjs | MIT |
| Logo (`docs/brand/`) | Original, made for this project |
| Deck (`docs/deck/`) | Original, generated from our own `deck.html` |

**One item to confirm before you affirm this clause:** the project overview page (`index.html`)
was drafted with Google Stitch and then substantially rewritten here — the market-figure
caveats, the declared-limitations section and the responsive fixes are ours, but the initial
layout and copy came from a generative tool. Google's terms for Stitch output do assign rights to
the user, so this is almost certainly fine, but it is your affirmation to make, not mine. If you
would rather not rely on it, the dashboard (`frontend/index.html`) is entirely hand-written and
the overview page can be dropped without affecting any requirement — it is not a scored
deliverable.

No third-party trademarks are used. "Creditcoin" and "Attestcoin" appear only as factual
references to the platform being integrated.

---

## Open blockers

Ordered by how much they put the submission at risk.

### 1. Testnet deployment — hard requirement, partially funded

"Must be deployed on a testnet" is not optional.

Funding status for `0x4e5A7B9F7F66c208bDDeD352356B33a3A634AD6D`, measured 2026-09-12:

| Chain | Balance | Verdict |
|---|---|---|
| Creditcoin CC3 Testnet (102031) | **9,999.47 CTC** | Solved. Not a constraint. |
| Ethereum Sepolia (11155111) | **0.00113 ETH** | Marginal — top up before starting. |

Measured Sepolia cost, from real gas on locally deployed bytecode:

| Item | Gas |
|---|---|
| `QuitaOrigin` deployment | 646,181 |
| `setLender` + `setAttestor` | 95,582 |
| `disburse` (the demo tx) | 140,092 |
| **Total** | **881,855** |

At 1.0 gwei that is 0.0009 ETH and the balance covers it with ~25% spare. At 2 gwei it does not.
Sepolia gas is volatile and the failure mode is bad: running out *after* `QuitaOrigin` is
deployed but *before* `disburse` leaves nothing for the worker to prove. Top up first from
`sepolia-faucet.pk910.de` (browser PoW, no mainnet balance required) or the Google Cloud Web3
faucet (0.05 ETH/day).

Then, in order:

```bash
npm run deploy:origin        # QuitaOrigin -> Sepolia
npm run deploy:creditcoin    # consumers -> CC3, emitter pinned to the above
npm run emit:demo            # emits a real LoanDisbursed, prints the txHash
DEMO_TX_HASH=0x... npm run verify:e2e
```

`verify:e2e` has **never been run against the real prover** — only against the local mock. Budget
time for it to fail on first contact. Finality on Sepolia is ~12.8 min, so a single end-to-end
attempt is not a fast loop.

Then fill in the **Deployed addresses** table in the README, which currently reads
_pending deployment_.

Fallback if the full chain will not cooperate: reduce to **one** verified event
(`LoanDisbursed`). One event genuinely verified on testnet is worth more than four half-done.

### 2. Demo video — mandatory form field

Cannot be substituted. If time collapses, sacrifice the deck before the video.

### 3. Identity fields

Name, bio, countries of residence and citizenship. Cannot be invented.

### 4. Hosting for the PDF

Only if raw GitHub links are not acceptable to reviewers.

---

## Pre-submission checks

```bash
npm test                      # expect 79 passing, <30s
npx tsc --noEmit              # expect clean
npm run probe                 # read-only; confirms 0xFD2/ChainInfo respond, no funds needed
```

Then, with a local node running, the demo and both pages:

```bash
npx hardhat node                                          # terminal 1
npx hardhat run scripts/demo.local.ts --network localhost # terminal 2
npx http-server . -p 8080                                 # terminal 3
# http://localhost:8080/                              -> overview
# http://localhost:8080/frontend/index.html?net=local -> live dashboard
```

**Secret hygiene — do this properly, not by glancing:**

```bash
# a real .env must never appear; .env.example is expected and fine
git log --all --full-history --oneline -- .env               # must be empty
git ls-files | grep -iE "(^|/)\.env$|secret|keystore|\.pem$|\.key$"  # must be empty

# candidate private keys. Expect only: .env.example placeholder zeros, and the
# keccak256 event-signature constants in contracts/creditcoin/*.sol
git grep -nE "[a-fA-F0-9]{64}" -- . ":!*.md" ":!test/*" ":!package-lock.json"

# provider URLs with a live key baked in
git grep -nE "(infura|alchemy|etherscan)[a-z]*\.(io|com)/v?[0-9]?/[A-Za-z0-9_-]{15,}"   -- . ":!package-lock.json"    # must be empty
```

Confirm `.gitignore` still covers `.env`, `deployments/localhost.json`, `.claude/`, `.stitch/`.

## Declared limitations — state these in the form, do not wait to be asked

Each one declared by us is worth more than the same one found by a judge.

1. The **death attestation is trusted** — 2-of-3 threshold and challenge window mitigate it; they
   do not eliminate it. Attestor bonds and slashing are roadmap.
2. The **stablecoin is a mock** (`MockStable`, freely mintable, 6 decimals, no value).
3. The **mortality table is a declared placeholder** — `TABLE_SOURCE = "PLACEHOLDER - pending
   BR-EMS 2021 (SUSEP)"`. Plausible magnitudes, not actuarial output.
4. **We are not the insurer.** Infrastructure for lenders and insurers; no licence, no underwriting.
5. **Testnet only**, with a demo-shortened challenge window exposed as an event-emitting owner
   parameter, not a special case in settlement.
6. **Premium accrual is simplified** to a 30-day month, single portfolio rate per band.
7. **Market figures are unaudited** — drawn from Tema 972 litigation analysis and industry
   commentary, pending cross-check against public SUSEP statistics. Presented as order of
   magnitude. Nothing in the protocol depends on them being exact.
