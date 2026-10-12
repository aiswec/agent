/**
 * The absolute rules, shared where they are the same rule.
 *
 * Each stage used to end with its own list, and a rule that mattered to all
 * three (never print a secret, never wait for a subagent) was present in one
 * or two of them. The lists are built here from named clauses so a stage can
 * only be missing a rule on purpose.
 */
import { EXPR, type Stage } from "./stage.js";

const SELF = `Do the work YOURSELF in this run: never delegate to subagents, background
tasks, or "verification agents", and never end your turn waiting for a
notification; nothing will ever arrive.`;

const SECRETS = "Never print, echo, commit or send anywhere a secret, a token or the contents of a .env file.";

const WRITES = "Never post comments, never apply or remove labels, never edit the issue body or title; the workflow owns every GitHub write.";

const REFINE: readonly string[] = [
  WRITES,
  "Write exactly ONE of the four output files, nothing else outside /tmp.",
  "No code changes, no branches, no commits, no pushes in this step.",
  "The only shell command available is `gh issue view`.",
  SECRETS,
  SELF,
  `CRITICAL: ending without one of the four output files is a hard pipeline
failure. If anything goes sideways (a denied tool, a page that will not
load, turns running low), STOP and write the best file you can from what
you know: an imperfect file beats none.`,
];

const BUILD: readonly string[] = [
  `Never commit or push to ${EXPR.baseBranch}. Never force-push. Never delete branches.`,
  SECRETS,
  "Never run dev servers, watchers, or release scripts.",
  `One PR per issue: if an open ${EXPR.branchPrefix}/issue-${EXPR.issue}-* branch or PR already exists, push to it instead of opening a duplicate.`,
  WRITES + " Your PR body is the exception: it is yours.",
  "Never merge the PR.",
  SELF,
];

const REVISE: readonly string[] = [
  // The revise stage has no base_branch input: it works on the branch the pull
  // request already opened, and never names the base by expression.
  "Never commit or push to the base branch. Never force-push. Never merge the pull request.",
  "A pull request for this branch ALREADY EXISTS. Never open a second one.",
  SECRETS,
  WRITES,
  SELF,
  `CRITICAL: ending without /tmp/aiswec-reply.md is a hard pipeline failure.
If anything goes sideways, STOP and write the best reply you can
(including "blocked because ...").`,
];

const LISTS: Record<Stage, readonly string[]> = { refine: REFINE, build: BUILD, revise: REVISE };

export function absoluteRules(stage: Stage): string {
  const bullets = LISTS[stage].map((rule) => `- ${rule.split("\n").join("\n  ")}`);
  return ["## Absolute rules", ...bullets].join("\n");
}
