// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract OAIToken is ERC20, ERC20Burnable, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    uint256 public constant MAX_SUPPLY = 1_000_000_000 ether;

    // ─── Token Allocation (1B OAI) ──────────────────────────────────
    //  40%  Community Airdrop    — 400M — minted via mintAirdrop() based on points
    //  15%  Liquidity            — 150M — DEX pairs, locked 2 years
    //  12%  Team & Advisors      — 120M — 2-year linear vest, 6-month cliff
    //  10%  Treasury (DAO)       — 100M — governance-controlled
    //  10%  Staking Rewards      — 100M — distributed over 4 years to stakers
    //   5%  Prize Pool (OAI)     —  50M — weekly OAI prizes post-TGE
    //   3%  Referral Rewards     —  30M — OAI bonuses for top referrers
    //   3%  Marketing            —  30M — partnerships, 1-year vest
    //   2%  Ecosystem Fund       —  20M — grants, hackathons

    uint256 public constant LIQUIDITY_ALLOC     = 150_000_000 ether;
    uint256 public constant TEAM_ALLOC          = 120_000_000 ether;
    uint256 public constant TREASURY_ALLOC      = 100_000_000 ether;
    uint256 public constant STAKING_ALLOC       = 100_000_000 ether;
    uint256 public constant PRIZE_ALLOC         =  50_000_000 ether;
    uint256 public constant REFERRAL_ALLOC      =  30_000_000 ether;
    uint256 public constant MARKETING_ALLOC     =  30_000_000 ether;
    uint256 public constant ECOSYSTEM_ALLOC     =  20_000_000 ether;
    // Community airdrop (400M) stays unminted, distributed via mintAirdrop

    uint256 public constant INITIAL_MINT = LIQUIDITY_ALLOC + TEAM_ALLOC + TREASURY_ALLOC
        + STAKING_ALLOC + PRIZE_ALLOC + REFERRAL_ALLOC + MARKETING_ALLOC + ECOSYSTEM_ALLOC; // 600M

    uint256 public totalBurned;

    event TokensBurned(address indexed burner, uint256 amount);

    constructor() ERC20("OracleAI", "OAI") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        _mint(msg.sender, INITIAL_MINT);
    }

    function mintAirdrop(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        require(totalSupply() + amount <= MAX_SUPPLY, "Exceeds max supply");
        _mint(to, amount);
    }

    function burnTokens(uint256 amount) external {
        _burn(msg.sender, amount);
        totalBurned += amount;
        emit TokensBurned(msg.sender, amount);
    }
}
