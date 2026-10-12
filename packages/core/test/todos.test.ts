/**
 * Manual todos round-trip: the document names the steps, the person's comment
 * carries the ticks, and the merge is what every screen shows. The comment is
 * matched by the words of each step, so it may be older than the document.
 * A step handed to another project carries its task under it, and a step the
 * engine wrote as a follow-up never blocks the approval (2026-09-17).
 */
import { describe, expect, test } from "bun:test";
import { doneComment, followUp, manualTodos, parseDone, stepKey, taskLine } from "../src/index.js";

const LISTED = [
  { done: false, text: "Add the `EXPO_TOKEN` secret in Settings, Secrets and variables, Actions." },
  { done: false, text: "Grant the aiswec App Workflows: write, then accept it on the installation." },
];

const RELEASE = "Ship the mobile release that sends the answered ids in the request body instead of the query string: mobile repo, then App Store and Play Store.";
const TASK = { repo: "yusufseyrek/facts-a-day-app", number: 31, when: "after" as const };

describe("manual todos", () => {
  test("the done comment is the marker over the list with its boxes, and reads back", () => {
    const body = doneComment([{ ...LISTED[0]!, done: true }, LISTED[1]!]);
    expect(body.split("\n")[0]).toBe("<!-- aiswec-done:v1 -->");
    expect(body).toContain("- [x] Add the `EXPO_TOKEN` secret");
    expect(body).toContain("- [ ] Grant the aiswec App");
    expect(parseDone(body)).toEqual([
      { ...LISTED[0]!, done: true, task: null },
      { ...LISTED[1]!, task: null },
    ]);
  });

  test("a comment without the marker is not a done comment", () => {
    expect(parseDone("- [x] Add the secret")).toBeNull();
    expect(parseDone("approve")).toBeNull();
  });

  test("the merge counts a step done when the document or the comment ticks it, by its words", () => {
    expect(manualTodos(undefined)).toBeNull();
    expect(manualTodos([])).toBeNull();
    const none = manualTodos(LISTED);
    expect(none).toEqual({
      items: LISTED.map((item) => ({ ...item, followUp: null, task: null, blocks: true })),
      total: 2,
      done: 0,
      left: 2,
    });
    const ticked = manualTodos(LISTED, [{ done: true, text: "add the `expo_token` secret in settings,  secrets and variables, actions", task: null }]);
    expect(ticked?.done).toBe(1);
    expect(ticked?.left).toBe(1);
    expect(ticked?.items[0]?.done).toBe(true);
    expect(ticked?.items[0]?.blocks).toBe(false);
    // A step the document no longer names is not counted; one the document ticks itself is.
    const stale = manualTodos([{ done: true, text: "New step" }], [{ done: true, text: "Old step", task: null }]);
    expect(stale).toEqual({ items: [{ done: true, text: "New step", followUp: null, task: null, blocks: false }], total: 1, done: 1, left: 0 });
  });

  test("a step's key ignores case, spacing, the full stop and the follow-up prefix", () => {
    expect(stepKey("  Add the  secret. ")).toBe("add the secret");
    expect(stepKey("Follow-up in facts-a-day-app: Add the secret.")).toBe("add the secret");
    expect(stepKey("Follow-up in `yusufseyrek/facts-a-day-app`: Add the secret")).toBe("add the secret");
  });

  test("an empty list cannot be written", () => {
    expect(() => doneComment([])).toThrow();
  });

  test("a step the engine wrote as a follow-up names its repository and never blocks", () => {
    expect(followUp("Follow-up in facts-a-day-app: send the ids in the body.")).toEqual({ repo: "facts-a-day-app", text: "send the ids in the body." });
    expect(followUp("Follow-up in `yusufseyrek/facts-a-day-app`: send the ids in the body")).toEqual({ repo: "yusufseyrek/facts-a-day-app", text: "send the ids in the body" });
    expect(followUp("Add the secret: in Settings.")).toBeNull();
    const merged = manualTodos([{ done: false, text: "Follow-up in facts-a-day-app: send the ids in the body." }, LISTED[0]!]);
    expect(merged?.items[0]).toMatchObject({ followUp: { repo: "facts-a-day-app" }, blocks: false, done: false });
    expect(merged?.items[1]?.blocks).toBe(true);
    expect(merged).toMatchObject({ total: 2, done: 0, left: 1 });
  });

  test("a step handed to another project carries its task under it in the comment, and reads back", () => {
    const body = doneComment([{ done: false, text: RELEASE, task: TASK }, LISTED[0]!]);
    expect(body).toContain(`- [ ] ${RELEASE}\n  - Task: yusufseyrek/facts-a-day-app#31, after this plan is built\n- [ ] Add`);
    expect(taskLine({ ...TASK, when: "before" })).toBe("Task: yusufseyrek/facts-a-day-app#31, before AISWEC builds it");
    expect(parseDone(body)).toEqual([
      { done: false, text: RELEASE, task: TASK },
      { ...LISTED[0]!, task: null },
    ]);
    // A task line reads "after" when it says nothing, and one above every step belongs to nothing.
    expect(parseDone("<!-- aiswec-done:v1 -->\n- Task: o/r#1\n- [ ] Step\n  - Task: o/r#2")).toEqual([{ done: false, text: "Step", task: { repo: "o/r", number: 2, when: "after" } }]);
    expect(parseDone("<!-- aiswec-done:v1 -->\n- [ ] Step\n  - Task: o/r#2, before AISWEC builds it")?.[0]?.task?.when).toBe("before");
  });

  test("a handed-off step releases the approval after, holds it before, and holds it again when the task is closed", () => {
    const listed = [{ done: false, text: RELEASE }];
    const after = manualTodos(listed, [{ done: false, text: RELEASE, task: TASK }]);
    expect(after?.items[0]).toMatchObject({ task: TASK, blocks: false, done: false });
    expect(after).toMatchObject({ done: 0, left: 0 });
    const before = manualTodos(listed, [{ done: false, text: RELEASE, task: { ...TASK, when: "before" } }]);
    expect(before?.left).toBe(1);
    // The caller says what became of the task: accepted releases even a "before"; closed as not planned holds an "after".
    expect(manualTodos(listed, [{ done: false, text: RELEASE, task: { ...TASK, when: "before" } }], { outcome: () => "done" })?.left).toBe(0);
    expect(manualTodos(listed, [{ done: false, text: RELEASE, task: TASK }], { outcome: () => "closed" })?.left).toBe(1);
    expect(manualTodos(listed, [{ done: false, text: RELEASE, task: TASK }], { outcome: () => "open" })?.left).toBe(0);
    // A tick is a tick, whatever the task did.
    expect(manualTodos(listed, [{ done: true, text: RELEASE, task: TASK }], { outcome: () => "closed" })?.left).toBe(0);
  });

  test("a task carries over from an older comment by the words of the step, ticks do not", () => {
    const listed = [{ done: false, text: `Follow-up in facts-a-day-app: ${RELEASE}` }];
    const merged = manualTodos(listed, null, { carried: [{ done: true, text: RELEASE, task: TASK }] });
    expect(merged?.items[0]).toMatchObject({ task: TASK, done: false, followUp: { repo: "facts-a-day-app" } });
    // The latest comment's task wins over the carried one.
    const newer = manualTodos(listed, [{ done: false, text: RELEASE, task: { ...TASK, number: 40 } }], { carried: [{ done: false, text: RELEASE, task: TASK }] });
    expect(newer?.items[0]?.task?.number).toBe(40);
  });
});
