// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721EnumerableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title PredictionNFT
 * @notice ERC-721 NFTs minted for prediction streak milestones.
 *         Deployed behind a UUPS proxy so minting rules can evolve.
 *
 * Tier thresholds (consecutive correct predictions):
 *   Bronze  = 3   streak
 *   Silver  = 7   streak
 *   Gold    = 15  streak
 *   Diamond = 30  streak
 */
contract PredictionNFT is
    Initializable,
    ERC721Upgradeable,
    ERC721EnumerableUpgradeable,
    AccessControlUpgradeable,
    UUPSUpgradeable
{
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    enum Tier { BRONZE, SILVER, GOLD, DIAMOND }

    struct NFTMeta {
        Tier tier;
        uint256 streak;       // streak length at mint
        uint256 mintedAt;     // block.timestamp
        uint256 eventId;      // last event id in the streak
    }

    uint256 public nextTokenId;
    string  public baseURI;

    // tokenId => metadata
    mapping(uint256 => NFTMeta) public tokenMeta;

    // address => tier => already minted (one per tier per address)
    mapping(address => mapping(Tier => bool)) public hasTierNFT;

    // streak thresholds
    uint256 public constant BRONZE_STREAK  = 3;
    uint256 public constant SILVER_STREAK  = 7;
    uint256 public constant GOLD_STREAK    = 15;
    uint256 public constant DIAMOND_STREAK = 30;

    event StreakNFTMinted(
        address indexed to,
        uint256 indexed tokenId,
        Tier tier,
        uint256 streak,
        uint256 eventId
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(string memory name_, string memory symbol_, string memory baseURI_)
        public
        initializer
    {
        __ERC721_init(name_, symbol_);
        __AccessControl_init();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);

        baseURI = baseURI_;
        nextTokenId = 1;
    }

    // ─── Minting ────────────────────────────────────────────────────

    /**
     * @notice Mint a streak NFT if the user qualifies for a new tier.
     *         Called by the backend OPERATOR after resolving predictions.
     * @param to      Recipient address
     * @param streak  Current consecutive-correct count
     * @param eventId The event that completed this streak milestone
     */
    function mintStreakNFT(address to, uint256 streak, uint256 eventId)
        external
        onlyRole(MINTER_ROLE)
        returns (uint256 tokenId)
    {
        Tier tier = _streakToTier(streak);
        require(!hasTierNFT[to][tier], "Already minted this tier");

        tokenId = nextTokenId++;
        _safeMint(to, tokenId);

        tokenMeta[tokenId] = NFTMeta({
            tier: tier,
            streak: streak,
            mintedAt: block.timestamp,
            eventId: eventId
        });

        hasTierNFT[to][tier] = true;

        emit StreakNFTMinted(to, tokenId, tier, streak, eventId);
    }

    /**
     * @notice Check whether a user qualifies for a new streak NFT.
     */
    function qualifiesForMint(address user, uint256 streak) external view returns (bool) {
        if (streak < BRONZE_STREAK) return false;
        Tier tier = _streakToTier(streak);
        return !hasTierNFT[user][tier];
    }

    // ─── View helpers ───────────────────────────────────────────────

    function getTierName(Tier tier) public pure returns (string memory) {
        if (tier == Tier.DIAMOND) return "Diamond";
        if (tier == Tier.GOLD)    return "Gold";
        if (tier == Tier.SILVER)  return "Silver";
        return "Bronze";
    }

    function getTokenMeta(uint256 tokenId) external view returns (NFTMeta memory) {
        return tokenMeta[tokenId];
    }

    function getUserNFTs(address user) external view returns (uint256[] memory) {
        uint256 balance = balanceOf(user);
        uint256[] memory ids = new uint256[](balance);
        for (uint256 i = 0; i < balance; i++) {
            ids[i] = tokenOfOwnerByIndex(user, i);
        }
        return ids;
    }

    // ─── Admin ──────────────────────────────────────────────────────

    function setBaseURI(string memory newBaseURI) external onlyRole(DEFAULT_ADMIN_ROLE) {
        baseURI = newBaseURI;
    }

    // ─── Internal ───────────────────────────────────────────────────

    function _streakToTier(uint256 streak) internal pure returns (Tier) {
        if (streak >= DIAMOND_STREAK) return Tier.DIAMOND;
        if (streak >= GOLD_STREAK)    return Tier.GOLD;
        if (streak >= SILVER_STREAK)  return Tier.SILVER;
        return Tier.BRONZE;
    }

    function _baseURI() internal view override returns (string memory) {
        return baseURI;
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    // ─── Required overrides ─────────────────────────────────────────

    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721Upgradeable, ERC721EnumerableUpgradeable)
        returns (address)
    {
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 value)
        internal
        override(ERC721Upgradeable, ERC721EnumerableUpgradeable)
    {
        super._increaseBalance(account, value);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721Upgradeable, ERC721EnumerableUpgradeable, AccessControlUpgradeable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
