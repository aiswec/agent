/**
 * Reading a tenant's stub.
 *
 * A stub is the ~50-line workflow a repository holds to call one of the
 * reusable stages by tag. Suite needs to recognise one and read the two
 * structural values that live only there (the namespace and the branch
 * prefix) plus the ref it pins, so a repo's profile is derived from what is
 * actually installed and not from anything Suite remembers. Everything
 * behavioural is in `.github/aiswec.yml` (config/settings.ts), not here.
 *
 * The parse is deliberately shallow: `jobs.*.uses`, `jobs.*.with` and the
 * keys of `jobs.*.secrets` (never a value: a stub holds `${{ secrets.X }}`
 * expressions, and what the doctor asks is whether `expo_token` is handed
 * on at all, 2026-09-06). A stub that GitHub cannot parse is not detected
 * either; Doctor's job, later.
 */
import { parse as parseYaml } from "yaml";
import type { RepoStage } from "../config/schema.js";

const STAGE_USES =
  /^(?:(?<owner>[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)\/|(?<local>\.\/))\.github\/workflows\/stage-(?<stage>refine|build|revise)\.yml(?:@(?<ref>.+))?$/;

export interface Stub {
  stage: RepoStage;
  /** `owner/repo` the stage is called from, or null for a same-repo `./` call. */
  source: string | null;
  /** The pinned ref (`v2`, `main`, `v2.0.0`); null for a local call. */
  ref: string | null;
  namespace: string;
  branchPrefix: string | null;
  /** Refine only: whether `issues: [labeled]` is subscribed, i.e. assignment can start it. */
  assignable: boolean | null;
  /** The keys under `secrets:` when it is a map, `"inherit"` when it is that word, null when absent. */
  secrets: string[] | "inherit" | null;
}

const DEFAULT_NAMESPACE = "aiswec";

export function parseStub(text: string): Stub | null {
  let document: unknown;
  try {
    document = parseYaml(text);
  } catch {
    return null;
  }
  if (!isRecord(document)) return null;

  const jobs = document["jobs"];
  if (!isRecord(jobs)) return null;

  for (const job of Object.values(jobs)) {
    if (!isRecord(job) || typeof job["uses"] !== "string") continue;
    const match = STAGE_USES.exec(job["uses"].trim());
    const stage = match?.groups?.["stage"];
    if (!match || (stage !== "refine" && stage !== "build" && stage !== "revise")) continue;

    const withBlock = isRecord(job["with"]) ? job["with"] : {};
    const namespace = stringOr(withBlock["namespace"], DEFAULT_NAMESPACE);
    const branchPrefix = stringOr(withBlock["branch_prefix"], null);

    return {
      stage,
      source: match.groups?.["owner"] ?? null,
      ref: match.groups?.["ref"] ?? null,
      namespace,
      branchPrefix,
      assignable: stage === "refine" ? subscribesLabeled(document["on"]) : null,
      secrets: secretsOf(job["secrets"]),
    };
  }
  return null;
}

function secretsOf(value: unknown): string[] | "inherit" | null {
  if (typeof value === "string" && value.trim() === "inherit") return "inherit";
  if (isRecord(value)) return Object.keys(value);
  return null;
}

function subscribesLabeled(on: unknown): boolean {
  if (!isRecord(on)) return false;
  const issues = on["issues"];
  if (!isRecord(issues)) return false;
  const types = issues["types"];
  return Array.isArray(types) && types.includes("labeled");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOr<T>(value: unknown, fallback: T): string | T {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}
