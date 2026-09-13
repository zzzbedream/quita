/**
 * Pre-deployment gate.
 *
 * Deploying this project is a fixed sequence across two chains: QuitaOrigin on Sepolia, then the
 * consumers on Creditcoin with the emitter pinned to it, then a real event, then a proof. Running
 * out of gas partway through is the expensive failure — it can leave an origin contract deployed
 * with no funds left to emit the event the whole verification depends on.
 *
 * So check first. Gas figures below are measured from real bytecode, not estimated.
 *
 * Exit codes: 0 = GO, 2 = STOP (insufficient), 3 = TIGHT (covers cost, not a spike).
 *
 *   npm run preflight
 */
import { ethers } from "hardhat";

// Measured by deploying the actual bytecode to a local node.
const SEPOLIA_GAS = {
  "QuitaOrigin deployment": 646_181n,
  "setLender + setAttestor": 95_582n,
  "disburse (the demo event)": 140_092n
};
// The four consumers plus MockStable and wiring. Rounded up.
const CC3_GAS_TOTAL = 8_000_000n;

// Multiple of the measured cost we want in the account before starting.
const HEADROOM = 3n;

type Verdict = "GO" | "TIGHT" | "STOP";

const gwei = (v: bigint) => (Number(v) / 1e9).toFixed(3);

async function inspect(
  label: string, url: string, wantChainId: number, needGas: bigint, symbol: string, address: string
): Promise<Verdict> {
  console.log(label);

  if (!url) {
    console.log("  RPC URL not set in .env");
    console.log("");
    return "STOP";
  }

  const provider = new ethers.JsonRpcProvider(url);
  let net, balance: bigint, fee, block: number;
  try {
    net = await provider.getNetwork();
    [balance, fee, block] = await Promise.all([
      provider.getBalance(address), provider.getFeeData(), provider.getBlockNumber()
    ]);
  } catch (e: any) {
    console.log(`  unreachable: ${e?.shortMessage ?? e?.message ?? e}`);
    console.log("");
    return "STOP";
  }

  const chainOk = Number(net.chainId) === wantChainId;
  const gasPrice = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
  const cost = needGas * gasPrice;
  const wanted = cost * HEADROOM;

  console.log(`  chainId    : ${net.chainId}${chainOk ? "" : `  MISMATCH, expected ${wantChainId}`}`);
  console.log(`  block      : ${block.toLocaleString("en-US")}`);
  console.log(`  balance    : ${ethers.formatEther(balance)} ${symbol}`);
  console.log(`  gas price  : ${gwei(gasPrice)} gwei`);
  console.log(`  needs      : ${needGas.toLocaleString("en-US")} gas = ${ethers.formatEther(cost)} ${symbol}`);
  console.log(`  ${HEADROOM}x headroom: ${ethers.formatEther(wanted)} ${symbol}`);

  let verdict: Verdict;
  if (!chainOk) verdict = "STOP";
  else if (balance >= wanted) verdict = "GO";
  else if (balance >= cost) verdict = "TIGHT";
  else verdict = "STOP";

  console.log(`  verdict    : ${verdict}`);
  if (verdict === "STOP" && chainOk) {
    console.log(`  short by   : ${ethers.formatEther(cost - balance)} ${symbol} at the current gas price`);
  }
  console.log("");
  return verdict;
}

async function main() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) {
    console.log("PRIVATE_KEY is not set in .env. Nothing to check.");
    process.exitCode = 2;
    return;
  }

  let address: string;
  try {
    address = new ethers.Wallet(pk).address;
  } catch {
    console.log("PRIVATE_KEY is not a valid key.");
    process.exitCode = 2;
    return;
  }

  console.log(`deployer: ${address}`);
  // Optional guard: set DEPLOYER_ADDRESS in .env to catch a pasted wrong key.
  const expected = process.env.DEPLOYER_ADDRESS;
  if (expected) {
    if (address.toLowerCase() !== expected.toLowerCase()) {
      console.log(`does NOT match DEPLOYER_ADDRESS (${expected}). Refusing to continue.`);
      process.exitCode = 2;
      return;
    }
    console.log("matches DEPLOYER_ADDRESS");
  }
  console.log("");

  const sepoliaNeed = Object.values(SEPOLIA_GAS).reduce((a, b) => a + b, 0n);
  console.log("Sepolia sequence, measured from real bytecode:");
  for (const [k, v] of Object.entries(SEPOLIA_GAS)) {
    console.log(`  ${k.padEnd(28)} ${v.toLocaleString("en-US").padStart(9)}`);
  }
  console.log(`  ${"total".padEnd(28)} ${sepoliaNeed.toLocaleString("en-US").padStart(9)}`);
  console.log("");

  const a = await inspect("Ethereum Sepolia", process.env.SEPOLIA_RPC_URL ?? "",
                          11155111, sepoliaNeed, "ETH", address);
  const b = await inspect("Creditcoin CC3 Testnet", process.env.CREDITCOIN_RPC_URL ?? "",
                          102031, CC3_GAS_TOTAL, "CTC", address);

  console.log("=== decision ===");
  if (a === "STOP" || b === "STOP") {
    console.log("STOP. Top up before deploying.");
    console.log("");
    console.log("Sepolia faucets that do not require a mainnet balance:");
    console.log("  https://sepolia-faucet.pk910.de          (browser proof-of-work)");
    console.log("  https://cloud.google.com/application/web3/faucet/ethereum/sepolia");
    console.log("CC3 testnet CTC: the Creditcoin Discord faucet (manual, human turnaround).");
    process.exitCode = 2;
  } else if (a === "TIGHT" || b === "TIGHT") {
    console.log("TIGHT. Covers the measured cost but not a gas spike.");
    console.log("Stranding after QuitaOrigin deploys but before the demo event is the risk.");
    process.exitCode = 3;
  } else {
    console.log("GO. Comfortable margin on both chains.");
    console.log("");
    console.log("  npm run deploy:origin");
    console.log("  npm run deploy:creditcoin");
    console.log("  npm run emit:demo");
    console.log("  DEMO_TX_HASH=0x... npm run verify:e2e   # after ~13 min of Sepolia finality");
  }
}

main().catch((e) => { console.error(e?.message ?? e); process.exitCode = 1; });
