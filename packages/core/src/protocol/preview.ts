/**
 * Where a pull request's preview is, carried on GitHub.
 *
 * A tenant's build and revise stages export the change's web output into an
 * Actions artifact, and Suite serves it at one host per pull request. Nothing
 * in Core has a database, so the join between the two, which artifact holds
 * which commit's site, travels on the pull request body itself: a marker line
 * under the `## Preview` section the finalizer writes, in the idiom of the run
 * line (`run.ts`). A JSON payload with every `>` escaped, the last line of its
 * kind wins, a malformed line is absence, and the emitter validates. The
 * engine never writes either: the section is the finalizer's, after the
 * export step, which is why the skeleton omits it.
 *
 * The host name is the other half. A slug is derived from the repository and
 * the pull request number by the same rule in two places, here and as
 * `preview_slug` in the stage files, since the stage computes the URL it
 * writes into the body before Suite has heard of the pull request, and Suite
 * has to answer on the same host. DNS caps a label at 63 characters, so a long
 * repository name is cut, and a hash of the full name keeps two cut names
 * apart. `stages.test.ts` runs the bash against this for a table of names.
 *
 * The phone is the same line's second half (2026-09-06). With `preview.phone:
 * eas` the stage publishes the pull request's JavaScript as an EAS Update on
 * a `pr-<n>` branch, which a person's development build opens from a QR, and
 * the marker carries the group, the runtime, the QR and the group's page.
 * No native build is ever started: `native_touched` says the change reached
 * `ios/`, `android/` or the app config, so the person knows their build may
 * be too old for the update. `no-token` is not a failure: no `EXPO_TOKEN`
 * reached the stage, and the exact command went under Manual todos.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { DEFAULT_NAMESPACE, MARKER_VERSIONS } from "./markers.js";
import { escapeRegExp, splitLines } from "./util.js";

/** The longest a DNS label may be. */
const LABEL_MAX = 63;

/** Lower-cased, every run of anything but a letter or a digit one hyphen, the edges bare. */
function label(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-/, "").replace(/-$/, "");
}

/**
 * `<owner>-<repo>-<n>`, or when that passes 63 characters
 * `<owner>-<repo cut>-<hash>-<n>`, the hash the first six hex characters of
 * the SHA-256 of `owner/repo` lower-cased. Idempotent on a name that is
 * already a label, so a slug read back from a host is the slug.
 */
export function previewSlug(owner: string, repo: string, n: number): string {
  const o = label(owner);
  const r = label(repo);
  const number = String(n);
  const whole = `${o}-${r}-${number}`;
  if (whole.length <= LABEL_MAX) return whole;
  const hash = createHash("sha256").update(`${owner}/${repo}`.toLowerCase()).digest("hex").slice(0, 6);
  const keep = Math.max(0, LABEL_MAX - o.length - hash.length - number.length - 3);
  const cut = r.slice(0, keep).replace(/-+$/, "");
  return `${o}-${cut}-${hash}-${number}`;
}

/** The preview's address: https under a real domain, http on the preview port under localhost. */
export function previewUrl(slug: string, domain: string): string {
  const local = domain === "localhost" || domain.endsWith(".localhost");
  return local ? `http://${slug}.${domain}:4001/` : `https://${slug}.${domain}/`;
}

export const PREVIEW_STATUSES = ["ready", "failed", "off"] as const;
export type PreviewStatus = (typeof PREVIEW_STATUSES)[number];

export const PREVIEW_ACCESS = ["repository", "link"] as const;
export type PreviewAccess = (typeof PREVIEW_ACCESS)[number];

export const PREVIEW_PHONE_STATUSES = ["ready", "failed", "no-token"] as const;
export type PreviewPhoneStatus = (typeof PREVIEW_PHONE_STATUSES)[number];

export const PREVIEW_PLATFORMS = ["ios", "android"] as const;
export type PreviewPlatform = (typeof PREVIEW_PLATFORMS)[number];

/**
 * The phone half: what `eas update` printed, and the two addresses built
 * from it. Not `.strict()`, for the reason the line is not.
 */
export const previewPhoneSchema = z.object({
  status: z.enum(PREVIEW_PHONE_STATUSES),
  /** The EAS Update branch, `pr-<n>`. */
  branch: z.string().nullish(),
  /** The update group id. */
  group: z.string().nullish(),
  /** The runtime version the update was published for. */
  runtime: z.string().nullish(),
  /** The EAS project id. */
  project: z.string().nullish(),
  /**
   * The Expo slug, sanitised to `[A-Za-z0-9+.-]`, which is what opens the
   * update: a development build registers `exp+<slug>`, and `qr.expo.dev`
   * composes that scheme from this. The app's own `scheme` below does not,
   * which is what made every QR written before 2026-09-06 a dead link for an
   * app whose scheme and slug differ.
   */
  slug: z.string().nullish(),
  /** The app's own scheme, sanitised the same way: a second way in, not the QR's. */
  scheme: z.string().nullish(),
  /** The qr.expo.dev image that opens the group in a development build. */
  qr: z.url().nullish(),
  /** The group's page on expo.dev. */
  link: z.url().nullish(),
  /**
   * The deep link that opens this group in a development build, as
   * `qr.expo.dev` itself answers it (`format=url`), so the formula lives with
   * Expo and not in two places here. `z.string()`, not `z.url()`: it is a
   * custom scheme, and a known key with a bad value would take the whole line
   * down with it.
   */
  launch: z.string().nullish(),
  platforms: z.array(z.enum(PREVIEW_PLATFORMS)).nullish(),
});

export type PreviewPhone = z.infer<typeof previewPhoneSchema>;

const PHONE_KEYS = [
  "status",
  "branch",
  "group",
  "runtime",
  "project",
  "slug",
  "scheme",
  "qr",
  "link",
  "launch",
  "platforms",
] as const satisfies readonly (keyof PreviewPhone)[];

/**
 * Why a change has no cloud device, when one was asked for. Absence of the
 * whole half is the ordinary off; these are the four ways an intention fails,
 * and Suite turns each into one sentence on the task rather than an empty
 * frame. `public` is a refusal, not a fault: the shell's address is fetchable
 * by anyone who holds it, so it is never written into a body the world can
 * read, and a bearer build id is never minted for a public repository.
 */
export const PREVIEW_DEVICE_STATUSES = ["ready", "no-shell", "no-env", "public", "failed"] as const;
export type PreviewDeviceStatus = (typeof PREVIEW_DEVICE_STATUSES)[number];

/**
 * The device half (2026-09-06): where the native shell that opens this
 * update lives, so Suite can hand a cloud device the same binary the person
 * would install. The stage never uploads it and Suite never downloads it: the
 * address goes to the vendor, which fetches it itself.
 *
 * `shell` is `z.string()`, not `z.url()`, for the reason `launch` is: a known
 * key with a bad value fails the whole line's parse and would take the web
 * preview and the QR down with it. Suite checks the host before handing it on.
 */
export const previewDeviceSchema = z.object({
  status: z.enum(PREVIEW_DEVICE_STATUSES),
  /** Which shell this is. One platform ships first; the key says which. */
  platform: z.enum(PREVIEW_PLATFORMS).nullish(),
  /** The EAS artifact holding the simulator `.app` or the `.apk`. */
  shell: z.string().nullish(),
  /** The runtime version the shell was built for: an update matches on this. */
  runtime: z.string().nullish(),
  /** The shell's fingerprint, which says whether its native code really fits. */
  fingerprint: z.string().nullish(),
  /** The `eas.json` profile the shell was built from, which is what makes it a development build. */
  profile: z.string().nullish(),
  /** The EAS build id, for a person who wants to see where the shell came from. */
  build: z.string().nullish(),
  /** ISO date: when the artifact address stops answering. */
  expires: z.string().nullish(),
});

export type PreviewDevice = z.infer<typeof previewDeviceSchema>;

const DEVICE_KEYS = [
  "status",
  "platform",
  "shell",
  "runtime",
  "fingerprint",
  "profile",
  "build",
  "expires",
] as const satisfies readonly (keyof PreviewDevice)[];

/**
 * Not `.strict()`, like the run line: a stage that learns to report one more
 * thing must not make its pull requests unreadable to a Suite that has not
 * been deployed yet, so an unknown key is dropped.
 */
export const previewLineSchema = z.object({
  pr: z.number().int().min(1),
  sha: z.string().regex(/^[0-9a-f]{40}$/),
  status: z.enum(PREVIEW_STATUSES),
  /** What the stage computed from its `preview_domain` input. */
  url: z.url().nullish(),
  /** The Actions artifact id. */
  artifact: z.number().int().nullish(),
  /** The Actions run id. */
  run: z.number().int().nullish(),
  /** ISO date: when the artifact expires. */
  expires: z.string().nullish(),
  /** The directory inside the artifact holding the site, `web`. */
  dir: z.string().nullish(),
  access: z.enum(PREVIEW_ACCESS).nullish(),
  storage: z.boolean().nullish(),
  /** The phone preview, absent on a line written before it or by a stage that ran no phone step. */
  phone: previewPhoneSchema.nullish(),
  /** The cloud device, absent unless `preview.phone.device` asked for one. */
  device: previewDeviceSchema.nullish(),
  /** Whether the change touched `ios/`, `android/`, `app.json`, `app.config.*`, `eas.json` or `package.json`. */
  native_touched: z.boolean().nullish(),
});

export type PreviewLine = z.infer<typeof previewLineSchema>;

const PREVIEW_KEYS = [
  "pr",
  "sha",
  "status",
  "url",
  "artifact",
  "run",
  "expires",
  "dir",
  "access",
  "storage",
  "phone",
  "device",
  "native_touched",
] as const satisfies readonly (keyof PreviewLine)[];

/**
 * Matches one preview line and captures its JSON: line-anchored, pinned to the
 * version this parser understands, and `[^>]*` as `markerLinePattern` imposes,
 * which is why the payload escapes its own `>`.
 */
export function previewMarkerPattern(namespace: string = DEFAULT_NAMESPACE): RegExp {
  return new RegExp(
    `^<!--\\s*${escapeRegExp(namespace)}-preview:v${MARKER_VERSIONS.preview}\\s+(\\{[^>]*\\})\\s*-->$`,
  );
}

/** The members that carry something, in the given order: a null is written as absence. */
function present<T extends object>(value: T, keys: readonly (keyof T)[]): T {
  const out: Partial<T> = {};
  for (const key of keys) {
    const member = value[key];
    if (member === null || member === undefined) continue;
    out[key] = member;
  }
  return out as T;
}

/** The line in the contract's order, each half compacted the same way inside it. */
function compact(value: PreviewLine): PreviewLine {
  const out = present(value, PREVIEW_KEYS);
  if (out.phone) out.phone = present(out.phone, PHONE_KEYS);
  if (out.device) out.device = present(out.device, DEVICE_KEYS);
  return out;
}

export function previewLine(value: PreviewLine, namespace: string = DEFAULT_NAMESPACE): string {
  // `>` can only occur inside a JSON string, where `>` means the same
  // character, so escaping it here cannot change what parses back.
  const json = JSON.stringify(compact(previewLineSchema.parse(value))).replace(/>/g, "\\u003e");
  return `<!-- ${namespace}-preview:v${MARKER_VERSIONS.preview} ${json} -->`;
}

/**
 * The last preview line in the body, or null: an earlier line describes an
 * earlier push, and a last line that does not read is the answer.
 */
export function parsePreviewLine(body: string, namespace: string = DEFAULT_NAMESPACE): PreviewLine | null {
  const pattern = previewMarkerPattern(namespace);
  const lines = splitLines(typeof body === "string" ? body : "");
  for (let index = lines.length - 1; index >= 0; index--) {
    const match = pattern.exec((lines[index] ?? "").trim());
    if (!match) continue;
    const json = match[1];
    if (json === undefined) return null;
    let payload: unknown;
    try {
      payload = JSON.parse(json);
    } catch {
      return null;
    }
    const parsed = previewLineSchema.safeParse(payload);
    return parsed.success ? compact(parsed.data) : null;
  }
  return null;
}
