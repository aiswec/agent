import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { configSchema } from "./schema.js";
import { resolveConfig, type ResolvedConfig } from "./resolve.js";

export class ConfigError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

export function parseConfig(source: string): ResolvedConfig {
  let document: unknown;
  try {
    document = parseYaml(source);
  } catch (error) {
    throw new ConfigError("config is not valid YAML", [
      error instanceof Error ? error.message : String(error),
    ]);
  }

  if (document === null || typeof document !== "object") {
    throw new ConfigError("config is empty", ["expected a YAML mapping at the top level"]);
  }

  const result = configSchema.safeParse(document);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    });
    throw new ConfigError("config failed validation", issues);
  }

  return resolveConfig(result.data);
}

export function loadConfigFile(path: string): ResolvedConfig {
  let source: string;
  try {
    source = readFileSync(path, "utf8");
  } catch (error) {
    throw new ConfigError(`cannot read ${path}`, [
      error instanceof Error ? error.message : String(error),
    ]);
  }
  return parseConfig(source);
}
