import { ethers } from "hardhat";
import {
  computeGasLimit,
  generateProof,
  PhaseTimer,
  PROOF_BUILDER_URLS,
  toExecuteArgs,
} from "./lib/attestcoin";
import { load, CreditcoinDeployment, OriginDeployment } from "./lib/deployments";

/**
 * End-to-end demonstration, timed at every phase.
 *
 * originate on Sepolia -> prove -> mirror on Creditcoin -> underwrite -> repay -> prove ->
 * two death attestations -> prove both -> challenge window -> settle -> lender paid.
 *
 * Run against Creditcoin; the Sepolia side is driven through an explicit provider so a single
 * invocation can drive both chains:
 *
 *   npx hardhat run scripts/demo.full.ts --network creditcoin
 *
 * The waits are real. Ethereum finality plus attestation dominates the runtime, which is the
 * honest shape of trustless cross-chain state and is exactly what the demo should show.
 */
const ACTION = {
  DISBURSE: 0,
  REPAY: 1,
  PREMIUM: 0,
  ATTEST: 0,
} as const;

async function main() {
  const timer = new PhaseTimer();

  const creditcoin = load<CreditcoinDeployment>("creditcoin");
  const origin = load<OriginDeployment>("sepolia");

  const sepoliaRpc = process.env.SEPOLIA_RPC_URL;
  if (!sepoliaRpc) throw new Error("SEPOLIA_RPC_URL is required");
  const sourceProvider = new ethers.JsonRpcProvider(sepoliaRpc);

  const lenderKey = process.env.PRIVATE_KEY!;
  const lender = new ethers.Wallet(lenderKey, sourceProvider);
  const attestor1 = process.env.ATTESTOR_1_PRIVATE_KEY
    ? new ethers.Wallet(process.env.ATTESTOR_1_PRIVATE_KEY, sourceProvider)
    : null;
  const attestor2 = process.env.ATTESTOR_2_PRIVATE_KEY
    ? new ethers.Wallet(process.env.ATTESTOR_2_PRIVATE_KEY, sourceProvider)
    : null;

  if (!attestor1 || !attestor2) {
    throw new Error(
      "ATTESTOR_1_PRIVATE_KEY and ATTESTOR_2_PRIVATE_KEY are required for the claim leg. " +
        "Both need Sepolia ETH."
    );
  }

  const proofBuilderUrl = process.env.PROOF_BUILDER_URL ?? PROOF_BUILDER_URLS[0];
  const [ccSigner] = await ethers.getSigners();

  const originContract = await ethers.getContractAt("QuitaOrigin", origin.quitaOrigin, lender);
  const mirror = await ethers.getContractAt("LoanMirror", creditcoin.loanMirror, ccSigner);
  const registry = await ethers.getContractAt(
    "PolicyRegistry",
    creditcoin.policyRegistry,
    ccSigner
  );
  const claims = await ethers.getContractAt("ClaimEngine", creditcoin.claimEngine, ccSigner);
  const pool = await ethers.getContractAt("CapitalPool", creditcoin.capitalPool, ccSigner);
  const stable = await ethers.getContractAt("MockStable", creditcoin.mockStable, ccSigner);

  /** Proves a Sepolia transaction and submits it to the given consumer. */
  async function proveAndSubmit(
    label: string,
    txHash: string,
    target: string,
    action: number
  ): Promise<void> {
    const proof = await generateProof(
      txHash,
      creditcoin.sourceChainKey,
      proofBuilderUrl,
      sourceProvider,
      (phase, detail) => timer.mark(`${label}:${phase}`, detail)
    );
    const contract = new ethers.Contract(
      target,
      [
        "function executeFromSource(uint8,uint64,uint64,bytes,bytes32,(bytes32,bool)[],bytes32,bytes32[]) returns (bool)",
      ],
      ccSigner
    );
    const tx = await contract.executeFromSource(
      ...toExecuteArgs(action, creditcoin.sourceChainKey, proof),
      { gasLimit: computeGasLimit(proof) }
    );
    const receipt = await tx.wait();
    timer.mark(`${label}:verified`, `cc tx ${tx.hash} gas ${receipt?.gasUsed}`);
  }

  // ---- Capitalise the pool ----------------------------------------------
  const seedCapital = ethers.parseUnits("1000000", 6);
  if ((await pool.totalAssets()) < seedCapital) {
    await (await stable.mint(ccSigner.address, seedCapital)).wait();
    await (await stable.approve(await pool.getAddress(), seedCapital)).wait();
    await (await pool.deposit(seedCapital)).wait();
    timer.mark("pool:capitalised", `${ethers.formatUnits(seedCapital, 6)} qUSD`);
  }

  // ---- 1. Originate on Sepolia ------------------------------------------
  const label = `demo-${Date.now()}`;
  const loanId = ethers.keccak256(ethers.toUtf8Bytes(label));
  const nationalId = ethers.keccak256(ethers.toUtf8Bytes("DEMO-NATIONAL-ID"));
  const salt = ethers.hexlify(ethers.randomBytes(32));
  const commitment = await originContract.commitmentFor(nationalId, loanId, salt);
  const principal = ethers.parseUnits("25000", 6);

  timer.mark("1-originate:submit");
  const disburseTx = await originContract.disburse(loanId, commitment, principal, 36, 6, 1);
  await disburseTx.wait();
  timer.mark("1-originate:mined", `sepolia tx ${disburseTx.hash}`);

  await proveAndSubmit("2-mirror", disburseTx.hash, creditcoin.loanMirror, ACTION.DISBURSE);
  console.log(
    `    outstanding on Creditcoin: ${ethers.formatUnits(await mirror.outstanding(loanId), 6)}`
  );

  // ---- 3. Underwrite ----------------------------------------------------
  await (await registry.underwrite(loanId)).wait();
  const policy = await registry.getPolicy(loanId);
  timer.mark(
    "3-underwrite",
    `sumInsured ${ethers.formatUnits(policy.sumInsured, 6)} rate ${policy.premiumRateWad}`
  );

  // ---- 4. Repay on Sepolia, prove it -------------------------------------
  timer.mark("4-repay:submit");
  const repayTx = await originContract.repay(loanId, ethers.parseUnits("5000", 6));
  await repayTx.wait();
  timer.mark("4-repay:mined", `sepolia tx ${repayTx.hash}`);

  await proveAndSubmit("5-mirror-repay", repayTx.hash, creditcoin.loanMirror, ACTION.REPAY);
  await (await registry.syncSumInsured(loanId)).wait();
  console.log(
    `    outstanding after repayment: ${ethers.formatUnits(await mirror.outstanding(loanId), 6)}`
  );

  // ---- 6. Two death attestations on Sepolia -----------------------------
  const evidence = ethers.keccak256(ethers.toUtf8Bytes("death-certificate-demo"));
  const dateOfDeath = BigInt(Math.floor(Date.now() / 1000));

  const attest1 = await originContract
    .connect(attestor1)
    .attestDeath(loanId, dateOfDeath, evidence);
  await attest1.wait();
  timer.mark("6-attest-1:mined", `sepolia tx ${attest1.hash}`);

  const attest2 = await originContract
    .connect(attestor2)
    .attestDeath(loanId, dateOfDeath, evidence);
  await attest2.wait();
  timer.mark("6-attest-2:mined", `sepolia tx ${attest2.hash}`);

  await proveAndSubmit("7-claim-1", attest1.hash, creditcoin.claimEngine, ACTION.ATTEST);
  await proveAndSubmit("7-claim-2", attest2.hash, creditcoin.claimEngine, ACTION.ATTEST);

  const claim = await claims.getClaim(loanId);
  timer.mark(
    "7-threshold-reached",
    `attestations ${claim.attestationCount}, deadline ${claim.challengeDeadline}`
  );

  // ---- 8. Challenge window ----------------------------------------------
  const window = await claims.challengeWindow();
  console.log(`\n    Challenge window is ${window}s (shortened for demonstration).`);
  const deadline = Number(claim.challengeDeadline);
  while (Math.floor(Date.now() / 1000) < deadline) {
    const remaining = deadline - Math.floor(Date.now() / 1000);
    process.stdout.write(`\r    waiting out challenge window: ${remaining}s remaining   `);
    await new Promise((r) => setTimeout(r, 2_000));
  }
  process.stdout.write("\n");
  timer.mark("8-challenge-window-elapsed");

  // ---- 9. Settle --------------------------------------------------------
  const lenderBefore = await stable.balanceOf(lender.address);
  const settleTx = await claims.settle(loanId);
  await settleTx.wait();
  const lenderAfter = await stable.balanceOf(lender.address);
  timer.mark("9-settled", `cc tx ${settleTx.hash}`);

  console.log("\nOutcome");
  console.log(`  payout to lender : ${ethers.formatUnits(lenderAfter - lenderBefore, 6)} qUSD`);
  console.log(`  loss ratio       : ${await pool.lossRatioWad()} (wad)`);
  console.log(`  solvency ratio   : ${await pool.solvencyRatioWad()} (wad)`);
  console.log(`  claims paid      : ${ethers.formatUnits(await pool.totalClaimsPaid(), 6)}`);
  console.log(`\nTotal elapsed: ${timer.total()}s`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
