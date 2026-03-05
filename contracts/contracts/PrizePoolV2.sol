// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

contract PrizePoolV2 is AccessControl, ReentrancyGuard {
    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");

    struct Epoch {
        bytes32 merkleRoot;
        uint256 totalAllocation;
        uint256 claimed;
        uint256 startedAt;
    }

    uint256 public currentEpoch;
    uint256 public totalDistributed;
    uint256 public reservedFunds;

    mapping(uint256 => Epoch) public epochs;
    mapping(uint256 => mapping(uint256 => uint256)) private claimedBitMap;

    event PrizeReceived(uint256 amount);
    event EpochStarted(uint256 indexed epoch, bytes32 merkleRoot, uint256 totalAllocation);
    event PrizeClaimed(uint256 indexed epoch, uint256 indexed index, address indexed account, uint256 amount);
    event EmergencyWithdraw(address to, uint256 amount);

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    receive() external payable {
        emit PrizeReceived(msg.value);
    }

    function startEpoch(bytes32 merkleRoot, uint256 totalAllocation) external onlyRole(DISTRIBUTOR_ROLE) {
        require(merkleRoot != bytes32(0), "Empty root");
        require(totalAllocation > 0, "Bad allocation");
        require(totalAllocation <= address(this).balance - reservedFunds, "Insufficient free balance");

        currentEpoch += 1;
        epochs[currentEpoch] = Epoch({
            merkleRoot: merkleRoot,
            totalAllocation: totalAllocation,
            claimed: 0,
            startedAt: block.timestamp
        });
        reservedFunds += totalAllocation;

        emit EpochStarted(currentEpoch, merkleRoot, totalAllocation);
    }

    function claim(
        uint256 epoch,
        uint256 index,
        address account,
        uint256 amount,
        bytes32[] calldata merkleProof
    ) external nonReentrant {
        require(account == msg.sender, "Not claimant");
        require(!_isClaimed(epoch, index), "Already claimed");

        Epoch storage e = epochs[epoch];
        require(e.merkleRoot != bytes32(0), "Epoch missing");

        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(index, account, amount))));
        require(MerkleProof.verify(merkleProof, e.merkleRoot, leaf), "Bad proof");

        _setClaimed(epoch, index);
        require(e.claimed + amount <= e.totalAllocation, "Allocation exceeded");
        e.claimed += amount;
        totalDistributed += amount;
        reservedFunds -= amount;

        (bool ok, ) = account.call{value: amount}("");
        require(ok, "Transfer failed");

        emit PrizeClaimed(epoch, index, account, amount);
    }

    function isClaimed(uint256 epoch, uint256 index) external view returns (bool) {
        return _isClaimed(epoch, index);
    }

    function _isClaimed(uint256 epoch, uint256 index) internal view returns (bool) {
        uint256 wordIndex = index / 256;
        uint256 bitIndex = index % 256;
        uint256 word = claimedBitMap[epoch][wordIndex];
        uint256 mask = (1 << bitIndex);
        return word & mask == mask;
    }

    function _setClaimed(uint256 epoch, uint256 index) internal {
        uint256 wordIndex = index / 256;
        uint256 bitIndex = index % 256;
        claimedBitMap[epoch][wordIndex] = claimedBitMap[epoch][wordIndex] | (1 << bitIndex);
    }

    function emergencyWithdraw(address to) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        require(to != address(0), "Zero recipient");
        uint256 freeBalance = address(this).balance - reservedFunds;
        (bool ok, ) = to.call{value: freeBalance}("");
        require(ok, "Transfer failed");
        emit EmergencyWithdraw(to, freeBalance);
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
