/**
 * Trusted-author spec selection.
 *
 * Build never takes a spec from whatever comment happens to carry the marker.
 * Anyone who can comment on an issue can write a marker, so the marker alone is
 * not evidence; authorship is. This picks the LAST spec comment written by an
 * allowlisted author, which is what defeats marker spoofing.
 */
import { DEFAULT_NAMESPACE, hasMarker, stripMarkerLines, type MarkerKind } from "./markers.js";
import { parseDoc, type FactsData } from "./sections.js";

export interface CommentLike {
  author: string;
  body: string;
  id?: string | number;
  createdAt?: string;
}

export interface SelectSpecOptions {
  /** Logins allowed to author a spec: the workflow bot, the engine bot, maintainers. */
  trustedAuthors: readonly string[];
  namespace?: string;
  kind?: MarkerKind;
}

/** GitHub logins are case-insensitive; comparing them case-sensitively is a silent bug. */
function normaliseLogin(login: string): string {
  return login.trim().toLowerCase().replace(/^@/, "");
}

export function selectTrustedSpec<T extends CommentLike>(
  comments: readonly T[],
  options: SelectSpecOptions,
): T | null {
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;
  const kind = options.kind ?? "spec";
  const trusted = new Set(options.trustedAuthors.map(normaliseLogin));

  for (let index = comments.length - 1; index >= 0; index--) {
    const comment = comments[index];
    if (!comment) continue;
    if (!trusted.has(normaliseLogin(comment.author))) continue;
    if (!hasMarker(comment.body, kind, namespace)) continue;
    return comment;
  }

  return null;
}

/** Spec text with the marker lines removed, ready to hand to the build prompt. */
/**
 * The plan's size, S, M or L: from the At a glance line, from the table the
 * format had before it, or from the `**Size estimate:**` line before that.
 * Suite's task page reads it, and read only the oldest until 2026-09-05.
 */
export function specSize(body: string, namespace: string = DEFAULT_NAMESPACE): "S" | "M" | "L" | null {
  const data = parseDoc(body, "spec", namespace).byKey["meta"]?.data;
  const fact = typeof data === "object" && data !== null && !Array.isArray(data) && "values" in data ? (data as FactsData).values["size"] : undefined;
  const found = fact ?? /\*\*Size estimate:\*\*\s*([SML])\b/i.exec(body)?.[1] ?? "";
  const letter = found.trim().charAt(0).toUpperCase();
  return letter === "S" || letter === "M" || letter === "L" ? letter : null;
}

export function specContent(body: string, namespace: string = DEFAULT_NAMESPACE): string {
  return stripMarkerLines(body, namespace);
}
