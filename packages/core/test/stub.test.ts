import { describe, expect, test } from "bun:test";
import { parseStub } from "../src/protocol/stub.js";

const TENANT = `
name: aiswec Refine
on:
  issues:
    types: [opened, labeled]
  workflow_dispatch:
    inputs:
      issue_number: { required: true, type: string }
permissions: { contents: read, issues: write, id-token: write }
jobs:
  refine:
    if: github.event_name == 'workflow_dispatch' || !endsWith(github.actor, '[bot]')
    uses: yusufseyrek/aiswec/.github/workflows/stage-refine.yml@v2
    secrets:
      claude_code_oauth_token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
    with:
      namespace: aiswec
`;

const LOCAL_BUILD = `
on: { workflow_dispatch: {}, issues: { types: [labeled] }, issue_comment: { types: [created] } }
jobs:
  build:
    uses: ./.github/workflows/stage-build.yml
    with:
      namespace: bot
      branch_prefix: bot
`;

const TENANT_BUILD = `
on:
  issues: { types: [labeled] }
  issue_comment: { types: [created] }
jobs:
  build:
    uses: yusufseyrek/aiswec/.github/workflows/stage-build.yml@v2
    secrets:
      claude_code_oauth_token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
      expo_token: \${{ secrets.EXPO_TOKEN }}
    with:
      namespace: aiswec
`;

const INHERITING_REVISE = `
on:
  issue_comment: { types: [created] }
jobs:
  revise:
    uses: yusufseyrek/aiswec/.github/workflows/stage-revise.yml@v2
    secrets: inherit
`;

describe("parseStub", () => {
  test("reads a tenant refine stub pinned to a tag", () => {
    expect(parseStub(TENANT)).toEqual({
      stage: "refine",
      source: "yusufseyrek/aiswec",
      ref: "v2",
      namespace: "aiswec",
      branchPrefix: null,
      assignable: true,
      secrets: ["claude_code_oauth_token"],
    });
  });

  test("reads a same-repo build stub and its structural inputs", () => {
    expect(parseStub(LOCAL_BUILD)).toEqual({
      stage: "build",
      source: null,
      ref: null,
      namespace: "bot",
      branchPrefix: "bot",
      assignable: null,
      secrets: null,
    });
  });

  // 2026-09-06: the doctor asks whether `expo_token` reaches the stage. The
  // keys are what is read, never a value.
  test("reads the keys of the secrets a stub hands on, and inherit as the word", () => {
    expect(parseStub(TENANT_BUILD)?.secrets).toEqual(["claude_code_oauth_token", "expo_token"]);
    expect(parseStub(INHERITING_REVISE)?.secrets).toBe("inherit");
    expect(parseStub(INHERITING_REVISE)?.stage).toBe("revise");
    expect(parseStub(LOCAL_BUILD)?.secrets).toBeNull();
    // A secrets block that is neither a map nor the word reads as absent.
    expect(parseStub(TENANT_BUILD.replace(/secrets:[\s\S]*?with:/, "secrets: [a, b]\n    with:"))?.secrets).toBeNull();
  });

  test("a v1 refine stub is not assignable", () => {
    const v1 = TENANT.replace("types: [opened, labeled]", "types: [opened]").replace("@v2", "@v1");
    expect(parseStub(v1)?.assignable).toBe(false);
    expect(parseStub(v1)?.ref).toBe("v1");
  });

  test("a workflow that is not a stub is null", () => {
    expect(parseStub("on: push\njobs:\n  ci:\n    runs-on: ubuntu-latest\n    steps: []\n")).toBeNull();
    expect(parseStub("jobs:\n  x:\n    uses: someone/else/.github/workflows/deploy.yml@v1\n")).toBeNull();
    expect(parseStub("not: [yaml")).toBeNull();
  });
});
