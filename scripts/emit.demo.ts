import { ethers } from "hardhat";
import { load, OriginDeployment } from "./lib/deployments";
import { PhaseTimer } from "./lib/attestcoin";

/**
 * Emits a real LoanDisbursed event on Sepolia and prints the transaction hash.
 * That hash is the input to verify.e2e.ts.
 *
 * Usage:
 *   npx hardhat run scripts/emit.demo.ts --network sepolia
 */
async function main() {
  const timer = new PhaseTimer();
  const [lender] = await ethers.getSigners();
  const { quitaOrigin } = load<OriginDeployment>("sepolia");

  const origin = await ethers.getContractAt("QuitaOrigin", quitaOrigin, lender);

  const label = process.env.DEMO_LOAN_LABEL ?? `demo-${Date.now()}`;
  const loanId = ethers.keccak256(ethers.toUtf8Bytes(label));

  // The borrower identifier never leaves the lender. Only the salted commitment is emitted.
  const nationalId = ethers.keccak256(ethers.toUtf8Bytes("DEMO-NATIONAL-ID"));
  const salt = ethers.hexlify(ethers.randomBytes(32));
  const borrowerCommitment = await origin.commitmentFor(nationalId, loanId, salt);

  const principal = ethers.parseUnits(process.env.DEMO_PRINCIPAL ?? "25000", 6);
  const termMonths = 36;
  const ageBand = 6; // 48-53
  const sex = 1; // male

  console.log(`QuitaOrigin : ${quitaOrigin}`);
  console.log(`loanId      : ${loanId}`);
  console.log(`commitment  : ${borrowerCommitment}`);
  console.log(`principal   : ${ethers.formatUnits(principal, 6)}`);

  timer.mark("submit");
  const tx = await origin.disburse(
    loanId,
    borrowerCommitment,
    principal,
    termMonths,
    ageBand,
    sex
  );
  console.log(`txHash      : ${tx.hash}`);

  const receipt = await tx.wait();
  timer.mark("mined", `block ${receipt?.blockNumber}, status ${receipt?.status}`);

  console.log(`\nSepolia explorer: https://sepolia.etherscan.io/tx/${tx.hash}`);
  console.log(`\nNext step:`);
  console.log(`  DEMO_TX_HASH=${tx.hash} npx hardhat run scripts/verify.e2e.ts --network creditcoin`);
  console.log(`\nTotal: ${timer.total()}s`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
