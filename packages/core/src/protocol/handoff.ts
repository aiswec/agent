/**
 * A manual todo handed to another project (2026-09-17).
 *
 * A plan's step that is work in another repository (`facts-a-day-backend#26`
 * asked for a mobile release) becomes a task there, made by the person in
 * Suite. Two things are written for it, and this module is both:
 *
 * The new task's body, `handoffBody`. The stage that plans it runs with a
 * token scoped to its own repository and may fetch no URL an issue offers,
 * so the body has to carry what the other side needs on its own: the step
 * in the person's words, where it came from and when it is wanted, and the
 * contract from the plan it was cut from (the plain-words lede, the Contract
 * fact, the Code sketch and the Flow, quoted as written), capped so a long plan
 * does not become the whole issue. Never the plan's approach, files or
 * checks: those are the other repository's business.
 *
 * The `from` line, `fromLine`: an `aiswec-from:v1` marker with the source
 * repository and issue, the step's key and the when, at the end of that
 * body. Suite reads it to show where a task came from and to find, after a
 * re-run rewrote the source's list, the task an older step was made into.
 * It is the person's word, not the bot's: a pointer, never authority.
 */
import { z } from "zod";
import { DEFAULT_NAMESPACE } from "./markers.js";
import { payloadLine, readPayload } from "./run.js";
import { parseDoc } from "./sections.js";
import { stepKey, type TaskRef, type TodoWhen } from "./todos.js";

/** The longest body a hand-off writes: past it, the Flow goes, then the Code sketch, then the quote. */
export const HANDOFF_CAP = 8000;

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export const fromLineSchema = z.object({
  repo: z.string().regex(REPO),
  issue: z.number().int().positive(),
  /** The spec comment the step was read from, when there was one. */
  spec: z.union([z.string(), z.number()]).optional(),
  /** The step's key (`stepKey`), the join a re-run cannot change. */
  todo: z.string().min(1),
  when: z.enum(["after", "before"]),
});

export type FromLine = z.infer<typeof fromLineSchema>;

export function fromLine(value: FromLine, namespace: string = DEFAULT_NAMESPACE): string {
  const parsed = fromLineSchema.parse(value);
  const out: Record<string, unknown> = { repo: parsed.repo, issue: parsed.issue };
  if (parsed.spec !== undefined) out["spec"] = parsed.spec;
  out["todo"] = parsed.todo;
  out["when"] = parsed.when;
  return payloadLine("from", out, namespace);
}

/** The line off a body, or null when there is none or it does not parse. Never throws. */
export function parseFromLine(body: string, namespace: string = DEFAULT_NAMESPACE): FromLine | null {
  const parsed = fromLineSchema.safeParse(readPayload(body, "from", namespace));
  return parsed.success ? parsed.data : null;
}

const REF = /^`?([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)`?$/;
const GITHUB_URL = /github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(?:issues|pull)\/(\d+)/;
const SUITE_URL = /\/r\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(?:tasks|issues|requests)\/(\d+)/;

/** A task as a person would paste it: `owner/repo#31`, a GitHub issue or pull URL, or a Suite task URL. */
export function taskRef(text: string): TaskRef | null {
  const trimmed = text.trim();
  const ref = REF.exec(trimmed);
  if (ref) return { repo: ref[1] ?? "", number: Number(ref[2]) };
  const url = GITHUB_URL.exec(trimmed) ?? SUITE_URL.exec(trimmed);
  if (url) return { repo: `${url[1]}/${url[2]}`, number: Number(url[3]) };
  return null;
}

export interface HandoffSource {
  repo: string;
  issue: number;
  title: string;
  spec?: string | number | null;
}

export interface HandoffInput {
  /** What the person added on the sheet; may be empty. */
  context: string;
  source: HandoffSource;
  /** The plan the step was cut from, marker lines off; null when there is none to quote. */
  plan: string | null;
  /** The step, as the plan wrote it. */
  todo: string;
  when: TodoWhen;
  namespace?: string;
  cap?: number;
}

interface Quoted {
  lede: string | null;
  contract: string | null;
  schema: string | null;
  flow: string | null;
}

function quote(plan: string, namespace: string): Quoted {
  const doc = parseDoc(plan, "spec", namespace);
  const contract = doc.byKey["meta"]?.data as { values?: Record<string, string> } | undefined;
  return {
    lede: doc.plain?.text.trim() || null,
    contract: contract?.values?.["contract"]?.trim() || null,
    schema: doc.byKey["schema"]?.body.trim() || null,
    flow: doc.byKey["flow"]?.body.trim() || null,
  };
}

function quotedSection(quoted: Quoted, include: { schema: boolean; flow: boolean }): string | null {
  const parts: string[] = [];
  if (quoted.lede) parts.push(quoted.lede.split(/\r\n?|\n/).map((line) => `> ${line}`.trimEnd()).join("\n").replace(/^> /, "> [!NOTE]\n> "));
  if (quoted.contract) parts.push(`Contract: ${quoted.contract}`);
  if (include.schema && quoted.schema) parts.push(`#### Code sketch\n\n${quoted.schema}`);
  if (include.flow && quoted.flow) parts.push(`#### Flow\n\n${quoted.flow}`);
  if (parts.length === 0) return null;
  return ["### From that plan", ...parts].join("\n\n");
}

/** What a quote of a plan holds, largest first. */
const ATTEMPTS: readonly { schema: boolean; flow: boolean }[] = [
  { schema: true, flow: true },
  { schema: true, flow: false },
  { schema: false, flow: false },
];

/**
 * The text `compose` makes around a plan's contract, quoted with as much as
 * keeps it under `cap`: the Flow goes first, then the Code sketch, then the
 * quote itself. A hand-off's body is made this way, and so is the comment a
 * task asked of several projects is started with (protocol/with.ts).
 */
export function withQuote(plan: string | null, namespace: string, cap: number, compose: (section: string | null) => string): string {
  const quoted = plan === null ? null : quote(plan, namespace);
  for (const include of ATTEMPTS) {
    const text = compose(quoted ? quotedSection(quoted, include) : null);
    if (text.length <= cap) return text;
  }
  return compose(null);
}

/**
 * The new task's body: the person's context, where the step came from and
 * when it is wanted, the contract quoted from the plan, and the from line
 * last. Under the cap, the Flow goes first, then the Code sketch, then the quote.
 */
export function handoffBody(input: HandoffInput): string {
  const namespace = input.namespace ?? DEFAULT_NAMESPACE;
  const cap = input.cap ?? HANDOFF_CAP;
  const ref = `${input.source.repo}#${input.source.issue}`;
  const origin =
    input.when === "before"
      ? `From a manual todo on ${ref} (${input.source.title}): that plan waits for this task before AISWEC builds it.`
      : `From a manual todo on ${ref} (${input.source.title}). Plan it now; ship it only after that plan is built and its changes are accepted.`;
  const line = fromLine(
    {
      repo: input.source.repo,
      issue: input.source.issue,
      ...(input.source.spec === undefined || input.source.spec === null ? {} : { spec: input.source.spec }),
      todo: stepKey(input.todo),
      when: input.when,
    },
    namespace,
  );
  const head = [input.context.trim(), origin].filter((part) => part !== "").join("\n\n");
  const compose = (section: string | null): string => [head, section, `The whole plan is on ${ref}.`, line].filter((part): part is string => part !== null).join("\n\n");
  return withQuote(input.plan, namespace, cap, compose);
}
