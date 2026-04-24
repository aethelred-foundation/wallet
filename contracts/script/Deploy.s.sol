// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {AgentBudget} from "../src/AgentBudget.sol";
import {Notary} from "../src/Notary.sol";

/// @title Deploy — CREATE2 deterministic deployment of AgentBudget + Notary.
///
/// @notice Uses a hard-coded salt (keccak256("AETHELRED_V1")) so the same
///         address is produced on every EVM chain via CREATE2. After the
///         first mainnet broadcast, the resulting addresses are pinned
///         into `deployments.json` and consumed by the TS packages.
///
/// Usage:
///     DEPLOYER_PRIVATE_KEY=0x... \
///     forge script script/Deploy.s.sol:Deploy \
///       --rpc-url base_sepolia --broadcast --verify
///
/// The predicted addresses are printed before broadcast so the
/// operator can cross-check them against the expected value.
contract Deploy is Script {
    bytes32 internal constant SALT = keccak256("AETHELRED_V1");

    /// @dev CREATE2 deployer — the standard keyless deployer at
    /// 0x4e59b44847b379578588920cA78FbF26c0B4956C, available on
    /// every major EVM chain.
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    function run() external returns (address agentBudget, address notary) {
        // Predict addresses before broadcasting so the operator sees
        // what would be deployed and can compare against pinned
        // deployments.json.
        agentBudget = _predictAddress(type(AgentBudget).creationCode);
        notary = _predictAddress(type(Notary).creationCode);

        console2.log("Predicted AgentBudget address:", agentBudget);
        console2.log("Predicted Notary address:     ", notary);
        console2.log("Salt:");
        console2.logBytes32(SALT);

        uint256 deployerPk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(deployerPk);

        AgentBudget agentBudgetDeployed = new AgentBudget{salt: SALT}();
        Notary notaryDeployed = new Notary{salt: SALT}();

        vm.stopBroadcast();

        require(address(agentBudgetDeployed) == agentBudget, "AgentBudget addr mismatch");
        require(address(notaryDeployed) == notary, "Notary addr mismatch");

        console2.log("AgentBudget deployed at:", address(agentBudgetDeployed));
        console2.log("Notary deployed at:     ", address(notaryDeployed));
    }

    /// @dev Compute CREATE2 address: keccak256(0xff ++ deployer ++ salt ++ keccak256(initCode))[12:]
    function _predictAddress(bytes memory initCode) internal pure returns (address) {
        bytes32 hash = keccak256(
            abi.encodePacked(
                bytes1(0xff),
                CREATE2_DEPLOYER,
                SALT,
                keccak256(initCode)
            )
        );
        return address(uint160(uint256(hash)));
    }
}
