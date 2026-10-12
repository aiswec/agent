/**
 * The three stages, and the workflow expressions their prompts carry.
 *
 * A prompt is assembled here and pasted into `.github/workflows/stage-*.yml`,
 * so every `${{ ... }}` in it is text to this module and an expression to
 * Actions. Naming them once is what keeps a stage from reading a different
 * source for the same fact: revise's prompt used to name `inputs.maintainers`
 * while its own guards read `steps.cfg.outputs.maintainers`, so a repository
 * that set maintainers in `.github/aiswec.yml` told the engine one list and the
 * workflow another.
 */
import { REPO_STAGES, type RepoStage } from "../config/schema.js";

/** The three stages that run in a repository; the config schema owns the list. */
export type Stage = RepoStage;
export const STAGES: readonly Stage[] = REPO_STAGES;

/** Workflow expressions, written the way the YAML needs them. */
export const EXPR = {
  repository: "${{ github.repository }}",
  namespace: "${{ inputs.namespace }}",
  /** Resolved from `.github/aiswec.yml` first, the stub's input second. */
  maintainers: "${{ steps.cfg.outputs.maintainers }}",
  issue: "${{ steps.ctx.outputs.issue_number }}",
  pr: "${{ steps.ctx.outputs.pr }}",
  branch: "${{ steps.ctx.outputs.branch }}",
  branchPrefix: "${{ inputs.branch_prefix }}",
  baseBranch: "${{ inputs.base_branch }}",
  install: "${{ steps.cfg.outputs.install || 'none for this repo' }}",
} as const;

/** The branch a build opens, as the engine is told to name it. */
export const BUILD_BRANCH = `${EXPR.branchPrefix}/issue-${EXPR.issue}-<slug>`;
