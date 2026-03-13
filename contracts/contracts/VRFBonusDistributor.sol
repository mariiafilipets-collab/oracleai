// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title VRFBonusDistributor
 * @notice Random bonus distribution using Chainlink VRF v2.5 on BSC.
 *
 * Use cases:
 * - Daily lucky check-in bonus (random multiplier 2x-10x)
 * - Weekly lottery among active voters
 * - Random rare NFT drops for streak holders
 *
 * Chainlink VRF v2.5 BSC Testnet:
 *   Coordinator: 0x6A2AAd07396B36Fe02a22b33cf443582f682c82f
 *   Key Hash: 0xd4bb89654db74673a187bd804519e65e3f71a52bc55f11da7601a13b...
 *   See: https://docs.chain.link/vrf/v2-5/supported-networks
 *
 * NOTE: This contract defines the Chainlink VRF interface inline to avoid
 * importing the full @chainlink/contracts package. For production, install
 * @chainlink/contracts and use VRFConsumerBaseV2Plus.
 */

/// @dev Minimal Chainlink VRF v2.5 coordinator interface
interface IVRFCoordinatorV2Plus {
    function requestRandomWords(
        bytes32 keyHash,
        uint64 subId,
        uint16 requestConfirmations,
        uint32 callbackGasLimit,
        uint32 numWords
    ) external returns (uint256 requestId);
}

contract VRFBonusDistributor is AccessControl, ReentrancyGuard {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    IVRFCoordinatorV2Plus public vrfCoordinator;
    bytes32 public keyHash;
    uint64  public subscriptionId;
    uint16  public requestConfirmations = 3;
    uint32  public callbackGasLimit = 200_000;

    enum BonusType { LUCKY_CHECKIN, WEEKLY_LOTTERY, RARE_DROP }

    struct BonusRequest {
        uint256 requestId;
        BonusType bonusType;
        address beneficiary;
        uint256 baseAmount;   // base points or BNB amount
        bool fulfilled;
        uint256 randomWord;
        uint256 bonusResult;  // computed multiplier or winner index
    }

    uint256 public requestCount;
    mapping(uint256 => BonusRequest) public requests;       // requestId => BonusRequest
    mapping(uint256 => uint256) private _requestIdToIndex;  // VRF requestId => our index

    // Lucky check-in: multiplier range (2x to 10x in bps: 20000 to 100000)
    uint256 public constant MIN_LUCKY_MULT = 20000;  // 2x
    uint256 public constant MAX_LUCKY_MULT = 100000; // 10x

    // Weekly lottery pool
    address[] public lotteryParticipants;
    uint256 public lotteryPrize;

    event BonusRequested(uint256 indexed index, uint256 vrfRequestId, BonusType bonusType, address beneficiary);
    event BonusFulfilled(uint256 indexed index, uint256 randomWord, uint256 bonusResult);
    event LotteryEntered(address indexed participant);
    event LotteryReset(uint256 participants, uint256 prize);

    constructor(
        address _vrfCoordinator,
        bytes32 _keyHash,
        uint64 _subscriptionId
    ) {
        require(_vrfCoordinator != address(0), "Zero coordinator");
        vrfCoordinator = IVRFCoordinatorV2Plus(_vrfCoordinator);
        keyHash = _keyHash;
        subscriptionId = _subscriptionId;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, msg.sender);
    }

    // ─── Request Randomness ─────────────────────────────────────

    function requestLuckyCheckinBonus(address user, uint256 basePoints)
        external
        onlyRole(OPERATOR_ROLE)
        returns (uint256)
    {
        return _requestBonus(BonusType.LUCKY_CHECKIN, user, basePoints);
    }

    function requestWeeklyLottery()
        external
        onlyRole(OPERATOR_ROLE)
        returns (uint256)
    {
        require(lotteryParticipants.length > 0, "No participants");
        return _requestBonus(BonusType.WEEKLY_LOTTERY, address(0), lotteryPrize);
    }

    function requestRareDrop(address user)
        external
        onlyRole(OPERATOR_ROLE)
        returns (uint256)
    {
        return _requestBonus(BonusType.RARE_DROP, user, 0);
    }

    function _requestBonus(BonusType bonusType, address beneficiary, uint256 baseAmount)
        internal
        returns (uint256 index)
    {
        uint256 vrfRequestId = vrfCoordinator.requestRandomWords(
            keyHash,
            subscriptionId,
            requestConfirmations,
            callbackGasLimit,
            1 // one random word
        );

        requestCount++;
        index = requestCount;

        requests[index] = BonusRequest({
            requestId: vrfRequestId,
            bonusType: bonusType,
            beneficiary: beneficiary,
            baseAmount: baseAmount,
            fulfilled: false,
            randomWord: 0,
            bonusResult: 0
        });

        _requestIdToIndex[vrfRequestId] = index;

        emit BonusRequested(index, vrfRequestId, bonusType, beneficiary);
    }

    // ─── VRF Callback ───────────────────────────────────────────

    /**
     * @notice Called by the VRF Coordinator with the random result.
     * @dev In production, inherit VRFConsumerBaseV2Plus for proper validation.
     *      Here we validate that msg.sender is the coordinator.
     */
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords)
        external
    {
        require(msg.sender == address(vrfCoordinator), "Only coordinator");
        require(randomWords.length > 0, "No random words");

        uint256 index = _requestIdToIndex[requestId];
        require(index != 0, "Unknown request");

        BonusRequest storage req = requests[index];
        require(!req.fulfilled, "Already fulfilled");

        req.fulfilled = true;
        req.randomWord = randomWords[0];

        if (req.bonusType == BonusType.LUCKY_CHECKIN) {
            // Random multiplier between 2x and 10x
            uint256 range = MAX_LUCKY_MULT - MIN_LUCKY_MULT;
            req.bonusResult = MIN_LUCKY_MULT + (randomWords[0] % (range + 1));
        } else if (req.bonusType == BonusType.WEEKLY_LOTTERY) {
            // Pick winner index from participants
            if (lotteryParticipants.length > 0) {
                req.bonusResult = randomWords[0] % lotteryParticipants.length;
                req.beneficiary = lotteryParticipants[req.bonusResult];
            }
        } else if (req.bonusType == BonusType.RARE_DROP) {
            // Rarity roll: 0-9999 (0.01% precision)
            req.bonusResult = randomWords[0] % 10000;
        }

        emit BonusFulfilled(index, randomWords[0], req.bonusResult);
    }

    // ─── Lottery Management ─────────────────────────────────────

    function enterLottery(address participant) external onlyRole(OPERATOR_ROLE) {
        lotteryParticipants.push(participant);
        emit LotteryEntered(participant);
    }

    function fundLottery() external payable {
        require(msg.value > 0, "Zero funding");
        lotteryPrize += msg.value;
    }

    function resetLottery() external onlyRole(OPERATOR_ROLE) {
        emit LotteryReset(lotteryParticipants.length, lotteryPrize);
        delete lotteryParticipants;
        lotteryPrize = 0;
    }

    function getLotteryParticipantCount() external view returns (uint256) {
        return lotteryParticipants.length;
    }

    // ─── Payout ─────────────────────────────────────────────────

    function payoutLotteryWinner(uint256 index) external onlyRole(OPERATOR_ROLE) nonReentrant {
        BonusRequest memory req = requests[index];
        require(req.fulfilled, "Not fulfilled");
        require(req.bonusType == BonusType.WEEKLY_LOTTERY, "Not lottery");
        require(req.beneficiary != address(0), "No winner");
        require(lotteryPrize > 0, "No prize");

        uint256 prize = lotteryPrize;
        lotteryPrize = 0;

        (bool ok, ) = payable(req.beneficiary).call{value: prize}("");
        require(ok, "Payout failed");
    }

    // ─── View ───────────────────────────────────────────────────

    function getRequest(uint256 index) external view returns (BonusRequest memory) {
        return requests[index];
    }

    // ─── Admin ──────────────────────────────────────────────────

    function setVRFConfig(
        bytes32 _keyHash,
        uint64 _subscriptionId,
        uint16 _requestConfirmations,
        uint32 _callbackGasLimit
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        keyHash = _keyHash;
        subscriptionId = _subscriptionId;
        requestConfirmations = _requestConfirmations;
        callbackGasLimit = _callbackGasLimit;
    }

    receive() external payable {}
}
