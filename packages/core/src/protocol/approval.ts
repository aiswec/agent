/**
 * Approval grammar.
 *
 * Approval runs no model at all: a maintainer comment whose first line opens
 * with a configured keyword triggers deterministic extraction of the drafts the
 * human just read. That is the product's trust story, so this file is
 * deliberately dull: first line only, exact keyword, no interpretation.
 *
 * One sharp edge is surfaced rather than silently decided: "approve but drop
 * the second one" matches the grammar. The source system treats that as a full
 * approval. We keep that behaviour (changing it would change what gets filed)
 * but flag it as `qualified` so the caller can require a clean approval.
 */
import { escapeRegExp, splitLines } from "./util.js";

export type CommentKind = "approval" | "reserved" | "feedback";

export interface CommentClassification {
  kind: CommentKind;
  /** The keyword that matched, in the casing configured (not as typed). */
  keyword: string | null;
  /** Whatever followed the keyword on the first line. */
  trailing: string;
  /** True when `trailing` carries real words: an approval with conditions attached. */
  qualified: boolean;
  /** The reserved prefix that claimed this comment, e.g. another workflow's slash command. */
  reservedPrefix: string | null;
  /** First line carrying content, trimmed. Empty when the comment is blank. */
  firstLine: string;
}

export interface ClassifyOptions {
  keywords: readonly string[];
  /** Comments opening with these belong to another workflow and are never approvals. */
  reservedPrefixes?: readonly string[];
}

const WORD_CHARACTER = /[\p{L}\p{N}]/u;

function firstContentLine(body: string): string {
  for (const line of splitLines(body)) {
    if (line.trim() !== "") return line.trim();
  }
  return "";
}

/** Longest first, so "approved" is never matched as "approve" with a stray "d". */
function byLengthDescending(keywords: readonly string[]): string[] {
  return [...keywords].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

export function classifyComment(
  body: string,
  options: ClassifyOptions,
): CommentClassification {
  const firstLine = firstContentLine(body);
  const base: CommentClassification = {
    kind: "feedback",
    keyword: null,
    trailing: "",
    qualified: false,
    reservedPrefix: null,
    firstLine,
  };

  if (firstLine === "") return base;

  for (const prefix of options.reservedPrefixes ?? []) {
    if (firstLine.toLowerCase().startsWith(prefix.toLowerCase())) {
      return { ...base, kind: "reserved", reservedPrefix: prefix };
    }
  }

  for (const keyword of byLengthDescending(options.keywords)) {
    const pattern = new RegExp(`^${escapeRegExp(keyword)}(?![\\p{L}\\p{N}_])`, "iu");
    if (!pattern.test(firstLine)) continue;

    // The dash characters stay in this class on purpose: it strips punctuation a maintainer typed
    // after the keyword, an em dash included. Nothing in the class is text of ours.
    const trailing = firstLine.slice(keyword.length).replace(/^[\s:,.!;—-]+/, "").trim();
    return {
      ...base,
      kind: "approval",
      keyword,
      trailing,
      qualified: WORD_CHARACTER.test(trailing),
    };
  }

  return base;
}

/**
 * The regex source the generated workflow greps with. Generating it from the
 * same keyword list the classifier uses is the point: the YAML and the parser
 * cannot drift apart.
 */
export function approvalGrammarSource(keywords: readonly string[]): string {
  const alternatives = byLengthDescending(keywords).map(escapeRegExp).join("|");
  return `^(${alternatives})\\b`;
}

export interface FooterOptions {
  /** What approving does. Defaults to the hub's child-filing wording. */
  action?: string;
  /**
   * The whole sentence describing what happens to a reply that is not an
   * approval, not a fragment, because the two gates differ in more than the
   * verb. The hub reads feedback and revises its plan because route subscribes
   * to `issue_comment`; a repo's refine stage does not, and a footer that
   * promises otherwise sends the maintainer to wait for something no trigger
   * can deliver. Whatever is passed here must name a path the emitted
   * workflow triggers actually serve.
   */
  otherwise?: string;
  /** A label that opens the same gate, for maintainers who would rather click. */
  releaseLabel?: string;
}

/**
 * The sentence a comment awaiting approval closes with. Generated from the
 * keyword list; a footer telling maintainers to reply "approve" when the
 * configured keyword is something else is exactly the drift this package exists
 * to remove.
 *
 * Two gates now end in this sentence: the hub's plan comment ("approve" files
 * the child issues) and a repo's spec comment ("approve" builds it). They are
 * parameters of one function rather than two functions, for the same reason:
 * a second copy is a second thing to keep in step with the keyword list.
 */
export function approvalFooterSentence(
  keywords: readonly string[],
  options: FooterOptions = {},
): string {
  const [primary, ...rest] = keywords;
  if (!primary) throw new Error("at least one approval keyword is required");
  const alternatives = rest.length > 0 ? ` (or ${rest.map((word) => `"${word}"`).join(", ")})` : "";
  const action = options.action ?? "file these issues as written";
  const otherwise =
    options.otherwise ?? "Any other reply is treated as feedback and revises the plan.";
  const release = options.releaseLabel ? `, or apply the \`${options.releaseLabel}\` label` : "";
  return `Reply with "${primary}"${alternatives} to ${action}${release}. ${otherwise}`;
}
