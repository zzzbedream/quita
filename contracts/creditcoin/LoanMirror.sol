// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {QuitaConsumer} from "./QuitaConsumer.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";

/**
 * @title LoanMirror
 * @notice Cryptographically verified mirror of Ethereum loan state on Creditcoin.
 * @dev This is the contract that makes Quita more than a spreadsheet. Every number here was
 *      reconstructed from an Ethereum log whose inclusion was proved by the Attestcoin
 *      BlockProver precompile. Nothing is asserted by an operator.
 */
contract LoanMirror is QuitaConsumer {
    // ---------------------------------------------------------------------
    // Actions
    // ---------------------------------------------------------------------

    uint8 public constant ACTION_DISBURSE = 0;
    uint8 public constant ACTION_REPAY = 1;

    // keccak256("LoanDisbursed(bytes32,bytes32,address,uint256,uint32,uint8,uint8)")
    bytes32 public constant LOAN_DISBURSED_SIG =
        0x4f9b31a72934d616a1ab7cb0a4375fc08ff92ba432d54cc7262e6f1754019b46;

    // keccak256("RepaymentMade(bytes32,uint256,uint256)")
    bytes32 public constant REPAYMENT_MADE_SIG =
        0x68127b7012c0638aeee0a62402db977e32896f9f2611612c3d077f89fbac4df2;

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error UnknownAction(uint8 action);
    error LoanAlreadyMirrored(bytes32 loanId);
    error LoanNotMirrored(bytes32 loanId);
    error OutOfOrderRepayment(bytes32 loanId, uint256 incoming, uint256 current);

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event LoanMirrored(
        bytes32 indexed loanId,
        bytes32 indexed borrowerCommitment,
        address lender,
        uint256 principal,
        bytes32 queryId
    );
    event OutstandingUpdated(
        bytes32 indexed loanId, uint256 amount, uint256 outstanding, bytes32 queryId
    );

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    struct Loan {
        bytes32 borrowerCommitment;
        address lender;
        uint256 principal;
        uint256 outstanding;
        uint32 termMonths;
        uint8 ageBand;
        uint8 sex;
        uint64 openedAt;
        bool active;
    }

    mapping(bytes32 => Loan) private _loans;
    bytes32[] private _loanIds;

    constructor(uint64 sourceChainKey, address sourceEmitter)
        QuitaConsumer(sourceChainKey, sourceEmitter)
    {}

    // ---------------------------------------------------------------------
    // Proved transaction handling
    // ---------------------------------------------------------------------

    function _handleProvedTransaction(
        uint8 action,
        bytes32 queryId,
        bytes memory encodedTransaction
    ) internal override {
        EvmV1Decoder.ReceiptFields memory receipt = _requireSuccessfulReceipt(encodedTransaction);

        if (action == ACTION_DISBURSE) {
            _ingestDisbursement(receipt, queryId);
        } else if (action == ACTION_REPAY) {
            _ingestRepayment(receipt, queryId);
        } else {
            revert UnknownAction(action);
        }
    }

    /// @dev LoanDisbursed(bytes32 indexed loanId, bytes32 indexed borrowerCommitment, ...)
    function _ingestDisbursement(EvmV1Decoder.ReceiptFields memory receipt, bytes32 queryId)
        private
    {
        EvmV1Decoder.LogEntry memory log = _requireLogFrom(receipt, LOAN_DISBURSED_SIG, 3);

        bytes32 loanId = log.topics[1];
        bytes32 borrowerCommitment = log.topics[2];

        if (_loans[loanId].openedAt != 0) revert LoanAlreadyMirrored(loanId);

        (
            address lender,
            uint256 principal,
            uint32 termMonths,
            uint8 ageBand,
            uint8 sex
        ) = abi.decode(log.data, (address, uint256, uint32, uint8, uint8));

        _loans[loanId] = Loan({
            borrowerCommitment: borrowerCommitment,
            lender: lender,
            principal: principal,
            outstanding: principal,
            termMonths: termMonths,
            ageBand: ageBand,
            sex: sex,
            openedAt: uint64(block.timestamp),
            active: true
        });
        _loanIds.push(loanId);

        emit LoanMirrored(loanId, borrowerCommitment, lender, principal, queryId);
    }

    /**
     * @dev RepaymentMade(bytes32 indexed loanId, uint256 amount, uint256 outstandingAfter)
     *
     *      INVARIANT: the outstanding balance is copied from `outstandingAfter` in the proved
     *      log. It is never recomputed locally as `outstanding - amount`. The source chain is
     *      the single accounting authority, and recomputing here would let the two chains drift
     *      apart silently if a repayment were ever missed or reordered.
     *
     *      Because proofs can arrive out of order, a repayment whose `outstandingAfter` is
     *      greater than the balance already recorded is a stale event, not a correction. It is
     *      rejected rather than applied, which would otherwise let an attacker resurrect a
     *      settled debt by replaying an older repayment and inflate the insured amount.
     */
    function _ingestRepayment(EvmV1Decoder.ReceiptFields memory receipt, bytes32 queryId) private {
        EvmV1Decoder.LogEntry memory log = _requireLogFrom(receipt, REPAYMENT_MADE_SIG, 2);

        bytes32 loanId = log.topics[1];
        Loan storage loan = _loans[loanId];
        if (loan.openedAt == 0) revert LoanNotMirrored(loanId);

        (uint256 amount, uint256 outstandingAfter) = abi.decode(log.data, (uint256, uint256));

        if (outstandingAfter > loan.outstanding) {
            revert OutOfOrderRepayment(loanId, outstandingAfter, loan.outstanding);
        }

        loan.outstanding = outstandingAfter;
        if (outstandingAfter == 0) loan.active = false;

        emit OutstandingUpdated(loanId, amount, outstandingAfter, queryId);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getLoan(bytes32 loanId) external view returns (Loan memory) {
        return _loans[loanId];
    }

    function outstanding(bytes32 loanId) external view returns (uint256) {
        return _loans[loanId].outstanding;
    }

    function isMirrored(bytes32 loanId) external view returns (bool) {
        return _loans[loanId].openedAt != 0;
    }

    function isActive(bytes32 loanId) external view returns (bool) {
        return _loans[loanId].active;
    }

    function loanCount() external view returns (uint256) {
        return _loanIds.length;
    }

    function loanIdAt(uint256 index) external view returns (bytes32) {
        return _loanIds[index];
    }

    function totalOutstanding() external view returns (uint256 total) {
        uint256 length = _loanIds.length;
        for (uint256 i; i < length; ++i) {
            total += _loans[_loanIds[i]].outstanding;
        }
    }
}
