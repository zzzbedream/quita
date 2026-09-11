import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployStack } from "./helpers/deploy";

const WAD = 10n ** 18n;
const LOAN = ethers.keccak256(ethers.toUtf8Bytes("pool-loan"));

describe("CapitalPool", () => {
  async function fixture() {
    return deployStack();
  }

  describe("share accounting", () => {
    it("issues shares one to one for the first deposit", async () => {
      const { pool, lp } = await loadFixture(fixture);
      expect(await pool.sharesOf(lp.address)).to.equal(5_000_000n);
      expect(await pool.totalAssets()).to.equal(5_000_000n);
    });

    it("issues proportional shares to a later depositor", async () => {
      const { pool, stable, outsider } = await loadFixture(fixture);

      await stable.mint(outsider.address, 1_000_000n);
      await stable.connect(outsider).approve(await pool.getAddress(), 1_000_000n);
      await pool.connect(outsider).deposit(1_000_000n);

      expect(await pool.sharesOf(outsider.address)).to.equal(1_000_000n);
      expect(await pool.totalAssets()).to.equal(6_000_000n);
    });

    it("redeems shares back to assets", async () => {
      const { pool, stable, lp } = await loadFixture(fixture);

      await pool.connect(lp).withdraw(1_000_000n);

      expect(await pool.totalAssets()).to.equal(4_000_000n);
      expect(await stable.balanceOf(lp.address)).to.equal(5_000_000n + 1_000_000n);
    });

    it("rejects withdrawing more shares than held", async () => {
      const { pool, lp } = await loadFixture(fixture);

      await expect(pool.connect(lp).withdraw(9_000_000n)).to.be.revertedWithCustomError(
        pool,
        "InsufficientShares"
      );
    });
  });

  describe("locked capital", () => {
    it("prevents a withdrawal that would break cover for live policies", async () => {
      const { pool, lp, deployer } = await loadFixture(fixture);

      await pool.setAuthorized(deployer.address, true);
      await pool.reserveCapacity(LOAN, 4_800_000n);

      // Only 200_000 is genuinely free.
      await expect(pool.connect(lp).withdraw(1_000_000n)).to.be.revertedWithCustomError(
        pool,
        "WithdrawalWouldBreachLockedCapital"
      );

      await pool.connect(lp).withdraw(100_000n);
      expect(await pool.totalAssets()).to.equal(4_900_000n);
    });

    it("reports free capacity net of locked capital", async () => {
      const { pool, deployer } = await loadFixture(fixture);
      await pool.setAuthorized(deployer.address, true);

      await pool.reserveCapacity(LOAN, 1_500_000n);

      expect(await pool.lockedCapital()).to.equal(1_500_000n);
      expect(await pool.freeCapacity()).to.equal(3_500_000n);
    });

    it("rejects a reservation beyond free capacity", async () => {
      const { pool, deployer } = await loadFixture(fixture);
      await pool.setAuthorized(deployer.address, true);

      await expect(
        pool.reserveCapacity(LOAN, 6_000_000n)
      ).to.be.revertedWithCustomError(pool, "InsufficientFreeCapacity");
    });

    it("rejects reservation from an unauthorized caller", async () => {
      const { pool, outsider } = await loadFixture(fixture);

      await expect(pool.connect(outsider).reserveCapacity(LOAN, 1n))
        .to.be.revertedWithCustomError(pool, "NotAuthorized")
        .withArgs(outsider.address);
    });
  });

  describe("published solvency", () => {
    it("reports a zero loss ratio before any premium is collected", async () => {
      const { pool } = await loadFixture(fixture);
      expect(await pool.lossRatioWad()).to.equal(0n);
    });

    it("computes the loss ratio as claims over premium", async () => {
      const { pool, deployer } = await loadFixture(fixture);
      await pool.setAuthorized(deployer.address, true);

      await pool.recordPremium(100_000n);
      await pool.reserveCapacity(LOAN, 20_000n);
      await pool.payClaim(LOAN, deployer.address, 18_000n);

      // 18_000 / 100_000 == 0.18
      expect(await pool.lossRatioWad()).to.equal((18n * WAD) / 100n);
    });

    it("computes the solvency ratio against the MCR", async () => {
      const { pool } = await loadFixture(fixture);
      // 5_000_000 assets against a 1_000_000 MCR.
      expect(await pool.solvencyRatioWad()).to.equal(5n * WAD);
    });

    it("flags being below the MCR", async () => {
      const { pool } = await loadFixture(fixture);
      expect(await pool.isBelowMcr()).to.equal(false);

      await pool.setMcr(9_000_000n);
      expect(await pool.isBelowMcr()).to.equal(true);
    });
  });

  describe("claims", () => {
    it("releases the reservation and decrements the active policy count", async () => {
      const { pool, deployer } = await loadFixture(fixture);
      await pool.setAuthorized(deployer.address, true);

      await pool.reserveCapacity(LOAN, 50_000n);
      expect(await pool.activePolicyCount()).to.equal(1n);

      await pool.payClaim(LOAN, deployer.address, 50_000n);

      expect(await pool.lockedCapital()).to.equal(0n);
      expect(await pool.activePolicyCount()).to.equal(0n);
      expect(await pool.totalClaimsPaid()).to.equal(50_000n);
    });

    it("rejects a claim payment from an unauthorized caller", async () => {
      const { pool, outsider } = await loadFixture(fixture);

      await expect(pool.connect(outsider).payClaim(LOAN, outsider.address, 1n))
        .to.be.revertedWithCustomError(pool, "NotAuthorized")
        .withArgs(outsider.address);
    });
  });
});
