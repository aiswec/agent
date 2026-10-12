/**
 * What a run cost, and what a person asked it to run with, carried on GitHub.
 *
 * The engine's usage exists for about a second: a result file the runner writes
 * and the job throws away when it ends. Nothing in Core has a database, and
 * both sides can already read GitHub, so the numbers travel where the work
 * travels, on the comment the stage's finalizer posts, as a marker line.
 * A marker line renders as nothing at all, on GitHub and in Suite alike, so the
 * reader sees the reply and Suite sees the numbers.
 *
 * Two kinds, both a marker with a JSON payload. `markerLinePattern` already
 * tolerates a payload and `stripMarkerLines` already removes the line, which is
 * what makes it safe to hang a run line off a spec comment: the spec reads the
 * same before and after.
 *
 *  - the run line, written by a stage onto its own comment. `run` is the
 *    Actions run id, which is the join key to the run GitHub already lists.
 *  - the ask line, written by Suite into an issue body when a person picks an
 *    engine on the New task form: a provider, a model, an effort. It is
 *    untrusted: anyone who can open an issue can write one, so a stage honours
 *    it only when the issue's author is a maintainer.
 *
 * Two rules keep the line readable back:
 *
 *  - `markerLinePattern` forbids a literal `>` anywhere in a marker, so every
 *    `>` in the payload is written as the escape `\u003e`, which JSON reads
 *    back as itself.
 *  - The parsers never throw and never guess: a body is untrusted text, so a
 *    malformed line is absence. The emitters do validate, because a line that
 *    cannot be read back is worse than a loud failure where it was written.
 */
import { z } from "zod";
import { REPO_STAGES } from "../config/schema.js";
import { EFFORTS, PROVIDERS } from "../config/settings.js";
import { DEFAULT_NAMESPACE, MARKER_VERSIONS } from "./markers.js";
import { escapeRegExp, splitLines } from "./util.js";

/** How a run ended, as Actions reports it. */
export const RUN_STATUSES = ["success", "failure", "cancelled"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** Ids, turns and token counts. */
const count = z.number().int().nonnegative();
/** Milliseconds and dollars, which an engine may report fractionally. */
const amount = z.number().nonnegative().finite();

/**
 * Everything but `run`, `stage` and `status` is optional and may be null: a run
 * whose engine never produced a result still writes a line, and the line saying
 * only that the run failed is the whole point of writing it there.
 *
 * The objects are not `.strict()`, unlike the config schemas. A stage that
 * learns to report one more number must not make its comments unreadable to a
 * Suite that has not been deployed yet, so an unknown key is dropped.
 */
export const runLineSchema = z.object({
  run: count,
  stage: z.enum(REPO_STAGES),
  status: z.enum(RUN_STATUSES),
  provider: z.enum(PROVIDERS).nullish(),
  model: z.string().min(1).nullish(),
  effort: z.enum(EFFORTS).nullish(),
  turns: count.nullish(),
  duration_ms: amount.nullish(),
  cost_usd: amount.nullish(),
  usage: z
    .object({
      input: count.nullish(),
      output: count.nullish(),
      cache_read: count.nullish(),
      cache_write: count.nullish(),
    })
    .nullish(),
});

export type RunLine = z.infer<typeof runLineSchema>;

/**
 * `provider` on the ask line is how one repository compares two engines: a
 * task run on OpenRouter, the next on the Claude subscription, in the same
 * repository and against the same rules. A stage honours it only when the
 * credential for it is actually there, and, since the two providers name
 * models differently, only when the line carries a model for it too.
 */
export const askLineSchema = z.object({
  provider: z.enum(PROVIDERS).nullish(),
  model: z.string().min(1).nullish(),
  effort: z.enum(EFFORTS).nullish(),
});

export type AskLine = z.infer<typeof askLineSchema>;

/** The marker kinds that carry a JSON payload: a run, an ask, where a task came from (protocol/handoff.ts), the tasks it was asked with (protocol/with.ts) and the files attached to it (protocol/files.ts). */
export type PayloadKind = "run" | "ask" | "from" | "with" | "files";

const RUN_KEYS = [
  "run",
  "stage",
  "status",
  "provider",
  "model",
  "effort",
  "turns",
  "duration_ms",
  "cost_usd",
] as const satisfies readonly (keyof RunLine)[];

const USAGE_KEYS = ["input", "output", "cache_read", "cache_write"] as const;

const ASK_KEYS = ["provider", "model", "effort"] as const satisfies readonly (keyof AskLine)[];

/**
 * Matches one payload marker line and captures its JSON, in the idiom of
 * `childMarkerPattern`: line-anchored, kind-specific and pinned to the version
 * this parser understands, so a v2 line is not half-read as a v1 one. `[^>]*`
 * is the same restriction `markerLinePattern` imposes, which is why the payload
 * escapes its own `>`.
 */
export function payloadMarkerPattern(
  kind: PayloadKind,
  namespace: string = DEFAULT_NAMESPACE,
): RegExp {
  return new RegExp(
    `^<!--\\s*${escapeRegExp(namespace)}-${kind}:v${MARKER_VERSIONS[kind]}\\s+(\\{[^>]*\\})\\s*-->$`,
  );
}

/**
 * The members that carry something, in the contract's order, so the same run
 * always writes the same line and a null is written as absence rather than as
 * `null`. Callers then have one thing to check instead of two.
 */
function present<T extends object>(value: T, keys: readonly (keyof T)[]): T {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const member = value[key];
    if (member === null || member === undefined) continue;
    out[String(key)] = member;
  }
  return out as T;
}

function compactRun(line: RunLine): RunLine {
  const out = present(line, RUN_KEYS);
  const usage = line.usage ? present(line.usage, USAGE_KEYS) : null;
  if (usage && Object.keys(usage).length > 0) out.usage = usage;
  return out;
}

export function payloadLine(kind: PayloadKind, payload: unknown, namespace: string): string {
  // `>` can only occur inside a JSON string, where `\u003e` means the same
  // character, so escaping it here cannot change what parses back.
  const json = JSON.stringify(payload).replace(/>/g, "\\u003e");
  return `<!-- ${namespace}-${kind}:v${MARKER_VERSIONS[kind]} ${json} -->`;
}

export function runLine(value: RunLine, namespace: string = DEFAULT_NAMESPACE): string {
  return payloadLine("run", compactRun(runLineSchema.parse(value)), namespace);
}

export function askLine(value: AskLine, namespace: string = DEFAULT_NAMESPACE): string {
  return payloadLine("ask", present(askLineSchema.parse(value), ASK_KEYS), namespace);
}

/**
 * The last line of its kind wins, and a malformed last line is the answer: an
 * earlier line describes an earlier run, and reporting it as this one would be
 * worse than reporting nothing.
 */
export function readPayload(body: string, kind: PayloadKind, namespace: string): unknown {
  const pattern = payloadMarkerPattern(kind, namespace);
  const lines = splitLines(body);

  for (let index = lines.length - 1; index >= 0; index--) {
    const match = pattern.exec((lines[index] ?? "").trim());
    if (!match) continue;
    const json = match[1];
    if (json === undefined) return undefined;
    try {
      return JSON.parse(json);
    } catch {
      return undefined;
    }
  }

  return undefined;
}

export function parseRunLine(body: string, namespace: string = DEFAULT_NAMESPACE): RunLine | null {
  const parsed = runLineSchema.safeParse(readPayload(body, "run", namespace));
  return parsed.success ? compactRun(parsed.data) : null;
}

export function parseAskLine(body: string, namespace: string = DEFAULT_NAMESPACE): AskLine | null {
  const parsed = askLineSchema.safeParse(readPayload(body, "ask", namespace));
  return parsed.success ? present(parsed.data, ASK_KEYS) : null;
}
