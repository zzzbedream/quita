// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ASCBase} from "@gluwa/asc-contracts/contracts/readability/ASCBase.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";
import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

/**
 * @title QuitaConsumer
 * @notice Shared safety layer for every Quita contract that consumes proved Ethereum logs.
 * @dev ASCBase provides inclusion proof verification, continuity verification and replay
 *      protection keyed on (chainKey, blockHeight, txIndex). It deliberately stops there.
 *      Three further checks are the responsibility of the application, and each one is
 *      individually sufficient to let an attacker mint a fraudulent insurance claim if
 *      omitted. All three are implemented here so that no consumer can forget them:
 *
 *        1. receiptStatus == 1          see {_requireSuccessfulReceipt}
 *        2. log emitter == QuitaOrigin  see {_requireLogFrom}
 *        3. chainKey == source chain    see {executeFromSource}
 */
abstract contract QuitaConsumer is ASCBase {
    error UnsupportedTransactionType(uint8 txType);
    error SourceTransactionReverted(uint8 receiptStatus);
    error NoMatchingLog(bytes32 eventSignature);
    error UnauthorizedEmitter(address actual, address expected);
    error UnexpectedChainKey(uint64 actual, uint64 expected);
    error MalformedLogTopics(uint256 topicCount);
    error DirectExecuteDisabled();

    /// @notice chainKey of the source chain as registered on Creditcoin. Ethereum Sepolia = 1.
    uint64 public immutable SOURCE_CHAIN_KEY;

    /// @notice The QuitaOrigin deployment on the source chain. The only trusted log emitter.
    address public immutable SOURCE_EMITTER;

    /// @dev Set only for the duration of a call that entered through {executeFromSource}.
    bool private _enteredFromSource;

    constructor(uint64 sourceChainKey, address sourceEmitter) ASCBase() {
        require(sourceEmitter != address(0), "QuitaConsumer: zero emitter");
        SOURCE_CHAIN_KEY = sourceChainKey;
        SOURCE_EMITTER = sourceEmitter;
    }

    /**
     * @notice Guarded entrypoint for proved source-chain transactions. Use this, not `execute`.
     * @dev ATTACK PREVENTED — cross-chain emitter confusion.
     *      ASCBase.execute accepts any chainKey and folds it into the replay key, but never
     *      passes it to the application handler, so a consumer inheriting ASCBase cannot tell
     *      which chain a proof came from. CC3 Testnet has more than one source chain registered
     *      (Ethereum Sepolia = 1, Ethereum Mainnet = 3). A contract living at the same address
     *      on a different registered chain would satisfy the emitter check, produce a genuine
     *      inclusion proof, and occupy a different replay key. This entrypoint pins the chainKey
     *      before any state is touched.
     *
     *      ASCBase.execute is external and cannot be overridden, so it stays callable. The
     *      handler below refuses to run unless this function set the entry flag, which makes the
     *      inherited entrypoint inert rather than merely discouraged.
     */
    function executeFromSource(
        uint8 action,
        uint64 chainKey,
        uint64 blockHeight,
        bytes calldata encodedTransaction,
        bytes32 merkleRoot,
        INativeQueryVerifier.MerkleProofEntry[] calldata siblings,
        bytes32 lowerEndpointDigest,
        bytes32[] calldata continuityRoots
    ) external returns (bool) {
        if (chainKey != SOURCE_CHAIN_KEY) {
            revert UnexpectedChainKey(chainKey, SOURCE_CHAIN_KEY);
        }

        bytes32 queryId = _computeQueryId(chainKey, blockHeight, merkleRoot, siblings);
        require(!processedQueries[queryId], "Query already processed");

        bool verified = _verifyProof(
            chainKey,
            blockHeight,
            encodedTransaction,
            merkleRoot,
            siblings,
            lowerEndpointDigest,
            continuityRoots
        );
        require(verified, "Proof of inclusion verification failed");

        processedQueries[queryId] = true;

        _enteredFromSource = true;
        _processAndEmitEvent(action, queryId, encodedTransaction);
        _enteredFromSource = false;

        return true;
    }

    /// @dev Final. Enforces the chainKey guard, then delegates to the consumer implementation.
    function _processAndEmitEvent(
        uint8 action,
        bytes32 queryId,
        bytes memory encodedTransaction
    ) internal override {
        if (!_enteredFromSource) revert DirectExecuteDisabled();
        _handleProvedTransaction(action, queryId, encodedTransaction);
    }

    /// @notice Consumer-specific handling of a proved, chain-pinned source transaction.
    function _handleProvedTransaction(
        uint8 action,
        bytes32 queryId,
        bytes memory encodedTransaction
    ) internal virtual;

    /**
     * @notice Decodes the proved transaction and rejects it unless it actually succeeded.
     * @dev ATTACK PREVENTED — accepting a reverted transaction.
     *      The BlockProver precompile proves that a transaction was *included* in a source
     *      block. It does not prove that the transaction *succeeded*. A reverted transaction is
     *      still included in the block, and the prover will happily produce a valid inclusion
     *      proof for it. An attacker can therefore craft a call to QuitaOrigin that emits
     *      DeathAttested and then reverts further down the call stack: the logs existed during
     *      execution, the inclusion proof is genuine, and without this check the claim engine
     *      would treat a transaction that never took effect as a real death notice and pay out
     *      against it. Checking receiptStatus == 1 is what closes that gap.
     * @param encodedTransaction Raw proved transaction bytes handed over by ASCBase.
     * @return receipt The decoded receipt fields, safe to read.
     */
    function _requireSuccessfulReceipt(bytes memory encodedTransaction)
        internal
        pure
        returns (EvmV1Decoder.ReceiptFields memory receipt)
    {
        uint8 txType = EvmV1Decoder.getTransactionType(encodedTransaction);
        if (!EvmV1Decoder.isValidTransactionType(txType)) {
            revert UnsupportedTransactionType(txType);
        }

        receipt = EvmV1Decoder.decodeReceiptFields(encodedTransaction);
        if (receipt.receiptStatus != 1) {
            revert SourceTransactionReverted(receipt.receiptStatus);
        }
    }

    /**
     * @notice Returns the first log matching `eventSignature`, proving it came from QuitaOrigin.
     * @dev ATTACK PREVENTED — the clone attack.
     *      Matching only on the event signature (topic 0) is not enough. Event signatures are
     *      public and unowned: anyone can deploy their own contract that declares an identical
     *      DeathAttested event, call it on Sepolia, and obtain a completely genuine inclusion
     *      proof for that transaction. The proof would verify, the receipt status would be 1,
     *      and the replay key would be unused. The only thing separating a real notice from an
     *      attacker clone is the address that emitted the log, so the emitter is pinned to the
     *      immutable SOURCE_EMITTER set at deployment.
     * @param receipt Decoded receipt from {_requireSuccessfulReceipt}.
     * @param eventSignature keccak256 of the canonical event signature.
     * @param minimumTopics Expected topic count, including topic 0.
     */
    function _requireLogFrom(
        EvmV1Decoder.ReceiptFields memory receipt,
        bytes32 eventSignature,
        uint256 minimumTopics
    ) internal view returns (EvmV1Decoder.LogEntry memory log) {
        EvmV1Decoder.LogEntry[] memory matches =
            EvmV1Decoder.getLogsByEventSignature(receipt, eventSignature);

        if (matches.length == 0) revert NoMatchingLog(eventSignature);

        log = matches[0];

        if (log.address_ != SOURCE_EMITTER) {
            revert UnauthorizedEmitter(log.address_, SOURCE_EMITTER);
        }
        if (log.topics.length < minimumTopics) {
            revert MalformedLogTopics(log.topics.length);
        }
    }
}
