/**
 * The documents the engine is told to write, rendered from the registry that
 * reads them back.
 *
 * Every heading and every alert in a prompt used to be typed a second time, by
 * hand, against `protocol/sections.ts`, with nothing checking the two agreed:
 * a renamed heading in one place was a section Suite stopped seeing, and the
 * only way to find out was a maintainer noticing a blank card. Here the
 * skeleton IS the registry, so the example in the prompt parses by
 * construction and `prompt.test.ts` proves it round-trips.
 *
 * No table anywhere since 2026-09-05: the plan on `facts-a-day-app#28` carried
 * four, three of them one row, and read badly for it. What has rows is a list,
 * one item per row, and the facts a table used to hold are one line.
 */
import { marker, type MarkerKind } from "../protocol/markers.js";
import { REGISTRY, type AlertKind, type DocKind, type SectionSpec } from "../protocol/sections.js";
import { EXPR } from "./stage.js";

/** What the engine puts under one heading, as the example it copies; omitted for a heading that carries nothing. */
interface Example {
  body?: string;
}

const FLOW = "- what starts it → what acts on it (a note only where one helps) → what the person sees";

const DOC_ITEM = "- [the guide](https://docs.example.com/guide): what it says, in eight words. Here: what this repo has today. Missing: what is missing or wrong.";

const FILE_ITEM = "- `path/to/file.ts` (add): why, in six words";

const SKETCH = ["```ts", "interface Thing {", "  id: string;", "  name: string; // was: title", "  tags: string[]; // new", "}", "```"].join("\n");

const TRY = "1. A command, or a page to open.\n   Expect: the exact observable result.";

const TODO_FIRST = "Make a CI token at the vendor (a robot token if it offers one): [their docs page](https://vendor.example/tokens).";
const TODO_THEN = "Add it as the `EXAMPLE_TOKEN` secret in Settings, Secrets and variables, Actions.";

/** The lede: an alert with no heading of its own, above the first one. */
const LEDE: Record<DocKind, { kind: AlertKind; text: string }> = {
  spec: { kind: "note", text: "Two sentences for the person who asked, who may not read code:\nwhat will change, and what they will see once it is done." },
  questions: { kind: "note", text: "One short paragraph in plain words for the person who asked: what\nyou understood the task to be, what you found, what you would do, and\nwhy their answer comes before the plan. No file names, no commands." },
  escalate: { kind: "caution", text: "Two sentences in plain words for the person who asked: why you stop\nhere, and that a person has to take the first step." },
  reply: { kind: "note", text: "Two sentences for the person who asked, who may not read code:\nwhat you changed for them, or the answer. No file names, no commands." },
  pr: { kind: "note", text: "Two sentences for the person who asked, who may not read code:\nwhat changed for them, and what they will see." },
  notice: { kind: "note", text: "" },
};

const EXAMPLES: Record<DocKind, Record<string, Example>> = {
  spec: {
    title: {},
    todos: { body: `- ${TODO_FIRST}\n- ${TODO_THEN}` },
    meta: { body: "Size M · Files 4 · Contract wire protocol" },
    problem: { body: "What is wrong or missing, two sentences at most, naming the file\nand what the comparison showed." },
    docs: { body: DOC_ITEM },
    approach: { body: "1. One numbered step per move, naming the real file.\n2. Pseudo code in a fence beats a paragraph describing code.\n3. The tests to add, last: the file and the cases." },
    files: { body: FILE_ITEM },
    schema: { body: SKETCH },
    flow: { body: FLOW },
    criteria: { body: "- One observable, verifiable behaviour per bullet." },
    try: { body: TRY },
  },
  escalate: {
    docs: { body: DOC_ITEM },
    needs: { body: "- One bullet per step a person can carry out today." },
    found: { body: "- `path/to/file.ts:42`: what is there, in six words" },
  },
  reply: {
    todos: { body: `- [ ] ${TODO_FIRST}\n- [ ] ${TODO_THEN}` },
    changed: { body: "- `path/to/file.ts` (edit): why, in six words" },
    notes: { body: "- The detail, one bullet each: the file and line, what you checked,\n  what you chose and why." },
  },
  pr: {
    todos: { body: `- [ ] ${TODO_FIRST}\n- [ ] ${TODO_THEN}` },
    meta: { body: "Files 4 · Lines +120 -18 · Checks 2 green" },
    summary: { body: "At most two sentences: what this does and why, from the spec's\nProblem, and which way you went on anything the spec left open." },
    docs: { body: DOC_ITEM },
    changed: { body: FILE_ITEM },
    flow: { body: FLOW },
    criteria: { body: "- [x] The spec's criterion, copied, ticked because it is met.\n- [ ] One you could not meet, with why in the same line." },
    checks: { body: "```sh\n<the install command, then every command from /tmp/aiswec-gates.txt in order>\n```" },
    try: { body: `${TRY}\n2. Open \`/some/page\`.\n   Expect: what is visible there.` },
  },
  questions: {},
  notice: {},
};

function render(spec: SectionSpec, example: Example): string {
  const heading = `${"#".repeat(spec.level)} ${spec.heading}`;
  const body = example.body ?? "";
  return body === "" ? heading : `${heading}\n\n${body}`;
}

export function alert(kind: AlertKind, text: string): string {
  const head = `> [!${kind.toUpperCase()}]`;
  return [head, ...text.split("\n").map((line) => (line === "" ? ">" : `> ${line}`))].join("\n");
}

/**
 * The document as the engine is told to write it: the lede, then every heading
 * the registry declares, in registry order, byte for byte.
 */
export function skeleton(kind: DocKind, opts: { marker?: MarkerKind } = {}): string {
  const parts: string[] = [];
  const lede = LEDE[kind];
  // The marker sits directly on top of the lede, with no blank line: that is
  // how `docs/wire.md` shows it and how every comment already on GitHub reads.
  const head = alert(lede.kind, lede.text);
  parts.push(opts.marker ? `${marker(opts.marker, EXPR.namespace)}\n${head}` : head);
  for (const spec of REGISTRY[kind]) {
    if (spec.key === "plain") continue;
    // A section the finalizer writes (the pull request's Preview) is never the engine's to write,
    // and a retired one (the spec's Test plan) is only read from what is already on GitHub.
    if (spec.finalizer || spec.retired) continue;
    const example = EXAMPLES[kind][spec.key];
    if (example === undefined) continue;
    parts.push(render(spec, example));
  }
  return parts.join("\n\n");
}

/** The rule every document carries in place of the table rule it had until 2026-09-05. */
export const NO_TABLES = `No tables, anywhere in what you write: what has rows is a list, one
item per row, which is what reads back. A one-row table says one line
badly, and a table with sentences in its cells wraps badly on a phone.`;

/** The facts line both the spec and the pull request open with; the stage names the labels. */
export const FACTS_RULE = `At a glance: one line and nothing else, every label of the example in
its order, each followed by its value, the pairs separated by " · ".`;

/** The files list: the spec's Affected files, the pull request's Changes, the reply's What changed. */
export const FILES_RULE = `one bullet per file: the path in backticks, the change in parentheses,
exactly one of add, edit, delete, then a colon and why in at most six
words.`;

/** The steps a person runs: the spec's Try it, the pull request's Manual verification. */
export const TRY_RULE = `1 to 3 numbered steps the maintainer can run locally: the first line
of each is a command or a page to open, the next line starts with
"Expect:" and gives the exact observable result. A check only a person
can run (a build on their account, a device, a paid service) is a step
here, said as theirs; what they must set up first is a manual todo.`;

/**
 * The person's steps, shared by the spec, the pull request and the reply:
 * CODE.md's third rule (2026-09-06), never buried in prose. Only what the bot
 * cannot get on its own; a workflow file is the bot's since the build and
 * revise tokens carry workflows write. The spec's are bare bullets, since a
 * tick on GitHub edits the comment and refuses the approval; the pull
 * request's and the reply's are a task list.
 */
export const TODOS_RULE = `Manual todos: one bullet per step only a person can take and this
plan cannot work without: a secret to add, a permission to grant, a
token to make, a setting in an account or a store. Each is the step and
exactly where, in one line, as theirs: no reason, no history, nothing
optional. What must be obtained first (a token, a key) is its own
bullet before the step that uses it: which kind, where it is made, the
docs page. A step in another repository, or possible only after this
ships, opens "Follow-up in <repository>:", names the change that
repository must make, and never holds the plan. Leave the section out
when there is none, and never bury such a step in prose or in Try it.`;

/** The one shape both refine and revise use to ask a maintainer something. */
export function questionsBlock(): string {
  return `${marker("questions", EXPR.namespace)}
${alert("note", LEDE.questions.text)}

### 1. The question, one sentence, in plain words

One line on why it matters, and which way you would go.

- (a) An option, one sentence: what they would get, and what it asks of them (recommended)
- (b) Another option
- (c) Another option

### 2. The next question (pick all that apply)

- (a) An option
- (b) Another option`;
}

export const QUESTION_RULES = `Number the questions 1, 2, 3 and letter the options (a), (b), (c); two
to four options each; mark the one you would choose "(recommended)" at
the end of its line, at most one per question; add "(pick all that
apply)" to a heading only when more than one option can be true. At
most three questions, and one is usually right. The person can always
answer in their own words, so never add an "other" option. When the
docs have an opinion, say which option they recommend, in its line.
When the question is which way to go, each option is a way forward:
what it would change here and what it asks of them (a secret to add, a
step only they can take), and the recommended one is the way you would
build, with why in the line under the heading. Never ask what would not
change what the person gets: decide it, and say what you decided.`;

/**
 * The FLOW rule, shared by the spec and the PR body. Arrows since
 * 2026-10-07: a mermaid fence read as letters and boxes wherever it was not
 * drawn, and a chain of a few steps needs no diagram to be seen.
 */
export const FLOW_RULE = `Flow: how the change moves, as arrows, expected whenever something
moves (a click and what answers it, data between modules, a state that
changes) and left out only when nothing does (a rename, a copy edit, a
one-line fix). One bullet per path, its steps joined by " → ", each a
few words naming what acts or what the person sees, a note in
parentheses only where a step needs one; at most 3 bullets of at most 6
steps. No diagram code, no letters or ids for steps.`;

/**
 * The Code sketch rule, the spec's: the code a change turns on, shown rather
 * than described. "Schema" until 2026-10-07, when plans had long been
 * putting a component's props under it as readily as a table.
 */
export const SKETCH_RULE = `Code sketch: the code this change turns on, whatever its kind (a type, a
component's props or markup, a table, a config key, a payload, a
signature), in a fence tagged with its language, written as it will be
after the change, a comment on every line that changes saying what it
was and on every new line saying so; code new as a whole (a new file, a
new type) is marked once, on the fence's first line, its lines
uncommented. One fence per language, nothing else in the section. Leave
it out only when no shape changes.`;

/** The "What the docs say" rule, shared by the spec, the escalation and the PR. */
export const DOCS_RULE = `What the docs say: one bullet per source you read: the markdown link,
a colon, what it states in at most eight words, then "Here:" and what
this repository has, then "Missing:" and what is missing or wrong. Only
pages you opened in this run, never an invented URL; leave the section
out when you read none.`;
