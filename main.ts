// Token radar entry point (rewritten; Node 22, standard library only).
//
// Reads the sealed snapshot (from /input/snapshot.json, or --input), scores
// every pre-token protocol with the model in lib/model.ts, and writes the
// run's outputs: the ranked board, the dashboard's data, the dashboard and
// screenshots copied verbatim, and the dossier the judge reads, built with
// the vendored make.fun library.
//
// The dashboard is a static page — no framework, no network. It reads the
// data.js this program writes beside it. Outside the grader's container,
// MAKEFUN_OUTPUT_DIR stands in for /output:
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps: the text cap shapes the bytes, the rest refuse. */
const DOSSIER_TEXT_CAP = 65_536;
const SHOT_LIMITS = { max: 4, max_bytes: 524_288 };
const DASH_LIMITS = { max_files: 400, max_bytes: 4_194_304 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Fail with a message on stderr and a non-zero exit. */
function die(message: string, code = 1): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

/** Read `--flag value` or `--flag=value` out of argv, or fall back. */
function flagValue(flag: string, fallback: string): string {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === `--${flag}` && i + 1 < args.length) return args[i + 1]!;
    if (a.startsWith(`--${flag}=`)) return a.slice(flag.length + 3);
  }
  return fallback;
}

const inputGiven = flagValue('input', '/input');
const snapshotPath = inputGiven.endsWith('.json') ? inputGiven : join(inputGiven, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  die(
    `no snapshot at ${snapshotPath}: pass --input <snapshot.json|directory> or mount the sealed /input`,
    2,
  );
}
const outDir = flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const problem = boardIssue(board, snapshot);
if (problem !== null) die(`the model wrote a board the gate refuses: ${problem}`);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), JSON.stringify({ rows: board }) + '\n');
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

/**
 * Mirror one directory's plain files into `dest`, skipping dotfiles and
 * subdirectories. Returns the names copied, in directory order.
 */
function mirrorDir(src: string, dest: string): string[] {
  if (!existsSync(src)) return [];
  mkdirSync(dest, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(src)) {
    if (name.startsWith('.')) continue;
    const from = join(src, name);
    if (!statSync(from).isFile()) continue;
    copyFileSync(from, join(dest, name));
    names.push(name);
  }
  return names;
}

const dashFiles = mirrorDir(join(ROOT, 'dashboard'), join(outDir, 'dashboard'));
if (dashFiles.length === 0) die('dashboard/ holds no files: the page cannot render without them');
const shots = mirrorDir(join(ROOT, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3) {
  die(
    `screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`,
  );
}
for (const name of shots) {
  if (!SHOT_NAME.test(name)) {
    die(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
  }
}

// The dossier goes last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, { text_max_bytes: DOSSIER_TEXT_CAP, screenshots: SHOT_LIMITS, dashboard: DASH_LIMITS }),
);

const earlyCount = radar.early_size;
const liveCount = radar.live_size;
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ` +
    `${board.length} rows scored (${earlyCount} early, ${liveCount} live set aside)\n` +
    `token radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ` +
    `${join(outDir, 'dashboard')} (${dashFiles.length} files), ${join(outDir, 'screenshots')} ` +
    `(${shots.length} images) and ${join(outDir, 'dossier.json')}\n`,
);
