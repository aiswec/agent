/**
 * One task asked of several projects: the with line at the end of each body,
 * which Suite reads back, the sentence the engine reads in its place, and the
 * comment a waiting task is started with.
 */
import { describe, expect, test } from "bun:test";
import { classifyComment, marker, otherTasks, parseWithLine, sameTask, sharedBody, sharedRole, sharedSentence, startComment, withLine, type WithLine } from "../src/index.js";

const BACKEND = { repo: "o/backend", number: 41 };
const APP = { repo: "o/app", number: 88 };
const WEB = { repo: "o/web", number: 12 };

const TOGETHER: WithLine = { tasks: [BACKEND, APP], lead: null };
const LEAD_FIRST: WithLine = { tasks: [BACKEND, APP], lead: BACKEND };

const PLAN = `${marker("spec")}
> [!NOTE]
> Favourites are saved on the server, one row per person and fact.

## Implementation Spec

### At a glance

Size M · Files 4 · Contract POST /favorites {factId}, GET /favorites

### Proposed approach

1. Add the table.

### Code sketch

\`\`\`ts
interface Favorite {
  factId: number;
}
\`\`\`

### Flow

- tap the heart → POST /favorites → saved

---

Reply approve.`;

/** What every stage does to an issue before the engine reads it: every HTML comment out but a bare marker of its own. */
function stripped(body: string): string {
  return body.replace(/<!--(?!\s*aiswec-[a-z]+:v1\s*-->)[\s\S]{0,4000}?-->/g, "");
}

describe("the with line", () => {
  test("names every task of the set and the one planned first, and reads back as written", () => {
    const line = withLine(LEAD_FIRST);
    expect(line).toBe('<!-- aiswec-with:v1 {"tasks":["o/backend#41","o/app#88"],"lead":"o/backend#41"} -->');
    expect(parseWithLine(`Save favourites.\n\n${line}`)).toEqual(LEAD_FIRST);
    expect(withLine(TOGETHER)).toBe('<!-- aiswec-with:v1 {"tasks":["o/backend#41","o/app#88"]} -->');
    expect(parseWithLine(withLine(TOGETHER))).toEqual(TOGETHER);
    expect(parseWithLine(withLine({ tasks: [BACKEND, APP], lead: APP }, "acme"), "acme")?.lead).toEqual(APP);
  });

  test("is never guessed at: a body without one, a broken one, a lone task, a project named twice, a lead outside the set", () => {
    expect(parseWithLine("Save favourites.")).toBeNull();
    expect(parseWithLine('<!-- aiswec-with:v1 {"tasks":["o/backend#41"] -->')).toBeNull();
    expect(parseWithLine('<!-- aiswec-with:v1 {"tasks":["o/backend#41"]} -->')).toBeNull();
    expect(parseWithLine('<!-- aiswec-with:v1 {"tasks":["o/backend#41","O/Backend#42"]} -->')).toBeNull();
    expect(parseWithLine('<!-- aiswec-with:v1 {"tasks":["o/backend#41","o/app#88"],"lead":"o/web#12"} -->')).toBeNull();
    expect(parseWithLine('<!-- aiswec-with:v1 {"tasks":["o/backend#0","o/app#88"]} -->')).toBeNull();
    expect(parseWithLine('<!-- aiswec-with:v2 {"tasks":["o/backend#41","o/app#88"]} -->')).toBeNull();
    expect(() => withLine({ tasks: [BACKEND, { repo: "o/backend", number: 42 }], lead: null })).toThrow();
    expect(() => withLine({ tasks: [BACKEND, APP], lead: WEB })).toThrow();
    expect(() => withLine({ tasks: [BACKEND], lead: null })).toThrow();
  });

  test("says where a task stands and which are the others, whatever the case of a name", () => {
    expect(sharedRole(TOGETHER, APP)).toBe("together");
    expect(sharedRole(LEAD_FIRST, BACKEND)).toBe("lead");
    expect(sharedRole(LEAD_FIRST, { repo: "O/App", number: 88 })).toBe("waits");
    expect(otherTasks({ tasks: [BACKEND, APP, WEB], lead: null }, { repo: "O/APP", number: 88 })).toEqual([BACKEND, WEB]);
    expect(sameTask(BACKEND, { repo: "O/Backend", number: 41 })).toBe(true);
    expect(sameTask(BACKEND, { repo: "o/backend", number: 42 })).toBe(false);
  });
});

describe("the sentence", () => {
  test("planned together, each task asks for its own part and names the others so GitHub links them", () => {
    expect(sharedSentence(TOGETHER, BACKEND)).toBe(
      "This task is shared with o/app#88, where AISWEC plans that repository's part at the same time. Plan only this repository's part, and put what the two must agree on (an endpoint, a payload, a name) in the Code sketch.",
    );
    expect(sharedSentence({ tasks: [BACKEND, APP, WEB], lead: null }, APP)).toBe(
      "This task is shared with o/backend#41 and o/web#12, where AISWEC plans their parts at the same time. Plan only this repository's part, and put what they must agree on (an endpoint, a payload, a name) in the Code sketch.",
    );
  });

  test("one planned first: the first says the others build against it, the others say they wait for it", () => {
    expect(sharedSentence(LEAD_FIRST, BACKEND)).toBe(
      "This task is shared with o/app#88, which AISWEC plans once this plan is approved, against it. Plan only this repository's part, and put what the other side builds against (an endpoint, a payload, a name) in the Code sketch.",
    );
    expect(sharedSentence(LEAD_FIRST, APP)).toBe("This task is shared with o/backend#41. AISWEC plans o/backend#41 first, and this one once that plan is approved, against it. Plan only this repository's part.");
    expect(sharedSentence({ tasks: [BACKEND, APP, WEB], lead: BACKEND }, BACKEND)).toContain("what the others build against");
  });

  test("the body is the person's words, the sentence, then the line; the engine reads the sentence and never the line", () => {
    const body = sharedBody({ body: "  Let people save favourite facts.\n\nKeep the heart where it is.  ", line: LEAD_FIRST, self: APP });
    const parts = body.split("\n\n");
    expect(parts[0]).toBe("Let people save favourite facts.");
    expect(parts[1]).toBe("Keep the heart where it is.");
    expect(parts[2]).toBe(sharedSentence(LEAD_FIRST, APP));
    expect(parts[3]).toBe(withLine(LEAD_FIRST));
    expect(parseWithLine(body)).toEqual(LEAD_FIRST);
    const seen = stripped(body);
    expect(seen).toContain(sharedSentence(LEAD_FIRST, APP));
    expect(seen).not.toContain("aiswec-with");
    expect(sharedBody({ body: "", line: TOGETHER, self: BACKEND })).toBe(`${sharedSentence(TOGETHER, BACKEND)}\n\n${withLine(TOGETHER)}`);
  });
});

describe("the start comment", () => {
  const lead = { repo: "o/backend", issue: 41, title: "Save favourite facts" };
  const APPROVAL_KEYWORDS = ["approve", "approved", "lgtm", "ship it", "go ahead"];

  test("quotes the approved plan's contract, says it is settled, and points at the whole plan", () => {
    const text = startComment({ lead, plan: PLAN, approved: true });
    expect(text.startsWith("Plan this against the approved plan on o/backend#41 (Save favourite facts). What it says this side builds against is settled;")).toBe(true);
    expect(text).toContain("### From that plan");
    expect(text).toContain("> [!NOTE]\n> Favourites are saved on the server, one row per person and fact.");
    expect(text).toContain("Contract: POST /favorites {factId}, GET /favorites");
    expect(text).toContain("#### Code sketch");
    expect(text).toContain("#### Flow\n\n- tap the heart → POST /favorites → saved");
    expect(text).not.toContain("Add the table.");
    expect(text.endsWith("The whole plan is on o/backend#41.")).toBe(true);
  });

  test("says when the plan is not approved yet, and goes ahead without one when there is none", () => {
    expect(startComment({ lead, plan: PLAN, approved: false }).split("\n")[0]).toBe("Plan this against the plan on o/backend#41 (Save favourite facts), which is not approved yet and may still change.");
    expect(startComment({ lead, plan: null, approved: false })).toBe("Plan this now, without waiting for o/backend#41 (Save favourite facts) to be planned first. Plan only this repository's part.");
  });

  test("never reads as an approval, and gives up the Flow, then the Code sketch, to fit its cap", () => {
    for (const approved of [true, false]) {
      expect(classifyComment(startComment({ lead, plan: PLAN, approved }), { keywords: APPROVAL_KEYWORDS }).kind).toBe("feedback");
    }
    const whole = startComment({ lead, plan: PLAN, approved: true });
    const tight = startComment({ lead, plan: PLAN, approved: true, cap: whole.length - 1 });
    expect(tight).not.toContain("#### Flow");
    expect(tight).toContain("#### Code sketch");
    const tighter = startComment({ lead, plan: PLAN, approved: true, cap: 400 });
    expect(tighter).not.toContain("#### Code sketch");
    expect(tighter).toContain("Contract: POST /favorites");
  });
});
