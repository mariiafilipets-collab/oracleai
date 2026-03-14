// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/finance/VestingWallet.sol";

/**
 * @title OAIVesting
 * @notice Linear vesting wallet for OAI token allocations.
 *         Extends OpenZeppelin VestingWallet with a cliff period.
 *
 * Usage:
 *   - Team & Advisors: 6-month cliff, 2-year total vest
 *   - Marketing: no cliff, 1-year vest
 *   - Ecosystem: no cliff, 1-year vest
 *
 * After deployment, transfer the OAI allocation to this contract.
 * The beneficiary can call release(token) to claim vested tokens.
 * No tokens can be released before cliff + startTimestamp.
 */
contract OAIVesting is VestingWallet {
    uint64 public immutable cliffDuration;
    uint64 public immutable vestingStart;

    /**
     * @param beneficiary Address that receives vested tokens
     * @param startTimestamp Unix timestamp when vesting begins
     * @param durationSeconds Total vesting duration in seconds
     * @param cliffSeconds Cliff period in seconds (no release before cliff ends)
     */
    constructor(
        address beneficiary,
        uint64 startTimestamp,
        uint64 durationSeconds,
        uint64 cliffSeconds
    ) VestingWallet(beneficiary, startTimestamp, durationSeconds) {
        require(cliffSeconds <= durationSeconds, "Cliff exceeds duration");
        cliffDuration = cliffSeconds;
        vestingStart = startTimestamp;
    }

    /**
     * @dev Override to enforce cliff: returns 0 before cliff ends.
     */
    function _vestingSchedule(
        uint256 totalAllocation,
        uint64 timestamp
    ) internal view override returns (uint256) {
        if (timestamp < vestingStart + cliffDuration) {
            return 0;
        }
        return super._vestingSchedule(totalAllocation, timestamp);
    }
}
