#!/usr/bin/env bun
/**
 * Writes the composed prompts into the stage workflows.
 *
 * A reusable workflow has to be self-contained: a tenant pins `@v2` and gets
 * one file, so the prompt cannot be fetched from anywhere at run time without
 * making the version of the text drift from the version of the stage. It is
 * therefore generated into the YAML, between sentinel comments, and
 * `packages/core/test/prompt.test.ts` fails when the block and the library
 * disagree. Edit `packages/core/src/prompt/`, run `bun run sync:prompts`,
 * commit both.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { REPO_STAGES, stagePrompt, type RepoStage } from "../packages/core/src/index.js";

const INDENT = " ".repeat(10);
const BODY = " ".repeat(12);

export function workflowPath(stage: RepoStage): string {
  return new URL(`../.github/workflows/stage-${stage}.yml`, import.meta.url).pathname;
}

export function promptBlock(stage: RepoStage): string {
  return [
    `${INDENT}# aiswec:prompt-start (generated from packages/core/src/prompt, run \`bun run sync:prompts\`)`,
    `${INDENT}prompt: |`,
    ...stagePrompt(stage)
      .split("\n")
      .map((line) => (line === "" ? "" : BODY + line)),
    `${INDENT}# aiswec:prompt-end`,
  ].join("\n");
}

const START = /^ *# aiswec:prompt-start.*$/m;
const END = /^ *# aiswec:prompt-end.*$/m;

/** The lines the block occupies today: the sentinels, or the bare `prompt: |`. */
function bounds(yaml: string): { from: number; to: number } {
  const lines = yaml.split("\n");
  const start = lines.findIndex((line) => START.test(line));
  if (start !== -1) {
    const end = lines.findIndex((line, i) => i > start && END.test(line));
    if (end === -1) throw new Error("aiswec:prompt-start without an aiswec:prompt-end");
    return { from: start, to: end };
  }
  const key = lines.findIndex((line) => line === `${INDENT}prompt: |`);
  if (key === -1) throw new Error("no `prompt: |` block and no sentinels");
  let to = key;
  while (to + 1 < lines.length) {
    const next = lines[to + 1] ?? "";
    if (next !== "" && !next.startsWith(BODY)) break;
    to += 1;
  }
  // A block scalar's trailing blank lines belong to the key after it.
  while (to > key && (lines[to] ?? "") === "") to -= 1;
  return { from: key, to };
}

export function withPrompt(yaml: string, stage: RepoStage): string {
  const lines = yaml.split("\n");
  const { from, to } = bounds(yaml);
  return [...lines.slice(0, from), promptBlock(stage), ...lines.slice(to + 1)].join("\n");
}

if (import.meta.main) {
  let changed = 0;
  for (const stage of REPO_STAGES) {
    const path = workflowPath(stage);
    const before = readFileSync(path, "utf8");
    const after = withPrompt(before, stage);
    if (before === after) {
      console.log(`stage-${stage}.yml: already current`);
      continue;
    }
    writeFileSync(path, after);
    changed += 1;
    console.log(`stage-${stage}.yml: prompt written`);
  }
  console.log(changed === 0 ? "nothing to do" : `${changed} workflow${changed === 1 ? "" : "s"} updated`);
}
