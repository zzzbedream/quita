import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { PhaseTimer } from "./lib/attestcoin";

/**
 * Full end-to-end cycle on a local Hardhat node, with no testnet funds required.
 *
 * WHAT IS REAL HERE: every contract, the ASCBase verification sequence, the replay guard, the
 * receiptStatus check, the emitter check, the chainKey pin, the decoder, the policy maths and the
 * settlement logic. The `encodedTransaction` payloads are built in the exact layout the real
 * prover emits, so `EvmV1Decoder` does genuine work.
 *
 * WHAT IS SIMULATED: only the BlockProver precompile itself, which is native Rust runtime code
 * that cannot exist on a Hardhat node. Mock bytecode is installed at the real address 0xFD2.
 *
 * On testnet the only difference is that 0xFD2 is the real precompile and the proof comes from
 * the Proof Builder rather than from a fixture. The contracts are byte-identical.
 *
 *   npx hardhat node                                    # terminal 1
 *   npx hardhat run scripts/demo.local.ts --network localhost   # terminal 2
 */

const SEPOLIA_CHAIN_KEY = 1n;
const MAINNET_CHAIN_KEY = 3n;
const PRECOMPILE = "0x0000000000000000000000000000000000000FD2";

const ACTION = { DISBURSE: 0, REPAY: 1, PREMIUM: 0, ATTEST: 0 };

const abi = ethers.AbiCoder.defaultAbiCoder();

const SIG = {
  disbursed: ethers.id("LoanDisbursed(bytes32,bytes32,address,uint256,uint32,uint8,uint8)"),
  repaid: ethers.id("RepaymentMade(bytes32,uint256,uint256)"),
  premium: ethers.id("PremiumPaid(bytes32,uint256,uint64)"),
  death: ethers.id("DeathAttested(bytes32,bytes32,uint64,bytes32,address)"),
};

interface LogFixture {
  emitter: string;
  topics: string[];
  data: string;
}

/** Rebuilds the prover payload: abi.encode(uint8 txType, bytes[] chunks). */
function encodeTx(logs: LogFixture[], receiptStatus = 1): string {
  const common = abi.encode(
    ["uint64", "uint64", "address", "bool", "address", "uint256", "bytes"],
    [7n, 500_000n, ethers.ZeroAddress, false, ethers.ZeroAddress, 0n, "0x"]
  );
  const typed = abi.encode(
    ["uint64", "uint128", "uint128", "tuple(address,bytes32[])[]", "uint8", "bytes32", "bytes32"],
    [11155111n, 1_000_000_000n, 30_000_000_000n, [], 0, ethers.ZeroHash, ethers.ZeroHash]
  );
  const receipt = abi.encode(
    ["uint8", "uint64", "tuple(address,bytes32[],bytes)[]", "bytes"],
    [
      receiptStatus,
      120_000n,
      logs.map((l) => [l.emitter, l.topics, l.data]),
      "0x" + "00".repeat(256),
    ]
  );
  return abi.encode(["uint8", "bytes[]"], [2, [common, typed, receipt]]);
}

function proof(txIndex: number, height: bigint) {
  const siblings = [];
  for (let bit = 0; bit < 8; bit++) {
    siblings.push({
      hash: ethers.keccak256(ethers.toUtf8Bytes(`s-${height}-${txIndex}-${bit}`)),
      isLeft: ((txIndex >> bit) & 1) === 1,
    });
  }
  return [
    ethers.keccak256(ethers.toUtf8Bytes(`root-${height}`)),
    siblings,
    ethers.keccak256(ethers.toUtf8Bytes("lower")),
    [ethers.keccak256(ethers.toUtf8Bytes(`cont-${height}`))],
  ] as [string, Array<{ hash: string; isLeft: boolean }>, string, string[]];
}

const line = (s = "") => console.log(s);
const rule = (t: string) =>
  console.log("\n" + "─".repeat(78) + "\n  " + t + "\n" + "─".repeat(78));

async function main() {
  const timer = new PhaseTimer();
  const [deployer, lp, attestorA, attestorB, attestorC, lender] = await ethers.getSigners();

  rule("SETUP  ·  installing the mock BlockProver at 0xFD2");

  const verifierFactory = await ethers.getContractFactory("MockNativeQueryVerifier");
  const verifierDeploy = await verifierFactory.deploy();
  await verifierDeploy.waitForDeployment();
  const code = await ethers.provider.getCode(await verifierDeploy.getAddress());
  await network.provider.send("hardhat_setCode", [PRECOMPILE, code]);
  const verifier = verifierFactory.attach(PRECOMPILE) as any;
  await verifier.setShouldVerify(true);
  line(`  mock verifier installed at ${PRECOMPILE}`);
  line(`  (on testnet this address is the real native precompile)`);

  // QuitaOrigin stands in for the Sepolia deployment. On a local node both "chains" share the
  // same EVM, but the consumers only ever see it as a pinned emitter address.
  const origin = await (await ethers.getContractFactory("QuitaOrigin")).deploy(deployer.address);
  await origin.waitForDeployment();
  const ORIGIN = await origin.getAddress();
  await (await origin.setLender(lender.address, true)).wait();
  for (const a of [attestorA, attestorB, attestorC]) {
    await (await origin.setAttestor(a.address, true)).wait();
  }

  const stable = await (await ethers.getContractFactory("MockStable")).deploy();
  await stable.waitForDeployment();
  const mirror = await (
    await ethers.getContractFactory("LoanMirror")
  ).deploy(SEPOLIA_CHAIN_KEY, ORIGIN);
  await mirror.waitForDeployment();
  const pool = await (
    await ethers.getContractFactory("CapitalPool")
  ).deploy(await stable.getAddress(), ethers.parseUnits("100000", 6), deployer.address);
  await pool.waitForDeployment();
  const registry = await (
    await ethers.getContractFactory("PolicyRegistry")
  ).deploy(SEPOLIA_CHAIN_KEY, ORIGIN, await mirror.getAddress(), deployer.address);
  await registry.waitForDeployment();
  const claims = await (
    await ethers.getContractFactory("ClaimEngine")
  ).deploy(
    SEPOLIA_CHAIN_KEY,
    ORIGIN,
    await mirror.getAddress(),
    await registry.getAddress(),
    await pool.getAddress(),
    deployer.address
  );
  await claims.waitForDeployment();

  await (await registry.setCapitalPool(await pool.getAddress())).wait();
  await (await registry.setClaimEngine(await claims.getAddress())).wait();
  await (await pool.setAuthorized(await registry.getAddress(), true)).wait();
  await (await pool.setAuthorized(await claims.getAddress(), true)).wait();
  for (const a of [attestorA, attestorB, attestorC]) {
    await (await claims.setAttestor(a.address, true)).wait();
  }
  await (await registry.setWaitingPeriod(0)).wait();
  await (await claims.setChallengeWindow(120)).wait();

  // Capitalise
  const capital = ethers.parseUnits("1000000", 6);
  await (await stable.mint(lp.address, capital)).wait();
  await (await stable.connect(lp).approve(await pool.getAddress(), capital)).wait();
  await (await pool.connect(lp).deposit(capital)).wait();
  timer.mark("setup complete", `pool capitalised with ${ethers.formatUnits(capital, 6)} qUSD`);

  // ------------------------------------------------------------------
  rule("1  ·  ORIGINATE on the source chain");

  const loanId = ethers.keccak256(ethers.toUtf8Bytes("demo-loan-001"));
  const nationalId = ethers.keccak256(ethers.toUtf8Bytes("123.456.789-00"));
  const salt = ethers.hexlify(ethers.randomBytes(32));
  const commitment = await origin.commitmentFor(nationalId, loanId, salt);
  const principal = ethers.parseUnits("25000", 6);

  await (
    await origin.connect(lender).disburse(loanId, commitment, principal, 36, 6, 1)
  ).wait();
  line(`  loanId       ${loanId}`);
  line(`  commitment   ${commitment}`);
  line(`  (no national id on chain: salted hash only, LGPD requirement)`);
  line(`  principal    ${ethers.formatUnits(principal, 6)}`);
  timer.mark("originated");

  // ------------------------------------------------------------------
  rule("2  ·  VERIFY the disbursement on Creditcoin");

  const disburseTx = encodeTx([
    {
      emitter: ORIGIN,
      topics: [SIG.disbursed, loanId, commitment],
      data: abi.encode(
        ["address", "uint256", "uint32", "uint8", "uint8"],
        [lender.address, principal, 36, 6, 1]
      ),
    },
  ]);

  await (
    await mirror.executeFromSource(
      ACTION.DISBURSE,
      SEPOLIA_CHAIN_KEY,
      100n,
      disburseTx,
      ...proof(1, 100n)
    )
  ).wait();
  line(`  outstanding on Creditcoin: ${ethers.formatUnits(await mirror.outstanding(loanId), 6)}`);
  line(`  verified by the precompile — no operator asserted this number`);
  timer.mark("mirrored");

  // ------------------------------------------------------------------
  rule("3  ·  ATTACKS that the verification layer rejects");

  const tryIt = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      line(`  !! ${label}: NOT REJECTED - this would be a bug`);
      process.exitCode = 1;
    } catch (e) {
      const m = (e as Error).message;
      const custom = m.match(/reverted with custom error '([^']+)'/)?.[1];
      const reason = m.match(/reverted with reason string '([^']+)'/)?.[1];
      if (!custom && !reason) {
        // A client-side failure (bad checksum, encoding error) never reaches the contract, so it
        // would read as a pass while proving nothing. Surface it as a failure instead.
        line(`  !! ${label}: rejected OFF-CHAIN, contract never called`);
        line(`     ${m.replace(/\s+/g, " ").slice(0, 90)}`);
        process.exitCode = 1;
        return;
      }
      line(`  rejected  ${label.padEnd(34)} ${custom ?? reason}`);
    }
  };

  await tryIt("replayed proof", () =>
    mirror.executeFromSource(
      ACTION.DISBURSE,
      SEPOLIA_CHAIN_KEY,
      100n,
      disburseTx,
      ...proof(1, 100n)
    )
  );

  await tryIt("reverted source transaction", () =>
    mirror.executeFromSource(
      ACTION.DISBURSE,
      SEPOLIA_CHAIN_KEY,
      101n,
      encodeTx(
        [
          {
            emitter: ORIGIN,
            topics: [
              SIG.disbursed,
              ethers.keccak256(ethers.toUtf8Bytes("fake")),
              commitment,
            ],
            data: abi.encode(
              ["address", "uint256", "uint32", "uint8", "uint8"],
              [lender.address, principal, 36, 6, 1]
            ),
          },
        ],
        0 // receiptStatus = 0
      ),
      ...proof(2, 101n)
    )
  );

  await tryIt("cloned emitter contract", () =>
    mirror.executeFromSource(
      ACTION.DISBURSE,
      SEPOLIA_CHAIN_KEY,
      102n,
      encodeTx([
        {
          emitter: "0x00000000000000000000000000000000DeaDBeef",
          topics: [SIG.disbursed, ethers.keccak256(ethers.toUtf8Bytes("clone")), commitment],
          data: abi.encode(
            ["address", "uint256", "uint32", "uint8", "uint8"],
            [lender.address, principal, 36, 6, 1]
          ),
        },
      ]),
      ...proof(3, 102n)
    )
  );

  await tryIt("proof from a different chain", () =>
    mirror.executeFromSource(
      ACTION.DISBURSE,
      MAINNET_CHAIN_KEY,
      103n,
      disburseTx,
      ...proof(4, 103n)
    )
  );

  await tryIt("unguarded inherited execute", () =>
    mirror.execute(ACTION.DISBURSE, SEPOLIA_CHAIN_KEY, 104n, disburseTx, ...proof(5, 104n))
  );

  // ------------------------------------------------------------------
  rule("4  ·  UNDERWRITE against the verified balance");

  await (await registry.underwrite(loanId)).wait();
  const policy = await registry.getPolicy(loanId);
  line(`  sum insured  ${ethers.formatUnits(policy.sumInsured, 6)}  (read from LoanMirror)`);
  line(`  monthly rate ${policy.premiumRateWad} wad  (age band ${policy.ageBand}, sex ${policy.sex})`);
  line(`  rate source  ${await registry.TABLE_SOURCE()}`);
  line(`  locked capital in pool: ${ethers.formatUnits(await pool.lockedCapital(), 6)}`);
  timer.mark("underwritten");

  // ------------------------------------------------------------------
  rule("5  ·  REPAY, then verify the new balance");

  await (await origin.connect(lender).repay(loanId, ethers.parseUnits("5000", 6))).wait();
  await (
    await mirror.executeFromSource(
      ACTION.REPAY,
      SEPOLIA_CHAIN_KEY,
      200n,
      encodeTx([
        {
          emitter: ORIGIN,
          topics: [SIG.repaid, loanId],
          data: abi.encode(
            ["uint256", "uint256"],
            [ethers.parseUnits("5000", 6), ethers.parseUnits("20000", 6)]
          ),
        },
      ]),
      ...proof(6, 200n)
    )
  ).wait();
  await (await registry.syncSumInsured(loanId)).wait();
  line(`  outstanding  ${ethers.formatUnits(await mirror.outstanding(loanId), 6)}`);
  line(`  sum insured  ${ethers.formatUnits((await registry.getPolicy(loanId)).sumInsured, 6)}`);
  line(`  cover follows the verified declining balance`);
  timer.mark("repayment verified");

  // ------------------------------------------------------------------
  rule("6  ·  PREMIUM collected, proved from the source chain");

  await (
    await origin.connect(lender).payPremium(loanId, ethers.parseUnits("48", 6), 1n)
  ).wait();
  await (
    await registry.executeFromSource(
      ACTION.PREMIUM,
      SEPOLIA_CHAIN_KEY,
      300n,
      encodeTx([
        {
          emitter: ORIGIN,
          topics: [SIG.premium, loanId],
          data: abi.encode(["uint256", "uint64"], [ethers.parseUnits("48", 6), 1n]),
        },
      ]),
      ...proof(7, 300n)
    )
  ).wait();
  line(`  premiums collected: ${ethers.formatUnits(await pool.totalPremiumsCollected(), 6)}`);
  line(`  this is the DENOMINATOR of the loss ratio, and it is verified`);
  timer.mark("premium verified");

  // ------------------------------------------------------------------
  rule("6b  ·  BOOK  ·  seed further policies so the ratios have a denominator");

  // Every one of these loans still has to arrive through a verified proof. There is no operator
  // path that creates a loan, which is exactly the property the project is arguing for.
  const BOOK_SIZE = 8;
  const PERIODS = 18;
  let height = 600n;
  let idx = 20;

  for (let i = 0; i < BOOK_SIZE; i++) {
    const id = ethers.keccak256(ethers.toUtf8Bytes(`book-loan-${i}`));
    const commit = ethers.keccak256(ethers.toUtf8Bytes(`book-commit-${i}`));
    const amount = ethers.parseUnits(String(12000 + i * 4500), 6);
    const band = 2 + (i % 7);
    const sex = i % 2;

    await (await origin.connect(lender).disburse(id, commit, amount, 36, band, sex)).wait();
    await (
      await mirror.executeFromSource(
        ACTION.DISBURSE,
        SEPOLIA_CHAIN_KEY,
        height,
        encodeTx([
          {
            emitter: ORIGIN,
            topics: [SIG.disbursed, id, commit],
            data: abi.encode(
              ["address", "uint256", "uint32", "uint8", "uint8"],
              [lender.address, amount, 36, band, sex]
            ),
          },
        ]),
        ...proof(idx++, height)
      )
    ).wait();
    await (await registry.underwrite(id)).wait();
    height += 1n;

    // Premium history: each period is a separately proved PremiumPaid event.
    const monthly = (amount * (await registry.monthlyRateWad(band, sex))) / 10n ** 18n;
    for (let period = 1; period <= PERIODS; period++) {
      await (await origin.connect(lender).payPremium(id, monthly, BigInt(period))).wait();
      await (
        await registry.executeFromSource(
          ACTION.PREMIUM,
          SEPOLIA_CHAIN_KEY,
          height,
          encodeTx([
            {
              emitter: ORIGIN,
              topics: [SIG.premium, id],
              data: abi.encode(["uint256", "uint64"], [monthly, BigInt(period)]),
            },
          ]),
          ...proof(idx++, height)
        )
      ).wait();
      height += 1n;
    }
  }

  line(`  ${BOOK_SIZE} further policies written, each from a verified disbursement`);
  line(`  ${BOOK_SIZE * PERIODS} premium payments, each individually proved`);
  line(`  premiums collected so far: ${ethers.formatUnits(await pool.totalPremiumsCollected(), 6)}`);
  timer.mark("book seeded");

  // ------------------------------------------------------------------
  rule("7  ·  DEATH attestations  ·  2-of-3 threshold");

  const evidence = ethers.keccak256(ethers.toUtf8Bytes("death-certificate"));
  const dod = BigInt(Math.floor(Date.now() / 1000));

  const attestTx = (who: string) =>
    encodeTx([
      {
        emitter: ORIGIN,
        topics: [SIG.death, commitment, loanId],
        data: abi.encode(["uint64", "bytes32", "address"], [dod, evidence, who]),
      },
    ]);

  await (await origin.connect(attestorA).attestDeath(loanId, dod, evidence)).wait();
  await (
    await claims.executeFromSource(
      ACTION.ATTEST,
      SEPOLIA_CHAIN_KEY,
      400n,
      attestTx(attestorA.address),
      ...proof(8, 400n)
    )
  ).wait();
  line(`  attestation 1 of 2 recorded  (${attestorA.address.slice(0, 10)}…)`);

  await tryIt("settle below threshold", () => claims.settle(loanId));

  await (await origin.connect(attestorB).attestDeath(loanId, dod, evidence)).wait();
  await (
    await claims.executeFromSource(
      ACTION.ATTEST,
      SEPOLIA_CHAIN_KEY,
      401n,
      attestTx(attestorB.address),
      ...proof(9, 401n)
    )
  ).wait();

  const claim = await claims.getClaim(loanId);
  line(`  attestation 2 of 2 recorded  (${attestorB.address.slice(0, 10)}…)`);
  line(`  threshold reached → challenge window open until ${claim.challengeDeadline}`);
  timer.mark("threshold reached");

  await tryIt("settle inside challenge window", () => claims.settle(loanId));

  // ------------------------------------------------------------------
  rule("8  ·  CHALLENGE WINDOW elapses");

  const cw = Number(await claims.challengeWindow());
  line(`  challenge window is ${cw}s (shortened for demonstration; production default 24h)`);
  await network.provider.send("evm_increaseTime", [cw + 1]);
  await network.provider.send("evm_mine", []);
  line(`  ${cw}s advanced on the local chain`);
  timer.mark("window elapsed");

  // ------------------------------------------------------------------
  rule("9  ·  SETTLE  ·  the lender is paid");

  const before = await stable.balanceOf(lender.address);
  await (await claims.settle(loanId)).wait();
  const after = await stable.balanceOf(lender.address);

  line(`  payout        ${ethers.formatUnits(after - before, 6)} qUSD`);
  line(`  paid to       ${lender.address}  (the LENDER, not the family)`);
  line(`  formula       min(sumInsured, verified outstanding)`);
  line(`  policy status ${(await registry.getPolicy(loanId)).status}  (3 = Claimed)`);
  timer.mark("settled");

  await tryIt("double settle", () => claims.settle(loanId));

  // ------------------------------------------------------------------
  rule("10  ·  THE BOOK  ·  every number derived from verified events");

  const [loss, solv, assets, locked, free, prem, paid, active, insured] = await Promise.all([
    pool.lossRatioWad(),
    pool.solvencyRatioWad(),
    pool.totalAssets(),
    pool.lockedCapital(),
    pool.freeCapacity(),
    pool.totalPremiumsCollected(),
    pool.totalClaimsPaid(),
    registry.activePolicyCount(),
    registry.totalSumInsured(),
  ]);

  const pct = (w: bigint) => (Number(w) / 1e18 * 100).toFixed(1) + "%";
  const x = (w: bigint) => (Number(w) / 1e18).toFixed(2) + "x";
  const u = (v: bigint) => ethers.formatUnits(v, 6);

  const policyTotal = Number(await registry.policyCount());
  line(`  loss ratio           ${pct(loss)}   (BR market ~18%, unaudited estimate)`);
  line(`     NOTE: one claim against a demo book of ${policyTotal} policies. A real book prices`);
  line(`     for roughly one death per thousand policy-years, so this ratio is a demonstration`);
  line(`     of the MECHANISM, not a market-comparable figure.`);
  line(`  solvency vs MCR      ${x(solv)}`);
  line(`  reserves             ${u(assets)}`);
  line(`  locked / free        ${u(locked)} / ${u(free)}`);
  line(`  premiums collected   ${u(prem)}`);
  line(`  claims paid          ${u(paid)}`);
  line(`  active policies      ${active}`);
  line(`  insured balance      ${u(insured)}`);

  rule("11  ·  MCR  ·  claims are never paused, underwriting is");

  await (await pool.setMcr(ethers.parseUnits("500000000", 6))).wait();
  line(`  MCR raised far above assets → below MCR: ${await pool.isBelowMcr()}`);

  const loan2 = ethers.keccak256(ethers.toUtf8Bytes("demo-loan-002"));
  await (
    await origin
      .connect(lender)
      .disburse(loan2, commitment, ethers.parseUnits("10000", 6), 24, 4, 0)
  ).wait();
  await (
    await mirror.executeFromSource(
      ACTION.DISBURSE,
      SEPOLIA_CHAIN_KEY,
      500n,
      encodeTx([
        {
          emitter: ORIGIN,
          topics: [SIG.disbursed, loan2, commitment],
          data: abi.encode(
            ["address", "uint256", "uint32", "uint8", "uint8"],
            [lender.address, ethers.parseUnits("10000", 6), 24, 4, 0]
          ),
        },
      ]),
      ...proof(10, 500n)
    )
  ).wait();

  await tryIt("underwrite while below MCR", () => registry.underwrite(loan2));
  line(`  but the claim above was already paid in full while undercapitalised.`);
  line(`  an insurer that stops paying when solvency dips is not an insurer.`);

  await (await pool.setMcr(ethers.parseUnits("100000", 6))).wait();

  // ------------------------------------------------------------------
  // Write a deployment file so the dashboard can read this local run.
  const out = {
    network: "localhost",
    chainId: (await ethers.provider.getNetwork()).chainId.toString(),
    sourceChainKey: Number(SEPOLIA_CHAIN_KEY),
    sourceEmitter: ORIGIN,
    mockStable: await stable.getAddress(),
    loanMirror: await mirror.getAddress(),
    capitalPool: await pool.getAddress(),
    policyRegistry: await registry.getAddress(),
    claimEngine: await claims.getAddress(),
    deployedAtBlock: await ethers.provider.getBlockNumber(),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
  };
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "localhost.json"), JSON.stringify(out, null, 2) + "\n");

  rule("DONE");
  line(`  total elapsed ${timer.total()}s`);
  line(`  deployments/localhost.json written`);
  line(``);
  line(`  To see the dashboard against this run:`);
  line(`    npx http-server . -p 8080   (from the repo root, or any static server)`);
  line(`    open http://localhost:8080/frontend/index.html?net=local`);
  line(``);
  line(`  Keep the hardhat node running or the dashboard has nothing to read.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
