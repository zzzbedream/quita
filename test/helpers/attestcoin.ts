import { ethers, network } from "hardhat";
import type { MockNativeQueryVerifier } from "../../typechain-types";

/**
 * Local test harness for the Attestcoin Protocol.
 *
 * Two things make consumer contracts hard to test locally, and this module solves both.
 *
 * 1. The BlockProver is a native runtime precompile at 0xFD2, not EVM bytecode, so a Hardhat
 *    node simply does not have it. ASCBase hardcodes that address with no injection point, so
 *    we place mock bytecode at 0xFD2 with `hardhat_setCode`.
 *
 * 2. The proved payload is not a raw Ethereum transaction. It is the prover's re-encoding:
 *    `abi.encode(uint8 txType, bytes[] chunks)`, receipt in the last chunk. We rebuild that
 *    exact layout here so tests can assert on receipt status, emitter and log decoding.
 */

export const PRECOMPILE_ADDRESS = "0x0000000000000000000000000000000000000FD2";

/** chainKey of Ethereum Sepolia as registered on CC3 Testnet. */
export const SEPOLIA_CHAIN_KEY = 1n;

/** chainKey of Ethereum Mainnet as registered on CC3 Testnet. Used in negative tests. */
export const MAINNET_CHAIN_KEY = 3n;

/**
 * Installs the mock verifier at the real precompile address.
 * Storage at 0xFD2 is independent of the deployment address, so the returned instance is bound
 * to 0xFD2 — configure it through that handle, not through the original deployment.
 */
export async function installMockVerifier(): Promise<MockNativeQueryVerifier> {
  const factory = await ethers.getContractFactory("MockNativeQueryVerifier");
  const deployed = await factory.deploy();
  await deployed.waitForDeployment();

  const runtimeCode = await ethers.provider.getCode(await deployed.getAddress());
  await network.provider.send("hardhat_setCode", [PRECOMPILE_ADDRESS, runtimeCode]);

  const atPrecompile = factory.attach(PRECOMPILE_ADDRESS) as MockNativeQueryVerifier;
  // Storage starts zeroed at 0xFD2, so shouldVerify must be set explicitly.
  await atPrecompile.setShouldVerify(true);
  return atPrecompile;
}

export interface LogFixture {
  emitter: string;
  topics: string[];
  data: string;
}

export interface TxFixtureOptions {
  logs: LogFixture[];
  receiptStatus?: number;
  txType?: number;
  gasUsed?: bigint;
  from?: string;
  to?: string;
}

const abi = ethers.AbiCoder.defaultAbiCoder();

/**
 * Builds the `encodedTransaction` bytes exactly as the prover produces them.
 *
 * Layout per EvmV1Decoder:
 *   abi.encode(uint8 txType, bytes[] chunks)
 *     chunks[0] common  : (uint64 nonce, uint64 gasLimit, address from, bool toIsNull,
 *                          address to, uint256 value, bytes data)
 *     chunks[1] typed   : type-2 shape (chainId, maxPriorityFee, maxFee, accessList, yParity, r, s)
 *     chunks[2] receipt : (uint8 status, uint64 gasUsed, (address,bytes32[],bytes)[] logs, bytes bloom)
 */
export function buildEncodedTransaction(options: TxFixtureOptions): string {
  const {
    logs,
    receiptStatus = 1,
    txType = 2,
    gasUsed = 120_000n,
    from = "0x1111111111111111111111111111111111111111",
    to = "0x2222222222222222222222222222222222222222",
  } = options;

  const commonChunk = abi.encode(
    ["uint64", "uint64", "address", "bool", "address", "uint256", "bytes"],
    [7n, 500_000n, from, false, to, 0n, "0x"]
  );

  const typedChunk = abi.encode(
    ["uint64", "uint128", "uint128", "tuple(address,bytes32[])[]", "uint8", "bytes32", "bytes32"],
    [11155111n, 1_000_000_000n, 30_000_000_000n, [], 0, ethers.ZeroHash, ethers.ZeroHash]
  );

  const receiptChunk = abi.encode(
    ["uint8", "uint64", "tuple(address,bytes32[],bytes)[]", "bytes"],
    [
      receiptStatus,
      gasUsed,
      logs.map((log) => [log.emitter, log.topics, log.data]),
      "0x" + "00".repeat(256),
    ]
  );

  return abi.encode(["uint8", "bytes[]"], [txType, [commonChunk, typedChunk, receiptChunk]]);
}

export interface ProofFixture {
  merkleRoot: string;
  siblings: Array<{ hash: string; isLeft: boolean }>;
  lowerEndpointDigest: string;
  continuityRoots: string[];
}

/**
 * Builds a proof envelope. The sibling `isLeft` bits determine the derived txIndex, which
 * ASCBase folds into the replay key, so distinct `txIndex` values yield distinct queries.
 * Reusing the same txIndex at the same height is exactly what the replay test needs.
 */
export function buildProof(txIndex: number, blockHeight: bigint = 100n): ProofFixture {
  const siblings: Array<{ hash: string; isLeft: boolean }> = [];
  for (let bit = 0; bit < 8; bit++) {
    siblings.push({
      hash: ethers.keccak256(ethers.toUtf8Bytes(`sibling-${blockHeight}-${txIndex}-${bit}`)),
      isLeft: ((txIndex >> bit) & 1) === 1,
    });
  }

  return {
    merkleRoot: ethers.keccak256(ethers.toUtf8Bytes(`root-${blockHeight}`)),
    siblings,
    lowerEndpointDigest: ethers.keccak256(ethers.toUtf8Bytes("lower-endpoint")),
    continuityRoots: [ethers.keccak256(ethers.toUtf8Bytes(`continuity-${blockHeight}`))],
  };
}

/** Flattens a proof into the positional argument list of `executeFromSource`. */
export function proofArgs(proof: ProofFixture) {
  return [
    proof.merkleRoot,
    proof.siblings.map((s) => [s.hash, s.isLeft] as [string, boolean]),
    proof.lowerEndpointDigest,
    proof.continuityRoots,
  ] as const;
}
