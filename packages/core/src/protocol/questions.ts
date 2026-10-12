/**
 * Questions with options, and the answers to them.
 *
 * When aiswec cannot plan without a decision that is the maintainer's to make,
 * it asks, and it asks the way a good colleague does: each question with the
 * choices it sees, one of them the one it would take. The note it writes is
 * markdown that reads on GitHub as it is, and this parser is what lets Suite
 * read the same note back into a form: a numbered heading per question, a
 * lettered bullet per option, nothing a person could not type by hand. The
 * answers go the other way as one comment, quoting the question and the option
 * chosen, so the engine on the next run and a person on GitHub read the same
 * thing.
 *
 * The parser never throws: a note is untrusted text like any comment, so what
 * does not parse is prose, and a note without a single question is a note.
 */
import { DEFAULT_NAMESPACE, marker, markerLinePattern } from "./markers.js";
import { splitLines, trimBlankEdges } from "./util.js";

export interface QuestionOption {
  /** The letter the note gave it: a, b, c. */
  key: string;
  text: string;
  /** The one aiswec would choose, when it marked one. */
  recommended: boolean;
}

export interface Question {
  /** The number the note gave it, as written. */
  number: number;
  text: string;
  /** What aiswec wrote under the question: why it matters, what each choice means. */
  why: string;
  /** Empty when the question wants an answer in words only. */
  options: QuestionOption[];
  /** More than one option may be true. */
  multi: boolean;
}

export interface QuestionsNote {
  /** What stands above the marker: a reply's own opening when the questions ride inside one. */
  preface: string;
  /** Plain words between the marker and the first question. */
  intro: string;
  questions: Question[];
  /** What the workflow appended after `---`: how to answer on GitHub. */
  footer: string | null;
}

/** `### 1. Question` at any heading level, or `**1. Question**` for a note written by hand. */
const HEADING = /^#{1,6}\s*(\d+)[.)]\s+(.+?)\s*$/;
const BOLD_HEADING = /^\*\*(\d+)[.)]\s+(.+?)\*\*\s*$/;
/** `- (a) text`, `- a) text`, `- a. text`, the letter optionally bold. */
const OPTION = /^[-*+]\s+(?:\*\*)?\(?([a-z])[.)](?:\*\*)?\s+(.+?)\s*$/;
const RECOMMENDED = /\s*(?:\*\*)?\((?:recommended|suggested)\)(?:\*\*)?\s*$/i;
const MULTI = /\s*\((?:pick|choose|select)\s+(?:all|any)(?:\s+that\s+apply)?\)\s*$/i;

function heading(line: string): { number: number; text: string } | null {
  const match = HEADING.exec(line) ?? BOLD_HEADING.exec(line);
  if (!match) return null;
  return { number: Number(match[1]), text: match[2] ?? "" };
}

/** The workflow's footer, split off exactly as the spec's release footer is. */
function splitFooter(content: string): { body: string; footer: string | null } {
  const at = content.lastIndexOf("\n\n---\n\n");
  if (at < 0) return { body: content, footer: null };
  return { body: content.slice(0, at), footer: content.slice(at + 7).trim() };
}

export function parseQuestions(body: string, namespace: string = DEFAULT_NAMESPACE): QuestionsNote | null {
  const want = marker("questions", namespace);
  const lines = splitLines(body);
  const at = lines.findIndex((line) => line.trim() === want);
  if (at < 0) return null;

  const isMarker = markerLinePattern(namespace);
  const prose = (part: readonly string[]): string => trimBlankEdges(part.filter((line) => !isMarker.test(line.trim()))).join("\n");

  const preface = prose(lines.slice(0, at));
  // Every other marker line (a run line, a reply marker) is a line nobody reads, wherever it sits.
  const after = lines.slice(at + 1).filter((line) => !isMarker.test(line.trim()));
  const { body: rest, footer } = splitFooter(after.join("\n"));

  const intro: string[] = [];
  const questions: Question[] = [];
  let current: Question | null = null;
  let why: string[] = [];
  const close = (): void => {
    if (current) current.why = prose(why);
    why = [];
  };

  for (const raw of splitLines(rest)) {
    const line = raw.trim();
    const head = heading(line);
    if (head) {
      close();
      current = { number: head.number, text: head.text.replace(MULTI, "").trim(), why: "", options: [], multi: MULTI.test(head.text) };
      questions.push(current);
      continue;
    }
    if (current === null) {
      intro.push(raw);
      continue;
    }
    const option = OPTION.exec(line);
    if (option) {
      const text = option[2] ?? "";
      current.options.push({ key: option[1] ?? "", text: text.replace(RECOMMENDED, "").trim(), recommended: RECOMMENDED.test(text) });
      continue;
    }
    why.push(raw);
  }
  close();

  return { preface, intro: prose(intro), questions, footer };
}

export interface Answer {
  number: number;
  question: string;
  /** The options chosen, as the note listed them. */
  chosen: readonly QuestionOption[];
  /** The person's own words, with or instead of an option. */
  other: string | null;
}

/**
 * The comment a maintainer's answers become: the marker, then each question in
 * bold with what was chosen under it, an option as "(a) its text" and the
 * person's own words as a line of their own, and a closing note when they
 * wrote one. It reads on GitHub as it is, and the engine reads the same lines
 * as the maintainer's instructions on the next run.
 *
 * Throws on an answer that says nothing, since a question answered with
 * nothing is a comment nobody meant to post.
 */
export function answersComment(answers: readonly Answer[], note: string | null = null, namespace: string = DEFAULT_NAMESPACE): string {
  if (answers.length === 0) throw new Error("no answers to write");
  const blocks = answers.map((answer) => {
    const lines = [`**${answer.number}. ${answer.question.trim()}**`];
    for (const option of answer.chosen) lines.push(`(${option.key}) ${option.text.trim()}`);
    const other = answer.other?.trim() ?? "";
    if (other !== "") lines.push(other);
    if (lines.length === 1) throw new Error(`question ${answer.number} has no answer`);
    return lines.join("\n");
  });
  const closing = note?.trim() ?? "";
  return [marker("answers", namespace), ...blocks, ...(closing === "" ? [] : [closing])].join("\n\n");
}
