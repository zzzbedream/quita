import * as fs from "fs";
import * as path from "path";

export interface OriginDeployment {
  network: string;
  chainId: string;
  quitaOrigin: string;
  deployedAtBlock: number;
  deployer: string;
  timestamp: string;
}

export interface CreditcoinDeployment {
  network: string;
  chainId: string;
  sourceChainKey: number;
  sourceEmitter: string;
  mockStable: string;
  loanMirror: string;
  capitalPool: string;
  policyRegistry: string;
  claimEngine: string;
  deployedAtBlock: number;
  deployer: string;
  timestamp: string;
}

const DIR = path.join(__dirname, "..", "..", "deployments");

function file(name: string): string {
  return path.join(DIR, `${name}.json`);
}

export function save<T>(name: string, data: T): void {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(file(name), JSON.stringify(data, null, 2) + "\n");
  console.log(`\nSaved deployments/${name}.json`);
}

export function load<T>(name: string): T {
  const target = file(name);
  if (!fs.existsSync(target)) {
    throw new Error(
      `Missing deployments/${name}.json. Run the corresponding deploy script first.`
    );
  }
  return JSON.parse(fs.readFileSync(target, "utf8")) as T;
}

export function exists(name: string): boolean {
  return fs.existsSync(file(name));
}
