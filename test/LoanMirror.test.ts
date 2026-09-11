import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import {
  buildEncodedTransaction,
  buildProof,
  installMockVerifier,
  proofArgs,
  MAINNET_CHAIN_KEY,
  SEPOLIA_CHAIN_KEY,
} from "./helpers/attestcoin";
import { commitment, loanDisbursedLog, loanId, repaymentMadeLog } from "./helpers/events";

const ACTION_DISBURSE = 0;
const ACTION_REPAY = 1;

/** Stand-in for the QuitaOrigin deployment on Sepolia. */
const ORIGIN = "0x00000000000000000000000000000000000000AA";
/** An attacker-deployed clone emitting identical events. */
const CLONE = "0x00000000000000000000000000000000000000BB";

const LENDER = "0x000000000000000000000000000000000000CAFE";

describe("LoanMirror", () => {
  async function deployFixture() {
    const verifier = await installMockVerifier();
    const factory = await ethers.getContractFactory("LoanMirror");
    const mirror = await factory.deploy(SEPOLIA_CHAIN_KEY, ORIGIN);
    await mirror.waitForDeployment();
    return { mirror, verifier };
  }

  const disbursementTx = (emitter = ORIGIN, principal = 10_000n, status = 1) =>
    buildEncodedTransaction({
      receiptStatus: status,
      logs: [
        loanDisbursedLog({
          emitter,
          loanId: loanId("a"),
          borrowerCommitment: commitment("a"),
          lender: LENDER,
          principal,
        }),
      ],
    });

  const repaymentTx = (outstandingAfter: bigint, amount = 1_000n, emitter = ORIGIN) =>
    buildEncodedTransaction({
      logs: [repaymentMadeLog({ emitter, loanId: loanId("a"), amount, outstandingAfter })],
    });

  async function mirrorDisbursement(
    mirror: Awaited<ReturnType<typeof deployFixture>>["mirror"],
    principal = 10_000n
  ) {
    const proof = buildProof(1);
    await mirror.executeFromSource(
      ACTION_DISBURSE,
      SEPOLIA_CHAIN_KEY,
      100n,
      disbursementTx(ORIGIN, principal),
      ...proofArgs(proof)
    );
  }

  describe("happy path", () => {
    it("mirrors a disbursement into verified loan state", async () => {
      const { mirror } = await loadFixture(deployFixture);

      await mirrorDisbursement(mirror);

      const loan = await mirror.getLoan(loanId("a"));
      expect(loan.principal).to.equal(10_000n);
      expect(loan.outstanding).to.equal(10_000n);
      expect(loan.lender).to.equal(ethers.getAddress(LENDER));
      expect(loan.borrowerCommitment).to.equal(commitment("a"));
      expect(loan.active).to.equal(true);
      expect(await mirror.loanCount()).to.equal(1n);
    });

    it("takes outstanding from outstandingAfter rather than recomputing it", async () => {
      const { mirror } = await loadFixture(deployFixture);
      await mirrorDisbursement(mirror);

      // amount and outstandingAfter are deliberately inconsistent: 10000 - 1000 != 7777.
      // The mirror must trust outstandingAfter, which is the source chain post-state.
      await mirror.executeFromSource(
        ACTION_REPAY,
        SEPOLIA_CHAIN_KEY,
        101n,
        repaymentTx(7_777n, 1_000n),
        ...proofArgs(buildProof(2, 101n))
      );

      expect(await mirror.outstanding(loanId("a"))).to.equal(7_777n);
    });

    it("closes the loan when the balance reaches zero", async () => {
      const { mirror } = await loadFixture(deployFixture);
      await mirrorDisbursement(mirror);

      await mirror.executeFromSource(
        ACTION_REPAY,
        SEPOLIA_CHAIN_KEY,
        101n,
        repaymentTx(0n, 10_000n),
        ...proofArgs(buildProof(2, 101n))
      );

      expect(await mirror.isActive(loanId("a"))).to.equal(false);
      expect(await mirror.totalOutstanding()).to.equal(0n);
    });
  });

  describe("rejections", () => {
    it("rejects a replayed proof", async () => {
      const { mirror } = await loadFixture(deployFixture);
      const proof = buildProof(1);

      await mirror.executeFromSource(
        ACTION_DISBURSE,
        SEPOLIA_CHAIN_KEY,
        100n,
        disbursementTx(),
        ...proofArgs(proof)
      );

      // Identical height and txIndex produce an identical queryId.
      await expect(
        mirror.executeFromSource(
          ACTION_DISBURSE,
          SEPOLIA_CHAIN_KEY,
          100n,
          disbursementTx(),
          ...proofArgs(proof)
        )
      ).to.be.revertedWith("Query already processed");
    });

    it("rejects a transaction whose receipt status is not 1", async () => {
      const { mirror } = await loadFixture(deployFixture);

      // The logs exist and the inclusion proof is genuine, but the transaction reverted.
      await expect(
        mirror.executeFromSource(
          ACTION_DISBURSE,
          SEPOLIA_CHAIN_KEY,
          100n,
          disbursementTx(ORIGIN, 10_000n, 0),
          ...proofArgs(buildProof(1))
        )
      )
        .to.be.revertedWithCustomError(mirror, "SourceTransactionReverted")
        .withArgs(0);
    });

    it("rejects a log emitted by a contract other than QuitaOrigin", async () => {
      const { mirror } = await loadFixture(deployFixture);

      await expect(
        mirror.executeFromSource(
          ACTION_DISBURSE,
          SEPOLIA_CHAIN_KEY,
          100n,
          disbursementTx(CLONE),
          ...proofArgs(buildProof(1))
        )
      )
        .to.be.revertedWithCustomError(mirror, "UnauthorizedEmitter")
        .withArgs(ethers.getAddress(CLONE), ethers.getAddress(ORIGIN));
    });

    it("rejects an out-of-order repayment that would inflate the balance", async () => {
      const { mirror } = await loadFixture(deployFixture);
      await mirrorDisbursement(mirror);

      await mirror.executeFromSource(
        ACTION_REPAY,
        SEPOLIA_CHAIN_KEY,
        101n,
        repaymentTx(6_000n),
        ...proofArgs(buildProof(2, 101n))
      );

      // A stale repayment proved later would raise the balance back up.
      await expect(
        mirror.executeFromSource(
          ACTION_REPAY,
          SEPOLIA_CHAIN_KEY,
          102n,
          repaymentTx(9_000n),
          ...proofArgs(buildProof(3, 102n))
        )
      )
        .to.be.revertedWithCustomError(mirror, "OutOfOrderRepayment")
        .withArgs(loanId("a"), 9_000n, 6_000n);

      expect(await mirror.outstanding(loanId("a"))).to.equal(6_000n);
    });

    it("rejects a proof presented for a different source chain", async () => {
      const { mirror } = await loadFixture(deployFixture);

      await expect(
        mirror.executeFromSource(
          ACTION_DISBURSE,
          MAINNET_CHAIN_KEY,
          100n,
          disbursementTx(),
          ...proofArgs(buildProof(1))
        )
      )
        .to.be.revertedWithCustomError(mirror, "UnexpectedChainKey")
        .withArgs(MAINNET_CHAIN_KEY, SEPOLIA_CHAIN_KEY);
    });

    it("rejects the inherited unguarded execute entrypoint", async () => {
      const { mirror } = await loadFixture(deployFixture);

      // ASCBase.execute cannot be overridden, so it must be made inert instead.
      await expect(
        mirror.execute(
          ACTION_DISBURSE,
          MAINNET_CHAIN_KEY,
          100n,
          disbursementTx(),
          ...proofArgs(buildProof(1))
        )
      ).to.be.revertedWithCustomError(mirror, "DirectExecuteDisabled");
    });

    it("rejects when the precompile reports verification failure", async () => {
      const { mirror, verifier } = await loadFixture(deployFixture);
      await verifier.setShouldVerify(false);

      await expect(
        mirror.executeFromSource(
          ACTION_DISBURSE,
          SEPOLIA_CHAIN_KEY,
          100n,
          disbursementTx(),
          ...proofArgs(buildProof(1))
        )
      ).to.be.revertedWith("Proof of inclusion verification failed");
    });

    it("rejects a repayment for a loan that was never mirrored", async () => {
      const { mirror } = await loadFixture(deployFixture);

      await expect(
        mirror.executeFromSource(
          ACTION_REPAY,
          SEPOLIA_CHAIN_KEY,
          101n,
          repaymentTx(5_000n),
          ...proofArgs(buildProof(2, 101n))
        )
      )
        .to.be.revertedWithCustomError(mirror, "LoanNotMirrored")
        .withArgs(loanId("a"));
    });
  });
});
