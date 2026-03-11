// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IPoints {
    function addPredictionBonus(address user, uint256 bonus, bool correct) external;
    function users(address user) external view returns (
        uint256 points,
        uint256 weeklyPoints,
        uint256 streak,
        uint256 lastCheckIn,
        uint256 totalCheckIns,
        uint256 correctPredictions,
        uint256 totalPredictions
    );
}

interface IReferralPrediction {
    function hasReferrer(address user) external view returns (bool);
    function distributeReferralFees(address user, uint256 totalReferralFee) external payable;
}

contract Prediction is AccessControl, ReentrancyGuard {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    enum Category { SPORTS, POLITICS, ECONOMY, CRYPTO, CLIMATE }

    struct PredictionEvent {
        uint256 id;
        string title;
        Category category;
        uint256 aiProbability; // 0-100
        uint256 deadline;
        bool resolved;
        bool outcome;
        uint256 totalVotesYes;
        uint256 totalVotesNo;
        address creator;
        bool isUserEvent;
        uint256 listingFee;
        string sourcePolicy;
    }

    struct UserVote {
        bool voted;
        bool prediction;
    }

    IPoints public pointsContract;
    IReferralPrediction public referralContract;
    address public prizePool;
    address public treasury;
    address public burnReserve;
    address public stakingRewards;
    uint256 public eventCount;

    uint256 public constant VOTE_BASE_POINTS = 50;
    uint256 public constant DAY = 86400;
    uint256 public constant USER_EVENT_FEE = 0.0015 ether;
    uint256 public userEventVoteFee = 0.0002 ether;
    uint256 public constant VOTE_BASIC_FEE = 0.00015 ether;
    uint256 public constant VOTE_PRO_FEE = 0.005 ether;
    uint256 public constant VOTE_WHALE_MIN_FEE = 0.05 ether;
    uint256 public constant USER_EVENT_COOLDOWN = DAY;
    uint256 public constant VERIFIED_CREATOR_COOLDOWN = DAY / 3;
    uint256 public constant VERIFIED_MIN_POINTS = 5000;
    uint256 public constant MAX_TITLE_LENGTH = 180;
    uint256 public constant MAX_SOURCE_POLICY_LENGTH = 120;
    uint256 public constant MAX_RESOLVE_BATCH = 300;
    uint16 public constant BPS_DENOMINATOR = 10000;

    // Vote-fee split for user-created events:
    // 50% creator pool, 50% protocol pool.
    uint16 public creatorShareBps = 5000;
    uint256 public minCreatorPayoutVotes = 20;

    // Protocol pool split mirrors CheckIn percentages.
    uint16 public constant PRIZE_SHARE = 5000;      // 50%
    uint16 public constant TREASURY_SHARE = 1500;   // 15%
    uint16 public constant REFERRAL_SHARE = 2000;   // 20%
    uint16 public constant BURN_SHARE = 1000;       // 10%
    uint16 public constant STAKING_SHARE = 500;     // 5%
    uint256 public constant PROTOCOL_DISTRIBUTION_INTERVAL = 12 hours;

    mapping(uint256 => PredictionEvent) public events;
    mapping(uint256 => mapping(address => UserVote)) public userVotes;
    mapping(uint256 => address[]) public eventVoters;
    mapping(address => uint256) public nextUserEventAt;
    mapping(uint256 => bool) public resolveInProgress;
    mapping(uint256 => uint256) public resolveCursor;
    mapping(uint256 => uint256) public resolvedWinners;
    mapping(uint256 => bool) private _pendingOutcome;
    mapping(uint256 => bool) private _pendingAiWasRight;
    mapping(uint256 => uint256) public creatorPendingByEvent;
    mapping(address => uint256) public creatorClaimableWei;
    mapping(uint256 => bool) public creatorPayoutFinalized;
    mapping(uint256 => mapping(address => uint256)) public voteMultiplierBps;
    uint256 public pendingProtocolFeesWei;
    uint256 public nextProtocolDistributionAt;

    event EventCreated(uint256 indexed id, string title, Category category, uint256 deadline);
    event UserEventCreated(uint256 indexed id, address indexed creator, uint256 feePaid, uint256 nextAllowedAt);
    event VoteSubmitted(uint256 indexed eventId, address indexed user, bool prediction);
    event EventResolutionStarted(uint256 indexed id, bool outcome, uint256 voters);
    event EventResolutionProgress(uint256 indexed id, uint256 from, uint256 to, uint256 total);
    event EventResolved(uint256 indexed id, bool outcome, uint256 winnersCount);
    event CreatorRewardsAccrued(uint256 indexed eventId, address indexed creator, uint256 amount);
    event CreatorRewardsRedirected(uint256 indexed eventId, address indexed creator, uint256 amount, string reason);
    event CreatorRewardsClaimed(address indexed creator, uint256 amount);
    event VoteFeeDistributed(uint256 indexed eventId, address indexed voter, uint256 totalFee, uint256 creatorCut, uint256 protocolCut);
    event FeeConfigUpdated(uint256 voteFee, uint16 creatorShareBps, uint256 minCreatorPayoutVotes);
    event FeeReceiversUpdated(address prizePool, address treasury, address referralContract, address burnReserve, address stakingRewards);
    event ProtocolFeesDistributionScheduled(uint256 pendingAmount, uint256 nextAt);
    event ProtocolFeesDistributed(uint256 distributedAmount, uint256 prize, uint256 treasury, uint256 referralFallback, uint256 burn, uint256 staking);

    constructor(
        address _points,
        address _treasury,
        address _prizePool,
        address _referralContract,
        address _burnReserve,
        address _stakingRewards
    ) {
        require(_treasury != address(0), "Zero treasury");
        require(_prizePool != address(0), "Zero prize");
        require(_burnReserve != address(0), "Zero burn");
        require(_stakingRewards != address(0), "Zero staking");
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, msg.sender);
        pointsContract = IPoints(_points);
        referralContract = IReferralPrediction(_referralContract);
        prizePool = _prizePool;
        treasury = _treasury;
        burnReserve = _burnReserve;
        stakingRewards = _stakingRewards;
        nextProtocolDistributionAt = block.timestamp + PROTOCOL_DISTRIBUTION_INTERVAL;
    }

    function createEvent(
        string calldata title,
        Category category,
        uint256 deadline,
        uint256 aiProbability
    ) external onlyRole(OPERATOR_ROLE) returns (uint256) {
        require(deadline > block.timestamp, "Past deadline");
        require(aiProbability <= 100, "Invalid probability");

        eventCount++;
        events[eventCount] = PredictionEvent({
            id: eventCount,
            title: title,
            category: category,
            aiProbability: aiProbability,
            deadline: deadline,
            resolved: false,
            outcome: false,
            totalVotesYes: 0,
            totalVotesNo: 0,
            creator: address(0),
            isUserEvent: false,
            listingFee: 0,
            sourcePolicy: ""
        });

        emit EventCreated(eventCount, title, category, deadline);
        return eventCount;
    }

    function createUserEvent(
        string calldata title,
        Category category,
        uint256 deadline,
        string calldata sourcePolicy
    ) external payable nonReentrant returns (uint256) {
        require(bytes(title).length > 10 && bytes(title).length <= MAX_TITLE_LENGTH, "Invalid title length");
        require(bytes(sourcePolicy).length > 0 && bytes(sourcePolicy).length <= MAX_SOURCE_POLICY_LENGTH, "Invalid source");
        require(msg.value == USER_EVENT_FEE, "Invalid fee");
        require(deadline > block.timestamp + 10 minutes, "Deadline too soon");
        require(deadline < block.timestamp + 14 days, "Deadline too far");
        uint256 cooldown = getCreatorCooldown(msg.sender);
        require(block.timestamp >= nextUserEventAt[msg.sender], "Cooldown active");

        eventCount++;
        events[eventCount] = PredictionEvent({
            id: eventCount,
            title: title,
            category: category,
            aiProbability: 50,
            deadline: deadline,
            resolved: false,
            outcome: false,
            totalVotesYes: 0,
            totalVotesNo: 0,
            creator: msg.sender,
            isUserEvent: true,
            listingFee: msg.value,
            sourcePolicy: sourcePolicy
        });

        nextUserEventAt[msg.sender] = block.timestamp + cooldown;

        (bool sent, ) = payable(treasury).call{value: msg.value}("");
        require(sent, "Treasury transfer failed");

        emit EventCreated(eventCount, title, category, deadline);
        emit UserEventCreated(eventCount, msg.sender, msg.value, nextUserEventAt[msg.sender]);
        return eventCount;
    }

    function isVerifiedCreator(address user) public view returns (bool) {
        (uint256 points, , , , , , ) = pointsContract.users(user);
        return points >= VERIFIED_MIN_POINTS;
    }

    function getCreatorCooldown(address user) public view returns (uint256) {
        if (isVerifiedCreator(user)) return VERIFIED_CREATOR_COOLDOWN;
        return USER_EVENT_COOLDOWN;
    }

    function submitPrediction(uint256 eventId, bool _prediction) external payable nonReentrant {
        PredictionEvent storage evt = events[eventId];
        require(evt.id != 0, "Event not found");
        require(!evt.resolved, "Already resolved");
        require(!resolveInProgress[eventId], "Resolving in progress");
        require(block.timestamp < evt.deadline, "Past deadline");
        require(!userVotes[eventId][msg.sender].voted, "Already voted");
        if (evt.isUserEvent) {
            require(msg.sender != evt.creator, "Creator cannot vote own event");
        }
        uint256 multiplierBps = _getVoteMultiplierBps(msg.value);
        (, , , uint256 lastCheckIn, , , ) = pointsContract.users(msg.sender);
        require(lastCheckIn / DAY == block.timestamp / DAY, "Check-in required today");

        userVotes[eventId][msg.sender] = UserVote(true, _prediction);
        voteMultiplierBps[eventId][msg.sender] = multiplierBps;
        eventVoters[eventId].push(msg.sender);

        if (_prediction) evt.totalVotesYes++;
        else evt.totalVotesNo++;

        if (msg.value > 0) {
            _distributeVoteFees(msg.sender, msg.value);
            emit VoteFeeDistributed(eventId, msg.sender, msg.value, 0, msg.value);
        }

        emit VoteSubmitted(eventId, msg.sender, _prediction);
    }

    function resolveEvent(uint256 eventId, bool actualOutcome) external onlyRole(OPERATOR_ROLE) {
        _resolveEventBatch(eventId, actualOutcome, MAX_RESOLVE_BATCH);
    }

    function resolveEventBatch(uint256 eventId, bool actualOutcome, uint256 maxBatch)
        external
        onlyRole(OPERATOR_ROLE)
    {
        require(maxBatch > 0 && maxBatch <= 1000, "Bad batch");
        _resolveEventBatch(eventId, actualOutcome, maxBatch);
    }

    function _resolveEventBatch(uint256 eventId, bool actualOutcome, uint256 maxBatch) internal {
        PredictionEvent storage evt = events[eventId];
        require(evt.id != 0, "Event not found");
        require(!evt.resolved, "Already resolved");
        require(block.timestamp >= evt.deadline, "Before deadline");

        address[] storage voters = eventVoters[eventId];
        if (!resolveInProgress[eventId]) {
            resolveInProgress[eventId] = true;
            _pendingOutcome[eventId] = actualOutcome;
            _pendingAiWasRight[eventId] = (evt.aiProbability >= 50) == actualOutcome;
            emit EventResolutionStarted(eventId, actualOutcome, voters.length);
        }

        uint256 from = resolveCursor[eventId];
        uint256 to = from + maxBatch;
        if (to > voters.length) to = voters.length;

        for (uint256 i = from; i < to; i++) {
            UserVote memory vote = userVotes[eventId][voters[i]];
            bool userCorrect = vote.prediction == _pendingOutcome[eventId];
            if (userCorrect) {
                resolvedWinners[eventId]++;
                uint256 multiplierBps = voteMultiplierBps[eventId][voters[i]];
                if (multiplierBps == 0) multiplierBps = 10000; // backward-safe default (Basic)
                uint256 basePoints = (VOTE_BASE_POINTS * multiplierBps) / 10000;
                // +100% for correct prediction (x2 on all tiers, incl. Whale).
                uint256 bonus = basePoints * 2;
                pointsContract.addPredictionBonus(voters[i], bonus, true);
            } else {
                pointsContract.addPredictionBonus(voters[i], 0, false);
            }
        }

        resolveCursor[eventId] = to;
        emit EventResolutionProgress(eventId, from, to, voters.length);

        if (to == voters.length) {
            evt.resolved = true;
            evt.outcome = _pendingOutcome[eventId];
            resolveInProgress[eventId] = false;
            _finalizeCreatorPayout(eventId, voters.length, evt.creator, evt.isUserEvent);
            delete _pendingOutcome[eventId];
            delete _pendingAiWasRight[eventId];
            emit EventResolved(eventId, evt.outcome, resolvedWinners[eventId]);
        }
    }

    function _safeSend(address recipient, uint256 amount) internal returns (bool) {
        if (amount == 0 || recipient == address(0)) return true;
        (bool ok, ) = payable(recipient).call{value: amount}("");
        return ok;
    }

    function _distributeVoteFees(address user, uint256 amount) internal {
        if (amount == 0) return;

        uint256 prizeAmount = (amount * PRIZE_SHARE) / BPS_DENOMINATOR;
        uint256 treasuryAmount = (amount * TREASURY_SHARE) / BPS_DENOMINATOR;
        uint256 referralAmount = (amount * REFERRAL_SHARE) / BPS_DENOMINATOR;
        uint256 burnAmount = (amount * BURN_SHARE) / BPS_DENOMINATOR;
        uint256 stakingAmount = amount - prizeAmount - treasuryAmount - referralAmount - burnAmount;

        if (!_safeSend(prizePool, prizeAmount)) {
            _safeSend(treasury, prizeAmount);
        }
        if (!_safeSend(treasury, treasuryAmount)) {
            revert("Treasury transfer failed");
        }
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
            if (!_safeSend(treasury, referralAmount)) {
                revert("Referral fallback failed");
            }
        }

        if (!_safeSend(burnReserve, burnAmount)) {
            _safeSend(treasury, burnAmount);
        }
        if (!_safeSend(stakingRewards, stakingAmount)) {
            _safeSend(treasury, stakingAmount);
        }
        emit ProtocolFeesDistributed(amount, prizeAmount, treasuryAmount, referralAmount, burnAmount, stakingAmount);
    }

    function distributeProtocolFees() public nonReentrant {
        require(block.timestamp >= nextProtocolDistributionAt, "Distribution cooldown");
        uint256 amount = pendingProtocolFeesWei;
        require(amount > 0, "No protocol fees");
        pendingProtocolFeesWei = 0;
        _distributeVoteFees(address(0), amount);
        nextProtocolDistributionAt = block.timestamp + PROTOCOL_DISTRIBUTION_INTERVAL;
    }

    function _finalizeCreatorPayout(
        uint256 eventId,
        uint256 voterCount,
        address creator,
        bool isUserEvent
    ) internal {
        if (!isUserEvent || creatorPayoutFinalized[eventId]) return;
        creatorPayoutFinalized[eventId] = true;

        uint256 pending = creatorPendingByEvent[eventId];
        creatorPendingByEvent[eventId] = 0;
        if (pending == 0) return;

        bool eligible = voterCount >= minCreatorPayoutVotes && creator != address(0) && isVerifiedCreator(creator);
        if (eligible) {
            creatorClaimableWei[creator] += pending;
            emit CreatorRewardsAccrued(eventId, creator, pending);
            return;
        }

        if (!_safeSend(treasury, pending)) {
            revert("Redirect failed");
        }
        emit CreatorRewardsRedirected(
            eventId,
            creator,
            pending,
            voterCount < minCreatorPayoutVotes ? "low-participation" : "creator-not-verified"
        );
    }

    function claimCreatorFees() external nonReentrant {
        uint256 amount = creatorClaimableWei[msg.sender];
        require(amount > 0, "No creator fees");
        creatorClaimableWei[msg.sender] = 0;
        require(_safeSend(msg.sender, amount), "Creator withdraw failed");
        emit CreatorRewardsClaimed(msg.sender, amount);
    }

    function setCreatorEconomics(
        uint256 _userEventVoteFee,
        uint16 _creatorShareBps,
        uint256 _minCreatorPayoutVotes
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_creatorShareBps <= BPS_DENOMINATOR, "Bad creator share");
        require(_minCreatorPayoutVotes > 0 && _minCreatorPayoutVotes <= 10000, "Bad min votes");
        userEventVoteFee = _userEventVoteFee;
        creatorShareBps = _creatorShareBps;
        minCreatorPayoutVotes = _minCreatorPayoutVotes;
        emit FeeConfigUpdated(_userEventVoteFee, _creatorShareBps, _minCreatorPayoutVotes);
    }

    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    function _getVoteMultiplierBps(uint256 amount) internal pure returns (uint256) {
        if (amount == VOTE_BASIC_FEE) return 10000; // 1x
        if (amount == VOTE_PRO_FEE) return 30000;   // 3x
        require(amount >= VOTE_WHALE_MIN_FEE, "Invalid vote fee tier");
        // multiplier = 10 * sqrt(amount / 0.05)
        // return in bps (1x = 10000 bps)
        uint256 ratio1e18 = (amount * 1e18) / VOTE_WHALE_MIN_FEE;
        uint256 sqrtRatio1e9 = _sqrt(ratio1e18); // sqrt(1e18)=1e9
        uint256 multBps = (100000 * sqrtRatio1e9) / 1e9; // 10x at min whale
        if (multBps < 100000) multBps = 100000;
        return multBps;
    }

    function setFeeReceivers(
        address _prizePool,
        address _treasury,
        address _referralContract,
        address _burnReserve,
        address _stakingRewards
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_prizePool != address(0), "Zero prize");
        require(_treasury != address(0), "Zero treasury");
        require(_burnReserve != address(0), "Zero burn");
        require(_stakingRewards != address(0), "Zero staking");
        prizePool = _prizePool;
        treasury = _treasury;
        referralContract = IReferralPrediction(_referralContract);
        burnReserve = _burnReserve;
        stakingRewards = _stakingRewards;
        emit FeeReceiversUpdated(_prizePool, _treasury, _referralContract, _burnReserve, _stakingRewards);
    }

    function getCreatorEventPayoutPreview(uint256 eventId)
        external
        view
        returns (
            uint256 pendingCreatorCut,
            uint256 voterCount,
            bool eligibleNow,
            uint256 requiredVotes
        )
    {
        PredictionEvent memory evt = events[eventId];
        pendingCreatorCut = creatorPendingByEvent[eventId];
        voterCount = eventVoters[eventId].length;
        requiredVotes = minCreatorPayoutVotes;
        eligibleNow = evt.isUserEvent && evt.creator != address(0) && isVerifiedCreator(evt.creator) && voterCount >= minCreatorPayoutVotes;
    }

    function getProtocolDistributionState()
        external
        view
        returns (uint256 pendingAmount, uint256 nextAt, uint256 secondsLeft)
    {
        pendingAmount = pendingProtocolFeesWei;
        nextAt = nextProtocolDistributionAt;
        if (block.timestamp >= nextAt) {
            secondsLeft = 0;
        } else {
            secondsLeft = nextAt - block.timestamp;
        }
    }

    function getEvent(uint256 eventId) external view returns (PredictionEvent memory) {
        return events[eventId];
    }

    function getUserVote(uint256 eventId, address user) external view returns (UserVote memory) {
        return userVotes[eventId][user];
    }

    function getActiveEvents(uint256 limit) external view returns (PredictionEvent[] memory) {
        uint256 count = 0;
        for (uint i = eventCount; i > 0 && count < limit; i--) {
            if (!events[i].resolved && block.timestamp < events[i].deadline) count++;
        }

        PredictionEvent[] memory result = new PredictionEvent[](count);
        uint256 idx = 0;
        for (uint i = eventCount; i > 0 && idx < count; i--) {
            if (!events[i].resolved && block.timestamp < events[i].deadline) {
                result[idx++] = events[i];
            }
        }
        return result;
    }

    receive() external payable {}
}
