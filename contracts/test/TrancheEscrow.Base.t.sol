// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {TrancheEscrow} from "../TrancheEscrow.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

abstract contract TrancheEscrowTestBase is Test {
    event GrantCreated(
        uint256 indexed grantId,
        address indexed funder,
        address indexed approver,
        uint256 totalAmount,
        uint256 deadline
    );
    event MilestoneReleased(uint256 indexed grantId, uint256 indexed index, uint256 amount);
    event Claimed(address indexed recipient, uint256 amount);
    event Refunded(uint256 indexed grantId, address indexed funder, uint256 amount);
    event ApproverChanged(
        uint256 indexed grantId, address indexed oldApprover, address indexed newApprover
    );

    TrancheEscrow internal escrow;
    MockERC20 internal usdc;

    address internal funder = makeAddr("funder");
    address internal approver = makeAddr("approver");
    address internal r0 = makeAddr("r0");
    address internal r1 = makeAddr("r1");
    address internal r2 = makeAddr("r2");
    address internal stranger = makeAddr("stranger");

    uint256 internal constant FUNDS = 1_000_000_000e6;
    uint256 internal deadline;

    function setUp() public virtual {
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);
        escrow = new TrancheEscrow(address(usdc));
        usdc.mint(funder, FUNDS);
        vm.prank(funder);
        usdc.approve(address(escrow), type(uint256).max);
        deadline = block.timestamp + 30 days;
    }

    // ---- array helpers ----
    function _a(address x) internal pure returns (address[] memory r) {
        r = new address[](1);
        r[0] = x;
    }

    function _a(address x, address y) internal pure returns (address[] memory r) {
        r = new address[](2);
        r[0] = x;
        r[1] = y;
    }

    function _a(address x, address y, address z) internal pure returns (address[] memory r) {
        r = new address[](3);
        r[0] = x;
        r[1] = y;
        r[2] = z;
    }

    function _u(uint256 x) internal pure returns (uint256[] memory r) {
        r = new uint256[](1);
        r[0] = x;
    }

    function _u(uint256 x, uint256 y) internal pure returns (uint256[] memory r) {
        r = new uint256[](2);
        r[0] = x;
        r[1] = y;
    }

    function _u(uint256 x, uint256 y, uint256 z) internal pure returns (uint256[] memory r) {
        r = new uint256[](3);
        r[0] = x;
        r[1] = y;
        r[2] = z;
    }

    function _create(address[] memory rec, uint256[] memory shares, uint256[] memory amts)
        internal
        returns (uint256 id)
    {
        vm.prank(funder);
        id = escrow.createGrant(approver, rec, shares, amts, deadline, "Grant");
    }

    /// 2 recipients 50/50, two milestones 600 + 400 (raw units)
    function _defaultGrant() internal returns (uint256) {
        return _create(_a(r0, r1), _u(5000, 5000), _u(600e6, 400e6));
    }

    function _release(uint256 id, uint256 idx) internal {
        vm.prank(approver);
        escrow.releaseMilestone(id, idx);
    }
}
