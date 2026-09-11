import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { JobQueue } from "../worker/src/queue";

/**
 * The worker must survive being killed mid-flight. These tests exercise the durability and
 * idempotence properties directly against the on-disk queue, by closing and reopening it, which
 * is exactly what a process restart does.
 */
describe("Worker queue", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "quita-queue-"));
    dbPath = path.join(dir, "worker.db");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("persists the scan cursor across a restart", () => {
    let queue = new JobQueue(dbPath);
    expect(queue.getLastScanned(100)).to.equal(100);
    queue.setLastScanned(4_242);
    queue.close();

    queue = new JobQueue(dbPath);
    expect(queue.getLastScanned(100)).to.equal(4_242);
    queue.close();
  });

  it("does not enqueue the same log twice", () => {
    const queue = new JobQueue(dbPath);

    expect(queue.enqueue("0xaa", "LoanDisbursed", 10, 0)).to.equal(true);
    expect(queue.enqueue("0xaa", "LoanDisbursed", 10, 0)).to.equal(false);

    expect(queue.counts().pending).to.equal(1);
    queue.close();
  });

  it("distinguishes two different events in the same transaction", () => {
    const queue = new JobQueue(dbPath);

    expect(queue.enqueue("0xaa", "LoanDisbursed", 10, 0)).to.equal(true);
    expect(queue.enqueue("0xaa", "PremiumPaid", 10, 1)).to.equal(true);

    expect(queue.counts().pending).to.equal(2);
    queue.close();
  });

  it("resumes an interrupted job after a restart", () => {
    let queue = new JobQueue(dbPath);
    queue.enqueue("0xbb", "DeathAttested", 20, 0);

    // Simulate a crash: the job was marked in-flight and the process died.
    const job = queue.claimNext()!;
    queue.setStatus(job, "submitting", { attempts: 1, submittedTxHash: "0xcc" });
    queue.close();

    queue = new JobQueue(dbPath);
    const interrupted = queue.findInterrupted();

    expect(interrupted).to.have.length(1);
    expect(interrupted[0].txHash).to.equal("0xbb");
    expect(interrupted[0].status).to.equal("submitting");
    expect(interrupted[0].submittedTxHash).to.equal("0xcc");
    queue.close();
  });

  it("returns an interrupted job to pending so it is retried", () => {
    let queue = new JobQueue(dbPath);
    queue.enqueue("0xdd", "RepaymentMade", 30, 0);
    const job = queue.claimNext()!;
    queue.setStatus(job, "proving", { attempts: 1 });
    queue.close();

    queue = new JobQueue(dbPath);
    const interrupted = queue.findInterrupted();
    queue.setStatus(interrupted[0], "pending");

    expect(queue.claimNext()?.txHash).to.equal("0xdd");
    expect(queue.counts().pending).to.equal(1);
    queue.close();
  });

  it("does not hand out completed jobs again", () => {
    const queue = new JobQueue(dbPath);
    queue.enqueue("0xee", "LoanDisbursed", 40, 0);

    const job = queue.claimNext()!;
    queue.setStatus(job, "done", { submittedTxHash: "0xff" });

    expect(queue.claimNext()).to.equal(undefined);
    expect(queue.counts().done).to.equal(1);
    queue.close();
  });

  it("processes jobs in source-chain order", () => {
    const queue = new JobQueue(dbPath);
    queue.enqueue("0x3", "RepaymentMade", 30, 0);
    queue.enqueue("0x1", "LoanDisbursed", 10, 0);
    queue.enqueue("0x2", "PremiumPaid", 20, 0);

    expect(queue.claimNext()?.txHash).to.equal("0x1");
    queue.close();
  });

  it("records the last error for a failed job", () => {
    const queue = new JobQueue(dbPath);
    queue.enqueue("0x99", "LoanDisbursed", 50, 0);

    const job = queue.claimNext()!;
    queue.setStatus(job, "failed", { attempts: 5, lastError: "prover timeout" });

    const stored = queue.get("0x99", "LoanDisbursed", 0)!;
    expect(stored.status).to.equal("failed");
    expect(stored.attempts).to.equal(5);
    expect(stored.lastError).to.equal("prover timeout");
    queue.close();
  });
});
