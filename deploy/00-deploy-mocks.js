const { developmentChains } = require("../helper-hardhat-config")

const BASE_FEE = ethers.utils.parseEther("0.25") //0.25 is the premium. It costs 0.25 LINK per request
const GAS_PRICE_LINK = 1e9 //link per gas. calculated value based on the gas price of the chain

module.exports = async function ({ getNamedAccounts, deployments }) {
    const { deploy, log } = deployments
    const { deployer } = await getNamedAccounts()
    const args = [BASE_FEE, GAS_PRICE_LINK]

    if (developmentChains.includes(network.name)) {
        log("On a local network. Deploying mocks...")
        //deploy a mock vrfcoordinator
        //takes in 2 parameter basefee and gasPriceLink
        await deploy("VRFCoordinatorV2Mock", {
            from: deployer,
            args: args,
            log: true,
        })
        log("Mock Deployed")
        log("-------------------------------------")
    }
}
module.exports.tags = ["all", "mocks"]
