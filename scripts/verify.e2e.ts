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
 * The headline script: takes a real Sepolia transaction hash, proves its inclusion through the
 * Attestcoin Protocol, and submits it to LoanMirror on Creditcoin where the 0xFD2 precompile
 * verifies it synchronously.
 *
 * Every phase is timed because those numbers are the substance of the demo: they show the
 * end-to-end latency of trustless cross-chain state, dominated by Ethereum finality.
 *
 * Usage:
 *   DEMO_TX_HASH=0x... npx hardhat run scripts/verify.e2e.ts --network creditcoin
 */
const ACTION_DISBURSE = 0;

async function main() {
  const timer = new PhaseTimer();

  const txHash = process.env.DEMO_TX_HASH;
  if (!txHash || !txHash.startsWith("0x") || txHash.length !== 66) {
    throw new Error("Set DEMO_TX_HASH to the Sepolia transaction hash from emit.demo.ts");
  }

  const creditcoin = load<CreditcoinDeployment>("creditcoin");
  const origin = load<OriginDeployment>("sepolia");

  const sepoliaRpc = process.env.SEPOLIA_RPC_URL;
  if (!sepoliaRpc) throw new Error("SEPOLIA_RPC_URL is required to read the source receipt");
  const sourceProvider = new ethers.JsonRpcProvider(sepoliaRpc);

  const proofBuilderUrl = process.env.PROOF_BUILDER_URL ?? PROOF_BUILDER_URLS[0];

  console.log("Quita end-to-end verification");
  console.log(`  source tx      : ${txHash}`);
  console.log(`  QuitaOrigin    : ${origin.quitaOrigin} (chainKey ${creditcoin.sourceChainKey})`);
  console.log(`  LoanMirror     : ${creditcoin.loanMirror}`);
  console.log(`  Proof Builder  : ${proofBuilderUrl}\n`);

  // ---- Phase 1-3: attestation wait and proof generation ------------------
  const proof = await generateProof(
    txHash,
    creditcoin.sourceChainKey,
    proofBuilderUrl,
    sourceProvider,
    (phase, detail) => timer.mark(phase, detail)
  );
  timer.mark(
    "proof-ready",
    `height ${proof.headerNumber}, ${proof.merkleProof.siblings.length} siblings, ` +
      `${proof.continuityProof.roots.length} continuity roots, cached=${proof.cached ?? false}`
  );

  // ---- Phase 4: on-chain verification -----------------------------------
  const [signer] = await ethers.getSigners();
  const mirror = await ethers.getContractAt("LoanMirror", creditcoin.loanMirror, signer);

  const args = toExecuteArgs(ACTION_DISBURSE, creditcoin.sourceChainKey, proof);
  const gasLimit = computeGasLimit(proof);
  timer.mark("submit", `gasLimit ${gasLimit}`);

  const tx = await mirror.executeFromSource(...args, { gasLimit });
  console.log(`  creditcoin tx  : ${tx.hash}`);
  const receipt = await tx.wait();
  timer.mark("verified", `block ${receipt?.blockNumber}, gasUsed ${receipt?.gasUsed}`);

  // ---- Phase 5: read the verified state ---------------------------------
  const loanCount = await mirror.loanCount();
  const loanId = await mirror.loanIdAt(loanCount - 1n);
  const loan = await mirror.getLoan(loanId);

  console.log("\nVerified loan state on Creditcoin");
  console.log(`  loanId       : ${loanId}`);
  console.log(`  commitment   : ${loan.borrowerCommitment}`);
  console.log(`  lender       : ${loan.lender}`);
  console.log(`  principal    : ${ethers.formatUnits(loan.principal, 6)}`);
  console.log(`  outstanding  : ${ethers.formatUnits(loan.outstanding, 6)}`);
  console.log(`  ageBand/sex  : ${loan.ageBand}/${loan.sex}`);
  console.log(`  active       : ${loan.active}`);

  console.log("\nProof of both sides");
  console.log(`  Sepolia    : https://sepolia.etherscan.io/tx/${txHash}`);
  console.log(
    `  Creditcoin : https://creditcoin-testnet.blockscout.com/tx/${tx.hash}`
  );
  console.log(`\nTotal elapsed: ${timer.total()}s`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
