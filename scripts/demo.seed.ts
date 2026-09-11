import { ethers } from "hardhat";
import { PhaseTimer } from "./lib/attestcoin";
import { load, CreditcoinDeployment } from "./lib/deployments";

/**
 * Seeds a believable book on Creditcoin so the dashboard is not empty on camera.
 *
 * IMPORTANT AND DELIBERATE: this script does NOT write to LoanMirror. Loan state on Creditcoin is
 * reachable only through a verified proof, and there is no operator backdoor to seed it — that is
 * the entire point of the design. What this script seeds is the capital side, which is ordinary
 * contract state: liquidity, and the MCR.
 *
 * Loans, policies and the paid claim that give the loss ratio a non-zero numerator come from
 * demo.full.ts, which drives real Sepolia transactions through the real prover.
 */
async function main() {
  const timer = new PhaseTimer();
  const creditcoin = load<CreditcoinDeployment>("creditcoin");
  const [signer] = await ethers.getSigners();

  const stable = await ethers.getContractAt("MockStable", creditcoin.mockStable, signer);
  const pool = await ethers.getContractAt("CapitalPool", creditcoin.capitalPool, signer);
  const mirror = await ethers.getContractAt("LoanMirror", creditcoin.loanMirror, signer);
  const registry = await ethers.getContractAt(
    "PolicyRegistry",
    creditcoin.policyRegistry,
    signer
  );

  const capital = ethers.parseUnits(process.env.DEMO_CAPITAL ?? "1000000", 6);

  const current = await pool.totalAssets();
  if (current < capital) {
    const needed = capital - current;
    await (await stable.mint(signer.address, needed)).wait();
    await (await stable.approve(await pool.getAddress(), needed)).wait();
    await (await pool.deposit(needed)).wait();
    timer.mark("capital:deposited", `${ethers.formatUnits(needed, 6)} qUSD`);
  } else {
    timer.mark("capital:already-funded", ethers.formatUnits(current, 6));
  }

  // Underwrite any mirrored loan that does not yet have a policy. Those loans can only be
  // present because a proof was verified, so this is a safe sweep.
  const count = await mirror.loanCount();
  let written = 0;
  for (let i = 0n; i < count; i++) {
    const loanId = await mirror.loanIdAt(i);
    const policy = await registry.getPolicy(loanId);
    if (policy.status !== 0n) continue;
    try {
      await (await registry.underwrite(loanId)).wait();
      written++;
    } catch (error) {
      console.log(`  skipped ${loanId}: ${(error as Error).message.split("(")[0]}`);
    }
  }
  timer.mark("policies:underwritten", `${written} new, ${count} mirrored loans total`);

  console.log("\nBook state");
  console.log(`  mirrored loans     : ${count}`);
  console.log(`  active policies    : ${await registry.activePolicyCount()}`);
  console.log(`  total sum insured  : ${ethers.formatUnits(await registry.totalSumInsured(), 6)}`);
  console.log(`  pool assets        : ${ethers.formatUnits(await pool.totalAssets(), 6)}`);
  console.log(`  locked capital     : ${ethers.formatUnits(await pool.lockedCapital(), 6)}`);
  console.log(`  free capacity      : ${ethers.formatUnits(await pool.freeCapacity(), 6)}`);
  console.log(`  premiums collected : ${ethers.formatUnits(await pool.totalPremiumsCollected(), 6)}`);
  console.log(`  claims paid        : ${ethers.formatUnits(await pool.totalClaimsPaid(), 6)}`);
  console.log(`  loss ratio (wad)   : ${await pool.lossRatioWad()}`);
  console.log(`\nTotal: ${timer.total()}s`);

  if ((await pool.totalClaimsPaid()) === 0n) {
    console.log(
      "\nNote: claims paid is zero, so the loss ratio reads 0%. Run scripts/demo.full.ts to " +
        "put a real, proved, settled claim on the board before recording."
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
