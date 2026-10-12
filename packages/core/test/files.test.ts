/**
 * Files attached to a task: what the bytes are, what a name may be, the line
 * Suite writes and reads back, and the block a reader on GitHub sees.
 */
import { describe, expect, test } from "bun:test";
import {
  FILE_NAME_MAX,
  FILES_MAX,
  blobSha,
  filePath,
  filesBlock,
  filesLine,
  filesRef,
  fileUrl,
  isText,
  parseFilesLine,
  safeFileName,
  secretName,
  secretShaped,
  sniffFile,
  sniffImage,
  stripFilesBlock,
  withFiles,
  type AttachedFile,
} from "../src/index.js";

const bytes = (...parts: (number[] | string)[]): Uint8Array => {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === "string") for (const char of part) out.push(char.charCodeAt(0));
    else out.push(...part);
  }
  return Uint8Array.from(out);
};
const be32 = (value: number) => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
const be16 = (value: number) => [(value >>> 8) & 0xff, value & 0xff];
const le16 = (value: number) => [value & 0xff, (value >>> 8) & 0xff];
const le24 = (value: number) => [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff];

const PNG = (w: number, h: number) => bytes([0x89], "PNG\r\n\x1a\n", be32(13), "IHDR", be32(w), be32(h), [8, 6, 0, 0, 0], [0, 0, 0, 0]);
const GIF = (w: number, h: number) => bytes("GIF89a", le16(w), le16(h), [0, 0, 0]);
// SOI, an APP0 (JFIF) segment to step over, then a baseline frame carrying the size.
const JPEG = (w: number, h: number, frame = 0xc0) => bytes([0xff, 0xd8], [0xff, 0xe0], be16(16), "JFIF\0", [1, 1, 0, 0, 1, 0, 1, 0, 0], [0xff, frame], be16(17), [8], be16(h), be16(w), [3, 1, 0x22, 0], [0xff, 0xd9]);
const WEBP_LOSSY = (w: number, h: number) => bytes("RIFF", [0, 0, 0, 0], "WEBP", "VP8 ", [0, 0, 0, 0], [0, 0, 0], [0x9d, 0x01, 0x2a], le16(w), le16(h));
const WEBP_LOSSLESS = (w: number, h: number) => {
  const bits = ((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14);
  return bytes("RIFF", [0, 0, 0, 0], "WEBP", "VP8L", [0, 0, 0, 0], [0x2f], [bits & 0xff, (bits >>> 8) & 0xff, (bits >>> 16) & 0xff, (bits >>> 24) & 0xff]);
};
const WEBP_EXTENDED = (w: number, h: number) => bytes("RIFF", [0, 0, 0, 0], "WEBP", "VP8X", [0, 0, 0, 0], [0, 0, 0, 0], le24(w - 1), le24(h - 1));

describe("what the bytes are", () => {
  test("each image kind by its magic number, with the size its header gives", () => {
    expect(sniffImage(PNG(1568, 980))).toEqual({ type: "image/png", w: 1568, h: 980 });
    expect(sniffImage(GIF(320, 200))).toEqual({ type: "image/gif", w: 320, h: 200 });
    expect(sniffImage(JPEG(1200, 800))).toEqual({ type: "image/jpeg", w: 1200, h: 800 });
    expect(sniffImage(JPEG(640, 480, 0xc2))).toEqual({ type: "image/jpeg", w: 640, h: 480 });
    expect(sniffImage(WEBP_LOSSY(400, 300))).toEqual({ type: "image/webp", w: 400, h: 300 });
    expect(sniffImage(WEBP_LOSSLESS(1024, 768))).toEqual({ type: "image/webp", w: 1024, h: 768 });
    expect(sniffImage(WEBP_EXTENDED(2000, 1500))).toEqual({ type: "image/webp", w: 2000, h: 1500 });
  });

  test("an SVG, an HTML page, a PDF, a zip and a truncated header are not images", () => {
    expect(sniffImage(bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(sniffImage(bytes("<!doctype html><script>alert(1)</script>"))).toBeNull();
    expect(sniffImage(bytes("%PDF-1.7\n"))).toBeNull();
    expect(sniffImage(bytes([0x50, 0x4b, 0x03, 0x04]))).toBeNull();
    expect(sniffImage(PNG(10, 10).slice(0, 20))).toBeNull();
    expect(sniffImage(bytes([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeNull();
    expect(sniffImage(PNG(0, 10))).toBeNull();
  });

  test("text is UTF-8 without a NUL; a binary renamed is not", () => {
    expect(isText(new TextEncoder().encode("Error: connect ECONNREFUSED\n  at login (app.ts:12)\n"))).toBe(true);
    expect(isText(new TextEncoder().encode("görüntü, ışık, 日本語\n"))).toBe(true);
    expect(isText(bytes("a\0b"))).toBe(false);
    expect(isText(bytes([0xc3, 0x28]))).toBe(false);
    expect(sniffFile(bytes("plain words"))).toEqual({ type: "text/plain" });
    // An SVG is text, and a text file is all it can ever be: never served as an image.
    expect(sniffFile(bytes("<svg><script>alert(1)</script></svg>"))).toEqual({ type: "text/plain" });
    expect(sniffFile(PNG(3, 3))).toEqual({ type: "image/png", w: 3, h: 3 });
    expect(sniffFile(bytes([0x50, 0x4b, 0x03, 0x04, 0, 0, 0xff]))).toBeNull();
  });

  test("the blob hash is git's", () => {
    // `printf 'hello\n' | git hash-object --stdin`
    expect(blobSha(new TextEncoder().encode("hello\n"))).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
    expect(blobSha(new Uint8Array(0))).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
  });
});

describe("names", () => {
  test("the last segment, made safe, with the extension of what the bytes are", () => {
    expect(safeFileName("Screenshot 2026-10-09 at 10.00.00.png", "image/png")).toBe("Screenshot 2026-10-09 at 10.00.00.png");
    expect(safeFileName("../../etc/passwd", "text/plain")).toBe("passwd.txt");
    expect(safeFileName("C:\\Users\\ada\\error.log", "text/plain")).toBe("error.log");
    expect(safeFileName("IMG_1234.HEIC", "image/jpeg")).toBe("IMG_1234.jpg");
    expect(safeFileName("photo.jpeg", "image/jpeg")).toBe("photo.jpg");
    expect(safeFileName("ekran görüntüsü.png", "image/png")).toBe("ekran görüntüsü.png");
    expect(safeFileName("](javascript:alert(1)) <b>x.png", "image/png")).toBe("(javascript-alert(1)) -b-x.png");
    expect(safeFileName("<b>x</b>.png", "image/png")).toBe("b.png");
    expect(safeFileName("..png", "image/png")).toBe("image.png");
    expect(safeFileName("", "text/plain")).toBe("file.txt");
    expect(safeFileName("notes", "text/plain")).toBe("notes.txt");
    expect(safeFileName("schema.graphql.weird-ext!", "text/plain")).toBe("schema.graphql.txt");
    expect(safeFileName(`${"a".repeat(300)}.md`, "text/plain")).toHaveLength(FILE_NAME_MAX);
  });

  test("is idempotent, which is how a hand-written line is told from Suite's", () => {
    for (const [name, type] of [
      ["../x/y z.png", "image/png"],
      ["a  b--c.d.txt", "text/plain"],
      [`${"é".repeat(200)}.md`, "text/plain"],
      ["[x](y).gif", "image/gif"],
    ] as const) {
      const once = safeFileName(name, type);
      expect(safeFileName(once, type)).toBe(once);
    }
  });

  test("a credential's name and a credential's shape are refused", () => {
    for (const name of [".env", ".env.local", ".env.production", "id_rsa", "server.pem", "AuthKey_ABC123.p8", "release.keystore", ".npmrc", "x/.netrc"]) expect([name, secretName(name)]).toEqual([name, true]);
    for (const name of [".env.example", ".env.sample", "notes.txt", "keys.md", "environment.ts", "pem-notes.txt"]) expect([name, secretName(name)]).toEqual([name, false]);
    expect(secretShaped(`OPENROUTER_API_KEY=sk-or-v1-${"a".repeat(64)}`)).toBe(true);
    expect(secretShaped("-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk=")).toBe(true);
    expect(secretShaped(`token: ghp_${"A".repeat(36)}`)).toBe(true);
    expect(secretShaped("aws_access_key_id = AKIAIOSFODNN7EXAMPLE")).toBe(true);
    expect(secretShaped("the login fails with 401 after a refresh")).toBe(false);
  });
});

const SHOT: AttachedFile = { sha: "a".repeat(40), name: "login.png", type: "image/png", bytes: 182_044, w: 1568, h: 980 };
const LOG: AttachedFile = { sha: "b".repeat(40), name: "error.log", type: "text/plain", bytes: 2_310 };
const COMMIT = "c".repeat(40);

describe("the line and the block", () => {
  test("round-trips, and says nothing a reader needs", () => {
    const line = filesLine({ files: [SHOT, LOG] });
    expect(line).toStartWith("<!-- aiswec-files:v1 {");
    expect(line).toEndWith(" -->");
    expect(parseFilesLine(`Login breaks.\n\n${line}`)).toEqual({ files: [SHOT, LOG] });
    expect(parseFilesLine(`x\n\n${filesLine({ files: [SHOT] }, "acme")}`, "acme")).toEqual({ files: [SHOT] });
  });

  test("a line Suite would not have written is absence", () => {
    const write = (files: unknown) => `<!-- aiswec-files:v1 ${JSON.stringify({ files })} -->`;
    expect(parseFilesLine(write([{ ...SHOT, name: "../x.png" }]))).toBeNull();
    expect(parseFilesLine(write([{ ...SHOT, sha: "A".repeat(40) }]))).toBeNull();
    expect(parseFilesLine(write([{ ...SHOT, type: "image/svg+xml" }]))).toBeNull();
    expect(parseFilesLine(write([{ ...SHOT, w: undefined }]))).toBeNull();
    expect(parseFilesLine(write([{ ...LOG, w: 3, h: 3 }]))).toBeNull();
    expect(parseFilesLine(write([SHOT, SHOT]))).toBeNull();
    expect(parseFilesLine(write(Array.from({ length: FILES_MAX + 1 }, (_, i) => ({ ...LOG, sha: i.toString(16).padStart(40, "0") }))))).toBeNull();
    expect(parseFilesLine("no line here")).toBeNull();
    expect(() => filesLine({ files: [{ ...SHOT, name: "a/b.png" }] })).toThrow();
  });

  test("the block links each file into GitHub by the commit that keeps it", () => {
    expect(filesRef()).toBe("aiswec/files");
    expect(filePath(SHOT)).toBe(`aa/${SHOT.sha}.png`);
    expect(fileUrl("o/app", COMMIT, SHOT)).toBe(`https://github.com/o/app/blob/${COMMIT}/aa/${SHOT.sha}.png?raw=true`);
    expect(fileUrl("o/app", COMMIT, LOG)).toBe(`https://github.com/o/app/blob/${COMMIT}/bb/${LOG.sha}.log`);
    const block = filesBlock([SHOT, LOG], { repo: "o/app", commit: COMMIT });
    expect(block.split("\n")).toEqual([filesLine({ files: [SHOT, LOG] }), `![login.png](${fileUrl("o/app", COMMIT, SHOT)})`, `[error.log](${fileUrl("o/app", COMMIT, LOG)})`]);
  });

  test("Suite shows the words without the block, and keeps what follows it", () => {
    const block = filesBlock([SHOT, LOG], { repo: "o/app", commit: COMMIT });
    const ask = '<!-- aiswec-ask:v1 {"model":"claude-opus-5-5"} -->';
    const body = `${withFiles("The login button does nothing.", block)}\n\n${ask}`;
    expect(stripFilesBlock(body)).toBe(`The login button does nothing.\n\n${ask}`);
    expect(stripFilesBlock(withFiles("", block))).toBe("");
    // A link a person wrote is theirs: only the lines right under the marker are the block's.
    expect(stripFilesBlock(`See ![x](https://github.com/o/app/blob/main/x.png)\n\n${block}`)).toBe("See ![x](https://github.com/o/app/blob/main/x.png)");
    expect(withFiles("words", null)).toBe("words");
  });
});
