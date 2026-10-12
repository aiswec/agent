#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { ConfigError, REPO_STAGES, loadConfigFile, stagePrompt, type RepoStage, type ResolvedConfig } from "@aiswec/core";

const DEFAULT_CONFIG_PATH = "aiswec.yml";

function version(): string {
  try {
    const source = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    return (JSON.parse(source) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const USAGE = `aiswec ${version()}

Usage
  aiswec validate [config]   Validate a config and print what it resolves to
  aiswec labels   [config]   Print the label set to provision, as JSON
  aiswec prompt   <stage>    Print a stage's engine prompt (refine|build|revise)
  aiswec help                Show this message

Options
  --json                     Machine-readable output

The config path defaults to ./${DEFAULT_CONFIG_PATH}.
`;

function pad(label: string, width: number): string {
  return label.length >= width ? label : label + " ".repeat(width - label.length);
}

/**
 * "Does this pipeline advance on its own?" is the question the config exists to
 * answer out loud, so `validate` answers it per stage rather than making anyone
 * open the YAML.
 */
const ADVANCE_TEXT: Record<string, string> = {
  auto: "on its own",
  approval: "waits for approval",
  manual: "manual start only",
};

function printSummary(config: ResolvedConfig): void {
  const lines: string[] = [];

  lines.push(`${config.productName}  (namespace ${config.namespace}, branch ${config.branchPrefix}/…)`);
  lines.push("");
  lines.push(`hub  ${config.hub.name}`);
  lines.push(
    `     route  ${config.hub.route.model}  ${config.hub.route.turns} turns  ` +
      `${config.hub.route.stepMinutes}m step -> ${config.hub.route.jobMinutes}m job`,
  );
  lines.push("");

  for (const repo of config.repos) {
    const flags = repo.deploySensitive ? "  [deploy-sensitive]" : "";
    lines.push(`repo ${repo.slug}  ${repo.name}${flags}`);
    for (const stage of repo.stages) {
      lines.push(
        `     ${pad(stage.stage, 7)}${stage.model}  ${stage.turns} turns  ` +
          `${stage.stepMinutes}m step -> ${stage.jobMinutes}m job  ` +
          `[${ADVANCE_TEXT[stage.advance] ?? stage.advance}]`,
      );
    }
    lines.push(`     gates  ${repo.gates.join("  ·  ") || "(none)"}`);
    lines.push(`     tools  ${repo.allowedTools.length} patterns, ${repo.allowedTools.filter((tool) => !tool.startsWith("Bash(git") && !tool.startsWith("Bash(gh")).join(" ") || "core only"}`);
    lines.push("");
  }

  lines.push(`approval  /${config.approvalGrammar}/i`);
  if (config.repos.some((repo) => repo.stages.some((stage) => stage.advance === "approval"))) {
    lines.push(`release   an approval comment, or the ${config.readyToBuildLabel} label`);
  }
  lines.push(`merge     ${config.mergeOrderSentence ?? "(no dependencies declared, so no merge-order text emitted)"}`);
  lines.push(`labels    ${config.labels.length} to provision`);
  if (config.smokeModel) lines.push(`smoke     ${config.smokeModel}`);

  process.stdout.write(`${lines.join("\n")}\n`);
}

function fail(error: unknown): never {
  if (error instanceof ConfigError) {
    process.stderr.write(`${error.message}\n`);
    for (const issue of error.issues) process.stderr.write(`  - ${issue}\n`);
    process.exit(1);
  }
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

function main(argv: string[]): void {
  const args = argv.filter((arg) => arg !== "--json");
  const asJson = argv.includes("--json");
  const command = args[0] ?? "help";
  const path = args[1] ?? DEFAULT_CONFIG_PATH;

  switch (command) {
    case "validate": {
      let config: ResolvedConfig;
      try {
        config = loadConfigFile(path);
      } catch (error) {
        fail(error);
      }
      if (asJson) {
        process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
        return;
      }
      printSummary(config);
      return;
    }
    case "labels": {
      let config: ResolvedConfig;
      try {
        config = loadConfigFile(path);
      } catch (error) {
        fail(error);
      }
      process.stdout.write(`${JSON.stringify(config.labels, null, 2)}\n`);
      return;
    }
    // The prompt is the product's behaviour, and reading it should not mean
    // opening a thousand-line workflow or waiting for a run.
    case "prompt": {
      const stage = args[1];
      if (stage === undefined || !REPO_STAGES.includes(stage as RepoStage)) {
        process.stderr.write(`aiswec prompt needs a stage: ${REPO_STAGES.join(", ")}\n`);
        process.exit(1);
      }
      process.stdout.write(`${stagePrompt(stage as RepoStage)}\n`);
      return;
    }
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(USAGE);
      return;
    case "version":
    case "--version":
    case "-v":
      process.stdout.write(`${version()}\n`);
      return;
    default:
      process.stderr.write(`unknown command "${command}"\n\n${USAGE}`);
      process.exit(1);
  }
}

main(process.argv.slice(2));
