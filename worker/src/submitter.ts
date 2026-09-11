import { ethers } from "ethers";
import { computeGasLimit, generateProof, toExecuteArgs } from "../../scripts/lib/attestcoin";
import { CreditcoinDeployment } from "./config";
import { EventType, Job, JobQueue } from "./queue";
import { Logger } from "./logger";

/**
 * Routes each proved source event to the consumer contract and action that handles it.
 *
 * All four source events are verified through the protocol; they simply land in different
 * contracts because they mutate different parts of the book.
 */
interface Route {
  contract: keyof Pick<
    CreditcoinDeployment,
    "loanMirror" | "policyRegistry" | "claimEngine"
  >;
  action: number;
}

const ROUTES: Record<EventType, Route> = {
  LoanDisbursed: { contract: "loanMirror", action: 0 },
  RepaymentMade: { contract: "loanMirror", action: 1 },
  PremiumPaid: { contract: "policyRegistry", action: 0 },
  DeathAttested: { contract: "claimEngine", action: 0 },
};

const EXECUTE_ABI = [
  "function executeFromSource(uint8 action, uint64 chainKey, uint64 blockHeight, bytes encodedTransaction, bytes32 merkleRoot, (bytes32 hash, bool isLeft)[] siblings, bytes32 lowerEndpointDigest, bytes32[] continuityRoots) returns (bool)",
];

export class Submitter {
  constructor(
    private readonly wallet: ethers.Wallet,
    private readonly sourceProvider: ethers.Provider,
    private readonly deployment: CreditcoinDeployment,
    private readonly proofBuilderUrl: string,
    private readonly queue: JobQueue,
    private readonly log: Logger
  ) {}

  async process(job: Job): Promise<void> {
    const route = ROUTES[job.eventType];
    const target = this.deployment[route.contract];

    this.log.info("proving", { event: job.eventType, tx: job.txHash, block: job.blockNumber });
    this.queue.setStatus(job, "proving", { attempts: job.attempts + 1 });

    const startedAt = Date.now();
    const proof = await generateProof(
      job.txHash,
      this.deployment.sourceChainKey,
      this.proofBuilderUrl,
      this.sourceProvider,
      (phase, detail) => this.log.info(phase, { tx: job.txHash, detail: detail ?? "" })
    );
    const proveMs = Date.now() - startedAt;

    this.log.info("proof ready", {
      tx: job.txHash,
      height: proof.headerNumber,
      siblings: proof.merkleProof.siblings.length,
      continuity: proof.continuityProof.roots.length,
      ms: proveMs,
    });

    const contract = new ethers.Contract(target, EXECUTE_ABI, this.wallet);
    const args = toExecuteArgs(route.action, this.deployment.sourceChainKey, proof);
    const gasLimit = computeGasLimit(proof);

    // Marked before sending: a crash after this point must be reconciled, never blindly retried.
    this.queue.setStatus(job, "submitting", { attempts: job.attempts + 1 });

    const tx = await contract.executeFromSource(...args, { gasLimit });
    this.queue.setStatus(job, "submitting", {
      attempts: job.attempts + 1,
      submittedTxHash: tx.hash,
    });
    this.log.info("submitted", { tx: job.txHash, creditcoinTx: tx.hash, target });

    const receipt = await tx.wait();
    const totalMs = Date.now() - startedAt;

    this.queue.setStatus(job, "done", {
      attempts: job.attempts + 1,
      submittedTxHash: tx.hash,
    });
    this.log.info("verified", {
      event: job.eventType,
      sourceTx: job.txHash,
      creditcoinTx: tx.hash,
      gasUsed: receipt?.gasUsed?.toString() ?? "?",
      totalMs,
    });
  }

  /**
   * Decides what to do with a job that was interrupted while in flight.
   * If its transaction landed, the job is complete. If not, it goes back to pending.
   */
  async reconcile(job: Job): Promise<void> {
    if (!job.submittedTxHash) {
      this.log.warn("reconcile: no tx recorded, requeueing", {
        event: job.eventType,
        tx: job.txHash,
      });
      this.queue.setStatus(job, "pending");
      return;
    }

    const receipt = await this.wallet.provider!.getTransactionReceipt(job.submittedTxHash);
    if (receipt && receipt.status === 1) {
      this.log.info("reconcile: already verified on chain", {
        event: job.eventType,
        creditcoinTx: job.submittedTxHash,
      });
      this.queue.setStatus(job, "done");
      return;
    }

    this.log.warn("reconcile: submission did not land, requeueing", {
      event: job.eventType,
      creditcoinTx: job.submittedTxHash,
    });
    this.queue.setStatus(job, "pending");
  }
}
