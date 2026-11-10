#!/usr/bin/env node
/**
 * Smoke test de l'adapter aspace-nansen-cli (couture contrat seule).
 *
 * Surface testee : --version, doctor --offline, auth status, completion bash.
 * Regles :
 *  - stdlib Node seule, aucune dependance.
 *  - HOME scratch (mkdtemp), jamais le vrai HOME.
 *  - Environnement enfant reconstruit de zero : PATH + les 4 gardes
 *    (NANSEN_NO_TELEMETRY=1, DO_NOT_TRACK=1, NO_UPDATE_NOTIFIER=1, CI=1).
 *    NANSEN_API_KEY n'est JAMAIS presente (ni transmise, ni lue).
 *  - Aucune commande testee n'appelle l'API Nansen (ni payante, ni gratuite).
 *  - Preuve reseau : --version et doctor --offline sont re-joues sous
 *    `unshare -n` (namespace sans interface reseau) et doivent reussir.
 *  - Apres les runs, le HOME scratch ne doit contenir ni telemetry-id,
 *    ni session, ni cache de mise a jour (zero effet de bord reseau).
 *
 * Usage : node aspace-nansen-cli-adapter/smoke_test.mjs
 * Sortie : une ligne par check (ok / FAIL) + resume. Exit 1 si un check echoue.
 * Note : `nansen --help` est VOLONTAIREMENT hors de ce smoke test — il
 * declenche refreshCostMapIfStale() (GET https://api.nansen.ai/openapi.json
 * quand le cache couts est absent ou vieux de plus de 24 h). Voir contract.json.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ADAPTER_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLI_ENTRY = path.resolve(ADAPTER_DIR, '..', 'src', 'index.js');
const EXPECTED_VERSION = '2.4.0';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`ok   ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// HOME scratch sur disque (TMPDIR de l'appelant, jamais /tmp tmpfs si defini).
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nansen-adapter-smoke-'));
const childEnv = {
  PATH: process.env.PATH || '/usr/bin:/bin',
  HOME: scratch,
  NANSEN_NO_TELEMETRY: '1',
  DO_NOT_TRACK: '1',
  NO_UPDATE_NOTIFIER: '1',
  CI: '1',
};

function run(args, { netns = false } = {}) {
  const cmd = netns ? 'unshare' : process.execPath;
  const argv = netns
    ? ['-n', process.execPath, CLI_ENTRY, ...args]
    : [CLI_ENTRY, ...args];
  return spawnSync(cmd, argv, { env: childEnv, encoding: 'utf8', timeout: 60_000 });
}

function listScratchFiles() {
  const out = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else out.push(path.relative(scratch, p));
    }
  })(scratch);
  return out.sort();
}

// 1. --version : version exacte, rc 0.
const version = run(['--version']);
check(
  '--version retourne 2.4.0 (rc 0)',
  version.status === 0 && version.stdout.trim() === EXPECTED_VERSION,
  `rc=${version.status} stdout=${JSON.stringify(version.stdout.trim())} stderr=${JSON.stringify(version.stderr.slice(0, 200))}`,
);

// 2. doctor --offline : diagnostics offline, telemetrie desactivee.
const doctor = run(['doctor', '--offline']);
check(
  'doctor --offline rc 0, diagnostics offline, telemetrie desactivee',
  doctor.status === 0
    && doctor.stdout.includes('offline diagnostics')
    && doctor.stdout.includes('Telemetry disabled'),
  `rc=${doctor.status} stdout=${JSON.stringify(doctor.stdout.slice(0, 200))}`,
);

// 3. auth status : JSON, non connecte, offline:true, aucune cle.
let authJson = null;
const auth = run(['auth', 'status']);
try { authJson = JSON.parse(auth.stdout); } catch { /* reste null */ }
check(
  'auth status rc 0, logged_in false, offline true, aucune cle',
  auth.status === 0
    && authJson !== null
    && authJson.success === true
    && authJson.data?.logged_in === false
    && authJson.data?.offline === true
    && authJson.data?.api_key?.present === false,
  `rc=${auth.status} stdout=${JSON.stringify(auth.stdout.slice(0, 300))}`,
);

// 4. completion bash : script genere localement, rc 0.
const completion = run(['completion', 'bash']);
check(
  'completion bash rc 0, script non vide',
  completion.status === 0 && completion.stdout.length > 100 && completion.stdout.includes('nansen'),
  `rc=${completion.status} len=${completion.stdout.length}`,
);

// 5. Preuve reseau : --version et doctor --offline sous `unshare -n`.
let netnsAvailable = false;
try {
  const probe = spawnSync('unshare', ['-n', 'true'], { encoding: 'utf8', timeout: 10_000 });
  netnsAvailable = probe.status === 0;
} catch { netnsAvailable = false; }
if (netnsAvailable) {
  const vNet = run(['--version'], { netns: true });
  check(
    '--version reussi sous unshare -n (zero reseau)',
    vNet.status === 0 && vNet.stdout.trim() === EXPECTED_VERSION,
    `rc=${vNet.status}`,
  );
  const dNet = run(['doctor', '--offline'], { netns: true });
  check(
    'doctor --offline reussi sous unshare -n (zero reseau)',
    dNet.status === 0 && dNet.stdout.includes('offline diagnostics'),
    `rc=${dNet.status}`,
  );
} else {
  console.log('skip preuve reseau unshare -n (non disponible sur cette machine)');
}

// 6. Zero effet de bord reseau sur disque : aucun fichier de telemetrie,
//    de session, ni de cache de mise a jour sous le HOME scratch.
const files = listScratchFiles();
const forbidden = files.filter((f) => /(^|\/)telemetry-id$|(^|\/)session$|update-check\.json$|cost-map\.json$/.test(f));
check(
  'HOME scratch sans telemetry-id / session / update-check / cost-map',
  forbidden.length === 0,
  `fichiers trouves: ${JSON.stringify(files)}`,
);

// 7. Contrat : aucune cle API dans l'environnement enfant.
check(
  'NANSEN_API_KEY absente de l environnement enfant',
  childEnv.NANSEN_API_KEY === undefined,
);

console.log(`\n${passed} ok, ${failed} FAIL — ${failures.length ? `echecs: ${failures.join(', ')}` : 'tout vert'}`);
fs.rmSync(scratch, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
