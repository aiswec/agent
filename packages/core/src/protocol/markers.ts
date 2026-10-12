/**
 * The wire protocol.
 *
 * Markers are the contract between what the model writes to /tmp and the
 * deterministic steps that act on it. They are versioned so a parser can evolve
 * without misreading a comment written by an older engine, and they are only
 * ever recognised on a line of their own: a marker mentioned mid-sentence
 * inside a body is text, not a delimiter.
 */
import { escapeRegExp, splitLines } from "./util.js";

export const DEFAULT_NAMESPACE = "aiswec";

export const MARKER_VERSIONS = {
  questions: 1,
  "hub-plan": 2,
  spec: 1,
  escalate: 1,
  reply: 1,
  run: 1,
  ask: 1,
  answers: 1,
  done: 1,
  preview: 1,
  // Where a task came from: the manual todo it was made of, in another repository (2026-09-17).
  from: 1,
  // The other tasks of one ask made in several projects at once (2026-10-08).
  with: 1,
  // The files attached to a task, a comment or a review, kept on the repository's own ref (2026-10-09).
  files: 1,
} as const;

export type MarkerKind = keyof typeof MARKER_VERSIONS;

export function marker(kind: MarkerKind, namespace: string = DEFAULT_NAMESPACE): string {
  return `<!-- ${namespace}-${kind}:v${MARKER_VERSIONS[kind]} -->`;
}

export function childStartMarker(repoKey: string, namespace: string = DEFAULT_NAMESPACE): string {
  return `<!-- ${namespace}-child:${repoKey}:start -->`;
}

export function childEndMarker(repoKey: string, namespace: string = DEFAULT_NAMESPACE): string {
  return `<!-- ${namespace}-child:${repoKey}:end -->`;
}

/** Matches any marker line in the namespace, whatever its kind. */
export function markerLinePattern(namespace: string = DEFAULT_NAMESPACE): RegExp {
  return new RegExp(`^<!--\\s*${escapeRegExp(namespace)}-\\S[^>]*-->$`);
}

export function childMarkerPattern(namespace: string = DEFAULT_NAMESPACE): RegExp {
  return new RegExp(`^<!--\\s*${escapeRegExp(namespace)}-child:([A-Za-z0-9._-]+):(start|end)\\s*-->$`);
}

export function hasMarker(
  body: string,
  kind: MarkerKind,
  namespace: string = DEFAULT_NAMESPACE,
): boolean {
  const want = marker(kind, namespace);
  return splitLines(body).some((line) => line.trim() === want);
}

/** Body content with every marker line removed and blank edges trimmed. */
export function stripMarkerLines(body: string, namespace: string = DEFAULT_NAMESPACE): string {
  const pattern = markerLinePattern(namespace);
  return splitLines(body)
    .filter((line) => !pattern.test(line.trim()))
    .join("\n")
    .trim();
}
