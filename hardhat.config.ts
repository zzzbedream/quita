import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "solidity-coverage";
import * as dotenv from "dotenv";

dotenv.config();

const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL ?? "";
const CREDITCOIN_RPC_URL =
  process.env.CREDITCOIN_RPC_URL ?? "https://rpc.cc3-testnet.creditcoin.network";
const PRIVATE_KEY = process.env.PRIVATE_KEY ?? "";
// `??` would not do here: an empty CREDITCOIN_PRIVATE_KEY= line in .env is not nullish, so it
// would silently win over PRIVATE_KEY and leave the Creditcoin network with no signer. Treat
// empty as absent, which is what .env.example promises.
const CREDITCOIN_PRIVATE_KEY =
  (process.env.CREDITCOIN_PRIVATE_KEY ?? "").trim() || PRIVATE_KEY;

/**
 * Accepts a private key with or without the 0x prefix. An empty value means "no signer for this
 * network", which is normal for read-only use. A value that is present but malformed is a typo
 * worth shouting about: returning an empty array silently produces "No signer available" much
 * later, far from the cause.
 */
const accounts = (key: string): string[] => {
  const k = key.trim();
  if (k === "") return [];
  const normalised = k.startsWith("0x") ? k : `0x${k}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalised)) {
    throw new Error(
      `Invalid private key in .env: expected 64 hex characters (0x prefix optional), got ${k.length}.`
    );
  }
  return [normalised];
};

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
      // Allow the large proof calldata used by the Attestcoin verifier tests.
      blockGasLimit: 100_000_000,
    },
    sepolia: {
      url: SEPOLIA_RPC_URL,
      accounts: accounts(PRIVATE_KEY),
      chainId: 11155111,
    },
    creditcoin: {
      url: CREDITCOIN_RPC_URL,
      accounts: accounts(CREDITCOIN_PRIVATE_KEY),
      chainId: 102031,
    },
  },
  etherscan: {
    apiKey: { sepolia: process.env.ETHERSCAN_API_KEY ?? "" },
  },
  mocha: { timeout: 120_000 },
};

export default config;
