/**
 * Files attached to a task (2026-10-09).
 *
 * Asked for as "add capability to add images to tasks ... images, text files,
 * etc. depending on the ability of models ... but make sure this is not become
 * an attack vector". A task is an issue, and GitHub offers no API for the
 * uploads its own editor makes, so a file attached in Suite is stored in the
 * project's own repository: a git blob, kept reachable by a commit on
 * `refs/<namespace>/files`, a ref that is neither a branch nor a tag, so no
 * workflow runs on it, no clone fetches it and no branch list shows it. A file
 * is addressed by its blob hash, so a reader asks GitHub for exactly the bytes
 * that were attached and can prove it got them.
 *
 * The files line, `filesLine`: an `aiswec-files:v1` marker in the body of the
 * task, the comment or the review the files were attached to, naming each by
 * its hash, its name, its type and its size. Under it, one link per file into
 * GitHub, so a reader there sees the image as well (`filesBlock`). A stage
 * hands the engine the files of a maintainer's line alone, as it honours the
 * ask line; anyone else's line is data, and its files never reach a run.
 *
 * What a file may be is decided by its bytes, never by its name or the type a
 * browser claimed (`sniffFile`): PNG, JPEG, GIF and WebP by their magic numbers
 * and a size the vision models take, and UTF-8 text without a NUL. No SVG (a
 * script that looks like an image), no HTML served as a page, no PDF, no
 * archive. A text file shaped like a credential is refused (`secretName`,
 * `secretShaped`), since what is attached stays in the repository's history.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { DEFAULT_NAMESPACE } from "./markers.js";
import { payloadLine, payloadMarkerPattern, readPayload } from "./run.js";
import { splitLines } from "./util.js";

/** The most files one task, comment or review carries. */
export const FILES_MAX = 10;
/** The most a stage hands the engine in one run, the latest kept: every image is tokens the run pays for. */
export const FILES_PER_RUN = 20;
/** One file's ceiling in bytes: under the 2 MiB Suite's socket takes in one request. */
export const FILE_MAX_BYTES = 2_000_000;
/** The longest side Suite scales an image to before it uploads it: about what a vision model looks at. */
export const IMAGE_MAX_EDGE = 2000;
/** The longest side an image may have at all, the vision APIs' own limit. */
export const IMAGE_MAX_SIDE = 8000;
/** A shown name's length, its extension included. */
export const FILE_NAME_MAX = 100;

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export const FILE_TYPES = [...IMAGE_TYPES, "text/plain"] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];
export type FileType = (typeof FILE_TYPES)[number];

const IMAGE_EXTENSION: Record<ImageType, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

const SHA = /^[0-9a-f]{40}$/;

export const attachedFileSchema = z.object({
  /** The git blob's hash: the address, and the proof of the bytes. */
  sha: z.string().regex(SHA),
  /** What the person called it, made safe (`safeFileName`); never a path. */
  name: z.string().min(1).max(FILE_NAME_MAX),
  type: z.enum(FILE_TYPES),
  bytes: z.number().int().positive().max(FILE_MAX_BYTES),
  /** An image's size in pixels; a text file has none. */
  w: z.number().int().positive().max(IMAGE_MAX_SIDE).optional(),
  h: z.number().int().positive().max(IMAGE_MAX_SIDE).optional(),
});

export type AttachedFile = z.infer<typeof attachedFileSchema>;

export const filesLineSchema = z.object({
  files: z.array(attachedFileSchema).min(1).max(FILES_MAX),
});

export interface FilesLine {
  files: AttachedFile[];
}

export function isImageType(type: string): type is ImageType {
  return (IMAGE_TYPES as readonly string[]).includes(type);
}

/**
 * A name a person gave a file, made safe to show, to put in a link's text and
 * to end a path with: the last segment of whatever was given, letters and
 * digits of any script, spaces and `._()+,-`, everything else a dash. An
 * image takes the extension of what its bytes are; a text file keeps a short
 * one of its own, or `.txt`. Idempotent, which is what lets a reader refuse a
 * line whose names Suite would not have written.
 */
export function safeFileName(raw: string, type: FileType): string {
  const last = raw.normalize("NFC").split(/[\\/]/).pop() ?? "";
  const dot = last.lastIndexOf(".");
  const given = dot > 0 ? last.slice(dot + 1).toLowerCase() : "";
  const extension = isImageType(type) ? IMAGE_EXTENSION[type] : /^[a-z0-9]{1,10}$/.test(given) ? given : "txt";
  const clean = (text: string) =>
    text
      .replace(/[^\p{L}\p{N} ._()+,-]/gu, "-")
      .replace(/\s+/g, " ")
      .replace(/-{2,}/g, "-")
      .replace(/^[\s.-]+|[\s.-]+$/g, "");
  let stem = clean(dot > 0 ? last.slice(0, dot) : last);
  if (stem === "") stem = isImageType(type) ? "image" : "file";
  stem = clean(stem.slice(0, FILE_NAME_MAX - extension.length - 1));
  return `${stem === "" ? "file" : stem}.${extension}`;
}

/** A name that only a credential goes by: an env file, a key, a store's or a registry's login. Checked on what the person gave, before it is made safe. */
export function secretName(raw: string): boolean {
  const name = (raw.split(/[\\/]/).pop() ?? "").toLowerCase();
  if (/^\.env(\..+)?$/.test(name)) return !/^\.env\.(example|sample|template|dist)$/.test(name);
  if (/^(\.npmrc|\.netrc|\.pgpass|\.pypirc|\.dockercfg|id_rsa|id_dsa|id_ecdsa|id_ed25519)$/.test(name)) return true;
  return /\.(pem|key|p8|p12|pfx|jks|keystore|ppk)$/.test(name);
}

/**
 * Text shaped like a credential: the shapes the stages' scan looks for in what
 * leaves a run (`leaks()` in stage-*.yml), and an AWS access key id.
 */
export const SECRET_SHAPE = /sk-or-v1-[0-9a-f]{40,}|sk-ant-[A-Za-z0-9_-]{40,}|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}/;

export function secretShaped(text: string): boolean {
  return SECRET_SHAPE.test(text);
}

// ---- What the bytes are ------------------------------------------------------

function u16be(bytes: Uint8Array, at: number): number {
  return ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
}

function u16le(bytes: Uint8Array, at: number): number {
  return (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);
}

function u24le(bytes: Uint8Array, at: number): number {
  return (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8) | ((bytes[at + 2] ?? 0) << 16);
}

function u32be(bytes: Uint8Array, at: number): number {
  return (((bytes[at] ?? 0) << 24) >>> 0) + (((bytes[at + 1] ?? 0) << 16) | ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0));
}

function ascii(bytes: Uint8Array, at: number, text: string): boolean {
  for (let index = 0; index < text.length; index++) if (bytes[at + index] !== text.charCodeAt(index)) return false;
  return true;
}

/** The JPEG markers that open a frame and carry its size: SOF0 to SOF15 but DHT, JPG and DAC. */
const JPEG_FRAMES = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function jpegSize(bytes: Uint8Array): { w: number; h: number } | null {
  let at = 2;
  while (at + 3 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    let marker = bytes[at + 1] ?? 0;
    // Fill bytes: any number of 0xFF before the marker.
    while (marker === 0xff && at + 2 < bytes.length) {
      at += 1;
      marker = bytes[at + 1] ?? 0;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return null;
    if (JPEG_FRAMES.has(marker)) return at + 8 < bytes.length ? { h: u16be(bytes, at + 5), w: u16be(bytes, at + 7) } : null;
    const length = u16be(bytes, at + 2);
    if (length < 2) return null;
    at += 2 + length;
  }
  return null;
}

function webpSize(bytes: Uint8Array): { w: number; h: number } | null {
  if (ascii(bytes, 12, "VP8 ")) {
    // The frame tag, then the start code, then two 14-bit sizes.
    if (bytes.length < 30 || bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    return { w: u16le(bytes, 26) & 0x3fff, h: u16le(bytes, 28) & 0x3fff };
  }
  if (ascii(bytes, 12, "VP8L")) {
    if (bytes.length < 25 || bytes[20] !== 0x2f) return null;
    const bits = ((bytes[21] ?? 0) | ((bytes[22] ?? 0) << 8) | ((bytes[23] ?? 0) << 16) | ((bytes[24] ?? 0) << 24)) >>> 0;
    return { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (ascii(bytes, 12, "VP8X")) {
    if (bytes.length < 30) return null;
    return { w: u24le(bytes, 24) + 1, h: u24le(bytes, 27) + 1 };
  }
  return null;
}

/** An image by its magic number, with its size read from its own header; null for anything else. */
export function sniffImage(bytes: Uint8Array): { type: ImageType; w: number; h: number } | null {
  let found: { type: ImageType; w: number; h: number } | null = null;
  if (bytes.length >= 24 && bytes[0] === 0x89 && ascii(bytes, 1, "PNG\r\n\x1a\n") && ascii(bytes, 12, "IHDR")) {
    found = { type: "image/png", w: u32be(bytes, 16), h: u32be(bytes, 20) };
  } else if (bytes.length >= 10 && (ascii(bytes, 0, "GIF87a") || ascii(bytes, 0, "GIF89a"))) {
    found = { type: "image/gif", w: u16le(bytes, 6), h: u16le(bytes, 8) };
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    const size = jpegSize(bytes);
    if (size !== null) found = { type: "image/jpeg", ...size };
  } else if (bytes.length >= 16 && ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP")) {
    const size = webpSize(bytes);
    if (size !== null) found = { type: "image/webp", ...size };
  }
  return found !== null && found.w > 0 && found.h > 0 ? found : null;
}

/** UTF-8 that decodes cleanly and holds no NUL: text a person or a tool wrote, not a binary renamed. */
export function isText(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export type Sniffed = { type: ImageType; w: number; h: number } | { type: "text/plain" };

/** What the bytes are, image first and then text; null when they are neither. */
export function sniffFile(bytes: Uint8Array): Sniffed | null {
  const image = sniffImage(bytes);
  if (image !== null) return image;
  return isText(bytes) ? { type: "text/plain" } : null;
}

/** The hash git gives the bytes as a blob, which is what GitHub answers a blob's creation with. */
export function blobSha(bytes: Uint8Array): string {
  return createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
}

// ---- Where a file lives ------------------------------------------------------

/** The ref the files are kept on, as GitHub's git refs API takes it: no `refs/` in front. */
export function filesRef(namespace: string = DEFAULT_NAMESPACE): string {
  return `${namespace}/files`;
}

/** A file's path in the ref's tree, bucketed by the hash's first two characters as git buckets its objects. */
export function filePath(file: Pick<AttachedFile, "sha" | "name">): string {
  const extension = file.name.slice(file.name.lastIndexOf(".") + 1);
  return `${file.sha.slice(0, 2)}/${file.sha}.${extension}`;
}

/** Where GitHub shows the file: an image as itself, a text file as GitHub's file view. */
export function fileUrl(repo: string, commit: string, file: Pick<AttachedFile, "sha" | "name" | "type">): string {
  const page = `https://github.com/${repo}/blob/${commit}/${filePath(file)}`;
  return isImageType(file.type) ? `${page}?raw=true` : page;
}

// ---- The line ----------------------------------------------------------------

/** Every name is one Suite would have written, an image has its size and a text file none, and no file is named twice. */
function valid(line: FilesLine): boolean {
  const hashes = new Set(line.files.map((file) => file.sha));
  if (hashes.size !== line.files.length) return false;
  return line.files.every((file) => file.name === safeFileName(file.name, file.type) && (isImageType(file.type) ? file.w !== undefined && file.h !== undefined : file.w === undefined && file.h === undefined));
}

export function filesLine(value: FilesLine, namespace: string = DEFAULT_NAMESPACE): string {
  const parsed = filesLineSchema.parse(value);
  if (!valid(parsed)) throw new Error("a files line names each file once, by a name safeFileName keeps, an image with its size");
  return payloadLine("files", { files: parsed.files.map(({ sha, name, type, bytes, w, h }) => ({ sha, name, type, bytes, ...(w === undefined ? {} : { w }), ...(h === undefined ? {} : { h }) })) }, namespace);
}

/** The line off a body, or null when there is none or it does not parse. Never throws. */
export function parseFilesLine(body: string, namespace: string = DEFAULT_NAMESPACE): FilesLine | null {
  const parsed = filesLineSchema.safeParse(readPayload(body, "files", namespace));
  if (!parsed.success) return null;
  return valid(parsed.data) ? parsed.data : null;
}

/** A link line under the marker: an image or a file, into GitHub. */
const LINK_LINE = /^!?\[[^\]\n]*\]\(https:\/\/github\.com\/[^)\s]+\)$/;

/**
 * The marker and the links a reader on GitHub sees, written at the end of the
 * body after a blank line: the files are shown there by the commit that keeps
 * them, and named on the marker by their hashes.
 */
export function filesBlock(files: readonly AttachedFile[], at: { repo: string; commit: string }, namespace: string = DEFAULT_NAMESPACE): string {
  const links = files.map((file) => `${isImageType(file.type) ? "!" : ""}[${file.name}](${fileUrl(at.repo, at.commit, file)})`);
  return [filesLine({ files: [...files] }, namespace), ...links].join("\n");
}

/** The body without its files block: the marker and the link lines under it, which Suite shows as files of its own. */
export function stripFilesBlock(body: string, namespace: string = DEFAULT_NAMESPACE): string {
  const marker = payloadMarkerPattern("files", namespace);
  const out: string[] = [];
  let inBlock = false;
  for (const line of splitLines(body)) {
    if (marker.test(line.trim())) {
      inBlock = true;
      continue;
    }
    if (inBlock && LINK_LINE.test(line.trim())) continue;
    inBlock = false;
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** A body with a files block after it, a blank line between, as Suite writes a task, a comment or a review. */
export function withFiles(body: string, block: string | null): string {
  if (block === null || block === "") return body;
  const text = body.trimEnd();
  return text === "" ? block : `${text}\n\n${block}`;
}
