import { describe, expect, test } from "bun:test";
import { parse as parseYaml } from "yaml";
import { DEFAULT_PREVIEW_DIR, deviceRefusal, effectiveStage, OPENROUTER_BASE_URL, OPENROUTER_MODEL, parseSettings, phoneSettings, previewEnabled, providerOf, renderSettings, STAGE_DEFAULTS } from "../src/config/settings.js";

const FILE = `
maintainers: [yusufseyrek]
model: claude-opus-5
effort: high
advance:
  build: approval
runtime:
  setup: bun
  version: "1.3.14"
  install: bun install --frozen-lockfile
gates:
  - bun test
  - bun run typecheck
reserved_prefixes: ["/deploy"]
`;

describe("parseSettings", () => {
  test("accepts the documented file", () => {
    const { settings, issues } = parseSettings(parseYaml(FILE));
    expect(issues).toEqual([]);
    expect(settings?.maintainers).toEqual(["yusufseyrek"]);
    expect(settings?.gates).toEqual(["bun test", "bun run typecheck"]);
  });

  test("an empty file is valid and means the stage defaults", () => {
    expect(parseSettings(null)).toEqual({ settings: {}, issues: [] });
    expect(parseSettings(parseYaml(""))).toEqual({ settings: {}, issues: [] });
  });

  test("rejects an unknown key instead of dropping it", () => {
    const { settings, issues } = parseSettings(parseYaml("modle: claude-opus-5"));
    expect(settings).toBeNull();
    expect(issues.join("\n")).toContain("modle");
  });

  test("rejects an effort outside the CLI's set", () => {
    const { issues } = parseSettings(parseYaml("effort: extreme"));
    expect(issues[0]).toMatch(/^effort: /);
  });

  test("a retired key is read as nothing, not as a typo", () => {
    const { settings, issues } = parseSettings(parseYaml("detail: full\nstages: { refine: { timeout_min: 20 } }\ntype: mobile\nmodel: claude-opus-5"));
    expect(issues).toEqual([]);
    expect(settings).toEqual({ model: "claude-opus-5" });
  });

  test("rejects a login that is not a GitHub login", () => {
    const { issues } = parseSettings(parseYaml('maintainers: ["a\\"b"]'));
    expect(issues[0]).toMatch(/^maintainers\.0: /);
  });

  test("accepts the preview block, and every part of it is optional but the command", () => {
    const { settings, issues } = parseSettings(
      parseYaml('preview:\n  web:\n    command: bun run build\n    dir: out\n    env: { API_URL: https://staging.example.com, FLAG: "1" }\n    storage: true\n  phone: eas\n  access: link\n'),
    );
    expect(issues).toEqual([]);
    expect(settings?.preview).toEqual({
      web: { command: "bun run build", dir: "out", env: { API_URL: "https://staging.example.com", FLAG: "1" }, storage: true },
      phone: "eas",
      access: "link",
    });
    // A value is a string: the stage's yq stringifies a bare number, Suite asks for the quotes.
    expect(parseSettings(parseYaml("preview:\n  web:\n    command: x\n    env: { PORT: 3000 }\n")).issues[0]).toMatch(/^preview\.web\.env\.PORT: /);
    expect(parseSettings(parseYaml("preview:\n  web:\n    command: bun run build\n")).issues).toEqual([]);
    expect(parseSettings(parseYaml("preview:\n  phone: false\n")).settings?.preview).toEqual({ phone: false });
    expect(parseSettings(parseYaml("preview:\n  web:\n    dir: dist\n")).issues[0]).toMatch(/^preview\.web\.command: /);
  });

  test("rejects an unknown key under preview, and a value outside its set", () => {
    expect(parseSettings(parseYaml("preview:\n  web:\n    command: x\n    directory: dist\n")).issues.join("\n")).toContain("directory");
    expect(parseSettings(parseYaml("preview:\n  webb: {}\n")).issues.join("\n")).toContain("webb");
    expect(parseSettings(parseYaml("preview:\n  access: everyone\n")).issues[0]).toMatch(/^preview\.access: /);
    expect(parseSettings(parseYaml("preview:\n  phone: ios\n")).issues[0]).toMatch(/^preview\.phone: /);
  });
});

describe("previewEnabled", () => {
  test("on when a command is set, off otherwise", () => {
    expect(previewEnabled({})).toBe(false);
    expect(previewEnabled({ preview: {} })).toBe(false);
    expect(previewEnabled({ preview: { access: "link" } })).toBe(false);
    expect(previewEnabled({ preview: { web: { command: "bun run build" } } })).toBe(true);
    expect(previewEnabled({ preview: { web: { command: "   " } } })).toBe(false);
    expect(DEFAULT_PREVIEW_DIR).toBe("dist");
  });
});

describe("the phone and its device (2026-09-06)", () => {
  test("`phone: eas` and the map read the same", () => {
    expect(phoneSettings({})).toEqual({ update: false, env: {}, device: null, profile: null });
    expect(phoneSettings({ preview: { phone: false } })).toEqual({ update: false, env: {}, device: null, profile: null });
    expect(phoneSettings({ preview: { phone: "eas" } })).toEqual({ update: true, env: {}, device: null, profile: null });
    expect(phoneSettings({ preview: { phone: { update: "eas" } } })).toEqual({ update: true, env: {}, device: null, profile: null });
    expect(
      phoneSettings({ preview: { phone: { update: "eas", env: { EXPO_PUBLIC_API: "https://staging.example.com" }, device: "appetize", profile: "preview-sim" } } }),
    ).toEqual({ update: true, env: { EXPO_PUBLIC_API: "https://staging.example.com" }, device: "appetize", profile: "preview-sim" });
  });

  test("a device is refused until the update's environment is named", () => {
    const env = { EXPO_PUBLIC_API: "https://staging.example.com" };
    expect(deviceRefusal({})).toBe("off");
    expect(deviceRefusal({ preview: { phone: "eas" } })).toBe("off");
    // The vendor named but no update published: nothing for a device to open.
    expect(deviceRefusal({ preview: { phone: { device: "appetize", env } } })).toBe("off");
    expect(deviceRefusal({ preview: { phone: { update: "eas", device: false, env } } })).toBe("off");
    // The rule of 2026-09-06: a real app on a vendor's hardware waits for an
    // environment of its own rather than reaching a live backend by default.
    expect(deviceRefusal({ preview: { phone: { update: "eas", device: "appetize" } } })).toBe("no-env");
    expect(deviceRefusal({ preview: { phone: { update: "eas", device: "appetize", env: {} } } })).toBe("no-env");
    expect(deviceRefusal({ preview: { phone: { update: "eas", device: "appetize", env } } })).toBeNull();
  });

  test("the map's unknown key is a typo, and the shorthand is still valid", () => {
    const read = (yaml: string): string[] => parseSettings(parseYaml(yaml)).issues;
    expect(read("preview:\n  phone: eas\n")).toEqual([]);
    expect(read("preview:\n  phone:\n    update: eas\n    device: appetize\n")).toEqual([]);
    expect(read("preview:\n  phone:\n    devise: appetize\n").length).toBeGreaterThan(0);
    expect(read("preview:\n  phone: expo\n").length).toBeGreaterThan(0);
  });
});

describe("effectiveStage", () => {
  const { settings } = parseSettings(parseYaml(FILE));

  test("the file's value beats the stage default; the budgets are the default, always", () => {
    expect(effectiveStage(settings!, "refine")).toEqual({
      stage: "refine",
      provider: "anthropic",
      model: "claude-opus-5",
      effort: "high",
      smallModel: null,
      baseUrl: null,
      secret: "CLAUDE_CODE_OAUTH_TOKEN",
      maxTurns: STAGE_DEFAULTS.refine.max_turns,
      timeoutMin: STAGE_DEFAULTS.refine.timeout_min,
    });
    expect(effectiveStage(settings!, "revise")).toEqual({
      stage: "revise",
      provider: "anthropic",
      model: "claude-opus-5",
      effort: "high",
      smallModel: null,
      baseUrl: null,
      secret: "CLAUDE_CODE_OAUTH_TOKEN",
      maxTurns: STAGE_DEFAULTS.revise.max_turns,
      timeoutMin: STAGE_DEFAULTS.revise.timeout_min,
    });
  });

  test("an empty file is the defaults with no effort", () => {
    expect(effectiveStage({}, "build")).toEqual({
      stage: "build",
      provider: "anthropic",
      model: "claude-opus-5",
      effort: null,
      smallModel: null,
      baseUrl: null,
      secret: "CLAUDE_CODE_OAUTH_TOKEN",
      maxTurns: 120,
      timeoutMin: 40,
    });
  });

  test("refine at xhigh or max plans on the deep budget; build and revise keep theirs", () => {
    for (const effort of ["xhigh", "max"] as const) {
      expect(effectiveStage({ effort }, "refine")).toMatchObject({ maxTurns: 90, timeoutMin: 35 });
      expect(effectiveStage({ effort }, "build")).toMatchObject({ maxTurns: 120, timeoutMin: 40 });
    }
    expect(effectiveStage({ effort: "high" }, "refine")).toMatchObject({ maxTurns: 60, timeoutMin: 20 });
    // Under a gateway the effort is dropped, and the budget with it.
    expect(effectiveStage({ provider: "openrouter", model: "deepseek/deepseek-chat", effort: "max" }, "refine")).toMatchObject({ maxTurns: 60, timeoutMin: 20 });
  });

  test("openrouter carries the gateway, and the small slot falls back to the model", () => {
    expect(effectiveStage({ provider: "openrouter", model: "deepseek/deepseek-chat" }, "build")).toMatchObject({
      provider: "openrouter",
      model: "deepseek/deepseek-chat",
      smallModel: "deepseek/deepseek-chat",
      baseUrl: OPENROUTER_BASE_URL,
      secret: "OPENROUTER_API_KEY",
    });
    expect(effectiveStage({ provider: "openrouter", model: "openai/gpt-5.1", small_model: "openai/gpt-5-nano" }, "refine").smallModel).toBe("openai/gpt-5-nano");
  });

  test("an effort left over from the Claude subscription does not reach an OpenRouter run", () => {
    expect(effectiveStage({ provider: "openrouter", model: "z-ai/glm-4.7", effort: "max" }, "build").effort).toBeNull();
  });
});

describe("provider", () => {
  test("the default is the tenant's own Claude subscription", () => {
    expect(providerOf({})).toBe("anthropic");
    expect(providerOf({ provider: "openrouter", model: "deepseek/deepseek-chat" })).toBe("openrouter");
  });

  test("openrouter needs a model, and it has to be a slug", () => {
    expect(parseSettings({ provider: "openrouter" }).issues).toEqual([
      "model: required under provider: openrouter (an OpenRouter slug like deepseek/deepseek-chat)",
    ]);
    expect(parseSettings({ provider: "openrouter", model: "claude-opus-5" }).issues[0]).toContain("must be an OpenRouter slug");
    expect(parseSettings({ provider: "openrouter", model: "deepseek/deepseek chat" }).issues).toHaveLength(1);
    expect(parseSettings({ provider: "openrouter", model: "deepseek/deepseek-chat", small_model: "nope" }).issues[0]).toContain("small_model");
  });

  test("the slugs OpenRouter actually serves parse, and a shell argument does not", () => {
    for (const slug of ["deepseek/deepseek-chat", "openai/gpt-5.1-codex", "z-ai/glm-4.7", "x-ai/grok-4.6", "qwen/qwen3-coder", "moonshotai/kimi-k2-0905", "anthropic/claude-opus-5", "meta-llama/llama-4-maverick:free"]) {
      expect(OPENROUTER_MODEL.test(slug)).toBe(true);
    }
    for (const bad of ["deepseek", "/deepseek-chat", "deepseek/", "a b/c", "a/b;rm -rf", "a/b\nc", "--dangerous/x"]) {
      expect(OPENROUTER_MODEL.test(bad)).toBe(false);
    }
  });

  test("a model under the Claude subscription is unchanged, and effort still counts", () => {
    const { settings, issues } = parseSettings({ model: "claude-opus-5", effort: "max" });
    expect(issues).toEqual([]);
    expect(effectiveStage(settings!, "build")).toMatchObject({ provider: "anthropic", model: "claude-opus-5", effort: "max" });
  });
});

describe("renderSettings", () => {
  const existing = [
    "# How aiswec behaves here.",
    "maintainers: [yusufseyrek] # who may ask",
    "model: claude-opus-5",
    "effort: high # or medium",
    "gates:",
    "  - bun test",
    "",
  ].join("\n");

  test("edits in place: comments, order and flow style survive, a cleared value goes, an empty map goes with it", () => {
    const { text, issues, changed } = renderSettings(existing, {
      maintainers: ["yusufseyrek"],
      model: "claude-opus-5",
      effort: "medium",
      advance: { build: "auto" },
      gates: ["bun test", "bun run typecheck"],
    });
    expect(issues).toEqual([]);
    expect(changed.sort()).toEqual(["advance", "effort", "gates"]);
    expect(text).toBe(
      [
        "# How aiswec behaves here.",
        "maintainers: [yusufseyrek] # who may ask",
        "model: claude-opus-5",
        "effort: medium # or medium",
        "gates:",
        "  - bun test",
        "  - bun run typecheck",
        "advance:",
        "  build: auto",
        "",
      ].join("\n"),
    );
  });

  test("an unchanged file reports no change (the caller then writes nothing)", () => {
    const { text, changed, issues } = renderSettings(existing, parseSettings(parseYaml(existing)).settings!);
    expect(changed).toEqual([]);
    expect(issues).toEqual([]);
    expect(parseSettings(parseYaml(text)).settings).toEqual(parseSettings(parseYaml(existing)).settings);
  });

  test("a retired key is dropped from the file on the next save", () => {
    const stale = ["maintainers: [ada]", "detail: full", "stages:", "  refine: { effort: medium }", "type: mobile", ""].join("\n");
    const { text, changed, issues } = renderSettings(stale, { maintainers: ["ada"] });
    expect(issues).toEqual([]);
    expect(changed.sort()).toEqual(["detail", "stages", "type"]);
    expect(text).toBe("maintainers: [ada]\n");
  });

  test("a new file opens with the header and holds only what was set", () => {
    const { text, issues, changed } = renderSettings(null, { maintainers: ["ada"], effort: "high", gates: ["npm test"] });
    expect(issues).toEqual([]);
    expect(changed.sort()).toEqual(["effort", "gates", "maintainers"]);
    expect(text.startsWith("# How aiswec behaves in this repository.")).toBe(true);
    expect(parseSettings(parseYaml(text)).settings).toEqual({ maintainers: ["ada"], effort: "high", gates: ["npm test"] });
  });

  test("a stray key already in the file is reported, not written back silently", () => {
    const { issues } = renderSettings("modle: x\n", { model: "y" });
    expect(issues.join("\n")).toContain("modle");
  });

  test("a value the stages would refuse is reported", () => {
    const { issues } = renderSettings(existing, { effort: "extreme" as never });
    expect(issues.join("\n")).toContain("effort");
  });

  describe("the preview block", () => {
    const withPreview = [
      "maintainers: [ada]",
      "# What a change is previewed with.",
      "preview:",
      "  web:",
      "    command: bun run build # the site",
      "    dir: dist",
      "  access: repository",
      "",
    ].join("\n");

    test("is rendered in place, comments kept", () => {
      const { text, issues, changed } = renderSettings(withPreview, {
        maintainers: ["ada"],
        preview: { web: { command: "npx expo export --platform web", dir: "dist", env: { API_URL: "https://staging.example.com" }, storage: true }, access: "link" },
      });
      expect(issues).toEqual([]);
      expect(changed).toEqual(["preview"]);
      expect(text).toBe(
        [
          "maintainers: [ada]",
          "# What a change is previewed with.",
          "preview:",
          "  web:",
          "    command: npx expo export --platform web # the site",
          "    dir: dist",
          "    env:",
          "      API_URL: https://staging.example.com",
          "    storage: true",
          "  access: link",
          "",
        ].join("\n"),
      );
    });

    test("goes whole when undefined, the empty maps with it", () => {
      const { text, issues, changed } = renderSettings(withPreview, { maintainers: ["ada"] });
      expect(issues).toEqual([]);
      expect(changed).toEqual(["preview"]);
      expect(text).toBe("maintainers: [ada]\n");
      const partial = renderSettings(withPreview, { maintainers: ["ada"], preview: { access: "link" } });
      expect(partial.text).toBe(["maintainers: [ada]", "# What a change is previewed with.", "preview:", "  access: link", ""].join("\n"));
    });

    test("writes it into a new file after everything else", () => {
      const { text, issues } = renderSettings(null, { maintainers: ["ada"], gates: ["bun test"], preview: { web: { command: "bun run build" } } });
      expect(issues).toEqual([]);
      expect(text.endsWith("gates:\n  - bun test\npreview:\n  web:\n    command: bun run build\n")).toBe(true);
      expect(previewEnabled(parseSettings(parseYaml(text)).settings!)).toBe(true);
    });

    test("an unknown key already under preview is reported, not written back silently", () => {
      const { issues } = renderSettings("preview:\n  web:\n    command: x\n    folder: dist\n", { preview: { web: { command: "x" } } });
      expect(issues.join("\n")).toContain("folder");
    });
  });
});
