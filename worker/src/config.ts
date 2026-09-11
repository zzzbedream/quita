import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

dotenv.config();

export interface CreditcoinDeployment {
  sourceChainKey: number;
  sourceEmitter: string;
  loanMirror: string;
  policyRegistry: string;
  claimEngine: string;
  capitalPool: string;
  mockStable: string;
}

export interface OriginDeployment {
  quitaOrigin: string;
  deployedAtBlock: number;
}

export interface WorkerConfig {
  sepoliaRpcUrl: string;
  creditcoinRpcUrl: string;
  privateKey: string;
  proofBuilderUrl: string;
  dbPath: string;
  pollIntervalMs: number;
  confirmations: number;
  maxAttempts: number;
  startBlock: number;
  origin: OriginDeployment;
  creditcoin: CreditcoinDeployment;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function loadDeployment<T>(name: string): T {
  const file = path.join(__dirname, "..", "..", "deployments", `${name}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(
      `Missing deployments/${name}.json. Deploy before starting the worker.`
    );
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

export function loadConfig(): WorkerConfig {
  const origin = loadDeployment<OriginDeployment>("sepolia");
  const creditcoin = loadDeployment<CreditcoinDeployment>("creditcoin");

  return {
    sepoliaRpcUrl: required("SEPOLIA_RPC_URL"),
    creditcoinRpcUrl:
      process.env.CREDITCOIN_RPC_URL ?? "https://rpc.cc3-testnet.creditcoin.network",
    privateKey: process.env.CREDITCOIN_PRIVATE_KEY || required("PRIVATE_KEY"),
    proofBuilderUrl:
      process.env.PROOF_BUILDER_URL ?? "https://proof-gen-api.cc3-testnet.creditcoin.network",
    dbPath: process.env.WORKER_DB_PATH ?? path.join(__dirname, "..", "data", "worker.db"),
    pollIntervalMs: Number(process.env.WORKER_POLL_INTERVAL_MS ?? 15_000),
    // Ethereum finality is roughly 12.8 minutes; the prover will not attest before that.
    confirmations: Number(process.env.WORKER_CONFIRMATIONS ?? 4),
    maxAttempts: Number(process.env.WORKER_MAX_ATTEMPTS ?? 5),
    startBlock: Number(process.env.WORKER_START_BLOCK ?? origin.deployedAtBlock),
    origin,
    creditcoin,
  };
}
