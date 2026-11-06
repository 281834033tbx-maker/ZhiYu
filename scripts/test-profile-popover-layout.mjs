import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

// Execute the real component with synthetic hooks, geometry and event sources.
// No browser, account storage, database, API or model is opened by this test.
// The DOM model applies final CSS size caps; it does not reproduce positioning.
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceArgument = process.argv.find(argument => argument.startsWith('--source='));
const outputArgument = process.argv.find(argument => argument.startsWith('--output='));
const sourcePath = sourceArgument ? resolve(sourceArgument.slice('--source='.length)) : join(projectRoot, 'app/zhiyu/profile-popover.tsx');
const source = readFileSync(sourcePath, 'utf8');
const motionSourcePath = join(projectRoot, 'app/zhiyu/anchored-popup-motion.ts');
const compile = sourceText => ts.transpileModule(sourceText, {compilerOptions: {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.React,
  jsxFactory: 'fixtureElement',
}}).outputText;
const compiled = compile(source);
const compiledMotion = compile(readFileSync(motionSourcePath, 'utf8'));
const passed = [];

class FixtureEvents {
  listeners = new Map();
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) {this.listeners.get(type)?.delete(callback);}
  emit(type, options = {}) {
    const event = {type, target: this, defaultPrevented: false, preventDefault() {this.defaultPrevented = true;}, ...options};
    const callbacks = Array.from(this.listeners.get(type) || []);
    for (const callback of callbacks) callback(event);
    return event;
  }
  listenerCount() {return [...this.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0);}
}

function fixture({width = 1194, height = 870, anchorRect = {left: 260, top: 150, width: 34, height: 34}, naturalWidth = 277.5, contentHeight = 310} = {}) {
  let phase = 'mount';
  let frameSequence = 0;
  let hookIndex = 0;
  let closed = 0;
  let cancelled = 0;
  const frames = new Map();
  const microtasks = [];
  const writes = [];
  const hookSlots = [];
  const pendingEffects = [];
  const observers = [];
  const focusEvents = [];
  const blurEvents = [];
  const window = new FixtureEvents();
  const document = new FixtureEvents();
  const viewport = new FixtureEvents();
  const reducedMotion = new FixtureEvents();
  // These regressions cover placement and close/focus semantics. Real browser
  // checks cover interpolation; use the real helper's reduced-motion branch.
  Object.assign(reducedMotion, {matches: true, media: '(prefers-reduced-motion: reduce)'});
  Object.assign(viewport, {width, height, offsetLeft: 0, offsetTop: 0});
  Object.assign(window, {innerWidth: width, innerHeight: height, visualViewport: viewport, matchMedia: () => reducedMotion});

  class FixtureNode extends FixtureEvents {
    constructor({parent = null, tag = 'div', className = ''} = {}) {
      super(); this.parent = parent; this.tag = tag; this.className = className; this.isConnected = true; this.open = false; this.attributes = new Map();
    }
    contains(target) {for (let node = target; node; node = node.parent) if (node === this) return true; return false;}
    closest(selector) {
      for (let node = this; node; node = node.parent) {
        if (selector === 'button' && node.tag === 'button') return node;
        if (selector === '.zy-inline-name-input' && node.className.split(' ').includes('zy-inline-name-input')) return node;
      }
      return null;
    }
    matches(selector) {return selector === ':popover-open' ? this.open : selector === 'button,[tabindex]' && this.tag === 'button';}
    focus(options) {document.activeElement = this; focusEvents.push({node: this, options});}
    blur() {blurEvents.push(this); if (document.activeElement === this) document.activeElement = document.body;}
    showPopover() {this.open = true;}
    hidePopover() {this.open = false;}
    setAttribute(name, value) {this.attributes.set(name, String(value));}
    removeAttribute(name) {this.attributes.delete(name);}
  }
  document.body = new FixtureNode();
  document.documentElement = new FixtureNode();
  document.activeElement = document.body;
  const trigger = new FixtureNode({tag: 'button'});
  const anchor = new FixtureNode({parent: trigger});
  anchor.getBoundingClientRect = () => ({...anchorRect, right: anchorRect.left + anchorRect.width, bottom: anchorRect.top + anchorRect.height});
  const node = new FixtureNode();
  node.contentHeight = contentHeight;
  const styleValues = {opacity: ''};
  node.style = new Proxy(styleValues, {set(target, property, value) {
    writes.push({phase, property, value}); target[property] = String(value); return true;
  }});
  node.dataset = {};
  node.getBoundingClientRect = () => {
    const actualWidth = Math.min(naturalWidth, Number.parseFloat(styleValues.maxWidth) || Infinity);
    const actualHeight = Math.min(node.contentHeight, Number.parseFloat(styleValues.maxHeight) || Infinity);
    const left = Number.parseFloat(styleValues.left) || 0;
    const top = Number.parseFloat(styleValues.top) || 0;
    return {left, top, width: actualWidth, height: actualHeight, right: left + actualWidth, bottom: top + actualHeight};
  };
  Object.defineProperty(node, 'clientHeight', {get: () => node.getBoundingClientRect().height - 2});
  Object.defineProperty(node, 'scrollHeight', {get: () => Math.max(node.contentHeight - 2, node.clientHeight)});
  // offset dimensions are integer layout measurements, independent of any
  // transform. getBoundingClientRect keeps fractional CSS geometry (277.5px).
  Object.defineProperty(node, 'offsetWidth', {get: () => Math.round(node.getBoundingClientRect().width)});
  Object.defineProperty(node, 'offsetHeight', {get: () => Math.round(node.getBoundingClientRect().height)});
  const hooks = {
    useRef(initialValue) {const index = hookIndex++; if (!hookSlots[index]) hookSlots[index] = {current: initialValue}; return hookSlots[index];},
    useLayoutEffect(callback, dependencies) {
      const index = hookIndex++;
      const previous = hookSlots[index];
      const changed = !previous || !dependencies || dependencies.some((value, offset) => value !== previous.dependencies?.[offset]);
      hookSlots[index] = {...previous, dependencies};
      if (changed) pendingEffects.push(() => {
        previous?.cleanup?.();
        hookSlots[index].cleanup = callback();
      });
    },
  };
  class FixtureResizeObserver {
    constructor(callback) {this.callback = callback; this.targets = new Set(); this.disconnected = false; observers.push(this);}
    observe(target) {this.targets.add(target);}
    disconnect() {this.targets.clear(); this.disconnected = true;}
    deliver() {if (!this.disconnected) this.callback([...this.targets].map(target => ({target})), this);}
  }
  const globals = {
    require(specifier) {
      if (specifier === 'react') return hooks;
      if (specifier === './profile-popover.css') return {};
      if (specifier === './native-profile-popover') return {default:()=>null};
      if (specifier === './anchored-popup-motion') return motionExports;
      throw Error(`Unexpected import in isolated component: ${specifier}`);
    },
    fixtureElement: (type, props, ...children) => ({type, props, children}),
    window, document,
    HTMLElement: FixtureNode, Element: FixtureNode, Node: FixtureNode,
    ResizeObserver: FixtureResizeObserver,
    queueMicrotask: callback => microtasks.push(callback),
    requestAnimationFrame: callback => {const id = ++frameSequence; frames.set(id, callback); return id;},
    cancelAnimationFrame: id => {if (frames.delete(id)) cancelled++;},
  };
  const motionExports = {};
  runInNewContext(compiledMotion, {...globals, exports: motionExports}, {filename: motionSourcePath});
  const exports = {};
  runInNewContext(compiled, {...globals, exports}, {filename: sourcePath});
  let element;
  const defaultClose = () => {closed++;};
  function render(close = defaultClose, nextAnchor = anchor) {
    hookIndex = 0;
    element = exports.AnchoredProfilePopover({title: 'Synthetic profile', anchor: nextAnchor, close, children: 'Synthetic profile content'});
    element.props.ref.current = node;
    for (const commit of pendingEffects.splice(0)) commit();
    return element;
  }
  function flushFrame() {
    phase = 'frame';
    const pending = [...frames.values()]; frames.clear();
    for (const callback of pending) callback(0);
    phase = 'idle';
    return pending.length;
  }
  function notify() {
    phase = 'observer';
    for (const observer of observers) observer.deliver();
    phase = 'idle';
  }
  function cleanup() {
    phase = 'cleanup';
    for (const slot of hookSlots) slot?.cleanup?.();
    element.props.ref.current = null;
    phase = 'idle';
  }
  function flushMicrotasks() {for (const callback of microtasks.splice(0)) callback();}
  render(); phase = 'idle';
  return {node, anchor, trigger, window, document, viewport, reducedMotion, observers, writes, frames, focusEvents, blurEvents, FixtureNode,
    notify, flushFrame, cleanup, flushMicrotasks, render,
    get element() {return element;}, get closed() {return closed;}, get cancelled() {return cancelled;},
  };
}

function insideViewport(test) {
  const box = test.node.getBoundingClientRect();
  assert.ok(box.left >= test.viewport.offsetLeft + 12 - 0.001, 'card remains inside the left margin');
  assert.ok(box.top >= test.viewport.offsetTop + 12 - 0.001, 'card remains inside the top margin');
  assert.ok(box.right <= test.viewport.offsetLeft + test.viewport.width - 12 + 0.001, 'card remains inside the right margin');
  assert.ok(box.bottom <= test.viewport.offsetTop + test.viewport.height - 12 + 0.001, 'card remains inside the bottom margin');
}

function check(name, run) {run(); passed.push(name);}

check('ResizeObserver delivery performs no layout writes; repeated resize sources coalesce into one frame', () => {
  const test = fixture();
  assert.equal(test.node.open, true);
  assert.equal(test.node.style.visibility, 'visible');
  assert.equal(test.document.activeElement, test.node, 'initial card is focused after synchronous placement');
  test.notify(); test.notify();
  test.window.emit('resize'); test.viewport.emit('resize'); test.viewport.emit('scroll');
  assert.deepEqual(test.writes.filter(write => write.phase === 'observer'), [], 'ResizeObserver must not synchronously write observed size or placement');
  assert.equal(test.frames.size, 1, 'notification bursts queue only one positioning frame');
  assert.equal(test.flushFrame(), 1);
  const limits = test.writes.filter(write => write.phase === 'frame' && write.property === 'maxHeight');
  assert.equal(limits.length, 1, 'a frame writes one final height cap, without temporarily enlarging the card');
  insideViewport(test); test.cleanup();
});

check('Bottom anchor keeps its gap across expansion, capped content and collapse', () => {
  const test = fixture();
  const initial = test.node.getBoundingClientRect();
  assert.equal(test.node.dataset.anchorSide, 'bottom');
  assert.equal(initial.top, test.anchor.getBoundingClientRect().bottom + 10);
  test.node.contentHeight = 1200; test.notify(); test.flushFrame();
  const expanded = test.node.getBoundingClientRect();
  assert.equal(expanded.top, initial.top); assert.equal(expanded.bottom, 858);
  assert.ok(test.node.scrollHeight > test.node.clientHeight, 'long content retains an internal scroll area');
  const finalCap = test.node.style.maxHeight;
  test.node.contentHeight = 1600; test.notify(); test.flushFrame();
  assert.equal(test.node.style.maxHeight, finalCap);
  assert.deepEqual(test.node.getBoundingClientRect(), expanded, 'further content growth leaves capped geometry stable');
  test.node.contentHeight = 220; test.notify(); test.flushFrame();
  assert.equal(test.node.getBoundingClientRect().height, 220);
  assert.equal(test.node.getBoundingClientRect().top, initial.top);
  insideViewport(test); test.cleanup();
});

check('Top anchor positions using actual final height when content expands and collapses', () => {
  const test = fixture({height: 600, anchorRect: {left: 400, top: 520, width: 24, height: 24}, contentHeight: 220});
  assert.equal(test.node.dataset.anchorSide, 'top');
  assert.equal(test.node.getBoundingClientRect().bottom, 510);
  test.node.contentHeight = 750; test.notify(); test.flushFrame();
  assert.equal(test.node.getBoundingClientRect().top, 12);
  assert.equal(test.node.getBoundingClientRect().bottom, 510);
  test.node.contentHeight = 240; test.notify(); test.flushFrame();
  assert.equal(test.node.getBoundingClientRect().top, 270);
  assert.equal(test.node.getBoundingClientRect().bottom, 510);
  insideViewport(test); test.cleanup();
});

check('Short and narrow windows, shifted visual viewport and restored dimensions retain final bounds', () => {
  const test = fixture({width: 260, height: 160, anchorRect: {left: 230, top: 66, width: 20, height: 24}, contentHeight: 1000});
  insideViewport(test);
  assert.equal(test.node.getBoundingClientRect().width, 236);
  assert.equal(test.node.getBoundingClientRect().height, 96);
  Object.assign(test.viewport, {width: 320, height: 200, offsetLeft: 30, offsetTop: 20});
  test.viewport.emit('resize'); test.viewport.emit('scroll'); test.flushFrame(); insideViewport(test);
  Object.assign(test.viewport, {width: 1194, height: 870, offsetLeft: 0, offsetTop: 0});
  test.window.emit('resize'); test.flushFrame(); insideViewport(test);
  assert.equal(test.node.getBoundingClientRect().width, 277.5, 'card recovers its established desktop width');
  test.cleanup();
  const self = fixture({naturalWidth: 380, contentHeight: 190});
  assert.equal(self.node.getBoundingClientRect().width, 380, 'shared positioning preserves the self-profile card width');
  insideViewport(self); self.cleanup();
});

check('Cleanup cancels queued work and stale callbacks cannot write an unmounted card', () => {
  const test = fixture();
  test.notify();
  const retainedCallback = [...test.frames.values()][0];
  test.cleanup();
  assert.equal(test.frames.size, 0); assert.equal(test.cancelled, 1);
  assert.equal(test.observers[0].disconnected, true);
  assert.equal(test.node.open, false);
  assert.equal(test.window.listenerCount() + test.document.listenerCount() + test.viewport.listenerCount() + test.reducedMotion.listenerCount(), 0);
  const writesAfterCleanup = test.writes.length;
  retainedCallback(0); test.notify();
  assert.equal(test.writes.length, writesAfterCleanup, 'active guard protects even an already-retained callback');
});

check('Inside scroll remains open; outside focus and lost anchors blur before closing', () => {
  const test = fixture();
  const input = new test.FixtureNode({parent: test.node, className: 'zy-inline-name-input'});
  test.document.activeElement = input;
  test.window.emit('scroll', {target: input}); assert.equal(test.closed, 0);
  test.document.emit('focusin', {target: new test.FixtureNode()});
  assert.equal(test.closed, 1); assert.deepEqual(test.blurEvents, [input]);
  test.notify(); assert.equal(test.frames.size, 0, 'dismissed card cannot schedule new positioning'); test.cleanup();
  const lost = fixture();
  const editor = new lost.FixtureNode({parent: lost.node}); lost.document.activeElement = editor;
  lost.anchor.isConnected = false; lost.notify(); lost.flushFrame(); lost.flushMicrotasks();
  assert.equal(lost.closed, 1); assert.deepEqual(lost.blurEvents, [editor]); lost.cleanup();
});

check('Escape restores trigger focus, editing Escape is retained, and current close callback is used', () => {
  const test = fixture();
  const editor = new test.FixtureNode({parent: test.node, className: 'zy-inline-name-input'});
  const editedEscape = test.document.emit('keydown', {key: 'Escape', target: editor});
  assert.equal(editedEscape.defaultPrevented, false); assert.equal(test.closed, 0);
  const escape = test.document.emit('keydown', {key: 'Escape', target: test.node});
  assert.equal(escape.defaultPrevented, true); assert.equal(test.closed, 1);
  test.cleanup(); assert.equal(test.document.activeElement, test.trigger);
  assert.equal(test.focusEvents.at(-1).options.preventScroll, true);
  const current = fixture(); let currentClosed = 0;
  current.render(() => {currentClosed++;});
  current.document.emit('pointerdown', {target: new current.FixtureNode()});
  assert.equal(currentClosed, 1); assert.equal(current.closed, 0, 'rerender updates latestClose without rebuilding observers');
  assert.equal(current.observers.length, 1); current.cleanup();
});

const report = {source: sourcePath, sharedMotionSource: motionSourcePath, reducedMotion: true, syntheticOnly: true, networkCalls: 0, browserStorageReads: 0, formalDataWrites: 0, checks: passed, passed: true};
if (outputArgument || !sourceArgument) {
  const outputPath = outputArgument ? resolve(outputArgument.slice('--output='.length)) : join(projectRoot, 'output/professional-profile-resize-fix-20261008/layout-regression.json');
  mkdirSync(dirname(outputPath), {recursive: true});
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
}
console.log(`PASS profile popover layout: ${passed.length} regression groups; real component executed with synthetic hooks/DOM only.`);
