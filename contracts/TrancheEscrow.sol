// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title TrancheEscrow
/// @notice Escrows milestone grants in a single ERC-20, with pull-based recipient payments.
/// @dev For Arc Testnet, construct with USDC at 0x3600000000000000000000000000000000000000.
/// All amounts are raw token units (USDC has 6 decimals); no decimal conversion is performed.
/// There is no owner, privileged withdrawal, upgrade mechanism, or native-token payment path.
/// @custom:trade-off Released funds stay claimable forever and nobody can sweep or reassign them.
/// A recipient who loses their key permanently loses whatever has been credited to that address.
contract TrancheEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_RECIPIENTS = 10;
    uint256 public constant MAX_MILESTONES = 10;
    uint256 public constant MAX_TITLE_BYTES = 100;

    /// @notice The immutable ERC-20 used for every grant.
    IERC20 public immutable usdc;
    /// @notice The identifier that will be assigned to the next successful grant.
    uint256 public nextGrantId = 1;

    struct Grant {
        address funder;
        address approver;
        address[] recipients;
        uint256[] sharesBps;
        uint256[] amounts;
        bool[] released;
        uint256 deadline;
        string title;
        bool refunded;
        uint256 totalAmount;
        uint256 releasedAmount;
    }

    mapping(uint256 => Grant) private _grants;
    mapping(address => uint256[]) private _grantsByFunder;
    mapping(address => uint256[]) private _grantsByRecipient;

    /// @notice Released funds available to an address across all grants, without expiry.
    mapping(address => uint256) public claimable;

    error ZeroAddress();
    error InvalidRecipientCount();
    error InvalidMilestoneCount();
    error ArrayLengthMismatch();
    error InvalidShare(uint256 index);
    error InvalidShareTotal(uint256 total);
    error DuplicateRecipient(address recipient);
    error ZeroMilestoneAmount(uint256 index);
    error InvalidDeadline();
    error TitleTooLong();
    error GrantNotFound(uint256 grantId);
    error NotApprover();
    error NotFunder();
    error GrantAlreadyRefunded();
    error DeadlineReached();
    error DeadlineNotReached();
    error InvalidMilestoneIndex(uint256 index);
    error MilestoneAlreadyReleased(uint256 index);
    error NothingToClaim();
    error NothingToRefund();
    error UnexpectedReceivedAmount(uint256 expected, uint256 received);

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

    /// @param usdc_ ERC-20 token address; use the documented USDC address on Arc Testnet.
    constructor(address usdc_) {
        if (usdc_ == address(0)) revert ZeroAddress();
        usdc = IERC20(usdc_);
    }

    /// @notice Creates and fully funds a grant using the caller's ERC-20 allowance.
    /// @param approver The sole address permitted to release milestones.
    /// @param recipients Unique nonzero recipients (1 to 10).
    /// @param sharesBps Positive recipient shares summing to 10,000.
    /// @param amounts Positive milestone amounts in raw token units (1 to 10).
    /// @param deadline Exclusive release cutoff and inclusive refund start, in Unix seconds.
    /// @param title Grant title, limited to 100 bytes.
    /// @return grantId The new grant identifier, starting at 1.
    function createGrant(
        address approver,
        address[] calldata recipients,
        uint256[] calldata sharesBps,
        uint256[] calldata amounts,
        uint256 deadline,
        string calldata title
    ) external nonReentrant returns (uint256 grantId) {
        if (approver == address(0)) revert ZeroAddress();
        if (deadline <= block.timestamp) revert InvalidDeadline();
        if (bytes(title).length > MAX_TITLE_BYTES) revert TitleTooLong();
        _validateRecipients(recipients, sharesBps);
        uint256 total = _sumMilestones(amounts);

        grantId = nextGrantId++;
        Grant storage grant = _grants[grantId];
        grant.funder = msg.sender;
        grant.approver = approver;
        grant.recipients = recipients;
        grant.sharesBps = sharesBps;
        grant.amounts = amounts;
        grant.released = new bool[](amounts.length);
        grant.deadline = deadline;
        grant.title = title;
        grant.totalAmount = total;

        _grantsByFunder[msg.sender].push(grantId);
        for (uint256 i; i < recipients.length; ++i) {
            _grantsByRecipient[recipients[i]].push(grantId);
        }

        // All grant effects precede token interactions; any funding failure rolls them back.
        _pullFunds(total);
        emit GrantCreated(grantId, msg.sender, approver, total, deadline);
    }

    /// @notice Credits a milestone once, in any order, strictly before its deadline.
    /// @dev No tokens are sent here. Each rounded-down share is credited, then all dust
    /// is credited to the first recipient. Full-precision mulDiv avoids product overflow.
    function releaseMilestone(uint256 grantId, uint256 index) external nonReentrant {
        Grant storage grant = _existingGrant(grantId);
        if (msg.sender != grant.approver) revert NotApprover();
        if (grant.refunded) revert GrantAlreadyRefunded();
        if (block.timestamp >= grant.deadline) revert DeadlineReached();
        if (index >= grant.amounts.length) revert InvalidMilestoneIndex(index);
        if (grant.released[index]) revert MilestoneAlreadyReleased(index);

        uint256 amount = grant.amounts[index];
        grant.released[index] = true;
        grant.releasedAmount += amount;

        uint256 credited;
        for (uint256 i; i < grant.recipients.length; ++i) {
            uint256 share = Math.mulDiv(amount, grant.sharesBps[i], BPS_DENOMINATOR);
            claimable[grant.recipients[i]] += share;
            credited += share;
        }
        claimable[grant.recipients[0]] += amount - credited;
        emit MilestoneReleased(grantId, index, amount);
    }

    /// @notice Withdraws the caller's entire released balance across every grant.
    /// @dev Clears the balance before transfer. A failed transfer reverts only this claim.
    function claim() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimable[msg.sender] = 0;
        usdc.safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    /// @notice Returns all unreleased milestone funds to the funder at/after the deadline.
    /// @dev Released recipient balances remain claimable forever, even after a refund.
    function refund(uint256 grantId) external nonReentrant {
        Grant storage grant = _existingGrant(grantId);
        if (msg.sender != grant.funder) revert NotFunder();
        if (grant.refunded) revert GrantAlreadyRefunded();
        if (block.timestamp < grant.deadline) revert DeadlineNotReached();

        // Each released milestone contributes its full amount to releasedAmount.
        uint256 amount = grant.totalAmount - grant.releasedAmount;
        if (amount == 0) revert NothingToRefund();
        grant.refunded = true;
        usdc.safeTransfer(grant.funder, amount);
        emit Refunded(grantId, grant.funder, amount);
    }

    /// @notice Lets only the funder replace the approver of a non-refunded grant.
    function changeApprover(uint256 grantId, address newApprover) external nonReentrant {
        Grant storage grant = _existingGrant(grantId);
        if (msg.sender != grant.funder) revert NotFunder();
        if (newApprover == address(0)) revert ZeroAddress();
        if (grant.refunded) revert GrantAlreadyRefunded();

        address oldApprover = grant.approver;
        grant.approver = newApprover;
        emit ApproverChanged(grantId, oldApprover, newApprover);
    }

    /// @notice Returns complete grant data, including recipients, amounts and release flags.
    function getGrant(uint256 grantId) external view returns (Grant memory) {
        return _existingGrant(grantId);
    }

    /// @notice Returns every grant created by the given funder, in creation order.
    function grantsByFunder(address funder) external view returns (uint256[] memory) {
        return _grantsByFunder[funder];
    }

    /// @notice Returns every grant listing the given recipient, in creation order.
    function grantsByRecipient(address recipient) external view returns (uint256[] memory) {
        return _grantsByRecipient[recipient];
    }

    function _existingGrant(uint256 grantId) private view returns (Grant storage grant) {
        grant = _grants[grantId];
        if (grant.funder == address(0)) revert GrantNotFound(grantId);
    }

    function _validateRecipients(address[] calldata recipients, uint256[] calldata sharesBps)
        private
        pure
    {
        uint256 count = recipients.length;
        if (count == 0 || count > MAX_RECIPIENTS) revert InvalidRecipientCount();
        if (count != sharesBps.length) revert ArrayLengthMismatch();

        uint256 totalBps;
        for (uint256 i; i < count; ++i) {
            if (recipients[i] == address(0)) revert ZeroAddress();
            if (sharesBps[i] == 0 || sharesBps[i] > BPS_DENOMINATOR) revert InvalidShare(i);
            totalBps += sharesBps[i];
            for (uint256 j; j < i; ++j) {
                if (recipients[j] == recipients[i]) revert DuplicateRecipient(recipients[i]);
            }
        }
        if (totalBps != BPS_DENOMINATOR) revert InvalidShareTotal(totalBps);
    }

    function _sumMilestones(uint256[] calldata amounts) private pure returns (uint256 total) {
        if (amounts.length == 0 || amounts.length > MAX_MILESTONES) {
            revert InvalidMilestoneCount();
        }
        for (uint256 i; i < amounts.length; ++i) {
            if (amounts[i] == 0) revert ZeroMilestoneAmount(i);
            total += amounts[i];
        }
    }

    function _pullFunds(uint256 total) private {
        uint256 balanceBefore = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), total);
        uint256 balanceAfter = usdc.balanceOf(address(this));
        if (balanceAfter < balanceBefore) revert UnexpectedReceivedAmount(total, 0);
        uint256 received = balanceAfter - balanceBefore;
        if (received != total) revert UnexpectedReceivedAmount(total, received);
    }
}
