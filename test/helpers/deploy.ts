import { ethers } from "hardhat";
import { installMockVerifier, SEPOLIA_CHAIN_KEY } from "./attestcoin";

/** Stand-in for the QuitaOrigin deployment on Sepolia. */
export const ORIGIN = "0x00000000000000000000000000000000000000AA";
/** An attacker-deployed clone emitting identical events. */
export const CLONE = "0x00000000000000000000000000000000000000BB";

/** Deploys the whole Creditcoin side wired together, with the mock precompile installed. */
export async function deployStack(options: { mcr?: bigint } = {}) {
  const { mcr = 1_000_000n } = options;
  const [deployer, lp, attestorA, attestorB, attestorC, outsider] = await ethers.getSigners();

  const verifier = await installMockVerifier();

  const stable = await (await ethers.getContractFactory("MockStable")).deploy();
  await stable.waitForDeployment();

  const mirror = await (
    await ethers.getContractFactory("LoanMirror")
  ).deploy(SEPOLIA_CHAIN_KEY, ORIGIN);
  await mirror.waitForDeployment();

  const pool = await (
    await ethers.getContractFactory("CapitalPool")
  ).deploy(await stable.getAddress(), mcr, deployer.address);
  await pool.waitForDeployment();

  const registry = await (
    await ethers.getContractFactory("PolicyRegistry")
  ).deploy(SEPOLIA_CHAIN_KEY, ORIGIN, await mirror.getAddress(), deployer.address);
  await registry.waitForDeployment();

  const claims = await (
    await ethers.getContractFactory("ClaimEngine")
  ).deploy(
    SEPOLIA_CHAIN_KEY,
    ORIGIN,
    await mirror.getAddress(),
    await registry.getAddress(),
    await pool.getAddress(),
    deployer.address
  );
  await claims.waitForDeployment();

  // Wiring
  await registry.setCapitalPool(await pool.getAddress());
  await registry.setClaimEngine(await claims.getAddress());
  await pool.setAuthorized(await registry.getAddress(), true);
  await pool.setAuthorized(await claims.getAddress(), true);
  await claims.setAttestor(attestorA.address, true);
  await claims.setAttestor(attestorB.address, true);
  await claims.setAttestor(attestorC.address, true);

  // Seed liquidity so the pool starts solvent.
  await stable.mint(lp.address, 10_000_000n);
  await stable.connect(lp).approve(await pool.getAddress(), 10_000_000n);
  await pool.connect(lp).deposit(5_000_000n);

  return {
    deployer,
    lp,
    attestorA,
    attestorB,
    attestorC,
    outsider,
    verifier,
    stable,
    mirror,
    pool,
    registry,
    claims,
  };
}
