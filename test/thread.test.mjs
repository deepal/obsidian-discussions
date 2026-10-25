import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const hostCode = `
 export class Component {
  cleanup = []; children = [];
  register(fn) { this.cleanup.push(fn); }
  addChild(child) { this.children.push(child); return child; }
  removeChild(child) { child.unload(); this.children = this.children.filter(c => c !== child); }
  registerDomEvent(el, name, fn) { el.addEventListener(name, fn); this.register(() => el.removeEventListener(name, fn)); }
  unload() { this.children.forEach(c => c.unload()); this.cleanup.splice(0).forEach(fn => fn()); }
 }
 export class MarkdownRenderChild extends Component {}
 export class MarkdownView {} export class Notice {} export class TFile {}
 export class Scope { register() {} }
 export class Menu {
  addItem(fn) { const item = {setTitle() {return item;}, setIcon() {return item;}, onClick(fn) {globalThis.__deleteDiscussion = fn; return item;}}; fn(item); }
  showAtMouseEvent() {}
 }
 export function setIcon() {}
 export const MarkdownRenderer = {async render(_app, body, el) {el.setText(body);}};
`;
const bundle = await build({
 stdin: {contents: `export {renderThread} from './src/thread.ts'; export {ReadingViewManager} from './src/reading-view.ts'; export {MentionClient} from './src/mention-client.ts'; export {discussionFormat} from './src/mention-format.ts'; export {parseDiscussionRegions} from './src/parser.ts'; export {Component} from 'obsidian';`, resolveDir: process.cwd()},
 bundle: true, platform: "node", format: "esm", write: false,
 plugins: [{name: "host", setup(builder) {
  builder.onResolve({filter: /^obsidian$/}, () => ({path: "obsidian", namespace: "host"}));
  builder.onLoad({filter: /.*/, namespace: "host"}, () => ({contents: hostCode}));
 }}],
});
const {renderThread, ReadingViewManager, MentionClient, discussionFormat, parseDiscussionRegions, Component} = await import(
 `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

class Element {
 constructor(tag = "div", options = {}) {
  this.tag = tag; this.children = []; this.parentElement = null; this.events = new Map();
  this.classes = new Set((options.cls ?? "").split(/\s+/).filter(Boolean)); this.attributes = {...options.attr};
  this.text = options.text ?? ""; this.disabled = false; this.value = ""; this.isConnected = true;
  this.clientWidth = 100; this.scrollHeight = 30; this.offsetHeight = 32; this.clientHeight = 30;
  this.style = {setProperty() {}};
  this.classList = {toggle: (cls, enabled) => enabled ? this.classes.add(cls) : this.classes.delete(cls)};
  this.ownerDocument = {createTextNode: text => new Element("#text", {text})};
 }
 append(child) { child.remove(); child.parentElement = this; this.children.push(child); return child; }
 createEl(tag, options) { return this.append(new Element(tag, options)); }
 createDiv(options) { return this.createEl("div", options); }
 createSpan(options) { return this.createEl("span", options); }
 insertBefore(child, before) {
  assert.ok(this.children.includes(before)); child.remove();
  child.parentElement = this; this.children.splice(this.children.indexOf(before), 0, child);
 }
 insertAdjacentElement(position, child) {
  assert.equal(position, "afterend"); child.remove(); child.parentElement = this.parentElement;
  this.parentElement.children.splice(this.parentElement.children.indexOf(this) + 1, 0, child);
 }
 remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(c => c !== this); this.parentElement = null; }
 empty() { this.children.forEach(c => { c.parentElement = null; }); this.children = []; this.text = ""; }
 setText(text) { this.empty(); this.text = text; }
 get textContent() { return this.text + this.children.map(c => c.textContent).join(""); }
 addClass(cls) { this.classes.add(cls); } removeClass(cls) { this.classes.delete(cls); }
 setAttribute(key, value) { this.attributes[key] = value; } removeAttribute(key) { delete this.attributes[key]; }
 hide() { this.hidden = true; } show() { this.hidden = false; } setCssProps() {}
 addEventListener(name, fn) { const fns = this.events.get(name) ?? new Set(); fns.add(fn); this.events.set(name, fns); }
 removeEventListener(name, fn) { this.events.get(name)?.delete(fn); }
 dispatch(name) { for (const fn of this.events.get(name) ?? []) fn({preventDefault() {}, stopPropagation() {}}); }
 click() { if (!this.disabled) this.dispatch("click"); } focus() { this.dispatch("focus"); }
 matches(selector) {
  if (selector === "button:not(.cb-form__cancel)") return this.tag === "button" && !this.classes.has("cb-form__cancel");
  return selector.startsWith(".") ? this.classes.has(selector.slice(1)) : this.tag === selector;
 }
 querySelectorAll(selector) {
  return this.children.flatMap(c => [...(selector.split(/,\s*/).some(s => c.matches(s)) ? [c] : []), ...c.querySelectorAll(selector)]);
 }
 querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}
globalThis.createDiv = options => new Element("div", options);
globalThis.ResizeObserver = class { observe() {} disconnect() {} };

const note = `<discussion>
<comment id="1" author="Root">Root request</comment>
<comment id="2" author="Child" parent_id="1">Nested request</comment>
<comment id="3" author="Deep" parent_id="2">Deep request</comment>
<comment id="4" author="Sibling" parent_id="1">Sibling request</comment>
<comment id="5" author="Other">Other thread</comment>
</discussion>`;
const region = parseDiscussionRegions(note)[0];
const direct = (el, cls) => el.children.find(c => c.classes.has(cls));
const mainFor = (el, author) => el.querySelectorAll(".cb-comment__main").find(main => direct(main, "cb-comment__meta").textContent === author);
const actionFor = (el, text) => el.querySelectorAll(".cb-action").find(action => action.textContent === text);
const buttonFor = (el, text) => el.querySelectorAll("button").find(button => button.textContent === text);
const jobFor = (id, state = "running") => ({request: {id: `job-${id}`, commentId: id}, tag: "teddy", state, detail: `Working on ${id}`});
function fixture(jobs = []) {
 const app = {keymap: {pushScope() {}, popScope() {}}};
 const client = new MentionClient({app}, "comment-block", discussionFormat, () => true);
 const cancelled = [], retried = [], writes = [];
 client.bridge = {tag: "teddy", jobs: () => jobs, cancel: id => cancelled.push(id), retry: async id => {retried.push(id);}};
 const editing = Object.fromEntries(["onAddComment", "onReply", "onEdit", "onDelete", "onDeleteDiscussion"].map(name => [name, (...args) => writes.push([name, ...args])]));
 const owners = [];
 const render = (editable = true, target = region) => {
  const panel = new Element(); const owner = new Component(); owners.push(owner);
  const context = {app, component: owner, settings: {renderMarkdown: false}, sourcePath: "Note.md", mentions: client};
  if (editable) context.editing = editing;
  renderThread(panel, target, context);
  return {panel, owner};
 };
 return {client, app, jobs, cancelled, retried, writes, render, emit: () => client.notify(), cleanup: () => owners.forEach(owner => owner.unload())};
}

for (const editable of [true, false]) {
 test(`activity belongs to each initiating comment at every depth (${editable ? "editor" : "Reading view"})`, () => {
  const f = fixture([jobFor("1"), jobFor("2"), jobFor("3"), jobFor("4"), jobFor("5", "queued")]);
  const {panel} = f.render(editable);
  for (const [id, author] of [["1", "Root"], ["2", "Child"], ["3", "Deep"], ["4", "Sibling"], ["5", "Other"]]) {
   const main = mainFor(panel, author), status = direct(main, "aio-mention-status");
   assert.ok(status, `${author} must own its activity`);
   assert.equal(status.children.length, 1, "descendant jobs must not aggregate at an ancestor");
   assert.match(status.textContent, id === "5" ? /queued/ : new RegExp(`Working on ${id}$`));
   assert.equal(main.children.indexOf(status), main.children.indexOf(direct(main, "cb-comment__body")) + 1);
  }
  assert.equal(panel.querySelectorAll(".aio-mention-status").length, 5);
  f.cleanup();
 });
}

test("nested activity updates preserve dots, composers and drafts; terminal states and teardown clean up", () => {
 const job = jobFor("3"), f = fixture([job]);
 const {panel, owner} = f.render();
 const main = mainFor(panel, "Deep"); actionFor(direct(main, "cb-comment__actions"), "Reply").click();
 const form = direct(main, "cb-reply-form"), input = form.querySelector("textarea"); input.value = "Keep my draft";
 const status = direct(main, "aio-mention-status"), dots = status.querySelector(".aio-mention-typing");
 assert.ok(input.disabled); assert.ok(main.children.indexOf(status) < main.children.indexOf(form));
 job.detail = "New streamed detail"; f.emit();
 assert.equal(direct(main, "aio-mention-status"), status); assert.equal(status.querySelector(".aio-mention-typing"), dots);
 assert.equal(direct(main, "cb-reply-form"), form); assert.equal(input.value, "Keep my draft");
 assert.equal(status.querySelector(".aio-mention-step").textContent, "New streamed detail");
 job.state = "completed"; f.emit();
 assert.equal(direct(main, "aio-mention-status"), undefined); assert.equal(input.disabled, false);
 job.state = "running"; f.emit(); assert.ok(direct(main, "aio-mention-status"));
 owner.unload(); assert.equal(panel.querySelectorAll(".aio-mention-status").length, 0);
 assert.equal(input.disabled, false); f.emit(); assert.equal(panel.querySelectorAll(".aio-mention-status").length, 0);
});

test("reply locking still covers the root's entire subtree without locking another root", () => {
 const f = fixture([jobFor("3")]), {panel} = f.render();
 for (const [author, locked] of [["Root", true], ["Child", true], ["Sibling", true], ["Other", false]]) {
  const main = mainFor(panel, author); actionFor(direct(main, "cb-comment__actions"), "Reply").click();
  assert.equal(direct(main, "cb-reply-form").querySelector("textarea").disabled, locked);
 }
 f.cleanup();
});

test("Reading view has no editing controls or Retry, but activity and Stop work beside an editable pane", () => {
 const f = fixture([jobFor("3"), jobFor("4", "failed")]);
 const read = f.render(false).panel, edit = f.render().panel;
 assert.equal(read.querySelectorAll(".cb-action, .cb-thread__menu, .cb-thread__footer, .cb-comment__actions, textarea").length, 0);
 assert.equal(buttonFor(read, "Retry"), undefined); assert.ok(buttonFor(edit, "Retry"));
 read.querySelector(".aio-mention-cancel").click(); assert.deepEqual(f.cancelled, ["job-3"]);
 buttonFor(edit, "Retry").click(); assert.deepEqual(f.retried, ["job-4"]);
 assert.deepEqual(f.writes, []); f.cleanup();
});

test("Reading view post-processor renders populated and empty panels without any source writes", () => {
 const f = fixture(), children = [];
 const manager = new ReadingViewManager({app: {vault: new Proxy({}, {get() {assert.fail("Reading view must not access vault writes");}})}, settings: {enabled: true, renderMarkdown: false}, mentions: f.client});
 for (const text of [note, "<discussion></discussion>"]) {
  const panel = new Element();
  manager.handleBlock(panel, {sourcePath: "Note.md", getSectionInfo: () => ({text, lineStart: 0, lineEnd: text.split("\n").length - 1}), addChild: child => children.push(child)});
  assert.ok(panel.querySelector(".cb-thread__title"));
  assert.equal(panel.querySelectorAll(".cb-action, button, textarea").length, 0);
 }
 assert.equal(children.length, 2); children.forEach(child => child.unload());
});

test("editor add, reply, edit and deletion actions retain their editing capability", () => {
 const f = fixture(), {panel} = f.render();
 const submit = (form, text) => {form.querySelector("textarea").value = text; form.querySelector(".cb-form__save").click();};
 actionFor(panel, "Add comment").click(); submit(panel.querySelector(".cb-add-form"), "New comment");
 const main = mainFor(panel, "Deep"), actions = direct(main, "cb-comment__actions");
 actionFor(actions, "Reply").click(); submit(direct(main, "cb-reply-form"), "Reply text");
 actionFor(actions, "Edit").click(); assert.equal(direct(main, "cb-edit-form").querySelector("textarea").value, "Deep request");
 submit(direct(main, "cb-edit-form"), "Edited text");
 actionFor(actions, "Delete").click(); actionFor(actions.querySelector(".cb-confirm"), "Delete").click();
 panel.querySelector(".cb-thread__menu").click(); globalThis.__deleteDiscussion();
 actionFor(panel.querySelector(".cb-thread__confirm"), "Delete").click();
 assert.deepEqual(f.writes.map(([name]) => name), ["onAddComment", "onReply", "onEdit", "onDelete", "onDeleteDiscussion"]);
 assert.equal(f.writes[1][1].id, "3"); assert.equal(f.writes[1][2], "Reply text"); f.cleanup();
});
