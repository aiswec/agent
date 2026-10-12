import { describe, expect, test } from "bun:test";
import {
  approvalFooterSentence,
  approvalGrammarSource,
  classifyComment,
} from "../src/protocol/approval.js";

const KEYWORDS = ["approve", "approved", "lgtm", "ship it", "go ahead"];
const options = { keywords: KEYWORDS, reservedPrefixes: ["/deploy"] };

describe("classifyComment", () => {
  test("accepts the bare keyword", () => {
    const verdict = classifyComment("approve", options);

    expect(verdict.kind).toBe("approval");
    expect(verdict.keyword).toBe("approve");
    expect(verdict.qualified).toBe(false);
  });

  test("is case-insensitive", () => {
    expect(classifyComment("LGTM", options).kind).toBe("approval");
    expect(classifyComment("Approved", options).keyword).toBe("approved");
  });

  test("matches the longest keyword, so approved is not approve plus a stray d", () => {
    expect(classifyComment("approved", options).keyword).toBe("approved");
  });

  test("matches multi-word keywords", () => {
    expect(classifyComment("ship it", options).keyword).toBe("ship it");
    expect(classifyComment("go ahead and file them", options).keyword).toBe("go ahead");
  });

  test("does not match a longer word that merely starts with a keyword", () => {
    expect(classifyComment("approver needed here", options).kind).toBe("feedback");
    expect(classifyComment("lgtmish", options).kind).toBe("feedback");
  });

  test("only reads the first line carrying content", () => {
    expect(classifyComment("Looks good to me.\napprove", options).kind).toBe("feedback");
    expect(classifyComment("\n\n  approve\n", options).kind).toBe("approval");
  });

  test("flags an approval that carries conditions", () => {
    const verdict = classifyComment("approve but drop the second issue", options);

    expect(verdict.kind).toBe("approval");
    expect(verdict.qualified).toBe(true);
    expect(verdict.trailing).toBe("but drop the second issue");
  });

  test("does not treat punctuation as a condition", () => {
    expect(classifyComment("approve!", options).qualified).toBe(false);
    expect(classifyComment("lgtm :)", options).qualified).toBe(false);
  });

  test("hands reserved prefixes to their own workflow", () => {
    const verdict = classifyComment("/deploy staging", options);

    expect(verdict.kind).toBe("reserved");
    expect(verdict.reservedPrefix).toBe("/deploy");
  });

  test("treats an empty comment as feedback", () => {
    expect(classifyComment("   \n\n", options).kind).toBe("feedback");
  });

  test("escapes regex metacharacters in keywords", () => {
    const verdict = classifyComment("+1 from me", { keywords: ["+1"] });

    expect(verdict.kind).toBe("approval");
    expect(verdict.keyword).toBe("+1");
  });
});

describe("generated grammar", () => {
  test("emits a regex the workflow can grep with", () => {
    expect(approvalGrammarSource(["approve", "lgtm"])).toBe("^(approve|lgtm)\\b");
  });

  test("orders alternatives longest first so the regex agrees with the parser", () => {
    expect(approvalGrammarSource(["approve", "approved"])).toBe("^(approved|approve)\\b");
  });

  test("writes the plan footer from the same keyword list", () => {
    const sentence = approvalFooterSentence(["approve", "lgtm"]);

    expect(sentence).toContain('Reply with "approve"');
    expect(sentence).toContain('(or "lgtm")');
  });

  test("writes a footer for a single keyword without an alternatives clause", () => {
    expect(approvalFooterSentence(["approve"])).not.toContain("(or");
  });

  test("refuses to write a footer with no keywords", () => {
    expect(() => approvalFooterSentence([])).toThrow();
  });

  test("writes the spec gate's footer from the same function", () => {
    const sentence = approvalFooterSentence(["approve", "lgtm"], {
      action: "build this spec",
      otherwise: "Any other reply is not read by the pipeline.",
      releaseLabel: "aiswec:ready-to-build",
    });

    expect(sentence).toBe(
      'Reply with "approve" (or "lgtm") to build this spec, or apply the ' +
        "`aiswec:ready-to-build` label. Any other reply is not read by the pipeline.",
    );
  });

  test("keeps the hub's wording when no overrides are given", () => {
    expect(approvalFooterSentence(["approve"])).toBe(
      'Reply with "approve" to file these issues as written. Any other reply is treated as ' +
        "feedback and revises the plan.",
    );
  });

  test("omits the label clause when no release label is configured", () => {
    expect(approvalFooterSentence(["approve"], { action: "build this spec" })).not.toContain(
      "label",
    );
  });
});
