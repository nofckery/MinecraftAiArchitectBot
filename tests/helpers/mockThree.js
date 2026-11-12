/**
 * Headless Three.js & Viewport Mock Fixtures
 * 
 * Provides mock implementations of WebGLRenderer, PerspectiveCamera, Scene,
 * and ResizeObserver for headless Node.js testing of 3D viewport adaptation,
 * projection matrices, and camera aspect ratio updates without GPU/browser dependencies.
 */

import { MockElement } from './mockDom.js';

// ---------------------------------------------------------------------------
// 1. Mock ResizeObserver
// ---------------------------------------------------------------------------

export class MockResizeObserver {
  static instances = [];

  constructor(callback) {
    this.callback = callback;
    this.observedTargets = new Set();
    MockResizeObserver.instances.push(this);
  }

  observe(target, options = {}) {
    if (target) {
      this.observedTargets.add(target);
    }
  }

  unobserve(target) {
    this.observedTargets.delete(target);
  }

  disconnect() {
    this.observedTargets.clear();
    const idx = MockResizeObserver.instances.indexOf(this);
    if (idx > -1) {
      MockResizeObserver.instances.splice(idx, 1);
    }
  }

  /**
   * Helper to trigger resize callbacks on all observers watching the target
   */
  static triggerResize(target, contentRect = {}) {
    const entry = {
      target,
      contentRect: {
        x: contentRect.x || 0,
        y: contentRect.y || 0,
        width: contentRect.width !== undefined ? contentRect.width : (target.clientWidth || 800),
        height: contentRect.height !== undefined ? contentRect.height : (target.clientHeight || 600),
        top: 0,
        bottom: contentRect.height || target.clientHeight || 600,
        left: 0,
        right: contentRect.width || target.clientWidth || 800
      }
    };

    for (const observer of MockResizeObserver.instances) {
      if (observer.observedTargets.has(target)) {
        observer.callback([entry], observer);
      }
    }
  }

  static reset() {
    MockResizeObserver.instances = [];
  }
}

// ---------------------------------------------------------------------------
// 2. Mock WebGLRenderer
// ---------------------------------------------------------------------------

export class MockWebGLRenderer {
  constructor(options = {}) {
    this.options = options;
    this.domElement = new MockElement('CANVAS');
    this.width = options.width || 800;
    this.height = options.height || 600;
    this.pixelRatio = 1.0;
    this.domElement.clientWidth = this.width;
    this.domElement.clientHeight = this.height;

    this.shadowMap = { enabled: false, type: 0 };
    this.setSizeCalls = [];
    this.setPixelRatioCalls = [];
    this.renderCalls = [];
  }

  setSize(width, height, updateStyle = true) {
    this.width = width;
    this.height = height;
    this.domElement.width = width;
    this.domElement.height = height;
    this.domElement.clientWidth = width;
    this.domElement.clientHeight = height;

    if (updateStyle) {
      this.domElement.style.width = `${width}px`;
      this.domElement.style.height = `${height}px`;
    }

    this.setSizeCalls.push({ width, height, updateStyle });
  }

  setPixelRatio(ratio) {
    this.pixelRatio = ratio;
    this.setPixelRatioCalls.push(ratio);
  }

  getPixelRatio() {
    return this.pixelRatio;
  }

  getSize(target = {}) {
    target.width = this.width;
    target.height = this.height;
    return target;
  }

  setClearColor(color, alpha = 1) {
    this.clearColor = color;
    this.clearAlpha = alpha;
  }

  render(scene, camera) {
    this.renderCalls.push({
      scene,
      camera,
      timestamp: Date.now()
    });
  }

  dispose() {
    this.renderCalls = [];
    this.setSizeCalls = [];
  }
}

// ---------------------------------------------------------------------------
// 3. Mock PerspectiveCamera
// ---------------------------------------------------------------------------

export class MockPerspectiveCamera {
  constructor(fov = 60, aspect = 1.0, near = 0.1, far = 1000) {
    this.fov = fov;
    this.aspect = aspect;
    this.near = near;
    this.far = far;

    this.position = {
      x: 0,
      y: 0,
      z: 0,
      set(x, y, z) {
        this.x = x;
        this.y = y;
        this.z = z;
        return this;
      },
      copy(v) {
        this.x = v.x;
        this.y = v.y;
        this.z = v.z;
        return this;
      }
    };

    this.rotation = {
      x: 0,
      y: 0,
      z: 0,
      set(x, y, z) {
        this.x = x;
        this.y = y;
        this.z = z;
        return this;
      }
    };

    this.up = { x: 0, y: 1, z: 0 };
    this.target = null;
    this.updateProjectionMatrixCalls = 0;
    this.projectionMatrix = {
      elements: new Float32Array(16)
    };
  }

  lookAt(x, y, z) {
    if (typeof x === 'object' && x !== null) {
      this.target = { x: x.x, y: x.y, z: x.z };
    } else {
      this.target = { x, y, z };
    }
  }

  updateProjectionMatrix() {
    this.updateProjectionMatrixCalls++;
    // Basic projection matrix elements mock
    if (this.projectionMatrix && this.projectionMatrix.elements) {
      this.projectionMatrix.elements[0] = 1 / Math.tan((this.fov * Math.PI) / 360) / (this.aspect || 1);
      this.projectionMatrix.elements[5] = 1 / Math.tan((this.fov * Math.PI) / 360);
      this.projectionMatrix.elements[10] = (this.far + this.near) / (this.near - this.far);
      this.projectionMatrix.elements[14] = (2 * this.far * this.near) / (this.near - this.far);
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Mock Scene & Vector Helpers
// ---------------------------------------------------------------------------

export class MockScene {
  constructor() {
    this.children = [];
    this.name = 'MockScene';
  }

  add(...objects) {
    for (const obj of objects) {
      if (obj) this.children.push(obj);
    }
  }

  remove(...objects) {
    for (const obj of objects) {
      const idx = this.children.indexOf(obj);
      if (idx > -1) this.children.splice(idx, 1);
    }
  }

  traverse(callback) {
    const walk = (node) => {
      callback(node);
      if (node.children && Array.isArray(node.children)) {
        node.children.forEach(walk);
      }
    };
    walk(this);
  }
}

export class MockVector2 {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  set(x, y) {
    this.x = x;
    this.y = y;
    return this;
  }
}

export class MockVector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  set(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  copy(v) {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }
}

// ---------------------------------------------------------------------------
// 5. Setup & Teardown Helpers
// ---------------------------------------------------------------------------

let savedResizeObserver = null;

export function setupMockThreeGlobals() {
  savedResizeObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = MockResizeObserver;
  MockResizeObserver.reset();
  return {
    ResizeObserver: MockResizeObserver,
    MockWebGLRenderer,
    MockPerspectiveCamera,
    MockScene
  };
}

export function teardownMockThreeGlobals() {
  globalThis.ResizeObserver = savedResizeObserver;
  MockResizeObserver.reset();
  savedResizeObserver = null;
}

export default {
  MockResizeObserver,
  MockWebGLRenderer,
  MockPerspectiveCamera,
  MockScene,
  MockVector2,
  MockVector3,
  setupMockThreeGlobals,
  teardownMockThreeGlobals
};
