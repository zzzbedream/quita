// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

/**
 * @title MockNativeQueryVerifier
 * @notice Local stand-in for the Attestcoin BlockProver precompile at 0xFD2.
 * @dev Critical warning (a) from CLAUDE.md: the real verifier is native Rust runtime code,
 *      not EVM bytecode, so a Hardhat node does not have it. ASCBase hardcodes the precompile
 *      address and offers no constructor injection, so the only way to exercise consumer
 *      contracts locally is to place this bytecode AT 0xFD2 via `hardhat_setCode` and drive it
 *      from there. See test/helpers/precompile.ts.
 *
 *      Storage at 0xFD2 is independent of the deployment address, so `setShouldVerify` must be
 *      called on the instance bound to 0xFD2, not on the original deployment.
 */
contract MockNativeQueryVerifier is INativeQueryVerifier {
    /// @notice When false, every verification call returns false so consumers must revert.
    bool public shouldVerify = true;

    function setShouldVerify(bool value) external {
        shouldVerify = value;
    }

    /**
     * @notice Derives a transaction index from the Merkle path, mirroring real prover behaviour.
     * @dev Each sibling contributes one bit: a left-hand sibling means this node sits on the
     *      right at that level. Deriving rather than hardcoding matters, because ASCBase folds
     *      this value into the replay key. A constant would make every proof collide and would
     *      turn the replay test into a false positive.
     */
    function calculateTxIndex(MerkleProof calldata merkleProof)
        external
        pure
        returns (uint64 txIndex)
    {
        uint256 length = merkleProof.siblings.length;
        for (uint256 i; i < length; ++i) {
            if (merkleProof.siblings[i].isLeft) {
                txIndex |= uint64(1) << uint64(i);
            }
        }
    }

    function verifyAndEmit(
        uint64 chainKey,
        uint64 height,
        bytes calldata,
        MerkleProof calldata merkleProof,
        ContinuityProof calldata
    ) external returns (bool) {
        if (!shouldVerify) return false;

        uint64 txIndex;
        uint256 length = merkleProof.siblings.length;
        for (uint256 i; i < length; ++i) {
            if (merkleProof.siblings[i].isLeft) {
                txIndex |= uint64(1) << uint64(i);
            }
        }

        emit TransactionVerified(chainKey, height, txIndex);
        return true;
    }

    function verifyAndEmit(
        uint64 chainKey,
        uint64[] calldata heights,
        bytes[] calldata,
        MerkleProof[] calldata,
        ContinuityProof calldata
    ) external returns (bool) {
        if (!shouldVerify) return false;
        for (uint256 i; i < heights.length; ++i) {
            emit TransactionVerified(chainKey, heights[i], uint64(i));
        }
        return true;
    }

    function verify(
        uint64,
        uint64,
        bytes calldata,
        MerkleProof calldata,
        ContinuityProof calldata
    ) external view returns (bool) {
        return shouldVerify;
    }

    function verify(
        uint64,
        uint64[] calldata,
        bytes[] calldata,
        MerkleProof[] calldata,
        ContinuityProof calldata
    ) external view returns (bool) {
        return shouldVerify;
    }
}
