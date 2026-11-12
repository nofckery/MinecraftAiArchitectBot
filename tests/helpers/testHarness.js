/**
 * Zero-Dependency Test Runner & Assertion Harness
 * 
 * Provides BDD-style test authoring (`describe`, `test`, `it`, `beforeEach`, `afterEach`),
 * tracked assertions wrapping `node:assert/strict`, execution timing, failure recording,
 * and TAP/colorized reporting.
 */

import nativeAssert from 'node:assert/strict';

export class TestHarness {
  constructor(options = {}) {
    this.name = options.name || 'TestSuite';
    this.useColors = options.colors !== undefined ? options.colors : !process.env.NO_COLOR;
    this.silent = Boolean(options.silent);
    this.currentSuite = null;
    this.suites = [];
    this.beforeEachHooks = [];
    this.afterEachHooks = [];
    this.beforeAllHooks = [];
    this.afterAllHooks = [];
    this.assertionCount = 0;
    this.startTime = 0;
    this.endTime = 0;

    // Results tracking
    this.results = {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      assertions: 0,
      errors: [],
      suites: []
    };

    this.bindMethods();
  }

  bindMethods() {
    this.describe = this.describe.bind(this);
    this.test = this.test.bind(this);
    this.it = this.it.bind(this);
    this.beforeEach = this.beforeEach.bind(this);
    this.afterEach = this.afterEach.bind(this);
    this.beforeAll = this.beforeAll.bind(this);
    this.afterAll = this.afterAll.bind(this);
    this.assert = this.assert.bind(this);
    this.strictEqual = this.strictEqual.bind(this);
    this.notStrictEqual = this.notStrictEqual.bind(this);
    this.deepStrictEqual = this.deepStrictEqual.bind(this);
    this.notDeepStrictEqual = this.notDeepStrictEqual.bind(this);
    this.ok = this.ok.bind(this);
    this.throws = this.throws.bind(this);
    this.doesNotThrow = this.doesNotThrow.bind(this);
    this.rejects = this.rejects.bind(this);
    this.doesNotReject = this.doesNotReject.bind(this);
    this.match = this.match.bind(this);
  }

  // Color helpers
  c(text, code) {
    if (!this.useColors) return String(text);
    return `\x1b[${code}m${text}\x1b[0m`;
  }

  green(text) { return this.c(text, 32); }
  red(text) { return this.c(text, 31); }
  yellow(text) { return this.c(text, 33); }
  cyan(text) { return this.c(text, 36); }
  dim(text) { return this.c(text, 2); }
  bold(text) { return this.c(text, 1); }

  log(...args) {
    if (!this.silent) console.log(...args);
  }

  reset() {
    this.currentSuite = null;
    this.suites = [];
    this.beforeEachHooks = [];
    this.afterEachHooks = [];
    this.beforeAllHooks = [];
    this.afterAllHooks = [];
    this.assertionCount = 0;
    this.startTime = Date.now();
    this.endTime = 0;
    this.results = {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      assertions: 0,
      errors: [],
      suites: []
    };
  }

  beforeEach(fn) {
    this.beforeEachHooks.push(fn);
  }

  afterEach(fn) {
    this.afterEachHooks.push(fn);
  }

  beforeAll(fn) {
    this.beforeAllHooks.push(fn);
  }

  afterAll(fn) {
    this.afterAllHooks.push(fn);
  }

  async describe(suiteName, suiteFn) {
    const previousSuite = this.currentSuite;
    const suiteRecord = {
      name: suiteName,
      tests: [],
      passed: 0,
      failed: 0,
      skipped: 0,
      duration: 0
    };
    this.currentSuite = suiteRecord;
    this.results.suites.push(suiteRecord);

    this.log(`\n${this.bold(this.cyan('▶ ' + suiteName))}`);

    const suiteStart = Date.now();
    try {
      // Execute suite declaration
      const res = suiteFn();
      if (res && typeof res.then === 'function') {
        await res;
      }
    } catch (err) {
      this.log(`  ${this.red('✖ Suite setup error:')} ${err.message}`);
      this.results.errors.push({
        suite: suiteName,
        testName: 'SUITE_SETUP',
        error: err
      });
      suiteRecord.failed++;
      this.results.failed++;
    } finally {
      suiteRecord.duration = Date.now() - suiteStart;
      this.currentSuite = previousSuite;
    }
  }

  async test(testName, testFn) {
    if (this.startTime === 0) {
      this.startTime = Date.now();
    }

    const suiteName = this.currentSuite ? this.currentSuite.name : 'Default Suite';
    this.results.total++;

    if (typeof testFn !== 'function') {
      this.results.skipped++;
      if (this.currentSuite) this.currentSuite.skipped++;
      this.log(`  ${this.yellow('○')} ${testName} ${this.dim('(skipped)')}`);
      return;
    }

    const tStart = Date.now();
    try {
      // Run beforeEach hooks
      for (const hook of this.beforeEachHooks) {
        await hook();
      }

      // Run test body
      const res = testFn();
      if (res && typeof res.then === 'function') {
        await res;
      }

      // Run afterEach hooks
      for (const hook of this.afterEachHooks) {
        await hook();
      }

      const duration = Date.now() - tStart;
      this.results.passed++;
      if (this.currentSuite) this.currentSuite.passed++;

      this.log(`  ${this.green('✓')} ${testName} ${this.dim(`(${duration}ms)`)}`);
    } catch (err) {
      const duration = Date.now() - tStart;
      this.results.failed++;
      if (this.currentSuite) this.currentSuite.failed++;

      const errInfo = {
        suite: suiteName,
        testName,
        error: err,
        duration
      };
      this.results.errors.push(errInfo);

      this.log(`  ${this.red('✖')} ${this.red(testName)} ${this.dim(`(${duration}ms)`)}`);
      this.log(`    ${this.red(err.message)}`);
      if (err.stack && !this.silent) {
        const stackLine = err.stack.split('\n')[1] || '';
        this.log(`    ${this.dim(stackLine.trim())}`);
      }
    }
  }

  // Alias for test
  it(testName, testFn) {
    return this.test(testName, testFn);
  }

  // ---------------------------------------------------------------------------
  // Tracked Assertion Helpers wrapping node:assert/strict
  // ---------------------------------------------------------------------------

  assert(value, message) {
    this.assertionCount++;
    this.results.assertions = this.assertionCount;
    return nativeAssert(value, message);
  }

  strictEqual(actual, expected, message) {
    this.assertionCount++;
    this.results.assertions = this.assertionCount;
    return nativeAssert.strictEqual(actual, expected, message);
  }

  notStrictEqual(actual, expected, message) {
    this.assertionCount++;
    this.results.assertions = this.assertionCount;
    return nativeAssert.notStrictEqual(actual, expected, message);
  }

  deepStrictEqual(actual, expected, message) {
    this.assertionCount++;
    this.results.assertions = this.assertionCount;
    return nativeAssert.deepStrictEqual(actual, expected, message);
  }

  notDeepStrictEqual(actual, expected, message) {
    this.assertionCount++;
    this.results.assertions = this.assertionCount;
    return nativeAssert.notDeepStrictEqual(actual, expected, message);
  }

  ok(value, message) {
    this.assertionCount++;
    this.results.assertions = this.assertionCount;
    return nativeAssert.ok(value, message);
  }

  throws(fn, expected, message) {
    this.assertionCount++;
    this.results.assertions = this.assertionCount;
    return nativeAssert.throws(fn, expected, message);
  }

  doesNotThrow(fn, message) {
    this.assertionCount++;
    this.results.assertions = this.assertionCount;
    return nativeAssert.doesNotThrow(fn, message);
  }

  async rejects(asyncFnOrPromise, expected, message) {
    this.assertionCount++;
    this.results.assertions = this.assertionCount;
    return await nativeAssert.rejects(asyncFnOrPromise, expected, message);
  }

  async doesNotReject(asyncFnOrPromise, message) {
    this.assertionCount++;
    this.results.assertions = this.assertionCount;
    return await nativeAssert.doesNotReject(asyncFnOrPromise, message);
  }

  match(string, regexp, message) {
    this.assertionCount++;
    this.results.assertions = this.assertionCount;
    return nativeAssert.match(string, regexp, message);
  }

  // ---------------------------------------------------------------------------
  // Reporting & Exit Code
  // ---------------------------------------------------------------------------

  summary() {
    this.endTime = Date.now();
    const duration = this.endTime - (this.startTime || this.endTime);
    const { total, passed, failed, skipped } = this.results;

    this.log(`\n${this.bold('----------------------------------------------------')}`);
    this.log(this.bold(`Test Execution Summary: ${this.name}`));
    this.log(`----------------------------------------------------`);
    this.log(`Total Tests : ${this.bold(total)}`);
    this.log(`Passed      : ${this.green(passed)}`);
    this.log(`Failed      : ${failed > 0 ? this.red(failed) : failed}`);
    this.log(`Skipped     : ${skipped > 0 ? this.yellow(skipped) : skipped}`);
    this.log(`Assertions  : ${this.bold(this.assertionCount)}`);
    this.log(`Duration    : ${this.dim(duration + 'ms')}`);

    if (this.results.errors.length > 0) {
      this.log(`\n${this.red(this.bold(`Failures (${this.results.errors.length}):`))}`);
      this.results.errors.forEach((err, idx) => {
        this.log(`  ${idx + 1}) [${err.suite}] ${err.testName}`);
        this.log(`     ${this.red(err.error.message)}`);
      });
    }

    const allPassed = failed === 0;
    this.log(`Result      : ${allPassed ? this.green(this.bold('PASSED (100%)')) : this.red(this.bold('FAILED'))}`);
    this.log(`----------------------------------------------------\n`);

    return {
      allPassed,
      total,
      passed,
      failed,
      skipped,
      assertions: this.assertionCount,
      durationMs: duration,
      errors: this.results.errors
    };
  }

  getExitCode() {
    return this.results.failed > 0 ? 1 : 0;
  }
}

// Default singleton instance for direct import convenience
export const defaultHarness = new TestHarness();

export const describe = defaultHarness.describe;
export const test = defaultHarness.test;
export const it = defaultHarness.it;
export const beforeEach = defaultHarness.beforeEach;
export const afterEach = defaultHarness.afterEach;
export const beforeAll = defaultHarness.beforeAll;
export const afterAll = defaultHarness.afterAll;

export const assert = defaultHarness.assert;
export const strictEqual = defaultHarness.strictEqual;
export const notStrictEqual = defaultHarness.notStrictEqual;
export const deepStrictEqual = defaultHarness.deepStrictEqual;
export const notDeepStrictEqual = defaultHarness.notDeepStrictEqual;
export const ok = defaultHarness.ok;
export const throws = defaultHarness.throws;
export const doesNotThrow = defaultHarness.doesNotThrow;
export const rejects = defaultHarness.rejects;
export const doesNotReject = defaultHarness.doesNotReject;
export const match = defaultHarness.match;

export default defaultHarness;
