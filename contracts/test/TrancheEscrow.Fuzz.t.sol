// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {TrancheEscrowTestBase} from "./TrancheEscrow.Base.t.sol";
import {TrancheEscrow} from "../TrancheEscrow.sol";

contract TrancheEscrowFuzzTest is TrancheEscrowTestBase {
    function _shares(uint256 n, uint256 seed) internal pure returns (uint256[] memory sh) {
        sh = new uint256[](n);
        uint256 remaining = 10_000;
        for (uint256 i; i + 1 < n; ++i) {
            uint256 maxS = remaining - (n - 1 - i); // leave >=1 for each later recipient
            sh[i] = 1 + (uint256(keccak256(abi.encode(seed, i))) % maxS);
            remaining -= sh[i];
        }
        sh[n - 1] = remaining;
    }

    function _recipients(uint256 n) internal pure returns (address[] memory rec) {
        rec = new address[](n);
        for (uint256 i; i < n; ++i) rec[i] = address(uint160(0xBEEF00 + i));
    }

    function testFuzz_ReleaseSplitConservation(uint256 amount, uint256 n, uint256 seed) public {
        amount = bound(amount, 1, type(uint128).max);
        n = bound(n, 1, 10);
        uint256[] memory sh = _shares(n, seed);
        address[] memory rec = _recipients(n);
        usdc.mint(funder, amount);

        uint256 id = _create(rec, sh, _u(amount));
        _release(id, 0);

        uint256 sum;
        for (uint256 i; i < n; ++i) {
            uint256 c = escrow.claimable(rec[i]);
            sum += c;
            uint256 floorShare = (amount * sh[i]) / 10_000;
            if (i == 0) {
                // first recipient gets floor share + all dust (< n)
                assertGe(c, floorShare);
                assertLt(c - floorShare, n);
            } else {
                assertEq(c, floorShare);
            }
        }
        assertEq(sum, amount, "sum credited != amount");

        // everyone claims -> nothing stuck
        for (uint256 i; i < n; ++i) {
            if (escrow.claimable(rec[i]) == 0) continue;
            vm.prank(rec[i]);
            escrow.claim();
        }
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function testFuzz_RefundOnlyUnreleased(uint8 mask, uint256 a0, uint256 a1, uint256 a2) public {
        a0 = bound(a0, 1, 1e18);
        a1 = bound(a1, 1, 1e18);
        a2 = bound(a2, 1, 1e18);
        uint256[3] memory am = [a0, a1, a2];
        usdc.mint(funder, a0 + a1 + a2);
        uint256 id = _create(_a(r0, r1), _u(2500, 7500), _u(a0, a1, a2));
        uint256 released;
        for (uint256 i; i < 3; ++i) {
            if (mask & (1 << i) != 0) {
                _release(id, i);
                released += am[i];
            }
        }
        uint256 total = a0 + a1 + a2;
        uint256 before = usdc.balanceOf(funder);
        vm.warp(deadline);
        if (released == total) {
            vm.prank(funder);
            vm.expectRevert(TrancheEscrow.NothingToRefund.selector);
            escrow.refund(id);
            assertEq(usdc.balanceOf(funder), before);
        } else {
            vm.prank(funder);
            escrow.refund(id);
            assertEq(usdc.balanceOf(funder), before + total - released);
        }
        // contract keeps exactly the released funds, all claimable
        assertEq(usdc.balanceOf(address(escrow)), released);
        assertEq(escrow.claimable(r0) + escrow.claimable(r1), released);
    }

    function testFuzz_ReleaseDeadlineBoundary(uint256 t) public {
        uint256 id = _defaultGrant();
        t = bound(t, block.timestamp, deadline + 365 days);
        vm.warp(t);
        vm.prank(approver);
        if (t >= deadline) vm.expectRevert(TrancheEscrow.DeadlineReached.selector);
        escrow.releaseMilestone(id, 0);
    }
}
