/**
 * The parser's two promises are what make it safe to point at a comment nobody
 * vetted: it never throws, and it never drops. Both are asserted here against
 * the shapes a real thread carries, including the ones an engine having a bad
 * day produces, and the tables the format had until 2026-09-05, which still
 * read back typed.
 */
import { describe, expect, test } from "bun:test";
import { REGISTRY, flowPaths, parseDoc, parsePreviewLine, specSize, type AlertData, type CheckItem, type CodeData, type FactsData, type FileItem, type FlowData } from "../src/index.js";

const spec = (body: string): string => `<!-- aiswec-spec:v1 -->\n${body}`;

describe("it reads what the engine writes", () => {
  const doc = parseDoc(
    spec(`> [!NOTE]
> The plan arrives as a list you can scan. You see every file it means to touch.

## Implementation Spec

### At a glance

Size M · Files 4 · Contract wire protocol · Checks 2

### Problem

The prompts are typed twice.

### What the docs say

- [EAS](https://docs.expo.dev/eas-workflows/): jobs live in \`.eas/workflows\`. Here: \`eas.json\` only. Missing: the files.

### Proposed approach

1. Compose the prompt.
2. Sync it.

### Affected files

- \`a.ts\` (add): the composer
- \`b.ts\` (edit): reads it

### Acceptance criteria

- The prompt parses.

### Test plan

\`\`\`sh
bun test
\`\`\`

### Try it

1. \`bun test\`
   Expect: 0 fail.
`),
    "spec",
  );

  test("the lede is the alert above the first heading", () => {
    expect(doc.plain?.kind).toBe("note");
    expect(doc.plain?.text).toContain("You see every file");
  });

  test("the facts line reads back as labels and values", () => {
    const meta = doc.byKey["meta"]?.data as FactsData;
    expect(meta.labels).toEqual(["Size", "Files", "Contract", "Checks"]);
    expect(meta.values).toEqual({ size: "M", files: "4", contract: "wire protocol", checks: "2" });
  });

  test("the files list reads back as items", () => {
    expect(doc.byKey["files"]?.data as FileItem[]).toEqual([
      { path: "a.ts", change: "add", why: "the composer" },
      { path: "b.ts", change: "edit", why: "reads it" },
    ]);
  });

  test("the docs list is a section of its own", () => {
    const docs = doc.byKey["docs"]?.data as string[];
    expect(docs).toHaveLength(1);
    expect(docs[0]).toContain("docs.expo.dev");
  });

  test("a numbered list, a bulleted list and a fence each read back", () => {
    expect(doc.byKey["approach"]?.data).toEqual(["Compose the prompt.", "Sync it."]);
    expect(doc.byKey["criteria"]?.data).toEqual(["The prompt parses."]);
    expect((doc.byKey["checks"]?.data as CodeData).lines).toEqual(["bun test"]);
    // A step's Expect line folds into its item.
    expect(doc.byKey["try"]?.data).toEqual(["`bun test` Expect: 0 fail."]);
  });

  test("every key it found is a registry key", () => {
    const keys = new Set(REGISTRY.spec.map((entry) => entry.key));
    for (const section of doc.sections) if (section.key !== null) expect(keys.has(section.key)).toBe(true);
  });
});

describe("it still reads the tables the format had until 2026-09-05", () => {
  const doc = parseDoc(
    spec(`### At a glance

| Size | Files | Contract | Checks |
| --- | --- | --- | --- |
| M | 4 | wire protocol | 2 |

### What the docs say

| Source | Says | Repo today | Gap |
| --- | --- | --- | --- |
| [EAS](https://docs.expo.dev/eas-workflows/) | jobs live in \`.eas/workflows\` | \`eas.json\` only | the files |

### Affected files

| Path | Change | Why |
| --- | --- | --- |
| \`a.ts\` | add | the composer |
`),
    "spec",
  );

  test("the At a glance table reads back as the facts line does", () => {
    const meta = doc.byKey["meta"]?.data as FactsData;
    expect(meta.labels).toEqual(["Size", "Files", "Contract", "Checks"]);
    expect(meta.values["size"]).toBe("M");
  });

  test("the files table reads back as the files list does", () => {
    expect(doc.byKey["files"]?.data as FileItem[]).toEqual([{ path: "a.ts", change: "add", why: "the composer" }]);
  });

  test("a docs table is prose, and nothing of it is lost", () => {
    expect(doc.byKey["docs"]?.data).toBeUndefined();
    expect(doc.byKey["docs"]?.body).toContain("| Source | Says | Repo today | Gap |");
  });
});

describe("the size of a plan", () => {
  test("from the facts line, the table, or the line the first format had", () => {
    expect(specSize("### At a glance\n\nSize S · Files 1 · Contract none · Checks 1\n")).toBe("S");
    expect(specSize("### At a glance\n\n| Size | Files | Contract | Checks |\n| --- | --- | --- | --- |\n| L | 9 | wire | 3 |\n")).toBe("L");
    expect(specSize("## Implementation Spec\n\n**Size estimate:** m\n")).toBe("M");
    expect(specSize("### At a glance\n\nSize huge · Files 1 · Contract none · Checks 1\n")).toBeNull();
    expect(specSize("nothing here")).toBeNull();
  });
});

describe("it never drops", () => {
  test("a heading the registry does not know keeps its place and its markdown", () => {
    const doc = parseDoc(spec("## Implementation Spec\n\n### Notes from me\n\nSomething.\n\n### Problem\n\nIt broke.\n"), "spec");
    const titles = doc.sections.map((section) => section.title);
    expect(titles).toEqual(["Implementation Spec", "Notes from me", "Problem"]);
    expect(doc.sections[1]?.key).toBeNull();
    expect(doc.sections[1]?.data).toBe("Something.");
  });

  test("a renamed column makes the section prose, not half a table", () => {
    const doc = parseDoc(spec("### Affected files\n\n| File | Change | Why |\n| --- | --- | --- |\n| `a.ts` | add | x |\n"), "spec");
    const files = doc.byKey["files"];
    expect(files?.data).toBeUndefined();
    expect(files?.body).toContain("| File | Change | Why |");
  });

  test("a bullet that is not a file makes the section prose, not half a list", () => {
    const doc = parseDoc(spec("### Affected files\n\n- `a.ts` (add): x\n- and also something else\n"), "spec");
    expect(doc.byKey["files"]?.data).toBeUndefined();
    expect(doc.byKey["files"]?.body).toContain("something else");
  });

  test("an alias still finds its key", () => {
    const doc = parseDoc(spec("### Approach\n\n1. One.\n"), "spec");
    expect(doc.byKey["approach"]?.data).toEqual(["One."]);
  });

  // 2026-10-07: a flow is arrows, and a step's backticks may hold an arrow of their own.
  test("a flow reads back as its paths, an arrow in code staying code", () => {
    const doc = parseDoc(spec("### Flow\n\n- Click a chip → `GET ?status=errored` → `a -> b` is read (a note) → the list\n- Click it again -> every source\n"), "spec");
    expect((doc.byKey["flow"]?.data as FlowData).paths).toEqual([
      ["Click a chip", "`GET ?status=errored`", "`a -> b` is read (a note)", "the list"],
      ["Click it again", "every source"],
    ]);
    expect(flowPaths("Click → answer")).toEqual([["Click", "answer"]]);
  });

  test("a flow that is not all arrows is prose, and a mermaid fence is the flow it was", () => {
    expect(parseDoc(spec("### Flow\n\n- a → b\n- and a sentence\n"), "spec").byKey["flow"]?.data).toBeUndefined();
    expect(flowPaths("- a → → b")).toBeNull();
    const old = parseDoc(spec('### Flow\n\n```mermaid\nflowchart LR\n  A["in"] --> B["out"]\n```\n'), "spec");
    expect((old.byKey["flow"]?.data as CodeData).lang).toBe("mermaid");
    expect(flowPaths('```mermaid\nflowchart LR\n  A["in"] --> B["out"]\n```')).toBeNull();
  });

  // A plan written before 2026-10-07 still reads back whole.
  test("Schema, Test plan, Open questions and a Checks fact read back from an older plan", () => {
    const doc = parseDoc(
      spec("### At a glance\n\nSize S · Files 1 · Contract none · Checks 1\n\n### Schema\n\n```ts\ntype A = 1;\n```\n\n### Test plan\n\n```sh\nbun test\n```\n\n### Open questions\n\n- Links, not JS.\n"),
      "spec",
    );
    expect((doc.byKey["meta"]?.data as FactsData).values["checks"]).toBe("1");
    expect((doc.byKey["schema"]?.data as CodeData).lines).toEqual(["type A = 1;"]);
    expect(doc.byKey["schema"]?.title).toBe("Schema");
    expect((doc.byKey["checks"]?.data as CodeData).lines).toEqual(["bun test"]);
    expect(doc.byKey["open"]?.data).toEqual(["Links, not JS."]);
  });

  test("a body cut off inside a fence is rescanned", () => {
    const doc = parseDoc(spec("### Test plan\n\n```sh\nbun test\n```\n\n### Try it\n\n1. `x`\n   Expect: y\n\n### Open questions\n\n```sh\ncut off here"), "spec");
    expect(doc.recovered).toBe(true);
    expect(doc.byKey["try"]?.data).toEqual(["`x` Expect: y"]);
  });
});

describe("it never throws", () => {
  const junk = [
    "",
    "   ",
    "<!-- aiswec-spec:v1 -->",
    "no headings at all, just a sentence a person typed",
    "### At a glance\n\nnot a facts line\n",
    "### Affected files\n\n| | |\n",
    "```\nunterminated\n",
    "#".repeat(300),
    "| | | |\n| --- |\n",
    "> [!NOPE]\n> not an alert kind\n",
  ];
  for (const body of junk) {
    test(`${JSON.stringify(body.slice(0, 24))} parses to something`, () => {
      for (const kind of ["spec", "escalate", "reply", "pr", "notice"] as const) {
        const doc = parseDoc(body, kind);
        expect(doc.kind).toBe(kind);
        expect(Array.isArray(doc.sections)).toBe(true);
      }
    });
  }
});

describe("a pull request body", () => {
  const doc = parseDoc(
    `> [!NOTE]
> Two sentences.

## At a glance

Files 4 · Lines +120 -18 · Checks 2 green

## Summary

It does the thing.

## Acceptance criteria

- [x] Met.
- [ ] Not met, because.

## Testing instructions

### Automated

\`\`\`sh
bun test
\`\`\`
`,
    "pr",
  );

  test("Manual todos read back as the person's steps, ticked or bare, under the old heading too", () => {
    const pr = parseDoc("> [!NOTE]\n> Words.\n\n## Manual todos\n\n- [x] Add the secret.\n- [ ] Grant the permission.\n- A bare step.\n\n## Summary\n\nx", "pr");
    expect(pr.byKey["todos"]?.data).toEqual([
      { done: true, text: "Add the secret." },
      { done: false, text: "Grant the permission." },
      { done: false, text: "A bare step." },
    ]);
    const plan = parseDoc("<!-- aiswec-spec:v1 -->\n> [!NOTE]\n> Words.\n\n## Implementation Spec\n\n### Your part\n\n- Add the secret.\n\n### Problem\n\nx", "spec");
    expect(plan.byKey["todos"]?.data).toEqual([{ done: false, text: "Add the secret." }]);
    expect(plan.byKey["problem"]?.body).toBe("x");
  });

  test("criteria read back as ticks", () => {
    const items = doc.byKey["criteria"]?.data as CheckItem[];
    expect(items).toEqual([
      { done: true, text: "Met." },
      { done: false, text: "Not met, because." },
    ]);
  });

  test("the facts line reads back, a value with spaces included", () => {
    const meta = doc.byKey["meta"]?.data as FactsData;
    expect(meta.values).toEqual({ files: "4", lines: "+120 -18", checks: "2 green" });
  });

  test("the lede survives a level-2 document", () => {
    expect((doc.plain as AlertData).kind).toBe("note");
  });

  // 2026-09-06: the finalizer's section, written after the export step, byte
  // for byte as the stage writes it, the marker on the line under the facts.
  describe("the Preview section the finalizer writes", () => {
    const ready = [
      "> [!NOTE]",
      "> Two sentences.",
      "",
      "## Summary",
      "",
      "It does the thing.",
      "",
      "## Preview",
      "",
      "Link https://yusufseyrek-facts-a-day-app-31.aiswec.com/ · Built from 1a2b3c4 · Status ready",
      '<!-- aiswec-preview:v1 {"pr":31,"sha":"1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c4d5e6f1a2b","status":"ready","url":"https://yusufseyrek-facts-a-day-app-31.aiswec.com/"} -->',
      "",
      "Closes #30",
      "",
    ].join("\n");

    test("reads back as facts, the two-word label whole, and the marker is not in the body", () => {
      const pr = parseDoc(ready, "pr");
      const preview = pr.byKey["preview"];
      expect(preview?.shape).toBe("facts");
      const facts = preview?.data as FactsData;
      expect(facts.labels).toEqual(["Link", "Built from", "Status"]);
      expect(facts.values).toEqual({ link: "https://yusufseyrek-facts-a-day-app-31.aiswec.com/", "built from": "1a2b3c4", status: "ready" });
      expect(preview?.body).not.toContain("<!--");
      expect(pr.byKey["summary"]?.body).toBe("It does the thing.");
    });

    test("a failed export reads back with the run instead of the link", () => {
      const pr = parseDoc("## Preview\n\nBuilt from 1a2b3c4 · Status failed · Run https://github.com/o/r/actions/runs/9\n<!-- aiswec-preview:v1 {\"pr\":31,\"sha\":\"1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c4d5e6f1a2b\",\"status\":\"failed\"} -->\n", "pr");
      const facts = pr.byKey["preview"]?.data as FactsData;
      expect(facts.labels).toEqual(["Built from", "Status", "Run"]);
      expect(facts.values["status"]).toBe("failed");
      expect(facts.values["run"]).toBe("https://github.com/o/r/actions/runs/9");
    });

    test("is absent on a body written before it", () => {
      expect(doc.byKey["preview"]).toBeUndefined();
      expect(REGISTRY.pr.find((spec) => spec.key === "preview")?.finalizer).toBe(true);
      expect(REGISTRY.pr.find((spec) => spec.key === "preview")?.required).toBe(false);
    });

    // 2026-09-06, the phone: a third fact on the line, and under it, for a
    // reader on GitHub, the QR, the group's page and the native warning,
    // which the facts reader (first line only) never sees. Byte for byte as
    // the stage writes it, the marker after the last of those lines.
    describe("with the phone", () => {
      const project = "8b3c5d7e-9f0a-4b1c-8d2e-3f4a5b6c7d8e";
      const group = "0c3f1a2b-7d4e-4f6a-9b8c-1d2e3f4a5b6c";
      const qr = `https://qr.expo.dev/eas-update?appScheme=factsaday&projectId=${project}&groupId=${group}`;
      const link = `https://expo.dev/projects/${project}/updates/${group}`;
      const phone = `{"status":"ready","branch":"pr-31","group":"${group}","runtime":"1.0.0","project":"${project}","scheme":"factsaday","qr":"${qr}","link":"${link}","platforms":["android","ios"]}`;
      const phoneOnly = [
        "> [!NOTE]",
        "> Two sentences.",
        "",
        "## Summary",
        "",
        "It does the thing.",
        "",
        "## Preview",
        "",
        "Built from 1a2b3c4 · Status off · Phone ready",
        "",
        `Scan with your development build (runtime 1.0.0): ![Phone preview QR](${qr})`,
        `Update group: ${link}`,
        "This change touches native code, so the phone preview may need a new development build.",
        `<!-- aiswec-preview:v1 {"pr":31,"sha":"1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c4d5e6f1a2b","status":"off","phone":${phone},"native_touched":true} -->`,
        "",
        "Closes #30",
        "",
      ].join("\n");

      test("web off and the phone ready: three facts, and the lines under them are kept, not read", () => {
        const pr = parseDoc(phoneOnly, "pr");
        const preview = pr.byKey["preview"];
        expect(preview?.shape).toBe("facts");
        const facts = preview?.data as FactsData;
        expect(facts.labels).toEqual(["Built from", "Status", "Phone"]);
        expect(facts.values).toEqual({ "built from": "1a2b3c4", status: "off", phone: "ready" });
        expect(preview?.body).toContain("Scan with your development build (runtime 1.0.0): ![Phone preview QR](https://qr.expo.dev/");
        expect(preview?.body).toContain(`Update group: ${link}`);
        expect(preview?.body).toContain("This change touches native code, so the phone preview may need a new development build.");
        expect(preview?.body).not.toContain("<!--");
        expect(pr.byKey["summary"]?.body).toBe("It does the thing.");
      });

      test("the marker under those lines still reads back typed", () => {
        const line = parsePreviewLine(phoneOnly);
        expect(line?.status).toBe("off");
        expect(line?.phone?.status).toBe("ready");
        expect(line?.phone?.group).toBe(group);
        expect(line?.phone?.qr).toBe(qr);
        expect(line?.phone?.link).toBe(link);
        expect(line?.phone?.platforms).toEqual(["android", "ios"]);
        expect(line?.native_touched).toBe(true);
      });

      test("web on: the phone is appended to the line, in each of its three words", () => {
        const on = (word: string): FactsData =>
          parseDoc(
            `## Preview\n\nLink https://yusufseyrek-facts-a-day-app-31.aiswec.com/ · Built from 1a2b3c4 · Status ready · Phone ${word}\n<!-- aiswec-preview:v1 {"pr":31,"sha":"1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c4d5e6f1a2b","status":"ready","phone":{"status":"${word === "no token" ? "no-token" : word}"}} -->\n`,
            "pr",
          ).byKey["preview"]?.data as FactsData;
        expect(on("ready").labels).toEqual(["Link", "Built from", "Status", "Phone"]);
        expect(on("ready").values["phone"]).toBe("ready");
        expect(on("failed").values["phone"]).toBe("failed");
        expect(on("no token").values["phone"]).toBe("no token");
        expect(on("no token").values["status"]).toBe("ready");
      });
    });
  });
});

describe("the format is written down", () => {
  const wire = Bun.file(new URL("../../../docs/wire.md", import.meta.url).pathname);

  test("every registry key appears in docs/wire.md", async () => {
    const text = await wire.text();
    for (const [kind, specs] of Object.entries(REGISTRY)) {
      for (const spec of specs) {
        if (spec.key === "plain") continue;
        expect(text, `${kind}.${spec.key}`).toContain(`\`${spec.key}\``);
        expect(text, `${kind}.${spec.heading}`).toContain(spec.heading);
      }
    }
  });
});
