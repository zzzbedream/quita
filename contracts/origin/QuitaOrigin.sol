// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title QuitaOrigin
 * @notice Source-chain ledger for Quita. Deployed on Ethereum Sepolia.
 * @dev This contract deliberately holds no insurance logic. It is an event emitter with
 *      the minimum accounting required to make `outstandingAfter` authoritative, because
 *      the Creditcoin side reconstructs loan state purely from these logs after the
 *      Attestcoin Protocol has cryptographically proved their inclusion in an Ethereum block.
 *
 *      Every event signature here is consumed by a decoder on Creditcoin. Changing a
 *      signature, a parameter order, or an `indexed` marker silently breaks verification
 *      on the other chain.
 */
contract QuitaOrigin is Ownable {
    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error NotRegisteredLender(address caller);
    error NotRegisteredAttestor(address caller);
    error LoanAlreadyExists(bytes32 loanId);
    error LoanNotFound(bytes32 loanId);
    error LoanNotActive(bytes32 loanId);
    error RepaymentExceedsOutstanding(uint256 amount, uint256 outstanding);
    error InvalidPrincipal();
    error InvalidTerm();
    error InvalidSex(uint8 sex);
    error ZeroAddress();

    // ---------------------------------------------------------------------
    // Events consumed cross-chain (EXACT signatures, do not modify)
    // ---------------------------------------------------------------------

    /// @notice A loan was originated off-chain and registered by a lender.
    event LoanDisbursed(
        bytes32 indexed loanId,
        bytes32 indexed borrowerCommitment,
        address lender,
        uint256 principal,
        uint32 termMonths,
        uint8 ageBand,
        uint8 sex
    );

    /// @notice A repayment was applied. `outstandingAfter` is the authoritative post-state.
    event RepaymentMade(bytes32 indexed loanId, uint256 amount, uint256 outstandingAfter);

    /// @notice An insurance premium was collected for a billing period.
    event PremiumPaid(bytes32 indexed loanId, uint256 amount, uint64 periodIndex);

    /// @notice A registered attestor asserts the borrower died. See ClaimEngine for the trust model.
    event DeathAttested(
        bytes32 indexed borrowerCommitment,
        bytes32 indexed loanId,
        uint64 dateOfDeath,
        bytes32 evidenceHash,
        address attestor
    );

    // ---------------------------------------------------------------------
    // Registry events (local only, not consumed cross-chain)
    // ---------------------------------------------------------------------

    event LenderRegistered(address indexed lender, bool allowed);
    event AttestorRegistered(address indexed attestor, bool allowed);

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
        bool exists;
    }

    mapping(bytes32 => Loan) public loans;
    mapping(address => bool) public isLender;
    mapping(address => bool) public isAttestor;

    // ---------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------

    modifier onlyLender() {
        if (!isLender[msg.sender]) revert NotRegisteredLender(msg.sender);
        _;
    }

    modifier onlyAttestor() {
        if (!isAttestor[msg.sender]) revert NotRegisteredAttestor(msg.sender);
        _;
    }

    constructor(address initialOwner) Ownable(initialOwner) {}

    // ---------------------------------------------------------------------
    // Registry administration
    // ---------------------------------------------------------------------

    function setLender(address lender, bool allowed) external onlyOwner {
        if (lender == address(0)) revert ZeroAddress();
        isLender[lender] = allowed;
        emit LenderRegistered(lender, allowed);
    }

    function setAttestor(address attestor, bool allowed) external onlyOwner {
        if (attestor == address(0)) revert ZeroAddress();
        isAttestor[attestor] = allowed;
        emit AttestorRegistered(attestor, allowed);
    }

    // ---------------------------------------------------------------------
    // Borrower identity
    // ---------------------------------------------------------------------

    /**
     * @notice Derives the pseudonymous borrower identifier used across both chains.
     * @dev Borrower identity NEVER appears in cleartext on-chain. The national id is salted
     *      and hashed off-chain; only this commitment is emitted. This is a data-protection
     *      requirement under the Brazilian LGPD (Lei Geral de Protecao de Dados), not a
     *      stylistic preference: a raw national id in a public log is an unrectifiable
     *      disclosure, and an unsalted hash of a low-entropy national id is trivially
     *      reversible by brute force.
     * @param nationalId Borrower national identifier, supplied off-chain only.
     * @param loanId Loan identifier, which scopes the commitment to a single credit.
     * @param salt Per-borrower random salt held by the lender.
     */
    function commitmentFor(bytes32 nationalId, bytes32 loanId, bytes32 salt)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(nationalId, loanId, salt));
    }

    // ---------------------------------------------------------------------
    // Loan lifecycle
    // ---------------------------------------------------------------------

    function disburse(
        bytes32 loanId,
        bytes32 borrowerCommitment,
        uint256 principal,
        uint32 termMonths,
        uint8 ageBand,
        uint8 sex
    ) external onlyLender {
        if (loans[loanId].exists) revert LoanAlreadyExists(loanId);
        if (principal == 0) revert InvalidPrincipal();
        if (termMonths == 0) revert InvalidTerm();
        if (sex > 1) revert InvalidSex(sex);

        loans[loanId] = Loan({
            borrowerCommitment: borrowerCommitment,
            lender: msg.sender,
            principal: principal,
            outstanding: principal,
            termMonths: termMonths,
            ageBand: ageBand,
            sex: sex,
            openedAt: uint64(block.timestamp),
            active: true,
            exists: true
        });

        emit LoanDisbursed(
            loanId, borrowerCommitment, msg.sender, principal, termMonths, ageBand, sex
        );
    }

    /**
     * @notice Applies a repayment and emits the resulting outstanding balance.
     * @dev `outstandingAfter` is computed here and only here. The Creditcoin mirror copies
     *      this number rather than recomputing it, so this contract is the single source of
     *      truth for the insured amount.
     */
    function repay(bytes32 loanId, uint256 amount) external onlyLender {
        Loan storage loan = loans[loanId];
        if (!loan.exists) revert LoanNotFound(loanId);
        if (!loan.active) revert LoanNotActive(loanId);
        if (amount > loan.outstanding) {
            revert RepaymentExceedsOutstanding(amount, loan.outstanding);
        }

        uint256 outstandingAfter = loan.outstanding - amount;
        loan.outstanding = outstandingAfter;
        if (outstandingAfter == 0) loan.active = false;

        emit RepaymentMade(loanId, amount, outstandingAfter);
    }

    function payPremium(bytes32 loanId, uint256 amount, uint64 periodIndex) external onlyLender {
        Loan storage loan = loans[loanId];
        if (!loan.exists) revert LoanNotFound(loanId);
        if (!loan.active) revert LoanNotActive(loanId);

        emit PremiumPaid(loanId, amount, periodIndex);
    }

    /**
     * @notice Records an attestor assertion that the borrower of `loanId` has died.
     * @dev Access control here is the first of two mitigations. The second is the m-of-n
     *      threshold plus challenge window enforced on Creditcoin by ClaimEngine. Neither
     *      makes death cryptographically verifiable: see the ClaimEngine trust model.
     */
    function attestDeath(bytes32 loanId, uint64 dateOfDeath, bytes32 evidenceHash)
        external
        onlyAttestor
    {
        Loan storage loan = loans[loanId];
        if (!loan.exists) revert LoanNotFound(loanId);

        emit DeathAttested(
            loan.borrowerCommitment, loanId, dateOfDeath, evidenceHash, msg.sender
        );
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function outstandingOf(bytes32 loanId) external view returns (uint256) {
        return loans[loanId].outstanding;
    }
}
