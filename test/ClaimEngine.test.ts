import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import {
  buildEncodedTransaction,
  buildProof,
  proofArgs,
  SEPOLIA_CHAIN_KEY,
} from "./helpers/attestcoin";
import { CLONE, deployStack, ORIGIN } from "./helpers/deploy";
import {
  commitment,
  deathAttestedLog,
  loanDisbursedLog,
  loanId,
  repaymentMadeLog,
} from "./helpers/events";

const ACTION_DISBURSE = 0;
const ACTION_REPAY = 1;
const ACTION_ATTEST = 0;

const LENDER = "0x000000000000000000000000000000000000CAFE";
const LOAN = loanId("claim");
const COMMITMENT = commitment("claim");

describe("ClaimEngine", () => {
  async function activePolicyFixture() {
    const stack = await deployStack();
    const { mirror, registry } = stack;

    // Mirror a 100_000 loan from a proved Sepolia disbursement.
    await mirror.executeFromSource(
      ACTION_DISBURSE,
      SEPOLIA_CHAIN_KEY,
      100n,
      buildEncodedTransaction({
        logs: [
          loanDisbursedLog({
            emitter: ORIGIN,
            loanId: LOAN,
            borrowerCommitment: COMMITMENT,
            lender: LENDER,
            principal: 100_000n,
            ageBand: 6,
            sex: 1,
          }),
        ],
      }),
      ...proofArgs(buildProof(1))
    );

    await registry.underwrite(LOAN);
    // Clear the 90 day waiting period.
    await time.increase(91 * 24 * 60 * 60);

    return stack;
  }

  function attestationTx(attestor: string, emitter = ORIGIN, status = 1) {
    return buildEncodedTransaction({
      receiptStatus: status,
      logs: [
        deathAttestedLog({
          emitter,
          borrowerCommitment: COMMITMENT,
          loanId: LOAN,
          dateOfDeath: 1_757_000_000n,
          evidenceHash: ethers.keccak256(ethers.toUtf8Bytes("death-certificate")),
          attestor,
        }),
      ],
    });
  }

  async function attest(
    claims: Awaited<ReturnType<typeof deployStack>>["claims"],
    attestor: string,
    txIndex: number,
    height: bigint
  ) {
    return claims.executeFromSource(
      ACTION_ATTEST,
      SEPOLIA_CHAIN_KEY,
      height,
      attestationTx(attestor),
      ...proofArgs(buildProof(txIndex, height))
    );
  }

  describe("threshold", () => {
    it("does not open the challenge window below the threshold", async () => {
      const { claims, attestorA } = await loadFixture(activePolicyFixture);

      await attest(claims, attestorA.address, 1, 200n);

      const claim = await claims.getClaim(LOAN);
      expect(claim.attestationCount).to.equal(1);
      expect(claim.status).to.equal(1); // Attesting
      expect(claim.challengeDeadline).to.equal(0n);
    });

    it("refuses to settle below the threshold", async () => {
      const { claims, attestorA } = await loadFixture(activePolicyFixture);
      await attest(claims, attestorA.address, 1, 200n);

      await expect(claims.settle(LOAN))
        .to.be.revertedWithCustomError(claims, "ThresholdNotReached")
        .withArgs(1, 2);
    });

    it("does not count the same attestor twice", async () => {
      const { claims, attestorA } = await loadFixture(activePolicyFixture);
      await attest(claims, attestorA.address, 1, 200n);

      // A second, distinct proof carrying the same attestor must not advance the count.
      await expect(attest(claims, attestorA.address, 2, 201n))
        .to.be.revertedWithCustomError(claims, "AlreadyAttested")
        .withArgs(LOAN, attestorA.address);

      expect((await claims.getClaim(LOAN)).attestationCount).to.equal(1);
    });

    it("rejects an attestation from an unregistered attestor", async () => {
      const { claims, outsider } = await loadFixture(activePolicyFixture);

      await expect(attest(claims, outsider.address, 1, 200n))
        .to.be.revertedWithCustomError(claims, "NotAnAttestor")
        .withArgs(outsider.address);
    });

    it("opens the challenge window once the threshold is reached", async () => {
      const { claims, attestorA, attestorB } = await loadFixture(activePolicyFixture);

      await attest(claims, attestorA.address, 1, 200n);
      await attest(claims, attestorB.address, 2, 201n);

      const claim = await claims.getClaim(LOAN);
      expect(claim.attestationCount).to.equal(2);
      expect(claim.status).to.equal(2); // Challenged
      expect(claim.challengeDeadline).to.be.greaterThan(0n);
    });
  });

  describe("challenge window", () => {
    async function attestedFixture() {
      const stack = await activePolicyFixture();
      await attest(stack.claims, stack.attestorA.address, 1, 200n);
      await attest(stack.claims, stack.attestorB.address, 2, 201n);
      return stack;
    }

    it("refuses to settle before the window expires", async () => {
      const { claims } = await loadFixture(attestedFixture);

      await expect(claims.settle(LOAN)).to.be.revertedWithCustomError(
        claims,
        "ChallengeWindowOpen"
      );
    });

    it("lets a challenge block the payout", async () => {
      const { claims, attestorC } = await loadFixture(attestedFixture);

      await claims.connect(attestorC).challenge(LOAN);
      await time.increase(25 * 60 * 60);

      await expect(claims.settle(LOAN))
        .to.be.revertedWithCustomError(claims, "ClaimDisputed")
        .withArgs(LOAN);
    });

    it("rejects a challenge from a non-attestor", async () => {
      const { claims, outsider } = await loadFixture(attestedFixture);

      await expect(claims.connect(outsider).challenge(LOAN))
        .to.be.revertedWithCustomError(claims, "NotAnAttestor")
        .withArgs(outsider.address);
    });
  });

  describe("settlement", () => {
    async function settleableFixture() {
      const stack = await activePolicyFixture();
      await attest(stack.claims, stack.attestorA.address, 1, 200n);
      await attest(stack.claims, stack.attestorB.address, 2, 201n);
      await time.increase(25 * 60 * 60);
      return stack;
    }

    it("pays the lender exactly min(sumInsured, verified outstanding)", async () => {
      const { claims, mirror, registry, stable } = await loadFixture(settleableFixture);

      // A proved repayment reduces the verified balance below the sum insured.
      await mirror.executeFromSource(
        ACTION_REPAY,
        SEPOLIA_CHAIN_KEY,
        300n,
        buildEncodedTransaction({
          logs: [
            repaymentMadeLog({
              emitter: ORIGIN,
              loanId: LOAN,
              amount: 40_000n,
              outstandingAfter: 60_000n,
            }),
          ],
        }),
        ...proofArgs(buildProof(5, 300n))
      );

      const sumInsured = (await registry.getPolicy(LOAN)).sumInsured;
      expect(sumInsured).to.equal(100_000n);
      expect(await mirror.outstanding(LOAN)).to.equal(60_000n);

      await claims.settle(LOAN);

      // The lower of the two, taken from the verified mirror rather than the attestation.
      expect(await stable.balanceOf(ethers.getAddress(LENDER))).to.equal(60_000n);
      expect((await claims.getClaim(LOAN)).payout).to.equal(60_000n);
    });

    it("pays the lender, not the borrower estate", async () => {
      const { claims, stable } = await loadFixture(settleableFixture);

      await expect(claims.settle(LOAN))
        .to.emit(claims, "ClaimSettled")
        .withArgs(LOAN, ethers.getAddress(LENDER), 100_000n, 100_000n);

      expect(await stable.balanceOf(ethers.getAddress(LENDER))).to.equal(100_000n);
    });

    it("reverts on a double settle", async () => {
      const { claims } = await loadFixture(settleableFixture);

      await claims.settle(LOAN);

      await expect(claims.settle(LOAN))
        .to.be.revertedWithCustomError(claims, "ClaimAlreadySettled")
        .withArgs(LOAN);
    });

    it("releases locked capital and closes the policy", async () => {
      const { claims, pool, registry } = await loadFixture(settleableFixture);

      expect(await pool.lockedCapital()).to.equal(100_000n);

      await claims.settle(LOAN);

      expect(await pool.lockedCapital()).to.equal(0n);
      expect(await pool.totalClaimsPaid()).to.equal(100_000n);
      expect((await registry.getPolicy(LOAN)).status).to.equal(3); // Claimed
    });

    /**
     * The load-bearing test for the whole trust story: an insurer that stops paying when its
     * solvency dips is not an insurer.
     */
    it("still pays when the pool is below the MCR", async () => {
      const { claims, pool, stable, deployer } = await loadFixture(settleableFixture);

      // Raise the MCR far above assets so the pool is unambiguously undercapitalised.
      await pool.connect(deployer).setMcr(500_000_000n);
      expect(await pool.isBelowMcr()).to.equal(true);

      await claims.settle(LOAN);

      expect(await stable.balanceOf(ethers.getAddress(LENDER))).to.equal(100_000n);
    });

    it("blocks new underwriting when the pool is below the MCR", async () => {
      const { mirror, pool, registry, deployer } = await loadFixture(settleableFixture);

      await pool.connect(deployer).setMcr(500_000_000n);

      const other = loanId("other");
      await mirror.executeFromSource(
        ACTION_DISBURSE,
        SEPOLIA_CHAIN_KEY,
        400n,
        buildEncodedTransaction({
          logs: [
            loanDisbursedLog({
              emitter: ORIGIN,
              loanId: other,
              borrowerCommitment: commitment("other"),
              lender: LENDER,
              principal: 10_000n,
            }),
          ],
        }),
        ...proofArgs(buildProof(7, 400n))
      );

      await expect(registry.underwrite(other)).to.be.revertedWithCustomError(
        pool,
        "BelowMinimumCapitalRequirement"
      );
    });
  });

  describe("proof integrity", () => {
    it("rejects an attestation log from a cloned emitter", async () => {
      const { claims } = await loadFixture(activePolicyFixture);
      const { attestorA } = await loadFixture(activePolicyFixture);

      await expect(
        claims.executeFromSource(
          ACTION_ATTEST,
          SEPOLIA_CHAIN_KEY,
          200n,
          attestationTx(attestorA.address, CLONE),
          ...proofArgs(buildProof(1, 200n))
        )
      )
        .to.be.revertedWithCustomError(claims, "UnauthorizedEmitter")
        .withArgs(ethers.getAddress(CLONE), ethers.getAddress(ORIGIN));
    });

    it("rejects an attestation carried by a reverted transaction", async () => {
      const { claims, attestorA } = await loadFixture(activePolicyFixture);

      await expect(
        claims.executeFromSource(
          ACTION_ATTEST,
          SEPOLIA_CHAIN_KEY,
          200n,
          attestationTx(attestorA.address, ORIGIN, 0),
          ...proofArgs(buildProof(1, 200n))
        )
      )
        .to.be.revertedWithCustomError(claims, "SourceTransactionReverted")
        .withArgs(0);
    });

    it("rejects a replayed attestation proof", async () => {
      const { claims, attestorA } = await loadFixture(activePolicyFixture);
      const proof = buildProof(1, 200n);

      await claims.executeFromSource(
        ACTION_ATTEST,
        SEPOLIA_CHAIN_KEY,
        200n,
        attestationTx(attestorA.address),
        ...proofArgs(proof)
      );

      await expect(
        claims.executeFromSource(
          ACTION_ATTEST,
          SEPOLIA_CHAIN_KEY,
          200n,
          attestationTx(attestorA.address),
          ...proofArgs(proof)
        )
      ).to.be.revertedWith("Query already processed");
    });
  });
});
