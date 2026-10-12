/**
 * What AISWEC wrote, read back as its parts.
 *
 * Everything the stages post is GitHub-flavoured markdown and nothing else: a
 * person reading the issue sees the whole document, and Suite has to see the
 * same document and know what each part of it is. That is this module. It scans
 * a body for its headings, gives a heading the key the registry has for it, and
 * hands the section's markdown to the reader for that key's shape, so a list of
 * files reads back as items and a flow reads back as its steps.
 *
 * Two rules make it safe to point at a comment nobody vetted. It never throws:
 * a shape that does not read back is `undefined`, and Suite renders the markdown
 * it renders today, so a comment written before this format, or by a person, or
 * by an engine having a bad day, still shows everything it says. And it never
 * drops anything: an unknown heading is kept in document order, a renamed column
 * makes the whole table read back as prose rather than as half a table, and a
 * body truncated inside a fence is rescanned so its sections survive.
 *
 * The registry is the contract, written down in `docs/wire.md`. Adding a heading
 * is additive; renaming one needs an alias that is never removed.
 */
import { DEFAULT_NAMESPACE, markerLinePattern, stripMarkerLines } from "./markers.js";
import { escapeRegExp, splitLines, trimBlankEdges } from "./util.js";

export type Shape = "text" | "alert" | "table" | "facts" | "files" | "list" | "olist" | "checks" | "todo" | "code" | "flow";

/** The documents the stages write, one registry each. */
export type DocKind = "spec" | "questions" | "escalate" | "reply" | "pr" | "notice";

export type AlertKind = "note" | "tip" | "important" | "warning" | "caution";

export interface TableData {
  /** The header row as written, so a renamed column is still visible. */
  columns: string[];
  rows: string[][];
  /** Each row keyed by its lower-cased column name. */
  records: Record<string, string>[];
}

/**
 * One line of labelled values, `Size M · Files 4 · Contract none · Checks 2`:
 * what the At a glance table held until 2026-09-05, and the table still reads
 * back as this, first row only.
 */
export interface FactsData {
  /** The labels as written, in order. */
  labels: string[];
  /** Each value keyed by its lower-cased label. */
  values: Record<string, string>;
}

/** One bullet of a files list, `` `path` (add): why ``; a Path/Change/Why table reads back as the same. */
export interface FileItem {
  path: string;
  /** add, edit or delete, as written. */
  change: string;
  why: string;
}

/** A `checks` item, and a `todo` item: a step of the person's, ticked or not. */
export interface CheckItem {
  done: boolean;
  text: string;
}

export interface CodeData {
  /** The fence's info string, first word only; `null` for a bare fence. */
  lang: string | null;
  lines: string[];
}

/**
 * A flow written as arrows (2026-10-07): one path per bullet, its steps in
 * order, each step as written, inline markdown and all. A flow written as a
 * mermaid fence, which is every plan before that day, reads back as its code.
 */
export interface FlowData {
  paths: string[][];
}

export interface AlertData {
  kind: AlertKind;
  /** The `**Title.**` line, when the alert opens with one. */
  title: string | null;
  text: string;
}

export type SectionData = string | string[] | TableData | FactsData | FileItem[] | CheckItem[] | CodeData | FlowData | AlertData | undefined;

export interface SectionSpec {
  key: string;
  /** The heading as the engine is told to write it. */
  heading: string;
  /** Older names, kept forever, and the names a hand-written body uses. */
  aliases: readonly string[];
  level: 2 | 3;
  shape: Shape;
  /** Column headers a table has to carry to read back as one, and the labels a facts line has to carry. */
  columns: readonly string[];
  required: boolean;
  /** Written by the stage's finalizer, never by the engine; the skeleton omits it. */
  finalizer?: true;
  /** Read from documents already on GitHub, never written again; the skeleton omits it. */
  retired?: true;
}

export interface Section {
  /** The registry key, or `null` for a heading the registry does not know. */
  key: string | null;
  /** The heading as written. */
  title: string;
  level: 2 | 3;
  /** The section's markdown, marker lines removed, blank edges trimmed. */
  body: string;
  shape: Shape;
  /** What the shape reader made of the body, or `undefined` when it could not. */
  data: SectionData;
}

export interface Doc {
  kind: DocKind;
  /** At least one heading matched a registry key. */
  typed: boolean;
  /** The body ended inside an unterminated fence, so the scan ignored fences. */
  recovered: boolean;
  /** The lede: the alert above the first heading, or the plain words section. */
  plain: AlertData | null;
  /** Everything before the first heading, marker lines removed. */
  preface: string;
  sections: Section[];
  /** The keyed sections, first occurrence wins. */
  byKey: Record<string, Section>;
}

function entry(
  key: string,
  heading: string,
  level: 2 | 3,
  shape: Shape,
  extra: { aliases?: readonly string[]; columns?: readonly string[]; required?: boolean; finalizer?: true; retired?: true } = {},
): SectionSpec {
  return {
    key,
    heading,
    aliases: extra.aliases ?? [],
    level,
    shape,
    columns: extra.columns ?? [],
    required: extra.required ?? false,
    ...(extra.finalizer ? { finalizer: true as const } : {}),
    ...(extra.retired ? { retired: true as const } : {}),
  };
}

/**
 * The lede has no heading of its own in a document the engine wrote: it is the
 * alert above the first one. The section is here so a body that spells it out,
 * which is every plan written before this format, still reads back as the lede.
 */
function plainWords(level: 2 | 3): SectionSpec {
  return entry("plain", "In plain words", level, "alert", { required: true });
}

export const REGISTRY: Record<DocKind, readonly SectionSpec[]> = {
  spec: [
    plainWords(3),
    entry("title", "Implementation Spec", 2, "text"),
    // What only a person can do, first: read before the plan, ticked in Suite. "Your part" until 2026-09-06.
    entry("todos", "Manual todos", 3, "todo", { aliases: ["Your part"] }),
    // Checks counted the Test plan's commands, and went with it (2026-10-07); a plan that still carries it reads back.
    entry("meta", "At a glance", 3, "facts", {
      aliases: ["Size estimate"],
      columns: ["Size", "Files", "Contract"],
      required: true,
    }),
    entry("problem", "Problem", 3, "text", { required: true }),
    entry("docs", "What the docs say", 3, "list"),
    entry("approach", "Proposed approach", 3, "olist", { aliases: ["Approach"], required: true }),
    entry("files", "Affected files", 3, "files", {
      aliases: ["Files"],
      columns: ["Path", "Change", "Why"],
      required: true,
    }),
    // Any code the change turns on, a component's props as much as a table: "Schema" until 2026-10-07.
    entry("schema", "Code sketch", 3, "code", { aliases: ["Schema"] }),
    // Arrows since 2026-10-07; a mermaid fence still reads back.
    entry("flow", "Flow", 3, "flow"),
    entry("criteria", "Acceptance criteria", 3, "list", { aliases: ["Done when"], required: true }),
    entry("try", "Try it", 3, "olist", { aliases: ["Manual verification"] }),
    // Retired 2026-10-07: the gates run on every build anyway, and the defaults a plan decided were never questions.
    entry("checks", "Test plan", 3, "code", { aliases: ["Checks"], retired: true }),
    entry("open", "Open questions", 3, "list", { retired: true }),
  ],
  // The question grammar is `parseQuestions`'s; what the registry knows is the lede.
  questions: [plainWords(3)],
  escalate: [
    plainWords(3),
    entry("docs", "What the docs say", 3, "list"),
    entry("needs", "What a person has to do", 3, "list", { required: true }),
    entry("found", "What I found", 3, "list"),
  ],
  reply: [
    plainWords(3),
    entry("todos", "Manual todos", 3, "todo", { aliases: ["Your part"] }),
    entry("changed", "What changed", 3, "files", { columns: ["Path", "Change", "Why"] }),
    entry("notes", "Notes", 3, "list"),
  ],
  pr: [
    plainWords(2),
    entry("todos", "Manual todos", 2, "todo", { aliases: ["Your part"] }),
    // Where the change can be opened: the finalizer's, after the export step, never the engine's (2026-09-06).
    entry("preview", "Preview", 2, "facts", { columns: ["Built from", "Status"], finalizer: true }),
    entry("meta", "At a glance", 2, "facts", { columns: ["Files", "Lines", "Checks"], required: true }),
    entry("summary", "Summary", 2, "text", { required: true }),
    entry("docs", "What the docs say", 2, "list"),
    entry("changed", "Changes", 2, "files", { columns: ["Path", "Change", "Why"], required: true }),
    entry("flow", "Flow", 2, "flow"),
    entry("criteria", "Acceptance criteria", 2, "checks", { required: true }),
    entry("checks", "Automated", 3, "code", { required: true }),
    entry("try", "Manual verification", 3, "olist", { aliases: ["Try it"] }),
  ],
  // A notice is its alert, its table of what it knows, and what to do about it.
  notice: [plainWords(3)],
};

/**
 * The reasons a notice names. This is `BotReason` in `state.ts`, declared again
 * here because the dependency runs the other way: `state.ts` reads this module,
 * and asserts the two agree.
 */
export type NoticeReason =
  | "settings-invalid"
  | "refine-failed"
  | "no-trusted-spec"
  | "stale-spec"
  | "draft-pr"
  | "no-pr"
  | "revise-failed"
  | "held"
  | "dispatch-failed"
  | "labels-unreadable";

/** The finalizers' titles, byte for byte. The title is what names the reason. */
export const NOTICE_TITLES: Record<string, NoticeReason> = {
  "AISWEC cannot start: the settings file is invalid.": "settings-invalid",
  "Refine failed: no plan was produced.": "refine-failed",
  "Build stopped: no trusted plan to build.": "no-trusted-spec",
  "Build stopped: a newer plan was posted after that approval.": "stale-spec",
  "Build finished with a draft pull request.": "draft-pr",
  "Build failed: no pull request was opened.": "no-pr",
  "Revise failed: the feedback was not processed.": "revise-failed",
  "Build withheld: the hold label is set.": "held",
  "Build could not be started automatically.": "dispatch-failed",
  "Build not started: the labels could not be read.": "labels-unreadable",
};

const HEADING = /^(##|###)\s+(.+)$/;
/** A fence, at any indent, since one inside a list item is indented under it. */
const FENCE = /^(\s*)(`{3,}|~{3,})(.*)$/;
const ALERT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/i;
const BOLD_LINE = /^\*\*(.+?)\*\*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const TICK = /^\[([ xX])\]\s*(.*)$/;
const SEPARATOR_CELL = /^:?-+:?$/;
/** A cell boundary is a pipe nobody escaped. */
const CELL = /(?<!\\)\|/;
const TRAILING_PIPE = /(?<!\\)\|$/;
const DIAGRAM = /^(flowchart|graph|sequenceDiagram|stateDiagram(?:-v2)?|erDiagram|classDiagram)\b/;
/** One fact of the facts line: the label (one word, bold or not, a colon or not), then its value. */
const FACT = /^\**([A-Za-z]+)\**:?\s+(.+?)\s*$/;
/** The parts of a facts line; `·` is what the engine is told to write, the others are what it may write. */
const FACT_JOIN = /\s*[·•|]\s*/;
/** One bullet of a files list: the path, bare or in backticks, the change in parentheses, the why after a colon. */
const FILE_ITEM = /^`?([^`\s]+)`?\s*\(([a-z]+)\)\s*:?\s*(.*)$/;
/** The arrow between two steps of a flow, at this point of a line: the one the engine is told to write, or the ASCII one. */
const ARROW = /^\s+(?:→|->)(?=\s)/;

interface Head {
  line: number;
  level: 2 | 3;
  title: string;
}

interface Scan {
  headings: Head[];
  /** Per line: was it inside, or was it, a fence. */
  fenced: boolean[];
  unterminated: boolean;
}

function chomp(line: string): string {
  return line.replace(/\s+$/, "");
}

/**
 * One flat pass for every `##` and `###` outside a fence. A heading inside a
 * fence is content: the plans this reads are full of markdown examples.
 */
function scan(lines: readonly string[], ignoreFences: boolean): Scan {
  const headings: Head[] = [];
  const fenced: boolean[] = [];
  let open: { char: string; length: number } | null = null;

  for (const raw of lines) {
    const line = chomp(raw);
    const fence = ignoreFences ? null : FENCE.exec(line);
    if (fence) {
      const ticks = fence[2] ?? "";
      const char = ticks[0] ?? "`";
      const info = (fence[3] ?? "").trim();
      if (open === null) {
        // A backtick fence's info string may not itself hold a backtick.
        if (!(char === "`" && info.includes("`"))) {
          open = { char, length: ticks.length };
          fenced.push(true);
          continue;
        }
      } else if (char === open.char && ticks.length >= open.length && info === "") {
        open = null;
        fenced.push(true);
        continue;
      }
    }
    fenced.push(open !== null);
    if (open !== null) continue;
    const head = HEADING.exec(line);
    if (head) {
      headings.push({
        line: fenced.length - 1,
        level: (head[1] ?? "##").length === 3 ? 3 : 2,
        title: (head[2] ?? "").trim(),
      });
    }
  }

  return { headings, fenced, unterminated: open !== null };
}

/** Case, spacing, emphasis and a trailing full stop are not part of a heading's identity. */
function normalise(title: string): string {
  return title
    .replace(/\s+#+\s*$/, "")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.:;!?]+$/, "")
    .trim()
    .toLowerCase();
}

function unescapeCell(cell: string): string {
  const text = cell.replace(/\\\|/g, "|").trim();
  // A cell may be `code` and reads back without the backticks, one pair of them.
  const bare = /^`([^`]*)`$/.exec(text);
  return (bare?.[1] ?? text).trim();
}

function cells(line: string): string[] {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (TRAILING_PIPE.test(text)) text = text.slice(0, -1);
  return text.split(CELL).map(unescapeCell);
}

function isSeparator(line: string): boolean {
  if (!line.includes("|")) return false;
  const parts = cells(line);
  return parts.length > 0 && parts.every((part) => SEPARATOR_CELL.test(part));
}

/**
 * A GFM table, and only a whole one: a header, its separator, at least one row,
 * every row the width of the header, and every column the registry asked for.
 * Anything else is prose that happens to contain pipes, and reads back as prose.
 */
function readTable(body: string, columns: readonly string[]): TableData | undefined {
  const lines = trimBlankEdges(splitLines(body));
  for (let index = 0; index + 1 < lines.length; index++) {
    const header = lines[index] ?? "";
    if (!header.includes("|")) continue;
    const rule = lines[index + 1] ?? "";
    if (!isSeparator(rule)) continue;
    const names = cells(header);
    if (names.length === 0 || cells(rule).length !== names.length) continue;

    const rows: string[][] = [];
    for (let at = index + 2; at < lines.length; at++) {
      const line = lines[at] ?? "";
      if (line.trim() === "" || !line.includes("|")) break;
      const row = cells(line);
      if (row.length !== names.length) return undefined;
      rows.push(row);
    }
    if (rows.length === 0) return undefined;

    const lower = names.map((name) => name.toLowerCase());
    for (const want of columns) {
      if (!lower.includes(want.toLowerCase())) return undefined;
    }
    const records = rows.map((row) => {
      const record: Record<string, string> = {};
      lower.forEach((name, at) => {
        record[name] = row[at] ?? "";
      });
      return record;
    });
    return { columns: names, rows, records };
  }
  return undefined;
}

/**
 * The items of a list, with a wrapped line folded back into the item above it.
 * A sentence or two above the list is the engine's licence, so a lead-in is
 * skipped rather than refused; it stays in the section's body either way.
 */
function items(body: string, pattern: RegExp): string[] | undefined {
  const found: string[] = [];
  let inside = false;
  for (const raw of splitLines(body)) {
    const line = chomp(raw);
    const match = pattern.exec(line);
    if (match) {
      found.push((match[1] ?? "").trim());
      inside = true;
      continue;
    }
    if (line.trim() === "") {
      inside = false;
      continue;
    }
    const last = found[found.length - 1];
    if (inside && last !== undefined) found[found.length - 1] = `${last} ${line.trim()}`.trim();
  }
  return found.length === 0 ? undefined : found;
}

/**
 * One part of a facts line. A label is one word, unless the registry names
 * one of several (`Built from abc1234`), which is read by name so the first
 * word alone is not taken for it.
 */
function readFact(part: string, labels: readonly string[]): [string, string] | undefined {
  for (const known of labels) {
    if (!known.includes(" ")) continue;
    const named = new RegExp(`^\\**(${escapeRegExp(known)})\\**:?\\s+(.+?)\\s*$`, "i").exec(part);
    if (named) return [named[1] ?? known, named[2] ?? ""];
  }
  const fact = FACT.exec(part);
  return fact ? [fact[1] ?? "", fact[2] ?? ""] : undefined;
}

/**
 * The facts line, or the table the format had until 2026-09-05, whose first
 * row reads back the same. Every label the registry asks for has to be there.
 */
function readFacts(body: string, labels: readonly string[]): FactsData | undefined {
  const table = readTable(body, labels);
  if (table) {
    const row = table.rows[0] ?? [];
    const values: Record<string, string> = {};
    table.columns.forEach((name, at) => {
      values[name.toLowerCase()] = row[at] ?? "";
    });
    return { labels: [...table.columns], values };
  }
  const line = trimBlankEdges(splitLines(body)).find((candidate) => candidate.trim() !== "") ?? "";
  const found: string[] = [];
  const values: Record<string, string> = {};
  for (const part of line.split(FACT_JOIN)) {
    const fact = readFact(part.trim(), labels);
    if (!fact) return undefined;
    const [label, value] = fact;
    found.push(label);
    values[label.toLowerCase()] = value;
  }
  if (found.length === 0) return undefined;
  for (const want of labels) if (!(want.toLowerCase() in values)) return undefined;
  return { labels: found, values };
}

/**
 * The files list, one item per bullet, or the Path/Change/Why table the format
 * had until 2026-09-05, which reads back as the same items. A bullet that is
 * not a file makes the section prose, as a ragged table did.
 */
function readFiles(body: string, columns: readonly string[]): FileItem[] | undefined {
  const table = readTable(body, columns);
  if (table) return table.records.map((record) => ({ path: record["path"] ?? "", change: record["change"] ?? "", why: record["why"] ?? "" }));
  const bullets = items(body, BULLET);
  if (!bullets) return undefined;
  const found: FileItem[] = [];
  for (const bullet of bullets) {
    const match = FILE_ITEM.exec(bullet);
    if (!match) return undefined;
    found.push({ path: match[1] ?? "", change: match[2] ?? "", why: (match[3] ?? "").trim() });
  }
  return found;
}

function readList(body: string): string[] | undefined {
  const bullets = items(body, BULLET);
  // A tick in a plan is the finalizer's to strip; if one survives, it is not the criterion.
  return bullets?.map((item) => TICK.exec(item)?.[2]?.trim() ?? item);
}

function readOrdered(body: string): string[] | undefined {
  return items(body, ORDERED);
}

/**
 * The person's steps: bullets, each ticked, unticked or bare. Bare in a spec,
 * where a tick on GitHub would edit the comment and refuse the approval; a task
 * list in a pull request body or a reply, where a tick costs nothing. Suite
 * draws the boxes either way and keeps the ticks in the person's own comment.
 */
function readTodo(body: string): CheckItem[] | undefined {
  const bullets = items(body, BULLET);
  return bullets?.map((item) => {
    const tick = TICK.exec(item);
    return tick ? { done: (tick[1] ?? " ").toLowerCase() === "x", text: (tick[2] ?? "").trim() } : { done: false, text: item };
  });
}

/** Ticks, and all of them: a list half ticked and half bulleted is a list. */
function readChecks(body: string): CheckItem[] | undefined {
  const bullets = items(body, BULLET);
  if (!bullets) return undefined;
  const checks: CheckItem[] = [];
  for (const item of bullets) {
    const tick = TICK.exec(item);
    if (!tick) return undefined;
    checks.push({ done: (tick[1] ?? " ").toLowerCase() === "x", text: (tick[2] ?? "").trim() });
  }
  return checks;
}

/**
 * Every fenced block in the body, dedented by the fence's own indent. A fence
 * left open runs to the end of the section: a truncated block still carries
 * what the engine managed to write.
 */
function fences(body: string): CodeData[] {
  const found: CodeData[] = [];
  let open: { char: string; length: number; indent: string; lang: string | null; lines: string[] } | null = null;

  for (const raw of splitLines(body)) {
    const line = chomp(raw);
    const fence = FENCE.exec(line);
    if (fence) {
      const ticks = fence[2] ?? "";
      const char = ticks[0] ?? "`";
      const info = (fence[3] ?? "").trim();
      if (open === null) {
        if (!(char === "`" && info.includes("`"))) {
          open = {
            char,
            length: ticks.length,
            indent: fence[1] ?? "",
            lang: info === "" ? null : (info.split(/\s+/)[0] ?? null),
            lines: [],
          };
          continue;
        }
      } else if (char === open.char && ticks.length >= open.length && info === "") {
        found.push({ lang: open.lang, lines: open.lines });
        open = null;
        continue;
      }
    }
    if (open) open.lines.push(line.startsWith(open.indent) ? line.slice(open.indent.length) : line.trimStart());
  }
  if (open) found.push({ lang: open.lang, lines: open.lines });
  return found;
}

function readCode(body: string): CodeData | undefined {
  return fences(body)[0];
}

/** A mermaid fence, or a bare one that opens with a diagram GitHub would draw. */
function readMermaid(body: string): CodeData | undefined {
  for (const block of fences(body)) {
    if ((block.lang ?? "").toLowerCase() === "mermaid") return { lang: "mermaid", lines: block.lines };
    const first = block.lines.find((line) => line.trim() !== "")?.trim() ?? "";
    if (block.lang === null && DIAGRAM.test(first)) return { lang: "mermaid", lines: block.lines };
  }
  return undefined;
}

/** A line's steps, split at every arrow outside backticks, since an arrow in code is code. */
function steps(line: string): string[] {
  const found: string[] = [];
  let current = "";
  let code = false;
  for (let at = 0; at < line.length; at++) {
    const char = line[at] ?? "";
    if (char === "`") code = !code;
    const arrow = code ? null : ARROW.exec(line.slice(at));
    if (arrow) {
      found.push(current.trim());
      current = "";
      at += arrow[0].length - 1;
      continue;
    }
    current += char;
  }
  found.push(current.trim());
  return found;
}

/**
 * The paths of a flow written as arrows: a bullet each, or a line each when
 * there are no bullets, every one at least two steps. Anything else is prose,
 * and a fence is a flow from before the arrows.
 */
function readArrows(body: string): FlowData | undefined {
  const lines = items(body, BULLET) ?? items(body, ORDERED) ?? splitLines(body).map((line) => line.trim()).filter((line) => line !== "");
  if (lines.length === 0) return undefined;
  const paths = lines.map(steps);
  if (paths.some((path) => path.length < 2 || path.some((step) => step === ""))) return undefined;
  return { paths };
}

function readFlow(body: string): FlowData | CodeData | undefined {
  return fences(body).length > 0 ? readMermaid(body) : readArrows(body);
}

/** A flow's paths, for a reader that draws the arrows; `null` for a flow written any other way. */
export function flowPaths(body: string): string[][] | null {
  return fences(body).length > 0 ? null : (readArrows(body)?.paths ?? null);
}

/** `**Title.**` on the first line is the alert's title, and leaves the text without it. */
function titled(kind: AlertKind, text: string): AlertData {
  const lines = trimBlankEdges(splitLines(text));
  const bold = BOLD_LINE.exec((lines[0] ?? "").trim());
  if (!bold) return { kind, title: null, text: lines.join("\n").trim() };
  return { kind, title: (bold[1] ?? "").trim(), text: trimBlankEdges(lines.slice(1)).join("\n").trim() };
}

/** The GFM alert a body opens with, and nothing else: a blockquote is not an alert. */
function readAlert(body: string): AlertData | undefined {
  const lines = trimBlankEdges(splitLines(body));
  if (!(lines[0] ?? "").trim().startsWith(">")) return undefined;
  const quoted: string[] = [];
  for (const line of lines) {
    if (!line.trim().startsWith(">")) break;
    quoted.push(line.trim().replace(/^>\s?/, ""));
  }
  const inside = trimBlankEdges(quoted);
  const kind = ALERT.exec((inside[0] ?? "").trim());
  if (!kind) return undefined;
  return titled((kind[1] ?? "NOTE").toLowerCase() as AlertKind, trimBlankEdges(inside.slice(1)).join("\n"));
}

/** A section of the alert shape: the alert it holds, or its words wrapped as a note. */
function readLede(body: string): AlertData | undefined {
  const alert = readAlert(body);
  if (alert) return alert;
  if (body.trim() === "") return undefined;
  return titled("note", body);
}

function read(shape: Shape, body: string, columns: readonly string[]): SectionData {
  switch (shape) {
    case "alert":
      return readLede(body);
    case "table":
      return readTable(body, columns);
    case "facts":
      return readFacts(body, columns);
    case "files":
      return readFiles(body, columns);
    case "list":
      return readList(body);
    case "olist":
      return readOrdered(body);
    case "checks":
      return readChecks(body);
    case "todo":
      return readTodo(body);
    case "code":
      return readCode(body);
    case "flow":
      return readFlow(body);
    case "text":
      return body;
  }
}

function isAlert(data: SectionData): data is AlertData {
  return typeof data === "object" && data !== null && !Array.isArray(data) && "kind" in data && "text" in data;
}

/**
 * A body into its parts. Never throws, whatever the body is: a plan, a pull
 * request, a notice, a comment written by a person, an empty string.
 */
export function parseDoc(body: string, kind: DocKind, namespace: string = DEFAULT_NAMESPACE): Doc {
  const lines = splitLines(typeof body === "string" ? body : "");
  let found = scan(lines, false);
  let recovered = false;
  // A fence the engine never closed would swallow every heading under it, so a
  // truncated output is read again as if it had no fences at all.
  if (found.unterminated) {
    found = scan(lines, true);
    recovered = true;
  }

  const isMarker = markerLinePattern(namespace);
  const outside = (index: number, line: string): boolean =>
    found.fenced[index] === true || !isMarker.test(line.trim());

  const first = found.headings[0]?.line ?? lines.length;
  const preface = stripMarkerLines(lines.slice(0, first).join("\n"), namespace);

  const sections: Section[] = [];
  for (let index = 0; index < found.headings.length; index++) {
    const head = found.headings[index];
    if (!head) continue;
    const end = found.headings[index + 1]?.line ?? lines.length;
    const content = lines
      .slice(head.line + 1, end)
      .filter((line, offset) => outside(head.line + 1 + offset, line));
    sections.push({
      key: null,
      title: head.title,
      level: head.level,
      body: trimBlankEdges(content).join("\n"),
      shape: "text",
      data: undefined,
    });
  }

  const specs = REGISTRY[kind];
  const titles = sections.map((section) => normalise(section.title));
  const taken = new Set<string>();
  // Exact headings first, over the whole document, so a body carrying both a
  // heading and its alias gives the key to the heading. A key already given is
  // never given again: a repeated heading stays a section of its own.
  const assign = (matches: (title: string, spec: SectionSpec) => boolean): void => {
    for (let index = 0; index < sections.length; index++) {
      const section = sections[index];
      const title = titles[index];
      if (!section || section.key !== null || title === undefined || title === "") continue;
      for (const spec of specs) {
        if (taken.has(spec.key) || !matches(title, spec)) continue;
        section.key = spec.key;
        section.shape = spec.shape;
        section.data = read(spec.shape, section.body, spec.columns);
        taken.add(spec.key);
        break;
      }
    }
  };
  assign((title, spec) => title === normalise(spec.heading));
  assign((title, spec) => spec.aliases.some((alias) => title === normalise(alias)));
  // The prefix match is what Suite has always done, and what lets "Changes made"
  // be the changes.
  assign((title, spec) => [spec.heading, ...spec.aliases].some((name) => title.startsWith(normalise(name))));

  const byKey: Record<string, Section> = {};
  for (const section of sections) {
    // A heading the registry does not know is still a section, and its markdown
    // is what Suite renders for it.
    if (section.key === null) section.data = section.body;
    else if (byKey[section.key] === undefined) byKey[section.key] = section;
  }

  const spelled = byKey["plain"]?.data;
  const plain = readAlert(preface) ?? (isAlert(spelled) ? spelled : null);

  return {
    kind,
    typed: sections.some((section) => section.key !== null),
    recovered,
    plain,
    preface,
    sections,
    byKey,
  };
}
