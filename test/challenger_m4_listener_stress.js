/**
 * Challenger 1 (Milestone 4: Listener Cleanup Hardening & Full Regression Verification)
 * Empirical Adversarial Stress & Memory Leak Harness
 *
 * Requirements Verified:
 * 1. Rapid Attach/Deregister cycles (10,000+ iterations) on blockUpdate and entitySpawn.
 * 2. High listener churn (500 distinct listeners, interleaved arbitrary deletions).
 * 3. Duplicate same-function registrations (1,000 instances FIFO unwrapping).
 * 4. Burst once() and prependOnceListener() auto-cleanup (3,000 listeners).
 * 5. Premature cancellation of once() listeners prior to event emission.
 * 6. Re-entrant listener modifications (self-removal, adding, removing sibling listeners during emit).
 * 7. Direct unwrapped closure reference removal via target.rawListeners.
 * 8. Mass removeAllListeners stress across filtered and unfiltered events (5,000 listeners).
 * 9. Memory stability and garbage collection verification under cyclic listener creation.
 * 10. Robust defensive boundaries & strict EventEmitter contract conformance.
 */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { ViewerStateTranslator } from '../src/web/services/viewerStateTranslator.js';

let totalChecks = 0;
let passedChecks = 0;

function check(condition, desc) {
  totalChecks++;
  if (!condition) {
    console.error(`\x1b[31m[EMPIRICAL FAIL]\x1b[0m ${desc}`);
    throw new Error(`Assertion failed: ${desc}`);
  }
  passedChecks++;
  console.log(`\x1b[32m[EMPIRICAL PASS]\x1b[0m ${desc}`);
}

class MockBotEmitter extends EventEmitter {
  constructor(version = '26.3') {
    super();
    this.version = version;
    this.world = {
      async getColumnAt() { return null; },
      getColumn() { return null; }
    };
    this.entities = {};
  }
}

async function runEmpiricalStressSuite() {
  console.log('================================================================');
  console.log('STARTING EMPIRICAL CHALLENGER M4 LISTENER CLEANUP STRESS HARNESS');
  console.log('================================================================\n');

  const translator = ViewerStateTranslator.create('26.3', '1.21.4');
  check(translator !== null, 'Translator 26.3 -> 1.21.4 successfully created');

  const sanitizeMock = (ent) => (ent ? { ...ent, sanitized: true } : ent);

  // --------------------------------------------------------------------------
  // SCENARIO 1: Rapid 10,000 Iteration Attach / Emit / Deregister Cycles
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario 1: Rapid 10,000 Iteration Attach/Emit/Deregister Cycles ---');
  {
    const bot = new MockBotEmitter();
    const proxy = translator.createViewerBotProxy(bot, sanitizeMock);

    let invocationCount = 0;
    const testStateId263 = 28748; // deepslate_tiles in 26.3
    const startTime = Date.now();

    for (let i = 0; i < 10000; i++) {
      let receivedStateId = null;
      const listener = (oldB, newB) => {
        invocationCount++;
        receivedStateId = newB?.stateId;
      };

      proxy.on('blockUpdate', listener);
      if (i % 2500 === 0) {
        check(bot.listenerCount('blockUpdate') === 1, `Iter ${i}: listenerCount correctly increments to 1`);
      }

      // Emit blockUpdate
      bot.emit('blockUpdate', null, { stateId: testStateId263, name: 'deepslate_tiles' });
      assert.strictEqual(receivedStateId !== null && receivedStateId > 0, true);

      // Deregister
      proxy.off('blockUpdate', listener);
      assert.strictEqual(bot.listenerCount('blockUpdate'), 0);
    }

    const duration = Date.now() - startTime;
    console.log(`[PERF] 10,000 rapid cycles completed in ${duration}ms (${(duration / 10000).toFixed(3)}ms/cycle)`);
    check(invocationCount === 10000, 'All 10,000 invocations fired and translated');
    check(bot.listenerCount('blockUpdate') === 0, 'Listener count is strictly 0 after 10,000 iterations');
  }

  // --------------------------------------------------------------------------
  // SCENARIO 2: EntitySpawn Rapid 5,000 Iterations with Sanitization Check
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario 2: EntitySpawn 5,000 Iterations with Sanitization ---');
  {
    const bot = new MockBotEmitter();
    const proxy = translator.createViewerBotProxy(bot, sanitizeMock);
    let entityCalls = 0;

    for (let i = 0; i < 5000; i++) {
      let entityReceived = null;
      const entityListener = (ent) => {
        entityCalls++;
        entityReceived = ent;
      };

      proxy.addListener('entitySpawn', entityListener);
      bot.emit('entitySpawn', { id: 42, type: 'player', name: 'tester' });
      assert.strictEqual(entityReceived?.sanitized, true);

      proxy.removeListener('entitySpawn', entityListener);
      assert.strictEqual(bot.listenerCount('entitySpawn'), 0);
    }
    check(entityCalls === 5000, '5,000 entitySpawn listeners invoked with sanitized entity');
    check(bot.listenerCount('entitySpawn') === 0, 'entitySpawn listenerCount strictly 0');
  }

  // --------------------------------------------------------------------------
  // SCENARIO 3: High Churn - 1,000 Distinct Listeners with Interleaved Removals
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario 3: High Churn (1,000 Distinct Listeners & Interleaved Removals) ---');
  {
    const bot = new MockBotEmitter();
    const proxy = translator.createViewerBotProxy(bot, sanitizeMock);

    const listeners = [];
    const callTracker = new Array(1000).fill(0);

    for (let i = 0; i < 1000; i++) {
      const idx = i;
      const fn = () => { callTracker[idx]++; };
      listeners.push(fn);
      proxy.on('blockUpdate', fn);
    }

    check(bot.listenerCount('blockUpdate') === 1000, '1,000 distinct listeners registered (count 1000)');

    // Interleaved removal: remove all even-indexed listeners (0, 2, 4, ... 998 -> 500 listeners removed)
    for (let i = 0; i < 1000; i += 2) {
      proxy.off('blockUpdate', listeners[i]);
    }

    check(bot.listenerCount('blockUpdate') === 500, 'After interleaved removal, exactly 500 listeners remain');

    // Emit event
    bot.emit('blockUpdate', null, { stateId: 1, name: 'stone' });

    // Verify exactly odd-indexed listeners fired, even never fired
    let evenFired = 0;
    let oddFired = 0;
    for (let i = 0; i < 1000; i++) {
      if (i % 2 === 0) evenFired += callTracker[i];
      else oddFired += callTracker[i];
    }
    check(evenFired === 0, 'Deregistered even listeners received 0 events');
    check(oddFired === 500, 'Active odd listeners all received exactly 1 event (500 events)');

    // Remove remaining 500 odd listeners in reverse order
    for (let i = 999; i >= 1; i -= 2) {
      proxy.removeListener('blockUpdate', listeners[i]);
    }

    check(bot.listenerCount('blockUpdate') === 0, 'All 1,000 listeners completely removed (count 0)');

    // Emit again
    bot.emit('blockUpdate', null, { stateId: 1, name: 'stone' });
    let totalAfterFinalEmit = callTracker.reduce((a, b) => a + b, 0);
    check(totalAfterFinalEmit === 500, 'Zero events received after full cleanup on subsequent emit');
  }

  // --------------------------------------------------------------------------
  // SCENARIO 4: Duplicate Same-Function Registrations (1,000 instances FIFO unwrapping)
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario 4: Duplicate Same-Function Registrations (1,000 Instances) ---');
  {
    const bot = new MockBotEmitter();
    const proxy = translator.createViewerBotProxy(bot, sanitizeMock);

    let dupCalls = 0;
    const sharedFn = () => { dupCalls++; };

    for (let i = 0; i < 1000; i++) {
      proxy.on('blockUpdate', sharedFn);
    }
    check(bot.listenerCount('blockUpdate') === 1000, 'Same callback registered 1,000 times (count 1000)');

    // Remove 400 instances
    for (let i = 0; i < 400; i++) {
      proxy.off('blockUpdate', sharedFn);
    }
    check(bot.listenerCount('blockUpdate') === 600, '400 instances removed via off(), 600 remain');

    // Emit event: 600 invocations expected
    bot.emit('blockUpdate', null, { stateId: 1 });
    check(dupCalls === 600, 'Emitted event invokes remaining 600 instances');

    // Remove remaining 600 instances via removeListener
    for (let i = 0; i < 600; i++) {
      proxy.removeListener('blockUpdate', sharedFn);
    }
    check(bot.listenerCount('blockUpdate') === 0, 'All 1,000 duplicate instances removed, count is 0');

    // Additional off() calls should be safe no-ops
    for (let i = 0; i < 50; i++) {
      proxy.off('blockUpdate', sharedFn);
    }
    check(bot.listenerCount('blockUpdate') === 0, 'Redundant off() calls on empty map remain safe no-op (count 0)');
  }

  // --------------------------------------------------------------------------
  // SCENARIO 5: Massive Burst of once() & prependOnceListener() Auto-Cleanup (3,000 Listeners)
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario 5: Massive Burst of 3,000 once() Listeners Auto-Cleanup ---');
  {
    const bot = new MockBotEmitter();
    const proxy = translator.createViewerBotProxy(bot, sanitizeMock);

    let onceCalls = 0;
    for (let i = 0; i < 1000; i++) {
      proxy.once('blockUpdate', () => { onceCalls++; });
    }
    for (let i = 0; i < 1000; i++) {
      proxy.prependOnceListener('blockUpdate', () => { onceCalls++; });
    }
    for (let i = 0; i < 1000; i++) {
      proxy.once('entitySpawn', () => { onceCalls++; });
    }

    check(bot.listenerCount('blockUpdate') === 2000, '2,000 once listeners on blockUpdate registered');
    check(bot.listenerCount('entitySpawn') === 1000, '1,000 once listeners on entitySpawn registered');

    // Emit blockUpdate and entitySpawn
    bot.emit('blockUpdate', null, { stateId: 1 });
    bot.emit('entitySpawn', { id: 1 });

    check(onceCalls === 3000, 'All 3,000 once listeners executed on first emit');
    check(bot.listenerCount('blockUpdate') === 0, 'blockUpdate listenerCount automatically 0 after execution');
    check(bot.listenerCount('entitySpawn') === 0, 'entitySpawn listenerCount automatically 0 after execution');

    // Emit again: should trigger nothing
    bot.emit('blockUpdate', null, { stateId: 1 });
    bot.emit('entitySpawn', { id: 1 });
    check(onceCalls === 3000, 'Subsequent emits trigger 0 once listeners (strict single-execution)');
  }

  // --------------------------------------------------------------------------
  // SCENARIO 6: Premature Cancellation of once() Listeners Prior to Event
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario 6: Premature Cancellation of 1,000 once() Listeners ---');
  {
    const bot = new MockBotEmitter();
    const proxy = translator.createViewerBotProxy(bot, sanitizeMock);

    const onceFns = [];
    let cancelledFired = 0;
    for (let i = 0; i < 1000; i++) {
      const fn = () => { cancelledFired++; };
      onceFns.push(fn);
      proxy.once('blockUpdate', fn);
    }
    check(bot.listenerCount('blockUpdate') === 1000, '1,000 once listeners registered');

    // Cancel all before firing
    for (const fn of onceFns) {
      proxy.off('blockUpdate', fn);
    }
    check(bot.listenerCount('blockUpdate') === 0, 'All 1,000 once listeners cancelled before firing (count 0)');

    bot.emit('blockUpdate', null, { stateId: 1 });
    check(cancelledFired === 0, 'Zero cancelled once listeners fired on emit');
  }

  // --------------------------------------------------------------------------
  // SCENARIO 7: Re-Entrancy & Dynamic Self-Modification during Event Emission
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario 7: Re-Entrant Self-Modification during Event Emission ---');
  {
    const bot = new MockBotEmitter();
    const proxy = translator.createViewerBotProxy(bot, sanitizeMock);

    // Case A: Listener deregisters itself inside the callback
    let selfRemoveCalls = 0;
    const selfRemover = () => {
      selfRemoveCalls++;
      proxy.off('blockUpdate', selfRemover);
    };
    proxy.on('blockUpdate', selfRemover);
    check(bot.listenerCount('blockUpdate') === 1, 'Self-removing listener attached');

    bot.emit('blockUpdate', null, { stateId: 1 });
    check(selfRemoveCalls === 1, 'Self-remover ran on first emit');
    check(bot.listenerCount('blockUpdate') === 0, 'Self-remover successfully detached itself (count 0)');

    bot.emit('blockUpdate', null, { stateId: 1 });
    check(selfRemoveCalls === 1, 'Self-remover did not run on second emit');

    // Case B: Listener attaches a sibling listener during event dispatch
    let parentCalls = 0;
    let childCalls = 0;
    const childListener = () => { childCalls++; };
    const parentListener = () => {
      parentCalls++;
      proxy.on('blockUpdate', childListener);
    };
    proxy.on('blockUpdate', parentListener);

    bot.emit('blockUpdate', null, { stateId: 1 });
    check(parentCalls === 1, 'Parent listener executed');
    check(bot.listenerCount('blockUpdate') === 2, 'Child listener added during emit (count 2)');

    // Emit again: both parent and child should execute
    bot.emit('blockUpdate', null, { stateId: 1 });
    check(parentCalls === 2, 'Parent executed second time');
    check(childCalls >= 1, 'Child executed');

    // Cleanup
    proxy.removeAllListeners('blockUpdate');
    check(bot.listenerCount('blockUpdate') === 0, 'Cleaned up all re-entrant listeners (count 0)');
  }

  // --------------------------------------------------------------------------
  // SCENARIO 8: Direct Unwrapped Closure Removal (Fallback / Prismarine-Viewer Internal Pass)
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario 8: Direct Removal of Wrapped Closure References ---');
  {
    const bot = new MockBotEmitter();
    const proxy = translator.createViewerBotProxy(bot, sanitizeMock);

    const origFns = [];
    for (let i = 0; i < 500; i++) {
      const fn = () => {};
      origFns.push(fn);
      proxy.on('blockUpdate', fn);
    }
    check(bot.listenerCount('blockUpdate') === 500, '500 listeners registered');

    // Retrieve underlying wrapped closures from emitter
    const rawListeners = bot.rawListeners('blockUpdate');
    check(rawListeners.length === 500, 'Retrieved 500 raw wrapped closures from EventEmitter');

    // Pass the wrapped closure directly to proxy.off
    for (const wrapped of rawListeners) {
      proxy.off('blockUpdate', wrapped);
    }
    check(bot.listenerCount('blockUpdate') === 0, 'All 500 wrapped closures successfully untracked and removed directly');
  }

  // --------------------------------------------------------------------------
  // SCENARIO 9: Mass removeAllListeners Stress Across Mixed Events (5,000 Listeners)
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario 9: Mass removeAllListeners Stress (5,000 Listeners) ---');
  {
    const bot = new MockBotEmitter();
    const proxy = translator.createViewerBotProxy(bot, sanitizeMock);

    for (let i = 0; i < 2000; i++) {
      proxy.on('blockUpdate', () => {});
    }
    for (let i = 1500; i < 3000; i++) {
      proxy.on('entitySpawn', () => {});
    }
    for (let i = 0; i < 1500; i++) {
      proxy.on('chat', () => {});
    }

    check(bot.listenerCount('blockUpdate') === 2000, '2,000 blockUpdate registered');
    check(bot.listenerCount('entitySpawn') === 1500, '1,500 entitySpawn registered');
    check(bot.listenerCount('chat') === 1500, '1,500 chat registered');

    // Selective purge: removeAllListeners('blockUpdate')
    proxy.removeAllListeners('blockUpdate');
    check(bot.listenerCount('blockUpdate') === 0, 'blockUpdate completely purged');
    check(bot.listenerCount('entitySpawn') === 1500, 'entitySpawn untouched');
    check(bot.listenerCount('chat') === 1500, 'chat untouched');

    // Full purge: removeAllListeners()
    proxy.removeAllListeners();
    check(bot.listenerCount('entitySpawn') === 0, 'entitySpawn purged by full removeAllListeners');
    check(bot.listenerCount('chat') === 0, 'chat purged by full removeAllListeners');
  }

  // --------------------------------------------------------------------------
  // SCENARIO 10: Memory Leak & Heap Stability Stress Test
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario 10: Memory Leak & Heap Stability Stress Test ---');
  {
    const bot = new MockBotEmitter();
    const proxy = translator.createViewerBotProxy(bot, sanitizeMock);

    // Force GC if available or record heap before churn
    if (globalThis.gc) globalThis.gc();
    const initialHeap = process.memoryUsage().heapUsed;

    // Perform 25,000 rapid lifecycle operations creating transient closures
    for (let round = 0; round < 25; round++) {
      const roundListeners = [];
      for (let i = 0; i < 1000; i++) {
        const fn = (oldB, newB) => { return newB?.stateId; };
        roundListeners.push(fn);
        proxy.on('blockUpdate', fn);
      }
      // Emit
      bot.emit('blockUpdate', null, { stateId: 100 });
      // Clean
      for (const fn of roundListeners) {
        proxy.off('blockUpdate', fn);
      }
    }

    if (globalThis.gc) globalThis.gc();
    const finalHeap = process.memoryUsage().heapUsed;
    const heapDiffMb = (finalHeap - initialHeap) / (1024 * 1024);

    console.log(`[HEAP] Initial: ${(initialHeap / (1024 * 1024)).toFixed(2)} MB, Final: ${(finalHeap / (1024 * 1024)).toFixed(2)} MB, Diff: ${heapDiffMb.toFixed(2)} MB`);
    check(bot.listenerCount('blockUpdate') === 0, 'Zero dangling listeners on emitter after 25,000 operations');
    // Heap should not balloon indefinitely (diff < 50MB for transient maps and Node runtime)
    check(heapDiffMb < 50, `Heap memory growth is tightly bounded (+${heapDiffMb.toFixed(2)} MB < 50 MB threshold)`);
  }

  // --------------------------------------------------------------------------
  // SCENARIO 11: Fault Tolerance, Defensive Boundaries & Contract Conformance
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario 11: Fault Tolerance & Strict Contract Conformance ---');
  {
    const bot = new MockBotEmitter();
    const proxy = translator.createViewerBotProxy(bot, sanitizeMock);

    // Calling off/removeListener with un-registered function is a safe no-op
    const unregisteredFn = () => {};
    let safeNoOp = true;
    try {
      proxy.off('blockUpdate', unregisteredFn);
      proxy.removeListener('entitySpawn', unregisteredFn);
      proxy.removeListener('nonExistentEvent', unregisteredFn);
      proxy.removeAllListeners('nonExistentEvent');
    } catch (err) {
      safeNoOp = false;
      console.error('Safe no-op error:', err);
    }
    check(safeNoOp, 'Deregistering un-registered callbacks is a safe no-op (no exceptions)');

    // Conformance with Node.js EventEmitter specification:
    // Passing non-function to removeListener / off throws ERR_INVALID_ARG_TYPE in Node.js
    let throwsCorrectError = false;
    try {
      proxy.off('blockUpdate', null);
    } catch (err) {
      throwsCorrectError = (err?.code === 'ERR_INVALID_ARG_TYPE');
    }
    check(throwsCorrectError, 'Passing null to off() adheres to Node EventEmitter contract (ERR_INVALID_ARG_TYPE)');

    // Bare mock bot missing removeListener / off (partial mock)
    const partialBot = { version: '26.3', world: {}, on(event, fn) {} };
    const partialProxy = translator.createViewerBotProxy(partialBot);
    let partialSafe = true;
    try {
      partialProxy.on('blockUpdate', () => {});
      partialProxy.off('blockUpdate', () => {});
      partialProxy.removeListener('blockUpdate', () => {});
      partialProxy.removeAllListeners('blockUpdate');
      partialProxy.removeAllListeners();
    } catch (err) {
      partialSafe = false;
      console.error('Partial mock error:', err);
    }
    check(partialSafe, 'Proxy safely handles targets without removeListener/off implementation without crashing');

    // Completely empty target object returns undefined for missing emitter methods without throwing on property access
    const emptyTarget = { version: '26.3' };
    const emptyProxy = translator.createViewerBotProxy(emptyTarget);
    check(emptyProxy.on === undefined, 'Accessing missing emitter method on bare target returns undefined cleanly');

    // Chaining returns proxy instance
    const dummyFn = () => {};
    check(proxy.on('blockUpdate', dummyFn) === proxy, 'proxy.on() returns proxy for chaining');
    check(proxy.addListener('blockUpdate', dummyFn) === proxy, 'proxy.addListener() returns proxy for chaining');
    check(proxy.removeListener('blockUpdate', dummyFn) === proxy, 'proxy.removeListener() returns proxy for chaining');
    check(proxy.off('blockUpdate', dummyFn) === proxy, 'proxy.off() returns proxy for chaining');
    check(proxy.removeAllListeners('blockUpdate') === proxy, 'proxy.removeAllListeners() returns proxy for chaining');
  }

  console.log('\n================================================================');
  console.log(`EMPIRICAL CHALLENGER M4 HARNESS COMPLETE: ${passedChecks}/${totalChecks} CHECKS PASSED`);
  console.log('================================================================\n');

  process.exit(0);
}

runEmpiricalStressSuite().catch(err => {
  console.error('\x1b[31m[EMPIRICAL SUITE CRASH]\x1b[0m', err);
  process.exit(1);
});
