// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

interface IPointsCheckIn {
    function addPoints(address user, uint256 amount, uint256 streak) external;
}

interface IReferral {
    function hasReferrer(address user) external view returns (bool);
    function distributeReferralFees(address user, uint256 totalFee) external payable;
}

interface IStaking {
    function getPointsBoost(address user) external view returns (uint256);
}

contract CheckIn is Ownable, ReentrancyGuard, Pausable {
    enum Tier { BASIC, PRO, WHALE }

    struct CheckInRecord {
        uint256 lastCheckIn;
        uint256 streak;
        uint256 totalCheckIns;
        Tier lastTier;
    }

    IPointsCheckIn public pointsContract;
    IReferral public referralContract;
    IStaking public stakingContract;
    address public prizePool;
    address public treasury;
    address public burnReserve;
    address public stakingRewards;

    uint256 public constant BASIC_THRESHOLD = 0.0015 ether;
    uint256 public constant PRO_THRESHOLD = 0.01 ether;
    uint256 public constant WHALE_THRESHOLD = 0.05 ether;

    uint256 public constant BASE_POINTS = 100;
    uint256 public constant STREAK_CAP = 7;
    uint256 public constant DAY = 86400;

    // ─── Fee Distribution (BNB) ──────────────────────────────────────
    //  50% Prize Pool       — weekly prizes for dynamic top leaderboard (up to 1000)
    //  15% Treasury         — operations, development, marketing
    //  20% Referral Tree    — 6-level rewards for referrers
    //  10% Buyback & Burn   — buy OAI on DEX, then burn
    //   5% Staking Rewards  — BNB rewards for OAI stakers
    uint256 public constant PRIZE_SHARE = 5000;      // 50%
    uint256 public constant TREASURY_SHARE = 1500;   // 15%
    uint256 public constant REFERRAL_SHARE = 2000;   // 20%
    uint256 public constant BURN_SHARE = 1000;       // 10%
    uint256 public constant STAKING_SHARE = 500;     // 5%

    mapping(address => CheckInRecord) public records;
    uint256 public totalCheckIns;
    uint256 public totalFeesCollected;

    event CheckedIn(
        address indexed user,
        uint256 amount,
        Tier tier,
        uint256 points,
        uint256 streak
    );

    constructor(
        address _points,
        address _referral,
        address _prizePool,
        address _treasury,
        address _burnReserve,
        address _stakingRewards
    ) Ownable(msg.sender) {
        pointsContract = IPointsCheckIn(_points);
        referralContract = IReferral(_referral);
        prizePool = _prizePool;
        treasury = _treasury;
        burnReserve = _burnReserve;
        stakingRewards = _stakingRewards;
    }

    function setStakingContract(address _staking) external onlyOwner {
        stakingContract = IStaking(_staking);
    }

    function setPointsContract(address _points) external onlyOwner {
        require(_points != address(0), "Zero points");
        pointsContract = IPointsCheckIn(_points);
    }

    function setReferralContract(address _referral) external onlyOwner {
        require(_referral != address(0), "Zero referral");
        referralContract = IReferral(_referral);
    }

    function setFeeReceivers(
        address _prizePool,
        address _treasury,
        address _burnReserve,
        address _stakingRewards
    ) external onlyOwner {
        require(_prizePool != address(0), "Zero prize");
        require(_treasury != address(0), "Zero treasury");
        require(_burnReserve != address(0), "Zero burn");
        require(_stakingRewards != address(0), "Zero staking");
        prizePool = _prizePool;
        treasury = _treasury;
        burnReserve = _burnReserve;
        stakingRewards = _stakingRewards;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function checkIn() external payable nonReentrant whenNotPaused {
        require(msg.value >= BASIC_THRESHOLD, "Below minimum");

        CheckInRecord storage record = records[msg.sender];

        uint256 today = block.timestamp / DAY;
        uint256 lastDay = record.lastCheckIn / DAY;
        require(today > lastDay, "Already checked in today");

        // Calculate streak
        uint256 streak = 1;
        if (lastDay > 0 && today - lastDay == 1) {
            streak = record.streak + 1;
        }

        // Determine tier
        Tier tier = _getTier(msg.value);
        uint256 multiplier = _getMultiplier(tier);

        // Streak bonus: +50% at 7 days, linear scale
        uint256 streakBonus = streak >= STREAK_CAP ? 50 : (streak * 50) / STREAK_CAP;

        // Calculate points
        uint256 points = (BASE_POINTS * multiplier * (100 + streakBonus)) / 100;

        // Staking boost
        if (address(stakingContract) != address(0)) {
            uint256 boost = stakingContract.getPointsBoost(msg.sender);
            if (boost > 0) {
                points = (points * (10000 + boost)) / 10000;
            }
        }

        // Update record
        record.lastCheckIn = block.timestamp;
        record.streak = streak;
        record.totalCheckIns++;
        record.lastTier = tier;
        totalCheckIns++;
        totalFeesCollected += msg.value;

        // Add points
        pointsContract.addPoints(msg.sender, points, streak);

        // Distribute fees
        _distributeFees(msg.sender, msg.value);

        emit CheckedIn(msg.sender, msg.value, tier, points, streak);
    }

    function _distributeFees(address user, uint256 amount) internal {
        uint256 prizeAmount = (amount * PRIZE_SHARE) / 10000;
        uint256 treasuryAmount = (amount * TREASURY_SHARE) / 10000;
        uint256 referralAmount = (amount * REFERRAL_SHARE) / 10000;
        uint256 burnAmount = (amount * BURN_SHARE) / 10000;
        uint256 stakingAmount = amount - prizeAmount - treasuryAmount - referralAmount - burnAmount;

        (bool ok1, ) = prizePool.call{value: prizeAmount}("");
        require(ok1, "Prize transfer failed");

        (bool ok2, ) = treasury.call{value: treasuryAmount}("");
        require(ok2, "Treasury transfer failed");

        bool referralHandled = false;
        if (address(referralContract) != address(0) && referralAmount > 0) {
            try referralContract.hasReferrer(user) returns (bool hasRef) {
                if (hasRef) {
                    try referralContract.distributeReferralFees{value: referralAmount}(user, referralAmount) {
                        referralHandled = true;
                    } catch {}
                }
            } catch {}
        }

        if (!referralHandled) {
            (bool ok3, ) = treasury.call{value: referralAmount}("");
            require(ok3, "Referral fallback failed");
        }

        (bool ok4, ) = burnReserve.call{value: burnAmount}("");
        require(ok4, "Burn transfer failed");

        (bool ok5, ) = stakingRewards.call{value: stakingAmount}("");
        require(ok5, "Staking rewards failed");
    }

    function _getTier(uint256 amount) internal pure returns (Tier) {
        if (amount >= WHALE_THRESHOLD) return Tier.WHALE;
        if (amount >= PRO_THRESHOLD) return Tier.PRO;
        return Tier.BASIC;
    }

    function _getMultiplier(Tier tier) internal pure returns (uint256) {
        if (tier == Tier.WHALE) return 10;
        if (tier == Tier.PRO) return 3;
        return 1;
    }

    function getRecord(address user) external view returns (CheckInRecord memory) {
        return records[user];
    }
}
