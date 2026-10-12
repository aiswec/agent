/**
 * The config schema: one file replacing every hard-coding the audit found.
 *
 * Two rules shape it. Anything that is a safety property (the state machine,
 * verbatim filing, trusted-author fetch, the untrusted-data preambles) is
 * engine-owned and deliberately absent here. Anything that drifted between the
 * hand-copied source workflows (runtimes, timeouts, gates, which stages exist)
 * is present, because that drift is what this package exists to eliminate.
 *
 * Every object here is `.strict()`: a key the schema does not know is a typo or
 * a stale key, and dropping it silently would apply a setting the maintainer
 * never wrote. The one exception is a `runtime.setup` entry, which is a
 * passthrough Actions step with no fixed key set.
 */
import { z } from "zod";

/**
 * Job timeout headroom over the engine step, in minutes.
 *
 * Not configurable. Every live workflow sits exactly 5 minutes above its step
 * timeout, which lets a job hard-cancel beat graceful degradation, half of the
 * silent-hang defect. Ten minutes is the fix, and making it a knob would just
 * let the defect back in.
 */
export const JOB_TIMEOUT_HEADROOM_MIN = 10;

export const STAGES = ["route", "refine", "build", "revise"] as const;
export type Stage = (typeof STAGES)[number];

export const REPO_STAGES = ["refine", "build", "revise"] as const;
export type RepoStage = (typeof REPO_STAGES)[number];

/**
 * How much leash the pipeline gets before it needs you.
 *
 * This is the one thing every hand-copied source workflow decided by itself,
 * in bash, with no way to say otherwise: refine posted a spec and immediately
 * dispatched build, so an issue became a pull request with no human in
 * between. The only brake was a `hold` label you had to apply *before* the
 * run: opt-out, and too late by the time you had read anything.
 *
 * - `auto`     the pipeline enters this stage by itself.
 * - `approval` the pipeline stops, shows its work, and waits for a maintainer
 *              to approve it with an approval comment, or the release label.
 * - `manual`   nothing enters this stage on its own; a human starts it with a
 *              workflow dispatch.
 */
export const ADVANCE_MODES = ["auto", "approval", "manual"] as const;
export type AdvanceMode = (typeof ADVANCE_MODES)[number];

/**
 * Engine defaults. `build` waits, because build is the stage that writes code
 * and opens a pull request, and "human-approved at every irreversible step" is
 * the product's claim rather than a preference. Omitting the key entirely gets
 * you the safe pipeline; auto-advance is something a tenant has to write down.
 */
export const DEFAULT_ADVANCE: Readonly<Record<RepoStage, AdvanceMode>> = {
  refine: "auto",
  build: "approval",
  revise: "auto",
};

/**
 * The stages where `approval` means something. Approval is consent to a
 * specific artifact the previous stage produced and a human read, which in
 * the per-repo pipeline is the spec, and nothing else. Before refine there is
 * no artifact, and revise is itself driven by the maintainer's own comment, so
 * "wait for approval" there would be waiting on the thing that started it.
 */
export const APPROVABLE_STAGES: readonly RepoStage[] = ["build"];

const slug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "must be lowercase letters, digits and dashes");

const repoName = z
  .string()
  .regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/, "must be owner/repo");

/**
 * A GitHub login, shaped the way GitHub shapes them.
 *
 * Validated rather than accepted as any non-empty string because this list is
 * emitted verbatim into a generated workflow's job `if:` expression, which is
 * a quoted GitHub Actions expression: a login carrying a quote or a backslash
 * would end the string and the rest would be evaluated. The one place config
 * becomes executable is the one place a format check is not pedantry.
 */
const login = z
  .string()
  .regex(
    /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/,
    "must be a GitHub login: letters, digits and single inner dashes, at most 39 characters",
  );

/** The same login rule, for the per-repo settings file and Suite. */
export const githubLogin = login;

const budget = z
  .object({
    turns: z.number().int().positive(),
    step_min: z.number().int().positive(),
  })
  .strict();

const runtime = z
  .object({
    /**
     * Passthrough GitHub Actions steps. Deliberately not strict: a step object
     * has no fixed key set (`uses`, `with`, `run`, `env`, ...), so a record is
     * the shape, not a gap in it.
     */
    setup: z.array(z.record(z.string(), z.unknown())).default([]),
    install: z.string().min(1),
    pre_steps: z.array(z.string()).default([]),
  })
  .strict();

const advancePolicy = z
  .object({
    refine: z.enum(ADVANCE_MODES).optional(),
    build: z.enum(ADVANCE_MODES).optional(),
    revise: z.enum(ADVANCE_MODES).optional(),
  })
  .strict();

const repoStageBudgets = z
  .object({
    refine: budget.optional(),
    build: budget.optional(),
    revise: budget.optional(),
  })
  .strict();

const repoStageModels = z
  .object({
    refine: z.string().min(1).optional(),
    build: z.string().min(1).optional(),
    revise: z.string().min(1).optional(),
  })
  .strict();

const repoConfig = z
  .object({
    slug,
    name: repoName,
    stages: z.array(z.enum(REPO_STAGES)).min(1),
    areas: z.string().min(1),
    base_branch: z.string().min(1).default("main"),
    /** Merging to base deploys production; the prompts and rulesets both care. */
    deploy_sensitive: z.boolean().default(false),
    runtime,
    gates: z.array(z.string().min(1)).default([]),
    verify_env: z.string().default(""),
    models: repoStageModels.optional(),
    budgets: repoStageBudgets.optional(),
    /** Overrides the top-level `advance`, stage by stage. Same shape as `models`. */
    advance: advancePolicy.optional(),
  })
  .strict();

export const configSchema = z
  .object({
    product_name: z.string().min(1),
    maintainers: z.array(login).min(1),
    approval_keywords: z
      .array(z.string().min(1))
      .min(1)
      .default(["approve", "approved", "lgtm", "ship it", "go ahead"]),
    branch_prefix: z
      .string()
      .regex(/^[a-z0-9][a-z0-9._-]*$/, "must be usable as a git ref segment")
      .default("aiswec"),
    namespace: z
      .string()
      .regex(/^[a-z][a-z0-9-]*$/, "must be lowercase letters, digits and dashes")
      .default("aiswec"),
    reserved_comment_prefixes: z.array(z.string().min(1)).default([]),
    /**
     * Pipeline-wide advancement policy; every repo inherits it unless it says
     * otherwise. Deliberately `.optional()` rather than `.default({})`: under
     * zod 4 a `.default({})` on an all-optional object yields `{}` and the
     * inner defaults never run, so the fallback chain lives in one place in
     * resolve.ts (repo -> config -> DEFAULT_ADVANCE) instead of two.
     */
    advance: advancePolicy.optional(),
    hub: z
      .object({
        repo: repoName,
        budgets: z.object({ route: budget }).strict(),
      })
      .strict(),
    models: z
      .object({
        route: z.string().min(1),
        refine: z.string().min(1),
        build: z.string().min(1),
        revise: z.string().min(1),
      })
      .strict(),
    budgets: z
      .object({
        refine: budget,
        build: budget,
        revise: budget,
      })
      .strict(),
    smoke_model: z.string().min(1).optional(),
    repos: z.array(repoConfig).min(1),
    dependencies: z.array(z.object({ first: slug, then: slug }).strict()).default([]),
  })
  .strict()
  .superRefine((config, ctx) => {
    const checkAdvance = (
      policy: z.infer<typeof advancePolicy> | undefined,
      path: (string | number)[],
    ): void => {
      if (!policy) return;
      for (const stage of REPO_STAGES) {
        if (policy[stage] !== "approval" || APPROVABLE_STAGES.includes(stage)) continue;
        ctx.addIssue({
          code: "custom",
          message:
            `advance.${stage} cannot be "approval": nothing is posted for a maintainer to ` +
            `approve before ${stage} runs. Use "manual" to require a human to start it.`,
          path: [...path, stage],
        });
      }
    };

    checkAdvance(config.advance, ["advance"]);

    const slugs = new Set<string>();
    config.repos.forEach((repo, index) => {
      checkAdvance(repo.advance, ["repos", index, "advance"]);

      if (slugs.has(repo.slug)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate repo slug "${repo.slug}"`,
          path: ["repos", index, "slug"],
        });
      }
      slugs.add(repo.slug);

      if (repo.stages.includes("build") && repo.gates.length === 0) {
        ctx.addIssue({
          code: "custom",
          message: `repo "${repo.slug}" runs the build stage but declares no gates; build would open PRs nothing verified`,
          path: ["repos", index, "gates"],
        });
      }
      if (repo.stages.includes("revise") && !repo.stages.includes("build")) {
        ctx.addIssue({
          code: "custom",
          message: `repo "${repo.slug}" enables revise without build; there would be no aiswec branch to revise`,
          path: ["repos", index, "stages"],
        });
      }
    });

    const keywords = config.approval_keywords.map((word) => word.trim().toLowerCase());
    if (new Set(keywords).size !== keywords.length) {
      ctx.addIssue({
        code: "custom",
        message: "approval_keywords contains duplicates",
        path: ["approval_keywords"],
      });
    }

    config.dependencies.forEach((edge, index) => {
      if (!slugs.has(edge.first)) {
        ctx.addIssue({
          code: "custom",
          message: `dependency references unknown repo "${edge.first}"`,
          path: ["dependencies", index, "first"],
        });
      }
      if (!slugs.has(edge.then)) {
        ctx.addIssue({
          code: "custom",
          message: `dependency references unknown repo "${edge.then}"`,
          path: ["dependencies", index, "then"],
        });
      }
      if (edge.first === edge.then) {
        ctx.addIssue({
          code: "custom",
          message: `repo "${edge.first}" cannot depend on itself`,
          path: ["dependencies", index],
        });
      }
    });

    const cycle = findDependencyCycle(config.repos.map((repo) => repo.slug), config.dependencies);
    if (cycle) {
      ctx.addIssue({
        code: "custom",
        message: `dependencies form a cycle: ${cycle.join(" -> ")}; there is no merge order`,
        path: ["dependencies"],
      });
    }
  });

export type RawConfig = z.infer<typeof configSchema>;
export type RawRepoConfig = z.infer<typeof repoConfig>;
export type Budget = z.infer<typeof budget>;

export interface DependencyEdge {
  first: string;
  then: string;
}

/** Returns the cycle as a slug path, or null when the graph is acyclic. */
export function findDependencyCycle(
  slugs: readonly string[],
  dependencies: readonly DependencyEdge[],
): string[] | null {
  const adjacency = new Map<string, string[]>();
  for (const name of slugs) adjacency.set(name, []);
  for (const edge of dependencies) {
    if (!adjacency.has(edge.first)) adjacency.set(edge.first, []);
    adjacency.get(edge.first)?.push(edge.then);
  }

  const state = new Map<string, "visiting" | "done">();
  const path: string[] = [];

  const visit = (node: string): string[] | null => {
    const current = state.get(node);
    if (current === "done") return null;
    if (current === "visiting") return [...path.slice(path.indexOf(node)), node];

    state.set(node, "visiting");
    path.push(node);
    for (const next of adjacency.get(node) ?? []) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    path.pop();
    state.set(node, "done");
    return null;
  };

  for (const node of adjacency.keys()) {
    const cycle = visit(node);
    if (cycle) return cycle;
  }
  return null;
}

/** Kahn's algorithm, ties broken by declaration order so output is stable. */
export function topologicalOrder(
  slugs: readonly string[],
  dependencies: readonly DependencyEdge[],
): string[] {
  const indegree = new Map<string, number>(slugs.map((name) => [name, 0]));
  const adjacency = new Map<string, string[]>(slugs.map((name) => [name, []]));

  for (const edge of dependencies) {
    if (!indegree.has(edge.then) || !adjacency.has(edge.first)) continue;
    adjacency.get(edge.first)?.push(edge.then);
    indegree.set(edge.then, (indegree.get(edge.then) ?? 0) + 1);
  }

  const ready = slugs.filter((name) => (indegree.get(name) ?? 0) === 0);
  const order: string[] = [];

  while (ready.length > 0) {
    const node = ready.shift() as string;
    order.push(node);
    for (const next of adjacency.get(node) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) ready.push(next);
    }
  }

  if (order.length !== slugs.length) {
    throw new Error("dependency graph has a cycle; validate the config first");
  }
  return order;
}
