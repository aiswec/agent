import { describe, expect, test } from "bun:test";
import { buildAllowlist, commandPattern, SAFE_CORE_TOOLS } from "../src/generate/allowlist.js";

describe("commandPattern", () => {
  test("keeps the binary and its first non-flag argument", () => {
    expect(commandPattern("bun test")).toBe("Bash(bun test:*)");
    expect(commandPattern("bun run db:test")).toBe("Bash(bun run:*)");
    expect(commandPattern("bunx jest --watchman=false --ci")).toBe("Bash(bunx jest:*)");
  });

  test("stops at the binary when the next token is a flag", () => {
    expect(commandPattern("tsc --noEmit")).toBe("Bash(tsc:*)");
  });

  test("tolerates ragged whitespace", () => {
    expect(commandPattern("  bun   test  ")).toBe("Bash(bun test:*)");
  });

  test("returns null for an empty command", () => {
    expect(commandPattern("   ")).toBeNull();
  });
});

describe("buildAllowlist", () => {
  test("always includes the safe git and gh core", () => {
    const tools = buildAllowlist({ install: "bun install", gates: [] });

    for (const pattern of SAFE_CORE_TOOLS) {
      expect(tools).toContain(pattern);
    }
  });

  test("derives patterns from the install command and the gates", () => {
    const tools = buildAllowlist({
      install: "pnpm install --frozen-lockfile",
      gates: ["pnpm test", "pnpm lint"],
    });

    expect(tools).toContain("Bash(pnpm install:*)");
    expect(tools).toContain("Bash(pnpm test:*)");
    expect(tools).toContain("Bash(pnpm lint:*)");
  });

  test("emits each pattern once", () => {
    const tools = buildAllowlist({
      install: "bun install",
      gates: ["bun test", "bun test --coverage", "git status"],
    });

    expect(new Set(tools).size).toBe(tools.length);
  });

  test("appends extra patterns for repo quirks", () => {
    const tools = buildAllowlist({ install: "bun install", gates: [], extra: ["Bash(make:*)"] });

    expect(tools).toContain("Bash(make:*)");
  });
});
