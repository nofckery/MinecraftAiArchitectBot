/**
 * Lightweight Zero-Dependency Mock DOM Fixture
 * 
 * Provides headless implementations of Window, Document, Element, ClassList,
 * Style, Dataset, Event, MouseEvent, and KeyboardEvent for testing UI dashboards
 * and DOM interactions without browser or jsdom dependencies.
 */

// ---------------------------------------------------------------------------
// 1. Events
// ---------------------------------------------------------------------------

export class MockEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.bubbles = Boolean(options.bubbles);
    this.cancelable = Boolean(options.cancelable);
    this.defaultPrevented = false;
    this.propagationStopped = false;
    this.immediatePropagationStopped = false;
    this.target = null;
    this.currentTarget = null;
    this.timeStamp = Date.now();
  }

  preventDefault() {
    if (this.cancelable) {
      this.defaultPrevented = true;
    }
  }

  stopPropagation() {
    this.propagationStopped = true;
  }

  stopImmediatePropagation() {
    this.immediatePropagationStopped = true;
    this.propagationStopped = true;
  }
}

export class MockCustomEvent extends MockEvent {
  constructor(type, options = {}) {
    super(type, options);
    this.detail = options.detail !== undefined ? options.detail : null;
  }
}

export class MockMouseEvent extends MockEvent {
  constructor(type, options = {}) {
    super(type, { bubbles: true, cancelable: true, ...options });
    this.clientX = options.clientX || 0;
    this.clientY = options.clientY || 0;
    this.button = options.button !== undefined ? options.button : 0;
    this.buttons = options.buttons !== undefined ? options.buttons : 1;
    this.altKey = Boolean(options.altKey);
    this.ctrlKey = Boolean(options.ctrlKey);
    this.shiftKey = Boolean(options.shiftKey);
    this.metaKey = Boolean(options.metaKey);
  }
}

export class MockKeyboardEvent extends MockEvent {
  constructor(type, options = {}) {
    super(type, { bubbles: true, cancelable: true, ...options });
    this.key = options.key || '';
    this.code = options.code || '';
    this.altKey = Boolean(options.altKey);
    this.ctrlKey = Boolean(options.ctrlKey);
    this.shiftKey = Boolean(options.shiftKey);
    this.metaKey = Boolean(options.metaKey);
    this.repeat = Boolean(options.repeat);
    this.isComposing = Boolean(options.isComposing);
  }
}

// ---------------------------------------------------------------------------
// 2. ClassList & Style
// ---------------------------------------------------------------------------

export class MockClassList {
  constructor(element) {
    this._element = element;
    this._classes = new Set();
  }

  _syncToClassName() {
    if (this._element) {
      this._element._className = Array.from(this._classes).join(' ');
    }
  }

  _syncFromClassName(name) {
    this._classes.clear();
    if (name && typeof name === 'string') {
      name.split(/\s+/).filter(Boolean).forEach(c => this._classes.add(c));
    }
  }

  add(...classes) {
    for (const c of classes) {
      if (c) this._classes.add(String(c).trim());
    }
    this._syncToClassName();
  }

  remove(...classes) {
    for (const c of classes) {
      if (c) this._classes.delete(String(c).trim());
    }
    this._syncToClassName();
  }

  toggle(c, force) {
    const cls = String(c).trim();
    if (force === true) {
      this.add(cls);
      return true;
    } else if (force === false) {
      this.remove(cls);
      return false;
    }
    if (this._classes.has(cls)) {
      this.remove(cls);
      return false;
    } else {
      this.add(cls);
      return true;
    }
  }

  contains(c) {
    return this._classes.has(String(c).trim());
  }

  replace(oldCls, newCls) {
    if (!this._classes.has(oldCls)) return false;
    this._classes.delete(oldCls);
    this._classes.add(newCls);
    this._syncToClassName();
    return true;
  }

  get length() {
    return this._classes.size;
  }

  get value() {
    return Array.from(this._classes).join(' ');
  }

  set value(v) {
    this._syncFromClassName(v);
    this._syncToClassName();
  }

  forEach(fn, thisArg) {
    this._classes.forEach(fn, thisArg);
  }

  [Symbol.iterator]() {
    return this._classes.values();
  }

  toString() {
    return this.value;
  }
}

export class MockStyle {
  constructor() {
    this._props = new Map();
  }

  getPropertyValue(prop) {
    const key = String(prop).toLowerCase().replace(/-([a-z])/g, (_, l) => l.toUpperCase());
    return this[key] !== undefined ? String(this[key]) : (this._props.get(prop) || '');
  }

  setProperty(prop, val) {
    const key = String(prop).replace(/-([a-z])/g, (_, l) => l.toUpperCase());
    this[key] = String(val);
    this._props.set(prop, String(val));
  }

  removeProperty(prop) {
    const key = String(prop).replace(/-([a-z])/g, (_, l) => l.toUpperCase());
    const old = this[key] || '';
    delete this[key];
    this._props.delete(prop);
    return old;
  }

  get cssText() {
    return Array.from(this._props.entries()).map(([k, v]) => `${k}: ${v};`).join(' ');
  }

  set cssText(text) {
    this._props.clear();
    if (!text) return;
    text.split(';').forEach(rule => {
      const idx = rule.indexOf(':');
      if (idx > -1) {
        const k = rule.slice(0, idx).trim();
        const v = rule.slice(idx + 1).trim();
        if (k && v) this.setProperty(k, v);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// 3. Mock Element
// ---------------------------------------------------------------------------

export class MockElement {
  constructor(tagName = 'DIV', ownerDocument = null) {
    this.tagName = String(tagName).toUpperCase();
    this.nodeName = this.tagName;
    this.nodeType = 1;
    this.ownerDocument = ownerDocument;

    this.id = '';
    this._className = '';
    this.classList = new MockClassList(this);
    this.style = new MockStyle();
    this.dataset = {};
    this.attributes = new Map();
    this._listeners = new Map();

    this.children = [];
    this.childNodes = [];
    this.parentElement = null;
    this.parentNode = null;

    this._textContent = '';
    this._innerHTML = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.src = '';
    this.title = '';
    this.isContentEditable = false;

    // Geometric defaults (configurable in tests)
    this.clientWidth = 800;
    this.clientHeight = 600;
    this.offsetWidth = 800;
    this.offsetHeight = 600;
    this.scrollWidth = 800;
    this.scrollHeight = 600;
    this.scrollTop = 0;
    this.scrollLeft = 0;

    // Event properties
    this.onclick = null;
    this.onkeydown = null;
  }

  get className() {
    return this._className;
  }

  set className(val) {
    this._className = String(val || '');
    this.classList._syncFromClassName(this._className);
  }

  get textContent() {
    if (this.children.length === 0) {
      return this._textContent;
    }
    return this.children.map(c => c.textContent).join('');
  }

  set textContent(val) {
    this._textContent = String(val || '');
    this.children = [];
    this.childNodes = [];
  }

  get innerText() {
    return this.textContent;
  }

  set innerText(val) {
    this.textContent = val;
  }

  get innerHTML() {
    return this._innerHTML || this.textContent;
  }

  set innerHTML(html) {
    this._innerHTML = String(html || '');
    this.children = [];
    this.childNodes = [];
    // Basic text content sync
    this._textContent = this._innerHTML.replace(/<[^>]*>/g, '');
  }

  getAttribute(name) {
    const lower = String(name).toLowerCase();
    if (lower === 'id') return this.id || null;
    if (lower === 'class') return this.className || null;
    if (lower === 'src') return this.src || null;
    if (lower === 'title') return this.title || null;
    if (lower === 'disabled') return this.disabled ? '' : null;
    if (this.attributes.has(name)) return this.attributes.get(name);
    return null;
  }

  setAttribute(name, val) {
    const lower = String(name).toLowerCase();
    const strVal = String(val);
    this.attributes.set(name, strVal);

    if (lower === 'id') this.id = strVal;
    else if (lower === 'class') this.className = strVal;
    else if (lower === 'src') this.src = strVal;
    else if (lower === 'title') this.title = strVal;
    else if (lower === 'disabled') this.disabled = true;
    else if (lower.startsWith('data-')) {
      const dataKey = lower.slice(5).replace(/-([a-z])/g, (_, l) => l.toUpperCase());
      this.dataset[dataKey] = strVal;
    }
  }

  removeAttribute(name) {
    const lower = String(name).toLowerCase();
    this.attributes.delete(name);
    if (lower === 'id') this.id = '';
    else if (lower === 'class') this.className = '';
    else if (lower === 'src') this.src = '';
    else if (lower === 'title') this.title = '';
    else if (lower === 'disabled') this.disabled = false;
    else if (lower.startsWith('data-')) {
      const dataKey = lower.slice(5).replace(/-([a-z])/g, (_, l) => l.toUpperCase());
      delete this.dataset[dataKey];
    }
  }

  hasAttribute(name) {
    return this.attributes.has(name) || this.getAttribute(name) !== null;
  }

  appendChild(child) {
    if (!child) return child;
    if (child.parentElement) {
      child.parentElement.removeChild(child);
    }
    child.parentElement = this;
    child.parentNode = this;
    if (this.ownerDocument) child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    this.childNodes.push(child);
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx > -1) {
      this.children.splice(idx, 1);
      child.parentElement = null;
      child.parentNode = null;
    }
    const nodeIdx = this.childNodes.indexOf(child);
    if (nodeIdx > -1) {
      this.childNodes.splice(nodeIdx, 1);
    }
    return child;
  }

  insertBefore(newNode, referenceNode) {
    if (!referenceNode) return this.appendChild(newNode);
    const idx = this.children.indexOf(referenceNode);
    if (idx > -1) {
      if (newNode.parentElement) newNode.parentElement.removeChild(newNode);
      newNode.parentElement = this;
      newNode.parentNode = this;
      this.children.splice(idx, 0, newNode);
      this.childNodes.splice(idx, 0, newNode);
    } else {
      this.appendChild(newNode);
    }
    return newNode;
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.removeChild(this);
    }
  }

  get firstElementChild() {
    return this.children[0] || null;
  }

  get lastElementChild() {
    return this.children[this.children.length - 1] || null;
  }

  get nextElementSibling() {
    if (!this.parentElement) return null;
    const idx = this.parentElement.children.indexOf(this);
    return idx > -1 && idx < this.parentElement.children.length - 1
      ? this.parentElement.children[idx + 1]
      : null;
  }

  get previousElementSibling() {
    if (!this.parentElement) return null;
    const idx = this.parentElement.children.indexOf(this);
    return idx > 0 ? this.parentElement.children[idx - 1] : null;
  }

  addEventListener(event, handler, options = {}) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, []);
    }
    this._listeners.get(event).push({ handler, options });
  }

  removeEventListener(event, handler) {
    if (!this._listeners.has(event)) return;
    const list = this._listeners.get(event);
    const filtered = list.filter(item => item.handler !== handler);
    this._listeners.set(event, filtered);
  }

  dispatchEvent(event) {
    event.target = this;
    event.currentTarget = this;

    const list = this._listeners.get(event.type) || [];
    for (const item of [...list]) {
      if (event.immediatePropagationStopped) break;
      item.handler.call(this, event);
      if (item.options && item.options.once) {
        this.removeEventListener(event.type, item.handler);
      }
    }

    // Call inline property handler (e.g. element.onclick)
    const onProp = `on${event.type}`;
    if (typeof this[onProp] === 'function') {
      this[onProp].call(this, event);
    }

    // Bubble up to parent if bubbles = true
    if (event.bubbles && !event.propagationStopped && this.parentElement) {
      this.parentElement.dispatchEvent(event);
    } else if (event.bubbles && !event.propagationStopped && this.ownerDocument) {
      this.ownerDocument.dispatchEvent(event);
    }

    return !event.defaultPrevented;
  }

  click() {
    const evt = new MockMouseEvent('click', { bubbles: true, cancelable: true });
    return this.dispatchEvent(evt);
  }

  focus() {
    if (this.ownerDocument) {
      this.ownerDocument.activeElement = this;
    }
    const evt = new MockEvent('focus', { bubbles: false, cancelable: false });
    this.dispatchEvent(evt);
  }

  blur() {
    if (this.ownerDocument && this.ownerDocument.activeElement === this) {
      this.ownerDocument.activeElement = this.ownerDocument.body;
    }
    const evt = new MockEvent('blur', { bubbles: false, cancelable: false });
    this.dispatchEvent(evt);
  }

  async requestFullscreen() {
    if (this.ownerDocument) {
      this.ownerDocument.fullscreenElement = this;
      this.ownerDocument.dispatchEvent(new MockEvent('fullscreenchange', { bubbles: true }));
    }
    return Promise.resolve();
  }

  requestPointerLock() {}

  getBoundingClientRect() {
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: this.clientWidth,
      bottom: this.clientHeight,
      width: this.clientWidth,
      height: this.clientHeight
    };
  }

  // ---------------------------------------------------------------------------
  // Selector Matching
  // ---------------------------------------------------------------------------

  matches(selector) {
    const sel = selector.trim();

    // Comma-separated group
    if (sel.includes(',')) {
      return sel.split(',').some(part => this.matches(part.trim()));
    }

    // ID selector #foo
    if (sel.startsWith('#')) {
      const id = sel.slice(1);
      return this.id === id;
    }

    // Class selector .bar
    if (sel.startsWith('.')) {
      const cls = sel.slice(1);
      return this.classList.contains(cls);
    }

    // Attribute selector [attr] or [attr="val"]
    const attrMatch = sel.match(/^\[([a-zA-Z0-9_-]+)(?:=["']?([^"']*)["']?)?\]$/);
    if (attrMatch) {
      const attrName = attrMatch[1];
      const attrVal = attrMatch[2];
      if (!this.hasAttribute(attrName)) return false;
      if (attrVal !== undefined) return this.getAttribute(attrName) === attrVal;
      return true;
    }

    // Tag name selector
    if (/^[A-Za-z0-9_-]+$/.test(sel)) {
      return this.tagName.toLowerCase() === sel.toLowerCase();
    }

    // Compound selector (e.g. button.tab-btn or #btn.active)
    const compoundMatch = sel.match(/^([A-Za-z0-9_-]*)(?:#([A-Za-z0-9_-]+))?(?:\.([A-Za-z0-9_.-]+))?$/);
    if (compoundMatch) {
      const [_, tag, id, classes] = compoundMatch;
      if (tag && this.tagName.toLowerCase() !== tag.toLowerCase()) return false;
      if (id && this.id !== id) return false;
      if (classes) {
        const clsList = classes.split('.');
        for (const c of clsList) {
          if (!this.classList.contains(c)) return false;
        }
      }
      return true;
    }

    return false;
  }

  querySelector(selector) {
    const results = this.querySelectorAll(selector);
    return results.length > 0 ? results[0] : null;
  }

  querySelectorAll(selector) {
    const matched = [];
    const traverse = (node) => {
      for (const child of node.children) {
        if (child.matches(selector)) {
          matched.push(child);
        }
        traverse(child);
      }
    };
    traverse(this);
    return matched;
  }

  closest(selector) {
    let curr = this;
    while (curr) {
      if (curr.matches && curr.matches(selector)) return curr;
      curr = curr.parentElement;
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// 4. Mock Document & Window
// ---------------------------------------------------------------------------

export class MockDocument {
  constructor() {
    this.nodeType = 9;
    this.documentElement = new MockElement('HTML', this);
    this.head = new MockElement('HEAD', this);
    this.body = new MockElement('BODY', this);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);

    this.activeElement = this.body;
    this.fullscreenElement = null;
    this._listeners = new Map();
  }

  createElement(tagName) {
    return new MockElement(tagName, this);
  }

  createTextNode(text) {
    const el = new MockElement('#text', this);
    el.nodeType = 3;
    el.textContent = String(text || '');
    return el;
  }

  getElementById(id) {
    const cleanId = String(id).replace(/^#/, '');
    const find = (node) => {
      if (node.id === cleanId) return node;
      for (const child of node.children) {
        const found = find(child);
        if (found) return found;
      }
      return null;
    };
    return find(this.documentElement);
  }

  querySelector(selector) {
    if (selector.startsWith('#') && !selector.includes(' ') && !selector.includes('.')) {
      return this.getElementById(selector.slice(1));
    }
    if (this.documentElement.matches(selector)) return this.documentElement;
    if (this.body.matches(selector)) return this.body;
    return this.documentElement.querySelector(selector);
  }

  querySelectorAll(selector) {
    const list = this.documentElement.querySelectorAll(selector);
    if (this.body.matches(selector) && !list.includes(this.body)) {
      list.unshift(this.body);
    }
    return list;
  }

  getElementsByClassName(className) {
    return this.querySelectorAll(`.${className}`);
  }

  getElementsByTagName(tagName) {
    return this.querySelectorAll(tagName);
  }

  addEventListener(event, handler, options = {}) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, []);
    }
    this._listeners.get(event).push({ handler, options });
  }

  removeEventListener(event, handler) {
    if (!this._listeners.has(event)) return;
    const list = this._listeners.get(event);
    this._listeners.set(event, list.filter(item => item.handler !== handler));
  }

  dispatchEvent(event) {
    event.target = event.target || this;
    event.currentTarget = this;

    const list = this._listeners.get(event.type) || [];
    for (const item of [...list]) {
      item.handler.call(this, event);
    }
    return !event.defaultPrevented;
  }

  async exitFullscreen() {
    this.fullscreenElement = null;
    this.dispatchEvent(new MockEvent('fullscreenchange', { bubbles: true }));
    return Promise.resolve();
  }
}

export class MockWindow {
  constructor(document = null) {
    this.document = document || new MockDocument();
    this.innerWidth = 1920;
    this.innerHeight = 1080;
    this.devicePixelRatio = 1.0;
    this.location = {
      protocol: 'http:',
      hostname: 'localhost',
      port: '3000',
      href: 'http://localhost:3000/',
      pathname: '/',
      search: '',
      hash: ''
    };
    this._listeners = new Map();
  }

  addEventListener(event, handler, options = {}) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, []);
    }
    this._listeners.get(event).push({ handler, options });
  }

  removeEventListener(event, handler) {
    if (!this._listeners.has(event)) return;
    const list = this._listeners.get(event);
    this._listeners.set(event, list.filter(item => item.handler !== handler));
  }

  dispatchEvent(event) {
    event.target = event.target || this;
    event.currentTarget = this;

    const list = this._listeners.get(event.type) || [];
    for (const item of [...list]) {
      item.handler.call(this, event);
    }
    return !event.defaultPrevented;
  }

  requestAnimationFrame(fn) {
    return setTimeout(() => fn(Date.now()), 16);
  }

  cancelAnimationFrame(id) {
    clearTimeout(id);
  }
}

// ---------------------------------------------------------------------------
// 5. Global Environment Setup & Teardown
// ---------------------------------------------------------------------------

let savedGlobals = null;

export function setupMockDom(options = {}) {
  const document = new MockDocument();
  const window = new MockWindow(document);

  savedGlobals = {
    window: globalThis.window,
    document: globalThis.document,
    Event: globalThis.Event,
    CustomEvent: globalThis.CustomEvent,
    MouseEvent: globalThis.MouseEvent,
    KeyboardEvent: globalThis.KeyboardEvent,
    HTMLElement: globalThis.HTMLElement,
    Element: globalThis.Element
  };

  globalThis.window = window;
  globalThis.document = document;
  globalThis.Event = MockEvent;
  globalThis.CustomEvent = MockCustomEvent;
  globalThis.MouseEvent = MockMouseEvent;
  globalThis.KeyboardEvent = MockKeyboardEvent;
  globalThis.HTMLElement = MockElement;
  globalThis.Element = MockElement;

  return { window, document };
}

export function teardownMockDom() {
  if (!savedGlobals) return;
  globalThis.window = savedGlobals.window;
  globalThis.document = savedGlobals.document;
  globalThis.Event = savedGlobals.Event;
  globalThis.CustomEvent = savedGlobals.CustomEvent;
  globalThis.MouseEvent = savedGlobals.MouseEvent;
  globalThis.KeyboardEvent = savedGlobals.KeyboardEvent;
  globalThis.HTMLElement = savedGlobals.HTMLElement;
  globalThis.Element = savedGlobals.Element;
  savedGlobals = null;
}

export default {
  MockEvent,
  MockCustomEvent,
  MockMouseEvent,
  MockKeyboardEvent,
  MockClassList,
  MockStyle,
  MockElement,
  MockDocument,
  MockWindow,
  setupMockDom,
  teardownMockDom
};
