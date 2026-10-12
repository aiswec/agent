/**
 * `.github/aiswec.yml`: how aiswec behaves in one repository.
 *
 * This is the per-repo runtime file every stage reads before it checks out
 * anything (docs/character.md has the prose). The stages parse it with `yq`
 * and a handful of shell checks; this module is the same contract in
 * TypeScript, for Suite to validate what it writes and to show a repo's
 * effective settings, and for tests to pin the two readers to one shape.
 *
 * `.strict()` throughout, for the same reason as the generator schema: an
 * unknown key is a typo, and dropping it silently would apply a setting the
 * maintainer never wrote. The exception is `RETIRED_KEYS`, keys aiswec used
 * to read: those are dropped without a word, because a file that still
 * carries one was written by an older aiswec, not mistyped.
 *
 * `provider` (2026-09-06) is which API the engine talks to. `anthropic` is
 * the Claude Code subscription the repository's `CLAUDE_CODE_OAUTH_TOKEN`
 * carries, and is the default. `openrouter` points Claude Code's own
 * Anthropic client at OpenRouter's Anthropic-compatible endpoint
 * (`ANTHROPIC_BASE_URL`), authenticated with the repository's
 * `OPENROUTER_API_KEY`, so `model` is an OpenRouter slug and the engine can
 * be DeepSeek, GPT or anything else OpenRouter serves. Two things follow from
 * the gateway rather than from a preference: `effort` is a Claude Code flag
 * with nothing behind it there, and `small_model` exists because Claude Code
 * reaches for its small model on every run and `claude-haiku-4-5-…` is not a
 * slug OpenRouter knows, so the stages point that slot somewhere real.
 *
 * `preview` (2026-09-06) is how a change gets a site of its own: `web.command`
 * is what the build and revise stages run after the engine, on the pushed
 * commit, `web.dir` is what they export into an Actions artifact
 * (`DEFAULT_PREVIEW_DIR` when unset), `web.env` the non-secret values the
 * build reads, `web.storage` whether the served page may keep data in the
 * browser, `access` who may open it, and `phone` publishes each push as an EAS
 * Update. Previews are on when `previewEnabled` says so, which is when a
 * command is set.
 *
 * The phone grew a map beside its `eas` shorthand when the cloud device
 * arrived (2026-09-06): `phone.env` is what `eas update` bakes into the
 * bundle, `phone.device` names who runs the device, and `phone.profile` the
 * `eas.json` profile whose builds are development clients. `phoneSettings`
 * reads either shape and `deviceRefusal` says why a repository gets no
 * device, the rule being that one is refused until the env is named.
 */
import { Document, isCollection, isMap, isNode, parseDocument } from "yaml";
import { z } from "zod";
import { githubLogin, type RepoStage } from "./schema.js";

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

/** Which API the engine talks to. `anthropic` is the tenant's own Claude subscription. */
export const PROVIDERS = ["anthropic", "openrouter"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const DEFAULT_PROVIDER: Provider = "anthropic";

/**
 * What `ANTHROPIC_BASE_URL` becomes under `openrouter`. Claude Code's client
 * appends `/v1/messages` itself, and OpenRouter answers the Anthropic wire
 * format there; the key travels as `x-api-key`, which that endpoint accepts.
 */
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api";

/**
 * The smallest context window an OpenRouter model may have and still run
 * here, in tokens. Decided 2026-09-08 after the first real run: what the
 * gateway reports as used runs well past what the prompt holds (191k for a
 * first call), and Claude Code keeps a session under the window it believes,
 * so a model under a million tokens is a run that dies at its second turn.
 * Suite offers only models at or above it, and the ask step of every stage
 * refuses the rest before anything is posted; `stages.test.ts` holds the
 * shell's literal equal to this.
 */
export const OPENROUTER_MIN_WINDOW = 1_000_000;

/** The repository secret each provider's credential lives in. */
export const PROVIDER_SECRETS: Readonly<Record<Provider, string>> = {
  anthropic: "CLAUDE_CODE_OAUTH_TOKEN",
  openrouter: "OPENROUTER_API_KEY",
};

/**
 * An OpenRouter model slug: `vendor/name`, optionally with one `:variant`
 * (`:free`, `:thinking`, `:nitro`). Kept narrow because the value reaches
 * `--model` as an argument and `$GITHUB_OUTPUT` as a line, so a space or a
 * newline in it would be a second flag or a second output; the stages mirror
 * this pattern in `grep -E`, and `stages.test.ts` holds the two equal.
 */
export const OPENROUTER_MODEL = /^[a-z0-9][a-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*(?::[a-z0-9-]+)?$/;

/** A Claude model id, which is what `--model` takes when the engine talks to Anthropic. */
export const ANTHROPIC_MODEL = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const RUNTIMES = ["bun", "node", "none"] as const;
export type Runtime = (typeof RUNTIMES)[number];

/** Where a web build lands when `preview.web.dir` is unset: what most bundlers write to. */
export const DEFAULT_PREVIEW_DIR = "dist";

export const PREVIEW_ACCESS_MODES = ["repository", "link"] as const;
export type PreviewAccessMode = (typeof PREVIEW_ACCESS_MODES)[number];

/**
 * Keys an older aiswec put in the file and no stage reads any more: `detail`
 * (how much of the technical layer showed, now the reader's own fold),
 * `stages` (per-stage model, effort, turns and minutes; the budgets are
 * hardcoded below and the engine choice is the task's) and `type`
 * (`web | mobile`, guessed by the doctor for an afternoon on 2026-09-07 and
 * written into a tenant's file before it was taken out; the phone switch
 * under `preview` is the one line it stood for). They are read as nothing
 * rather than as a typo, so a file written before this still runs, and
 * `renderSettings` drops them from the file on the next save.
 */
export const RETIRED_KEYS = ["detail", "stages", "type"] as const;

/**
 * What every stage runs with. `model` is the stage default the file's `model`
 * overrides; the turn and minute budgets are not settable at all (a run that
 * needs more is a task that was too big), and `ceiling_min` is the job
 * timeout the stage file declares as a literal, which `timeout_min + 10`
 * must fit. `deep` is the budget a stage gives an effort of xhigh or max,
 * which thinks longer on every turn: refine's alone since 2026-10-11, when
 * facts-a-day-app#39 on Opus 5.5 at max timed out at 20 minutes and then
 * finished its plan in 65 turns of 60.
 */
export const STAGE_DEFAULTS: Readonly<
  Record<
    RepoStage,
    {
      model: string;
      max_turns: number;
      timeout_min: number;
      ceiling_min: number;
      deep?: { max_turns: number; timeout_min: number };
    }
  >
> = {
  refine: {
    model: "claude-sonnet-5",
    max_turns: 60,
    timeout_min: 20,
    ceiling_min: 45,
    deep: { max_turns: 90, timeout_min: 35 },
  },
  build: { model: "claude-opus-5", max_turns: 120, timeout_min: 40, ceiling_min: 75 },
  revise: { model: "claude-opus-5", max_turns: 120, timeout_min: 40, ceiling_min: 75 },
};

export const settingsSchema = z
  .object({
    maintainers: z.array(githubLogin).min(1).optional(),
    provider: z.enum(PROVIDERS).optional(),
    model: z.string().min(1).optional(),
    /** Only under `openrouter`: what Claude Code's small-model slot points at. `model` when unset. */
    small_model: z.string().min(1).optional(),
    effort: z.enum(EFFORTS).optional(),
    advance: z.object({ build: z.enum(["approval", "auto"]).optional() }).strict().optional(),
    runtime: z
      .object({
        setup: z.enum(RUNTIMES).optional(),
        // "1.3.14" is a string, 1.3 is what YAML makes of an unquoted version.
        version: z.union([z.string(), z.number()]).optional(),
        install: z.string().optional(),
      })
      .strict()
      .optional(),
    gates: z.array(z.string().min(1)).optional(),
    reserved_prefixes: z.array(z.string().min(1)).optional(),
    preview: z
      .object({
        web: z
          .object({
            command: z.string().min(1),
            dir: z.string().optional(),
            env: z.record(z.string(), z.string()).optional(),
            storage: z.boolean().optional(),
          })
          .strict()
          .optional(),
        /**
         * The phone. `phone: eas` is the shorthand `phoneSettings` reads as
         * `{ update: eas }`, which is the whole of what the file said until
         * the cloud device arrived and is still what most files say.
         *
         * `env` is what `eas update` bakes into the bundle (`EXPO_PUBLIC_*`
         * reaches the JavaScript), and it is what a device is refused
         * without: a cloud device runs the tenant's real app, so it must not
         * be pointed at a real backend by default. `device` names the vendor,
         * and `profile` the `eas.json` profile whose builds are development
         * clients, since only those open an update by deep link and a
         * simulator build from any other profile would boot the last release
         * instead, silently.
         */
        phone: z
          .union([
            z.literal(false),
            z.literal("eas"),
            z
              .object({
                update: z.literal("eas").optional(),
                env: z.record(z.string(), z.string()).optional(),
                device: z.union([z.literal(false), z.literal("appetize")]).optional(),
                profile: z.string().min(1).optional(),
              })
              .strict(),
          ])
          .optional(),
        access: z.enum(PREVIEW_ACCESS_MODES).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  // Cross-field, and only the two a run could not survive: under `openrouter`
  // the engine has no default model to fall back on (the stage's is a Claude
  // id), and a slug that is not one reaches `--model` as an argument. An
  // `effort` or a `small_model` on the wrong provider is not an error: the
  // stages ignore it with a warning, the way an older key is read as nothing,
  // so switching provider never costs a run over a leftover line.
  .superRefine((value, ctx) => {
    if (value.provider !== "openrouter") return;
    if (value.model === undefined) {
      ctx.addIssue({ code: "custom", path: ["model"], message: "required under provider: openrouter (an OpenRouter slug like deepseek/deepseek-chat)" });
      return;
    }
    for (const key of ["model", "small_model"] as const) {
      const slug = value[key];
      if (slug !== undefined && !OPENROUTER_MODEL.test(slug)) {
        ctx.addIssue({ code: "custom", path: [key], message: `must be an OpenRouter slug like deepseek/deepseek-chat, got '${slug}'` });
      }
    }
  });

export type Settings = z.infer<typeof settingsSchema>;

/** Which API this repository's engine talks to; `anthropic` when the file says nothing. */
export function providerOf(settings: Settings): Provider {
  return settings.provider ?? DEFAULT_PROVIDER;
}

/** Previews are on when a web build command is set; everything else about them has a default. */
export function previewEnabled(settings: Settings): boolean {
  const command = settings.preview?.web?.command;
  return typeof command === "string" && command.trim() !== "";
}

/** The phone's settings, whichever of the two shapes the file uses. */
export interface PhoneSettings {
  /** Whether each push is published as an EAS Update. */
  update: boolean;
  /** What `eas update` bakes into the bundle; a cloud device is refused while it is empty. */
  env: Readonly<Record<string, string>>;
  /** Who runs the cloud device, null when none was asked for. */
  device: "appetize" | null;
  /** The `eas.json` profile whose builds are development clients, null when the file says none. */
  profile: string | null;
}

/**
 * `phone: eas` and `phone: { update: eas, ... }` read the same. The shorthand
 * is what every file said before the cloud device, and it stays valid: a
 * person who never wants a device never grows the key into a map, and
 * `renderSettings` writes back whatever shape Suite hands it.
 */
export function phoneSettings(settings: Settings): PhoneSettings {
  const phone = settings.preview?.phone;
  if (phone === "eas") return { update: true, env: {}, device: null, profile: null };
  if (phone === false || phone === undefined) return { update: false, env: {}, device: null, profile: null };
  return {
    update: phone.update === "eas",
    env: phone.env ?? {},
    device: phone.device === "appetize" ? "appetize" : null,
    profile: phone.profile ?? null,
  };
}

/**
 * Why this repository gets no cloud device, or null when it should get one.
 * `no-env` is the rule the product owner chose on 2026-09-06: a device runs
 * the tenant's real app on a vendor's hardware, so it stays off until the
 * settings name the values the update is built with, rather than pointing a
 * stranger's session at a live backend by default. The stage mirrors this in
 * bash and `stages.test.ts` holds the two equal.
 */
export function deviceRefusal(settings: Settings): "off" | "no-env" | null {
  const phone = phoneSettings(settings);
  if (!phone.update || phone.device === null) return "off";
  if (Object.keys(phone.env).length === 0) return "no-env";
  return null;
}

export interface EffectiveStage {
  stage: RepoStage;
  provider: Provider;
  model: string;
  /** null under `openrouter`: `--effort` is a Claude Code flag with nothing behind it there. */
  effort: Effort | null;
  /** What the small-model slot points at, null under `anthropic`, where Claude Code picks its own. */
  smallModel: string | null;
  /** `ANTHROPIC_BASE_URL`, or null when the engine talks to Anthropic itself. */
  baseUrl: string | null;
  /** The repository secret this run's credential comes from. */
  secret: string;
  maxTurns: number;
  timeoutMin: number;
}

/**
 * What a stage will actually run with: the file's value, then the stage
 * default: the order the stages' `pick` uses. The budgets are the defaults,
 * always: the deep one for an effort of xhigh or max where the stage has one.
 *
 * Under `openrouter` the stage default is not a fallback, since it is a Claude
 * id: the schema requires a model there, so validated settings always carry
 * one. The small-model slot falls back to the model itself rather than to
 * anything cheaper, because the only thing worse than a slow small model is a
 * slug OpenRouter has never heard of.
 */
export function effectiveStage(settings: Settings, stage: RepoStage): EffectiveStage {
  const defaults = STAGE_DEFAULTS[stage];
  const provider = providerOf(settings);
  const openrouter = provider === "openrouter";
  const model = settings.model ?? defaults.model;
  const effort = openrouter ? null : (settings.effort ?? null);
  const budget = (effort === "xhigh" || effort === "max") && defaults.deep ? defaults.deep : defaults;
  return {
    stage,
    provider,
    model,
    effort,
    smallModel: openrouter ? (settings.small_model ?? model) : null,
    baseUrl: openrouter ? OPENROUTER_BASE_URL : null,
    secret: PROVIDER_SECRETS[provider],
    maxTurns: budget.max_turns,
    timeoutMin: budget.timeout_min,
  };
}

export interface SettingsParse {
  settings: Settings | null;
  /** `path: message`, in the shape `parseConfig` reports. Empty when valid. */
  issues: string[];
}

/** Validate an already-parsed YAML document (Suite parses; the stage uses yq). */
export function parseSettings(document: unknown): SettingsParse {
  if (document === null || document === undefined) return { settings: {}, issues: [] };
  if (typeof document !== "object" || Array.isArray(document)) {
    return { settings: null, issues: ["(root): expected a YAML mapping"] };
  }
  const present = { ...(document as Record<string, unknown>) };
  for (const key of RETIRED_KEYS) delete present[key];
  const result = settingsSchema.safeParse(present);
  if (result.success) return { settings: result.data, issues: [] };
  return {
    settings: null,
    issues: result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    }),
  };
}

/** The comment a file Suite creates from nothing opens with. */
const NEW_FILE_HEADER =
  " How aiswec behaves in this repository. Read by every stage when it starts;\n" +
  " a value here wins over the stub's `with:` input. Shape and rules:\n" +
  " docs/character.md in yusufseyrek/aiswec. Edit, push, and the next run picks\n" +
  " it up, with no workflow change needed.";

/** Every leaf the schema knows, in the file's documented order. */
const LEAVES: readonly (readonly string[])[] = [
  ["maintainers"],
  ["provider"],
  ["model"],
  ["small_model"],
  ["effort"],
  ["advance", "build"],
  ["runtime", "setup"],
  ["runtime", "version"],
  ["runtime", "install"],
  ["gates"],
  ["reserved_prefixes"],
  ["preview", "web", "command"],
  ["preview", "web", "dir"],
  ["preview", "web", "env"],
  ["preview", "web", "storage"],
  ["preview", "phone"],
  ["preview", "access"],
];

/** Maps that mean nothing once empty, children before parents. */
const CONTAINERS: readonly (readonly string[])[] = [["advance"], ["runtime"], ["preview", "web"], ["preview", "phone"], ["preview"]];

export interface RenderedSettings {
  text: string;
  /** Empty when the file that would be written is valid. */
  issues: string[];
  /** Top-level keys whose value differs from the file as it was. */
  changed: string[];
}

function leaf(value: unknown, path: readonly string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * The file as it should read after `settings` is applied to `existing`: the
 * current text, or null when the repository has no file yet.
 *
 * The edit is made in place with the yaml Document API rather than by
 * printing `settings` afresh: the maintainer's comments, key order and flow
 * style survive, an unchanged value is not rewritten, and a value `settings`
 * leaves undefined is removed so the stage default applies. The result is
 * validated as the stages and Suite would validate it, so a stray key
 * already in the file is reported instead of being written back silently.
 * The whole document is re-emitted, so flow collections come out in one
 * padding style; `changed` is empty when nothing differs, and a caller
 * should then write nothing.
 */
export function renderSettings(existing: string | null, settings: Settings): RenderedSettings {
  const doc = existing === null ? new Document({}) : parseDocument(existing);
  if (existing === null) doc.commentBefore = NEW_FILE_HEADER;
  if (doc.errors.length > 0) {
    return { text: existing ?? "", issues: [`not valid YAML: ${doc.errors[0]?.message ?? "parse error"}`], changed: [] };
  }
  if (doc.contents === null) doc.contents = doc.createNode({});
  if (!isMap(doc.contents)) return { text: existing ?? "", issues: ["(root): expected a YAML mapping"], changed: [] };
  const before = (doc.toJS() ?? {}) as Record<string, unknown>;

  for (const path of LEAVES) {
    const value = leaf(settings, path);
    if (value === undefined) {
      if (doc.hasIn(path)) doc.deleteIn(path);
      continue;
    }
    const current = doc.getIn(path, true);
    if (isNode(current) && JSON.stringify(current.toJSON()) === JSON.stringify(value)) continue;
    const node = doc.createNode(value);
    if (isNode(current)) {
      if (isCollection(current) && isCollection(node)) node.flow = current.flow;
      node.comment = current.comment;
      node.commentBefore = current.commentBefore;
    }
    doc.setIn(path, node);
  }
  for (const key of RETIRED_KEYS) {
    if (doc.hasIn([key])) doc.deleteIn([key]);
  }
  for (const path of CONTAINERS) {
    const node = doc.getIn(path, true);
    if (isMap(node) && node.items.length === 0 && doc.hasIn(path)) doc.deleteIn(path);
  }

  const after = (doc.toJS() ?? {}) as Record<string, unknown>;
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
  // `[yusufseyrek]`, not `[ yusufseyrek ]`, and a long gate command on one
  // line rather than folded: the file's documented style.
  return { text: doc.toString({ flowCollectionPadding: false, lineWidth: 0 }), issues: parseSettings(after).issues, changed };
}
