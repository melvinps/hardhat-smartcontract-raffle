const { assert, expect } = require("chai")
const { getNamedAccounts, deployments, ethers, network } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Raffle Unit Tests", function () {
          let deployer, raffle, vrfCoordinatorV2Mock, raffleEntranceFee, interval
          const { chainId } = network.config

          beforeEach(async function () {
              deployer = (await getNamedAccounts()).deployer
              await deployments.fixture(["all"])

              raffle = await ethers.getContract("Raffle", deployer)
              raffleEntranceFee = await raffle.getEntranceFee()
              interval = await raffle.getInterval()

              vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer)
          })

          describe("constractor", function () {
              it("Initialize the raffle correctly", async () => {
                  // Ideally we make our tests have just 1 assert per 'it'
                  const raffleState = await raffle.getRaffleState()

                  assert.equal(raffleState.toString(), "0") //OPEN = 0 , CALCULATING =1
                  assert.equal(interval.toString(), networkConfig[chainId].interval)
              })
          })

          describe("enterRaffle", function () {
              it("Revert when you don't pay enough ETH", async function () {
                  await expect(raffle.enterRaffle()).to.be.revertedWith(
                      "Raffle__NotEnoughETHEntered"
                  )
              })

              it("Records players when they enter", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  const playerFromContract = await raffle.getPlayer(0)
                  assert.equal(playerFromContract, deployer)
              })

              it("Emits event on enter", async function () {
                  await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.emit(
                      raffle,
                      "RaffleEnter"
                  )
              })

              it("doesn't allow entrance to raffle when it is calculating", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  await raffle.performUpkeep([]) //change raffleState to calculating
                  await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.be.revertedWith(
                      "Raffle__NotOpen"
                  )
              })
          })

          describe("checkUpkeep", function () {
              it("Returns false if people haven't sent any ETH", async function () {
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", []) // mine one block
                  //checkUpkeep is a public function
                  //rather than executing the state-change of the transcation,
                  //pretend that a call is not state changing and return the result using callStatic
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([])
                  assert(!upkeepNeeded)
              })

              it("Returns false if raffle isn't open", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", []) // mine one block
                  await raffle.performUpkeep("0x") // equivalent to raffle.performUpkeep([])

                  const raffleState = await raffle.getRaffleState()
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([])

                  assert.equal(raffleState.toString(), "1")
                  assert.equal(upkeepNeeded, false)
              })

              it("Returns false if enough time hasn't passed", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() - 1])
                  await network.provider.request({ method: "evm_mine", params: [] }) //equivalent to network.provider.send("evm_mine", [])
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x")
                  assert(!upkeepNeeded)
              })

              it("Returns true if enough time has passed, has players, eth, and is open", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x")
                  assert(upkeepNeeded)
              })
          })

          describe("performUpkeep", () => {
              it("Can only run if `upkeepNeeded` is true", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })

                  const tx = await raffle.performUpkeep([])
                  assert(tx)
              })

              it("reverts if checkup is false", async function () {
                  await expect(raffle.performUpkeep("0x")).to.be.revertedWith(
                      "Raffle__UpkeepNotNeeded"
                  )
              })

              it("Updates raffle state, emit an event, and calls VRF coordinator", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })

                  const txResponse = await raffle.performUpkeep([])
                  const txReceipt = await txResponse.wait(1)
                  const raffleState = await raffle.getRaffleState() // updates state
                  //requestRandomWords function will first emits the RandomWordsRequested event
                  //thus the RequestedRaffleWinner event is the 2nd event emitted -> event[1]
                  const { requestId } = txReceipt.events[1].args
                  assert(requestId.toNumber() > 0)
                  assert(raffleState.toString() == "1") // 0 = open, 1 = calculating
              })
          })

          describe("fulfillRandomWords", function () {
              beforeEach(async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
              })

              it("Can only be called after `performUpkeep`", async function () {
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(0, raffle.address)
                  ).to.be.revertedWith("nonexistent request")

                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(1, raffle.address)
                  ).to.be.revertedWith("nonexistent request")
              })

              it("Picks a winner, reset lottery, and sends the money", async function () {
                  const additionalEntrants = 3
                  const startingAccountIndex = 1 // deployer = 0
                  const accounts = await ethers.getSigners()

                  for (let i = 0; i < startingAccountIndex + additionalEntrants; i++) {
                      const accountConnectedRaffle = raffle.connect(accounts[i])
                      await accountConnectedRaffle.enterRaffle({
                          value: raffleEntranceFee,
                      })
                  }

                  const startingTimestamp = await raffle.getLatestTimestamp()

                  await new Promise(async (resolve, reject) => {
                      raffle.once("WinnerPicked", async () => {
                          console.log(">>>>>> WinnerPicked event fired!")

                          try {
                              const recentWinner = await raffle.getRecentWinner()
                              console.log(">>>>>> Winner is: ", recentWinner)
                              console.log(">>>>>> accounts[0]", accounts[0].address)
                              console.log(">>>>>> accounts[1]", accounts[1].address)
                              console.log(">>>>>> accounts[2]", accounts[2].address)
                              console.log(">>>>>> accounts[3]", accounts[3].address)

                              const raffleState = await raffle.getRaffleState()
                              const endingTimestamp = await raffle.getLatestTimestamp()
                              const numOfPlayers = await raffle.getNumOfPlayers()

                              assert.equal(numOfPlayers.toString(), "0")
                              assert.equal(raffleState.toString(), "0")
                              assert(endingTimestamp > startingTimestamp)

                              const winnerEndingBalance = await accounts[0].getBalance()

                              assert(
                                  winnerEndingBalance.toString(),
                                  winnerStartingBalance
                                      // entrance fee for other players
                                      .add(raffleEntranceFee.mul(additionalEntrants))
                                      // entrance fee for winning player
                                      .add(raffleEntranceFee)
                                      .toString()
                              )

                              resolve()
                          } catch (error) {
                              reject(error)
                          }
                      })

                      const tx = await raffle.performUpkeep([])
                      const txReceipt = await tx.wait(1)

                      const winnerStartingBalance = await accounts[0].getBalance()

                      await vrfCoordinatorV2Mock.fulfillRandomWords(
                          txReceipt.events[1].args.requestId,
                          raffle.address
                      )
                  })
              })
          })
      })
