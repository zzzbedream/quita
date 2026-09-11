import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";

/**
 * Durable job queue backed by SQLite.
 *
 * Two properties matter and both are about not losing or duplicating work across restarts:
 *
 *  - Persistence: the last scanned source block and every in-flight job live on disk, so killing
 *    the process mid-flight loses nothing.
 *  - Idempotence: the consumer contracts already reject replays, but burning gas to discover that
 *    is wasteful. Jobs are marked `submitting` before the transaction is sent and reconciled on
 *    startup, so a crash between send and confirm is detected rather than blindly retried.
 */

export type JobStatus = "pending" | "proving" | "submitting" | "done" | "failed";

export type EventType = "LoanDisbursed" | "RepaymentMade" | "PremiumPaid" | "DeathAttested";

export interface Job {
  txHash: string;
  eventType: EventType;
  blockNumber: number;
  logIndex: number;
  status: JobStatus;
  attempts: number;
  lastError: string | null;
  submittedTxHash: string | null;
  createdAt: number;
  updatedAt: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  txHash          TEXT NOT NULL,
  eventType       TEXT NOT NULL,
  blockNumber     INTEGER NOT NULL,
  logIndex        INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pending',
  attempts        INTEGER NOT NULL DEFAULT 0,
  lastError       TEXT,
  submittedTxHash TEXT,
  createdAt       INTEGER NOT NULL,
  updatedAt       INTEGER NOT NULL,
  PRIMARY KEY (txHash, eventType, logIndex)
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

CREATE TABLE IF NOT EXISTS cursor (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  lastScanned     INTEGER NOT NULL
);
`;

export class JobQueue {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);
  }

  // ---- cursor ----------------------------------------------------------

  getLastScanned(fallback: number): number {
    const row = this.db.prepare("SELECT lastScanned FROM cursor WHERE id = 1").get() as
      | { lastScanned: number }
      | undefined;
    return row?.lastScanned ?? fallback;
  }

  setLastScanned(blockNumber: number): void {
    this.db
      .prepare(
        "INSERT INTO cursor (id, lastScanned) VALUES (1, ?) " +
          "ON CONFLICT(id) DO UPDATE SET lastScanned = excluded.lastScanned"
      )
      .run(blockNumber);
  }

  // ---- jobs ------------------------------------------------------------

  /** Inserts a job if it is not already known. Returns true when a new job was created. */
  enqueue(txHash: string, eventType: EventType, blockNumber: number, logIndex: number): boolean {
    const now = Date.now();
    const result = this.db
      .prepare(
        "INSERT OR IGNORE INTO jobs " +
          "(txHash, eventType, blockNumber, logIndex, status, attempts, createdAt, updatedAt) " +
          "VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)"
      )
      .run(txHash, eventType, blockNumber, logIndex, now, now);
    return result.changes > 0;
  }

  claimNext(): Job | undefined {
    return this.db
      .prepare(
        "SELECT * FROM jobs WHERE status = 'pending' ORDER BY blockNumber ASC, logIndex ASC LIMIT 1"
      )
      .get() as Job | undefined;
  }

  setStatus(job: Job, status: JobStatus, fields: Partial<Job> = {}): void {
    this.db
      .prepare(
        "UPDATE jobs SET status = ?, attempts = ?, lastError = ?, submittedTxHash = ?, " +
          "updatedAt = ? WHERE txHash = ? AND eventType = ? AND logIndex = ?"
      )
      .run(
        status,
        fields.attempts ?? job.attempts,
        fields.lastError ?? null,
        fields.submittedTxHash ?? job.submittedTxHash ?? null,
        Date.now(),
        job.txHash,
        job.eventType,
        job.logIndex
      );
  }

  /**
   * Returns jobs that were interrupted mid-flight so the caller can decide what to do.
   * A job left in `submitting` may or may not have landed on chain, so it must be checked
   * rather than resubmitted blindly.
   */
  findInterrupted(): Job[] {
    return this.db
      .prepare("SELECT * FROM jobs WHERE status IN ('proving', 'submitting')")
      .all() as Job[];
  }

  get(txHash: string, eventType: EventType, logIndex: number): Job | undefined {
    return this.db
      .prepare("SELECT * FROM jobs WHERE txHash = ? AND eventType = ? AND logIndex = ?")
      .get(txHash, eventType, logIndex) as Job | undefined;
  }

  counts(): Record<JobStatus, number> {
    const rows = this.db
      .prepare("SELECT status, COUNT(*) AS n FROM jobs GROUP BY status")
      .all() as Array<{ status: JobStatus; n: number }>;
    const out: Record<JobStatus, number> = {
      pending: 0,
      proving: 0,
      submitting: 0,
      done: 0,
      failed: 0,
    };
    for (const row of rows) out[row.status] = row.n;
    return out;
  }

  close(): void {
    this.db.close();
  }
}
