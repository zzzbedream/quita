# Quita

**On-chain credit life insurance with a loss ratio you can verify instead of believe.**

Built for **BUIDL CTC 2026 Fall** · Track: **RWA** · Powered by the **Attestcoin Protocol**

---

## The problem

Credit life insurance ("seguro prestamista" in Brazil, "seguro de desgravamen" across Spanish-
speaking Latin America) pays off a borrower's debt when the borrower dies, so the debt does not
land on the family. It is compulsory in practice for most consumer credit, and it is one of the
most profitable and least transparent lines in the market.

The recurring complaints are the same everywhere: a low share of premium returned as claims, a
large share captured as commission by the distributing bank, and no way for anyone outside the
insurer to check either number. In Brazil the practice of tying the policy to the loan has been
the subject of sustained litigation.

> Market figures cited in the deck are drawn from analysis of the Tema 972 litigation and
> industry commentary, and are **pending cross-check against public SUSEP statistics**. They are
> presented as an order of magnitude, not as audited data.

The structural issue is verifiability. A loss ratio is a disclosure, and a disclosure is a claim
about numbers nobody else can see.

## What Quita does

Quita is not an insurer. It is infrastructure a lender can put underneath a credit life book so
that the numbers become checkable:

- The **insured balance** is reconstructed on Creditcoin from Ethereum events whose inclusion was
  cryptographically proved. It cannot be asserted by an operator.
- **Premium collected** and **claims paid** are on-chain counters that only move when something
  was proved.
- The **loss ratio** and **solvency ratio** are therefore functions of verified inputs, readable
  by anyone, continuously.

```solidity
function lossRatioWad() external view returns (uint256) {
    if (totalPremiumsCollected == 0) return 0;
    return totalClaimsPaid.wdiv(totalPremiumsCollected);
}
```

## Architecture

Two chains, with a deliberate split:

| | Ethereum Sepolia | Creditcoin CC3 Testnet |
|---|---|---|
| Role | Source of truth for loan events | All insurance logic |
| Contract | `QuitaOrigin` — events only | `LoanMirror`, `PolicyRegistry`, `CapitalPool`, `ClaimEngine` |
| Trust | Standard EVM | Reads Ethereum **trustlessly** via `0xFD2` |

The loan lives on one chain and the cover lives on another, and the cover must never be able to
invent the number it is insuring. That is precisely what the Attestcoin Protocol provides: the
BlockProver precompile verifies Merkle inclusion and continuity of an Ethereum transaction
**synchronously, inside the Creditcoin transaction**, with no oracle operator in between.

All four source events are verified, landing in three consumer contracts:

| Event | Consumer | Effect |
|---|---|---|
| `LoanDisbursed` | `LoanMirror` | Creates the mirrored loan |
| `RepaymentMade` | `LoanMirror` | Updates the outstanding balance |
| `PremiumPaid` | `PolicyRegistry` | Credits premium to the pool |
| `DeathAttested` | `ClaimEngine` | Counts toward the 2-of-3 threshold |

**The full technical write-up is [`docs/ATTESTCOIN_INTEGRATION.md`](docs/ATTESTCOIN_INTEGRATION.md)** —
attack vectors closed, the verified-vs-trusted table, and a gap we found in `ASCBase`.

## Verified vs trusted

The short version of the table in the integration doc:

**Verified** — the loan exists, the principal, every repayment, the outstanding balance, premium
collected, that the transaction succeeded, that the log came from our contract, that the proof is
not a replay, and **the payout amount**.

**Trusted** — that the borrower actually died.

Death is a fact about the world; no protocol can verify it. Attestcoin verifies that a
transaction happened on Ethereum, which is what we use it for. The attestation is mitigated by a
2-of-3 attestor threshold and a challenge window.

What matters is that the **financially consequential** quantity is not trusted:

```solidity
payout = min(policy.sumInsured, loanMirror.outstanding(loanId));
```

An attestor who lies about the amount changes nothing, because the amount is never read from the
attestation.

## Declared limitations

Stated here rather than left to be discovered:

1. **Death attestation is trusted.** Mitigated by threshold and challenge window, not eliminated.
   Attestor bonds and slashing are roadmap, not implemented.
2. **The stablecoin is a mock.** `MockStable` is a freely mintable 6-decimal ERC20 standing in for
   a settlement asset. It has no value.
3. **The mortality table is a placeholder.** Flat monthly rates by age band and sex, declared in
   the contract as `TABLE_SOURCE = "PLACEHOLDER - pending BR-EMS 2021 (SUSEP)"`. Plausible
   magnitudes, not actuarial output. Real deployment requires BR-EMS 2021 loaded per SUSEP filing.
4. **We are not the insurer.** Quita is infrastructure for lenders and insurers, not a carrier. It
   does not hold a licence and does not underwrite.
5. **Testnet only**, with a demo-shortened challenge window (exposed as an event-emitting owner
   parameter, not a special case in settlement).
6. **Premium accrual is simplified** to a 30-day month.

## Quick start

```bash
npm install
npm run build
npm test        # 79 tests, no network required
```

### See the whole thing run, with no testnet funds

```bash
npx hardhat node                                          # terminal 1
npx hardhat run scripts/demo.local.ts --network localhost # terminal 2
```

Runs the complete cycle in about two seconds: originate, verify, five rejected attacks,
underwrite, repay, re-verify, a book of proved premium payments, two death attestations, the
challenge window, settlement to the lender, and a claim paid while the pool sits below its MCR.

Everything is real except the `0xFD2` precompile itself, which is native runtime code and cannot
exist on a Hardhat node; mock bytecode is installed at the real address. The contracts are
identical to the ones deployed on testnet.

Then serve the repository root over HTTP, for example:

```bash
npx http-server . -p 8080     # or: python -m http.server 8080
```

- `http://localhost:8080/` — project overview: the problem, the architecture, the trust model
  and the declared limitations.
- `http://localhost:8080/frontend/index.html?net=local` — the live dashboard, reading the
  contracts on the local node.

Both are static files with no build step. The dashboard drops the `?net=local` query to read
CC3 Testnet instead.

The book renders without a wallet, which is the point of it. Connecting one (MetaMask or any
EIP-1193 wallet) adds a liquidity-provider panel: mint the demo settlement asset, deposit into
`CapitalPool`, and watch reserves and the solvency ratio move. The panel offers the write
surface that is genuinely permissionless and nothing else &mdash; there is no `underwrite`
button, because a policy can only come into existence through a verified proof, and no
attestation button, because attestation is restricted to registered attestors. Withdrawals are
capped by free capacity: capital backing a live policy cannot be redeemed, which the panel
surfaces as a protocol rule rather than an error. The panel offers to add CC3 Testnet to the
wallet, since no wallet ships with it configured.

Full walkthrough including faucets: [`docs/PASO-A-PASO.md`](docs/PASO-A-PASO.md).

Confirm the live protocol surface — no funds needed, read-only:

```bash
npm run probe
```

This queries the ChainInfo precompile on CC3 Testnet for registered source chains and checks both
documented Proof Builder endpoints. Expected output includes:

```
{"chainKey":1,"chainId":11155111,"chainName":"Sepolia ethereum","chainEncoding":1}
```

### Full deployment

Requires Sepolia ETH and CC3 testnet CTC (from the Creditcoin Discord faucet).

```bash
cp .env.example .env      # fill in RPC URL and keys
npm run deploy:origin      # QuitaOrigin → Sepolia
npm run deploy:creditcoin  # consumers → CC3, emitter pinned to the above
npm run emit:demo          # emits a real LoanDisbursed, prints the txHash
DEMO_TX_HASH=0x... npm run verify:e2e
npm run worker             # continuous proving
```

`verify:e2e` prints per-phase timings and links to both explorers, so the same transaction can be
followed on Etherscan and Creditcoin Blockscout.

## Deployed addresses

Populated by the deployment scripts into `deployments/`.

| Contract | Chain | Address |
|---|---|---|
| `QuitaOrigin` | Sepolia | [`0xc7624150c28bF26cdF920A0715a7c0ba614faE16`](https://sepolia.etherscan.io/address/0xc7624150c28bF26cdF920A0715a7c0ba614faE16) |
| `LoanMirror` | CC3 Testnet | [`0x60690F414006008984801DBc550C1348B256820f`](https://creditcoin-testnet.blockscout.com/address/0x60690F414006008984801DBc550C1348B256820f) |
| `PolicyRegistry` | CC3 Testnet | [`0x36A8F3FAaD2CBca570B524f29A0fd4fbc694cb38`](https://creditcoin-testnet.blockscout.com/address/0x36A8F3FAaD2CBca570B524f29A0fd4fbc694cb38) |
| `CapitalPool` | CC3 Testnet | [`0x333a96748260e55342baA06d4e633757093EFBC4`](https://creditcoin-testnet.blockscout.com/address/0x333a96748260e55342baA06d4e633757093EFBC4) |
| `ClaimEngine` | CC3 Testnet | [`0x5A2C3e566E5DFBA29059306BB577b292D0F07f3C`](https://creditcoin-testnet.blockscout.com/address/0x5A2C3e566E5DFBA29059306BB577b292D0F07f3C) |
| `MockStable` | CC3 Testnet | [`0x68Dd244C1C5eB3CA1545764d659cd9c2FAbB193d`](https://creditcoin-testnet.blockscout.com/address/0x68Dd244C1C5eB3CA1545764d659cd9c2FAbB193d) |

Deployed 2026-09-13 from `0x4e5A7B9F7F66c208bDDeD352356B33a3A634AD6D`.
`LoanMirror` is pinned to source chain key **1** (Ethereum Sepolia) and to the `QuitaOrigin`
address above as the only accepted log emitter — a proof from any other contract is rejected.

`MockStable` is the declared mock settlement asset. It is freely mintable and has no value.

## Verified end-to-end on testnet

Run on 2026-09-13. A loan originated on Ethereum and reconstructed on Creditcoin through a
Merkle inclusion proof verified by the BlockProver precompile — no oracle, no relayer trust.

| Phase | Time | Detail |
|---|---|---|
| Source receipt | 0.4s | Sepolia block 11,699,049, status 1 |
| Await attestation | **452.6s** | Ethereum finality, the dominant cost |
| Build proof | 0.4s | 8 siblings, 2 continuity roots |
| Submit + verify | 12.4s | CC3 block 5,483,358, **gasUsed 257,039** |
| **Total** | **468.3s** | |

Both sides are public:

- **Sepolia** — [`0xabafe0f2…52435dd`](https://sepolia.etherscan.io/tx/0xabafe0f2866dd4e63e5afe982b33b046cfdfc9cc24ab11431eb5ef7a952435dd)
  emits `LoanDisbursed`
- **Creditcoin** — [`0xb7f0eb0d…c0932b`](https://creditcoin-testnet.blockscout.com/tx/0xb7f0eb0d95a80c35b8ecc75c93e28033159df053468a89c7d4b9a2bb60c0932b)
  verifies the proof and mirrors the loan

Resulting state on `LoanMirror`, none of it assertable by an operator:

```
loanId      : 0x29a94095c432a6d2d1c9401f2d38743586a800762a40a001087939930e71e92e
commitment  : 0xb0b81940dde296c56947e4b117ba792e1456c7d4138422f0e47405d2e5916191
lender      : 0x4e5A7B9F7F66c208bDDeD352356B33a3A634AD6D
principal   : 25000.0
outstanding : 25000.0
active      : true
```

The borrower is present only as `borrowerCommitment`, a salted hash. No identifier appears
on-chain, on either side.

Reproduce it:

```bash
npm run preflight        # gas gate for the two-chain sequence
npm run deploy:origin
npm run deploy:creditcoin
npm run emit:demo        # prints the source txHash
DEMO_TX_HASH=0x... npm run verify:e2e
```

## Network reference

| | |
|---|---|
| CC3 Testnet RPC | `https://rpc.cc3-testnet.creditcoin.network` |
| CC3 Testnet chainId | `102031` |
| Explorer | `https://creditcoin-testnet.blockscout.com/` |
| BlockProver precompile | `0x0000000000000000000000000000000000000FD2` |
| ChainInfo precompile | `0x0000000000000000000000000000000000000fd3` |
| Proof Builder | `https://proof-gen-api.cc3-testnet.creditcoin.network` |
| chainKey — Ethereum Sepolia | `1` |
| Contracts | `@gluwa/asc-contracts@0.2.1` |
| SDK | `@gluwa/usc-sdk@0.18.0` |

## Roadmap

Out of scope for the hackathon, in rough priority order: attestor bonds and slashing · BR-EMS 2021
mortality with SUSEP filing · batch verification (up to 10 proofs per call) · full ERC-4626 vault ·
fine-grained pro-rata accrual · Writability to mark loans extinguished back on Ethereum once it
leaves audit · disability cover · mainnet.

## Repository layout

```
index.html               Project overview (static, no build step)
frontend/index.html      Live dashboard (read-only) + wallet-gated LP panel
contracts/origin/        QuitaOrigin — Sepolia event source
contracts/creditcoin/    QuitaConsumer base + the four insurance contracts
contracts/libs/          WadMath
contracts/mocks/         MockNativeQueryVerifier (0xFD2 stand-in), MockStable
scripts/                 probe, deploy, emit, verify.e2e
worker/src/              watcher, queue, submitter
test/                    79 tests, including the local precompile harness
docs/                    ATTESTCOIN_INTEGRATION.md
```

## Licence

MIT
