import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import {
  buildEncodedTransaction,
  buildProof,
  proofArgs,
  SEPOLIA_CHAIN_KEY,
} from "./helpers/attestcoin";
import { deployStack, ORIGIN } from "./helpers/deploy";
import { commitment, loanDisbursedLog, loanId, premiumPaidLog } from "./helpers/events";

const ACTION_DISBURSE = 0;
const ACTION_PREMIUM = 0;
const LENDER = "0x000000000000000000000000000000000000CAFE";

const DAY = 24 * 60 * 60;
const WAD = 10n ** 18n;

describe("PolicyRegistry", () => {
  async function mirrorLoan(
    stack: Awaited<ReturnType<typeof deployStack>>,
    label: string,
    principal: bigint,
    ageBand: number,
    sex: number,
    txIndex: number,
    height: bigint
  ) {
    await stack.mirror.executeFromSource(
      ACTION_DISBURSE,
      SEPOLIA_CHAIN_KEY,
      height,
      buildEncodedTransaction({
        logs: [
          loanDisbursedLog({
            emitter: ORIGIN,
            loanId: loanId(label),
            borrowerCommitment: commitment(label),
            lender: LENDER,
            principal,
            ageBand,
            sex,
          }),
        ],
      }),
      ...proofArgs(buildProof(txIndex, height))
    );
    return loanId(label);
  }

  async function fixture() {
    return deployStack();
  }

  describe("pricing", () => {
    it("prices deterministically by age band and sex", async () => {
      const { registry } = await loadFixture(fixture);

      // Youngest female band is the cheapest; male rates exceed female at the same band.
      expect(await registry.monthlyRateWad(0, 0)).to.equal(2n * 10n ** 14n);
      expect(await registry.monthlyRateWad(0, 1)).to.equal(32n * 10n ** 13n);
      expect(await registry.monthlyRateWad(9, 0)).to.equal(35n * 10n ** 14n);

      const band0 = await registry.monthlyRateWad(0, 1);
      const band6 = await registry.monthlyRateWad(6, 1);
      expect(band6).to.be.greaterThan(band0);
    });

    it("declares the rate table as a placeholder", async () => {
      const { registry } = await loadFixture(fixture);
      expect(await registry.TABLE_SOURCE()).to.equal(
        "PLACEHOLDER - pending BR-EMS 2021 (SUSEP)"
      );
    });
  });

  describe("underwriting", () => {
    it("takes the sum insured from the verified mirror", async () => {
      const stack = await loadFixture(fixture);
      const id = await mirrorLoan(stack, "a", 250_000n, 4, 0, 1, 100n);

      await stack.registry.underwrite(id);

      const policy = await stack.registry.getPolicy(id);
      expect(policy.sumInsured).to.equal(250_000n);
      expect(policy.premiumRateWad).to.equal(await stack.registry.monthlyRateWad(4, 0));
      expect(policy.status).to.equal(2); // Active
    });

    it("rejects a loan that was never mirrored", async () => {
      const { registry } = await loadFixture(fixture);

      await expect(registry.underwrite(loanId("ghost")))
        .to.be.revertedWithCustomError(registry, "LoanNotMirrored")
        .withArgs(loanId("ghost"));
    });

    it("rejects an entry age beyond the maximum band", async () => {
      const stack = await loadFixture(fixture);
      const id = await mirrorLoan(stack, "old", 10_000n, 12, 1, 2, 101n);

      await expect(stack.registry.underwrite(id))
        .to.be.revertedWithCustomError(stack.registry, "EntryAgeOutOfRange")
        .withArgs(12);
    });

    it("refuses to write the same loan twice", async () => {
      const stack = await loadFixture(fixture);
      const id = await mirrorLoan(stack, "dup", 10_000n, 3, 1, 3, 102n);

      await stack.registry.underwrite(id);
      await expect(stack.registry.underwrite(id))
        .to.be.revertedWithCustomError(stack.registry, "PolicyAlreadyExists")
        .withArgs(id);
    });

    it("locks capacity in the pool", async () => {
      const stack = await loadFixture(fixture);
      const id = await mirrorLoan(stack, "cap", 40_000n, 2, 1, 4, 103n);

      await stack.registry.underwrite(id);

      expect(await stack.pool.lockedCapital()).to.equal(40_000n);
      expect(await stack.pool.freeCapacity()).to.equal(5_000_000n - 40_000n);
    });
  });

  describe("waiting period", () => {
    it("sets a waiting period end in the future", async () => {
      const stack = await loadFixture(fixture);
      const id = await mirrorLoan(stack, "wait", 10_000n, 3, 1, 5, 104n);

      await stack.registry.underwrite(id);

      expect(await stack.registry.isPastWaitingPeriod(id)).to.equal(false);
      await time.increase(91 * DAY);
      expect(await stack.registry.isPastWaitingPeriod(id)).to.equal(true);
    });

    it("honours a reconfigured waiting period", async () => {
      const stack = await loadFixture(fixture);
      await stack.registry.setWaitingPeriod(0);

      const id = await mirrorLoan(stack, "nowait", 10_000n, 3, 1, 6, 105n);
      await stack.registry.underwrite(id);

      expect(await stack.registry.isPastWaitingPeriod(id)).to.equal(true);
    });
  });

  describe("premium accrual", () => {
    it("accrues pro rata on the outstanding balance", async () => {
      const stack = await loadFixture(fixture);
      const id = await mirrorLoan(stack, "accrue", 100_000n, 5, 1, 7, 106n);
      await stack.registry.underwrite(id);

      const rate = await stack.registry.monthlyRateWad(5, 1);
      await time.increase(30 * DAY);
      await stack.registry.accruePremium(id);

      // 30 days is exactly one month in the simplified schedule.
      const expected = (100_000n * rate) / WAD;
      expect((await stack.registry.getPolicy(id)).premiumsAccrued).to.equal(expected);
    });

    it("accrues a fraction of a month for a partial period", async () => {
      const stack = await loadFixture(fixture);
      const id = await mirrorLoan(stack, "partial", 100_000n, 5, 1, 8, 107n);
      await stack.registry.underwrite(id);

      const rate = await stack.registry.monthlyRateWad(5, 1);
      await time.increase(15 * DAY);
      await stack.registry.accruePremium(id);

      const monthly = (100_000n * rate) / WAD;
      expect((await stack.registry.getPolicy(id)).premiumsAccrued).to.equal(
        (monthly * 15n) / 30n
      );
    });

    it("accrues nothing for less than a full day", async () => {
      const stack = await loadFixture(fixture);
      const id = await mirrorLoan(stack, "sameday", 100_000n, 5, 1, 9, 108n);
      await stack.registry.underwrite(id);

      await stack.registry.accruePremium(id);
      expect((await stack.registry.getPolicy(id)).premiumsAccrued).to.equal(0n);
    });

    it("charges on the declining balance, not the original principal", async () => {
      const stack = await loadFixture(fixture);
      const id = await mirrorLoan(stack, "declining", 100_000n, 5, 1, 10, 109n);
      await stack.registry.underwrite(id);
      const rate = await stack.registry.monthlyRateWad(5, 1);

      // Halve the verified balance, then sync the policy to it.
      await stack.mirror.executeFromSource(
        1,
        SEPOLIA_CHAIN_KEY,
        200n,
        buildEncodedTransaction({
          logs: [
            {
              emitter: ORIGIN,
              topics: [ethers.id("RepaymentMade(bytes32,uint256,uint256)"), id],
              data: ethers.AbiCoder.defaultAbiCoder().encode(
                ["uint256", "uint256"],
                [50_000n, 50_000n]
              ),
            },
          ],
        }),
        ...proofArgs(buildProof(11, 200n))
      );
      await stack.registry.syncSumInsured(id);

      await time.increase(30 * DAY);
      await stack.registry.accruePremium(id);

      const policy = await stack.registry.getPolicy(id);
      expect(policy.sumInsured).to.equal(50_000n);
      // Premium for the month reflects 50_000, not 100_000.
      expect(policy.premiumsAccrued).to.equal((50_000n * rate) / WAD);
    });
  });

  describe("proved premium collection", () => {
    it("credits a proved PremiumPaid event to the policy and the pool", async () => {
      const stack = await loadFixture(fixture);
      const id = await mirrorLoan(stack, "prem", 100_000n, 5, 1, 12, 110n);
      await stack.registry.underwrite(id);

      await stack.registry.executeFromSource(
        ACTION_PREMIUM,
        SEPOLIA_CHAIN_KEY,
        300n,
        buildEncodedTransaction({
          logs: [
            premiumPaidLog({ emitter: ORIGIN, loanId: id, amount: 155n, periodIndex: 1n }),
          ],
        }),
        ...proofArgs(buildProof(13, 300n))
      );

      expect((await stack.registry.getPolicy(id)).premiumsCollected).to.equal(155n);
      expect(await stack.pool.totalPremiumsCollected()).to.equal(155n);
    });

    it("makes the loss ratio computable from proved counters alone", async () => {
      const stack = await loadFixture(fixture);
      const id = await mirrorLoan(stack, "ratio", 100_000n, 5, 1, 14, 111n);
      await stack.registry.underwrite(id);

      await stack.registry.executeFromSource(
        ACTION_PREMIUM,
        SEPOLIA_CHAIN_KEY,
        300n,
        buildEncodedTransaction({
          logs: [
            premiumPaidLog({ emitter: ORIGIN, loanId: id, amount: 1_000n, periodIndex: 1n }),
          ],
        }),
        ...proofArgs(buildProof(15, 300n))
      );

      // No claims yet, so the loss ratio is zero against 1000 of collected premium.
      expect(await stack.pool.lossRatioWad()).to.equal(0n);
      expect(await stack.pool.totalPremiumsCollected()).to.equal(1_000n);
    });

    it("rejects a premium event for an unknown policy", async () => {
      const stack = await loadFixture(fixture);

      await expect(
        stack.registry.executeFromSource(
          ACTION_PREMIUM,
          SEPOLIA_CHAIN_KEY,
          300n,
          buildEncodedTransaction({
            logs: [
              premiumPaidLog({
                emitter: ORIGIN,
                loanId: loanId("nopolicy"),
                amount: 10n,
                periodIndex: 1n,
              }),
            ],
          }),
          ...proofArgs(buildProof(16, 300n))
        )
      ).to.be.revertedWithCustomError(stack.registry, "PolicyNotFound");
    });
  });
});
