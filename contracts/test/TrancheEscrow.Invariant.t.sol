// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {TrancheEscrowTestBase} from "./TrancheEscrow.Base.t.sol";
import {TrancheEscrow} from "../TrancheEscrow.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

/// Handler acts as funder AND approver for all grants; actors are the recipients.
contract EscrowHandler is Test {
    TrancheEscrow public escrow;
    MockERC20 public usdc;
    address[4] public actors;
    uint256[] public grantIds;
    uint256 public ghostFunded;
    uint256 public ghostPaidOut; // claims + refunds

    constructor(TrancheEscrow e, MockERC20 u) {
        escrow = e;
        usdc = u;
        for (uint256 i; i < 4; ++i) actors[i] = address(uint160(0xA000 + i));
        usdc.approve(address(e), type(uint256).max);
    }

    function create(uint256 nSeed, uint256 shareSeed, uint256 mSeed, uint256 amtSeed, uint256 dl)
        external
    {
        uint256 n = bound(nSeed, 1, 4);
        uint256 m = bound(mSeed, 1, 3);
        address[] memory rec = new address[](n);
        uint256[] memory sh = new uint256[](n);
        uint256 remaining = 10_000;
        for (uint256 i; i < n; ++i) {
            rec[i] = actors[i];
            if (i + 1 == n) {
                sh[i] = remaining;
            } else {
                uint256 maxS = remaining - (n - 1 - i);
                sh[i] = 1 + (uint256(keccak256(abi.encode(shareSeed, i))) % maxS);
                remaining -= sh[i];
            }
        }
        uint256[] memory am = new uint256[](m);
        uint256 total;
        for (uint256 j; j < m; ++j) {
            am[j] = bound(uint256(keccak256(abi.encode(amtSeed, j))), 1, 1e12);
            total += am[j];
        }
        usdc.mint(address(this), total);
        uint256 id = escrow.createGrant(
            address(this), rec, sh, am, block.timestamp + bound(dl, 1 hours, 10 days), "g"
        );
        grantIds.push(id);
        ghostFunded += total;
    }

    function release(uint256 gSeed, uint256 idx) external {
        if (grantIds.length == 0) return;
        uint256 id = grantIds[gSeed % grantIds.length];
        uint256 len = escrow.getGrant(id).amounts.length;
        try escrow.releaseMilestone(id, idx % len) {} catch {}
    }

    function claim(uint256 aSeed) external {
        address a = actors[aSeed % 4];
        uint256 before = usdc.balanceOf(a);
        vm.prank(a);
        try escrow.claim() {
            ghostPaidOut += usdc.balanceOf(a) - before;
        } catch {}
    }

    function refund(uint256 gSeed) external {
        if (grantIds.length == 0) return;
        uint256 id = grantIds[gSeed % grantIds.length];
        uint256 before = usdc.balanceOf(address(this));
        try escrow.refund(id) {
            ghostPaidOut += usdc.balanceOf(address(this)) - before;
        } catch {}
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 0, 3 days));
    }

    function sumClaimable() public view returns (uint256 s) {
        for (uint256 i; i < 4; ++i) s += escrow.claimable(actors[i]);
    }

    function sumUnreleased() public view returns (uint256 s) {
        for (uint256 i; i < grantIds.length; ++i) {
            TrancheEscrow.Grant memory g = escrow.getGrant(grantIds[i]);
            if (!g.refunded) s += g.totalAmount - g.releasedAmount;
        }
    }
}

/// Quick-rerun counts. Raise these (for example runs = 256, depth = 500) for the final full run.
/// forge-config: default.invariant.runs = 32
/// forge-config: default.invariant.depth = 100
contract TrancheEscrowInvariantTest is TrancheEscrowTestBase {
    EscrowHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new EscrowHandler(escrow, usdc);
        targetContract(address(handler));
    }

    /// Contract always holds at least what it owes: outstanding claimables + unreleased funds.
    function invariant_BalanceCoversObligations() public view {
        uint256 owed = handler.sumClaimable() + handler.sumUnreleased();
        assertGe(usdc.balanceOf(address(escrow)), owed);
    }

    /// Stronger: nothing stuck and nothing extra — balance equals obligations exactly.
    function invariant_BalanceEqualsObligations() public view {
        uint256 owed = handler.sumClaimable() + handler.sumUnreleased();
        assertEq(usdc.balanceOf(address(escrow)), owed);
    }

    /// Token conservation: funded = held + paid out.
    function invariant_FundedEqualsHeldPlusPaid() public view {
        assertEq(handler.ghostFunded(), usdc.balanceOf(address(escrow)) + handler.ghostPaidOut());
    }
}
