# Assumptions

Decisions taken without blocking, per the active assumption directive in `CLAUDE.md`.
Each entry: what was assumed, and why.

---

## Protocol integration

**`ASCBase` from `@gluwa/asc-contracts@0.2.1` is used instead of a hand-written consumer base.**
The sprint plan specified writing `UscConsumer.sol` with a seven-step `_consume`. That contract
already exists upstream and implements the same sequence: query id over
`(chainKey, blockHeight, txIndex)`, replay guard, `verifyAndEmit`, then delegation to
`_processAndEmitEvent`. Using the official base is less code and is more recognisable to anyone
reviewing the integration.

**Solidity is 0.8.28, not 0.8.23.** `ASCBase` declares `pragma ^0.8.28`. Not negotiable.

**`viaIR` is enabled.** `executeFromSource` takes eight parameters and hits stack-too-deep without
it. Compilation is slower; the codebase is small enough that this does not matter.

**`INativeQueryVerifier` and `EvmV1Decoder` are imported from the npm package, not vendored.**
The sprint plan expected to copy them out of `gluwa/usc-testnet-bridge-examples`. They are not
standalone files in that repo — the examples import them from `@gluwa/asc-contracts`. Importing
means we track upstream rather than freezing a copy.

**The reference repo is `ASCMinter`, not `USCMinter`.** Renamed upstream along with the protocol.

**A guarded entrypoint was added rather than accepting the chainKey gap.**
`ASCBase.execute` is `external` and not `virtual`, accepts any `chainKey`, and does not pass it to
the handler. CC3 Testnet has two source chains registered (confirmed live: Sepolia = 1,
Ethereum mainnet = 3). Since `execute` cannot be overridden, `executeFromSource` performs the
verification sequence with the chainKey pinned, and `_processAndEmitEvent` refuses to run unless
it set the entry flag — making the inherited entrypoint inert rather than merely discouraged.
The flag is plain storage rather than transient storage, because the EVM version available on
CC3 is not confirmed to be Cancun and portability matters more than the gas saving here.

**Local testing injects mock bytecode at `0xFD2` via `hardhat_setCode`.**
The real BlockProver is native runtime code with no bytecode, and `ASCBase` hardcodes the address.
`NativeQueryVerifierLib.hasPrecompile()` checks `PRECOMPILE.code.length > 0` off Creditcoin, so
placing mock runtime code at that address makes the whole consumer surface testable. Verified
working — this was the main technical risk and it is closed.

**The mock verifier derives `txIndex` from the Merkle path rather than returning a constant.**
A constant would make every proof share a query id, so the replay test would pass for the wrong
reason. Deriving from the `isLeft` bits mirrors real prover behaviour and lets tests choose
distinct indices deterministically.

**Proof Builder URL defaults to `proof-gen-api.cc3-testnet.creditcoin.network`.**
Both documented endpoints answered `200` on 2026-09-11 (`prover.cc3-testnet...` also works, both
redirect `/` → `/api/swagger`). The environments table URL is used as primary; the SDK example URL
is kept as a documented fallback in `.env.example`.

---

## Product decisions

**All four events are verified, across three consumer contracts.**
`PremiumPaid` could have been an ordinary function call. It is verified because it is the
denominator of the loss ratio, and a loss ratio with a trusted denominator does not improve on the
opacity the project is criticising.

**Age bands are five-year buckets from 18, capped at band 9 (age 68) for entry.**
The sprint plan specified five-year bands but not the entry ceiling. 68 is a common upper entry
age for this product.

**Premium rates are placeholders, declared in three places.**
Contract constant `TABLE_SOURCE`, NatSpec, and the README. Magnitudes 0.02%–0.35% monthly on the
outstanding balance, female rates below male at the same band. Real BR-EMS 2021 data was not
available and inventing numbers presented as real would be the exact opacity being criticised.

**A month is 30 days for accrual.** Simplification, declared in the README. Fine-grained pro-rata
accrual is roadmap.

**Default waiting period is 90 days; default challenge window is 24 hours.**
Deployment scripts shorten both for demo purposes through the owner setters, which emit events.
The demo values are `DEMO_CHALLENGE_WINDOW_SECONDS=120` and `DEMO_WAITING_PERIOD_SECONDS=0`.

**`CapitalPool` is simple share accounting, not ERC-4626.** In scope per the sprint plan cut list.
Deposits, proportional shares, locked capital, MCR. Withdrawals cannot breach locked capital.

**The MCR gates `underwrite` and deliberately never gates `payClaim`.**
An insurer that stops paying when its solvency dips is not an insurer. Tested explicitly.

---

## Tooling

**Hardhat 2.29.1 rather than Hardhat 3.16.0.**
HH3 is current but changed the config and test surface substantially. Under a two-day deadline the
mature path with well-understood `hardhat_setCode`, ethers v6 toolbox and `solidity-coverage` is
the lower-risk choice.

**`console.log` is used in `scripts/`.** These are CLI entrypoints where stdout is the interface.
The worker uses a structured, levelled logger instead, since it is a long-running process.

**Deployment addresses are written to `deployments/*.json` and read back by later scripts.**
`deploy.creditcoin.ts` reads `sepolia.json` for the source emitter, so emitter pinning is always
bound to the `QuitaOrigin` actually deployed. Passing it by hand is the most likely way to get a
valid proof rejected.

---

## Frontend

**The dashboard is read-only by default; the wallet panel exposes only the permissionless
surface.** A visitor can connect a wallet to mint the declared mock settlement asset, deposit
into `CapitalPool` and withdraw shares. Those are the functions that carry no access control in
the contracts. `underwrite`, death attestation and `settle` are deliberately absent from the UI:
policies exist only as a consequence of a verified `LoanDisbursed` proof, attestation is limited
to registered attestors under a 2-of-3 threshold, and settlement reads the payout from verified
state. Adding buttons for those would have meant either lying about what they do or weakening
the contracts, so the panel says plainly what it cannot do and why.

**Revert data is located by walking the error object, not by a fixed path.** Every layer nests it
differently. Measured against a real `WithdrawalWouldBreachLockedCapital` revert through
Hardhat's JSON-RPC, the hex sat at `err.data.data`, which none of the paths ethers documents
(`err.data`, `err.revert`, `err.info.error.data`) would have found. `findRevertData` searches a
bounded set of keys to depth 4 and only accepts a blob the pool ABI can name, so a transport
error cannot be mistaken for a protocol one.

**Static HTML with the ethers UMD build, not Vite + React + wagmi.** The original plan named the
latter. Two static files with no build step are faster to serve, faster to audit, and cannot
break in a bundler the day before submission; the interactivity needed here does not justify a
toolchain.

**The landing page's market figures carry an explicit source caveat.** The generated draft
asserted "~18% loss ratio" and "87% commission" as fact. Both now name the Tema 972 litigation
analysis as the source and state that it is pending cross-check against SUSEP statistics, which
is the same standard the README and deck already used.

---

## Fixed during the first real deployment

Two config bugs that only surface when deploying for real, both found on 2026-09-13:

**`accounts()` required exactly 66 characters, so a key without the `0x` prefix silently
produced no signer.** `(key: string) => key.length === 66 ? [key] : []` returns an empty array
for a perfectly valid 64-hex key, and the failure then appears much later as "No signer
available" in the deploy script, far from the cause. It now normalises the prefix and throws on a
malformed key, because a typo in `.env` should be loud.

**`CREDITCOIN_PRIVATE_KEY ?? PRIVATE_KEY` did not fall back.** `.env.example` documents that the
Creditcoin key defaults to `PRIVATE_KEY` when unset, but `??` only treats `null`/`undefined` as
absent. An empty `CREDITCOIN_PRIVATE_KEY=` line — which is exactly what `.env.example` ships —
is a string, so it won, and the Creditcoin network ended up with no signer. Now trimmed and
treated as absent, matching the documented behaviour.

**`npm run preflight` was added** as a pre-deployment gate. The sequence spans two chains and the
order is forced, so running out of Sepolia gas after `QuitaOrigin` deploys but before the demo
event would leave an origin contract with nothing to prove. It refuses to proceed under 3x the
measured cost and prints the exact shortfall. Gas rose from 1.02 to 2.21 gwei between the first
measurement and the first attempt, which is precisely the volatility it guards against.

---

## Open / pending

**No deployment yet — no testnet funds.** Everything is built and tested locally. Deployment is
gated on Sepolia ETH and CC3 testnet CTC (Creditcoin Discord faucet, manual). The scripts are
written and typechecked; `npm run probe` already exercises the live network read-only.

**`verify.e2e.ts` has not been run against the live prover.** Its proof-to-calldata mapping
mirrors the Gluwa reference scripts exactly, and the SDK surface was confirmed against published
docs, but the end-to-end path cannot be exercised without funds.

**Etherscan verification not configured.** Requires an API key; skipped, noted in `.env.example`.
