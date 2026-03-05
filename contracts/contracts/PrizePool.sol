// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract PrizePool is AccessControl, ReentrancyGuard {
    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");

    uint256 public totalDistributed;
    mapping(address => uint256) public pendingPrizes;

    event PrizeReceived(uint256 amount);
    event PrizesDistributed(uint256 total, uint256 winnersCount);
    event PrizeQueued(address indexed winner, uint256 amount);
    event PendingPrizeClaimed(address indexed winner, uint256 amount);
    event EmergencyWithdraw(address to, uint256 amount);

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    receive() external payable {
        emit PrizeReceived(msg.value);
    }

    function distributePrizes(
        address[] calldata winners,
        uint256[] calldata shares
    ) external onlyRole(DISTRIBUTOR_ROLE) nonReentrant {
        require(winners.length == shares.length, "Length mismatch");

        uint256 total = 0;
        for (uint i = 0; i < shares.length; i++) {
            total += shares[i];
        }
        require(total <= address(this).balance, "Insufficient balance");

        for (uint i = 0; i < winners.length; i++) {
            if (shares[i] > 0) {
                require(winners[i] != address(0), "Zero winner");
                (bool ok, ) = winners[i].call{value: shares[i]}("");
                if (!ok) {
                    pendingPrizes[winners[i]] += shares[i];
                    emit PrizeQueued(winners[i], shares[i]);
                }
            }
        }
        totalDistributed += total;
        emit PrizesDistributed(total, winners.length);
    }

    function claimPendingPrize() external nonReentrant {
        uint256 amount = pendingPrizes[msg.sender];
        require(amount > 0, "No pending prize");
        pendingPrizes[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Claim failed");
        emit PendingPrizeClaimed(msg.sender, amount);
    }

    function emergencyWithdraw(address to) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        require(to != address(0), "Zero recipient");
        uint256 bal = address(this).balance;
        (bool ok, ) = to.call{value: bal}("");
        require(ok, "Transfer failed");
        emit EmergencyWithdraw(to, bal);
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
