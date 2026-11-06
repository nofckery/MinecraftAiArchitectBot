/**
 * Milestone 3 Remediation Adversarial Stress Harness
 * Archetype: EMPIRICAL CHALLENGER
 * Roles: critic, specialist
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

let passed = 0;
let total = 0;

function assert(cond, msg) {
  total++;
  if (!cond) {
    console.error(`\x1b[31m[FAIL]\x1b[0m ${msg}`);
    throw new Error(msg);
  }
  passed++;
  console.log(`\x1b[32m[PASS]\x1b[0m ${msg}`);
}

async function run() {
  console.log('\x1b[35m=== RUNNING CHALLENGER REMEDIATION ADVERSARIAL STRESS TEST ===\x1b[0m\n');

  // 1. AST / Export duplicate check across all JS in src/web/public/
  console.log('--- 1. AST & Duplicate Export Static Oracle ---');
  const appJsPath = path.resolve('src/web/public/app.js');
  const appContent = fs.readFileSync(appJsPath, 'utf-8');

  // Find all named exports: `export function foo`, `export const foo`, and `export { a, b, c }`
  const exportFuncMatches = [...appContent.matchAll(/export\s+function\s+([a-zA-Z0-9_$]+)/g)].map(m => m[1]);
  const exportConstMatches = [...appContent.matchAll(/export\s+(?:const|let|var)\s+([a-zA-Z0-9_$]+)/g)].map(m => m[1]);
  const exportBlockMatch = appContent.match(/export\s*\{([^}]+)\}/);
  let exportedInBlock = [];
  if (exportBlockMatch) {
    exportedInBlock = exportBlockMatch[1]
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => s.split(/\s+as\s+/)[0].trim());
  }

  const allDirectExports = [...exportFuncMatches, ...exportConstMatches];
  console.log(`Direct exports count: ${allDirectExports.length}, Block exports count: ${exportedInBlock.length}`);

  // Ensure no overlap between allDirectExports and exportedInBlock
  for (const name of allDirectExports) {
    const isDuplicated = exportedInBlock.includes(name);
    assert(!isDuplicated, `Identifier '${name}' must not be exported both directly and in export {...} block`);
  }

  // Ensure exportedInBlock has no duplicates within itself
  const blockSet = new Set(exportedInBlock);
  assert(blockSet.size === exportedInBlock.length, 'export {...} block must not contain duplicate identifiers');

  // 2. Syntax check via node --check on all frontend JS
  console.log('\n--- 2. Programmatic node --check on all public JS files ---');
  const publicDir = path.resolve('src/web/public');
  function getJsFiles(dir) {
    let results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        results = results.concat(getJsFiles(full));
      } else if (ent.isFile() && ent.name.endsWith('.js')) {
        results.push(full);
      }
    }
    return results;
  }
  const jsFiles = getJsFiles(publicDir);
  for (const file of jsFiles) {
    const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf-8' });
    assert(res.status === 0, `node --check on ${path.relative(process.cwd(), file)} must exit with 0 (stderr: ${res.stderr?.trim()})`);
  }

  // 3. Package.json script check
  console.log('\n--- 3. package.json script integrity ---');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
  assert(typeof pkg.scripts['check:syntax'] === 'string', 'package.json contains "check:syntax" script');
  const npmCheck = spawnSync('npm', ['run', 'check:syntax'], { encoding: 'utf-8', shell: true });
  assert(npmCheck.status === 0, 'npm run check:syntax completes successfully with exit code 0');

  // 4. Fault injection & resilience test for applyCameraDetachedState
  console.log('\n--- 4. Fault Injection & Resilience: applyCameraDetachedState ---');

  // Setup mock DOM
  const elements = {};
  globalThis.window = {
    location: { protocol: 'https:', hostname: 'minecraft.local' },
    addEventListener: () => {}
  };
  globalThis.document = {
    getElementById: (id) => elements[id] || null,
    querySelector: (sel) => elements[sel] || null,
    querySelectorAll: () => [],
    addEventListener: () => {}
  };

  const appModule = await import('../src/web/public/app.js');
  const { applyCameraDetachedState } = appModule;
  assert(typeof applyCameraDetachedState === 'function', 'applyCameraDetachedState is an exported function');

  // 4.1 Zero elements in DOM (all null)
  let threw = false;
  try {
    applyCameraDetachedState(true);
    applyCameraDetachedState(false);
  } catch (e) {
    threw = true;
    console.error(e);
  }
  assert(!threw, 'applyCameraDetachedState survives completely empty DOM without throwing');

  // 4.2 Malformed elements (missing properties, but standard DOM style object)
  elements['viewerFrame'] = {};
  elements['viewerWrapper'] = { style: {} };
  elements['viewerDetachedPlaceholder'] = { classList: { remove() {}, add() {} } };
  elements['.grid-container'] = { classList: { remove() {}, add() {} } };
  elements['lblViewerPort'] = { textContent: '9999' };

  try {
    applyCameraDetachedState(true);
    assert(elements['viewerFrame'].src === 'about:blank', 'Sets about:blank even when other elements lack style');
    assert(elements['viewerWrapper'].style?.display === 'none', 'Sets display none on viewerWrapper');
    applyCameraDetachedState(false);
    assert(elements['viewerFrame'].src === 'https://minecraft.local:9999', 'Restores custom port and https protocol');
  } catch (e) {
    console.error(e);
    assert(false, `Malformed DOM test failed: ${e.message}`);
  }

  // 4.3 High frequency rapid invocation stress (5000 iterations)
  console.log('\n--- 5. High Frequency Stress (5,000 rapid cycles) ---');
  const t0 = Date.now();
  for (let i = 0; i < 5000; i++) {
    applyCameraDetachedState(i % 2 === 0);
  }
  const duration = Date.now() - t0;
  assert(elements['viewerFrame'].src === 'https://minecraft.local:9999', 'Final state is cleanly re-embedded');
  console.log(`5,000 cycles completed in ${duration}ms (${(duration / 5000).toFixed(4)}ms per cycle)`);
  assert(duration < 2000, '5,000 cycles run within 2 seconds');

  console.log(`\n\x1b[32m=== ADVERSARIAL CHALLENGE COMPLETE: ALL ${passed}/${total} TESTS PASSED ===\x1b[0m\n`);
}

run().catch(err => {
  console.error('\n\x1b[31m[ADVERSARIAL STRESS FAILED]\x1b[0m', err);
  process.exit(1);
});
