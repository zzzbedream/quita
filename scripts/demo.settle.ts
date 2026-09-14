/**
 * Settles a claim whose attestations are already proved on-chain.
 *
 * Split out from demo.claim.ts because the two halves have different failure modes. Proving is
 * one-shot: replay protection rejects a second submission of the same proof, so a crash after
 * the proofs land must not be recovered by re-running them. Settling is idempotent enough to
 * retry — it either succeeds or reverts with a reason that says why.
 *
 *   npx hardhat run scripts/demo.settle.ts --network creditcoin
 *   DEMO_LOAN_ID=0x... npx hardhat run scripts/demo.settle.ts --network creditcoin
 *
 * Loan discovery is bounded to the deployment block. An unbounded queryFilter over a public RPC
 * times out at ten seconds, which is how the first version of this died after the proofs had
 * already been accepted.
 */
import { ethers } from "hardhat";
import { PhaseTimer } from "./lib/attestcoin";
import { load, CreditcoinDeployment } from "./lib/deployments";

async function main() {
  const timer = new PhaseTimer();
  const creditcoin = load<CreditcoinDeployment>("creditcoin");
  const [signer] = await ethers.getSigners();

  const claims = await ethers.getContractAt("ClaimEngine", creditcoin.claimEngine, signer);
  const mirror = await ethers.getContractAt("LoanMirror", creditcoin.loanMirror, signer);
  const registry = await ethers.getContractAt("PolicyRegistry", creditcoin.policyRegistry, signer);
  const pool = await ethers.getContractAt("CapitalPool", creditcoin.capitalPool, signer);

  const q = (v: bigint) => ethers.formatUnits(v, 6);

  const loanId = process.env.DEMO_LOAN_ID ?? (await discoverLoanId(mirror, creditcoin));
  console.log(`loanId : ${loanId}`);

  const claim = await claims.getClaim(loanId);
  const threshold = await claims.threshold();
  // ClaimEngine.ClaimStatus: None, Attesting, Challenged, Disputed, Settled
  const STATUS = ["None", "Attesting", "Challenged", "Disputed", "Settled"];
  const DISPUTED = 3;
  const SETTLED = 4;
  const status = Number(claim.status);
  console.log(`attestations : ${claim.attestationCount} of ${threshold}`);
  console.log(`status       : ${status} (${STATUS[status] ?? "?"})`);

  if (status === DISPUTED) {
    console.log("\nClaim is disputed. Settlement is blocked, which is what the window is for.");
    process.exitCode = 1;
    return;
  }
  if (status === SETTLED) {
    console.log("\nAlready settled. Nothing to do.");
    await report(pool, registry, mirror, loanId, q);
    return;
  }
  if (claim.attestationCount < threshold) {
    console.log(`\nThreshold not reached. The protocol will not pay on ${claim.attestationCount}.`);
    process.exitCode = 1;
    return;
  }

  // The challenge window is real time, not a flag we can skip. Wait it out and say so.
  const chainNow = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
  const deadline = BigInt(claim.challengeDeadline);
  console.log(`\nchallenge deadline : ${deadline}  (chain now ${chainNow})`);
  if (deadline > chainNow) {
    const wait = Number(deadline - chainNow) + 5;
    console.log(`waiting ${wait}s for the challenge window to close — this is the real window`);
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
  timer.mark("challenge-window:closed");

  const paidBefore = await pool.totalClaimsPaid();
  const tx = await claims.settle(loanId);
  const receipt = await tx.wait();
  timer.mark("settle", `cc tx ${tx.hash} gas ${receipt?.gasUsed}`);

  const paidAfter = await pool.totalClaimsPaid();
  console.log(`\npayout : ${q(paidAfter - paidBefore)} qUSD`);
  console.log(`  Creditcoin: https://creditcoin-testnet.blockscout.com/tx/${tx.hash}`);

  await report(pool, registry, mirror, loanId, q);
  console.log(`\nTotal elapsed: ${timer.total()}`);
}

async function report(pool: any, registry: any, mirror: any, loanId: string, q: (v: bigint) => string) {
  const policy = await registry.getPolicy(loanId);
  const [assets, locked, premiums, paid, loss] = await Promise.all([
    pool.totalAssets(), pool.lockedCapital(), pool.totalPremiumsCollected(),
    pool.totalClaimsPaid(), pool.lossRatioWad()
  ]);
  console.log("\nBook state");
  console.log(`  sum insured   : ${q(policy.sumInsured)}`);
  console.log(`  outstanding   : ${q(await mirror.outstanding(loanId))}`);
  console.log(`  policy status : ${policy.status}  (3 = Claimed)`);
  console.log(`  pool assets   : ${q(assets)}`);
  console.log(`  locked        : ${q(locked)}`);
  console.log(`  premiums      : ${q(premiums)}`);
  console.log(`  claims paid   : ${q(paid)}`);
  console.log(`  loss ratio    : ${premiums === 0n ? "n/a" : (Number(loss) / 1e18 * 100).toFixed(1) + "%"}`);
}

async function discoverLoanId(mirror: any, creditcoin: CreditcoinDeployment): Promise<string> {
  const head = await ethers.provider.getBlockNumber();
  const from = Math.max(0, Number(creditcoin.deployedAtBlock) - 1);
  const events = await mirror.queryFilter(mirror.filters.LoanMirrored(), from, head);
  if (events.length === 0) throw new Error("no mirrored loans found");
  return events[events.length - 1].args.loanId;
}

main().catch((e) => { console.error(e?.message ?? e); process.exitCode = 1; });
