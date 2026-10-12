/**
 * A manual todo handed to another project: the body the new task gets, which
 * has to stand on its own since the stage that plans it reads one repository,
 * and the from line at its end, which Suite reads back.
 */
import { describe, expect, test } from "bun:test";
import { HANDOFF_CAP, fromLine, handoffBody, marker, parseAskLine, parseFromLine, askLine, taskRef } from "../src/index.js";

const PLAN = `${marker("spec")}
> [!NOTE]
> The trivia hub packs every answered question into the address it asks with.
> I will add a second way to ask that carries the list inside the request.

## Implementation Spec

### Manual todos

- Ship the mobile release that sends the answered ids in the request body instead of the query string: mobile repo, then App Store and Play Store.

### At a glance

Size L · Files 6 · Contract three additive POST twins, every GET unchanged · Checks 1

### Problem

The hub sends the list in the query string.

### Proposed approach

1. Add the POST twins.

### Affected files

- \`src/routes/trivia.ts\` (edit): body-sourced params

### Schema

\`\`\`ts
// new: request bodies for the POST twins
interface TriviaSelectionBody {
  language: string;
  exclude_question_ids?: number[];
}
\`\`\`

\`\`\`ts
interface TriviaAvailabilityBody {
  language: string;
}
\`\`\`

### Flow

\`\`\`mermaid
flowchart LR
  A["hub needs questions"] --> B["trivia handler"]
\`\`\`

### Acceptance criteria

- POST returns 200.

### Test plan

\`\`\`sh
bun run test
\`\`\`
`;

const SOURCE = { repo: "yusufseyrek/facts-a-day-backend", issue: 26, title: "Trivia questions are not loading", spec: 2345678901 };
const TODO = "Ship the mobile release that sends the answered ids in the request body instead of the query string: mobile repo, then App Store and Play Store.";

describe("hand-off", () => {
  test("the from line round-trips, and the ask line after it does not hide it", () => {
    const line = fromLine({ repo: "o/r", issue: 26, spec: "c1", todo: "ship it", when: "after" });
    expect(line).toBe('<!-- aiswec-from:v1 {"repo":"o/r","issue":26,"spec":"c1","todo":"ship it","when":"after"} -->');
    const body = `Words.\n\n${line}\n\n${askLine({ provider: "anthropic", model: "claude-opus-5" })}`;
    expect(parseFromLine(body)).toEqual({ repo: "o/r", issue: 26, spec: "c1", todo: "ship it", when: "after" });
    expect(parseAskLine(body)?.model).toBe("claude-opus-5");
    expect(parseFromLine("nothing")).toBeNull();
    expect(parseFromLine('<!-- aiswec-from:v1 {"repo":"not a repo","issue":1,"todo":"x","when":"after"} -->')).toBeNull();
  });

  test("a task is read as a person pastes it", () => {
    expect(taskRef("yusufseyrek/facts-a-day-app#31")).toEqual({ repo: "yusufseyrek/facts-a-day-app", number: 31 });
    expect(taskRef(" `o/r#7` ")).toEqual({ repo: "o/r", number: 7 });
    expect(taskRef("https://github.com/o/r/issues/31")).toEqual({ repo: "o/r", number: 31 });
    expect(taskRef("https://github.com/o/r/pull/9")).toEqual({ repo: "o/r", number: 9 });
    expect(taskRef("https://aiswec.com/suite/r/o/r/tasks/31")).toEqual({ repo: "o/r", number: 31 });
    expect(taskRef("#31")).toBeNull();
    expect(taskRef("o/r")).toBeNull();
  });

  test("the body carries the person's words, where it came from, the plan's contract as written, and the from line last", () => {
    const body = handoffBody({ context: "Send the ids in the body.", source: SOURCE, plan: PLAN, todo: TODO, when: "after" });
    const lines = body.split("\n");
    expect(lines[0]).toBe("Send the ids in the body.");
    expect(body).toContain("From a manual todo on yusufseyrek/facts-a-day-backend#26 (Trivia questions are not loading). Plan it now; ship it only after that plan is built and its changes are accepted.");
    expect(body).toContain("### From that plan\n\n> [!NOTE]\n> The trivia hub packs every answered question into the address it asks with.\n> I will add a second way");
    expect(body).toContain("Contract: three additive POST twins, every GET unchanged");
    // The Code sketch as written, both fences, not wrapped in a fence of its own; a plan from before the rename quotes its Schema under the new name.
    expect(body).toContain("#### Code sketch\n\n```ts\n// new: request bodies for the POST twins");
    expect(body).toContain("interface TriviaAvailabilityBody");
    expect(body).toContain("#### Flow\n\n```mermaid\nflowchart LR");
    expect(body).not.toContain("### Problem");
    expect(body).not.toContain("Affected files");
    expect(body).toContain("The whole plan is on yusufseyrek/facts-a-day-backend#26.");
    expect(lines[lines.length - 1]).toMatch(/^<!-- aiswec-from:v1 /);
    expect(parseFromLine(body)).toEqual({
      repo: "yusufseyrek/facts-a-day-backend",
      issue: 26,
      spec: 2345678901,
      todo: "ship the mobile release that sends the answered ids in the request body instead of the query string: mobile repo, then app store and play store",
      when: "after",
    });
  });

  test("a step needed before says so, and a plan-less hand-off is the words and the pointer", () => {
    const body = handoffBody({ context: "", source: SOURCE, plan: null, todo: TODO, when: "before" });
    expect(body.startsWith("From a manual todo on yusufseyrek/facts-a-day-backend#26 (Trivia questions are not loading): that plan waits for this task before AISWEC builds it.")).toBe(true);
    expect(body).not.toContain("### From that plan");
    expect(parseFromLine(body)?.when).toBe("before");
  });

  test("under the cap the Flow goes first, then the Code sketch, then the quote", () => {
    const full = handoffBody({ context: "", source: SOURCE, plan: PLAN, todo: TODO, when: "after" });
    expect(full.length).toBeLessThanOrEqual(HANDOFF_CAP);
    const noFlow = handoffBody({ context: "", source: SOURCE, plan: PLAN, todo: TODO, when: "after", cap: full.length - 1 });
    expect(noFlow).not.toContain("#### Flow");
    expect(noFlow).toContain("#### Code sketch");
    const noSchema = handoffBody({ context: "", source: SOURCE, plan: PLAN, todo: TODO, when: "after", cap: noFlow.length - 1 });
    expect(noSchema).not.toContain("#### Code sketch");
    expect(noSchema).toContain("Contract:");
    const bare = handoffBody({ context: "", source: SOURCE, plan: PLAN, todo: TODO, when: "after", cap: 10 });
    expect(bare).not.toContain("### From that plan");
    expect(bare).toContain("The whole plan is on");
    expect(parseFromLine(bare)).not.toBeNull();
  });
});
