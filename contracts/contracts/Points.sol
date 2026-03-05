// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";

contract Points is AccessControl {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    struct UserPoints {
        uint256 points;
        uint256 weeklyPoints;
        uint256 streak;
        uint256 lastCheckIn;
        uint256 totalCheckIns;
        uint256 correctPredictions;
        uint256 totalPredictions;
    }

    mapping(address => UserPoints) public users;
    address[] public allUsers;
    mapping(address => bool) private _isUser;

    uint256 public totalPointsIssued;

    event PointsAdded(address indexed user, uint256 amount, uint256 total);
    event StreakUpdated(address indexed user, uint256 streak);
    event PredictionBonusAdded(address indexed user, uint256 bonus);

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function addPoints(address user, uint256 amount, uint256 streak) external onlyRole(OPERATOR_ROLE) {
        if (!_isUser[user]) {
            allUsers.push(user);
            _isUser[user] = true;
        }

        users[user].points += amount;
        users[user].weeklyPoints += amount;
        users[user].streak = streak;
        users[user].lastCheckIn = block.timestamp;
        users[user].totalCheckIns++;
        totalPointsIssued += amount;

        emit PointsAdded(user, amount, users[user].points);
        emit StreakUpdated(user, streak);
    }

    function addPredictionBonus(address user, uint256 bonus, bool correct) external onlyRole(OPERATOR_ROLE) {
        if (!_isUser[user]) {
            allUsers.push(user);
            _isUser[user] = true;
        }

        users[user].points += bonus;
        users[user].weeklyPoints += bonus;
        users[user].totalPredictions++;
        if (correct) users[user].correctPredictions++;
        totalPointsIssued += bonus;

        emit PredictionBonusAdded(user, bonus);
    }

    function resetWeeklyPoints(address[] calldata addrs) external onlyRole(OPERATOR_ROLE) {
        for (uint i = 0; i < addrs.length; i++) {
            users[addrs[i]].weeklyPoints = 0;
        }
    }

    function resetAllWeeklyPoints() external onlyRole(OPERATOR_ROLE) {
        for (uint i = 0; i < allUsers.length; i++) {
            users[allUsers[i]].weeklyPoints = 0;
        }
    }

    function resetWeeklyPointsBatch(uint256 start, uint256 count) external onlyRole(OPERATOR_ROLE) returns (uint256 processed) {
        uint256 len = allUsers.length;
        if (start >= len) return 0;
        uint256 end = start + count;
        if (end > len) end = len;
        for (uint256 i = start; i < end; i++) {
            users[allUsers[i]].weeklyPoints = 0;
        }
        return end - start;
    }

    function getUserPoints(address user) external view returns (UserPoints memory) {
        return users[user];
    }

    function getUserCount() external view returns (uint256) {
        return allUsers.length;
    }

    function getTopUsers(uint256 count) external view returns (address[] memory, uint256[] memory) {
        uint256 len = allUsers.length < count ? allUsers.length : count;
        address[] memory topAddrs = new address[](len);
        uint256[] memory topPts = new uint256[](len);

        for (uint i = 0; i < allUsers.length; i++) {
            uint256 pts = users[allUsers[i]].weeklyPoints;
            for (uint j = 0; j < len; j++) {
                if (pts > topPts[j]) {
                    for (uint k = len - 1; k > j; k--) {
                        topAddrs[k] = topAddrs[k - 1];
                        topPts[k] = topPts[k - 1];
                    }
                    topAddrs[j] = allUsers[i];
                    topPts[j] = pts;
                    break;
                }
            }
        }
        return (topAddrs, topPts);
    }
}
