/**
 * Proves the fourth and last source event: PremiumPaid.
 *
 * The submission claims all four QuitaOrigin events are verified through the Attestcoin
 * Protocol. LoanDisbursed, RepaymentMade and DeathAttested are proved on live testnet by the
 * other demo scripts; this closes the set, so the claim is backed by four transactions rather
 * than by three plus an assertion.
 *
 * It also gives totalPremiumsCollected a non-zero value, which is what lossRatioWad divides by.
 *
 *   npx hardhat run scripts/demo.premium.ts --network creditcoin
 *   DEMO_LOAN_ID=0x... DEMO_PREMIUM=48 npx hardhat run scripts/demo.premium.ts --network creditcoin
 *
 * Emits on Sepolia, waits out Ethereum finality, then submits the proof to PolicyRegistry.
 */
import { ethers } from "hardhat";
import {
  computeGasLimit, generateProof, PhaseTimer, PROOF_BUILDER_URLS, toExecuteArgs
} from "./lib/attestcoin";
import { load, CreditcoinDeployment, OriginDeployment } from "./lib/deployments";

const ACTION_PREMIUM_PAID = 0;

async function main() {
  const timer = new PhaseTimer();
  const creditcoin = load<CreditcoinDeployment>("creditcoin");
  const originDeployment = load<OriginDeployment>("sepolia");

  const sepoliaRpc = process.env.SEPOLIA_RPC_URL;
  if (!sepoliaRpc) throw new Error("SEPOLIA_RPC_URL is required");
  const sourceProvider = new ethers.JsonRpcProvider(sepoliaRpc);
  const proofBuilderUrl = process.env.PROOF_BUILDER_URL ?? PROOF_BUILDER_URLS[0];

  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("PRIVATE_KEY is required");
  const sourceSigner = new ethers.Wallet(pk, sourceProvider);

  const [ccSigner] = await ethers.getSigners();
  const registry = await ethers.getContractAt("PolicyRegistry", creditcoin.policyRegistry, ccSigner);
  const pool = await ethers.getContractAt("CapitalPool", creditcoin.capitalPool, ccSigner);
  const mirror = await ethers.getContractAt("LoanMirror", creditcoin.loanMirror, ccSigner);

  const origin = new ethers.Contract(originDeployment.quitaOrigin, [
    "function payPremium(bytes32 loanId, uint256 amount, uint64 periodIndex)"
  ], sourceSigner);

  const loanId = process.env.DEMO_LOAN_ID ?? (await discoverLoanId(mirror, creditcoin));
  const amount = ethers.parseUnits(process.env.DEMO_PREMIUM ?? "48", 6);
  const period = BigInt(process.env.DEMO_PERIOD ?? "1");

  console.log(`loanId  : ${loanId}`);
  console.log(`premium : ${ethers.formatUnits(amount, 6)} qUSD, period ${period}`);

  const before = await pool.totalPremiumsCollected();

  // ---- Emit on Sepolia ---------------------------------------------------
  timer.mark("premium:submit");
  const tx = await origin.payPremium(loanId, amount, period);
  const sourceReceipt = await tx.wait();
  timer.mark("premium:mined", `sepolia tx ${tx.hash}, block ${sourceReceipt.blockNumber}`);
  console.log(`  Sepolia: https://sepolia.etherscan.io/tx/${tx.hash}`);

  // ---- Prove it ----------------------------------------------------------
  const proof = await generateProof(
    tx.hash, creditcoin.sourceChainKey, proofBuilderUrl, sourceProvider,
    (phase, detail) => timer.mark(`premium:${phase}`, detail)
  );

  const consumer = new ethers.Contract(creditcoin.policyRegistry, [
    "function executeFromSource(uint8 action,uint64 chainKey,uint64 headerNumber,bytes txBytes,bytes32 root,(bytes32 hash,bool isLeft)[] siblings,bytes32 lowerEndpointDigest,bytes32[] roots) returns (bool)"
  ], ccSigner);

  const ccTx = await consumer.executeFromSource(
    ...toExecuteArgs(ACTION_PREMIUM_PAID, creditcoin.sourceChainKey, proof),
    { gasLimit: computeGasLimit(proof) }
  );
  const ccReceipt = await ccTx.wait();
  timer.mark("premium:verified", `cc tx ${ccTx.hash} gas ${ccReceipt?.gasUsed}`);
  console.log(`  Creditcoin: https://creditcoin-testnet.blockscout.com/tx/${ccTx.hash}`);

  // ---- Report ------------------------------------------------------------
  const q = (v: bigint) => ethers.formatUnits(v, 6);
  const [after, paid, loss] = await Promise.all([
    pool.totalPremiumsCollected(), pool.totalClaimsPaid(), pool.lossRatioWad()
  ]);

  console.log("\nBook state");
  console.log(`  premiums credited : ${q(after - before)} this run, ${q(after)} total`);
  console.log(`  claims paid       : ${q(paid)}`);
  console.log(`  loss ratio        : ${after === 0n ? "n/a" : (Number(loss) / 1e18 * 100).toFixed(1) + "%"}`);
  console.log("");
  console.log("  A ratio computed from one policy and one claim is a demonstration of the");
  console.log("  mechanism, not a market-comparable figure. A real book prices for roughly one");
  console.log("  death per thousand policy-years.");
  console.log(`\nTotal elapsed: ${timer.total()}`);
}

async function discoverLoanId(mirror: any, creditcoin: CreditcoinDeployment): Promise<string> {
  const head = await ethers.provider.getBlockNumber();
  const from = Math.max(0, Number(creditcoin.deployedAtBlock) - 1);
  const events = await mirror.queryFilter(mirror.filters.LoanMirrored(), from, head);
  if (events.length === 0) throw new Error("no mirrored loans found");
  return events[events.length - 1].args.loanId;
}

main().catch((e) => { console.error(e?.message ?? e); process.exitCode = 1; });
