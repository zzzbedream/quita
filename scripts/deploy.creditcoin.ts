import { ethers, network } from "hardhat";
import { load, save, CreditcoinDeployment, OriginDeployment } from "./lib/deployments";
import { PhaseTimer } from "./lib/attestcoin";

/**
 * Deploys the Creditcoin side and wires it together.
 *
 * The source emitter is read from deployments/sepolia.json so that the emitter pinning in
 * QuitaConsumer is always bound to the QuitaOrigin instance we actually deployed. Passing the
 * wrong address here is the single most likely cause of a valid proof being rejected.
 */
async function main() {
  const timer = new PhaseTimer();
  const [deployer] = await ethers.getSigners();

  if (!deployer) {
    throw new Error(
      "No signer available. Set CREDITCOIN_PRIVATE_KEY (or PRIVATE_KEY) and fund it with " +
        "testnet CTC from the Creditcoin Discord faucet."
    );
  }

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer : ${deployer.address}`);
  console.log(`Balance  : ${ethers.formatEther(balance)} CTC`);
  if (balance === 0n) {
    throw new Error(
      "Deployer has no CTC. Request testnet funds in the Creditcoin Discord faucet channel."
    );
  }

  const originDeployment = load<OriginDeployment>("sepolia");
  const sourceEmitter = originDeployment.quitaOrigin;
  const sourceChainKey = Number(process.env.SOURCE_CHAIN_KEY ?? 1);

  console.log(`Source emitter : ${sourceEmitter} (chainKey ${sourceChainKey})`);

  // ---- Settlement asset -------------------------------------------------
  timer.mark("deploy:stable");
  const stable = await (await ethers.getContractFactory("MockStable")).deploy();
  await stable.waitForDeployment();

  // ---- Verified loan mirror ---------------------------------------------
  timer.mark("deploy:loanMirror");
  const mirror = await (
    await ethers.getContractFactory("LoanMirror")
  ).deploy(sourceChainKey, sourceEmitter);
  await mirror.waitForDeployment();

  // ---- Capital ----------------------------------------------------------
  const mcr = ethers.parseUnits(process.env.DEMO_MCR ?? "100000", 6);
  timer.mark("deploy:capitalPool");
  const pool = await (
    await ethers.getContractFactory("CapitalPool")
  ).deploy(await stable.getAddress(), mcr, deployer.address);
  await pool.waitForDeployment();

  // ---- Policies ---------------------------------------------------------
  timer.mark("deploy:policyRegistry");
  const registry = await (
    await ethers.getContractFactory("PolicyRegistry")
  ).deploy(sourceChainKey, sourceEmitter, await mirror.getAddress(), deployer.address);
  await registry.waitForDeployment();

  // ---- Claims -----------------------------------------------------------
  timer.mark("deploy:claimEngine");
  const claims = await (
    await ethers.getContractFactory("ClaimEngine")
  ).deploy(
    sourceChainKey,
    sourceEmitter,
    await mirror.getAddress(),
    await registry.getAddress(),
    await pool.getAddress(),
    deployer.address
  );
  await claims.waitForDeployment();

  // ---- Wiring -----------------------------------------------------------
  timer.mark("wire:start");
  await (await registry.setCapitalPool(await pool.getAddress())).wait();
  await (await registry.setClaimEngine(await claims.getAddress())).wait();
  await (await pool.setAuthorized(await registry.getAddress(), true)).wait();
  await (await pool.setAuthorized(await claims.getAddress(), true)).wait();

  for (const key of ["ATTESTOR_1_PRIVATE_KEY", "ATTESTOR_2_PRIVATE_KEY"]) {
    const raw = process.env[key];
    if (!raw || raw.length !== 66) continue;
    const attestor = new ethers.Wallet(raw).address;
    await (await claims.setAttestor(attestor, true)).wait();
    console.log(`  attestor registered: ${attestor}`);
  }

  // Demo timings. The challenge window is a parameter, and shortening it for a live demo is
  // an explicit, event-emitting configuration change rather than a special case in settle().
  const demoChallengeWindow = Number(process.env.DEMO_CHALLENGE_WINDOW_SECONDS ?? 120);
  await (await claims.setChallengeWindow(demoChallengeWindow)).wait();
  const demoWaitingPeriod = Number(process.env.DEMO_WAITING_PERIOD_SECONDS ?? 0);
  await (await registry.setWaitingPeriod(demoWaitingPeriod)).wait();
  timer.mark("wire:done", `challengeWindow=${demoChallengeWindow}s waiting=${demoWaitingPeriod}s`);

  const deployment: CreditcoinDeployment = {
    network: network.name,
    chainId: (await ethers.provider.getNetwork()).chainId.toString(),
    sourceChainKey,
    sourceEmitter,
    mockStable: await stable.getAddress(),
    loanMirror: await mirror.getAddress(),
    capitalPool: await pool.getAddress(),
    policyRegistry: await registry.getAddress(),
    claimEngine: await claims.getAddress(),
    deployedAtBlock: await ethers.provider.getBlockNumber(),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
  };
  save("creditcoin", deployment);

  console.log("\nDeployed on Creditcoin CC3 Testnet:");
  console.log(`  MockStable     : ${deployment.mockStable}`);
  console.log(`  LoanMirror     : ${deployment.loanMirror}`);
  console.log(`  CapitalPool    : ${deployment.capitalPool}`);
  console.log(`  PolicyRegistry : ${deployment.policyRegistry}`);
  console.log(`  ClaimEngine    : ${deployment.claimEngine}`);
  console.log(`\nExplorer: https://creditcoin-testnet.blockscout.com/address/${deployment.loanMirror}`);
  console.log(`Total: ${timer.total()}s`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
