import { ethers } from "ethers";
import { JobQueue, EventType } from "./queue";
import { Logger } from "./logger";

/**
 * Scans QuitaOrigin on the source chain and enqueues one job per relevant log.
 *
 * The scan window is bounded and the cursor is only advanced after the jobs for that window are
 * committed, so a crash mid-scan re-reads the window rather than skipping it. Re-reading is safe
 * because enqueueing is keyed on (txHash, eventType, logIndex).
 */

const EVENT_SIGNATURES: Record<string, EventType> = {
  [ethers.id("LoanDisbursed(bytes32,bytes32,address,uint256,uint32,uint8,uint8)")]:
    "LoanDisbursed",
  [ethers.id("RepaymentMade(bytes32,uint256,uint256)")]: "RepaymentMade",
  [ethers.id("PremiumPaid(bytes32,uint256,uint64)")]: "PremiumPaid",
  [ethers.id("DeathAttested(bytes32,bytes32,uint64,bytes32,address)")]: "DeathAttested",
};

const MAX_WINDOW = 900; // Attestcoin documents a 1000 block range limit; stay inside it.

export class Watcher {
  constructor(
    private readonly provider: ethers.Provider,
    private readonly queue: JobQueue,
    private readonly emitter: string,
    private readonly confirmations: number,
    private readonly startBlock: number,
    private readonly log: Logger
  ) {}

  async scanOnce(): Promise<number> {
    const head = await this.provider.getBlockNumber();
    const safeHead = head - this.confirmations;
    const from = this.queue.getLastScanned(this.startBlock) + 1;

    if (safeHead < from) {
      this.log.debug("nothing to scan", { head, safeHead, from });
      return 0;
    }

    const to = Math.min(safeHead, from + MAX_WINDOW - 1);

    const logs = await this.provider.getLogs({
      address: this.emitter,
      fromBlock: from,
      toBlock: to,
      topics: [Object.keys(EVENT_SIGNATURES)],
    });

    let enqueued = 0;
    for (const entry of logs) {
      const eventType = EVENT_SIGNATURES[entry.topics[0]];
      if (!eventType) continue;
      if (
        this.queue.enqueue(
          entry.transactionHash,
          eventType,
          entry.blockNumber,
          entry.index
        )
      ) {
        enqueued++;
        this.log.info("enqueued", {
          event: eventType,
          tx: entry.transactionHash,
          block: entry.blockNumber,
        });
      }
    }

    this.queue.setLastScanned(to);
    this.log.debug("scanned", { from, to, found: logs.length, enqueued });
    return enqueued;
  }
}
