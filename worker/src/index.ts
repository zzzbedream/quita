import { ethers } from "ethers";
import { loadConfig } from "./config";
import { JobQueue } from "./queue";
import { Watcher } from "./watcher";
import { Submitter } from "./submitter";
import { createLogger } from "./logger";

/**
 * Quita off-chain worker.
 *
 * Watches QuitaOrigin on Sepolia, generates Attestcoin inclusion proofs, and submits them to the
 * matching consumer contract on Creditcoin. There is no trusted relay here: the worker cannot
 * forge state, because anything it submits must satisfy the precompile and the application
 * checks. A malicious worker can withhold or delay, not fabricate.
 */
const log = createLogger("worker");

async function main() {
  const config = loadConfig();

  const sourceProvider = new ethers.JsonRpcProvider(config.sepoliaRpcUrl);
  const creditcoinProvider = new ethers.JsonRpcProvider(config.creditcoinRpcUrl);
  const wallet = new ethers.Wallet(config.privateKey, creditcoinProvider);

  const queue = new JobQueue(config.dbPath);

  const watcher = new Watcher(
    sourceProvider,
    queue,
    config.origin.quitaOrigin,
    config.confirmations,
    config.startBlock,
    createLogger("watcher")
  );

  const submitter = new Submitter(
    wallet,
    sourceProvider,
    config.creditcoin,
    config.proofBuilderUrl,
    queue,
    createLogger("submitter")
  );

  log.info("starting", {
    origin: config.origin.quitaOrigin,
    chainKey: config.creditcoin.sourceChainKey,
    submitter: wallet.address,
    db: config.dbPath,
  });

  // Reconcile anything that was in flight when the process last stopped, before taking new work.
  const interrupted = queue.findInterrupted();
  if (interrupted.length > 0) {
    log.warn("reconciling interrupted jobs", { count: interrupted.length });
    for (const job of interrupted) {
      try {
        await submitter.reconcile(job);
      } catch (error) {
        log.error("reconcile failed", {
          tx: job.txHash,
          error: (error as Error).message,
        });
      }
    }
  }

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    log.info("shutdown requested, finishing current job");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  while (!stopping) {
    try {
      await watcher.scanOnce();
    } catch (error) {
      log.error("scan failed", { error: (error as Error).message });
    }

    let job = queue.claimNext();
    while (job && !stopping) {
      try {
        await submitter.process(job);
      } catch (error) {
        const message = (error as Error).message;
        const attempts = job.attempts + 1;
        const terminal = attempts >= config.maxAttempts;
        queue.setStatus(job, terminal ? "failed" : "pending", {
          attempts,
          lastError: message,
        });
        log.error(terminal ? "job failed permanently" : "job failed, will retry", {
          event: job.eventType,
          tx: job.txHash,
          attempts,
          error: message,
        });
        // Back off before the next attempt so a failing prover is not hammered.
        if (!terminal) {
          await sleep(Math.min(60_000, 2 ** attempts * 1_000));
        }
      }
      job = queue.claimNext();
    }

    const counts = queue.counts();
    log.debug("idle", counts);
    if (!stopping) await sleep(config.pollIntervalMs);
  }

  queue.close();
  log.info("stopped");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  log.error("fatal", { error: (error as Error).message });
  process.exitCode = 1;
});
