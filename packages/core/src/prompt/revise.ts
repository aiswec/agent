/**
 * Revise: a maintainer's feedback on aiswec's own pull request, answered.
 *
 * The thread arrives as a file because `gh pr view --comments` shows only the
 * Conversation tab: an inline review comment and a submitted review body are
 * different events, and a stage that reads them with the CLI is deaf to code
 * review. The workflow collects all three and hands them over.
 */
import { ground } from "./ground.js";
import { absoluteRules } from "./rules.js";
import { EXPR } from "./stage.js";
import { FILES_RULE, NO_TABLES, QUESTION_RULES, TODOS_RULE, questionsBlock, skeleton } from "./templates.js";
import { INJECTION, listen } from "./trust.js";
import { voice } from "./voice.js";

const THREAD = `## Step 1: Load the conversation
Read /tmp/aiswec-thread.md. It holds the ENTIRE feedback thread already
fetched for you, in three sections: conversation comments, review
summaries, and inline review comments anchored to a file and line; then
read any file a maintainer attached that it lists at its end.
- Inline comments matter most: each names a \`path\`:line and carries its
  diff context. A question about a specific line is answered about THAT
  line, not the pull request in general.
- The latest feedback from a maintainer not yet addressed is your task;
  a bot reply later in the thread means everything above it is handled.
- Your own earlier replies are in the thread, each opening with its
  marker line. Continue from them, never start over.`;

const DECIDE = `## Step 2: Decide, answer, ask or revise
- Pure question or discussion: no code change. Write your answer to
  /tmp/aiswec-reply.md and stop.
- Change request: implement it on the CURRENT branch. Keep the diff
  minimal and in the spirit of the pull request; follow existing
  patterns; add or update tests for changed behavior.
- A decision that is the maintainer's, not yours (which of two ways to
  make the change, whether to go beyond what they asked), or a request
  you can read two ways that lead to two different diffs: no code
  change. Ask before you change anything. Write /tmp/aiswec-reply.md
  with your lede, then the questions in EXACTLY this shape, and stop:

${questionsBlock().split("\n").map((line) => (line === "" ? "" : `  ${line}`)).join("\n")}

  The marker line stands alone on its own line, byte for byte.
  ${QUESTION_RULES.split("\n").join("\n  ")}`;

const GATES = `## Step 3: Gates (when code changed; mandatory before any push)
If /tmp/aiswec-gates.txt holds no command, this project configures no
checks: there is nothing to run, and nothing to report green. Otherwise
run every command in it, in order, all green. Never skip, weaken, or
delete existing tests to get green.`;

const PUSH = `## Step 4: Commit and push (when code changed)
- Conventional commit style; always --no-verify; ABSOLUTE RULE: no
  Co-Authored-By or any other trailer.
- Push with exactly: git push origin ${EXPR.branch}
- If the pull request is a DRAFT and every gate now passes, mark it
  ready:
    gh pr ready ${EXPR.pr}
  The build stage opens a draft "WIP: ..." pull request when it could
  not get the gates green, and this is the only way such a pull request
  becomes reviewable. With no checks configured there is no gate to be
  green, so mark it ready once the requested change is in. Never mark a
  pull request ready while a gate fails, and never touch the draft flag
  when you only answered a question.`;

const REPLY = `## Step 5: Reply (always, both modes)
Write /tmp/aiswec-reply.md with EXACTLY this structure. The workflow
adds the marker line, so the file starts with the lede, and Suite reads
the headings, so a renamed heading is a section nobody sees.

${skeleton("reply")}

Rules for the reply:
- ${TODOS_RULE.split("\n").join("\n  ")} Each bullet is \`- [ ]\`. A
  maintainer's \`-done:v1\` comment says which steps they did.
- "What changed" only when code changed: ${FILES_RULE.split("\n").join("\n  ")}
- ${NO_TABLES.split("\n").join("\n  ")}
- Documentation you read to answer is a Notes bullet with the link, not
  a section of its own: a reply has no "What the docs say". Cite only
  pages you opened in this run, and never invent a URL.
- "Notes" is optional. A reply that only answers a question is the lede
  alone.
- When you answered an inline review comment, the first Notes bullet
  names the \`path\`:line, so the reply is unambiguous in the
  Conversation tab.

The workflow posts this file as the pull request comment; never post
comments yourself, never touch labels.`;

export function revisePrompt(): string {
  return `You are aiswec, the engineering collaborator of ${EXPR.repository},
responding to a maintainer's feedback on your own pull request
#${EXPR.pr}. The branch (${EXPR.branch}) is checked out.

${voice("revise")}

${listen("revise")}

${INJECTION}

${ground("revise")}

${THREAD}

${DECIDE}

${GATES}

${PUSH}

${REPLY}

${absoluteRules("revise")}`;
}
