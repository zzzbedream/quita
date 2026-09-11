// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {QuitaConsumer} from "./QuitaConsumer.sol";
import {LoanMirror} from "./LoanMirror.sol";
import {WadMath} from "../libs/WadMath.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";

/**
 * @title PolicyRegistry
 * @notice Credit life policies written against cryptographically verified loan balances.
 * @dev Underwriting reads the sum insured from LoanMirror, never from user input, so a policy
 *      can only ever cover a debt that was proved to exist on Ethereum.
 */
contract PolicyRegistry is QuitaConsumer, Ownable {
    using WadMath for uint256;

    // ---------------------------------------------------------------------
    // Pricing table
    // ---------------------------------------------------------------------

    /**
     * @notice Provenance of the rate table below.
     * @dev DECLARED LIMITATION. These are plausible placeholder rates, not actuarial output.
     *      A production deployment must replace them with BR-EMS 2021 mortality loaded per
     *      SUSEP filing. Publishing invented numbers as if they were real experience would be
     *      the exact opacity this project argues against, so the placeholder is declared in the
     *      contract, in the README and in the deck.
     */
    string public constant TABLE_SOURCE = "PLACEHOLDER - pending BR-EMS 2021 (SUSEP)";

    /// @notice Age bands are five-year buckets starting at 18. Band 0 is [18,23).
    uint8 public constant BAND_WIDTH_YEARS = 5;
    uint8 public constant MIN_ENTRY_BAND = 0; // 18
    uint8 public constant MAX_ENTRY_BAND = 9; // up to 68, entry denied beyond

    uint8 public constant SEX_FEMALE = 0;
    uint8 public constant SEX_MALE = 1;

    /// @notice Monthly rate on the outstanding balance, as a wad. 2e14 == 0.02% per month.
    function monthlyRateWad(uint8 ageBand, uint8 sex) public pure returns (uint256) {
        uint256[10] memory female = [
            uint256(2e14), 2.4e14, 3.1e14, 4.3e14, 6.5e14, 1.02e15, 1.65e15, 2.4e15, 3.1e15, 3.5e15
        ];
        uint256[10] memory male = [
            uint256(3.2e14), 3.9e14, 5.0e14, 6.8e14, 1.0e15, 1.55e15, 2.4e15, 3.1e15, 3.4e15, 3.5e15
        ];
        return sex == SEX_FEMALE ? female[ageBand] : male[ageBand];
    }

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    enum Status {
        None,
        Pending,
        Active,
        Claimed,
        Lapsed
    }

    struct Policy {
        bytes32 loanId;
        uint256 sumInsured;
        uint256 premiumRateWad;
        uint64 waitingPeriodEnd;
        uint64 lastAccrualAt;
        uint256 premiumsAccrued;
        uint256 premiumsCollected;
        uint8 ageBand;
        uint8 sex;
        Status status;
    }

    uint8 public constant ACTION_PREMIUM_PAID = 0;

    // keccak256("PremiumPaid(bytes32,uint256,uint64)")
    bytes32 public constant PREMIUM_PAID_SIG =
        0xa293d934f7aee045589e66c5cd3a32ea4060fc35b0d99d85e572bf1d390b270a;

    uint256 private constant SECONDS_PER_DAY = 1 days;
    uint256 private constant DAYS_PER_MONTH = 30;

    // ---------------------------------------------------------------------
    // Errors and events
    // ---------------------------------------------------------------------

    error UnknownAction(uint8 action);
    error LoanNotMirrored(bytes32 loanId);
    error PolicyAlreadyExists(bytes32 loanId);
    error PolicyNotFound(bytes32 loanId);
    error PolicyNotActive(bytes32 loanId);
    error EntryAgeOutOfRange(uint8 ageBand);
    error CapacityUnavailable(uint256 required, uint256 available);
    error NotClaimEngine(address caller);

    event PolicyUnderwritten(
        bytes32 indexed loanId, uint256 sumInsured, uint256 premiumRateWad, uint64 waitingPeriodEnd
    );
    event PremiumAccrued(bytes32 indexed loanId, uint256 amount, uint256 totalAccrued);
    event PremiumCollected(bytes32 indexed loanId, uint256 amount, uint64 periodIndex, bytes32 queryId);
    event SumInsuredSynced(bytes32 indexed loanId, uint256 sumInsured);
    event PolicyClosed(bytes32 indexed loanId, Status status);
    event WaitingPeriodUpdated(uint64 waitingPeriod);
    event ClaimEngineUpdated(address claimEngine);

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    LoanMirror public immutable LOAN_MIRROR;

    mapping(bytes32 => Policy) private _policies;
    bytes32[] private _policyIds;

    /// @notice Waiting period before a policy can pay. Configurable, 90 days by default.
    uint64 public waitingPeriod = 90 days;

    address public claimEngine;

    /// @notice Capital pool consulted for free capacity at underwriting time.
    address public capitalPool;

    modifier onlyClaimEngine() {
        if (msg.sender != claimEngine) revert NotClaimEngine(msg.sender);
        _;
    }

    constructor(uint64 sourceChainKey, address sourceEmitter, address loanMirror, address owner_)
        QuitaConsumer(sourceChainKey, sourceEmitter)
        Ownable(owner_)
    {
        LOAN_MIRROR = LoanMirror(loanMirror);
    }

    // ---------------------------------------------------------------------
    // Administration
    // ---------------------------------------------------------------------

    function setWaitingPeriod(uint64 value) external onlyOwner {
        waitingPeriod = value;
        emit WaitingPeriodUpdated(value);
    }

    function setClaimEngine(address value) external onlyOwner {
        claimEngine = value;
        emit ClaimEngineUpdated(value);
    }

    function setCapitalPool(address value) external onlyOwner {
        capitalPool = value;
    }

    // ---------------------------------------------------------------------
    // Underwriting
    // ---------------------------------------------------------------------

    /**
     * @notice Writes a policy against a mirrored loan.
     * @dev The sum insured is read from LoanMirror, so it inherits the cryptographic guarantee
     *      of the underlying proof. There is no operator-supplied amount anywhere in this path.
     */
    function underwrite(bytes32 loanId) external returns (uint256 sumInsured) {
        if (!LOAN_MIRROR.isMirrored(loanId)) revert LoanNotMirrored(loanId);
        if (_policies[loanId].status != Status.None) revert PolicyAlreadyExists(loanId);

        LoanMirror.Loan memory loan = LOAN_MIRROR.getLoan(loanId);
        if (loan.ageBand > MAX_ENTRY_BAND) revert EntryAgeOutOfRange(loan.ageBand);

        sumInsured = loan.outstanding;

        if (capitalPool != address(0)) {
            (bool ok, bytes memory ret) = capitalPool.call(
                abi.encodeWithSignature("reserveCapacity(bytes32,uint256)", loanId, sumInsured)
            );
            if (!ok) {
                assembly {
                    revert(add(ret, 32), mload(ret))
                }
            }
        }

        uint256 rate = monthlyRateWad(loan.ageBand, loan.sex);

        _policies[loanId] = Policy({
            loanId: loanId,
            sumInsured: sumInsured,
            premiumRateWad: rate,
            waitingPeriodEnd: uint64(block.timestamp) + waitingPeriod,
            lastAccrualAt: uint64(block.timestamp),
            premiumsAccrued: 0,
            premiumsCollected: 0,
            ageBand: loan.ageBand,
            sex: loan.sex,
            status: Status.Active
        });
        _policyIds.push(loanId);

        emit PolicyUnderwritten(
            loanId, sumInsured, rate, uint64(block.timestamp) + waitingPeriod
        );
    }

    /**
     * @notice Accrues premium pro rata on the outstanding balance since the last accrual.
     * @dev Credit life premium is charged on the declining balance, not on the original
     *      principal. Charging on principal is one of the practices that produces the loss
     *      ratios this project exists to expose.
     */
    function accruePremium(bytes32 loanId) public returns (uint256 accrued) {
        Policy storage policy = _policies[loanId];
        if (policy.status == Status.None) revert PolicyNotFound(loanId);
        if (policy.status != Status.Active) return 0;

        uint256 elapsed = block.timestamp - policy.lastAccrualAt;
        if (elapsed == 0) return 0;

        uint256 daysElapsed = elapsed / SECONDS_PER_DAY;
        if (daysElapsed == 0) return 0;

        uint256 monthly = policy.sumInsured.wmul(policy.premiumRateWad);
        accrued = (monthly * daysElapsed) / DAYS_PER_MONTH;

        policy.premiumsAccrued += accrued;
        policy.lastAccrualAt = policy.lastAccrualAt + uint64(daysElapsed * SECONDS_PER_DAY);

        emit PremiumAccrued(loanId, accrued, policy.premiumsAccrued);
    }

    /// @notice Realigns the sum insured with the verified outstanding balance.
    function syncSumInsured(bytes32 loanId) external returns (uint256 sumInsured) {
        Policy storage policy = _policies[loanId];
        if (policy.status == Status.None) revert PolicyNotFound(loanId);

        accruePremium(loanId);

        sumInsured = LOAN_MIRROR.outstanding(loanId);
        uint256 previous = policy.sumInsured;
        policy.sumInsured = sumInsured;

        if (capitalPool != address(0) && sumInsured != previous) {
            (bool ok, ) = capitalPool.call(
                abi.encodeWithSignature(
                    "adjustReservation(bytes32,uint256,uint256)", loanId, previous, sumInsured
                )
            );
            ok; // capacity bookkeeping is advisory on a decrease
        }

        emit SumInsuredSynced(loanId, sumInsured);
    }

    // ---------------------------------------------------------------------
    // Proved premium collection
    // ---------------------------------------------------------------------

    function _handleProvedTransaction(
        uint8 action,
        bytes32 queryId,
        bytes memory encodedTransaction
    ) internal override {
        if (action != ACTION_PREMIUM_PAID) revert UnknownAction(action);

        EvmV1Decoder.ReceiptFields memory receipt = _requireSuccessfulReceipt(encodedTransaction);
        EvmV1Decoder.LogEntry memory log = _requireLogFrom(receipt, PREMIUM_PAID_SIG, 2);

        bytes32 loanId = log.topics[1];
        Policy storage policy = _policies[loanId];
        if (policy.status == Status.None) revert PolicyNotFound(loanId);

        (uint256 amount, uint64 periodIndex) = abi.decode(log.data, (uint256, uint64));
        policy.premiumsCollected += amount;

        if (capitalPool != address(0)) {
            (bool ok, ) = capitalPool.call(
                abi.encodeWithSignature("recordPremium(uint256)", amount)
            );
            ok;
        }

        emit PremiumCollected(loanId, amount, periodIndex, queryId);
    }

    // ---------------------------------------------------------------------
    // Claim lifecycle hook
    // ---------------------------------------------------------------------

    function markClaimed(bytes32 loanId) external onlyClaimEngine {
        Policy storage policy = _policies[loanId];
        if (policy.status != Status.Active) revert PolicyNotActive(loanId);
        policy.status = Status.Claimed;
        emit PolicyClosed(loanId, Status.Claimed);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getPolicy(bytes32 loanId) external view returns (Policy memory) {
        return _policies[loanId];
    }

    function isActive(bytes32 loanId) external view returns (bool) {
        return _policies[loanId].status == Status.Active;
    }

    function isPastWaitingPeriod(bytes32 loanId) external view returns (bool) {
        return block.timestamp >= _policies[loanId].waitingPeriodEnd;
    }

    function policyCount() external view returns (uint256) {
        return _policyIds.length;
    }

    function policyIdAt(uint256 index) external view returns (bytes32) {
        return _policyIds[index];
    }

    function activePolicyCount() external view returns (uint256 count) {
        uint256 length = _policyIds.length;
        for (uint256 i; i < length; ++i) {
            if (_policies[_policyIds[i]].status == Status.Active) ++count;
        }
    }

    function totalSumInsured() external view returns (uint256 total) {
        uint256 length = _policyIds.length;
        for (uint256 i; i < length; ++i) {
            Policy storage policy = _policies[_policyIds[i]];
            if (policy.status == Status.Active) total += policy.sumInsured;
        }
    }
}
