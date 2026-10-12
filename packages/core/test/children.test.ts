import { describe, expect, test } from "bun:test";
import { extractChildren, selectUnfiled } from "../src/protocol/children.js";
import { childEndMarker, childStartMarker } from "../src/protocol/markers.js";

const REPO_KEYS = ["backend", "app"];

function plan(...lines: string[]): string {
  return lines.join("\n");
}

describe("extractChildren", () => {
  test("reads a child whose TITLE is the first line after the marker", () => {
    // The regression that motivates this parser: the sed range idiom this
    // replaces ate the entire draft in exactly this shape.
    const body = plan(
      "Here is the plan.",
      "",
      childStartMarker("backend"),
      "TITLE: Add a rate limiter",
      "",
      "Add a token bucket in front of the public API.",
      childEndMarker("backend"),
    );

    const { children, errors } = extractChildren(body, { repoKeys: REPO_KEYS });

    expect(errors).toEqual([]);
    expect(children).toHaveLength(1);
    expect(children[0]?.title).toBe("Add a rate limiter");
    expect(children[0]?.body).toBe("Add a token bucket in front of the public API.");
  });

  test("tolerates blank lines before the title", () => {
    const body = plan(
      childStartMarker("app"),
      "",
      "   ",
      "TITLE: Tidy the settings screen",
      "Move the toggles into one group.",
      childEndMarker("app"),
    );

    const { children, errors } = extractChildren(body, { repoKeys: REPO_KEYS });

    expect(errors).toEqual([]);
    expect(children[0]?.title).toBe("Tidy the settings screen");
  });

  test("keeps multiple children in document order", () => {
    const body = plan(
      childStartMarker("backend"),
      "TITLE: Expose the contract",
      "POST /v1/facts",
      childEndMarker("backend"),
      "",
      childStartMarker("app"),
      "TITLE: Consume the contract",
      "Call POST /v1/facts with a mocked network.",
      childEndMarker("app"),
    );

    const { children, errors } = extractChildren(body, { repoKeys: REPO_KEYS });

    expect(errors).toEqual([]);
    expect(children.map((child) => child.repo)).toEqual(["backend", "app"]);
  });

  test("preserves interior blank lines and markdown in the body", () => {
    const body = plan(
      childStartMarker("backend"),
      "TITLE: Something",
      "First paragraph.",
      "",
      "- bullet one",
      "- bullet two",
      childEndMarker("backend"),
    );

    const { children } = extractChildren(body, { repoKeys: REPO_KEYS });

    expect(children[0]?.body).toBe("First paragraph.\n\n- bullet one\n- bullet two");
  });

  test("treats marker-looking text inside a line as body text", () => {
    const body = plan(
      childStartMarker("backend"),
      "TITLE: Document the protocol",
      `The end marker looks like ${childEndMarker("backend")} when inline.`,
      childEndMarker("backend"),
    );

    const { children, errors } = extractChildren(body, { repoKeys: REPO_KEYS });

    expect(errors).toEqual([]);
    expect(children).toHaveLength(1);
    expect(children[0]?.body).toContain("when inline.");
  });

  test("normalises CRLF input", () => {
    const body = [
      childStartMarker("backend"),
      "TITLE: Windows line endings",
      "Body text.",
      childEndMarker("backend"),
    ].join("\r\n");

    const { children, errors } = extractChildren(body, { repoKeys: REPO_KEYS });

    expect(errors).toEqual([]);
    expect(children[0]?.title).toBe("Windows line endings");
    expect(children[0]?.body).toBe("Body text.");
  });

  test("drops a block with no end marker rather than guessing where it ends", () => {
    const body = plan(
      childStartMarker("backend"),
      "TITLE: Never closed",
      "Body that runs to the end of the comment.",
    );

    const { children, errors } = extractChildren(body, { repoKeys: REPO_KEYS });

    expect(children).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("never closed");
  });

  test("drops a block with no TITLE and still reads the next one", () => {
    const body = plan(
      childStartMarker("backend"),
      "Straight into the body with no title.",
      childEndMarker("backend"),
      childStartMarker("app"),
      "TITLE: Still fine",
      "This one is well formed.",
      childEndMarker("app"),
    );

    const { children, errors } = extractChildren(body, { repoKeys: REPO_KEYS });

    expect(errors).toHaveLength(1);
    expect(errors[0]?.repo).toBe("backend");
    expect(children).toHaveLength(1);
    expect(children[0]?.repo).toBe("app");
  });

  test("rejects an unknown repo key without swallowing the next block", () => {
    const body = plan(
      childStartMarker("infra"),
      "TITLE: Not a configured repo",
      "Body.",
      childEndMarker("infra"),
      childStartMarker("app"),
      "TITLE: Configured",
      "Body.",
      childEndMarker("app"),
    );

    const { children, errors } = extractChildren(body, { repoKeys: REPO_KEYS });

    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('unknown repo key "infra"');
    expect(children.map((child) => child.repo)).toEqual(["app"]);
  });

  test("reports an end marker that closes a different repo", () => {
    const body = plan(
      childStartMarker("backend"),
      "TITLE: Mismatched",
      "Body.",
      childEndMarker("app"),
    );

    const { children, errors } = extractChildren(body, { repoKeys: REPO_KEYS });

    expect(children).toEqual([]);
    expect(errors[0]?.message).toContain("closed by an end marker");
  });

  test("reports a stray end marker", () => {
    const { children, errors } = extractChildren(childEndMarker("backend"), {
      repoKeys: REPO_KEYS,
    });

    expect(children).toEqual([]);
    expect(errors[0]?.message).toContain("no matching start");
  });

  test("reports a start marker inside an open block", () => {
    const body = plan(
      childStartMarker("backend"),
      "TITLE: First",
      "Body.",
      childStartMarker("app"),
      "TITLE: Second",
      "Body.",
      childEndMarker("app"),
    );

    const { children, errors } = extractChildren(body, { repoKeys: REPO_KEYS });

    expect(errors).toHaveLength(1);
    expect(errors[0]?.repo).toBe("backend");
    expect(children.map((child) => child.repo)).toEqual(["app"]);
  });

  test("rejects a title with no body", () => {
    const body = plan(
      childStartMarker("backend"),
      "TITLE: Nothing follows",
      "",
      childEndMarker("backend"),
    );

    const { children, errors } = extractChildren(body, { repoKeys: REPO_KEYS });

    expect(children).toEqual([]);
    expect(errors[0]?.message).toContain("no body");
  });

  test("rejects an empty title", () => {
    const body = plan(
      childStartMarker("backend"),
      "TITLE:",
      "Body.",
      childEndMarker("backend"),
    );

    const { children, errors } = extractChildren(body, { repoKeys: REPO_KEYS });

    expect(children).toEqual([]);
    expect(errors[0]?.message).toContain("TITLE:");
  });

  test("finds nothing in a plan with no child blocks", () => {
    const { children, errors } = extractChildren("Just a plan, no drafts yet.", {
      repoKeys: REPO_KEYS,
    });

    expect(children).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("honours a custom namespace", () => {
    const body = plan(
      childStartMarker("backend", "acme"),
      "TITLE: Namespaced",
      "Body.",
      childEndMarker("backend", "acme"),
    );

    const withNamespace = extractChildren(body, { repoKeys: REPO_KEYS, namespace: "acme" });
    const withDefault = extractChildren(body, { repoKeys: REPO_KEYS });

    expect(withNamespace.children).toHaveLength(1);
    expect(withDefault.children).toHaveLength(0);
  });
});

describe("selectUnfiled", () => {
  const draft = (repo: string, title: string) => ({
    repo,
    title,
    body: "Body.",
    startLine: 1,
  });

  test("skips children that already exist", () => {
    const plan = selectUnfiled(
      [draft("backend", "Expose the contract"), draft("app", "Consume the contract")],
      [{ repo: "backend", title: "Expose the contract" }],
    );

    expect(plan.toFile.map((child) => child.repo)).toEqual(["app"]);
    expect(plan.alreadyFiled.map((child) => child.repo)).toEqual(["backend"]);
  });

  test("matches existing titles ignoring case and whitespace", () => {
    const plan = selectUnfiled(
      [draft("backend", "  Expose   the CONTRACT ")],
      [{ repo: "backend", title: "Expose the contract" }],
    );

    expect(plan.toFile).toEqual([]);
  });

  test("collapses duplicates within one plan", () => {
    const plan = selectUnfiled(
      [draft("backend", "Same title"), draft("backend", "Same title")],
      [],
    );

    expect(plan.toFile).toHaveLength(1);
    expect(plan.alreadyFiled).toHaveLength(1);
  });

  test("keeps the same title in different repos", () => {
    const plan = selectUnfiled([draft("backend", "Shared"), draft("app", "Shared")], []);

    expect(plan.toFile).toHaveLength(2);
  });

  test("files everything when nothing exists yet", () => {
    const plan = selectUnfiled([draft("backend", "One"), draft("app", "Two")], []);

    expect(plan.toFile).toHaveLength(2);
    expect(plan.alreadyFiled).toEqual([]);
  });
});
