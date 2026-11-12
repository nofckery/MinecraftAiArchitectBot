#!/usr/bin/env node
/**
 * Master Test Suite Runner for Tiers 1-4
 * 
 * Runs all test tiers or a selected tier (--tier=1..4).
 * Scans `tests/tier1_features/`, `tests/tier2_boundaries/`,
 * `tests/tier3_interactions/`, and `tests/tier4_real_world/`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TestHarness, defaultHarness } from './helpers/testHarness.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Tier definitions
const TIERS = [
  {
    tier: 1,
    id: 'tier1',
    name: 'Tier 1: Feature Coverage (F1–F8)',
    dir: path.join(__dirname, 'tier1_features'),
    minExpected: 40
  },
  {
    tier: 2,
    id: 'tier2',
    name: 'Tier 2: Boundary & Corner Cases (F1–F8)',
    dir: path.join(__dirname, 'tier2_boundaries'),
    minExpected: 40
  },
  {
    tier: 3,
    id: 'tier3',
    name: 'Tier 3: Cross-Feature Interactions',
    dir: path.join(__dirname, 'tier3_interactions'),
    minExpected: 8
  },
  {
    tier: 4,
    id: 'tier4',
    name: 'Tier 4: Real-World Scenarios & Workloads',
    dir: path.join(__dirname, 'tier4_real_world'),
    minExpected: 5
  }
];

function parseCliArgs() {
  const args = process.argv.slice(2);
  let selectedTier = null;
  let verbose = false;
  let colors = !process.env.NO_COLOR;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg.startsWith('--tier=')) {
      selectedTier = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--tier' || arg === '-t') {
      selectedTier = parseInt(args[++i], 10);
    } else if (arg === '--verbose' || arg === '-v') {
      verbose = true;
    } else if (arg === '--no-color') {
      colors = false;
    }
  }

  return { selectedTier, verbose, colors };
}

function printHelp() {
  console.log(`
Minecraft Bot CAD World Studio — Multi-Tier Test Suite Runner

Usage:
  node tests/runAllTiers.js [options]

Options:
  --tier=N, -t N   Run only Tier N (1, 2, 3, or 4)
  --verbose, -v    Verbose execution output
  --no-color       Disable ANSI color output
  --help, -h       Display this help message

Tiers:
  Tier 1: Feature Coverage (tests/tier1_features/)
  Tier 2: Boundary & Corner Cases (tests/tier2_boundaries/)
  Tier 3: Cross-Feature Interactions (tests/tier3_interactions/)
  Tier 4: Real-World Workload Scenarios (tests/tier4_real_world/)
`);
}

function findTestFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  const files = fs.readdirSync(dirPath);
  return files
    .filter(f => (f.endsWith('.test.js') || f.endsWith('.spec.js') || (f.endsWith('.js') && !f.startsWith('.'))))
    .sort()
    .map(f => path.join(dirPath, f));
}

async function runTestSuite() {
  const { selectedTier, verbose, colors } = parseCliArgs();
  const startTime = Date.now();

  const runnerHarness = new TestHarness({
    name: 'MultiTierRunner',
    colors,
    silent: false
  });

  console.log(`\n${runnerHarness.bold(runnerHarness.cyan('===================================================='))}`);
  console.log(`${runnerHarness.bold(runnerHarness.cyan('  CAD World Studio & Dashboard Multi-Tier Test Suite'))}`);
  console.log(`${runnerHarness.bold(runnerHarness.cyan('===================================================='))}`);
  if (selectedTier) {
    console.log(`Target: ${runnerHarness.yellow(`Tier ${selectedTier} only`)}`);
  } else {
    console.log(`Target: ${runnerHarness.green('All Tiers (1 through 4)')}`);
  }

  const tiersToRun = selectedTier
    ? TIERS.filter(t => t.tier === selectedTier)
    : TIERS;

  if (tiersToRun.length === 0) {
    console.error(runnerHarness.red(`Invalid tier specified: ${selectedTier}. Valid values are 1, 2, 3, 4.`));
    process.exit(1);
  }

  const tierReports = [];
  let totalFilesRun = 0;

  for (const tierConfig of tiersToRun) {
    console.log(`\n${runnerHarness.bold(runnerHarness.green(`━━━ [TIER ${tierConfig.tier}] ${tierConfig.name} ━━━`))}`);

    // Ensure directory exists for upcoming milestones
    if (!fs.existsSync(tierConfig.dir)) {
      fs.mkdirSync(tierConfig.dir, { recursive: true });
    }

    const testFiles = findTestFiles(tierConfig.dir);

    if (testFiles.length === 0) {
      console.log(`  ${runnerHarness.dim(`[TIER ${tierConfig.tier}] 0 test files found in ${path.relative(PROJECT_ROOT, tierConfig.dir)} (Scheduled for milestone implementation)`)}`);
      tierReports.push({
        tier: tierConfig.tier,
        name: tierConfig.name,
        files: 0,
        tests: 0,
        passed: 0,
        failed: 0,
        status: 'PENDING_FILES'
      });
      continue;
    }

    const tierStartTests = defaultHarness.results.total;
    const tierStartPassed = defaultHarness.results.passed;
    const tierStartFailed = defaultHarness.results.failed;

    for (const testFile of testFiles) {
      const relFile = path.relative(PROJECT_ROOT, testFile);
      console.log(`\n  ${runnerHarness.bold('Running File:')} ${runnerHarness.cyan(relFile)}`);
      totalFilesRun++;

      try {
        const fileUrl = pathToFileURL(testFile).href;
        const module = await import(fileUrl);

        // If module exports a runner function, call it
        if (typeof module.runTests === 'function') {
          await module.runTests(defaultHarness);
        } else if (typeof module.run === 'function') {
          await module.run(defaultHarness);
        } else if (typeof module.default === 'function') {
          await module.default(defaultHarness);
        }
      } catch (err) {
        console.error(`  ${runnerHarness.red('✖ Failed to load or execute:')} ${relFile}`);
        console.error(`    ${runnerHarness.red(err.message)}`);
        if (err.stack) {
          console.error(`    ${runnerHarness.dim(err.stack.split('\n').slice(1, 4).join('\n    '))}`);
        }
        defaultHarness.results.failed++;
        defaultHarness.results.errors.push({
          suite: `File: ${relFile}`,
          testName: 'FILE_LOAD',
          error: err
        });
      }
    }

    const tierTests = defaultHarness.results.total - tierStartTests;
    const tierPassed = defaultHarness.results.passed - tierStartPassed;
    const tierFailed = defaultHarness.results.failed - tierStartFailed;

    tierReports.push({
      tier: tierConfig.tier,
      name: tierConfig.name,
      files: testFiles.length,
      tests: tierTests,
      passed: tierPassed,
      failed: tierFailed,
      status: tierFailed === 0 ? 'PASS' : 'FAIL'
    });
  }

  const grandDuration = Date.now() - startTime;
  const grandTotalTests = defaultHarness.results.total;
  const grandPassed = defaultHarness.results.passed;
  const grandFailed = defaultHarness.results.failed;
  const grandSkipped = defaultHarness.results.skipped;
  const grandAssertions = defaultHarness.assertionCount;

  // Print Summary Table
  console.log(`\n${runnerHarness.bold('====================================================')}`);
  console.log(`${runnerHarness.bold('                 TIER EXECUTION SUMMARY             ')}`);
  console.log(`====================================================`);
  for (const report of tierReports) {
    const statusText = report.status === 'PASS'
      ? runnerHarness.green('PASS')
      : report.status === 'PENDING_FILES'
        ? runnerHarness.yellow('EMPTY')
        : runnerHarness.red('FAIL');
    console.log(`  Tier ${report.tier}: [${statusText}] ${report.files} files, ${report.tests} tests (${report.passed} pass, ${report.failed} fail)`);
  }
  console.log(`----------------------------------------------------`);
  console.log(`Test Files Executed : ${runnerHarness.bold(totalFilesRun)}`);
  console.log(`Total Tests Run     : ${runnerHarness.bold(grandTotalTests)}`);
  console.log(`Total Passed        : ${runnerHarness.green(grandPassed)}`);
  console.log(`Total Failed        : ${grandFailed > 0 ? runnerHarness.red(grandFailed) : grandFailed}`);
  console.log(`Total Skipped       : ${grandSkipped}`);
  console.log(`Total Assertions    : ${runnerHarness.bold(grandAssertions)}`);
  console.log(`Total Duration      : ${runnerHarness.dim(grandDuration + 'ms')}`);

  const overallSuccess = grandFailed === 0;
  console.log(`Final Outcome       : ${overallSuccess ? runnerHarness.green(runnerHarness.bold('SUCCESS')) : runnerHarness.red(runnerHarness.bold('FAILED'))}`);
  console.log(`====================================================\n`);

  process.exit(overallSuccess ? 0 : 1);
}

runTestSuite().catch(err => {
  console.error('Fatal Test Runner Error:', err);
  process.exit(1);
});
