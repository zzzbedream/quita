import { ethers, network } from "hardhat";
import { save, OriginDeployment } from "./lib/deployments";
import { PhaseTimer } from "./lib/attestcoin";

/**
 * Deploys QuitaOrigin to the source chain (Ethereum Sepolia) and registers the demo roles.
 *
 * The deployer is registered as a lender so the demo can originate loans, and up to two
 * attestor keys are registered if present in the environment.
 */
async function main() {
  const timer = new PhaseTimer();
  const [deployer] = await ethers.getSigners();

  if (!deployer) {
    throw new Error(
      "No signer available. Set PRIVATE_KEY in .env and fund it with Sepolia ETH."
    );
  }

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer : ${deployer.address}`);
  console.log(`Balance  : ${ethers.formatEther(balance)} ETH`);
  if (balance === 0n) {
    throw new Error("Deployer has no ETH. Use a Sepolia faucet before deploying.");
  }

  timer.mark("deploy:start");
  const origin = await (await ethers.getContractFactory("QuitaOrigin")).deploy(deployer.address);
  await origin.waitForDeployment();
  const address = await origin.getAddress();
  timer.mark("deploy:mined", address);

  // The deployer originates loans in the demo.
  await (await origin.setLender(deployer.address, true)).wait();
  timer.mark("register:lender");

  for (const key of ["ATTESTOR_1_PRIVATE_KEY", "ATTESTOR_2_PRIVATE_KEY"]) {
    const raw = process.env[key];
    if (!raw || raw.length !== 66) continue;
    const attestor = new ethers.Wallet(raw).address;
    await (await origin.setAttestor(attestor, true)).wait();
    timer.mark("register:attestor", `${key} -> ${attestor}`);
  }

  const deployment: OriginDeployment = {
    network: network.name,
    chainId: (await ethers.provider.getNetwork()).chainId.toString(),
    quitaOrigin: address,
    deployedAtBlock: await ethers.provider.getBlockNumber(),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
  };
  save("sepolia", deployment);

  console.log(`\nQuitaOrigin deployed at ${address}`);
  console.log(`Explorer: https://sepolia.etherscan.io/address/${address}`);
  console.log(`\nNext: set this address as the source emitter when deploying to Creditcoin.`);
  console.log(`Total: ${timer.total()}s`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
