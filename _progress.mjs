// Reads live CC3 state so demo.full.ts progress is visible regardless of stdout buffering.
import { ethers } from "ethers";
import { readFile } from "node:fs/promises";

const D = JSON.parse(await readFile("deployments/creditcoin.json", "utf8"));
const provider = new ethers.JsonRpcProvider("https://rpc.cc3-testnet.creditcoin.network");

const pool = new ethers.Contract(D.capitalPool, [
  "function totalAssets() view returns (uint256)",
  "function lockedCapital() view returns (uint256)",
  "function totalPremiumsCollected() view returns (uint256)",
  "function totalClaimsPaid() view returns (uint256)",
  "function lossRatioWad() view returns (uint256)",
  "function solvencyRatioWad() view returns (uint256)"
], provider);

const registry = new ethers.Contract(D.policyRegistry, [
  "function policyCount() view returns (uint256)",
  "function activePolicyCount() view returns (uint256)",
  "function totalSumInsured() view returns (uint256)"
], provider);

const mirror = new ethers.Contract(D.loanMirror, [
  "function totalOutstanding() view returns (uint256)",
  "event LoanMirrored(bytes32 indexed loanId, bytes32 indexed borrowerCommitment, address lender, uint256 principal, bytes32 queryId)",
  "event OutstandingUpdated(bytes32 indexed loanId, uint256 amount, uint256 outstanding, bytes32 queryId)"
], provider);

const claims = new ethers.Contract(D.claimEngine, [
  "event ClaimSettled(bytes32 indexed loanId, address indexed lender, uint256 payout, uint256 sumInsured)"
], provider);

const q = (v) => Number(ethers.formatUnits(v, 6)).toLocaleString("en-US", { maximumFractionDigits: 2 });
const pct = (w) => (Number(w) / 1e18 * 100).toFixed(1) + "%";

const head = await provider.getBlockNumber();
const from = Math.max(0, Number(D.deployedAtBlock) - 1);

const [assets, locked, premiums, paid, loss, policies, active, insured, outstanding] =
  await Promise.all([
    pool.totalAssets(), pool.lockedCapital(), pool.totalPremiumsCollected(),
    pool.totalClaimsPaid(), pool.lossRatioWad(),
    registry.policyCount(), registry.activePolicyCount(), registry.totalSumInsured(),
    mirror.totalOutstanding()
  ]);

const [mirrored, updated, settled] = await Promise.all([
  mirror.queryFilter(mirror.filters.LoanMirrored(), from, head).catch(() => []),
  mirror.queryFilter(mirror.filters.OutstandingUpdated(), from, head).catch(() => []),
  claims.queryFilter(claims.filters.ClaimSettled(), from, head).catch(() => [])
]);

console.log(`CC3 block ${head.toLocaleString("en-US")}`);
console.log(`  loans mirrored   : ${mirrored.length}`);
console.log(`  repayments proved: ${updated.length}`);
console.log(`  claims settled   : ${settled.length}`);
console.log(`  policies         : ${policies} total, ${active} active`);
console.log(`  sum insured      : ${q(insured)}`);
console.log(`  outstanding      : ${q(outstanding)}`);
console.log(`  pool assets      : ${q(assets)}`);
console.log(`  locked capital   : ${q(locked)}`);
console.log(`  premiums         : ${q(premiums)}`);
console.log(`  claims paid      : ${q(paid)}`);
console.log(`  loss ratio       : ${premiums === 0n ? "n/a" : pct(loss)}`);

for (const s of settled) {
  console.log(`\n  SETTLED  payout ${q(s.args.payout)} to ${s.args.lender}`);
  console.log(`           tx ${s.transactionHash}`);
}
