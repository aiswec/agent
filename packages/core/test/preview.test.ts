/**
 * The slug is computed twice, here and in bash in the stage files, and the
 * marker line is written by a finalizer and read by Suite, so both are pinned
 * to their rule: the 63-character cut, idempotence, the escape the marker
 * pattern needs, and a last line that does not read being the answer.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { marker, markerLinePattern, stripMarkerLines } from "../src/protocol/markers.js";
import {
  PREVIEW_PHONE_STATUSES,
  parsePreviewLine,
  previewLine,
  previewSlug,
  previewUrl,
  type PreviewDevice,
  type PreviewLine,
  type PreviewPhone,
} from "../src/protocol/preview.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const PROJECT = "8b3c5d7e-9f0a-4b1c-8d2e-3f4a5b6c7d8e";
const GROUP = "0c3f1a2b-7d4e-4f6a-9b8c-1d2e3f4a5b6c";

const PHONE: PreviewPhone = {
  status: "ready",
  branch: "pr-31",
  group: GROUP,
  runtime: "1.0.0",
  project: PROJECT,
  slug: "facts-a-day-app",
  scheme: "factsaday",
  qr: `https://qr.expo.dev/eas-update?slug=facts-a-day-app&projectId=${PROJECT}&groupId=${GROUP}`,
  link: `https://expo.dev/projects/${PROJECT}/updates/${GROUP}`,
  platforms: ["android", "ios"],
};

const DEVICE: PreviewDevice = {
  status: "ready",
  platform: "ios",
  shell: "https://expo.dev/artifacts/eas/abc123.tar.gz",
  runtime: "1.0.0",
  fingerprint: "9f8e7d6c5b4a39281706",
  profile: "preview-sim",
  build: "5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d",
  expires: "2026-10-06T10:00:00Z",
};

const FULL: PreviewLine = {
  pr: 31,
  sha: SHA,
  status: "ready",
  url: "https://yusufseyrek-facts-a-day-app-31.aiswec.com/",
  artifact: 2345678,
  run: 987654321,
  expires: "2026-09-20T10:00:00Z",
  dir: "web",
  access: "repository",
  storage: true,
};

const BARE: PreviewLine = { pr: 31, sha: SHA, status: "off" };

describe("previewSlug", () => {
  test("owner, repo and number, lower-cased, joined by hyphens", () => {
    expect(previewSlug("yusufseyrek", "facts-a-day-app", 31)).toBe("yusufseyrek-facts-a-day-app-31");
    expect(previewSlug("YusufSeyrek", "Facts.A_Day App", 7)).toBe("yusufseyrek-facts-a-day-app-7");
  });

  test("a run of anything but a letter or a digit is one hyphen, and the edges are bare", () => {
    expect(previewSlug("-owner-", "__repo..name__", 1)).toBe("owner-repo-name-1");
    expect(previewSlug("a b  c", "x---y", 2)).toBe("a-b-c-x-y-2");
  });

  test("is idempotent on a name that is already a label", () => {
    const raw = previewSlug("YusufSeyrek", "Facts.A_Day App", 31);
    expect(previewSlug("yusufseyrek", "facts-a-day-app", 31)).toBe(raw);
    // A label run through the rule again is the same label.
    for (const name of ["yusufseyrek", "facts-a-day-app", "a1-b2-c3"]) expect(previewSlug(name, name, 1)).toBe(`${name}-${name}-1`);
  });

  test("cuts a long repository name at 63 characters and keeps two cut names apart", () => {
    const owner = "yusufseyrek";
    const repo = "a".repeat(20) + "-" + "b".repeat(29);
    expect(repo).toHaveLength(50);
    const slug = previewSlug(owner, repo, 1234);
    const hash = createHash("sha256").update(`${owner}/${repo}`.toLowerCase()).digest("hex").slice(0, 6);
    // keep = 63 - 11 - 6 - 4 - 3 = 39 characters of the repo.
    expect(slug).toBe(`${owner}-${repo.slice(0, 39)}-${hash}-1234`);
    expect(slug).toHaveLength(63);
    // A sibling that shares the first 39 characters lands on a different host.
    const sibling = previewSlug(owner, repo.slice(0, 45) + "cccccc", 1234);
    expect(sibling).toHaveLength(63);
    expect(sibling).not.toBe(slug);
  });

  test("a cut never leaves a hyphen before the hash", () => {
    const owner = "yusufseyrek";
    // The 39th character of the repo is a hyphen, which the cut would end on.
    const repo = "a".repeat(38) + "-" + "b".repeat(20);
    const slug = previewSlug(owner, repo, 1234);
    expect(slug).toContain(`${"a".repeat(38)}-`);
    expect(slug).not.toContain("--");
    expect(slug.length).toBeLessThanOrEqual(63);
  });

  test("the whole name stays whole at exactly 63", () => {
    const repo = "r".repeat(63 - "yusufseyrek".length - 1 - 2 - 1);
    expect(previewSlug("yusufseyrek", repo, 42)).toBe(`yusufseyrek-${repo}-42`);
    expect(previewSlug("yusufseyrek", repo, 42)).toHaveLength(63);
  });
});

describe("previewUrl", () => {
  test("https under a real domain, http on the preview port under localhost", () => {
    expect(previewUrl("yusufseyrek-facts-a-day-app-31", "aiswec.com")).toBe("https://yusufseyrek-facts-a-day-app-31.aiswec.com/");
    expect(previewUrl("yusufseyrek-facts-a-day-app-31", "localhost")).toBe("http://yusufseyrek-facts-a-day-app-31.localhost:4001/");
    expect(previewUrl("x-y-1", "dev.localhost")).toBe("http://x-y-1.dev.localhost:4001/");
  });
});

describe("previewLine", () => {
  test("round trips every field", () => {
    expect(parsePreviewLine(previewLine(FULL))).toEqual(FULL);
  });

  test("round trips with every optional field absent, a null written as absence", () => {
    expect(parsePreviewLine(previewLine(BARE))).toEqual(BARE);
    expect(previewLine({ ...BARE, url: null, artifact: null, storage: null })).toBe(previewLine(BARE));
  });

  test("is a marker line and is stripped like one", () => {
    const line = previewLine(FULL);
    expect(line).toMatch(markerLinePattern());
    expect(line.startsWith("<!-- aiswec-preview:v1 {")).toBe(true);
    expect(stripMarkerLines(`## Preview\n\nLink x · Built from abc · Status ready\n${line}`)).toBe("## Preview\n\nLink x · Built from abc · Status ready");
  });

  test("escapes a > in a string, which the marker pattern forbids", () => {
    const value: PreviewLine = { ...BARE, dir: "web > site" };
    const line = previewLine(value);
    expect(line.slice(0, -3)).not.toContain(">");
    expect(line).toMatch(markerLinePattern());
    expect(parsePreviewLine(line)).toEqual(value);
  });

  test("the last line wins", () => {
    const body = `${previewLine(BARE)}\nThe body.\n${previewLine(FULL)}`;
    expect(parsePreviewLine(body)?.status).toBe("ready");
    expect(parsePreviewLine(`${previewLine(FULL)}\n${previewLine(BARE)}`)?.status).toBe("off");
  });

  test("a malformed last line reads as null, not as the line before it", () => {
    expect(parsePreviewLine(`${previewLine(FULL)}\n<!-- aiswec-preview:v1 {not json} -->`)).toBeNull();
    expect(parsePreviewLine(`${previewLine(FULL)}\n<!-- aiswec-preview:v1 {"pr":31} -->`)).toBeNull();
  });

  test("reads nothing from a body without one, or with a bare marker", () => {
    expect(parsePreviewLine("")).toBeNull();
    expect(parsePreviewLine("A pull request body.")).toBeNull();
    expect(parsePreviewLine(marker("preview"))).toBeNull();
    expect(parsePreviewLine(`<!-- aiswec-preview:v2 ${JSON.stringify(BARE)} -->`)).toBeNull();
  });

  test("reads a non-default namespace, and only that one", () => {
    const line = previewLine(FULL, "botco");
    expect(parsePreviewLine(line, "botco")).toEqual(FULL);
    expect(parsePreviewLine(line)).toBeNull();
  });

  test("drops an unknown key rather than refusing the line", () => {
    expect(parsePreviewLine(`<!-- aiswec-preview:v1 {"pr":1,"sha":"${SHA}","status":"ready","later":true} -->`)).toEqual({ pr: 1, sha: SHA, status: "ready" });
  });

  test("refuses a value it could not read back", () => {
    expect(() => previewLine({ ...BARE, sha: "abc" })).toThrow();
    expect(() => previewLine({ ...BARE, pr: 0 })).toThrow();
    expect(() => previewLine({ ...BARE, url: "not a url" })).toThrow();
    expect(() => previewLine({ ...BARE, status: "gone" as never })).toThrow();
  });
});

// 2026-09-06: the phone half. Written by the "Publish phone preview" step's
// output through the finalizer, read by Suite's task page.
describe("the phone on the preview line", () => {
  test("the statuses are the three the stage can end on", () => {
    expect(PREVIEW_PHONE_STATUSES).toEqual(["ready", "failed", "no-token"]);
  });

  test("round trips every phone field beside the web ones", () => {
    const value: PreviewLine = { ...FULL, phone: PHONE, native_touched: true };
    expect(parsePreviewLine(previewLine(value))).toEqual(value);
  });

  test("round trips with the web off and the phone on", () => {
    const value: PreviewLine = { ...BARE, phone: PHONE, native_touched: false };
    const read = parsePreviewLine(previewLine(value));
    expect(read).toEqual(value);
    expect(read?.status).toBe("off");
    expect(read?.phone?.qr).toBe(PHONE.qr);
  });

  test("round trips with the device half (2026-09-06)", () => {
    const value: PreviewLine = { ...BARE, phone: PHONE, device: DEVICE, native_touched: false };
    const read = parsePreviewLine(previewLine(value));
    expect(read).toEqual(value);
    expect(read?.device?.shell).toBe(DEVICE.shell);
    expect(read?.device?.status).toBe("ready");
  });

  test("a refusal carries its reason and nothing else", () => {
    for (const status of ["no-shell", "no-env", "public", "failed"] as const) {
      const line = previewLine({ ...BARE, device: { status } });
      expect(parsePreviewLine(line)?.device).toEqual({ status });
    }
    // A null inside the device is absence, as everywhere else on the line.
    expect(previewLine({ ...BARE, device: { status: "failed", shell: null, runtime: null } })).toBe(
      previewLine({ ...BARE, device: { status: "failed" } }),
    );
  });

  test("a line without a device reads back with device undefined", () => {
    const read = parsePreviewLine(previewLine({ ...BARE, phone: PHONE }));
    expect(read?.device).toBeUndefined();
    // What keeps the finalizer from rewriting every open pull request's body
    // on the first run after the tag: a line with no device is byte for byte
    // what it was before the half existed.
    expect(previewLine({ ...BARE, phone: PHONE })).not.toContain("device");
  });

  test("a bad value in the device does not take the line down with it", () => {
    // `shell` is a string on purpose: were it z.url(), a shell address the
    // stage got wrong would fail the whole parse and take the web preview's
    // URL and the QR with it.
    const line = previewLine({ ...BARE, device: { status: "ready", shell: "not a url" } });
    expect(parsePreviewLine(line)?.device?.shell).toBe("not a url");
    // A status outside the enum is a broken line, which is the one case that
    // must fail: Suite would otherwise render a device that does not exist.
    expect(() => previewLine({ ...BARE, device: { status: "elsewhere" } as never })).toThrow();
  });

  test("a null inside the phone is written as absence, like one on the line", () => {
    const sparse = previewLine({ ...BARE, phone: { status: "no-token", branch: null, qr: null, platforms: null }, native_touched: null });
    expect(sparse).toBe(previewLine({ ...BARE, phone: { status: "no-token" } }));
    expect(parsePreviewLine(sparse)).toEqual({ ...BARE, phone: { status: "no-token" } });
    expect(parsePreviewLine(previewLine({ ...BARE, phone: null }))).toEqual(BARE);
  });

  test("a line written before the phone reads back with phone undefined", () => {
    const read = parsePreviewLine(previewLine(FULL));
    expect(read).toEqual(FULL);
    expect(read).not.toHaveProperty("phone");
    expect(read?.phone).toBeUndefined();
    expect(read?.native_touched).toBeUndefined();
    // Byte for byte, as wave one's finalizer wrote it.
    const old = parsePreviewLine(`<!-- aiswec-preview:v1 {"pr":31,"sha":"${SHA}","status":"ready","url":"https://x-y-31.aiswec.com/"} -->`);
    expect(old?.phone).toBeUndefined();
    expect(old?.native_touched).toBeUndefined();
  });

  test("drops an unknown key inside the phone rather than refusing the line", () => {
    const read = parsePreviewLine(`<!-- aiswec-preview:v1 {"pr":31,"sha":"${SHA}","status":"off","phone":{"status":"ready","later":1}} -->`);
    expect(read).toEqual({ ...BARE, phone: { status: "ready" } });
  });

  test("escapes a > inside the phone too", () => {
    const value: PreviewLine = { ...BARE, phone: { status: "failed", branch: "pr>31" } };
    const line = previewLine(value);
    expect(line.slice(0, -3)).not.toContain(">");
    expect(line).toMatch(markerLinePattern());
    expect(parsePreviewLine(line)).toEqual(value);
  });

  test("refuses a phone it could not read back", () => {
    expect(() => previewLine({ ...BARE, phone: { status: "published" as never } })).toThrow();
    expect(() => previewLine({ ...BARE, phone: { status: "ready", qr: "not a url" } })).toThrow();
    expect(() => previewLine({ ...BARE, phone: { status: "ready", link: "not a url" } })).toThrow();
    expect(() => previewLine({ ...BARE, phone: { status: "ready", platforms: ["web" as never] } })).toThrow();
    expect(() => previewLine({ ...BARE, native_touched: "yes" as never })).toThrow();
    // And a last line that carries one reads as null, not as the line before it.
    expect(parsePreviewLine(`${previewLine(FULL)}\n<!-- aiswec-preview:v1 {"pr":31,"sha":"${SHA}","status":"off","phone":{"status":"gone"}} -->`)).toBeNull();
  });
});
