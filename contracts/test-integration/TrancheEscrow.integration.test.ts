import crypto from 'node:crypto';
import fs from 'node:fs';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { createPublicClient, http, parseAbi, decodeErrorResult, defineChain, type Address } from 'viem';
import artifact from '/home/user/app/contracts/out/TrancheEscrow.sol/TrancheEscrow.json' with { type: 'json' };

const NETWORK = 'ARC-TESTNET';
if (!/(TESTNET|SEPOLIA|AMOY|FUJI|BLAZE|ALFAJORES|APOTHEM|DEVNET|HOLESKY)/.test(NETWORK)) {
  console.error(JSON.stringify({ testName: 'testnet-guard', status: 'FAIL' })); process.exit(1);
}
const ESCROW = '0x0c2b6081044d60b6e7ca9c8791ef66636ff6accb' as Address;
const USDC = '0x3600000000000000000000000000000000000000' as Address;
const ZERO = '0x0000000000000000000000000000000000000000';
const EXPLORER = 'https://explorer.testnet.arc.io/tx/';
const STATE = '/tmp/tranche-wallets.json';
const abi = artifact.abi as any;
const erc20 = parseAbi(['function balanceOf(address) view returns (uint256)', 'function approve(address,uint256) returns (bool)', 'function transfer(address,uint256) returns (bool)']);

const arc = defineChain({ id: 5042002, name: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } } });
const pub = createPublicClient({ chain: arc, transport: http() });
const wc = initiateDeveloperControlledWalletsClient({ apiKey: process.env.CIRCLE_API_KEY!, entitySecret: (process.env.ENTITY_SECRET || process.env.CIRCLE_ENTITY_SECRET)! });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: any[] = [];
const txTable: any[] = [];
function record(testName: string, ok: boolean, detail: string, extra: any = {}) {
  const r = { testName, status: ok ? 'PASS' : 'FAIL', detail, ...extra };
  results.push(r); console.log(JSON.stringify(r, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
}

async function setup() {
  const ws = await wc.createWalletSet({ name: `tranche-live-${Date.now()}`, idempotencyKey: crypto.randomUUID() });
  const walletSetId = ws.data?.walletSet?.id!;
  const w = await wc.createWallets({ blockchains: [NETWORK as any], count: 4, accountType: 'EOA', walletSetId, idempotencyKey: crypto.randomUUID() });
  const ws4 = w.data?.wallets!;
  const roles = ['funder', 'approver', 'recipientB', 'recipientC'];
  const state: any = {};
  roles.forEach((r, i) => (state[r] = { id: ws4[i].id, address: ws4[i].address }));
  state.walletSetId = walletSetId;
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
  console.log(JSON.stringify({ phase: 'setup', ...state }));
}

const TERMINAL = new Set(['COMPLETE', 'FAILED', 'DENIED', 'CANCELLED']);
async function waitTx(id: string, timeoutMs = 180_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await wc.getTransaction({ id });
    const t: any = r.data?.transaction;
    if (t?.state && TERMINAL.has(t.state)) {
      if (t.state === 'COMPLETE' && !t.txHash) { await sleep(1500); continue; }
      return t;
    }
    await sleep(1500);
  }
  throw new Error(`tx ${id} timeout`);
}

let S: any;
async function send(role: string, step: string, to: Address, sig: string, params: any[]) {
  try {
    const resp = await wc.createContractExecutionTransaction({
      walletId: S[role].id, contractAddress: to, abiFunctionSignature: sig, abiParameters: params,
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } }, idempotencyKey: crypto.randomUUID(),
    } as any);
    const id = resp.data?.id!;
    const t = await waitTx(id);
    const out = { state: t.state as string, txHash: t.txHash as string | undefined, txId: id, err: t.errorReason || t.errorDetails };
    txTable.push({ step, role, state: out.state, txHash: out.txHash, txId: id });
    return out;
  } catch (e: any) {
    const msg = (e?.response?.data ? JSON.stringify(e.response.data) : e?.message || String(e)).slice(0, 300);
    txTable.push({ step, role, state: 'REJECTED_AT_SUBMIT', txHash: undefined, txId: undefined });
    return { state: 'REJECTED_AT_SUBMIT', txHash: undefined as string | undefined, txId: undefined as string | undefined, err: msg };
  }
}

async function expectOk(role: string, step: string, to: Address, sig: string, params: any[]) {
  const t0 = Date.now();
  const o = await send(role, step, to, sig, params);
  record(step, o.state === 'COMPLETE', `${o.state} tx ${o.txHash}`, { txId: o.txId, txHash: o.txHash, durationMs: Date.now() - t0, err: o.state === 'COMPLETE' ? undefined : o.err });
  if (o.state !== 'COMPLETE') throw new Error(`${step} failed: ${JSON.stringify(o.err)}`);
  return o;
}

// Simulate from the sender to learn the revert error name, then submit live and require it not to succeed.
async function expectRevert(role: string, step: string, fn: string, args: any[], expectedErr: string, sig: string, params: any[]) {
  const t0 = Date.now();
  let errName = 'NO_REVERT';
  try {
    await pub.simulateContract({ address: ESCROW, abi, functionName: fn, args, account: S[role].address });
  } catch (e: any) {
    errName = e?.cause?.data?.errorName || e?.cause?.cause?.data?.errorName || (e?.shortMessage ?? 'revert-unknown');
    const m = /reverted with the following (?:custom )?(?:signature|reason): ?(.*)/.exec(e?.message || '');
    if (errName === 'revert-unknown' && m) errName = m[1];
  }
  const o = await send(role, step, ESCROW, sig, params);
  const ok = errName.includes(expectedErr) && o.state !== 'COMPLETE';
  record(step, ok, `sim error=${errName}; live state=${o.state}`, { expected: expectedErr, txHash: o.txHash, txId: o.txId, durationMs: Date.now() - t0 });
}

const bal = async (a: string) => (await pub.readContract({ address: USDC, abi: erc20, functionName: 'balanceOf', args: [a as Address] })) as bigint;
const claimableOf = async (a: string) => (await pub.readContract({ address: ESCROW, abi, functionName: 'claimable', args: [a] })) as bigint;
const getGrant = async (id: bigint) => (await pub.readContract({ address: ESCROW, abi, functionName: 'getGrant', args: [id] })) as any;
function eq(name: string, a: bigint, b: bigint) { record(name, a === b, `got ${a} expected ${b}`); }

async function run() {
  S = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  const DEADLINE_SECS = Number(process.env.DEADLINE_SECS || 300);
  const F = S.funder.address, A = S.approver.address, B = S.recipientB.address, C = S.recipientC.address;
  const M = [1000001n, 2000003n]; const M2 = [100000n];
  const G1_TOTAL = 3000004n, G2_TOTAL = 100000n;

  const fb = await bal(F);
  console.log(JSON.stringify({ phase: 'preflight', funderUsdc: fb.toString() }));
  if (fb < 4_000_000n) throw new Error('funder not funded');
  const baseline = await bal(ESCROW);
  console.log(JSON.stringify({ escrowBaseline: baseline.toString() }));

  // ---- fund approver / recipients with gas USDC from funder
  for (const [role, addr] of [['approver', A], ['recipientB', B], ['recipientC', C]] as const) {
    if ((await bal(addr)) >= 400_000n) continue;
    await expectOk('funder', `fund ${role} 0.5 USDC (transfer)`, USDC, 'transfer(address,uint256)', [addr, '500000']);
  }

  // ---- approve + createGrant (3 recipients 3333/3333/3334, milestones [1000001,2000003])
  await expectOk('funder', 'funder approve escrow (3.2 USDC)', USDC, 'approve(address,uint256)', [ESCROW, '3200000']);
  const head = await pub.getBlock();
  const t0 = Number(head.timestamp);
  const wall0 = Date.now();
  const deadline = t0 + DEADLINE_SECS;
  const idBefore = (await pub.readContract({ address: ESCROW, abi, functionName: 'nextGrantId' })) as bigint;
  const recips = `[${A},${B},${C}]`;
  const c1 = await expectOk('funder', 'createGrant #1 (3 recipients, 2 milestones)', ESCROW,
    'createGrant(address,address[],uint256[],uint256[],uint256,string)',
    [A, [A, B, C], ['3333', '3333', '3334'], M.map(String), String(deadline), 'Tranche live demo grant']);
  const g1 = idBefore;
  let gr = await getGrant(g1);
  record('createGrant stores funder/approver/total/deadline', gr.funder.toLowerCase() === F.toLowerCase() && gr.approver.toLowerCase() === A.toLowerCase() && gr.totalAmount === G1_TOTAL && gr.deadline === BigInt(deadline) && gr.recipients.length === 3,
    `grantId=${g1} total=${gr.totalAmount} deadline=${gr.deadline}`);
  console.log(JSON.stringify({ grantId: g1.toString(), deadline, deadlineIso: new Date(deadline * 1000).toISOString() }));
  eq('escrow USDC after createGrant #1', await bal(ESCROW), baseline + G1_TOTAL);

  const g2 = g1 + 1n;
  await expectOk('funder', 'createGrant #2 (single milestone, fully-released scenario)', ESCROW,
    'createGrant(address,address[],uint256[],uint256[],uint256,string)',
    [A, [A, B, C], ['3333', '3333', '3334'], M2.map(String), String(deadline), 'Tranche live demo grant 2 (fully released)']);
  eq('nextGrantId advanced by 2', (await pub.readContract({ address: ESCROW, abi, functionName: 'nextGrantId' })) as bigint, g1 + 2n);
  eq('escrow USDC after createGrant #2', await bal(ESCROW), baseline + G1_TOTAL + G2_TOTAL);

  // ---- access control / early negatives
  await expectRevert('funder', 'non-approver releaseMilestone(g1,0) reverts', 'releaseMilestone', [g1, 0n], 'NotApprover', 'releaseMilestone(uint256,uint256)', [g1.toString(), '0']);
  await expectRevert('recipientB', 'non-funder changeApprover reverts', 'changeApprover', [g1, B], 'NotFunder', 'changeApprover(uint256,address)', [g1.toString(), B]);
  await expectRevert('funder', 'changeApprover(zero address) reverts', 'changeApprover', [g1, ZERO], 'ZeroAddress', 'changeApprover(uint256,address)', [g1.toString(), ZERO]);
  await expectRevert('funder', 'refund before deadline reverts (g1)', 'refund', [g1], 'DeadlineNotReached', 'refund(uint256)', [g1.toString()]);
  await expectRevert('recipientB', 'claim with nothing claimable reverts', 'claim', [], 'NothingToClaim', 'claim()', []);

  // ---- release
  await expectOk('approver', 'releaseMilestone(g1, 0)', ESCROW, 'releaseMilestone(uint256,uint256)', [g1.toString(), '0']);
  gr = await getGrant(g1);
  record('g1 milestone 0 released flag / releasedAmount', gr.released[0] === true && gr.released[1] === false && gr.releasedAmount === M[0], `released=${gr.released} releasedAmount=${gr.releasedAmount}`);
  eq('claimable A after g1 m0 (333300 + 1 dust)', await claimableOf(A), 333301n);
  eq('claimable B after g1 m0', await claimableOf(B), 333300n);
  eq('claimable C after g1 m0', await claimableOf(C), 333400n);
  await expectRevert('approver', 'double release releaseMilestone(g1,0) reverts', 'releaseMilestone', [g1, 0n], 'MilestoneAlreadyReleased', 'releaseMilestone(uint256,uint256)', [g1.toString(), '0']);
  await expectOk('approver', 'releaseMilestone(g2, 0)', ESCROW, 'releaseMilestone(uint256,uint256)', [g2.toString(), '0']);
  eq('claimable A after g2 m0', await claimableOf(A), 366631n);
  eq('claimable B after g2 m0', await claimableOf(B), 366630n);
  eq('claimable C after g2 m0', await claimableOf(C), 366740n);

  // ---- claims
  for (const [role, addr, exp] of [['approver', A, 366631n], ['recipientB', B, 366630n], ['recipientC', C, 366740n]] as const) {
    const before = await bal(addr);
    await expectOk(role, `claim() by ${role}`, ESCROW, 'claim()', []);
    const after = await bal(addr);
    // USDC is also native gas on Arc, so the ERC-20 delta includes gas paid; verify via claimable cleared + net >= exp - gas allowance
    const cl = await claimableOf(addr);
    record(`claim ${role} clears claimable and credits USDC`, cl === 0n && after + 50_000n > before + exp - 0n && after - before <= exp, `claimable=${cl} balDelta=${after - before} expected~${exp} (gas paid in same token)`);
  }
  await expectRevert('recipientC', 'double claim reverts', 'claim', [], 'NothingToClaim', 'claim()', []);
  eq('escrow USDC after all claims', await bal(ESCROW), baseline + G1_TOTAL + G2_TOTAL - 1100001n);

  // ---- wait for deadline
  const waitUntilChain = async () => { for (;;) { const b = await pub.getBlock(); if (Number(b.timestamp) >= deadline + 2) return; console.log(JSON.stringify({ waiting: deadline - Number(b.timestamp) })); await sleep(10_000); } };
  const pre = await pub.getBlock();
  record('precondition: all pre-deadline steps done before deadline', Number(pre.timestamp) < deadline, `chain ts ${pre.timestamp} < deadline ${deadline} (elapsed ${(Date.now() - wall0) / 1000}s)`);
  await waitUntilChain();

  // ---- post-deadline
  await expectRevert('approver', 'releaseMilestone(g1,1) after deadline reverts', 'releaseMilestone', [g1, 1n], 'DeadlineReached', 'releaseMilestone(uint256,uint256)', [g1.toString(), '1']);
  await expectRevert('recipientB', 'non-funder refund(g1) after deadline reverts', 'refund', [g1], 'NotFunder', 'refund(uint256)', [g1.toString()]);
  await expectRevert('funder', 'refund on fully released grant (g2) reverts NothingToRefund', 'refund', [g2], 'NothingToRefund', 'refund(uint256)', [g2.toString()]);
  const fBefore = await bal(F);
  await expectOk('funder', 'refund(g1) returns unreleased milestone', ESCROW, 'refund(uint256)', [g1.toString()]);
  const fAfter = await bal(F);
  gr = await getGrant(g1);
  record('refund marks refunded and returns only unreleased 2000003', gr.refunded === true && fAfter - fBefore <= 2000003n && fAfter - fBefore > 1_900_000n, `funder balDelta=${fAfter - fBefore} (2000003 minus gas paid in same token)`);
  eq('escrow USDC returns to baseline', await bal(ESCROW), baseline);
  await expectRevert('funder', 'second refund(g1) reverts', 'refund', [g1], 'GrantAlreadyRefunded', 'refund(uint256)', [g1.toString()]);
  await expectRevert('funder', 'changeApprover on refunded grant reverts', 'changeApprover', [g1, B], 'GrantAlreadyRefunded', 'changeApprover(uint256,address)', [g1.toString(), B]);

  const pass = results.filter((r) => r.status === 'PASS').length;
  console.log(JSON.stringify({ summary: { pass, fail: results.length - pass }, grantId1: g1.toString(), grantId2: g2.toString() }));
  console.log('TXTABLE ' + JSON.stringify(txTable.map((t) => ({ ...t, link: t.txHash ? EXPLORER + t.txHash : null }))));
  return results.length - pass;
}

const phase = process.argv[2];
(async () => {
  if (phase === 'setup') { await setup(); process.exit(0); }
  let code = 1;
  try { code = (await run()) ? 1 : 0; } catch (e: any) {
    console.error(JSON.stringify({ fatal: String(e?.message || e).slice(0, 500) }));
    console.log('TXTABLE ' + JSON.stringify(txTable.map((t) => ({ ...t, link: t.txHash ? EXPLORER + t.txHash : null }))));
  }
  process.exit(code);
})();
