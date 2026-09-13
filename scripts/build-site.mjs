/**
 * Assembles the static site Vercel serves.
 *
 * The pages are plain HTML with no build step, so this only gathers the three things the site
 * actually needs and leaves contracts, tests, artifacts and typechain output behind. Keeping one
 * source of truth matters more than avoiding a copy: the files served are byte-identical to the
 * ones served by `npx http-server .` locally, so what you rehearse is what ships.
 *
 *   node scripts/build-site.mjs
 */
import { mkdir, copyFile, rm, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

const OUT = "public";

const FILES = [
  // published path                source
  ["index.html", "index.html"],
  ["frontend/index.html", "frontend/index.html"],
  ["deployments/creditcoin.json", "deployments/creditcoin.json"],
  ["deployments/sepolia.json", "deployments/sepolia.json"],
  ["brand/quita-logo.svg", "docs/brand/quita-logo.svg"],
  ["brand/quita-logo.png", "docs/brand/quita-logo.png"]
];

async function main() {
  await rm(OUT, { recursive: true, force: true });

  const missing = [];
  for (const [published, source] of FILES) {
    if (!existsSync(source)) { missing.push(source); continue; }
    const dest = join(OUT, published);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(source, dest);
  }

  if (missing.length) {
    // A dashboard with no deployment file renders an honest "not deployed" state rather than
    // breaking, so this is a warning — but silently shipping a half-built site is not acceptable.
    console.error("MISSING, not copied:");
    for (const m of missing) console.error("  " + m);
    if (missing.includes("index.html") || missing.includes("frontend/index.html")) {
      console.error("A page is missing. Refusing to publish a broken site.");
      process.exit(1);
    }
  }

  // Surface which deployment the published dashboard will read, so a stale file is obvious in
  // the build log rather than three clicks into the deployed page.
  try {
    const cc = JSON.parse(await readFile("deployments/creditcoin.json", "utf8"));
    console.log(`dashboard will read CC3 chainId ${cc.chainId}`);
    console.log(`  LoanMirror  ${cc.loanMirror}`);
    console.log(`  deployed at block ${cc.deployedAtBlock} (${cc.timestamp})`);
  } catch {
    console.log("no deployments/creditcoin.json — the dashboard will show its not-deployed state");
  }

  await writeFile(join(OUT, "robots.txt"), "User-agent: *\nAllow: /\n");

  console.log(`\nbuilt ${OUT}/ with ${FILES.length - missing.length} files`);
}

main().catch((e) => { console.error(e); process.exit(1); });
