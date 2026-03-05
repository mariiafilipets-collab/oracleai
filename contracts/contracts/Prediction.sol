// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";

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

contract Prediction is AccessControl {
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
    address public treasury;
    uint256 public eventCount;

    uint256 public constant CORRECT_BONUS = 50;
    uint256 public constant BEAT_AI_BONUS = 100;
    uint256 public constant DAY = 86400;
    uint256 public constant USER_EVENT_FEE = 0.0015 ether;
    uint256 public constant USER_EVENT_COOLDOWN = DAY;
    uint256 public constant VERIFIED_CREATOR_COOLDOWN = DAY / 3;
    uint256 public constant VERIFIED_MIN_POINTS = 5000;
    uint256 public constant MAX_TITLE_LENGTH = 180;
    uint256 public constant MAX_SOURCE_POLICY_LENGTH = 120;
    uint256 public constant MAX_RESOLVE_BATCH = 300;

    mapping(uint256 => PredictionEvent) public events;
    mapping(uint256 => mapping(address => UserVote)) public userVotes;
    mapping(uint256 => address[]) public eventVoters;
    mapping(address => uint256) public nextUserEventAt;
    mapping(uint256 => bool) public resolveInProgress;
    mapping(uint256 => uint256) public resolveCursor;
    mapping(uint256 => uint256) public resolvedWinners;
    mapping(uint256 => bool) private _pendingOutcome;
    mapping(uint256 => bool) private _pendingAiWasRight;

    event EventCreated(uint256 indexed id, string title, Category category, uint256 deadline);
    event UserEventCreated(uint256 indexed id, address indexed creator, uint256 feePaid, uint256 nextAllowedAt);
    event VoteSubmitted(uint256 indexed eventId, address indexed user, bool prediction);
    event EventResolutionStarted(uint256 indexed id, bool outcome, uint256 voters);
    event EventResolutionProgress(uint256 indexed id, uint256 from, uint256 to, uint256 total);
    event EventResolved(uint256 indexed id, bool outcome, uint256 winnersCount);

    constructor(address _points, address _treasury) {
        require(_treasury != address(0), "Zero treasury");
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, msg.sender);
        pointsContract = IPoints(_points);
        treasury = _treasury;
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
    ) external payable returns (uint256) {
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

    function submitPrediction(uint256 eventId, bool _prediction) external {
        PredictionEvent storage evt = events[eventId];
        require(evt.id != 0, "Event not found");
        require(!evt.resolved, "Already resolved");
        require(!resolveInProgress[eventId], "Resolving in progress");
        require(block.timestamp < evt.deadline, "Past deadline");
        require(!userVotes[eventId][msg.sender].voted, "Already voted");
        (, , , uint256 lastCheckIn, , , ) = pointsContract.users(msg.sender);
        require(lastCheckIn / DAY == block.timestamp / DAY, "Check-in required today");

        userVotes[eventId][msg.sender] = UserVote(true, _prediction);
        eventVoters[eventId].push(msg.sender);

        if (_prediction) evt.totalVotesYes++;
        else evt.totalVotesNo++;

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
                uint256 bonus = CORRECT_BONUS;
                if (!_pendingAiWasRight[eventId]) bonus += BEAT_AI_BONUS;
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
            delete _pendingOutcome[eventId];
            delete _pendingAiWasRight[eventId];
            emit EventResolved(eventId, evt.outcome, resolvedWinners[eventId]);
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
}
