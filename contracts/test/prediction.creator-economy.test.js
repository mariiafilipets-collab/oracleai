const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Prediction creator economy", function () {
  async function deployFixture() {
    const [owner, creator, voter1, voter2, burnReserve, stakingRewards, treasury] = await ethers.getSigners();

    const Points = await ethers.getContractFactory("Points");
    const points = await Points.deploy();
    await points.waitForDeployment();

    const PrizePool = await ethers.getContractFactory("PrizePool");
    const prizePool = await PrizePool.deploy();
    await prizePool.waitForDeployment();

    const Referral = await ethers.getContractFactory("Referral");
    const referral = await Referral.deploy();
    await referral.waitForDeployment();

    const Prediction = await ethers.getContractFactory("Prediction");
    const prediction = await Prediction.deploy(
      await points.getAddress(),
      treasury.address,
      await prizePool.getAddress(),
      await referral.getAddress(),
      burnReserve.address,
      stakingRewards.address
    );
    await prediction.waitForDeployment();

    const OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));
    await points.grantRole(OPERATOR_ROLE, owner.address);
    await points.grantRole(OPERATOR_ROLE, await prediction.getAddress());
    await referral.grantRole(OPERATOR_ROLE, await prediction.getAddress());

    // Mark check-in for creator and voters in current day.
    await points.addPoints(creator.address, 1, 1);
    await points.addPoints(voter1.address, 1, 1);
    await points.addPoints(voter2.address, 1, 1);

    return { owner, creator, voter1, voter2, burnReserve, stakingRewards, treasury, points, prizePool, referral, prediction };
  }

  it("requires vote fee on user events and blocks creator self-vote", async function () {
    const { creator, voter1, prediction } = await deployFixture();

    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const createTx = await prediction.connect(creator).createUserEvent(
      "Will BTC close above 90000 today?",
      3,
      now + 3600,
      "official",
      { value: ethers.parseEther("0.0015") }
    );
    await createTx.wait();

    const voteFee = await prediction.userEventVoteFee();

    await expect(
      prediction.connect(voter1).submitPrediction(1, true)
    ).to.be.revertedWith("Invalid vote fee");

    await expect(
      prediction.connect(creator).submitPrediction(1, true, { value: voteFee })
    ).to.be.revertedWith("Creator cannot vote own event");
  });

  it("accrues claimable creator rewards after valid resolution", async function () {
    const { creator, voter1, voter2, points, prediction } = await deployFixture();

    // Make creator verified for payout eligibility.
    await points.addPoints(creator.address, 6000, 1);
    await prediction.setCreatorEconomics(ethers.parseEther("0.0002"), 5000, 2);

    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await prediction.connect(creator).createUserEvent(
      "Will ETH stay above 3000 today?",
      3,
      now + 3600,
      "official",
      { value: ethers.parseEther("0.0015") }
    );

    const voteFee = await prediction.userEventVoteFee();
    await prediction.connect(voter1).submitPrediction(1, true, { value: voteFee });
    await prediction.connect(voter2).submitPrediction(1, false, { value: voteFee });

    // Move to deadline and resolve.
    await ethers.provider.send("evm_increaseTime", [3700]);
    await ethers.provider.send("evm_mine");
    await prediction.resolveEvent(1, true);

    const expectedCreatorClaimable = voteFee; // 2 votes * 50%
    expect(await prediction.creatorClaimableWei(creator.address)).to.equal(expectedCreatorClaimable);

    const balBefore = await ethers.provider.getBalance(creator.address);
    const tx = await prediction.connect(creator).claimCreatorFees();
    const rc = await tx.wait();
    const gas = rc.gasUsed * rc.gasPrice;
    const balAfter = await ethers.provider.getBalance(creator.address);
    expect(balAfter + gas).to.equal(balBefore + expectedCreatorClaimable);
    expect(await prediction.creatorClaimableWei(creator.address)).to.equal(0n);
  });

  it("distributes protocol-side fees in 12h batches", async function () {
    const { creator, voter1, points, prediction } = await deployFixture();
    await points.addPoints(creator.address, 6000, 1);
    await prediction.setCreatorEconomics(ethers.parseEther("0.0002"), 5000, 2);

    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await prediction.connect(creator).createUserEvent(
      "Will SOL be above 120 today?",
      3,
      now + 3600,
      "official",
      { value: ethers.parseEther("0.0015") }
    );

    const voteFee = await prediction.userEventVoteFee();
    await prediction.connect(voter1).submitPrediction(1, true, { value: voteFee });

    const pending = await prediction.pendingProtocolFeesWei();
    expect(pending).to.equal(voteFee / 2n);

    await expect(prediction.distributeProtocolFees()).to.be.revertedWith("Distribution cooldown");

    await ethers.provider.send("evm_increaseTime", [12 * 60 * 60 + 5]);
    await ethers.provider.send("evm_mine");
    await prediction.distributeProtocolFees();
    expect(await prediction.pendingProtocolFeesWei()).to.equal(0n);
  });
});

