import { describe, expect, test } from "bun:test";
import { marker } from "../src/protocol/markers.js";
import {
  classifyBotComment,
  deriveIssueState,
  splitSpecFooter,
  type StateComment,
  type StateIssue,
} from "../src/protocol/state.js";

const REPO = "yusufseyrek/aiswec-sandbox";
const OPTIONS = {
  branchPrefix: "aiswec",
  botLogins: ["github-actions[bot]", "aiswec[bot]"],
  maintainers: ["yusufseyrek"],
  reservedPrefixes: ["/deploy"],
  repo: REPO,
};

let nextId = 1;
const at = (minute: number) => `2026-08-26T12:${String(minute).padStart(2, "0")}:00Z`;
const comment = (author: string, body: string, minute: number, extra: Partial<StateComment> = {}): StateComment => ({
  id: nextId++,
  author,
  body,
  createdAt: at(minute),
  ...extra,
});

const SPEC = `${marker("spec")}\n## Implementation Spec\n\n### Problem\nx\n\n---\n\nReply with "approve" to build this spec.`;
const ACK = (mark: string, run: number, minute: number) =>
  comment("aiswec[bot]", `${mark} Working ([run](https://github.com/${REPO}/actions/runs/${run})).`, minute);

function issue(overrides: Partial<StateIssue>): StateIssue {
  return { number: 7, state: "open", labels: [], comments: [], pulls: [], ...overrides };
}

describe("deriveIssueState", () => {
  test("an issue without the assignment label is unassigned whatever else it carries", () => {
    const state = deriveIssueState(issue({ labels: ["aiswec:refined"] }), OPTIONS);
    expect(state.assigned).toBe(false);
    expect(state.column).toBe("unassigned");
  });

  test("assigned with no state and no ack is new", () => {
    expect(deriveIssueState(issue({ labels: ["aiswec"] }), OPTIONS).column).toBe("new");
  });

  test("a surviving ack means a run in flight, and names the stage", () => {
    const state = deriveIssueState(
      issue({ labels: ["aiswec"], comments: [ACK("⏳", 123, 1)] }),
      OPTIONS,
    );
    expect(state.running).toEqual({
      kind: "refine",
      runId: 123,
      runUrl: `https://github.com/${REPO}/actions/runs/123`,
      since: at(1),
    });
    expect(state.column).toBe("refining");
  });

  test("an ack from an untrusted author is text", () => {
    const state = deriveIssueState(
      issue({ labels: ["aiswec"], comments: [comment("stranger", ACK("🔨", 5, 1).body, 1)] }),
      OPTIONS,
    );
    expect(state.running).toBeNull();
  });

  test("an ack for another repository's run is ignored", () => {
    const body = `⏳ Analyzing ([run](https://github.com/someone/else/actions/runs/9)).`;
    const state = deriveIssueState(
      issue({ labels: ["aiswec"], comments: [comment("aiswec[bot]", body, 1)] }),
      OPTIONS,
    );
    expect(state.running).toBeNull();
  });

  test("a refined issue shows its spec, split from the footer, and awaits approval", () => {
    const state = deriveIssueState(
      issue({ labels: ["aiswec", "aiswec:refined"], comments: [comment("aiswec[bot]", SPEC, 2)] }),
      OPTIONS,
    );
    expect(state.column).toBe("awaiting-approval");
    expect(state.spec?.body).toBe("## Implementation Spec\n\n### Problem\nx");
    expect(state.spec?.footer).toBe('Reply with "approve" to build this spec.');
    expect(state.spec?.edited).toBe(false);
    expect(state.approval).toBeNull();
  });

  test("an edited spec is flagged", () => {
    const state = deriveIssueState(
      issue({
        labels: ["aiswec", "aiswec:refined"],
        comments: [comment("aiswec[bot]", SPEC, 2, { updatedAt: at(3) })],
      }),
      OPTIONS,
    );
    expect(state.spec?.edited).toBe(true);
  });

  test("a maintainer approval newer than the spec is recorded; an older one is not", () => {
    const older = deriveIssueState(
      issue({
        labels: ["aiswec", "aiswec:refined"],
        comments: [comment("yusufseyrek", "approve", 1), comment("aiswec[bot]", SPEC, 2)],
      }),
      OPTIONS,
    );
    expect(older.approval).toBeNull();

    const newer = deriveIssueState(
      issue({
        labels: ["aiswec", "aiswec:refined"],
        comments: [comment("aiswec[bot]", SPEC, 2), comment("yusufseyrek", "approve but rename it", 3)],
      }),
      OPTIONS,
    );
    expect(newer.approval).toEqual({ author: "yusufseyrek", createdAt: at(3), qualified: true });
  });

  test("an approval nothing of the bot's followed is the build's turn, until the bot's next word", () => {
    const refined = ["aiswec", "aiswec:refined"];
    const approved = deriveIssueState(issue({ labels: refined, comments: [comment("aiswec[bot]", SPEC, 2), comment("yusufseyrek", "approve", 3)] }), OPTIONS);
    expect(approved.column).toBe("building");
    expect(approved.running).toBeNull();
    // The build's ack keeps it there, as a run.
    const acked = deriveIssueState(issue({ labels: refined, comments: [comment("aiswec[bot]", SPEC, 2), comment("yusufseyrek", "approve", 3), ACK("🔨", 5, 4)] }), OPTIONS);
    expect(acked.column).toBe("building");
    expect(acked.running?.kind).toBe("build");
    // A notice after the approval on a still-refined issue hands it back: the plan changed, approve again.
    const stale = deriveIssueState(
      issue({ labels: refined, comments: [comment("aiswec[bot]", SPEC, 2), comment("yusufseyrek", "approve", 3), comment("aiswec[bot]", "A newer spec was posted after that approval, so aiswec build stopped", 4)] }),
      OPTIONS,
    );
    expect(stale.column).toBe("awaiting-approval");
    // Held wins, as everywhere.
    expect(deriveIssueState(issue({ labels: [...refined, "aiswec:hold"], comments: [comment("aiswec[bot]", SPEC, 2), comment("yusufseyrek", "approve", 3)] }), OPTIONS).column).toBe("held");
  });

  test("the spec's Manual todos are the person's steps, ticked by their latest done comment after it", () => {
    const planned = `${marker("spec")}\n> [!NOTE]\n> Words.\n\n## Implementation Spec\n\n### Manual todos\n\n- Add the secret.\n- Grant the permission.\n\n### Problem\nx`;
    const none = deriveIssueState(issue({ labels: ["aiswec", "aiswec:refined"], comments: [comment("aiswec[bot]", SPEC, 2)] }), OPTIONS);
    expect(none.todos).toBeNull();
    const open = deriveIssueState(issue({ labels: ["aiswec", "aiswec:refined"], comments: [comment("aiswec[bot]", planned, 2)] }), OPTIONS);
    expect(open.todos).toEqual({
      items: [
        { done: false, text: "Add the secret.", followUp: null, task: null, blocks: true },
        { done: false, text: "Grant the permission.", followUp: null, task: null, blocks: true },
      ],
      total: 2,
      done: 0,
      left: 2,
    });
    const ticked = deriveIssueState(
      issue({
        labels: ["aiswec", "aiswec:refined"],
        comments: [
          comment("aiswec[bot]", planned, 2),
          comment("yusufseyrek", "<!-- aiswec-done:v1 -->\nMy part, as it stands:\n\n- [x] Add the secret.\n- [ ] Grant the permission.", 3),
          comment("someone", "<!-- aiswec-done:v1 -->\n- [x] Grant the permission.", 4),
        ],
      }),
      OPTIONS,
    );
    // Only a maintainer's word counts; the latest of theirs is the one read.
    expect(ticked.todos?.done).toBe(1);
    expect(ticked.todos?.items[0]?.done).toBe(true);
    // A done comment older than the spec is not read against it.
    const older = deriveIssueState(
      issue({ labels: ["aiswec", "aiswec:refined"], comments: [comment("yusufseyrek", "<!-- aiswec-done:v1 -->\n- [x] Add the secret.", 1), comment("aiswec[bot]", planned, 2)] }),
      OPTIONS,
    );
    expect(older.todos?.done).toBe(0);
  });

  test("a task made from a step carries over a re-run by the step's words, and a follow-up never blocks", () => {
    const release = "Ship the mobile release that sends the ids in the body: mobile repo.";
    const first = `${marker("spec")}\n> [!NOTE]\n> Words.\n\n## Implementation Spec\n\n### Manual todos\n\n- ${release}\n\n### Problem\nx`;
    const again = `${marker("spec")}\n> [!NOTE]\n> Words.\n\n## Implementation Spec\n\n### Manual todos\n\n- Follow-up in facts-a-day-app: ${release}\n- Add the secret.\n\n### Problem\nx`;
    const handed = `<!-- aiswec-done:v1 -->\nManual todos, as they stand:\n\n- [ ] ${release}\n  - Task: yusufseyrek/facts-a-day-app#31, after this plan is built`;
    const linked = deriveIssueState(issue({ labels: ["aiswec", "aiswec:refined"], comments: [comment("aiswec[bot]", first, 2), comment("yusufseyrek", handed, 3)] }), OPTIONS);
    expect(linked.todos?.items[0]?.task).toEqual({ repo: "yusufseyrek/facts-a-day-app", number: 31, when: "after" });
    expect(linked.todos).toMatchObject({ total: 1, done: 0, left: 0 });
    // The plan written again: the done comment is older than the spec, its tick would not count, its task still does.
    const rerun = deriveIssueState(issue({ labels: ["aiswec", "aiswec:refined"], comments: [comment("aiswec[bot]", first, 2), comment("yusufseyrek", handed, 3), comment("aiswec[bot]", again, 4)] }), OPTIONS);
    expect(rerun.todos?.items[0]).toMatchObject({ task: { number: 31 }, followUp: { repo: "facts-a-day-app" }, blocks: false });
    expect(rerun.todos?.items[1]).toMatchObject({ task: null, blocks: true });
    expect(rerun.todos).toMatchObject({ total: 2, done: 0, left: 1 });
  });

  test("an ack naming a run the caller knows has finished is stale, not a run in flight", () => {
    const ack = comment("aiswec[bot]", `🔨 Working ([run](https://github.com/${REPO}/actions/runs/44)).`, 3);
    const live = deriveIssueState(issue({ labels: ["aiswec", "aiswec:ready-to-build"], comments: [comment("aiswec[bot]", SPEC, 2), ack] }), OPTIONS);
    expect(live.running?.runId).toBe(44);
    const stale = deriveIssueState(issue({ labels: ["aiswec", "aiswec:ready-to-build"], comments: [comment("aiswec[bot]", SPEC, 2), ack] }), { ...OPTIONS, finishedRuns: [44] });
    expect(stale.running).toBeNull();
    // Another run's ack still counts.
    const other = deriveIssueState(issue({ labels: ["aiswec", "aiswec:ready-to-build"], comments: [comment("aiswec[bot]", SPEC, 2), ack] }), { ...OPTIONS, finishedRuns: [45] });
    expect(other.running?.runId).toBe(44);
  });

  test("hold is a column of its own, only when nothing is running", () => {
    expect(deriveIssueState(issue({ labels: ["aiswec", "aiswec:refined", "aiswec:hold"] }), OPTIONS).column).toBe("held");
    expect(
      deriveIssueState(issue({ labels: ["aiswec", "aiswec:hold"], comments: [ACK("🔨", 1, 1)] }), OPTIONS).column,
    ).toBe("building");
  });

  test("pr-open with the matching open PR is in review; without one it is a dead end", () => {
    const pull = { number: 8, headRefName: "aiswec/issue-7-x", isDraft: false, merged: false, state: "open" as const };
    expect(deriveIssueState(issue({ labels: ["aiswec", "aiswec:pr-open"], pulls: [pull] }), OPTIONS).column).toBe("in-review");
    expect(deriveIssueState(issue({ labels: ["aiswec", "aiswec:pr-open"] }), OPTIONS).column).toBe("dead-end");
  });

  test("revise's ack on the PR counts for the issue", () => {
    const pull = { number: 8, headRefName: "aiswec/issue-7-x", isDraft: false, merged: false, state: "open" as const };
    const state = deriveIssueState(
      issue({ labels: ["aiswec", "aiswec:pr-open"], pulls: [pull], pullComments: [ACK("💬", 44, 5)] }),
      OPTIONS,
    );
    expect(state.column).toBe("responding");
    expect(state.running?.runId).toBe(44);
  });

  test("needs-human names the bot's reason", () => {
    const state = deriveIssueState(
      issue({
        labels: ["aiswec", "aiswec:needs-human"],
        comments: [comment("aiswec[bot]", "aiswec build failed or produced no PR (engine outcome: failure). Run: x", 4)],
      }),
      OPTIONS,
    );
    expect(state.column).toBe("needs-human");
    expect(state.reason).toBe("no-pr");
  });

  test("two state labels is inconsistent, not a guess", () => {
    const state = deriveIssueState(issue({ labels: ["aiswec", "aiswec:refined", "aiswec:pr-open"] }), OPTIONS);
    expect(state.inconsistent).toBe(true);
    expect(state.column).toBe("inconsistent");
  });

  test("a closed issue is done when its PR merged, closed otherwise", () => {
    const pull = { number: 8, headRefName: "aiswec/issue-7-x", isDraft: false, merged: true, state: "closed" as const };
    expect(deriveIssueState(issue({ state: "closed", labels: ["aiswec", "aiswec:pr-open"], pulls: [pull] }), OPTIONS).column).toBe("done");
    expect(deriveIssueState(issue({ state: "closed", labels: ["aiswec"] }), OPTIONS).column).toBe("closed");
  });
});

describe("classifyBotComment", () => {
  test("recognises the finalizers' texts and the escalation marker", () => {
    expect(classifyBotComment("aiswec refine failed or produced no spec (engine outcome: failure). Run: x")).toBe("refine-failed");
    expect(classifyBotComment("A newer spec was posted after that approval, so aiswec build stopped")).toBe("stale-spec");
    expect(classifyBotComment("aiswec cannot start: `.github/aiswec.yml`, effort must be …")).toBe("settings-invalid");
    expect(classifyBotComment("aiswec cannot start: the model `qwen/qwen3-coder` holds 262144 tokens of context, and AISWEC runs on models with 1,000,000 or more.")).toBe("model-too-small");
    expect(classifyBotComment(`${marker("escalate")}\nToo vague.`)).toBe("escalated");
    expect(classifyBotComment(`${marker("questions")}\nBefore I plan this.\n\n### 1. Which?\n- (a) This\n- (b) That`)).toBe("questions");
    expect(classifyBotComment("Done, DEFAULT_NAME is exported.")).toBeNull();
  });
});

describe("splitSpecFooter", () => {
  test("splits at the last rule and trims both halves", () => {
    expect(splitSpecFooter("a\n\n---\n\nb\n")).toEqual({ body: "a", footer: "b" });
    expect(splitSpecFooter("no footer")).toEqual({ body: "no footer", footer: null });
  });
});
