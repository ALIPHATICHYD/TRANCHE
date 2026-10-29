# Tranche demo transactions (Arc Testnet)

Contract: `0x0c2b6081044d60b6e7ca9c8791ef66636ff6accb`
USDC (ERC-20, 6 decimals): `0x3600000000000000000000000000000000000000`
Explorer: https://explorer.testnet.arc.io

Open `/grant/1` in the app for the main demo grant (3 recipients, 3333/3333/3334, milestones 1.000001 and 2.000003 USDC).

## Key transactions for the video

| Step | Tx |
| --- | --- |
| Release milestone 0 of grant 1 | [0x4e4ca744...cfd35](https://explorer.testnet.arc.io/tx/0x4e4ca74498f1ab38f67899e25b07e17e396b1474f01323943df73f914c9cfd35) |
| Refund of grant 1 (unreleased milestone only) | [0x9c6b0e51...2ce4c](https://explorer.testnet.arc.io/tx/0x9c6b0e51ae744abe203cca99e0a3f9b8d6d162f37c2ea7a38077371fd5b2ce4c) |

## Full live loop

| # | Step | Role | Tx |
| --- | --- | --- | --- |
| 1 | Fund approver 0.5 USDC | funder | `0xd253417364d1d973089f16943ec6351e819b05b200f9768abbd71891b51bc03e` |
| 2 | Fund recipient B 0.5 USDC | funder | `0xc7bcb84fb4a8577f98cfb02a8843db768faad9e4c3b303695d45f4b30338c690` |
| 3 | Fund recipient C 0.5 USDC | funder | `0x740730551d79f01798fa5b320eefabfd040ebc9ab693c9a3fe91b2d69a49e812` |
| 4 | USDC approve (3.2 USDC) | funder | `0x15ea1680e8d093946b07056c76af03f3d11f8fabe2ad43847bf8dd3f862fb3d1` |
| 5 | createGrant (grant 1) | funder | `0xa9c6a1466b342905b9c90a4ff2afb9240932a8b523f93cc517b79f3c514279d3` |
| 6 | createGrant (grant 2) | funder | `0x5322414d071ae5d5f6969cb4909f678e6770085f0ee89a698ee9d856cacea956` |
| 7 | releaseMilestone(1, 0) | approver | `0x4e4ca74498f1ab38f67899e25b07e17e396b1474f01323943df73f914c9cfd35` |
| 8 | releaseMilestone(2, 0) | approver | `0xadf28a4f8e0bb323c55ef186f94a5ca80142d7c524e00ffa8b51cc22dc455398` |
| 9 | claim (366631) | recipient A | `0x306bf9962b26121c0360c77dd42b9bacb6e53e354c2dedece727381c23366548` |
| 10 | claim (366630) | recipient B | `0x3cb2578492607436bb419cc0fe718838ac62531e6a28e33130b231b8bac7f9da` |
| 11 | claim (366740) | recipient C | `0x204e60f7e0ff279a716454f39d4e80e613fe1e6c924e94ddfa6558bcf9d3ca7f` |
| 12 | refund(1) | funder | `0x9c6b0e51ae744abe203cca99e0a3f9b8d6d162f37c2ea7a38077371fd5b2ce4c` |

## Expected reverts (not broadcast)

These were rejected at gas estimation, so they have no tx hash. Show the error names.

`NotApprover`, `NotFunder`, `ZeroAddress` (changeApprover to the zero address), `DeadlineNotReached` (early refund), `NothingToClaim`, `MilestoneAlreadyReleased`, `DeadlineReached`, `NothingToRefund` (refund on a fully released grant), `GrantAlreadyRefunded`.
