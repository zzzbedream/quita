import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const LOAN = ethers.keccak256(ethers.toUtf8Bytes("loan:1"));
const COMMITMENT = ethers.keccak256(ethers.toUtf8Bytes("commitment:1"));

describe("QuitaOrigin", () => {
  async function fixture() {
    const [owner, lender, attestor, outsider] = await ethers.getSigners();
    const origin = await (await ethers.getContractFactory("QuitaOrigin")).deploy(owner.address);
    await origin.waitForDeployment();
    await origin.setLender(lender.address, true);
    await origin.setAttestor(attestor.address, true);
    return { origin, owner, lender, attestor, outsider };
  }

  describe("access control", () => {
    it("only lets the owner register lenders and attestors", async () => {
      const { origin, outsider } = await loadFixture(fixture);

      await expect(
        origin.connect(outsider).setLender(outsider.address, true)
      ).to.be.revertedWithCustomError(origin, "OwnableUnauthorizedAccount");

      await expect(
        origin.connect(outsider).setAttestor(outsider.address, true)
      ).to.be.revertedWithCustomError(origin, "OwnableUnauthorizedAccount");
    });

    it("rejects disbursement from an unregistered lender", async () => {
      const { origin, outsider } = await loadFixture(fixture);

      await expect(
        origin.connect(outsider).disburse(LOAN, COMMITMENT, 1_000n, 12, 3, 1)
      )
        .to.be.revertedWithCustomError(origin, "NotRegisteredLender")
        .withArgs(outsider.address);
    });

    it("rejects a death attestation from an unregistered attestor", async () => {
      const { origin, lender, outsider } = await loadFixture(fixture);
      await origin.connect(lender).disburse(LOAN, COMMITMENT, 1_000n, 12, 3, 1);

      await expect(origin.connect(outsider).attestDeath(LOAN, 1_757_000_000n, ethers.ZeroHash))
        .to.be.revertedWithCustomError(origin, "NotRegisteredAttestor")
        .withArgs(outsider.address);
    });

    it("lets a revoked lender no longer disburse", async () => {
      const { origin, lender } = await loadFixture(fixture);
      await origin.setLender(lender.address, false);

      await expect(
        origin.connect(lender).disburse(LOAN, COMMITMENT, 1_000n, 12, 3, 1)
      ).to.be.revertedWithCustomError(origin, "NotRegisteredLender");
    });
  });

  describe("event emission", () => {
    it("emits LoanDisbursed with the exact cross-chain signature", async () => {
      const { origin, lender } = await loadFixture(fixture);

      await expect(origin.connect(lender).disburse(LOAN, COMMITMENT, 5_000n, 24, 4, 0))
        .to.emit(origin, "LoanDisbursed")
        .withArgs(LOAN, COMMITMENT, lender.address, 5_000n, 24, 4, 0);
    });

    it("emits RepaymentMade carrying the authoritative post-balance", async () => {
      const { origin, lender } = await loadFixture(fixture);
      await origin.connect(lender).disburse(LOAN, COMMITMENT, 5_000n, 24, 4, 0);

      await expect(origin.connect(lender).repay(LOAN, 2_000n))
        .to.emit(origin, "RepaymentMade")
        .withArgs(LOAN, 2_000n, 3_000n);

      expect(await origin.outstandingOf(LOAN)).to.equal(3_000n);
    });

    it("emits PremiumPaid", async () => {
      const { origin, lender } = await loadFixture(fixture);
      await origin.connect(lender).disburse(LOAN, COMMITMENT, 5_000n, 24, 4, 0);

      await expect(origin.connect(lender).payPremium(LOAN, 17n, 1n))
        .to.emit(origin, "PremiumPaid")
        .withArgs(LOAN, 17n, 1n);
    });

    it("emits DeathAttested with the borrower commitment, never an identifier", async () => {
      const { origin, lender, attestor } = await loadFixture(fixture);
      await origin.connect(lender).disburse(LOAN, COMMITMENT, 5_000n, 24, 4, 0);
      const evidence = ethers.keccak256(ethers.toUtf8Bytes("certificate"));

      await expect(origin.connect(attestor).attestDeath(LOAN, 1_757_000_000n, evidence))
        .to.emit(origin, "DeathAttested")
        .withArgs(COMMITMENT, LOAN, 1_757_000_000n, evidence, attestor.address);
    });
  });

  describe("accounting", () => {
    it("deactivates a fully repaid loan", async () => {
      const { origin, lender } = await loadFixture(fixture);
      await origin.connect(lender).disburse(LOAN, COMMITMENT, 5_000n, 24, 4, 0);

      await origin.connect(lender).repay(LOAN, 5_000n);

      const loan = await origin.loans(LOAN);
      expect(loan.active).to.equal(false);
      expect(loan.outstanding).to.equal(0n);
    });

    it("rejects a repayment larger than the outstanding balance", async () => {
      const { origin, lender } = await loadFixture(fixture);
      await origin.connect(lender).disburse(LOAN, COMMITMENT, 5_000n, 24, 4, 0);

      await expect(origin.connect(lender).repay(LOAN, 6_000n))
        .to.be.revertedWithCustomError(origin, "RepaymentExceedsOutstanding")
        .withArgs(6_000n, 5_000n);
    });

    it("rejects duplicate loan ids and invalid parameters", async () => {
      const { origin, lender } = await loadFixture(fixture);
      await origin.connect(lender).disburse(LOAN, COMMITMENT, 5_000n, 24, 4, 0);

      await expect(origin.connect(lender).disburse(LOAN, COMMITMENT, 1n, 1, 0, 0))
        .to.be.revertedWithCustomError(origin, "LoanAlreadyExists")
        .withArgs(LOAN);

      const other = ethers.keccak256(ethers.toUtf8Bytes("loan:2"));
      await expect(
        origin.connect(lender).disburse(other, COMMITMENT, 0n, 12, 3, 1)
      ).to.be.revertedWithCustomError(origin, "InvalidPrincipal");
      await expect(
        origin.connect(lender).disburse(other, COMMITMENT, 10n, 0, 3, 1)
      ).to.be.revertedWithCustomError(origin, "InvalidTerm");
      await expect(origin.connect(lender).disburse(other, COMMITMENT, 10n, 12, 3, 2))
        .to.be.revertedWithCustomError(origin, "InvalidSex")
        .withArgs(2);
    });
  });

  describe("borrower privacy", () => {
    it("derives the commitment by salted hash so identifiers never appear on-chain", async () => {
      const { origin } = await loadFixture(fixture);
      const nationalId = ethers.keccak256(ethers.toUtf8Bytes("123.456.789-00"));
      const salt = ethers.keccak256(ethers.toUtf8Bytes("per-borrower-salt"));

      const expected = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["bytes32", "bytes32", "bytes32"],
          [nationalId, LOAN, salt]
        )
      );

      expect(await origin.commitmentFor(nationalId, LOAN, salt)).to.equal(expected);
    });

    it("produces different commitments for the same borrower on different loans", async () => {
      const { origin } = await loadFixture(fixture);
      const nationalId = ethers.keccak256(ethers.toUtf8Bytes("123.456.789-00"));
      const salt = ethers.keccak256(ethers.toUtf8Bytes("per-borrower-salt"));
      const otherLoan = ethers.keccak256(ethers.toUtf8Bytes("loan:2"));

      expect(await origin.commitmentFor(nationalId, LOAN, salt)).to.not.equal(
        await origin.commitmentFor(nationalId, otherLoan, salt)
      );
    });
  });
});
