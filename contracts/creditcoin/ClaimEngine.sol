// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {QuitaConsumer} from "./QuitaConsumer.sol";
import {LoanMirror} from "./LoanMirror.sol";
import {PolicyRegistry} from "./PolicyRegistry.sol";
import {CapitalPool} from "./CapitalPool.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";

/**
 * @title ClaimEngine
 * @notice Death claim settlement for Quita policies.
 *
 * @dev TRUST MODEL. Read this before anything else in the repository.
 *
 *      Death is a fact about the world. The Attestcoin Protocol cannot verify it: the protocol
 *      verifies that a transaction occurred on Ethereum, nothing more. The death attestation is
 *      therefore TRUSTED, mitigated by an m-of-n threshold and a challenge window during which
 *      any attestor can block settlement.
 *
 *      The AMOUNT paid, by contrast, is CRYPTOGRAPHICALLY VERIFIED. It is taken from the
 *      outstanding balance reconstructed in LoanMirror from proved Ethereum events, and never
 *      from anything an attestor said. An attestor who lies about the payout amount changes
 *      nothing, because the amount is not read from the attestation.
 *
 *      That separation is the design, not a shortcoming. Claiming otherwise would mean claiming
 *      to have oracle-ised mortality, which no protocol can do.
 */
contract ClaimEngine is QuitaConsumer, Ownable {
    uint8 public constant ACTION_ATTEST_DEATH = 0;

    // keccak256("DeathAttested(bytes32,bytes32,uint64,bytes32,address)")
    bytes32 public constant DEATH_ATTESTED_SIG =
        0x12e09f9333d2859195d846a0b1ce84d925cc0b759c2dcce367933a7312c67b42;

    enum ClaimStatus {
        None,
        Attesting,
        Challenged,
        Disputed,
        Settled
    }

    struct Claim {
        bytes32 loanId;
        bytes32 borrowerCommitment;
        uint64 dateOfDeath;
        uint8 attestationCount;
        uint64 challengeDeadline;
        uint256 payout;
        ClaimStatus status;
    }

    error UnknownAction(uint8 action);
    error NotAnAttestor(address caller);
    error AlreadyAttested(bytes32 loanId, address attestor);
    error ClaimNotFound(bytes32 loanId);
    error ThresholdNotReached(uint8 have, uint8 needed);
    error ChallengeWindowOpen(uint64 nowTs, uint64 deadline);
    error ClaimDisputed(bytes32 loanId);
    error ClaimAlreadySettled(bytes32 loanId);
    error PolicyNotActive(bytes32 loanId);
    error WaitingPeriodNotElapsed(bytes32 loanId);

    event AttestorUpdated(address indexed attestor, bool allowed);
    event ThresholdUpdated(uint8 threshold);
    event ChallengeWindowUpdated(uint64 challengeWindow);
    event DeathAttestationRecorded(
        bytes32 indexed loanId,
        address indexed attestor,
        uint8 attestationCount,
        bytes32 queryId
    );
    event ChallengeWindowOpened(bytes32 indexed loanId, uint64 challengeDeadline);
    event ClaimChallenged(bytes32 indexed loanId, address indexed challenger);
    event ClaimSettled(
        bytes32 indexed loanId, address indexed lender, uint256 payout, uint256 sumInsured
    );

    LoanMirror public immutable LOAN_MIRROR;
    PolicyRegistry public immutable POLICY_REGISTRY;
    CapitalPool public immutable CAPITAL_POOL;

    mapping(address => bool) public isAttestor;
    uint8 public threshold = 2;

    /**
     * @notice Seconds between reaching the threshold and settlement becoming possible.
     * @dev A real deployment uses 24 hours. The demo shortens it to two minutes. It is exposed
     *      as an owner-settable parameter that emits on change precisely so that the short
     *      window used on stage is visibly a configuration value and not a special case in the
     *      settlement path.
     */
    uint64 public challengeWindow = 24 hours;

    mapping(bytes32 => Claim) private _claims;
    mapping(bytes32 => mapping(address => bool)) private _hasAttested;
    bytes32[] private _claimIds;

    constructor(
        uint64 sourceChainKey,
        address sourceEmitter,
        address loanMirror,
        address policyRegistry,
        address capitalPool,
        address owner_
    ) QuitaConsumer(sourceChainKey, sourceEmitter) Ownable(owner_) {
        LOAN_MIRROR = LoanMirror(loanMirror);
        POLICY_REGISTRY = PolicyRegistry(policyRegistry);
        CAPITAL_POOL = CapitalPool(capitalPool);
    }

    // ---------------------------------------------------------------------
    // Administration
    // ---------------------------------------------------------------------

    function setAttestor(address attestor, bool allowed) external onlyOwner {
        isAttestor[attestor] = allowed;
        emit AttestorUpdated(attestor, allowed);
    }

    function setThreshold(uint8 value) external onlyOwner {
        require(value > 0, "ClaimEngine: zero threshold");
        threshold = value;
        emit ThresholdUpdated(value);
    }

    function setChallengeWindow(uint64 value) external onlyOwner {
        challengeWindow = value;
        emit ChallengeWindowUpdated(value);
    }

    // ---------------------------------------------------------------------
    // Attestation intake
    // ---------------------------------------------------------------------

    /**
     * @dev The proof establishes that a registered attestor really did publish this attestation
     *      on Ethereum, and that the transaction succeeded. It establishes nothing about whether
     *      the borrower actually died. That gap is what the threshold and the challenge window
     *      are for.
     */
    function _handleProvedTransaction(
        uint8 action,
        bytes32 queryId,
        bytes memory encodedTransaction
    ) internal override {
        if (action != ACTION_ATTEST_DEATH) revert UnknownAction(action);

        EvmV1Decoder.ReceiptFields memory receipt = _requireSuccessfulReceipt(encodedTransaction);
        EvmV1Decoder.LogEntry memory log = _requireLogFrom(receipt, DEATH_ATTESTED_SIG, 3);

        bytes32 borrowerCommitment = log.topics[1];
        bytes32 loanId = log.topics[2];

        (uint64 dateOfDeath, , address attestor) =
            abi.decode(log.data, (uint64, bytes32, address));

        if (!isAttestor[attestor]) revert NotAnAttestor(attestor);
        if (_hasAttested[loanId][attestor]) revert AlreadyAttested(loanId, attestor);

        Claim storage claim = _claims[loanId];
        if (claim.status == ClaimStatus.Settled) revert ClaimAlreadySettled(loanId);

        if (claim.status == ClaimStatus.None) {
            if (!POLICY_REGISTRY.isActive(loanId)) revert PolicyNotActive(loanId);
            if (!POLICY_REGISTRY.isPastWaitingPeriod(loanId)) {
                revert WaitingPeriodNotElapsed(loanId);
            }
            claim.loanId = loanId;
            claim.borrowerCommitment = borrowerCommitment;
            claim.dateOfDeath = dateOfDeath;
            claim.status = ClaimStatus.Attesting;
            _claimIds.push(loanId);
        }

        _hasAttested[loanId][attestor] = true;
        claim.attestationCount += 1;

        emit DeathAttestationRecorded(loanId, attestor, claim.attestationCount, queryId);

        if (claim.attestationCount >= threshold && claim.status == ClaimStatus.Attesting) {
            claim.status = ClaimStatus.Challenged;
            claim.challengeDeadline = uint64(block.timestamp) + challengeWindow;
            emit ChallengeWindowOpened(loanId, claim.challengeDeadline);
        }
    }

    // ---------------------------------------------------------------------
    // Challenge and settlement
    // ---------------------------------------------------------------------

    function challenge(bytes32 loanId) external {
        if (!isAttestor[msg.sender]) revert NotAnAttestor(msg.sender);

        Claim storage claim = _claims[loanId];
        if (claim.status == ClaimStatus.None) revert ClaimNotFound(loanId);
        if (claim.status == ClaimStatus.Settled) revert ClaimAlreadySettled(loanId);

        claim.status = ClaimStatus.Disputed;
        emit ClaimChallenged(loanId, msg.sender);
    }

    /**
     * @notice Settles a claim and pays the lender.
     * @dev The payout is min(sum insured, verified outstanding balance). Both inputs trace back
     *      to proved Ethereum events; neither comes from the attestation.
     *
     *      The beneficiary is the LENDER, not the family. In credit life cover the insured life
     *      is the borrower but the beneficiary is the creditor: the policy exists to extinguish
     *      the debt so that it cannot pass to the estate. This is the correct behaviour, not an
     *      inverted payee.
     */
    function settle(bytes32 loanId) external returns (uint256 payout) {
        Claim storage claim = _claims[loanId];
        if (claim.status == ClaimStatus.None) revert ClaimNotFound(loanId);
        if (claim.status == ClaimStatus.Settled) revert ClaimAlreadySettled(loanId);
        if (claim.status == ClaimStatus.Disputed) revert ClaimDisputed(loanId);
        if (claim.attestationCount < threshold) {
            revert ThresholdNotReached(claim.attestationCount, threshold);
        }
        if (block.timestamp < claim.challengeDeadline) {
            revert ChallengeWindowOpen(uint64(block.timestamp), claim.challengeDeadline);
        }

        PolicyRegistry.Policy memory policy = POLICY_REGISTRY.getPolicy(loanId);
        uint256 verifiedOutstanding = LOAN_MIRROR.outstanding(loanId);

        payout = policy.sumInsured < verifiedOutstanding ? policy.sumInsured : verifiedOutstanding;

        claim.payout = payout;
        claim.status = ClaimStatus.Settled;

        POLICY_REGISTRY.markClaimed(loanId);

        LoanMirror.Loan memory loan = LOAN_MIRROR.getLoan(loanId);
        CAPITAL_POOL.payClaim(loanId, loan.lender, payout);

        emit ClaimSettled(loanId, loan.lender, payout, policy.sumInsured);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getClaim(bytes32 loanId) external view returns (Claim memory) {
        return _claims[loanId];
    }

    function hasAttested(bytes32 loanId, address attestor) external view returns (bool) {
        return _hasAttested[loanId][attestor];
    }

    function claimCount() external view returns (uint256) {
        return _claimIds.length;
    }

    function claimIdAt(uint256 index) external view returns (bytes32) {
        return _claimIds[index];
    }
}
