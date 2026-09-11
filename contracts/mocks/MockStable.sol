// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockStable
 * @notice Six-decimal ERC20 standing in for a settlement stablecoin.
 * @dev DECLARED LIMITATION. Quita does not issue or custody a real stablecoin. This mock
 *      represents whatever stable unit a production deployment would settle in, and exists so
 *      the capital pool and claim payouts can be exercised end to end on testnet. It is freely
 *      mintable and must never be treated as a store of value.
 */
contract MockStable is ERC20 {
    constructor() ERC20("Quita Demo Stable", "qUSD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
