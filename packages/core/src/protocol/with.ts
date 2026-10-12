/**
 * One task asked of several projects at once (2026-10-08).
 *
 * Asked for as "AISWEC should allow users to pick multiple repos while
 * creating a task". A task is an issue in one repository and a stage reads
 * one repository, so a change that spans a backend and an app is one issue in
 * each, made by the person in Suite with several projects picked, and linked
 * by what this module writes. Core's stages are untouched: everything here is
 * text in a body or a comment a maintainer wrote, which every stage already
 * reads as the maintainer's word.
 *
 * The with line, `withLine`: an `aiswec-with:v1` marker at the end of each
 * body, naming every task of the set (this one included) and, when the person
 * chose an order, the one planned first. Suite reads it to show the others on
 * a task and its row, and to start the waiting ones when the first plan is
 * approved. It is the person's word, written by Suite as them, never a
 * stage's, and it formats nothing.
 *
 * The sentence above it, `sharedSentence`: what the engine and a reader on
 * GitHub are told, since a stage takes every HTML comment but its own bare
 * markers out of an issue before the engine reads it. It names the other
 * tasks as `owner/repo#n`, which GitHub links both ways, and asks for this
 * repository's part alone. No prompt carries the rule: refine's is at its
 * limit, and a sentence in a body a maintainer wrote is an instruction already.
 *
 * The start comment, `startComment`: what a waiting task is planned against
 * when its turn comes, the first plan's contract quoted as a hand-off quotes
 * it (the lede, the Contract, the Code sketch, the Flow), posted as the
 * person's comment just before the label that starts the plan.
 */
import { z } from "zod";
import { HANDOFF_CAP, withQuote } from "./handoff.js";
import { DEFAULT_NAMESPACE } from "./markers.js";
import { payloadLine, readPayload } from "./run.js";
import type { TaskRef } from "./todos.js";

/** The most projects one task is asked of at once: each is a plan, a run and a review of its own. */
export const SHARED_MAX = 5;

const TASK = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[1-9]\d*$/;

export const withLineSchema = z.object({
  tasks: z.array(z.string().regex(TASK)).min(2).max(SHARED_MAX),
  lead: z.string().regex(TASK).optional(),
});

export interface WithLine {
  /** Every task of the set, this one included, in the order they were made. */
  tasks: TaskRef[];
  /** The task whose plan the others are planned against; null when they are planned together. */
  lead: TaskRef | null;
}

/** Where a task stands in its set: one of several planned at once, the one planned first, or one waiting for it. */
export type SharedRole = "together" | "lead" | "waits";

/** `owner/repo#n`, as GitHub links it. */
export function taskText(task: TaskRef): string {
  return `${task.repo}#${task.number}`;
}

function taskOf(text: string): TaskRef {
  const at = text.lastIndexOf("#");
  return { repo: text.slice(0, at), number: Number(text.slice(at + 1)) };
}

/** The same task, whatever the case of its name: GitHub does not tell `O/App` from `o/app`. */
export function sameTask(a: TaskRef, b: TaskRef): boolean {
  return a.repo.toLowerCase() === b.repo.toLowerCase() && a.number === b.number;
}

/** A set names each project once, and its lead is one of its tasks. */
function valid(line: WithLine): boolean {
  const repos = line.tasks.map((task) => task.repo.toLowerCase());
  if (new Set(repos).size !== repos.length) return false;
  const lead = line.lead;
  return lead === null || line.tasks.some((task) => sameTask(task, lead));
}

export function withLine(value: WithLine, namespace: string = DEFAULT_NAMESPACE): string {
  if (!valid(value)) throw new Error("a set names each project once, and its lead is one of its tasks");
  const parsed = withLineSchema.parse({ tasks: value.tasks.map(taskText), ...(value.lead === null ? {} : { lead: taskText(value.lead) }) });
  return payloadLine("with", parsed, namespace);
}

/** The line off a body, or null when there is none or it does not parse. Never throws. */
export function parseWithLine(body: string, namespace: string = DEFAULT_NAMESPACE): WithLine | null {
  const parsed = withLineSchema.safeParse(readPayload(body, "with", namespace));
  if (!parsed.success) return null;
  const line: WithLine = { tasks: parsed.data.tasks.map(taskOf), lead: parsed.data.lead === undefined ? null : taskOf(parsed.data.lead) };
  return valid(line) ? line : null;
}

export function sharedRole(line: WithLine, self: TaskRef): SharedRole {
  if (line.lead === null) return "together";
  return sameTask(line.lead, self) ? "lead" : "waits";
}

/** The other tasks of the set, in its order. */
export function otherTasks(line: WithLine, self: TaskRef): TaskRef[] {
  return line.tasks.filter((task) => !sameTask(task, self));
}

/** "a", "a and b", "a, b and c". */
function listed(tasks: readonly TaskRef[]): string {
  const refs = tasks.map(taskText);
  if (refs.length < 2) return refs[0] ?? "";
  return `${refs.slice(0, -1).join(", ")} and ${refs[refs.length - 1]}`;
}

/** What a task of the set says about the others, in words the engine and a reader on GitHub both take. */
export function sharedSentence(line: WithLine, self: TaskRef): string {
  const others = otherTasks(line, self);
  const them = listed(others);
  const one = others.length === 1;
  const role = sharedRole(line, self);
  if (role === "waits" && line.lead !== null) {
    return `This task is shared with ${them}. AISWEC plans ${taskText(line.lead)} first, and this one once that plan is approved, against it. Plan only this repository's part.`;
  }
  if (role === "lead") {
    return `This task is shared with ${them}, which AISWEC plans once this plan is approved, against it. Plan only this repository's part, and put what ${one ? "the other side builds" : "the others build"} against (an endpoint, a payload, a name) in the Code sketch.`;
  }
  return `This task is shared with ${them}, where AISWEC plans ${one ? "that repository's part" : "their parts"} at the same time. Plan only this repository's part, and put what ${one ? "the two" : "they"} must agree on (an endpoint, a payload, a name) in the Code sketch.`;
}

export interface SharedBodyInput {
  /** What the person wrote: the ask, and anything it should know. */
  body: string;
  line: WithLine;
  /** The task this body is for. */
  self: TaskRef;
  namespace?: string;
}

/** A task's body in the set: the person's words, the sentence about the others, the with line last. */
export function sharedBody(input: SharedBodyInput): string {
  const namespace = input.namespace ?? DEFAULT_NAMESPACE;
  return [input.body.trim(), sharedSentence(input.line, input.self), withLine(input.line, namespace)].filter((part) => part !== "").join("\n\n");
}

export interface StartInput {
  /** The task planned first. */
  lead: { repo: string; issue: number; title: string };
  /** Its plan, as the spec comment holds it; null when it has none yet. */
  plan: string | null;
  /** Whether that plan is approved: the engine plans against it either way, and is told which. */
  approved: boolean;
  namespace?: string;
  cap?: number;
}

/**
 * The person's comment a waiting task is started with, just before its label:
 * the first plan's contract quoted (as much as fits the cap), or, when that
 * task has no plan yet, the word to go ahead without one. Its first line never
 * reads as an approval, so the build stage cannot take it for one.
 */
export function startComment(input: StartInput): string {
  const namespace = input.namespace ?? DEFAULT_NAMESPACE;
  const ref = `${input.lead.repo}#${input.lead.issue}`;
  if (input.plan === null) return `Plan this now, without waiting for ${ref} (${input.lead.title}) to be planned first. Plan only this repository's part.`;
  const head = input.approved
    ? `Plan this against the approved plan on ${ref} (${input.lead.title}). What it says this side builds against is settled; where this repository cannot follow it, say so in the plan.`
    : `Plan this against the plan on ${ref} (${input.lead.title}), which is not approved yet and may still change.`;
  return withQuote(input.plan, namespace, input.cap ?? HANDOFF_CAP, (section) => [head, section, `The whole plan is on ${ref}.`].filter((part): part is string => part !== null).join("\n\n"));
}
