/**
 * Where an issue is in the pipeline, derived from what the stages wrote into
 * GitHub, as labels and comments, and nothing else.
 *
 * Suite keeps no database; every screen is a function of the repository.
 * This is that function for one issue. It leans on the same rules the stages
 * enforce: the trusted-author set for anything that claims to be the bot's
 * (an ack, a reply, a failure text), the single-state label invariant, the
 * assignment label, the hold brake, and the fact that acks are deleted when a
 * run finalizes, so an ack that is still there means a run in flight.
 */
import { assignmentLabel, activeState, isHeld, REPO_STATES, type RepoState } from "./labels.js";
import { marker, DEFAULT_NAMESPACE } from "./markers.js";
import { classifyComment } from "./approval.js";
import { NOTICE_TITLES, parseDoc, type CheckItem, type NoticeReason } from "./sections.js";
import { selectTrustedSpec, specContent, type CommentLike } from "./spec.js";
import { manualTodos, parseDone, type DoneItem, type ManualTodos } from "./todos.js";

export interface StateComment extends CommentLike {
  id: string | number;
  createdAt: string;
  updatedAt?: string;
  /** GitHub's account type; `Bot` for Apps and github-actions. */
  authorType?: string;
}

export interface StatePull {
  number: number;
  headRefName: string;
  isDraft: boolean;
  merged: boolean;
  state: "open" | "closed";
}

export interface StateIssue {
  number: number;
  state: "open" | "closed";
  labels: readonly string[];
  comments: readonly StateComment[];
  /** Comments on the joined PR's conversation tab (revise posts there). */
  pullComments?: readonly StateComment[];
  pulls: readonly StatePull[];
}

export interface StateOptions {
  namespace?: string;
  branchPrefix: string;
  /** Logins whose acks, replies and failure texts are the pipeline's own. */
  botLogins: readonly string[];
  maintainers: readonly string[];
  reservedPrefixes?: readonly string[];
  /** `owner/repo`, to recognise run URLs in acks. */
  repo: string;
  /**
   * Runs the caller knows have finished: an ack naming one is stale (the run
   * ended without deleting it, or the thread was read from a cache older than
   * the deletion) and says nothing about a run in flight (2026-09-17).
   */
  finishedRuns?: readonly number[];
}

export type RunningKind = "refine" | "build" | "revise";

export type Column =
  | "unassigned"
  | "new"
  | "refining"
  | "awaiting-approval"
  | "building"
  | "in-review"
  | "responding"
  | "needs-human"
  | "held"
  | "inconsistent"
  | "dead-end"
  | "done"
  | "closed";

export interface IssueState {
  assigned: boolean;
  held: boolean;
  state: RepoState | null;
  inconsistent: boolean;
  running: { kind: RunningKind; runId: number; runUrl: string; since: string } | null;
  spec: {
    id: string | number;
    createdAt: string;
    edited: boolean;
    /** The spec without marker lines and without the release footer. */
    body: string;
    footer: string | null;
  } | null;
  /** A maintainer's approval comment newer than the spec, if any. */
  approval: { author: string; createdAt: string; qualified: boolean } | null;
  /** The spec's Manual todos with the ticks from the person's latest done comment; `null` when the plan names no step of theirs. */
  todos: ManualTodos | null;
  /** The bot's latest word, when it is one of the texts the finalizers post. */
  reason: BotReason | null;
  pr: StatePull | null;
  column: Column;
}

/**
 * Every reason the bot's last word can be, as an array, because Suite iterates
 * it: a reason without a sentence on the task page is a page that says nothing,
 * and the only way to assert that is to walk the list.
 */
export const BOT_REASONS = [
  "questions",
  "escalated",
  "refine-failed",
  "no-trusted-spec",
  "stale-spec",
  "draft-pr",
  "no-pr",
  "revise-failed",
  "settings-invalid",
  "model-too-small",
  "held",
  "dispatch-failed",
  "labels-unreadable",
] as const;

export type BotReason = (typeof BOT_REASONS)[number];

/**
 * `sections.ts` declares the reasons a notice can name, since the dependency
 * runs from here to there and not back. This is the assertion that the two
 * agree: it stops compiling if either list grows a member the other lacks.
 */
const NOTICE_REASONS_ARE_BOT_REASONS: BotReason = null as unknown as NoticeReason;
void NOTICE_REASONS_ARE_BOT_REASONS;

const ACK = /^(⏳|🔨|💬) .*\(\[run\]\((https:\/\/github\.com\/([^/]+\/[^/]+)\/actions\/runs\/(\d+))\)\)/u;

const ACK_KIND: Record<string, RunningKind> = { "⏳": "refine", "🔨": "build", "💬": "revise" };

/** The finalizers' fixed texts. Matching them is how Suite names a needs-human. */
const REASONS: readonly [BotReason, RegExp][] = [
  ["settings-invalid", /^aiswec cannot start: `\.github\/aiswec\.yml`/],
  ["model-too-small", /^aiswec cannot start: the model `/],
  ["refine-failed", /^aiswec refine failed or produced no spec/],
  ["no-trusted-spec", /^aiswec build could not find a trusted spec comment/],
  ["stale-spec", /^A newer spec was posted after that approval/],
  ["draft-pr", /^aiswec build finished with a draft\/incomplete PR/],
  ["no-pr", /^aiswec build failed or produced no PR/],
  ["revise-failed", /^aiswec could not process the feedback/],
];

export function classifyBotComment(body: string, namespace: string = DEFAULT_NAMESPACE): BotReason | null {
  // The title of the alert a notice opens with names its reason, which is the
  // whole reason the finalizers write one. Only the leading alert counts, so a
  // title quoted further down, or inside a fence, names nothing.
  const title = parseDoc(body, "notice", namespace).plain?.title ?? null;
  const named = title === null ? undefined : NOTICE_TITLES[title];
  if (named !== undefined) return named;

  const lines = body.split(/\r\n?|\n/);
  // Questions before the escalation: both stop the pipeline, but one is answered with a click.
  const questions = marker("questions", namespace);
  if (lines.some((line) => line.trim() === questions)) return "questions";
  const escalate = marker("escalate", namespace);
  if (lines.some((line) => line.trim() === escalate)) return "escalated";
  const first = lines.find((line) => line.trim() !== "")?.trim() ?? "";
  for (const [reason, pattern] of REASONS) {
    if (pattern.test(first)) return reason;
  }
  return null;
}

function normalise(login: string): string {
  return login.trim().toLowerCase().replace(/^@/, "");
}

/** The release footer refine appends after `\n\n---\n\n`; the spec is what precedes it. */
export function splitSpecFooter(content: string): { body: string; footer: string | null } {
  const at = content.lastIndexOf("\n\n---\n\n");
  if (at < 0) return { body: content, footer: null };
  return { body: content.slice(0, at).trim(), footer: content.slice(at + 7).trim() };
}

export function deriveIssueState(issue: StateIssue, options: StateOptions): IssueState {
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;
  const bots = new Set(options.botLogins.map(normalise));
  const maintainers = new Set(options.maintainers.map(normalise));
  const isBot = (comment: StateComment): boolean => bots.has(normalise(comment.author));

  const assigned = issue.labels.includes(assignmentLabel(namespace));
  const held = isHeld(issue.labels, namespace);

  let state: RepoState | null = null;
  let inconsistent = false;
  try {
    state = activeState(issue.labels, { states: REPO_STATES, namespace }) as RepoState | null;
  } catch {
    inconsistent = true;
  }

  const prefix = `${options.branchPrefix}/issue-${issue.number}-`;
  const pr =
    issue.pulls.find((pull) => pull.state === "open" && pull.headRefName.startsWith(prefix)) ??
    issue.pulls.find((pull) => pull.headRefName.startsWith(prefix)) ??
    null;
  const merged = issue.pulls.some((pull) => pull.merged && pull.headRefName.startsWith(prefix));

  const everything = [...issue.comments, ...(issue.pullComments ?? [])].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );

  let running: IssueState["running"] = null;
  for (let index = everything.length - 1; index >= 0; index--) {
    const comment = everything[index];
    if (!comment || !isBot(comment)) continue;
    const match = ACK.exec(comment.body);
    if (!match || match[3] !== options.repo) continue;
    const kind = ACK_KIND[match[1] ?? ""];
    if (!kind) continue;
    const runId = Number(match[4]);
    if (options.finishedRuns?.includes(runId)) continue;
    running = { kind, runId, runUrl: match[2] ?? "", since: comment.createdAt };
    break;
  }

  const trustedSpecAuthors = [...options.botLogins, ...options.maintainers];
  const chosen = selectTrustedSpec(issue.comments, { trustedAuthors: trustedSpecAuthors, namespace });
  let spec: IssueState["spec"] = null;
  if (chosen) {
    const { body, footer } = splitSpecFooter(specContent(chosen.body, namespace));
    spec = {
      id: chosen.id,
      createdAt: chosen.createdAt,
      edited: chosen.updatedAt !== undefined && chosen.updatedAt !== chosen.createdAt,
      body,
      footer,
    };
  }

  let approval: IssueState["approval"] = null;
  if (spec) {
    for (let index = issue.comments.length - 1; index >= 0; index--) {
      const comment = issue.comments[index];
      if (!comment || comment.createdAt <= spec.createdAt) break;
      if (!maintainers.has(normalise(comment.author))) continue;
      const kind = classifyComment(comment.body, {
        keywords: ["approve", "approved", "lgtm", "ship it", "go ahead"],
        reservedPrefixes: options.reservedPrefixes ?? [],
      });
      if (kind.kind === "approval") {
        approval = { author: comment.author, createdAt: comment.createdAt, qualified: kind.qualified };
        break;
      }
    }
  }

  // The spec's Manual todos, ticked by the person's latest done comment after it (protocol/todos.ts).
  // The tasks its steps were made into carry over from the latest done comment before it, by the
  // words of each step: a re-run writes the list again, and a task made in another repository still stands.
  let todos: ManualTodos | null = null;
  if (spec) {
    const listed = parseDoc(spec.body, "spec", namespace).byKey["todos"]?.data as CheckItem[] | undefined;
    let ticks: DoneItem[] | null = null;
    let carried: DoneItem[] | null = null;
    for (let index = issue.comments.length - 1; index >= 0; index--) {
      const comment = issue.comments[index];
      if (!comment || !maintainers.has(normalise(comment.author))) continue;
      const parsed = parseDone(comment.body, namespace);
      if (parsed === null) continue;
      if (comment.createdAt > spec.createdAt) {
        if (ticks === null) ticks = parsed;
        continue;
      }
      carried = parsed;
      break;
    }
    todos = manualTodos(listed, ticks, { carried });
  }

  // Approved, and nothing of the bot's since: the build is queued, so the plan is
  // no longer waiting on a person. The build's ack, its notice or its PR all come
  // after the approval and take over from here; a stale-spec notice puts the issue
  // back in front of the person, since it is still `refined`.
  const approved = approval !== null && !everything.some((comment) => isBot(comment) && comment.createdAt > approval.createdAt);

  let reason: BotReason | null = null;
  for (let index = everything.length - 1; index >= 0; index--) {
    const comment = everything[index];
    if (!comment || !isBot(comment)) continue;
    if (ACK.test(comment.body)) continue;
    reason = classifyBotComment(comment.body, namespace);
    break;
  }
  if (reason === null && state === "needs-human" && pr?.isDraft) reason = "draft-pr";

  const column = deriveColumn({ issue, assigned, held, state, inconsistent, running, pr, merged, approved });

  return { assigned, held, state, inconsistent, running, spec, approval, todos, reason, pr, column };
}

function deriveColumn(input: {
  issue: StateIssue;
  assigned: boolean;
  held: boolean;
  state: RepoState | null;
  inconsistent: boolean;
  running: IssueState["running"];
  pr: StatePull | null;
  merged: boolean;
  approved: boolean;
}): Column {
  if (input.issue.state === "closed") return input.merged ? "done" : "closed";
  if (input.inconsistent) return "inconsistent";
  if (input.running) {
    if (input.running.kind === "refine") return "refining";
    if (input.running.kind === "build") return "building";
    return "responding";
  }
  if (!input.assigned) return "unassigned";
  if (input.held) return "held";
  switch (input.state) {
    case null:
      return "new";
    case "refined":
    case "ready-to-build":
      return input.approved ? "building" : "awaiting-approval";
    case "pr-open":
      return input.pr && input.pr.state === "open" ? "in-review" : "dead-end";
    case "needs-human":
      return "needs-human";
  }
}
