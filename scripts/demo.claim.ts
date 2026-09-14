/**
 * Completes the claim leg against state that is already proved on Creditcoin.
 *
 * demo.full.ts stops at the first claim proof if the attestors are not registered on
 * ClaimEngine. That registry is separate from QuitaOrigin's on purpose: Creditcoin does not
 * accept whoever Sepolia happens to consider an attestor, it keeps its own list. Being
 * registered on the source chain is necessary, not sufficient.
 *
 * Re-running demo.full.ts after fixing that would re-originate and re-prove a loan, spending two
 * more Ethereum finality windows for work already done. This resumes instead: it registers the
 * attestors, proves the two DeathAttested transactions that are already on Sepolia, waits out the
 * challenge window and settles.
 *
 *   DEMO_LOAN_ID=0x... ATTEST_TX_1=0x... ATTEST_TX_2=0x... \
 *     npx hardhat run scripts/demo.claim.ts --network creditcoin
 *
 * With no env vars it discovers the most recent mirrored loan and refuses to guess the
 * attestation transactions, since submitting the wrong proof wastes gas and proves nothing.
 */
import { ethers } from "hardhat";
import {
  computeGasLimit, generateProof, PhaseTimer, PROOF_BUILDER_URLS, toExecuteArgs
} from "./lib/attestcoin";
import { load, CreditcoinDeployment, OriginDeployment } from "./lib/deployments";

const ACTION_ATTEST = 0;

async function main() {
  const timer = new PhaseTimer();
  const creditcoin = load<CreditcoinDeployment>("creditcoin");
  const originDeployment = load<OriginDeployment>("sepolia");

  const sepoliaRpc = process.env.SEPOLIA_RPC_URL;
  if (!sepoliaRpc) throw new Error("SEPOLIA_RPC_URL is required");
  const sourceProvider = new ethers.JsonRpcProvider(sepoliaRpc);

  const proofBuilderUrl = process.env.PROOF_BUILDER_URL ?? PROOF_BUILDER_URLS[0];

  const [ccSigner] = await ethers.getSigners();
  const claims = await ethers.getContractAt("ClaimEngine", creditcoin.claimEngine, ccSigner);
  const mirror = await ethers.getContractAt("LoanMirror", creditcoin.loanMirror, ccSigner);
  const registry = await ethers.getContractAt("PolicyRegistry", creditcoin.policyRegistry, ccSigner);
  const pool = await ethers.getContractAt("CapitalPool", creditcoin.capitalPool, ccSigner);

  const tx1 = process.env.ATTEST_TX_1;
  const tx2 = process.env.ATTEST_TX_2;
  if (!tx1 || !tx2) {
    throw new Error("ATTEST_TX_1 and ATTEST_TX_2 are required (the Sepolia attestDeath hashes)");
  }

  // ---- Register both attestors on the Creditcoin side --------------------
  // Derive the addresses from the same keys that signed on Sepolia, so we register exactly the
  // identities the proofs will carry rather than an address typed in by hand.
  for (const slot of [1, 2] as const) {
    const key = process.env[`ATTESTOR_${slot}_PRIVATE_KEY`];
    if (!key) throw new Error(`ATTESTOR_${slot}_PRIVATE_KEY is required`);
    const address = new ethers.Wallet(key).address;
    if (await claims.isAttestor(address)) {
      console.log(`attestor ${slot} ${address} already registered on ClaimEngine`);
    } else {
      await (await claims.setAttestor(address, true)).wait();
      console.log(`attestor ${slot} ${address} registered on ClaimEngine`);
    }
  }
  console.log(`threshold: ${await claims.threshold()}`);
  timer.mark("attestors:registered");

  // ---- Prove both attestations ------------------------------------------
  const target = creditcoin.claimEngine;
  for (const [label, hash] of [["claim-1", tx1], ["claim-2", tx2]] as const) {
    const receipt = await sourceProvider.getTransactionReceipt(hash);
    if (!receipt) throw new Error(`${label}: no receipt for ${hash}`);
    if (receipt.status !== 1) throw new Error(`${label}: source tx reverted`);
    timer.mark(`${label}:source-receipt`, `block ${receipt.blockNumber}, status ${receipt.status}`);

    const proof = await generateProof(
      hash,
      creditcoin.sourceChainKey,
      proofBuilderUrl,
      sourceProvider,
      (phase, detail) => timer.mark(`${label}:${phase}`, detail)
    );

    const contract = new ethers.Contract(target, [
      "function executeFromSource(uint8 action,uint64 chainKey,uint64 headerNumber,bytes txBytes,bytes32 root,(bytes32 hash,bool isLeft)[] siblings,bytes32 lowerEndpointDigest,bytes32[] roots) returns (bool)"
    ], ccSigner);

    const tx = await contract.executeFromSource(
      ...toExecuteArgs(ACTION_ATTEST, creditcoin.sourceChainKey, proof),
      { gasLimit: computeGasLimit(proof) }
    );
    const r = await tx.wait();
    timer.mark(`${label}:verified`, `cc tx ${tx.hash} gas ${r?.gasUsed}`);
  }

  // ---- Threshold, challenge window, settle -------------------------------
  const loanId = process.env.DEMO_LOAN_ID ?? (await discoverLoanId(mirror));
  console.log(`\nloanId: ${loanId}`);

  const claim = await claims.getClaim(loanId);
  console.log(`attestations : ${claim.attestationCount} of ${await claims.threshold()}`);
  console.log(`deadline     : ${claim.challengeDeadline}`);

  const now = BigInt(Math.floor(Date.now() / 1000));
  const deadline = BigInt(claim.challengeDeadline);
  if (deadline > now) {
    const wait = Number(deadline - now) + 5;
    console.log(`\nchallenge window open, waiting ${wait}s — this is the real window, not a skip`);
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
  timer.mark("challenge-window:elapsed");

  const before = await pool.totalClaimsPaid();
  const settleTx = await claims.settle(loanId);
  const settleReceipt = await settleTx.wait();
  timer.mark("settle", `cc tx ${settleTx.hash} gas ${settleReceipt?.gasUsed}`);

  const after = await pool.totalClaimsPaid();
  const policy = await registry.getPolicy(loanId);
  const q = (v: bigint) => ethers.formatUnits(v, 6);

  console.log("\nSettled");
  console.log(`  payout        : ${q(after - before)} qUSD`);
  console.log(`  sum insured   : ${q(policy.sumInsured)}`);
  console.log(`  outstanding   : ${q(await mirror.outstanding(loanId))}`);
  console.log(`  policy status : ${policy.status}  (3 = Claimed)`);
  console.log(`  loss ratio    : ${(Number(await pool.lossRatioWad()) / 1e18 * 100).toFixed(1)}%`);
  console.log(`\n  Creditcoin: https://creditcoin-testnet.blockscout.com/tx/${settleTx.hash}`);
  console.log(`\nTotal elapsed: ${timer.total()}`);
}

async function discoverLoanId(mirror: any): Promise<string> {
  const events = await mirror.queryFilter(mirror.filters.LoanMirrored());
  if (events.length === 0) throw new Error("no mirrored loans found");
  return events[events.length - 1].args.loanId;
}

main().catch((e) => { console.error(e?.message ?? e); process.exitCode = 1; });
