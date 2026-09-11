// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title WadMath
 * @notice Fixed point helpers on a 1e18 scale.
 * @dev Premium rates and ratios are held as wads so that a monthly rate such as 0.14% is
 *      representable without the rounding drift that basis points introduce once a rate is
 *      prorated across days.
 */
library WadMath {
    uint256 internal constant WAD = 1e18;

    error DivisionByZero();

    /// @notice Multiplies two wads, truncating toward zero.
    function wmul(uint256 a, uint256 b) internal pure returns (uint256) {
        return (a * b) / WAD;
    }

    /// @notice Divides two wads, truncating toward zero.
    function wdiv(uint256 a, uint256 b) internal pure returns (uint256) {
        if (b == 0) revert DivisionByZero();
        return (a * WAD) / b;
    }
}
