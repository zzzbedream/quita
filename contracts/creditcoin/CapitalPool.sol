// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {WadMath} from "../libs/WadMath.sol";

/**
 * @title CapitalPool
 * @notice Risk capital backing Quita policies, with solvency published on-chain.
 * @dev The public views on this contract are the entire commercial argument. A Brazilian credit
 *      life book returns under 20% of premium as claims and nobody outside the insurer can
 *      verify it. Here the loss ratio is a function of two counters that only move when a
 *      premium is proved or a claim is paid.
 *
 *      This is a deliberately simple share-accounting pool, not a full ERC-4626 vault. See the
 *      roadmap in the README.
 */
contract CapitalPool is Ownable {
    using SafeERC20 for IERC20;
    using WadMath for uint256;

    error ZeroAmount();
    error InsufficientShares(uint256 held, uint256 requested);
    error WithdrawalWouldBreachLockedCapital(uint256 remaining, uint256 locked);
    error InsufficientFreeCapacity(uint256 required, uint256 available);
    error BelowMinimumCapitalRequirement(uint256 totalAssets, uint256 mcr);
    error NotAuthorized(address caller);
    error UnknownReservation(bytes32 loanId);

    event Deposited(address indexed lp, uint256 assets, uint256 shares);
    event Withdrawn(address indexed lp, uint256 assets, uint256 shares);
    event CapacityReserved(bytes32 indexed loanId, uint256 amount, uint256 lockedCapital);
    event CapacityReleased(bytes32 indexed loanId, uint256 amount, uint256 lockedCapital);
    event PremiumRecorded(uint256 amount, uint256 totalPremiumsCollected);
    event ClaimPaid(bytes32 indexed loanId, address indexed beneficiary, uint256 amount);
    event MinimumCapitalRequirementUpdated(uint256 mcr);
    event AuthorizationUpdated(address indexed account, bool allowed);

    IERC20 public immutable ASSET;

    uint256 public totalShares;
    mapping(address => uint256) public sharesOf;

    /// @notice Sum of the sum insured of every active policy.
    uint256 public lockedCapital;
    mapping(bytes32 => uint256) public reservationOf;

    /// @notice Minimum capital requirement. Gates underwriting only, never claims.
    uint256 public mcr;

    uint256 public totalPremiumsCollected;
    uint256 public totalClaimsPaid;
    uint256 public activePolicyCount;

    /// @notice Contracts allowed to reserve capacity and pay claims (PolicyRegistry, ClaimEngine).
    mapping(address => bool) public isAuthorized;

    modifier onlyAuthorized() {
        if (!isAuthorized[msg.sender]) revert NotAuthorized(msg.sender);
        _;
    }

    constructor(address asset_, uint256 mcr_, address owner_) Ownable(owner_) {
        ASSET = IERC20(asset_);
        mcr = mcr_;
    }

    // ---------------------------------------------------------------------
    // Administration
    // ---------------------------------------------------------------------

    function setAuthorized(address account, bool allowed) external onlyOwner {
        isAuthorized[account] = allowed;
        emit AuthorizationUpdated(account, allowed);
    }

    function setMcr(uint256 value) external onlyOwner {
        mcr = value;
        emit MinimumCapitalRequirementUpdated(value);
    }

    // ---------------------------------------------------------------------
    // Liquidity provision
    // ---------------------------------------------------------------------

    function totalAssets() public view returns (uint256) {
        return ASSET.balanceOf(address(this));
    }

    function deposit(uint256 assets) external returns (uint256 shares) {
        if (assets == 0) revert ZeroAmount();

        uint256 assetsBefore = totalAssets();
        shares = totalShares == 0 ? assets : (assets * totalShares) / assetsBefore;

        ASSET.safeTransferFrom(msg.sender, address(this), assets);

        totalShares += shares;
        sharesOf[msg.sender] += shares;

        emit Deposited(msg.sender, assets, shares);
    }

    /**
     * @notice Redeems shares for assets.
     * @dev Withdrawal cannot dip into capital that is backing live policies. Liquidity
     *      provision is subordinate to the promise made to policyholders.
     */
    function withdraw(uint256 shares) external returns (uint256 assets) {
        if (shares == 0) revert ZeroAmount();
        uint256 held = sharesOf[msg.sender];
        if (held < shares) revert InsufficientShares(held, shares);

        assets = (shares * totalAssets()) / totalShares;

        uint256 remaining = totalAssets() - assets;
        if (remaining < lockedCapital) {
            revert WithdrawalWouldBreachLockedCapital(remaining, lockedCapital);
        }

        sharesOf[msg.sender] = held - shares;
        totalShares -= shares;

        ASSET.safeTransfer(msg.sender, assets);

        emit Withdrawn(msg.sender, assets, shares);
    }

    // ---------------------------------------------------------------------
    // Underwriting capacity
    // ---------------------------------------------------------------------

    function freeCapacity() public view returns (uint256) {
        uint256 assets = totalAssets();
        return assets > lockedCapital ? assets - lockedCapital : 0;
    }

    /**
     * @notice Locks capacity for a new policy.
     * @dev The MCR check lives here and only here. Underwriting new risk while undercapitalised
     *      is what turns a solvency problem into an insolvency. Paying existing claims while
     *      undercapitalised is simply honouring a debt already incurred, which is why the same
     *      check deliberately does not appear in {payClaim}.
     */
    function reserveCapacity(bytes32 loanId, uint256 amount) external onlyAuthorized {
        uint256 assets = totalAssets();
        if (assets < mcr) revert BelowMinimumCapitalRequirement(assets, mcr);

        uint256 available = freeCapacity();
        if (amount > available) revert InsufficientFreeCapacity(amount, available);

        lockedCapital += amount;
        reservationOf[loanId] = amount;
        ++activePolicyCount;

        emit CapacityReserved(loanId, amount, lockedCapital);
    }

    function adjustReservation(bytes32 loanId, uint256 previous, uint256 current)
        external
        onlyAuthorized
    {
        uint256 reserved = reservationOf[loanId];
        if (reserved == 0) return;

        if (current < previous) {
            uint256 delta = previous - current;
            uint256 applied = delta > reserved ? reserved : delta;
            lockedCapital -= applied;
            reservationOf[loanId] = reserved - applied;
            emit CapacityReleased(loanId, applied, lockedCapital);
        }
    }

    function recordPremium(uint256 amount) external onlyAuthorized {
        totalPremiumsCollected += amount;
        emit PremiumRecorded(amount, totalPremiumsCollected);
    }

    // ---------------------------------------------------------------------
    // Claims
    // ---------------------------------------------------------------------

    /**
     * @notice Pays a settled claim to the beneficiary.
     * @dev DELIBERATELY NOT GATED ON THE MCR. An insurer that stops paying when its solvency
     *      ratio dips is not an insurer. The MCR restricts writing new business, which is the
     *      lever that actually protects the book, and never restricts honouring policies that
     *      are already in force.
     */
    function payClaim(bytes32 loanId, address beneficiary, uint256 amount)
        external
        onlyAuthorized
    {
        uint256 reserved = reservationOf[loanId];
        if (reserved > 0) {
            lockedCapital -= reserved;
            reservationOf[loanId] = 0;
            if (activePolicyCount > 0) --activePolicyCount;
            emit CapacityReleased(loanId, reserved, lockedCapital);
        }

        totalClaimsPaid += amount;
        ASSET.safeTransfer(beneficiary, amount);

        emit ClaimPaid(loanId, beneficiary, amount);
    }

    // ---------------------------------------------------------------------
    // Published solvency views
    // ---------------------------------------------------------------------

    /// @notice Claims paid divided by premium collected, as a wad. The headline number.
    function lossRatioWad() external view returns (uint256) {
        if (totalPremiumsCollected == 0) return 0;
        return totalClaimsPaid.wdiv(totalPremiumsCollected);
    }

    /// @notice Assets divided by the minimum capital requirement, as a wad.
    function solvencyRatioWad() external view returns (uint256) {
        if (mcr == 0) return type(uint256).max;
        return totalAssets().wdiv(mcr);
    }

    function isBelowMcr() external view returns (bool) {
        return totalAssets() < mcr;
    }
}
