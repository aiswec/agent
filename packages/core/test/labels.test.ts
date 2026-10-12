import { describe, expect, test } from "bun:test";
import {
  activeState,
  HUB_STATES,
  isHeld,
  labelDefinitions,
  labelName,
  planTransition,
  REPO_STATES, assignmentLabel, isAssigned } from "../src/protocol/labels.js";

const hub = { states: HUB_STATES };
const repo = { states: REPO_STATES };

describe("planTransition", () => {
  test("adds the target state", () => {
    const plan = planTransition([], "awaiting-approval", hub);

    expect(plan.add).toEqual(["aiswec:awaiting-approval"]);
    expect(plan.remove).toEqual([]);
  });

  test("clears the previous state when entering a new one", () => {
    const plan = planTransition(["aiswec:awaiting-input"], "awaiting-approval", hub);

    expect(plan.remove).toEqual(["aiswec:awaiting-input"]);
    expect(plan.final).toEqual(["aiswec:awaiting-approval"]);
  });

  test("clears a stale failure label on the success path", () => {
    // The rot the source system suffered: a success transition that forgot to
    // drop needs-human, leaving the issue in two states at once.
    const plan = planTransition(["aiswec:needs-human"], "routed", hub);

    expect(plan.remove).toEqual(["aiswec:needs-human"]);
    expect(activeState(plan.final, hub)).toBe("routed");
  });

  test("preserves hold and any unrelated labels", () => {
    const plan = planTransition(
      ["bug", "aiswec:hold", "aiswec:refined"],
      "ready-to-build",
      repo,
    );

    expect(plan.final).toContain("bug");
    expect(plan.final).toContain("aiswec:hold");
    expect(plan.final).not.toContain("aiswec:refined");
  });

  test("is a no-op when already in the target state", () => {
    const plan = planTransition(["aiswec:routed"], "routed", hub);

    expect(plan.add).toEqual([]);
    expect(plan.remove).toEqual([]);
    expect(plan.final).toEqual(["aiswec:routed"]);
  });

  test("leaves the machine entirely when the target is null", () => {
    const plan = planTransition(["aiswec:pr-open", "bug"], null, repo);

    expect(plan.remove).toEqual(["aiswec:pr-open"]);
    expect(plan.final).toEqual(["bug"]);
  });

  test("refuses an undeclared state", () => {
    expect(() => planTransition([], "shipped", hub)).toThrow(/unknown state/);
  });

  test("honours the namespace", () => {
    const plan = planTransition([], "routed", { states: HUB_STATES, namespace: "acme" });

    expect(plan.add).toEqual(["acme:routed"]);
  });
});

describe("activeState", () => {
  test("returns null when the issue is not in the machine", () => {
    expect(activeState(["bug"], hub)).toBeNull();
  });

  test("enforces the single-state invariant", () => {
    expect(() => activeState(["aiswec:routed", "aiswec:needs-human"], hub)).toThrow(
      /single-state invariant/,
    );
  });

  test("does not count hold as a state", () => {
    expect(activeState(["aiswec:hold", "aiswec:refined"], repo)).toBe("refined");
  });
});

describe("hold", () => {
  test("detects the brake", () => {
    expect(isHeld(["aiswec:hold"])).toBe(true);
    expect(isHeld(["aiswec:refined"])).toBe(false);
  });
});

describe("labelDefinitions", () => {
  test("covers every declared state plus hold", () => {
    const names = labelDefinitions().map((label) => label.name);

    for (const state of [...HUB_STATES, ...REPO_STATES]) {
      expect(names).toContain(labelName(state));
    }
    expect(names).toContain("aiswec:hold");
  });

  test("includes the assignment label, which is the bare namespace", () => {
    expect(labelDefinitions().map((label) => label.name)).toContain("aiswec");
    expect(assignmentLabel("bot")).toBe("bot");
    expect(isAssigned(["bot", "bot:refined"], "bot")).toBe(true);
    expect(isAssigned(["bot:refined"], "bot")).toBe(false);
  });

  test("gives every label a colour and a description to provision with", () => {
    for (const label of labelDefinitions()) {
      expect(label.color).toMatch(/^[0-9a-f]{6}$/);
      expect(label.description.length).toBeGreaterThan(0);
    }
  });
});
