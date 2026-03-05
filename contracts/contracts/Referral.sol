// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IStakingBoost {
    function getReferralBoost(address user) external view returns (uint256);
}

contract Referral is AccessControl, ReentrancyGuard {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    uint256 public constant MAX_LEVELS = 6;
    uint256 public constant MAX_DIRECT_REFERRALS = 100;

    // Percentages out of 1000 (10% = 100, 5% = 50, etc.)
    uint256[6] public levelPercents = [100, 50, 30, 20, 15, 10];

    IStakingBoost public stakingContract;

    mapping(address => address) public referrer;
    mapping(address => address[]) public directReferrals;
    mapping(address => bool) public hasReferrer;
    mapping(address => uint256) public totalEarnings;
    mapping(address => uint256) public pendingEarnings;
    uint256 public unallocatedFees;

    event ReferralRegistered(address indexed user, address indexed referrer);
    event ReferralPaid(address indexed referrer, address indexed from, uint256 level, uint256 amount);
    event ReferralWithdrawn(address indexed user, uint256 amount);
    event UnallocatedWithdrawn(address indexed to, uint256 amount);

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function setStakingContract(address _staking) external onlyRole(DEFAULT_ADMIN_ROLE) {
        stakingContract = IStakingBoost(_staking);
    }

    function registerReferral(address user, address ref) external onlyRole(OPERATOR_ROLE) {
        require(!hasReferrer[user], "Already has referrer");
        require(user != ref, "Self-referral");
        require(ref != address(0), "Zero referrer");
        require(directReferrals[ref].length < MAX_DIRECT_REFERRALS, "Max referrals reached");

        address current = ref;
        for (uint i = 0; i < MAX_LEVELS; i++) {
            require(current != user, "Circular ref");
            if (!hasReferrer[current]) break;
            current = referrer[current];
        }

        referrer[user] = ref;
        hasReferrer[user] = true;
        directReferrals[ref].push(user);

        emit ReferralRegistered(user, ref);
    }

    function distributeReferralFees(
        address user,
        uint256 totalReferralFee
    ) external payable onlyRole(OPERATOR_ROLE) nonReentrant {
        if (!hasReferrer[user]) return;

        address current = referrer[user];
        uint256 distributed = 0;

        for (uint256 level = 0; level < MAX_LEVELS && current != address(0); level++) {
            uint256 share = (totalReferralFee * levelPercents[level]) / 1000;

            // Apply staking boost: if referrer has staked, they get +15% on their share
            if (address(stakingContract) != address(0)) {
                uint256 boost = stakingContract.getReferralBoost(current);
                if (boost > 0) {
                    share = (share * (10000 + boost)) / 10000;
                }
            }

            if (share > 0 && distributed + share <= msg.value) {
                pendingEarnings[current] += share;
                totalEarnings[current] += share;
                distributed += share;
                emit ReferralPaid(current, user, level + 1, share);
            }
            if (!hasReferrer[current]) break;
            current = referrer[current];
        }

        if (distributed < msg.value) {
            unallocatedFees += (msg.value - distributed);
        }
    }

    function withdrawReferralEarnings() external nonReentrant {
        uint256 amount = pendingEarnings[msg.sender];
        require(amount > 0, "No referral earnings");
        pendingEarnings[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Withdraw failed");
        emit ReferralWithdrawn(msg.sender, amount);
    }

    function withdrawUnallocated(address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        require(to != address(0), "Zero recipient");
        require(amount > 0 && amount <= unallocatedFees, "Bad amount");
        unallocatedFees -= amount;
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "Unallocated transfer failed");
        emit UnallocatedWithdrawn(to, amount);
    }

    receive() external payable {}

    function getDirectReferrals(address user) external view returns (address[] memory) {
        return directReferrals[user];
    }

    function getReferralChain(address user) external view returns (address[6] memory chain) {
        address current = user;
        for (uint i = 0; i < MAX_LEVELS; i++) {
            if (!hasReferrer[current]) break;
            current = referrer[current];
            chain[i] = current;
        }
    }
}
