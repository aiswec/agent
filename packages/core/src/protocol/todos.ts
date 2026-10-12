/**
 * Manual todos: the steps only a person can take, and which of them are done.
 *
 * A plan, a pull request body or a reply lists them under "Manual todos" (the
 * registry's `todos`, shape `todo`; "Your part" until later on 2026-09-06, kept
 * as an alias): a secret to add, a permission to grant, a token to make, a
 * setting in an account or a store. What the bot can do itself, a workflow
 * file included, is never one. CODE.md's third rule, 2026-09-06: never buried
 * in prose.
 *
 * The ticks never live in the document. A tick on a spec comment edits it,
 * which refuses the approval, and a tick on GitHub in a pull request body is
 * the person's alone. So Suite keeps them in one comment of the person's own,
 * `<!-- aiswec-done:v1 -->` over the same list with its boxes, created on the
 * first tick and edited on every one after: GitHub shows it as a task list
 * under the person's name, the engine reads it as their word on what is done,
 * and this module reads it back. A step is matched by its words, so the list
 * in the comment can be older than the document without lying: a step the
 * document no longer names is simply not counted.
 *
 * Two kinds of step do not stand between the person and the approval
 * (2026-09-17, after `facts-a-day-backend#26`, whose one todo was a mobile
 * release in another repository that could only happen after the plan it was
 * blocking had shipped). A step the engine wrote as `Follow-up in
 * <repository>: ...` is work elsewhere, or possible only after this ships,
 * and never blocks. And a step the person made into a task in another
 * project carries that task under it in the done comment, as a nested line
 * `- Task: owner/repo#n, after this plan is built` (or `before AISWEC builds
 * it`): "after" releases the approval, "before" holds it until the linked
 * task is accepted, and a linked task closed as not planned holds it again.
 * An older reader sees the nested line as an unticked step matching nothing,
 * and ignores it.
 */
import { DEFAULT_NAMESPACE, hasMarker, stripMarkerLines } from "./markers.js";
import { marker } from "./markers.js";
import type { CheckItem } from "./sections.js";
import { splitLines } from "./util.js";

export type TodoWhen = "after" | "before";

/** A task in a repository: `owner/repo#n`. */
export interface TaskRef {
  repo: string;
  number: number;
}

/** The task a step was made into, and whether the plan waits for it. */
export interface TodoTask extends TaskRef {
  when: TodoWhen;
}

/** What became of a linked task, as far as the caller can say. */
export type TaskOutcome = "open" | "done" | "closed" | "unknown";

/** One line of a done comment: a step with its box, and the task it was made into. */
export interface DoneItem extends CheckItem {
  task: TodoTask | null;
}

/** A step of the document's list, with everything the done comment says about it merged in. */
export interface TodoItem extends CheckItem {
  /** The engine wrote it as a follow-up elsewhere: the repository named, and the step without the prefix. */
  followUp: { repo: string; text: string } | null;
  /** The task this step was made into, from the person's done comment. */
  task: TodoTask | null;
  /** Whether the step still stands between the person and the approval. */
  blocks: boolean;
}

export interface ManualTodos {
  /** Every step the document names, in its order. */
  items: TodoItem[];
  total: number;
  /** How many are ticked. */
  done: number;
  /** How many still block the approval: not ticked, not a follow-up, not handed off. */
  left: number;
}

export interface TodoOptions {
  /**
   * Links from an older done comment, carried by the words of each step: the
   * document was written again (a re-run, or the build copying the plan's list
   * into the pull request body), and the tasks made from its steps still stand.
   */
  carried?: readonly DoneItem[] | null;
  /** What became of a linked task, when the caller can say; `unknown` otherwise. */
  outcome?: (task: TaskRef) => TaskOutcome;
}

const TODO = /^\s*[-*+]\s+(?:\[([ xX])\]\s*)?(.*)$/;
/** The engine's prefix for a step elsewhere, or possible only after this ships. */
const FOLLOW_UP = /^follow-up in\s+`?([^:`]+?)`?\s*:\s*(.+)$/i;
/** The nested line under a step in the done comment: the task it was made into. */
const TASK_LINE = /^task:\s*`?([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)`?\s*(?:,\s*(after|before)\b.*)?$/i;

/** The step as a follow-up elsewhere, when the engine wrote it as one. */
export function followUp(text: string): { repo: string; text: string } | null {
  const match = FOLLOW_UP.exec(text.trim());
  if (!match) return null;
  return { repo: (match[1] ?? "").trim(), text: (match[2] ?? "").trim() };
}

/**
 * The words of a step, as matched: case, spacing and a trailing full stop do
 * not count, and neither does the follow-up prefix, so a step the engine
 * wrote as a follow-up matches the same step written before it learned to.
 */
export function stepKey(text: string): string {
  const words = followUp(text)?.text ?? text;
  return words.trim().toLowerCase().replace(/\s+/g, " ").replace(/\.$/, "");
}

/** How the done comment says when the linked task is needed. */
export function whenWords(when: TodoWhen): string {
  return when === "before" ? "before AISWEC builds it" : "after this plan is built";
}

/** The nested line under a step: the task it was made into. */
export function taskLine(task: TodoTask): string {
  return `Task: ${task.repo}#${task.number}, ${whenWords(task.when)}`;
}

/** The person's comment: the marker, one line, then the list with its boxes, a linked task nested under its step. */
export function doneComment(items: readonly (CheckItem & { task?: TodoTask | null })[], namespace: string = DEFAULT_NAMESPACE): string {
  if (items.length === 0) throw new Error("no steps to mark");
  const lines = items.flatMap((item) => {
    const line = `- [${item.done ? "x" : " "}] ${item.text.trim()}`;
    return item.task ? [line, `  - ${taskLine(item.task)}`] : [line];
  });
  return [marker("done", namespace), "Manual todos, as they stand:", "", ...lines].join("\n");
}

/** A `Task:` line's task, or null when the line is a step. */
function readTaskLine(text: string): TodoTask | null {
  const match = TASK_LINE.exec(text.trim());
  if (!match) return null;
  const when = (match[3] ?? "after").toLowerCase() === "before" ? "before" : "after";
  return { repo: match[1] ?? "", number: Number(match[2]), when };
}

/**
 * The list a done comment carries, or `null` when the body is not one. Never
 * throws. A `Task:` line attaches to the step above it; one above every step
 * belongs to nothing and is dropped.
 */
export function parseDone(body: string, namespace: string = DEFAULT_NAMESPACE): DoneItem[] | null {
  if (!hasMarker(body, "done", namespace)) return null;
  const items: DoneItem[] = [];
  for (const line of splitLines(stripMarkerLines(body, namespace))) {
    const match = TODO.exec(line);
    if (!match) continue;
    const text = (match[2] ?? "").trim();
    const task = readTaskLine(text);
    const last = items[items.length - 1];
    if (task && match[1] === undefined && last) {
      last.task = task;
      continue;
    }
    if (task) continue;
    items.push({ done: (match[1] ?? " ").toLowerCase() === "x", text, task: null });
  }
  return items;
}

/** Whether a step still stands between the person and the approval. */
function blocks(done: boolean, follow: TodoItem["followUp"], task: TodoTask | null, outcome: TodoOptions["outcome"]): boolean {
  if (done || follow) return false;
  if (task === null) return true;
  const became = outcome ? outcome(task) : "unknown";
  if (became === "closed") return true;
  if (became === "done") return false;
  return task.when === "before";
}

/**
 * The document's list with the done comment merged in: a step is done when
 * the document ticks it or the latest done comment does, and carries the
 * task the comment (or an older one, `carried`) made it into. `null` when
 * the document names no step.
 */
export function manualTodos(listed: readonly CheckItem[] | undefined, done: readonly DoneItem[] | null = null, options: TodoOptions = {}): ManualTodos | null {
  if (listed === undefined || listed.length === 0) return null;
  const ticked = new Set<string>();
  const tasks = new Map<string, TodoTask>();
  for (const item of done ?? []) {
    const key = stepKey(item.text);
    if (item.done) ticked.add(key);
    if (item.task && !tasks.has(key)) tasks.set(key, item.task);
  }
  // An older comment's ticks were about an older list; its tasks still stand.
  for (const item of options.carried ?? []) {
    const key = stepKey(item.text);
    if (item.task && !tasks.has(key)) tasks.set(key, item.task);
  }
  const items = listed.map((item): TodoItem => {
    const key = stepKey(item.text);
    const follow = followUp(item.text);
    const task = tasks.get(key) ?? null;
    const isDone = item.done || ticked.has(key);
    return { text: item.text, done: isDone, followUp: follow, task, blocks: blocks(isDone, follow, task, options.outcome) };
  });
  return { items, total: items.length, done: items.filter((item) => item.done).length, left: items.filter((item) => item.blocks).length };
}
