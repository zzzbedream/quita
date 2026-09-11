import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "solidity-coverage";
import * as dotenv from "dotenv";

dotenv.config();

const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL ?? "";
const CREDITCOIN_RPC_URL =
  process.env.CREDITCOIN_RPC_URL ?? "https://rpc.cc3-testnet.creditcoin.network";
const PRIVATE_KEY = process.env.PRIVATE_KEY ?? "";
const CREDITCOIN_PRIVATE_KEY = process.env.CREDITCOIN_PRIVATE_KEY ?? PRIVATE_KEY;

const accounts = (key: string): string[] => (key.length === 66 ? [key] : []);

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
