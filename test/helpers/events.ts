import { ethers } from "hardhat";
import type { LogFixture } from "./attestcoin";

/**
 * Builders that produce QuitaOrigin logs in the exact topic/data split the EVM uses:
 * indexed parameters become topics, everything else is ABI-encoded into `data`.
 */

const abi = ethers.AbiCoder.defaultAbiCoder();

export const LOAN_DISBURSED_SIG = ethers.id(
  "LoanDisbursed(bytes32,bytes32,address,uint256,uint32,uint8,uint8)"
);
export const REPAYMENT_MADE_SIG = ethers.id("RepaymentMade(bytes32,uint256,uint256)");
export const PREMIUM_PAID_SIG = ethers.id("PremiumPaid(bytes32,uint256,uint64)");
export const DEATH_ATTESTED_SIG = ethers.id(
  "DeathAttested(bytes32,bytes32,uint64,bytes32,address)"
);

export function loanDisbursedLog(params: {
  emitter: string;
  loanId: string;
  borrowerCommitment: string;
  lender: string;
  principal: bigint;
  termMonths?: number;
  ageBand?: number;
  sex?: number;
}): LogFixture {
  const { termMonths = 24, ageBand = 5, sex = 1 } = params;
  return {
    emitter: params.emitter,
    topics: [LOAN_DISBURSED_SIG, params.loanId, params.borrowerCommitment],
    data: abi.encode(
      ["address", "uint256", "uint32", "uint8", "uint8"],
      [params.lender, params.principal, termMonths, ageBand, sex]
    ),
  };
}

export function repaymentMadeLog(params: {
  emitter: string;
  loanId: string;
  amount: bigint;
  outstandingAfter: bigint;
}): LogFixture {
  return {
    emitter: params.emitter,
    topics: [REPAYMENT_MADE_SIG, params.loanId],
    data: abi.encode(["uint256", "uint256"], [params.amount, params.outstandingAfter]),
  };
}

export function premiumPaidLog(params: {
  emitter: string;
  loanId: string;
  amount: bigint;
  periodIndex: bigint;
}): LogFixture {
  return {
    emitter: params.emitter,
    topics: [PREMIUM_PAID_SIG, params.loanId],
    data: abi.encode(["uint256", "uint64"], [params.amount, params.periodIndex]),
  };
}

export function deathAttestedLog(params: {
  emitter: string;
  borrowerCommitment: string;
  loanId: string;
  dateOfDeath: bigint;
  evidenceHash: string;
  attestor: string;
}): LogFixture {
  return {
    emitter: params.emitter,
    topics: [DEATH_ATTESTED_SIG, params.borrowerCommitment, params.loanId],
    data: abi.encode(
      ["uint64", "bytes32", "address"],
      [params.dateOfDeath, params.evidenceHash, params.attestor]
    ),
  };
}

/** Deterministic loan id / commitment helpers for readable tests. */
export const loanId = (label: string) => ethers.keccak256(ethers.toUtf8Bytes(`loan:${label}`));
export const commitment = (label: string) =>
  ethers.keccak256(ethers.toUtf8Bytes(`commitment:${label}`));
