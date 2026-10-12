import { describe, expect, test } from "bun:test";
import { hasMarker, marker } from "../src/protocol/markers.js";
import { answersComment, parseQuestions, type Answer } from "../src/protocol/questions.js";

const NOTE = `<!-- aiswec-questions:v1 -->
I cannot reach the market from here, so I need to know what this task should produce before I plan it.
The code calls one image model today and keeps its cost per image.

### 1. What should this task produce?
A comparison can only use the models and prices you give me.
- (a) A written comparison of the models you name, kept in the repository (recommended)
- (b) A switch to a model you have already chosen
- (c) Nothing for me: a person researches this

### 2. Which models should I compare? (pick all that apply)
- (a) gpt-image-1
- (b) gemini-2.5-flash-image
- (c) flux-1.1-pro

### 3. Anything the comparison must weigh?

---

Answer in Suite, or reply here with the letter for each number.

<!-- aiswec-run:v1 {"run":1,"stage":"refine","status":"success"} -->`;

describe("parseQuestions", () => {
  test("reads the paragraph, every question, its why, its options and the recommended one", () => {
    const note = parseQuestions(NOTE);
    expect(note).not.toBeNull();
    expect(note?.preface).toBe("");
    expect(note?.intro).toBe(
      "I cannot reach the market from here, so I need to know what this task should produce before I plan it.\nThe code calls one image model today and keeps its cost per image.",
    );
    expect(note?.footer).toBe("Answer in Suite, or reply here with the letter for each number.");
    expect(note?.questions.map((question) => [question.number, question.text, question.multi, question.options.length])).toEqual([
      [1, "What should this task produce?", false, 3],
      [2, "Which models should I compare?", true, 3],
      [3, "Anything the comparison must weigh?", false, 0],
    ]);
    expect(note?.questions[0]?.why).toBe("A comparison can only use the models and prices you give me.");
    expect(note?.questions[0]?.options[0]).toEqual({ key: "a", text: "A written comparison of the models you name, kept in the repository", recommended: true });
    expect(note?.questions[0]?.options[1]).toEqual({ key: "b", text: "A switch to a model you have already chosen", recommended: false });
    expect(note?.questions[2]?.why).toBe("");
  });

  test("is null without the marker on a line of its own, whatever the text looks like", () => {
    expect(parseQuestions("### 1. Which?\n- (a) This\n- (b) That")).toBeNull();
    expect(parseQuestions("Mentioning <!-- aiswec-questions:v1 --> mid-sentence is text.")).toBeNull();
    expect(parseQuestions(NOTE, "other")).toBeNull();
  });

  test("a note with no question is a note: the words stay, the list is empty", () => {
    const note = parseQuestions(`${marker("questions")}\nNot proceeding: this needs a credential I do not have.`);
    expect(note?.intro).toBe("Not proceeding: this needs a credential I do not have.");
    expect(note?.questions).toEqual([]);
  });

  test("tolerates a hand-written shape: bold numbers, letters without parentheses, another heading level", () => {
    const note = parseQuestions(`${marker("questions")}\n\n**1. Keep the tests?**\n- a) Yes\n- b. No **(recommended)**\n\n## 2) Where?\n* (a) Here\n* (b) There`);
    expect(note?.questions.map((question) => [question.number, question.text, question.options.map((option) => option.key)])).toEqual([
      [1, "Keep the tests?", ["a", "b"]],
      [2, "Where?", ["a", "b"]],
    ]);
    expect(note?.questions[0]?.options[1]).toEqual({ key: "b", text: "No", recommended: true });
  });

  test("a bullet that is not an option is part of the why, and a plain bullet in the intro stays prose", () => {
    const note = parseQuestions(`${marker("questions")}\n- a note, not an option\n\n### 1. Which?\nContext line.\n- (a) This\n- (b) That\n- and a remark under them`);
    expect(note?.intro).toBe("- a note, not an option");
    expect(note?.questions[0]?.options.map((option) => option.key)).toEqual(["a", "b"]);
    expect(note?.questions[0]?.why).toBe("Context line.\n- and a remark under them");
  });

  test("questions inside a reply keep the reply's opening as the preface and drop the reply marker", () => {
    const body = `${marker("reply")}\n\nI can do this two ways.\n\n${marker("questions")}\nWhich do you want?\n\n### 1. Which way?\n- (a) Fast\n- (b) Thorough (recommended)`;
    const note = parseQuestions(body);
    expect(note?.preface).toBe("I can do this two ways.");
    expect(note?.intro).toBe("Which do you want?");
    expect(note?.questions[0]?.options.find((option) => option.recommended)?.key).toBe("b");
  });

  test("survives Windows line endings", () => {
    const note = parseQuestions(NOTE.replace(/\n/g, "\r\n"));
    expect(note?.questions).toHaveLength(3);
    expect(note?.footer).toBe("Answer in Suite, or reply here with the letter for each number.");
  });
});

describe("answersComment", () => {
  const answers: Answer[] = [
    { number: 1, question: "What should this task produce?", chosen: [{ key: "a", text: "A written comparison", recommended: true }], other: null },
    { number: 2, question: "Which models should I compare?", chosen: [{ key: "a", text: "gpt-image-1", recommended: false }, { key: "c", text: "flux-1.1-pro", recommended: false }], other: "and whatever is cheapest on OpenRouter this month" },
    { number: 3, question: "Anything the comparison must weigh?", chosen: [], other: "Faces must look right." },
  ];

  test("writes the marker, then each question with what was chosen under it", () => {
    const body = answersComment(answers, "Thanks.");
    expect(hasMarker(body, "answers")).toBe(true);
    expect(body).toBe(
      [
        "<!-- aiswec-answers:v1 -->",
        "**1. What should this task produce?**\n(a) A written comparison",
        "**2. Which models should I compare?**\n(a) gpt-image-1\n(c) flux-1.1-pro\nand whatever is cheapest on OpenRouter this month",
        "**3. Anything the comparison must weigh?**\nFaces must look right.",
        "Thanks.",
      ].join("\n\n"),
    );
  });

  test("leaves the closing note out when there is none, and namespaces the marker", () => {
    const body = answersComment(answers.slice(0, 1), "  ", "acme");
    expect(body.startsWith("<!-- acme-answers:v1 -->\n\n**1.")).toBe(true);
    expect(body.endsWith("(a) A written comparison")).toBe(true);
  });

  test("refuses an answer that says nothing, and no answers at all", () => {
    expect(() => answersComment([{ number: 1, question: "Which?", chosen: [], other: "  " }])).toThrow("question 1 has no answer");
    expect(() => answersComment([])).toThrow("no answers to write");
  });
});
