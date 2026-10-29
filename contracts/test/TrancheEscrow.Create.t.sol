// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {TrancheEscrowTestBase} from "./TrancheEscrow.Base.t.sol";
import {TrancheEscrow} from "../TrancheEscrow.sol";

contract TrancheEscrowCreateTest is TrancheEscrowTestBase {
    function test_Deploy_StoresToken() public view {
        assertEq(address(escrow.usdc()), address(usdc));
        assertEq(escrow.nextGrantId(), 1);
    }

    function test_Deploy_RevertsOnZeroToken() public {
        vm.expectRevert(TrancheEscrow.ZeroAddress.selector);
        new TrancheEscrow(address(0));
    }

    function test_CreateGrant_PullsExactTotalAndEmits() public {
        uint256 before = usdc.balanceOf(funder);
        vm.expectEmit(true, true, true, true, address(escrow));
        emit GrantCreated(1, funder, approver, 1000e6, deadline);
        uint256 id = _defaultGrant();

        assertEq(id, 1);
        assertEq(escrow.nextGrantId(), 2);
        assertEq(usdc.balanceOf(address(escrow)), 1000e6);
        assertEq(usdc.balanceOf(funder), before - 1000e6);
    }

    function test_GetGrant_ReturnsFullData() public {
        uint256 id = _defaultGrant();
        TrancheEscrow.Grant memory g = escrow.getGrant(id);
        assertEq(g.funder, funder);
        assertEq(g.approver, approver);
        assertEq(g.recipients.length, 2);
        assertEq(g.recipients[0], r0);
        assertEq(g.recipients[1], r1);
        assertEq(g.sharesBps[0], 5000);
        assertEq(g.sharesBps[1], 5000);
        assertEq(g.amounts[0], 600e6);
        assertEq(g.amounts[1], 400e6);
        assertFalse(g.released[0]);
        assertFalse(g.released[1]);
        assertEq(g.deadline, deadline);
        assertEq(g.title, "Grant");
        assertFalse(g.refunded);
        assertEq(g.totalAmount, 1000e6);
        assertEq(g.releasedAmount, 0);
    }

    function test_GetGrant_RevertsWhenMissing() public {
        vm.expectRevert(abi.encodeWithSelector(TrancheEscrow.GrantNotFound.selector, 1));
        escrow.getGrant(1);
        vm.expectRevert(abi.encodeWithSelector(TrancheEscrow.GrantNotFound.selector, 0));
        escrow.getGrant(0);
    }

    function test_GrantsByFunderAndRecipient() public {
        uint256 id1 = _defaultGrant();
        uint256 id2 = _create(_a(r1, r2), _u(1000, 9000), _u(10e6));
        uint256[] memory f = escrow.grantsByFunder(funder);
        assertEq(f.length, 2);
        assertEq(f[0], id1);
        assertEq(f[1], id2);

        uint256[] memory a0 = escrow.grantsByRecipient(r0);
        assertEq(a0.length, 1);
        assertEq(a0[0], id1);
        uint256[] memory a1 = escrow.grantsByRecipient(r1);
        assertEq(a1.length, 2);
        assertEq(a1[0], id1);
        assertEq(a1[1], id2);
        assertEq(escrow.grantsByRecipient(r2).length, 1);
        assertEq(escrow.grantsByFunder(stranger).length, 0);
        assertEq(escrow.grantsByRecipient(stranger).length, 0);
    }

    function test_Claimable_DefaultsZero() public view {
        assertEq(escrow.claimable(r0), 0);
    }

    // ---------- validation reverts ----------

    function test_Revert_ZeroApprover() public {
        vm.prank(funder);
        vm.expectRevert(TrancheEscrow.ZeroAddress.selector);
        escrow.createGrant(address(0), _a(r0), _u(10000), _u(1e6), deadline, "t");
    }

    function test_Revert_ZeroRecipient() public {
        vm.prank(funder);
        vm.expectRevert(TrancheEscrow.ZeroAddress.selector);
        escrow.createGrant(approver, _a(r0, address(0)), _u(5000, 5000), _u(1e6), deadline, "t");
    }

    function test_Revert_DuplicateRecipients() public {
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(TrancheEscrow.DuplicateRecipient.selector, r0));
        escrow.createGrant(approver, _a(r0, r1, r0), _u(3000, 3000, 4000), _u(1e6), deadline, "t");
    }

    function test_Revert_MoreThan10Recipients() public {
        address[] memory rec = new address[](11);
        uint256[] memory sh = new uint256[](11);
        for (uint256 i; i < 11; ++i) {
            rec[i] = address(uint160(0x1000 + i));
            sh[i] = i == 0 ? 9091 : 909; // sums to 10000-ish; count check happens first
        }
        vm.prank(funder);
        vm.expectRevert(TrancheEscrow.InvalidRecipientCount.selector);
        escrow.createGrant(approver, rec, sh, _u(1e6), deadline, "t");
    }

    function test_Create_Exactly10RecipientsAnd10MilestonesOk() public {
        address[] memory rec = new address[](10);
        uint256[] memory sh = new uint256[](10);
        uint256[] memory am = new uint256[](10);
        for (uint256 i; i < 10; ++i) {
            rec[i] = address(uint160(0x1000 + i));
            sh[i] = 1000;
            am[i] = 1e6 + i;
        }
        uint256 id = _create(rec, sh, am);
        assertEq(escrow.getGrant(id).recipients.length, 10);
        assertEq(escrow.getGrant(id).amounts.length, 10);
    }

    function test_Revert_MoreThan10Milestones() public {
        uint256[] memory am = new uint256[](11);
        for (uint256 i; i < 11; ++i) am[i] = 1e6;
        vm.prank(funder);
        vm.expectRevert(TrancheEscrow.InvalidMilestoneCount.selector);
        escrow.createGrant(approver, _a(r0), _u(10000), am, deadline, "t");
    }

    function test_Revert_EmptyRecipients() public {
        vm.prank(funder);
        vm.expectRevert(TrancheEscrow.InvalidRecipientCount.selector);
        escrow.createGrant(approver, new address[](0), new uint256[](0), _u(1e6), deadline, "t");
    }

    function test_Revert_EmptyMilestones() public {
        vm.prank(funder);
        vm.expectRevert(TrancheEscrow.InvalidMilestoneCount.selector);
        escrow.createGrant(approver, _a(r0), _u(10000), new uint256[](0), deadline, "t");
    }

    function test_Revert_LengthMismatch() public {
        vm.prank(funder);
        vm.expectRevert(TrancheEscrow.ArrayLengthMismatch.selector);
        escrow.createGrant(approver, _a(r0, r1), _u(10000), _u(1e6), deadline, "t");
    }

    function test_Revert_DeadlineInPastOrNow() public {
        vm.prank(funder);
        vm.expectRevert(TrancheEscrow.InvalidDeadline.selector);
        escrow.createGrant(approver, _a(r0), _u(10000), _u(1e6), block.timestamp, "t");

        vm.warp(1000);
        vm.prank(funder);
        vm.expectRevert(TrancheEscrow.InvalidDeadline.selector);
        escrow.createGrant(approver, _a(r0), _u(10000), _u(1e6), 999, "t");
    }

    function test_Revert_SharesNotSummingTo10000() public {
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(TrancheEscrow.InvalidShareTotal.selector, 9999));
        escrow.createGrant(approver, _a(r0, r1), _u(5000, 4999), _u(1e6), deadline, "t");

        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(TrancheEscrow.InvalidShareTotal.selector, 10001));
        escrow.createGrant(approver, _a(r0, r1), _u(5000, 5001), _u(1e6), deadline, "t");
    }

    function test_Revert_ZeroShareAndOversizedShare() public {
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(TrancheEscrow.InvalidShare.selector, 1));
        escrow.createGrant(approver, _a(r0, r1), _u(10000, 0), _u(1e6), deadline, "t");

        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(TrancheEscrow.InvalidShare.selector, 1));
        escrow.createGrant(approver, _a(r0, r1), _u(1, 10001), _u(1e6), deadline, "t");
    }

    function test_Revert_ZeroMilestoneAmount() public {
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(TrancheEscrow.ZeroMilestoneAmount.selector, 1));
        escrow.createGrant(approver, _a(r0), _u(10000), _u(1e6, 0), deadline, "t");
    }

    function test_Revert_TitleTooLong() public {
        bytes memory big = new bytes(101);
        for (uint256 i; i < 101; ++i) big[i] = "a";
        vm.prank(funder);
        vm.expectRevert(TrancheEscrow.TitleTooLong.selector);
        escrow.createGrant(approver, _a(r0), _u(10000), _u(1e6), deadline, string(big));
    }

    function test_Revert_InsufficientAllowanceRollsBackState() public {
        vm.prank(funder);
        usdc.approve(address(escrow), 1);
        vm.prank(funder);
        vm.expectRevert();
        escrow.createGrant(approver, _a(r0), _u(10000), _u(1e6), deadline, "t");
        assertEq(escrow.nextGrantId(), 1);
        assertEq(escrow.grantsByFunder(funder).length, 0);
    }

    // ---------- changeApprover ----------

    function test_ChangeApprover_FunderSucceedsAndEmits() public {
        uint256 id = _defaultGrant();
        address newA = makeAddr("newApprover");
        vm.expectEmit(true, true, true, true, address(escrow));
        emit ApproverChanged(id, approver, newA);
        vm.prank(funder);
        escrow.changeApprover(id, newA);
        assertEq(escrow.getGrant(id).approver, newA);

        // old approver loses power, new has it
        vm.prank(approver);
        vm.expectRevert(TrancheEscrow.NotApprover.selector);
        escrow.releaseMilestone(id, 0);
        vm.prank(newA);
        escrow.releaseMilestone(id, 0);
    }

    function test_ChangeApprover_RevertsForNonFunder() public {
        uint256 id = _defaultGrant();
        vm.prank(approver);
        vm.expectRevert(TrancheEscrow.NotFunder.selector);
        escrow.changeApprover(id, stranger);
        vm.prank(stranger);
        vm.expectRevert(TrancheEscrow.NotFunder.selector);
        escrow.changeApprover(id, stranger);
    }

    function test_ChangeApprover_RevertsOnZeroAddress() public {
        uint256 id = _defaultGrant();
        vm.prank(funder);
        vm.expectRevert(TrancheEscrow.ZeroAddress.selector);
        escrow.changeApprover(id, address(0));
    }

    function test_ChangeApprover_RevertsOnMissingGrant() public {
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(TrancheEscrow.GrantNotFound.selector, 7));
        escrow.changeApprover(7, stranger);
    }

    function test_ChangeApprover_RevertsAfterRefund() public {
        uint256 id = _defaultGrant();
        vm.warp(deadline);
        vm.prank(funder);
        escrow.refund(id);
        vm.prank(funder);
        vm.expectRevert(TrancheEscrow.GrantAlreadyRefunded.selector);
        escrow.changeApprover(id, stranger);
    }
}
