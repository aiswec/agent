import { describe, expect, test } from "bun:test";
import { hasMarker, marker, markerLinePattern, stripMarkerLines } from "../src/protocol/markers.js";
import {
  askLine,
  parseAskLine,
  parseRunLine,
  runLine,
  type AskLine,
  type RunLine,
} from "../src/protocol/run.js";

const FULL: RunLine = {
  run: 123456,
  stage: "build",
  status: "success",
  model: "claude-opus-5",
  effort: "high",
  turns: 37,
  duration_ms: 812345,
  cost_usd: 1.234,
  usage: { input: 1000, output: 2000, cache_read: 30000, cache_write: 4000 },
};

const BARE: RunLine = { run: 7, stage: "refine", status: "failure" };

describe("runLine", () => {
  test("round trips every field", () => {
    expect(parseRunLine(runLine(FULL))).toEqual(FULL);
  });

  test("round trips with every optional field absent", () => {
    expect(parseRunLine(runLine(BARE))).toEqual(BARE);
  });

  test("writes a null as absence, so a caller has one thing to check", () => {
    const line = runLine({ ...BARE, model: null, turns: null, usage: null });
    expect(line).toBe(runLine(BARE));
    expect(parseRunLine(line)).toEqual(BARE);
  });

  test("keeps a usage member that carries something and drops the rest", () => {
    const value: RunLine = { ...BARE, usage: { input: 10, output: null } };
    expect(parseRunLine(runLine(value))).toEqual({ ...BARE, usage: { input: 10 } });
  });

  test("is a marker line and is stripped like one", () => {
    const line = runLine(FULL);
    expect(line).toMatch(markerLinePattern());
    expect(stripMarkerLines(`Done.\n\n${line}`)).toBe("Done.");
  });

  test("escapes a > in the payload, which the marker pattern forbids", () => {
    const value: RunLine = { ...BARE, model: "claude-opus-5 > claude-sonnet-5" };
    const line = runLine(value);

    // Everything but the closing `-->` is free of the character the pattern forbids.
    expect(line.slice(0, -3)).not.toContain(">");
    expect(line).toMatch(markerLinePattern());
    expect(parseRunLine(line)).toEqual(value);
  });

  test("hangs off a spec comment without disturbing it", () => {
    const body = `${marker("spec")}\nThe plan.\n\n${runLine(FULL)}`;

    expect(hasMarker(body, "spec")).toBe(true);
    expect(stripMarkerLines(body)).toBe("The plan.");
    expect(parseRunLine(body)).toEqual(FULL);
  });

  test("takes the last run line in the body", () => {
    const body = `${runLine(BARE)}\nA reply.\n${runLine(FULL)}`;
    expect(parseRunLine(body)?.run).toBe(FULL.run);
  });

  test("reads a non-default namespace, and only that one", () => {
    const line = runLine(FULL, "botco");

    expect(line).toMatch(markerLinePattern("botco"));
    expect(parseRunLine(line, "botco")).toEqual(FULL);
    expect(parseRunLine(line)).toBeNull();
    expect(parseRunLine(runLine(FULL), "botco")).toBeNull();
  });

  test("refuses a value it could not read back", () => {
    expect(() => runLine({ ...BARE, turns: -1 })).toThrow();
  });
});

describe("parseRunLine", () => {
  const line = (payload: string, namespace = "aiswec") =>
    `<!-- ${namespace}-run:v1 ${payload} -->`;

  test("returns null on a body with no marker at all", () => {
    expect(parseRunLine("Just a reply.")).toBeNull();
    expect(parseRunLine("")).toBeNull();
  });

  test("returns null when the payload is not JSON", () => {
    expect(parseRunLine(line("{not json}"))).toBeNull();
  });

  test("returns null on a version this parser does not understand", () => {
    expect(parseRunLine(`<!-- aiswec-run:v2 {"run":1,"stage":"build","status":"success"} -->`)).toBeNull();
  });

  test("returns null on an unknown stage or status", () => {
    expect(parseRunLine(line(`{"run":1,"stage":"deploy","status":"success"}`))).toBeNull();
    expect(parseRunLine(line(`{"run":1,"stage":"build","status":"ok"}`))).toBeNull();
  });

  test("returns null on a negative token count", () => {
    expect(
      parseRunLine(line(`{"run":1,"stage":"build","status":"success","usage":{"input":-5}}`)),
    ).toBeNull();
  });

  test("returns null when a required member is missing or the wrong type", () => {
    expect(parseRunLine(line(`{"stage":"build","status":"success"}`))).toBeNull();
    expect(parseRunLine(line(`{"run":"123","stage":"build","status":"success"}`))).toBeNull();
  });

  test("only reads the marker on a line of its own", () => {
    const inline = `The run wrote ${line(`{"run":1,"stage":"build","status":"success"}`)} inline.`;
    expect(parseRunLine(inline)).toBeNull();
  });

  test("a malformed last line is the answer, not a reason to read an older one", () => {
    const body = `${runLine(FULL)}\n${line("{oops}")}`;
    expect(parseRunLine(body)).toBeNull();
  });

  test("ignores a key a later stage added", () => {
    const body = line(`{"run":1,"stage":"build","status":"success","branch":"claude/issue-3"}`);
    expect(parseRunLine(body)).toEqual({ run: 1, stage: "build", status: "success" });
  });
});

describe("askLine", () => {
  test("round trips both members", () => {
    const value: AskLine = { model: "claude-opus-5", effort: "max" };
    const line = askLine(value);

    expect(line).toMatch(markerLinePattern());
    expect(parseAskLine(line)).toEqual(value);
  });

  test("round trips with every member absent", () => {
    expect(parseAskLine(askLine({}))).toEqual({});
  });

  test("is stripped from an issue body along with the rest", () => {
    const body = `Make the button blue.\n\n${askLine({ effort: "low" })}`;

    expect(stripMarkerLines(body)).toBe("Make the button blue.");
    expect(parseAskLine(body)).toEqual({ effort: "low" });
  });

  test("takes the last ask line and reads a non-default namespace", () => {
    const body = `${askLine({ effort: "low" }, "botco")}\n${askLine({ effort: "max" }, "botco")}`;

    expect(parseAskLine(body, "botco")).toEqual({ effort: "max" });
    expect(parseAskLine(body)).toBeNull();
  });

  test("returns null on an effort that is not one of the five, and on a run line", () => {
    expect(parseAskLine(`<!-- aiswec-ask:v1 {"effort":"maximum"} -->`)).toBeNull();
    expect(parseAskLine(runLine(FULL))).toBeNull();
  });

  test("carries the provider, so one repository can put two engines on two tasks", () => {
    const value: AskLine = { provider: "openrouter", model: "deepseek/deepseek-chat" };

    expect(parseAskLine(askLine(value))).toEqual(value);
    expect(parseAskLine(`<!-- aiswec-ask:v1 {"provider":"ollama"} -->`)).toBeNull();
  });
});
