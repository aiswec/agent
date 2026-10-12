/**
 * Resolution turns the declared config into the values the generator emits:
 * per-stage models and budgets with repo overrides applied, derived job
 * timeouts, the generated Bash allowlist, and the merge-order sentence that is
 * a hardcoded string in the source system today.
 */
import { approvalFooterSentence, approvalGrammarSource } from "../protocol/approval.js";
import { labelDefinitions, labelName, type LabelDefinition } from "../protocol/labels.js";
import { buildAllowlist } from "../generate/allowlist.js";
import {
  DEFAULT_ADVANCE,
  JOB_TIMEOUT_HEADROOM_MIN,
  REPO_STAGES,
  topologicalOrder,
  type AdvanceMode,
  type RawConfig,
  type RawRepoConfig,
  type RepoStage,
  type Stage,
} from "./schema.js";

/**
 * The half of the release footer that is not derived from the keyword list.
 *
 * `classifyComment` flags a qualified approval ("approve but drop the second
 * one") rather than rejecting it, and build implements the spec as written,
 * so the footer has to say plainly that conditions typed after the keyword are
 * not read. Saying it is cheaper than the pull request that proves it.
 */
const QUALIFIED_APPROVAL_CAVEAT =
  "Conditions written after the keyword are not read either: an approval builds the spec exactly as posted.";

export interface ResolvedStage {
  stage: Stage;
  model: string;
  turns: number;
  stepMinutes: number;
  /** Always stepMinutes + JOB_TIMEOUT_HEADROOM_MIN. Never configured. */
  jobMinutes: number;
  /** What it takes to enter this stage: auto, a maintainer's approval, or a human. */
  advance: AdvanceMode;
}

export interface ResolvedRepo {
  slug: string;
  name: string;
  owner: string;
  repo: string;
  areas: string;
  baseBranch: string;
  deploySensitive: boolean;
  verifyEnv: string;
  gates: string[];
  install: string;
  setup: Record<string, unknown>[];
  preSteps: string[];
  stages: ResolvedStage[];
  allowedTools: string[];
  /** e.g. aiswec/issue-<n>-<slug>: the guard, the push, and the revise gate all key on it. */
  branchPattern: string;
}

export interface ResolvedConfig {
  productName: string;
  namespace: string;
  branchPrefix: string;
  maintainers: string[];
  approvalKeywords: string[];
  approvalGrammar: string;
  approvalFooter: string;
  /** The sentence refine closes a spec with when build waits on a human. */
  specApprovalFooter: string;
  /** The label a maintainer can apply instead of commenting, e.g. aiswec:ready-to-build. */
  readyToBuildLabel: string;
  /** Pipeline-wide advancement policy, after defaults; per-repo values live on each stage. */
  advance: Record<RepoStage, AdvanceMode>;
  reservedCommentPrefixes: string[];
  smokeModel: string | null;
  hub: {
    name: string;
    owner: string;
    repo: string;
    route: ResolvedStage;
  };
  repos: ResolvedRepo[];
  /** Repo slugs in merge order, or null when no dependencies are declared. */
  mergeOrder: string[] | null;
  /** Generated, not hardcoded: a single-repo plan gets no merge-order sentence at all. */
  mergeOrderSentence: string | null;
  labels: LabelDefinition[];
}

function splitRepoName(name: string): { owner: string; repo: string } {
  const [owner = "", repo = ""] = name.split("/");
  return { owner, repo };
}

/** repo override, then the pipeline-wide setting, then the engine default. */
function resolveAdvance(
  stage: RepoStage,
  config: RawConfig,
  repo?: RawRepoConfig,
): AdvanceMode {
  return repo?.advance?.[stage] ?? config.advance?.[stage] ?? DEFAULT_ADVANCE[stage];
}

function resolveStage(
  stage: RepoStage,
  config: RawConfig,
  repo: RawRepoConfig,
): ResolvedStage {
  const model = repo.models?.[stage] ?? config.models[stage];
  const budget = repo.budgets?.[stage] ?? config.budgets[stage];
  return {
    stage,
    model,
    turns: budget.turns,
    stepMinutes: budget.step_min,
    jobMinutes: budget.step_min + JOB_TIMEOUT_HEADROOM_MIN,
    advance: resolveAdvance(stage, config, repo),
  };
}

export function mergeOrderSentence(order: readonly string[]): string {
  if (order.length < 2) return "";
  const [first, ...rest] = order;
  return `Merge order: ${first} first, then ${rest.join(", then ")}.`;
}

export function resolveConfig(config: RawConfig): ResolvedConfig {
  const hub = splitRepoName(config.hub.repo);
  const readyToBuildLabel = labelName("ready-to-build", config.namespace);

  const repos: ResolvedRepo[] = config.repos.map((repo) => {
    const { owner, repo: name } = splitRepoName(repo.name);
    return {
      slug: repo.slug,
      name: repo.name,
      owner,
      repo: name,
      areas: repo.areas,
      baseBranch: repo.base_branch,
      deploySensitive: repo.deploy_sensitive,
      verifyEnv: repo.verify_env,
      gates: [...repo.gates],
      install: repo.runtime.install,
      setup: [...repo.runtime.setup],
      preSteps: [...repo.runtime.pre_steps],
      stages: repo.stages.map((stage) => resolveStage(stage, config, repo)),
      allowedTools: buildAllowlist({ install: repo.runtime.install, gates: repo.gates }),
      branchPattern: `${config.branch_prefix}/issue-<n>-<slug>`,
    };
  });

  const hasDependencies = config.dependencies.length > 0;
  const order = hasDependencies
    ? topologicalOrder(config.repos.map((repo) => repo.slug), config.dependencies)
    : null;
  const sentence = order ? mergeOrderSentence(order) : "";

  return {
    productName: config.product_name,
    namespace: config.namespace,
    branchPrefix: config.branch_prefix,
    maintainers: [...config.maintainers],
    approvalKeywords: [...config.approval_keywords],
    approvalGrammar: approvalGrammarSource(config.approval_keywords),
    approvalFooter: approvalFooterSentence(config.approval_keywords),
    specApprovalFooter: `${approvalFooterSentence(config.approval_keywords, {
      action: "build this spec",
      // Deliberately not "treated as feedback": refine subscribes to
      // `issues: opened` and dispatch, never to `issue_comment`, so a reply
      // reaches no workflow. Re-running refine does fold the whole thread,
      // the maintainer's feedback included, into a new spec, so that is the
      // path the sentence names.
      otherwise:
        `Any other reply is not read by the pipeline: re-run \`${config.namespace}-refine.yml\` ` +
        "on this issue to fold your feedback into a new spec.",
      releaseLabel: readyToBuildLabel,
    })} ${QUALIFIED_APPROVAL_CAVEAT}`,
    readyToBuildLabel,
    advance: Object.fromEntries(
      REPO_STAGES.map((stage) => [stage, resolveAdvance(stage, config)]),
    ) as Record<RepoStage, AdvanceMode>,
    reservedCommentPrefixes: [...config.reserved_comment_prefixes],
    smokeModel: config.smoke_model ?? null,
    hub: {
      name: config.hub.repo,
      owner: hub.owner,
      repo: hub.repo,
      route: {
        stage: "route",
        model: config.models.route,
        turns: config.hub.budgets.route.turns,
        stepMinutes: config.hub.budgets.route.step_min,
        jobMinutes: config.hub.budgets.route.step_min + JOB_TIMEOUT_HEADROOM_MIN,
        // Not a knob. Route is what reads a new product issue, and the gate
        // that matters on the hub (a plan is filed only on an approval
        // comment) is the state machine itself, which the README's first
        // design rule keeps engine-owned.
        advance: "auto",
      },
    },
    repos,
    mergeOrder: order,
    mergeOrderSentence: sentence === "" ? null : sentence,
    labels: labelDefinitions(config.namespace),
  };
}
