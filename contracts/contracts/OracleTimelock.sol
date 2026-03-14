// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/governance/TimelockController.sol";

/**
 * @title OracleTimelock
 * @notice 48-hour timelock for admin operations on OracleAI contracts.
 *         All critical admin functions (fee receiver changes, pausing,
 *         role grants) should be routed through this contract.
 *
 * Deployment:
 *   - minDelay: 48 hours (172800 seconds)
 *   - proposers: multisig / governance contract
 *   - executors: multisig / governance contract
 *   - admin: address(0) to renounce admin (recommended for production)
 */
contract OracleTimelock is TimelockController {
    uint256 public constant DEFAULT_DELAY = 48 hours;

    constructor(
        address[] memory proposers,
        address[] memory executors,
        address admin
    ) TimelockController(DEFAULT_DELAY, proposers, executors, admin) {}
}
