/**
 * Provisions the two extra attestor keys the claim leg needs.
 *
 * Death attestation requires a 2-of-3 threshold and the contract refuses to count the same
 * attestor twice, so the demo genuinely needs two signers distinct from the deployer. This
 * generates them, funds them from the deployer, registers them on QuitaOrigin, and appends the
 * keys to .env.
 *
 * These are throwaway testnet keys for a demo. They are written to .env, which is gitignored.
 *
 *   npx hardhat run scripts/setup.attestors.ts --network sepolia
 *
 * Idempotent: if .env already carries both keys, it funds and registers those instead of
 * generating new ones, so a partial run can be repeated safely.
 */
import { ethers } from "hardhat";
import { load, OriginDeployment } from "./lib/deployments";
import * as fs from "fs";

const FUND_EACH = ethers.parseEther("0.005");
const ENV_PATH = ".env";

function readEnvKey(name: string): string | null {
  if (!fs.existsSync(ENV_PATH)) return null;
  const m = fs.readFileSync(ENV_PATH, "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
  const v = m?.[1]?.trim();
  return v && /^(0x)?[0-9a-fA-F]{64}$/.test(v) ? (v.startsWith("0x") ? v : `0x${v}`) : null;
}

function writeEnvKey(name: string, value: string) {
  let s = fs.readFileSync(ENV_PATH, "utf8");
  if (new RegExp(`^${name}=`, "m").test(s)) {
    s = s.replace(new RegExp(`^${name}=.*$`, "m"), `${name}=${value}`);
  } else {
    s = s.replace(/\n*$/, "\n") + `${name}=${value}\n`;
  }
  fs.writeFileSync(ENV_PATH, s);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const originDeployment = load<OriginDeployment>("sepolia");
  const origin = await ethers.getContractAt("QuitaOrigin", originDeployment.quitaOrigin, deployer);

  console.log(`deployer    : ${deployer.address}`);
  console.log(`QuitaOrigin : ${originDeployment.quitaOrigin}`);
  console.log(`balance     : ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);
  console.log("");

  for (const slot of [1, 2] as const) {
    const envName = `ATTESTOR_${slot}_PRIVATE_KEY`;
    let key = readEnvKey(envName);
    let reused = true;
    if (!key) {
      key = ethers.Wallet.createRandom().privateKey;
      reused = false;
    }
    const wallet = new ethers.Wallet(key, ethers.provider);
    console.log(`attestor ${slot} : ${wallet.address}  (${reused ? "from .env" : "generated"})`);

    // Fund only if short, so re-runs do not bleed ETH.
    const bal = await ethers.provider.getBalance(wallet.address);
    if (bal < FUND_EACH / 2n) {
      const tx = await deployer.sendTransaction({ to: wallet.address, value: FUND_EACH });
      await tx.wait();
      console.log(`             funded ${ethers.formatEther(FUND_EACH)} ETH`);
    } else {
      console.log(`             already holds ${ethers.formatEther(bal)} ETH`);
    }

    // Register as an attestor on the origin contract. Without this, attestDeath reverts.
    const already = await origin.isAttestor(wallet.address).catch(() => false);
    if (!already) {
      const tx = await origin.setAttestor(wallet.address, true);
      await tx.wait();
      console.log(`             registered as attestor`);
    } else {
      console.log(`             already registered`);
    }

    if (!reused) writeEnvKey(envName, key);
    console.log("");
  }

  console.log("Both attestor keys are in .env (gitignored).");
  console.log("Next: npx hardhat run scripts/demo.full.ts --network creditcoin");
}

main().catch((e) => { console.error(e?.message ?? e); process.exitCode = 1; });
