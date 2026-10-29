// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {TrancheEscrowTestBase} from "./TrancheEscrow.Base.t.sol";
import {TrancheEscrow} from "../TrancheEscrow.sol";

contract TrancheEscrowFlowTest is TrancheEscrowTestBase {
    // ---------- release ----------

    function test_Release_CreditsSharesAndEmits() public {
        uint256 id = _defaultGrant();
        vm.expectEmit(true, true, false, true, address(escrow));
        emit MilestoneReleased(id, 0, 600e6);
        _release(id, 0);

        assertEq(escrow.claimable(r0), 300e6);
        assertEq(escrow.claimable(r1), 300e6);
        TrancheEscrow.Grant memory g = escrow.getGrant(id);
        assertTrue(g.released[0]);
        assertFalse(g.released[1]);
        assertEq(g.releasedAmount, 600e6);
        // no token movement on release
        assertEq(usdc.balanceOf(address(escrow)), 1000e6);
    }

    function test_Release_AnyOrder() public {
        uint256 id = _defaultGrant();
        _release(id, 1);
        _release(id, 0);
        assertEq(escrow.claimable(r0) + escrow.claimable(r1), 1000e6);
    }

    function test_Release_OnlyApprover() public {
        uint256 id = _defaultGrant();
        address[3] memory bad = [funder, stranger, r0];
        for (uint256 i; i < 3; ++i) {
            vm.prank(bad[i]);
            vm.expectRevert(TrancheEscrow.NotApprover.selector);
            escrow.releaseMilestone(id, 0);
        }
        _release(id, 0); // approver ok
    }

    function test_Release_DoubleReleaseReverts() public {
        uint256 id = _defaultGrant();
        _release(id, 0);
        vm.prank(approver);
        vm.expectRevert(abi.encodeWithSelector(TrancheEscrow.MilestoneAlreadyReleased.selector, 0));
        escrow.releaseMilestone(id, 0);
        assertEq(escrow.claimable(r0), 300e6); // not double-credited
    }

    function test_Release_AtDeadlineReverts() public {
        uint256 id = _defaultGrant();
        vm.warp(deadline);
        vm.prank(approver);
        vm.expectRevert(TrancheEscrow.DeadlineReached.selector);
        escrow.releaseMilestone(id, 0);
    }

    function test_Release_AfterDeadlineReverts() public {
        uint256 id = _defaultGrant();
        vm.warp(deadline + 1);
        vm.prank(approver);
        vm.expectRevert(TrancheEscrow.DeadlineReached.selector);
        escrow.releaseMilestone(id, 0);
    }

    function test_Release_OneSecondBeforeDeadlineOk() public {
        uint256 id = _defaultGrant();
        vm.warp(deadline - 1);
        _release(id, 0);
        assertEq(escrow.claimable(r0), 300e6);
    }

    function test_Release_InvalidIndexAndMissingGrant() public {
        uint256 id = _defaultGrant();
        vm.prank(approver);
        vm.expectRevert(abi.encodeWithSelector(TrancheEscrow.InvalidMilestoneIndex.selector, 2));
        escrow.releaseMilestone(id, 2);
        vm.prank(approver);
        vm.expectRevert(abi.encodeWithSelector(TrancheEscrow.GrantNotFound.selector, 99));
        escrow.releaseMilestone(99, 0);
    }

    function test_Release_AfterRefundReverts() public {
        uint256 id = _defaultGrant();
        vm.warp(deadline);
        vm.prank(funder);
        escrow.refund(id);
        vm.prank(approver);
        vm.expectRevert(TrancheEscrow.GrantAlreadyRefunded.selector);
        escrow.releaseMilestone(id, 0);
    }

    // ---------- split math ----------

    function test_Split_OddAmount_ThreeWay() public {
        uint256 id = _create(_a(r0, r1, r2), _u(3333, 3333, 3334), _u(1000001));
        _release(id, 0);
        assertEq(escrow.claimable(r1), 333300);
        assertEq(escrow.claimable(r2), 333400);
        assertEq(escrow.claimable(r0), 333301); // 333300 + 1 dust
        assertEq(escrow.claimable(r0) + escrow.claimable(r1) + escrow.claimable(r2), 1000001);

        _claimAll3();
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(usdc.balanceOf(r0), 333301);
        assertEq(usdc.balanceOf(r1), 333300);
        assertEq(usdc.balanceOf(r2), 333400);
    }

    function test_Split_OddAmount_TwoWay() public {
        uint256 id = _create(_a(r0, r1), _u(5000, 5000), _u(1000001));
        _release(id, 0);
        assertEq(escrow.claimable(r0), 500001);
        assertEq(escrow.claimable(r1), 500000);
        vm.prank(r0);
        escrow.claim();
        vm.prank(r1);
        escrow.claim();
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_Split_MultiMilestoneNoDustStuck() public {
        uint256[] memory am = new uint256[](3);
        am[0] = 1000001;
        am[1] = 7;
        am[2] = 333333;
        uint256 id = _create(_a(r0, r1, r2), _u(3333, 3333, 3334), am);
        uint256 running;
        for (uint256 i; i < 3; ++i) {
            _release(id, i);
            running += am[i];
            // sum of claimables equals total released at every step
            assertEq(escrow.claimable(r0) + escrow.claimable(r1) + escrow.claimable(r2), running);
        }
        _claimAll3();
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_Split_TinyAmountAllDustToFirst() public {
        uint256 id = _create(_a(r0, r1, r2), _u(3333, 3333, 3334), _u(1));
        _release(id, 0);
        assertEq(escrow.claimable(r0), 1);
        assertEq(escrow.claimable(r1), 0);
        assertEq(escrow.claimable(r2), 0);
    }

    function _claimAll3() internal {
        vm.prank(r0);
        escrow.claim();
        vm.prank(r1);
        escrow.claim();
        vm.prank(r2);
        escrow.claim();
    }

    // ---------- claim ----------

    function test_Claim_PaysFullZeroesAndEmits() public {
        uint256 id = _defaultGrant();
        _release(id, 0);
        _release(id, 1);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit Claimed(r0, 500e6);
        vm.prank(r0);
        escrow.claim();
        assertEq(usdc.balanceOf(r0), 500e6);
        assertEq(escrow.claimable(r0), 0);
        assertEq(usdc.balanceOf(address(escrow)), 500e6);
    }

    function test_Claim_SecondClaimReverts() public {
        uint256 id = _defaultGrant();
        _release(id, 0);
        vm.prank(r0);
        escrow.claim();
        vm.prank(r0);
        vm.expectRevert(TrancheEscrow.NothingToClaim.selector);
        escrow.claim();
    }

    function test_Claim_NothingToClaimReverts() public {
        vm.prank(stranger);
        vm.expectRevert(TrancheEscrow.NothingToClaim.selector);
        escrow.claim();
    }

    function test_Claim_AggregatesAcrossGrants() public {
        uint256 a = _defaultGrant();
        uint256 b = _create(_a(r0), _u(10000), _u(50e6));
        _release(a, 0);
        _release(b, 0);
        assertEq(escrow.claimable(r0), 350e6);
        vm.prank(r0);
        escrow.claim();
        assertEq(usdc.balanceOf(r0), 350e6);
    }

    function test_Claim_BlocklistedRecipientDoesNotAffectOthers() public {
        uint256 id = _defaultGrant();
        _release(id, 0);
        _release(id, 1);
        usdc.setBlocked(r0, true);

        vm.prank(r0);
        vm.expectRevert();
        escrow.claim();
        assertEq(escrow.claimable(r0), 500e6); // balance preserved on failure

        vm.prank(r1);
        escrow.claim();
        assertEq(usdc.balanceOf(r1), 500e6);
        assertEq(escrow.claimable(r1), 0);

        // once unblocked, r0 can still claim
        usdc.setBlocked(r0, false);
        vm.prank(r0);
        escrow.claim();
        assertEq(usdc.balanceOf(r0), 500e6);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_Claim_BlocklistedFunderDoesNotBlockRelease() public {
        uint256 id = _defaultGrant();
        usdc.setBlocked(r0, true);
        _release(id, 0); // release is bookkeeping only
        assertEq(escrow.claimable(r0), 300e6);
    }

    // ---------- refund ----------

    function test_Refund_BeforeDeadlineReverts() public {
        uint256 id = _defaultGrant();
        vm.prank(funder);
        vm.expectRevert(TrancheEscrow.DeadlineNotReached.selector);
        escrow.refund(id);
        vm.warp(deadline - 1);
        vm.prank(funder);
        vm.expectRevert(TrancheEscrow.DeadlineNotReached.selector);
        escrow.refund(id);
    }

    function test_Refund_AtDeadlineReturnsOnlyUnreleased() public {
        uint256 id = _defaultGrant();
        _release(id, 0); // 600 released, 400 unreleased
        uint256 before = usdc.balanceOf(funder);
        vm.warp(deadline);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit Refunded(id, funder, 400e6);
        vm.prank(funder);
        escrow.refund(id);

        assertEq(usdc.balanceOf(funder), before + 400e6);
        assertEq(usdc.balanceOf(address(escrow)), 600e6);
        assertTrue(escrow.getGrant(id).refunded);
    }

    function test_Refund_ReleasedFundsStillClaimable() public {
        uint256 id = _defaultGrant();
        _release(id, 0);
        vm.warp(deadline + 5 days);
        vm.prank(funder);
        escrow.refund(id);

        vm.prank(r0);
        escrow.claim();
        vm.prank(r1);
        escrow.claim();
        assertEq(usdc.balanceOf(r0), 300e6);
        assertEq(usdc.balanceOf(r1), 300e6);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_Refund_NoneReleasedReturnsAll() public {
        uint256 id = _defaultGrant();
        uint256 before = usdc.balanceOf(funder);
        vm.warp(deadline);
        vm.prank(funder);
        escrow.refund(id);
        assertEq(usdc.balanceOf(funder), before + 1000e6);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_Refund_OnlyFunder() public {
        uint256 id = _defaultGrant();
        vm.warp(deadline);
        vm.prank(approver);
        vm.expectRevert(TrancheEscrow.NotFunder.selector);
        escrow.refund(id);
        vm.prank(stranger);
        vm.expectRevert(TrancheEscrow.NotFunder.selector);
        escrow.refund(id);
    }

    function test_Refund_TwiceReverts() public {
        uint256 id = _defaultGrant();
        vm.warp(deadline);
        vm.prank(funder);
        escrow.refund(id);
        uint256 bal = usdc.balanceOf(funder);
        vm.prank(funder);
        vm.expectRevert(TrancheEscrow.GrantAlreadyRefunded.selector);
        escrow.refund(id);
        assertEq(usdc.balanceOf(funder), bal);
    }

    function test_Refund_AllReleasedRevertsNothingToRefund() public {
        uint256 id = _defaultGrant();
        _release(id, 0);
        _release(id, 1);
        vm.warp(deadline);
        uint256 funderBal = usdc.balanceOf(funder);
        uint256 escrowBal = usdc.balanceOf(address(escrow));
        vm.prank(funder);
        vm.expectRevert(TrancheEscrow.NothingToRefund.selector);
        escrow.refund(id);
        assertEq(usdc.balanceOf(funder), funderBal);
        assertEq(usdc.balanceOf(address(escrow)), escrowBal);
        assertFalse(escrow.getGrant(id).refunded);
    }

    function test_Refund_MissingGrant() public {
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(TrancheEscrow.GrantNotFound.selector, 5));
        escrow.refund(5);
    }

    function test_Refund_DoesNotTouchOtherGrants() public {
        uint256 a = _defaultGrant();
        uint256 b = _create(_a(r0), _u(10000), _u(50e6));
        vm.warp(deadline);
        vm.prank(funder);
        escrow.refund(a);
        assertEq(usdc.balanceOf(address(escrow)), 50e6);
        assertFalse(escrow.getGrant(b).refunded);
    }
}
