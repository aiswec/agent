import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import { loadConfigFile } from "../src/config/load.js";
import { configSchema, findDependencyCycle, topologicalOrder } from "../src/config/schema.js";
import { resolveConfig } from "../src/config/resolve.js";

const EXAMPLE = fileURLToPath(new URL("../../../examples/facts-a-day.yml", import.meta.url));

function base(): Record<string, unknown> {
  return {
    product_name: "demo",
    maintainers: ["alice"],
    hub: { repo: "acme/hub", budgets: { route: { turns: 80, step_min: 25 } } },
    models: { route: "m", refine: "m", build: "m", revise: "m" },
    budgets: {
      refine: { turns: 40, step_min: 15 },
      build: { turns: 120, step_min: 40 },
      revise: { turns: 120, step_min: 40 },
    },
    repos: [
      {
        slug: "backend",
        name: "acme/backend",
        stages: ["refine", "build"],
        areas: "api",
        runtime: { install: "bun install" },
        gates: ["bun test"],
      },
    ],
  };
}

function parse(overrides: Record<string, unknown> = {}) {
  return configSchema.safeParse({ ...base(), ...overrides });
}

function messages(result: ReturnType<typeof parse>): string {
  return result.success ? "" : result.error.issues.map((issue) => issue.message).join(" | ");
}

describe("the example config", () => {
  test("loads and resolves", () => {
    const config = loadConfigFile(EXAMPLE);

    expect(config.productName).toBe("facts-a-day");
    expect(config.repos.map((repo) => repo.slug)).toEqual(["backend", "app"]);
  });

  test("derives every job timeout as the step timeout plus ten minutes", () => {
    const config = loadConfigFile(EXAMPLE);
    const stages = [config.hub.route, ...config.repos.flatMap((repo) => repo.stages)];

    for (const stage of stages) {
      expect(stage.jobMinutes).toBe(stage.stepMinutes + 10);
    }
  });

  test("applies the per-repo build budget override", () => {
    const config = loadConfigFile(EXAMPLE);
    const backend = config.repos.find((repo) => repo.slug === "backend");
    const app = config.repos.find((repo) => repo.slug === "app");

    expect(backend?.stages.find((stage) => stage.stage === "build")?.stepMinutes).toBe(55);
    expect(app?.stages.find((stage) => stage.stage === "build")?.stepMinutes).toBe(40);
  });

  test("gives the backend a revise stage the source repo never had", () => {
    const config = loadConfigFile(EXAMPLE);
    const backend = config.repos.find((repo) => repo.slug === "backend");

    expect(backend?.stages.map((stage) => stage.stage)).toContain("revise");
  });

  test("generates the merge-order sentence from the dependency graph", () => {
    const config = loadConfigFile(EXAMPLE);

    expect(config.mergeOrder).toEqual(["backend", "app"]);
    expect(config.mergeOrderSentence).toBe("Merge order: backend first, then app.");
  });

  test("leaves the deploy-sensitive repo waiting and lets the app repo chain", () => {
    const config = loadConfigFile(EXAMPLE);
    const modeFor = (slug: string, name: string) =>
      config.repos
        .find((repo) => repo.slug === slug)
        ?.stages.find((stage) => stage.stage === name)?.advance;

    expect(modeFor("backend", "build")).toBe("approval");
    expect(modeFor("app", "build")).toBe("auto");
    expect(modeFor("backend", "refine")).toBe("auto");
    expect(modeFor("app", "revise")).toBe("auto");
  });

  test("generates a Bash allowlist covering the declared gates", () => {
    const config = loadConfigFile(EXAMPLE);
    const backend = config.repos.find((repo) => repo.slug === "backend");

    expect(backend?.allowedTools).toContain("Bash(bun run:*)");
    expect(backend?.allowedTools).toContain("Bash(bun test:*)");
    expect(backend?.allowedTools).toContain("Bash(bun tsc:*)");
    expect(backend?.allowedTools).toContain("Bash(git push:*)");
  });
});

describe("validation", () => {
  test("accepts the minimal config", () => {
    expect(parse().success).toBe(true);
  });

  test("supplies the default approval keywords, namespace and branch prefix", () => {
    const result = parse();
    if (!result.success) throw new Error(messages(result));

    expect(result.data.branch_prefix).toBe("aiswec");
    expect(result.data.namespace).toBe("aiswec");
    expect(result.data.approval_keywords).toContain("approve");
  });

  test("rejects duplicate repo slugs", () => {
    const repo = (base().repos as unknown[])[0];
    const result = parse({ repos: [repo, repo] });

    expect(messages(result)).toContain("duplicate repo slug");
  });

  test("rejects a build stage with no gates", () => {
    const result = parse({
      repos: [{ ...(base().repos as Record<string, unknown>[])[0], gates: [] }],
    });

    expect(messages(result)).toContain("declares no gates");
  });

  test("rejects revise without build", () => {
    const result = parse({
      repos: [
        { ...(base().repos as Record<string, unknown>[])[0], stages: ["refine", "revise"] },
      ],
    });

    expect(messages(result)).toContain("revise without build");
  });

  test("rejects a dependency on an unknown repo", () => {
    const result = parse({ dependencies: [{ first: "backend", then: "mobile" }] });

    expect(messages(result)).toContain('unknown repo "mobile"');
  });

  test("rejects a self-dependency", () => {
    const result = parse({ dependencies: [{ first: "backend", then: "backend" }] });

    expect(messages(result)).toContain("cannot depend on itself");
  });

  test("rejects a dependency cycle", () => {
    const backend = (base().repos as Record<string, unknown>[])[0];
    const result = parse({
      repos: [backend, { ...backend, slug: "app", name: "acme/app" }],
      dependencies: [
        { first: "backend", then: "app" },
        { first: "app", then: "backend" },
      ],
    });

    expect(messages(result)).toContain("cycle");
  });

  test("rejects a repo name that is not owner/repo", () => {
    const result = parse({
      repos: [{ ...(base().repos as Record<string, unknown>[])[0], name: "backend" }],
    });

    expect(messages(result)).toContain("owner/repo");
  });

  test("rejects duplicate approval keywords", () => {
    const result = parse({ approval_keywords: ["approve", "Approve"] });

    expect(messages(result)).toContain("duplicates");
  });

  test("rejects a maintainer login that could break out of a generated expression", () => {
    const result = parse({ maintainers: ["alice', github.actor) || contains('"] });

    expect(messages(result)).toContain("GitHub login");
  });

  test("rejects an unknown top-level key", () => {
    // A `path:` key used to validate clean and vanish, so the typo never
    // reached the maintainer.
    const result = parse({ path: "x" });

    expect(result.success).toBe(false);
    expect(messages(result)).toContain("path");
  });

  test("rejects an unknown key on a repo", () => {
    const result = parse({
      repos: [{ ...(base().repos as Record<string, unknown>[])[0], policy_fragments: [] }],
    });

    expect(result.success).toBe(false);
    expect(messages(result)).toContain("policy_fragments");
  });

  test("rejects an unknown key under hub", () => {
    const result = parse({
      hub: { ...(base().hub as Record<string, unknown>), region: "eu" },
    });

    expect(result.success).toBe(false);
    expect(messages(result)).toContain("region");
  });

  test("rejects an unknown key under models", () => {
    const result = parse({ models: { ...(base().models as object), smoke: "m" } });

    expect(messages(result)).toContain("smoke");
  });

  test("rejects an unknown key under budgets", () => {
    // route belongs under hub.budgets; putting it here used to be a no-op.
    const result = parse({
      budgets: { ...(base().budgets as object), route: { turns: 80, step_min: 25 } },
    });

    expect(messages(result)).toContain("route");
  });

  test("rejects an unknown key under a repo runtime", () => {
    const result = parse({
      repos: [
        {
          ...(base().repos as Record<string, unknown>[])[0],
          runtime: { install: "bun install", node_version: "22" },
        },
      ],
    });

    expect(messages(result)).toContain("node_version");
  });

  test("rejects an unknown key on a dependency edge", () => {
    const backend = (base().repos as Record<string, unknown>[])[0];
    const result = parse({
      repos: [backend, { ...backend, slug: "app", name: "acme/app" }],
      dependencies: [{ first: "backend", then: "app", blocking: true }],
    });

    expect(result.success).toBe(false);
    expect(messages(result)).toContain("blocking");
  });

  test("accepts arbitrary keys inside runtime.setup entries", () => {
    // A setup entry is a passthrough Actions step: no fixed key set by design.
    const result = parse({
      repos: [
        {
          ...(base().repos as Record<string, unknown>[])[0],
          runtime: {
            install: "bun install",
            setup: [{ uses: "oven-sh/setup-bun@v2", with: { "bun-version": "1.3.14" } }],
          },
        },
      ],
    });

    if (!result.success) throw new Error(messages(result));
    expect(result.success).toBe(true);
  });

  test("rejects a zero-turn budget", () => {
    const result = parse({
      budgets: {
        refine: { turns: 0, step_min: 15 },
        build: { turns: 120, step_min: 40 },
        revise: { turns: 120, step_min: 40 },
      },
    });

    expect(result.success).toBe(false);
  });
});

describe("advancement policy", () => {
  function resolved(overrides: Record<string, unknown> = {}) {
    const result = parse(overrides);
    if (!result.success) throw new Error(messages(result));
    return resolveConfig(result.data);
  }

  function stageMode(config: ReturnType<typeof resolved>, stage: string) {
    return config.repos[0]?.stages.find((entry) => entry.stage === stage)?.advance;
  }

  test("waits for approval before build when nothing is declared", () => {
    // The whole point: the safe pipeline is the one you get by saying nothing.
    const config = resolved();

    expect(stageMode(config, "build")).toBe("approval");
    expect(stageMode(config, "refine")).toBe("auto");
    expect(config.advance).toEqual({ refine: "auto", build: "approval", revise: "auto" });
  });

  test("applies a pipeline-wide setting to every repo", () => {
    const config = resolved({ advance: { build: "auto" } });

    expect(stageMode(config, "build")).toBe("auto");
    expect(stageMode(config, "refine")).toBe("auto");
  });

  test("lets a repo override the pipeline-wide setting", () => {
    const repo = (base().repos as Record<string, unknown>[])[0];
    const config = resolved({
      advance: { build: "auto" },
      repos: [{ ...repo, advance: { build: "approval" } }],
    });

    expect(stageMode(config, "build")).toBe("approval");
    expect(config.advance.build).toBe("auto");
  });

  test("keeps the hub's route stage engine-owned", () => {
    expect(resolved({ advance: { refine: "manual" } }).hub.route.advance).toBe("auto");
  });

  test("rejects approval on a stage with nothing to approve", () => {
    expect(messages(parse({ advance: { refine: "approval" } }))).toContain(
      'advance.refine cannot be "approval"',
    );
    expect(messages(parse({ advance: { revise: "approval" } }))).toContain("Use \"manual\"");
  });

  test("rejects approval on a stage with nothing to approve, per repo too", () => {
    const repo = (base().repos as Record<string, unknown>[])[0];
    const result = parse({ repos: [{ ...repo, advance: { refine: "approval" } }] });

    expect(messages(result)).toContain('advance.refine cannot be "approval"');
  });

  test("rejects an unknown mode", () => {
    expect(parse({ advance: { build: "sometimes" } }).success).toBe(false);
  });

  // Pinned in full, not by substring. The footer is the only thing telling a
  // maintainer what their options are, and every clause in it is a promise
  // some emitted workflow trigger has to keep: an earlier draft said a reply
  // "is treated as feedback and revises the spec", which is true on the hub
  // (route subscribes to issue_comment) and false for a repo (refine does
  // not). Changing this string should mean re-checking the triggers.
  test("writes a release sentence that names only paths the pipeline can serve", () => {
    const config = resolved({ approval_keywords: ["approve", "lgtm"], namespace: "robo" });

    expect(config.readyToBuildLabel).toBe("robo:ready-to-build");
    expect(config.specApprovalFooter).toBe(
      'Reply with "approve" (or "lgtm") to build this spec, or apply the `robo:ready-to-build` ' +
        "label. Any other reply is not read by the pipeline: re-run `robo-refine.yml` on this " +
        "issue to fold your feedback into a new spec. Conditions written after the keyword are " +
        "not read either: an approval builds the spec exactly as posted.",
    );
    expect(config.specApprovalFooter).not.toContain("treated as feedback");
  });
});

describe("dependency graph", () => {
  test("finds a cycle", () => {
    expect(
      findDependencyCycle(["a", "b"], [{ first: "a", then: "b" }, { first: "b", then: "a" }]),
    ).not.toBeNull();
  });

  test("accepts a chain", () => {
    expect(
      findDependencyCycle(["a", "b", "c"], [{ first: "a", then: "b" }, { first: "b", then: "c" }]),
    ).toBeNull();
  });

  test("orders a chain", () => {
    expect(
      topologicalOrder(["c", "a", "b"], [{ first: "a", then: "b" }, { first: "b", then: "c" }]),
    ).toEqual(["a", "b", "c"]);
  });
});

describe("merge-order text", () => {
  test("is omitted entirely when no dependencies are declared", () => {
    // The source system prints "Merge order: backend first, then app." even on
    // single-repo plans (§9.7). Generating it from the graph removes the lie.
    const result = parse();
    if (!result.success) throw new Error(messages(result));
    const config = resolveConfig(result.data);

    expect(config.mergeOrder).toBeNull();
    expect(config.mergeOrderSentence).toBeNull();
  });
});
