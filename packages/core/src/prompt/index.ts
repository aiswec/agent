/**
 * Every prompt aiswec sends a model, composed in one place.
 *
 * The three stages carried three hand-written prompts, 610 lines of them, in
 * three thousand-line workflow files, and the shared rules had already drifted
 * apart: only refine told the engine to write for two readers, only refine and
 * build said CLAUDE.md outranks README, and revise named a different source
 * for the maintainer list than its own guards read. The prompt text now lives
 * here and `scripts/sync-prompts.ts` writes it into the workflows, where a test
 * fails if the two ever differ.
 */
import { buildPrompt } from "./build.js";
import { refinePrompt } from "./refine.js";
import { revisePrompt } from "./revise.js";
import type { Stage } from "./stage.js";

const PROMPTS: Record<Stage, () => string> = {
  refine: refinePrompt,
  build: buildPrompt,
  revise: revisePrompt,
};

/** The stage's prompt, exactly as the workflow's `prompt:` block carries it. */
export function stagePrompt(stage: Stage): string {
  return PROMPTS[stage]().trimEnd();
}

export { EXPR } from "./stage.js";
export { skeleton, questionsBlock, alert } from "./templates.js";
export { ground } from "./ground.js";
export { voice } from "./voice.js";
export { absoluteRules } from "./rules.js";
export { listen, INJECTION, WEB_TRUST } from "./trust.js";
