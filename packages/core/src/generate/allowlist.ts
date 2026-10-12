/**
 * Bash allowlist generation.
 *
 * The permission model is per-stage `--allowedTools`, never
 * `--dangerously-skip-permissions`. The lesson the source system paid for is
 * that over-specified patterns fail closed and silently: an exact-form
 * `git push` pattern denied the real command, and the build finished having
 * produced no PR with nothing in the output saying why.
 *
 * So patterns are generated at command-prefix granularity from the commands the
 * config already declares, and the hard limits live platform-side in branch
 * rulesets instead of in pattern strings.
 */

/** Always available. Read-mostly git plus the two gh calls the stages need. */
export const SAFE_CORE_TOOLS: readonly string[] = [
  "Bash(git status:*)",
  "Bash(git diff:*)",
  "Bash(git log:*)",
  "Bash(git rev-parse:*)",
  "Bash(git checkout:*)",
  "Bash(git switch:*)",
  "Bash(git add:*)",
  "Bash(git commit:*)",
  "Bash(git push:*)",
  "Bash(gh pr create:*)",
  "Bash(gh pr view:*)",
  "Bash(gh api:*)",
];

/**
 * A command becomes a prefix pattern: the binary plus its first non-flag
 * argument, which is specific enough to be meaningful and loose enough to still
 * match when the agent adds a flag.
 */
export function commandPattern(command: string): string | null {
  const tokens = command.trim().split(/\s+/).filter(Boolean);
  const binary = tokens[0];
  if (!binary) return null;

  const second = tokens[1];
  const prefix = second && !second.startsWith("-") ? `${binary} ${second}` : binary;
  return `Bash(${prefix}:*)`;
}

export interface AllowlistOptions {
  install: string;
  gates: readonly string[];
  /** Extra raw tool patterns, e.g. a repo quirk that needs one more command. */
  extra?: readonly string[];
}

export function buildAllowlist(options: AllowlistOptions): string[] {
  const derived = [options.install, ...options.gates]
    .map(commandPattern)
    .filter((pattern): pattern is string => pattern !== null);

  const seen = new Set<string>();
  const result: string[] = [];

  for (const pattern of [...SAFE_CORE_TOOLS, ...derived.sort(), ...(options.extra ?? [])]) {
    if (seen.has(pattern)) continue;
    seen.add(pattern);
    result.push(pattern);
  }

  return result;
}
