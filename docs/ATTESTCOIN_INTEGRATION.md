# Attestcoin Protocol Integration

How Quita uses the Attestcoin Protocol, what that buys, and — just as importantly — what it does not.

- **Track:** RWA
- **Execution chain:** Creditcoin CC3 Testnet (EVM chainId `102031`)
- **Source chain:** Ethereum Sepolia (`chainKey 1`)
- **Direction:** readability only (Ethereum → Creditcoin)

---

## 1. What Quita is

Credit life insurance ("seguro de desgravamen", "seguro prestamista") extinguishes a borrower's
debt when the borrower dies, so the debt does not pass to the family. It is one of the largest
and least transparent insurance lines in Latin America.

Quita moves the parts that can be made verifiable on-chain: the insured balance, the reserves,
the premium collected and the claims paid. The loss ratio stops being a disclosure and becomes a
function of two counters that only move when something was cryptographically proved.

The insured balance is the hard part, and it is where Attestcoin does the work. The loan lives on
one chain and the insurance lives on another, and the insurance must never be able to invent the
number it is insuring.

---

## 2. Integration flow

```
  ETHEREUM SEPOLIA                      OFF-CHAIN                    CREDITCOIN CC3
  ────────────────                      ─────────                    ──────────────

  QuitaOrigin.sol
    LoanDisbursed  ─┐
    RepaymentMade  ─┤
    PremiumPaid    ─┤
    DeathAttested  ─┘
         │
         │ log emitted, tx mined
         ▼
    [ ~12.8 min: Ethereum finality ]
         │
         ▼
                              worker/src/watcher
                              detects log, enqueues job (SQLite)
                                        │
                                        ▼
                              waitUntilHeightAttested(chainKey, height)
                                        │
                                        ▼
                              ProofBuilder.getProof(txHash)
                              → { headerNumber, txBytes,
                                  merkleProof, continuityProof }
                                        │
                                        ▼
                              worker/src/submitter
                              routes event → consumer + action
                                        │
                                        ▼
                                                        QuitaConsumer.executeFromSource(...)
                                                                  │
                                                          ① chainKey pinned
                                                                  │
                                                          ② queryId = keccak(
                                                               chainKey, blockHeight, txIndex)
                                                             replay guard        [ASCBase]
                                                                  │
                                                          ③ VERIFIER.verifyAndEmit(...)
                                                             ── precompile 0xFD2 ──
                                                             Merkle inclusion + continuity
                                                                  │
                                                          ④ mark query processed  [ASCBase]
                                                                  │
                                                          ⑤ tx type valid
                                                          ⑥ receiptStatus == 1
                                                          ⑦ log emitter == QuitaOrigin
                                                                  │
                                                                  ▼
                                                        LoanMirror / PolicyRegistry / ClaimEngine
```

Steps ② ③ ④ come from `ASCBase` in `@gluwa/asc-contracts`. Steps ① ⑤ ⑥ ⑦ are ours, in
[`contracts/creditcoin/QuitaConsumer.sol`](../contracts/creditcoin/QuitaConsumer.sol). Sections 4
to 7 explain why each one is load-bearing.

---

## 3. The four verified events

All four are proved through the protocol. They land in three different consumers because they
mutate different parts of the book.

| Event | Consumer | `action` | Why it must be verified rather than asserted |
|---|---|---|---|
| `LoanDisbursed` | `LoanMirror` | 0 | Creates the insured risk. An unverified disbursement lets anyone conjure a policy over a loan that never existed. |
| `RepaymentMade` | `LoanMirror` | 1 | Carries `outstandingAfter`, which **is** the sum insured. Overstating it inflates every future payout. |
| `PremiumPaid` | `PolicyRegistry` | 0 | The denominator of the loss ratio. If premium can be asserted, the headline solvency number is marketing. |
| `DeathAttested` | `ClaimEngine` | 0 | Triggers settlement. Verification proves a registered attestor really did publish this on Ethereum — see §8 for what it does **not** prove. |

Verifying `PremiumPaid` is the one most projects would skip. We do not, because a loss ratio
whose denominator is trusted input is not an improvement on the status quo we are criticising.

---

## 4. `receiptStatus == 1` — rejecting reverted transactions

**The BlockProver proves inclusion, not success.**

A reverted transaction is still included in its block. The prover will produce a perfectly valid
inclusion proof for one, and `verifyAndEmit` will return `true`.

The attack: craft a call to `QuitaOrigin` that emits `DeathAttested` and then reverts further
down the call stack. During execution the log exists. The transaction is mined, included, and
provable. Without a status check, `ClaimEngine` accepts a death notice from a transaction that
never took effect, and pays out against it.

```solidity
receipt = EvmV1Decoder.decodeReceiptFields(encodedTransaction);
if (receipt.receiptStatus != 1) {
    revert SourceTransactionReverted(receipt.receiptStatus);
}
```

Covered by `rejects a transaction whose receipt status is not 1` and
`rejects an attestation carried by a reverted transaction`.

---

## 5. Emitter pinning — rejecting the clone attack

**Matching on the event signature alone is not authentication.**

Event signatures are public and unowned. Anyone can deploy a contract declaring an identical
`DeathAttested` event, call it on Sepolia, and get a genuine inclusion proof. Status would be 1.
The replay key would be unused. Every other check would pass.

The only thing distinguishing a real notice from a clone is the address that emitted the log:

```solidity
if (log.address_ != SOURCE_EMITTER) {
    revert UnauthorizedEmitter(log.address_, SOURCE_EMITTER);
}
```

`SOURCE_EMITTER` is immutable, set at deployment from `deployments/sepolia.json`.

Covered by `rejects a log emitted by a contract other than QuitaOrigin` and
`rejects an attestation log from a cloned emitter`.

---

## 6. Replay protection, and why the key is `(chainKey, blockHeight, txIndex)`

`ASCBase` derives:

```solidity
uint256 txIndex = VERIFIER.calculateTxIndex(merkleProof);
queryId = keccak256(abi.encodePacked(chainKey, blockHeight, txIndex));
```

That triple is the minimum that uniquely identifies a transaction across every chain the protocol
serves. Weaker keys fail in specific ways:

- **`txHash` alone** — not available from the proof without trusting the submitter, and re-orgs
  can surface the same hash at a different height.
- **`(blockHeight, txIndex)`** — collides across source chains. Block 5,000,000 index 3 exists on
  both Sepolia and Ethereum mainnet.
- **Per-loan nonce** — would let two distinct genuine events on the same loan cancel each other.

Note that `txIndex` comes from `calculateTxIndex(merkleProof)`, i.e. it is derived from the Merkle
path rather than supplied. A submitter cannot choose it to dodge the guard.

Covered by `rejects a replayed proof` and `rejects a replayed attestation proof`.

---

## 7. chainKey pinning — a gap we found in the base contract

`ASCBase.execute` is `external` and **not** `virtual`. It accepts any `chainKey`, folds it into
the replay key, and never passes it to `_processAndEmitEvent`. A consumer inheriting `ASCBase`
therefore cannot tell which chain a proof came from.

That matters here because CC3 Testnet has more than one source chain registered. Confirmed live
via the ChainInfo precompile (`npm run probe`):

```
{"chainKey":3,"chainId":1,"chainName":"Ethereum","chainEncoding":1}
{"chainKey":1,"chainId":11155111,"chainName":"Sepolia ethereum","chainEncoding":1}
```

A contract at the same address on a different registered chain would satisfy the emitter check,
produce a genuine proof, and occupy a different replay key. Address equality across chains is not
exotic: identical deployer and nonce, or CREATE2, both produce it.

Because `execute` cannot be overridden, discouraging it is not enough. We added a guarded
entrypoint and made the inherited one **inert**:

```solidity
function executeFromSource(...) external returns (bool) {
    if (chainKey != SOURCE_CHAIN_KEY) revert UnexpectedChainKey(chainKey, SOURCE_CHAIN_KEY);
    // ... ASCBase verification sequence ...
    _enteredFromSource = true;
    _processAndEmitEvent(action, queryId, encodedTransaction);
    _enteredFromSource = false;
}

function _processAndEmitEvent(...) internal override {
    if (!_enteredFromSource) revert DirectExecuteDisabled();
    _handleProvedTransaction(action, queryId, encodedTransaction);
}
```

Covered by `rejects a proof presented for a different source chain` and
`rejects the inherited unguarded execute entrypoint`.

---

## 8. Verified vs trusted

The honest table. This is the part we would most want a judge to read.

| Fact | Status | Mechanism |
|---|---|---|
| A loan was disbursed on Ethereum | **Verified** | Merkle inclusion + continuity via `0xFD2` |
| The disbursed principal | **Verified** | Decoded from the proved log |
| Repayments occurred | **Verified** | Proved `RepaymentMade` |
| **The outstanding balance** | **Verified** | Copied from `outstandingAfter` in the proved log |
| Premium was collected | **Verified** | Proved `PremiumPaid` |
| The transaction succeeded | **Verified** | `receiptStatus == 1` |
| The log came from QuitaOrigin | **Verified** | Emitter pinned to immutable address |
| The proof is fresh, not replayed | **Verified** | `(chainKey, blockHeight, txIndex)` |
| The claim payout amount | **Verified** | `min(sumInsured, LoanMirror.outstanding)` |
| Claims paid and reserves | **Verified** | On-chain counters, only moved by the above |
| A registered attestor signed an attestation | **Verified** | Proved `DeathAttested` + attestor registry |
| **The borrower actually died** | **TRUSTED** | 2-of-3 threshold + challenge window |
| The date of death is accurate | **TRUSTED** | Same |
| The settlement asset has value | **TRUSTED** | `MockStable` is a demo token |
| The mortality rates are actuarially sound | **TRUSTED** | Declared placeholder, pending BR-EMS 2021 |

**Death is a fact about the world.** No protocol can verify it. Attestcoin verifies that a
transaction occurred on Ethereum, and we use it for exactly that. Anyone claiming to have
oracle-ised mortality is describing a trusted attestor with extra steps.

What the architecture does achieve is narrowing the trusted surface to a single binary question —
*did this person die?* — while making the financially consequential quantity, **how much is
paid**, fully verified:

```solidity
payout = min(policy.sumInsured, loanMirror.outstanding(loanId));
```

An attestor who lies about the amount changes nothing. The amount is not read from the
attestation. That separation is the design.

---

## 9. Gas and timing

Verification cost rises roughly **tenfold** once more than 24 hours have passed since finality,
because the continuity proof must chain across more attested roots. The worker therefore proves
promptly rather than batching overnight — a design constraint with a direct cost consequence.

Gas is **computed, not estimated**. Cost scales with the continuity chain length rather than with
the calldata an estimator can see:

```ts
gasLimit = 1_500_000n + continuityBlocks * 400_000n + proofBytes * 120n;
```

End-to-end latency is dominated by Ethereum finality (~12.8 min), not by the protocol. Every
script prints per-phase timings so this is visible rather than asserted.

---

## 10. Testing against a precompile that is not EVM code

The BlockProver at `0xFD2` is **native Rust runtime code, not bytecode**. A Hardhat node does not
have it, and `ASCBase` hardcodes the address with no injection point. Naively, that makes the
consumers untestable locally.

`NativeQueryVerifierLib.hasPrecompile()` resolves it: off Creditcoin it checks
`PRECOMPILE.code.length > 0`. So we place mock bytecode at the real address:

```ts
const runtimeCode = await ethers.provider.getCode(await deployed.getAddress());
await network.provider.send("hardhat_setCode", [PRECOMPILE_ADDRESS, runtimeCode]);
```

The second half is the payload. `txBytes` is not a raw Ethereum transaction; it is the prover's
re-encoding, which `EvmV1Decoder` documents as:

```
abi.encode(uint8 txType, bytes[] chunks)
  chunks[0] common  : (uint64 nonce, uint64 gasLimit, address from, bool toIsNull,
                       address to, uint256 value, bytes data)
  chunks[1] typed   : type-specific fields
  chunks[2] receipt : (uint8 status, uint64 gasUsed, (address,bytes32[],bytes)[] logs, bytes bloom)
```

`test/helpers/attestcoin.ts` rebuilds that layout exactly, so the tests exercise the real decoder
rather than a stub. The mock also **derives** `txIndex` from the Merkle path bits instead of
returning a constant — a constant would make every proof collide and turn the replay test into a
false positive.

---

## 11. Writability is not used, and why

The Attestcoin Writability documentation states the feature is *"undergoing 3rd party testing and
audits"* and will be documented *"once the writability feature is mature and released on
Creditcoin testnet"*. It is not available, so Quita is **readability only**.

When it ships, the natural use is closing the loop: on settlement, `ClaimEngine` would write back
to Ethereum to mark the loan extinguished on the origin chain, rather than relying on the lender
to reconcile off-chain. That is a roadmap item, not a claim about today.

---

## 12. Reproducing this

```bash
npm install
npm run build
npm test                  # 79 tests, no network needed
npm run probe             # live CC3 read: precompile + prover, no funds needed
```

`npm run probe` is the fastest independent confirmation that the integration surface is real: it
queries the ChainInfo precompile on CC3 Testnet for the registered source chains and checks both
documented Proof Builder endpoints.

With funded keys:

```bash
npm run deploy:origin      # QuitaOrigin → Sepolia
npm run deploy:creditcoin  # consumers → CC3, emitter pinned to the above
npm run emit:demo          # real LoanDisbursed, prints txHash
DEMO_TX_HASH=0x... npm run verify:e2e
```

`verify.e2e.ts` prints per-phase timings and links to both explorers, so the same transaction can
be followed on Etherscan and on Creditcoin Blockscout.

---

## 13. Source map

| Concern | File |
|---|---|
| Source-chain events | [`contracts/origin/QuitaOrigin.sol`](../contracts/origin/QuitaOrigin.sol) |
| Protocol safety layer | [`contracts/creditcoin/QuitaConsumer.sol`](../contracts/creditcoin/QuitaConsumer.sol) |
| Verified loan state | [`contracts/creditcoin/LoanMirror.sol`](../contracts/creditcoin/LoanMirror.sol) |
| Policies + premium | [`contracts/creditcoin/PolicyRegistry.sol`](../contracts/creditcoin/PolicyRegistry.sol) |
| Capital + solvency | [`contracts/creditcoin/CapitalPool.sol`](../contracts/creditcoin/CapitalPool.sol) |
| Claims | [`contracts/creditcoin/ClaimEngine.sol`](../contracts/creditcoin/ClaimEngine.sol) |
| Local precompile harness | [`test/helpers/attestcoin.ts`](../test/helpers/attestcoin.ts) |
| Proof generation | [`scripts/lib/attestcoin.ts`](../scripts/lib/attestcoin.ts) |
| Worker | [`worker/src/`](../worker/src) |
