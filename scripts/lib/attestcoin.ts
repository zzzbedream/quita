import { ethers } from "ethers";

/**
 * Shared Attestcoin Protocol plumbing for scripts and the worker.
 *
 * The SDK is CommonJS and its namespaces are resolved lazily so that scripts which do not need
 * proof generation (deployments, event emission) do not pay for loading it.
 */

export const PRECOMPILE_BLOCK_PROVER = "0x0000000000000000000000000000000000000FD2";
export const PRECOMPILE_CHAIN_INFO = "0x0000000000000000000000000000000000000fd3";

/** Documented Proof Builder endpoints for CC3 Testnet, in the order we try them. */
export const PROOF_BUILDER_URLS = [
  "https://proof-gen-api.cc3-testnet.creditcoin.network",
  "https://prover.cc3-testnet.creditcoin.network",
];

export const CREDITCOIN_CC3_TESTNET_CHAIN_ID = 102031n;

export interface ProofData {
  chainKey: number;
  headerNumber: number;
  txHash: string;
  txBytes: string;
  merkleProof: {
    root: string;
    siblings: Array<{ hash: string; isLeft: boolean }>;
  };
  continuityProof: {
    lowerEndpointDigest: string;
    roots: string[];
  };
  cached?: boolean;
}

/* eslint-disable @typescript-eslint/no-var-requires */
function sdk() {
  // eslint-disable-next-line
  return require("@gluwa/usc-sdk");
}

export function makeProofBuilder(chainKey: number, serviceUrl: string) {
  const { proofProvider } = sdk();
  return new proofProvider.service.ProofBuilder(chainKey, serviceUrl);
}

export function makeChainInfoProvider(provider: ethers.Provider) {
  const { chainInfo } = sdk();
  return new chainInfo.PrecompileChainInfoProvider(provider);
}

/**
 * Waits for the source block to be attested, then fetches the inclusion proof.
 *
 * Timing matters commercially, not just operationally: verification cost rises roughly tenfold
 * once more than 24 hours have passed since finality, so the pipeline proves promptly rather
 * than batching overnight.
 */
export async function generateProof(
  txHash: string,
  chainKey: number,
  proofBuilderUrl: string,
  sourceProvider: ethers.Provider,
  log: (phase: string, detail?: string) => void = () => {}
): Promise<ProofData> {
  const receipt = await sourceProvider.getTransactionReceipt(txHash);
  if (!receipt) throw new Error(`Transaction ${txHash} not found on the source chain`);

  const blockNumber = receipt.blockNumber;
  log("source-receipt", `block ${blockNumber}, status ${receipt.status}`);

  if (receipt.status !== 1) {
    throw new Error(
      `Transaction ${txHash} reverted on the source chain. Proving it would be rejected ` +
        `on Creditcoin by the receiptStatus check, which is the intended behaviour.`
    );
  }

  const builder = makeProofBuilder(chainKey, proofBuilderUrl);

  log("await-attestation", `waiting for height ${blockNumber} to be attested`);
  await builder.waitUntilHeightAttested(chainKey, blockNumber, 15_000, 1_200_000);

  log("build-proof");
  const result = await builder.getProof(txHash);
  if (!result?.success) {
    throw new Error(`Proof generation failed: ${result?.error ?? "unknown error"}`);
  }

  return result.data as ProofData;
}

/**
 * Flattens ProofData into the positional arguments of `executeFromSource`.
 * Mirrors the mapping used by the Gluwa reference scripts.
 */
export function toExecuteArgs(action: number, chainKey: number, proof: ProofData) {
  return [
    action,
    chainKey,
    proof.headerNumber,
    proof.txBytes,
    proof.merkleProof.root,
    proof.merkleProof.siblings.map((s) => ({ hash: s.hash, isLeft: s.isLeft })),
    proof.continuityProof.lowerEndpointDigest,
    proof.continuityProof.roots,
  ] as const;
}

/**
 * Gas for proof verification does not estimate reliably, because the cost scales with the
 * continuity chain length rather than with the calldata the estimator sees. The reference
 * implementation applies a floor plus a per-continuity-block allowance; we do the same.
 */
export function computeGasLimit(proof: ProofData): bigint {
  const continuityBlocks = BigInt(proof.continuityProof.roots?.length || 1);
  const proofBytes = BigInt((proof.txBytes.length - 2) / 2);
  return 1_500_000n + continuityBlocks * 400_000n + proofBytes * 120n;
}

/** Simple phase timer so every script reports the numbers the demo video needs. */
export class PhaseTimer {
  private readonly start = Date.now();
  private last = Date.now();

  mark(phase: string, detail?: string): void {
    const now = Date.now();
    const since = ((now - this.last) / 1000).toFixed(1);
    const total = ((now - this.start) / 1000).toFixed(1);
    this.last = now;
    const suffix = detail ? ` :: ${detail}` : "";
    console.log(`[+${total}s] (${since}s) ${phase}${suffix}`);
  }

  total(): string {
    return ((Date.now() - this.start) / 1000).toFixed(1);
  }
}
