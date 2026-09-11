import { ethers } from "hardhat";
import {
  CREDITCOIN_CC3_TESTNET_CHAIN_ID,
  makeChainInfoProvider,
  PRECOMPILE_BLOCK_PROVER,
  PRECOMPILE_CHAIN_INFO,
  PROOF_BUILDER_URLS,
} from "./lib/attestcoin";

/**
 * Read-only connectivity probe for the Attestcoin Protocol on CC3 Testnet.
 *
 * This is the only script that exercises the live protocol without needing a funded account,
 * so it is the fastest way to confirm the integration surface is reachable before deploying.
 * It reports the supported source chains from the ChainInfo precompile and determines which
 * Proof Builder endpoint actually answers.
 */
async function main() {
  const provider = ethers.provider;

  const network = await provider.getNetwork();
  console.log("Network");
  console.log(`  chainId  : ${network.chainId}`);
  if (network.chainId !== CREDITCOIN_CC3_TESTNET_CHAIN_ID) {
    console.log(
      `  WARNING  : expected ${CREDITCOIN_CC3_TESTNET_CHAIN_ID} (CC3 Testnet). ` +
        `Run with --network creditcoin.`
    );
  }
  console.log(`  block    : ${await provider.getBlockNumber()}`);

  console.log("\nPrecompiles");
  // Native precompiles have no bytecode but still answer calls, so code length is not a probe.
  console.log(`  BlockProver : ${PRECOMPILE_BLOCK_PROVER}`);
  console.log(`  ChainInfo   : ${PRECOMPILE_CHAIN_INFO}`);

  console.log("\nSupported source chains (via ChainInfo precompile)");
  try {
    const chainInfoProvider = makeChainInfoProvider(provider);
    const chains = await chainInfoProvider.getSupportedChains();
    if (!chains || chains.length === 0) {
      console.log("  (none returned)");
    } else {
      for (const chain of chains) {
        console.log(`  ${JSON.stringify(chain)}`);
      }
    }
  } catch (error) {
    console.log(`  FAILED: ${(error as Error).message}`);
  }

  console.log("\nProof Builder endpoints");
  for (const url of PROOF_BUILDER_URLS) {
    const started = Date.now();
    try {
      const response = await fetch(`${url}/api/swagger`, {
        method: "GET",
        signal: AbortSignal.timeout(15_000),
      });
      const ms = Date.now() - started;
      console.log(`  ${response.ok ? "OK  " : "HTTP"} ${response.status}  ${url}  (${ms}ms)`);
    } catch (error) {
      console.log(`  DOWN      ${url}  ${(error as Error).message}`);
    }
  }

  console.log(
    "\nRecord the endpoint that answered in ASSUMPTIONS.md and set PROOF_BUILDER_URL accordingly."
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
