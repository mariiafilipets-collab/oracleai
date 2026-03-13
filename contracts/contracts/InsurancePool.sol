// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title InsurancePool
 * @notice Protection fund for users affected by incorrect event resolutions.
 *
 * Flow:
 * 1. Pool is funded from a portion of platform fees or direct deposits.
 * 2. Users can file claims against specific event IDs with evidence.
 * 3. Arbiters (ARBITER_ROLE) approve or deny claims.
 * 4. Approved claims pay out from the pool balance.
 *
 * Caps: max payout per claim = 10% of pool balance.
 * Cooldown: 24h between claims per user.
 */
contract InsurancePool is AccessControl, ReentrancyGuard {
    bytes32 public constant ARBITER_ROLE = keccak256("ARBITER_ROLE");

    enum ClaimStatus { Pending, Approved, Denied, Paid }

    struct Claim {
        uint256 id;
        address claimant;
        uint256 eventId;
        uint256 amount;         // requested amount
        uint256 approvedAmount; // amount approved by arbiter
        string reason;
        ClaimStatus status;
        uint256 filedAt;
        uint256 resolvedAt;
    }

    uint256 public claimCount;
    uint256 public totalPaidOut;
    uint256 public maxPayoutBps = 1000; // 10% of pool balance per claim
    uint256 public claimCooldown = 1 days;

    mapping(uint256 => Claim) public claims;
    mapping(address => uint256) public lastClaimAt;
    mapping(address => uint256[]) public userClaims;
    // eventId => total claims filed
    mapping(uint256 => uint256) public eventClaimCount;

    event PoolFunded(address indexed funder, uint256 amount);
    event ClaimFiled(uint256 indexed claimId, address indexed claimant, uint256 eventId, uint256 amount);
    event ClaimApproved(uint256 indexed claimId, uint256 approvedAmount);
    event ClaimDenied(uint256 indexed claimId);
    event ClaimPaid(uint256 indexed claimId, address indexed claimant, uint256 amount);
    event MaxPayoutUpdated(uint256 oldBps, uint256 newBps);

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ARBITER_ROLE, msg.sender);
    }

    // ─── Funding ────────────────────────────────────────────────

    receive() external payable {
        emit PoolFunded(msg.sender, msg.value);
    }

    function fund() external payable {
        require(msg.value > 0, "Zero deposit");
        emit PoolFunded(msg.sender, msg.value);
    }

    // ─── File Claim ─────────────────────────────────────────────

    function fileClaim(uint256 eventId, uint256 requestedAmount, string calldata reason)
        external
        returns (uint256)
    {
        require(requestedAmount > 0, "Zero amount");
        require(bytes(reason).length > 10 && bytes(reason).length <= 500, "Invalid reason");
        require(
            block.timestamp >= lastClaimAt[msg.sender] + claimCooldown,
            "Claim cooldown active"
        );

        uint256 maxPayout = (address(this).balance * maxPayoutBps) / 10000;
        require(requestedAmount <= maxPayout, "Exceeds max payout");

        claimCount++;
        claims[claimCount] = Claim({
            id: claimCount,
            claimant: msg.sender,
            eventId: eventId,
            amount: requestedAmount,
            approvedAmount: 0,
            reason: reason,
            status: ClaimStatus.Pending,
            filedAt: block.timestamp,
            resolvedAt: 0
        });

        lastClaimAt[msg.sender] = block.timestamp;
        userClaims[msg.sender].push(claimCount);
        eventClaimCount[eventId]++;

        emit ClaimFiled(claimCount, msg.sender, eventId, requestedAmount);
        return claimCount;
    }

    // ─── Arbiter Actions ────────────────────────────────────────

    function approveClaim(uint256 claimId, uint256 approvedAmount)
        external
        onlyRole(ARBITER_ROLE)
    {
        Claim storage c = claims[claimId];
        require(c.id != 0, "Claim not found");
        require(c.status == ClaimStatus.Pending, "Not pending");
        require(approvedAmount > 0 && approvedAmount <= c.amount, "Invalid amount");

        uint256 maxPayout = (address(this).balance * maxPayoutBps) / 10000;
        require(approvedAmount <= maxPayout, "Exceeds pool cap");

        c.approvedAmount = approvedAmount;
        c.status = ClaimStatus.Approved;
        c.resolvedAt = block.timestamp;

        emit ClaimApproved(claimId, approvedAmount);
    }

    function denyClaim(uint256 claimId) external onlyRole(ARBITER_ROLE) {
        Claim storage c = claims[claimId];
        require(c.id != 0, "Claim not found");
        require(c.status == ClaimStatus.Pending, "Not pending");

        c.status = ClaimStatus.Denied;
        c.resolvedAt = block.timestamp;

        emit ClaimDenied(claimId);
    }

    // ─── Claim Payout ───────────────────────────────────────────

    function claimPayout(uint256 claimId) external nonReentrant {
        Claim storage c = claims[claimId];
        require(c.id != 0, "Claim not found");
        require(c.status == ClaimStatus.Approved, "Not approved");
        require(msg.sender == c.claimant, "Not claimant");
        require(address(this).balance >= c.approvedAmount, "Insufficient pool balance");

        c.status = ClaimStatus.Paid;
        totalPaidOut += c.approvedAmount;

        (bool ok, ) = payable(c.claimant).call{value: c.approvedAmount}("");
        require(ok, "Transfer failed");

        emit ClaimPaid(claimId, c.claimant, c.approvedAmount);
    }

    // ─── View ───────────────────────────────────────────────────

    function getClaim(uint256 claimId) external view returns (Claim memory) {
        return claims[claimId];
    }

    function getUserClaims(address user) external view returns (uint256[] memory) {
        return userClaims[user];
    }

    function getPoolBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function getPoolStats()
        external
        view
        returns (uint256 balance, uint256 totalClaims, uint256 paid, uint256 maxSinglePayout)
    {
        balance = address(this).balance;
        totalClaims = claimCount;
        paid = totalPaidOut;
        maxSinglePayout = (balance * maxPayoutBps) / 10000;
    }

    // ─── Admin ──────────────────────────────────────────────────

    function setMaxPayout(uint256 newBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newBps > 0 && newBps <= 5000, "Invalid max payout"); // 0.01% to 50%
        uint256 oldBps = maxPayoutBps;
        maxPayoutBps = newBps;
        emit MaxPayoutUpdated(oldBps, newBps);
    }

    function setClaimCooldown(uint256 seconds_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(seconds_ <= 7 days, "Too long");
        claimCooldown = seconds_;
    }

    function emergencyWithdraw(address to) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        require(to != address(0), "Zero address");
        uint256 bal = address(this).balance;
        require(bal > 0, "Empty pool");
        (bool ok, ) = payable(to).call{value: bal}("");
        require(ok, "Transfer failed");
    }
}
