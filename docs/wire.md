# The wire format

What AISWEC writes on GitHub, and what Suite reads back. One rule decides everything here:
**formatting is GitHub-flavoured markdown and nothing else.** No HTML, no invisible sections,
no metadata carrying structure. A person reading the issue on GitHub sees the whole document;
Suite sees the same document and knows what each part is.

Seven HTML comments survive, and none of them formats anything: `-spec:v1`, `-questions:v1`,
`-escalate:v1` and `-reply:v1` say what a comment *is* (and `-spec:v1` is the anti-spoofing
boundary in `selectTrustedSpec`), `-run:v1` carries what a run cost and which
engine ran it, `-ask:v1` carries the engine a person picked for one task (a provider, a model
and an effort, 2026-09-06), `-preview:v1` carries where a pull request's preview is
(2026-09-06). They are identity and telemetry. Structure is markdown. Suite writes markers of the
person's own beside them, and they format nothing either: `-done:v1` is their ticks on the manual
todos, `-from:v1` is where a task came from (2026-09-17), `-with:v1` is the other tasks of one ask
made in several projects (2026-10-08), `-files:v1` is the files attached to a task, a comment or a
review (2026-10-09); they are under `spec`, `from`, `with` and `files` below.

## How Suite reads it

```
comment body
  -> stripMarkerLines            (the six markers vanish)
  -> parseDoc(body, kind)        packages/core/src/protocol/sections.ts
       preface   = everything before the first heading
       plain     = the leading GFM alert in the preface
       sections  = a flat scan of every ## and ### outside a code fence
       key       = REGISTRY[kind]: exact heading, then alias, then prefix
       data      = the shape reader for that key, or undefined
  -> Suite renders a component per key, and plain markdown for anything else
```

`parseDoc` never throws. A body with no known heading returns `typed: false`, and Suite falls
back to the markdown it renders today, which is what every comment posted before this format
gets. An unknown heading is kept and rendered in document order. A list whose items do not fit
their shape, or a table (the shape the format had until 2026-09-05) whose columns were renamed,
reads back as `undefined` and renders as the markdown it is. Nothing is ever dropped.

## Shapes

| shape | markdown | read back as |
| --- | --- | --- |
| `alert` | `> [!NOTE]` blockquote, optionally `> **Title.**` on its first line | `{kind, title, text}` |
| `facts` | one line, `Label value · Label value`, every label the registry names | `{labels, values}` |
| `files` | `` - `path` (add): why `` bullets, the change one of add, edit, delete | `{path, change, why}[]` |
| `table` | a GFM table whose header row carries the required columns; what `meta`, `files` and `changed` were until 2026-09-05, and they still read back as `facts` and `files` | `{columns, rows, records}` |
| `list` | `- ` bullets | `string[]` |
| `olist` | `1. ` items | `string[]` |
| `checks` | `- [ ]` / `- [x]` | `{done, text}[]` |
| `todo` | `- ` bullets, each ticked, unticked or bare: the person's steps | `{done, text}[]` |
| `code` | one fenced block | `{lang, lines}` |
| `flow` | `- step → step → step` bullets, one path each; a ` ```mermaid ` fence, which every flow was until 2026-10-07, reads back as its code | `{paths}`, or `{lang, lines}` |
| `text` | anything | the markdown |

No tables since 2026-09-05: what has rows is a list, one item per row, and the facts a table
held are one line. Facts rules: the labels in the registry's order, each followed by its
value, the pairs separated by ` · `, nothing else on the line. Files rules: the path in
backticks, the change in parentheses, a colon, the why. Flow rules (2026-10-07): one bullet per
path, at most three, the steps joined by ` → ` (`->` reads back too), at most six, a note in
parentheses only where a step needs one, an arrow inside backticks being code and not a join.
It was a mermaid diagram until that day, which read as letters and boxes wherever it was not
drawn (`facts-a-day-backend#31`, "no need for A B C D, just arrows and descriptions").

## The registry

Headings are matched case-insensitively. Every heading that existed before this format keeps
its name, so a Suite that has not deployed yet renders a new comment exactly as it renders an
old one.

### `spec` (an issue comment, `<!-- aiswec-spec:v1 -->` on line 1)

| key | heading | alias | shape | columns |
| --- | --- | --- | --- | --- |
| `plain` | the leading alert | `In plain words` | alert | |
| `title` | `## Implementation Spec` | | text | |
| `todos` | `### Manual todos` | `Your part` | todo | |
| `meta` | `### At a glance` | `Size estimate` | facts | Size, Files, Contract |
| `problem` | `### Problem` | | text | |
| `docs` | `### What the docs say` | | list | |
| `approach` | `### Proposed approach` | `Approach` | olist | |
| `files` | `### Affected files` | `Files` | files | Path, Change, Why |
| `schema` | `### Code sketch` | `Schema` | code | |
| `flow` | `### Flow` | | flow | |
| `criteria` | `### Acceptance criteria` | `Done when` | list | |
| `try` | `### Try it` | `Manual verification` | olist | |
| `checks` | `### Test plan` (retired) | `Checks` | code | |
| `open` | `### Open questions` (retired) | | list | |

Required: `plain`, `meta`, `problem`, `approach`, `files`, `criteria`. Optional at the wire:
`schema`, `flow`, `try`. The engine is told `schema` is expected whenever a shape changes and
`flow` whenever something moves (2026-09-04, `CODE.md`'s first rule); the parser holds neither
against a plan.

**Three changes of 2026-10-07**, asked for on `facts-a-day-backend#31`. *Schema* is **Code
sketch**, since plans put a component's props under it as readily as a table: any code the change
turns on, one fence per language, highlighted in Suite. *Test plan* and *Open questions* are
**retired** (`retired: true`): read back from every plan already on GitHub, never in the skeleton.
The gates run on every build whatever the plan says, so a fence repeating them told nobody
anything, and the tests a plan wants written are the approach's last step; the defaults a plan
decided were never questions, and each is said in the approach step it shapes. At a glance lost
`Checks` with them, since it counted the Test plan's commands; a line that still carries it reads
back.

**Acceptance criteria in a spec are plain bullets, never `- [ ]`.** Ticking a box on GitHub
edits the comment, which sets `spec.edited` and refuses Approve. The finalizer strips a tick
if the engine writes one. In a pull request body they are ticks, where editing is harmless.

**Manual todos (`todos`, since 2026-09-06; `Your part` for a few hours that day, kept as an alias)
is what only a person can do**: a secret to add, a permission to grant, a token to make, a setting
in an account or a store. CODE.md's third rule: never buried in prose. What the bot can write is
never one, a workflow file included: the build and revise tokens carry workflows write. In a spec
the bullets are bare, for the reason above (the finalizer strips a tick there too); in a pull
request body and a reply they are a task list. The ticks live in the person's own comment,
`<!-- aiswec-done:v1 -->` over the same list with its boxes, which Suite creates on the first tick
and edits on every one after, and which the engine reads as the maintainer's word on what is
done (`packages/core/src/protocol/todos.ts`). A todo is matched by its words, so the comment may
be older than the document. `IssueState.todos` carries the spec's list with the ticks merged, and
Suite refuses Approve while one still blocks.

**Two kinds of step do not block (2026-09-17).** After `facts-a-day-backend#26`, whose one todo
was a mobile release in another repository that could only happen after the plan it was holding
had shipped: a step the engine writes as `Follow-up in <repository>: <the change>` is work
elsewhere, or possible only after this ships, and never blocks; `followUp` reads the repository
and the change back, and `stepKey` strips the prefix, so the step matches its own words on a
plan written before the engine learned it. And a step the person made into a task in another
project carries that task under it in the done comment, as one nested line, `- Task:
owner/repo#n, after this plan is built` (or `before AISWEC builds it`): "after" releases
Approve, "before" holds it until the linked task is accepted (closed as completed), and a linked
task closed as not planned holds it again, whichever was chosen. An older reader sees the nested
line as an unticked step matching nothing, and ignores it. Suite writes the line (`taskLine`)
when it makes or links the task, and `parseDone` attaches it to the step above it; one above
every step belongs to nothing and is dropped. A task carries over a re-run: the spec is written
again and only the done comments after it tick its list, but the latest maintainer's done
comment before it still names the tasks its steps were made into, and `IssueState.todos` keeps
them by the step's words (`carried` in `manualTodos`). `ManualTodos.left` is what still
blocks and `done` what is ticked; the two differ by exactly the follow-ups and the hand-offs.

```md
<!-- aiswec-done:v1 -->
Manual todos, as they stand:

- [ ] Ship the mobile release that sends the answered ids in the request body instead of the query string: mobile repo, then App Store and Play Store.
  - Task: yusufseyrek/facts-a-day-app#31, after this plan is built
```

A spec, whole, as the engine writes it:

```md
<!-- aiswec-spec:v1 -->
> [!NOTE]
> The plan arrives as a list you can scan. You see every file it means to touch.

## Implementation Spec

### At a glance

Size M · Files 4 · Contract wire protocol

### Problem

`planSections` lifts one field by regex and hands the rest over as markdown, so Suite cannot
tell a criterion from a paragraph.

### What the docs say

- [EAS Workflows](https://docs.expo.dev/eas-workflows/get-started/): jobs live in `.eas/workflows/*.yml`. Here: `eas.json` profiles only. Missing: the workflow files.

### Proposed approach

1. Add the registry and `parseDoc` in `packages/core/src/protocol/sections.ts`.
2. Read it in `apps/suite/src/github/views.ts`, keeping the heading split as the fallback.
3. Render one component per key in `apps/suite/web/components/Sections.tsx`.
4. Tests in `packages/core/test/sections.test.ts`: a plan of each format reads back typed.

### Affected files

- `packages/core/src/protocol/sections.ts` (add): the parser
- `apps/suite/src/github/views.ts` (edit): reads it, falls back to headings

### Code sketch

```ts
interface Section {
  key: string | null;
  shape: Shape; // new
  data: SectionData; // was: body, the markdown only
}
```

### Flow

- The engine writes the file → the workflow posts it → `parseDoc` (a heading it does not know stays prose) → Suite renders typed sections

### Acceptance criteria

- The plan card shows the files as a list.
- A comment posted before this format renders as it does today.

### Try it

1. `bun test packages/core`
   Expect: 0 fail.
2. Open a task planned last week.
   Expect: the page it shows today.
```

Then the finalizer appends `\n\n---\n\n` and the release footer, which `splitSpecFooter`
already cuts off, and the run line.

### `questions` (an issue comment or inside a reply, `<!-- aiswec-questions:v1 -->`)

The question grammar is unchanged and `parseQuestions` still owns it: `### 1. Question` with
`- (a) option` bullets, one `(recommended)`, `(pick all that apply)` on a heading when several
can be true, at most three questions, never an "other" option. What is new is only the lede.

```md
<!-- aiswec-questions:v1 -->
> [!NOTE]
> You asked for a comparison and the repository has no place for one yet. Tell me what it
> should leave behind and I can plan it.

### 1. What should this task produce?

A file I can check by reading it, or a code change I can test.

- (a) A written comparison in `docs/` (recommended)
- (b) A code change that uses the winner
- (c) Nothing yet, just an answer in the thread

### 2. Which models should I compare? (pick all that apply)

- (a) Opus
- (b) Sonnet
- (c) Haiku
```

### `escalate` (`<!-- aiswec-escalate:v1 -->`)

| key | heading | shape | columns |
| --- | --- | --- | --- |
| `plain` | the leading alert, `[!CAUTION]` | alert | |
| `docs` | `### What the docs say` | list | |
| `needs` | `### What a person has to do` | list | |
| `found` | `### What I found` | list | |

### `reply` (`<!-- aiswec-reply:v1 -->`)

| key | heading | shape | columns |
| --- | --- | --- | --- |
| `plain` | the leading alert | alert | |
| `todos` | `### Manual todos` | todo | |
| `changed` | `### What changed` | files | Path, Change, Why |
| `notes` | `### Notes` | list | |

`changed` and `notes` are optional; a reply that only answers a question is the alert alone.
A reply may carry a questions block, exactly as `revise` writes it today.

### `pr` (a pull request body)

| key | heading | alias | shape | columns |
| --- | --- | --- | --- | --- |
| `plain` | the leading alert | `In plain words` | alert | |
| `todos` | `## Manual todos` | `Your part` | todo | |
| `preview` | `## Preview` | | facts | Built from, Status |
| `meta` | `## At a glance` | | facts | Files, Lines, Checks |
| `summary` | `## Summary` | | text | |
| `docs` | `## What the docs say` | | list | |
| `changed` | `## Changes` | | files | Path, Change, Why |
| `flow` | `## Flow` | | flow | |
| `criteria` | `## Acceptance criteria` | | checks | |
| `checks` | `### Automated` | | code | |
| `try` | `### Manual verification` | `Try it` | olist | |

`## Testing instructions` stays as the container heading above `### Automated`; it parses as a
section with an empty body and Suite renders nothing for it. `Closes #n` stays last, and the
finalizer's `## Preview` goes in above it.

**`## Preview` is the finalizer's, never the engine's (2026-09-06).** When a repository's
`.github/aiswec.yml` sets `preview.web.command`, the build and revise stages run it after the
engine, on the pushed commit, export `preview.web.dir` into an Actions artifact, and the
finalizer writes the section into the pull request body: one facts line, then the marker line
directly under it (no blank line), with the payload the run line's idiom carries (`>` written
as `>`, the last line of its kind wins, a malformed line reads as absence). The registry
marks the entry `finalizer: true`, so the skeleton the engine copies omits the heading and no
prompt names it; `parsePreviewLine` in `packages/core/src/protocol/preview.ts` reads the
marker, and Suite reads only that. A label of two words (`Built from`) is read whole because
the registry names it; every other label is one word. The finalizer replaces an existing
`## Preview` section (from its heading to the line before the next `## `), so a body carries
one, and a pull request opened before this format carries none: `byKey.preview` is absent.

```md
## Preview

Link https://yusufseyrek-facts-a-day-app-31.aiswec.com/ · Built from 1a2b3c4 · Status ready
<!-- aiswec-preview:v1 {"pr":31,"sha":"1a2b3c4…","status":"ready","url":"https://yusufseyrek-facts-a-day-app-31.aiswec.com/","artifact":2345678,"run":987654321,"expires":"2026-09-20T10:00:00Z","dir":"web","access":"repository","storage":true} -->

Closes #30
```

A failed export writes `Built from 1a2b3c4 · Status failed · Run https://github.com/…/actions/runs/…`
over a marker whose `status` is `failed`; a stage that exported nothing (no pull request, nothing
pushed, previews off) writes no section at all. The host is `previewSlug(owner, repo, number)`:
owner and repository lower-cased, every run of anything but a letter or a digit one hyphen, joined
with the number by hyphens, and when that passes 63 characters (a DNS label's limit) the repository
name is cut and the first six hex characters of the SHA-256 of `owner/repo` are put before the
number, so two cut names stay apart. The same rule is `preview_slug` in both stage files, and
`stages.test.ts` runs the bash against the library.

**The phone is the same line's second half (2026-09-06).** With `preview.phone: eas` in
`.github/aiswec.yml` the build and revise stages publish the pull request's JavaScript as an EAS
Update on the branch `pr-<n>` (`eas update --branch pr-<n> --message "<title>"`, the token from the
`expo_token` secret, in that step's env and nowhere else), which a person's development build
(`expo-dev-client`) opens from a QR. No native build is ever started, and Expo Go is not a surface.
The marker gains two members, both absent on a line written before them or by a stage that ran no
phone step:

- `phone`: `status` (`ready`, `failed`, or `no-token` when no `EXPO_TOKEN` reached the stage,
  which is the person's step and not a failure), `branch` (`pr-<n>`), `group` (the update group
  id), `runtime` (the runtime version the update was published for), `project` (the EAS project
  id), `slug` (the Expo slug, every character outside `[A-Za-z0-9+.-]` removed), `scheme` (the
  app's own scheme, sanitised the same way), `qr`
  (`https://qr.expo.dev/eas-update?slug=<slug>&projectId=<project>&groupId=<group>`, which is
  the slug and never the scheme: a development build registers `exp+<slug>` and qr.expo.dev
  prefixes `exp+` itself, so `appScheme` names a scheme nothing answers whenever the two
  differ),
  `link` (`https://expo.dev/projects/<project>/updates/<group>`), `launch` (the deep link that
  opens this group in a development build, taken from `qr.expo.dev` itself with `format=url`,
  so the formula lives with Expo and not in a second place here) and `platforms` (`ios`,
  `android`, or both). Everything but `status` is nullish, and a null is written as absence,
  as on the line.
- `device` (2026-09-06): where the native shell that opens this update lives, so a cloud device
  can run the change without anyone installing anything. `status` is `ready`, or one of four
  refusals: `no-shell` (no finished development-client build matches, and a manual todo names
  the one `eas build` that would fix it), `no-env` (`preview.phone.env` is unset, and a device
  runs the tenant's real app, so it waits for an environment of its own), `public` (a public
  repository, where a shell address and a vendor build id would be world-readable), and
  `failed`. Then `platform`, `shell` (the EAS artifact address, which the vendor fetches
  itself, so neither the stage nor the box ever holds the binary), `runtime`, `fingerprint`,
  `profile` (the `eas.json` profile whose builds are development clients, which is what makes
  the shell able to open an update at all), `build` (the EAS build id) and `expires`.
  `shell` and `launch` are strings, not URLs, on purpose: a known key whose value fails
  validation takes the whole line's parse down with it, and a mistyped address must not cost
  the web preview and the QR. Suite checks the host before handing one to a third party.
- `native_touched`: whether the change touched `ios/`, `android/`, `app.json`, `app.config.*`,
  `eas.json` or `package.json`, so the person knows their development build may be too old for
  the update.

The facts line gains `Phone ready`, `Phone failed` or `Phone no token`, appended after `Status`
when the web preview is on; with the web off and the phone on the line is `Built from <sha7> ·
Status off · Phone ready`, and the section is written whenever the export step ran at all. The
registry still names `Built from` and `Status` as the labels it requires; `Phone` is one word and
reads back like `Link` does. Under the facts line, when the phone is ready, the finalizer writes
for a reader on GitHub: a blank line, then `Scan with your development build (runtime <runtime>):
![Phone preview QR](<qr>)` on one line, then `Update group: <link>`, and when `native_touched` is
true one more line, `This change touches native code, so the phone preview may need a new
development build.`; the marker follows the last of them. The facts reader takes the first line
only, so these lines stay in the section's body and are never read as facts; Suite draws the phone
from the marker, as it draws the web line.

```md
## Preview

Built from 1a2b3c4 · Status off · Phone ready

Scan with your development build (runtime 1.0.0): ![Phone preview QR](https://qr.expo.dev/eas-update?slug=facts-a-day-app&projectId=8b3c5d7e…&groupId=0c3f1a2b…)
Update group: https://expo.dev/projects/8b3c5d7e…/updates/0c3f1a2b…
This change touches native code, so the phone preview may need a new development build.
<!-- aiswec-preview:v1 {"pr":31,"sha":"1a2b3c4…","status":"off","phone":{"status":"ready","branch":"pr-31","group":"0c3f1a2b…","runtime":"1.0.0","project":"8b3c5d7e…","slug":"facts-a-day-app","scheme":"factsaday","qr":"https://qr.expo.dev/eas-update?slug=facts-a-day-app&projectId=8b3c5d7e…&groupId=0c3f1a2b…","link":"https://expo.dev/projects/8b3c5d7e…/updates/0c3f1a2b…","platforms":["android","ios"]},"native_touched":true} -->

Closes #30
```

When no token reached the stage (`no-token`), the finalizer adds one line to the body's
`## Manual todos` (creating the section when absent, once, never twice across revisions):
`- [ ] Publish the preview to your phone: run `` `eas update --branch pr-<n> --message "<title>"` ``
in this branch, then open pr-<n> in your development build; or add an EXPO_TOKEN secret and press
Update in Suite so AISWEC does it on every push`. It reads back through `todos` like any other
step of the person's.

### `notice` (posted by the finalizer, never by the engine)

Every notice is an alert whose first line is a bold title, then a table of what it knows, then
what to do. `classifyBotComment` reads the title.

| title | `BotReason` |
| --- | --- |
| `AISWEC cannot start: the settings file is invalid.` | `settings-invalid` |
| `Refine failed: no plan was produced.` | `refine-failed` |
| `Build stopped: no trusted plan to build.` | `no-trusted-spec` |
| `Build stopped: a newer plan was posted after that approval.` | `stale-spec` |
| `Build finished with a draft pull request.` | `draft-pr` |
| `Build failed: no pull request was opened.` | `no-pr` |
| `Revise failed: the feedback was not processed.` | `revise-failed` |
| `Build withheld: the hold label is set.` | `held` |
| `Build could not be started automatically.` | `dispatch-failed` |
| `Build not started: the labels could not be read.` | `labels-unreadable` |

```md
> [!WARNING]
> **Build stopped: no trusted plan to build.**

| What | Value |
| --- | --- |
| Approval | @yusufseyrek, 12 minutes ago |
| Plan | none by a trusted author |

### What to do

- Re-run the refine workflow on this issue to get a plan.
```

The seven prose sentences these replace stay matched in `classifyBotComment`, so a notice
posted before this format still names its reason.

The acknowledgement comment is unchanged, byte for byte: it is the only thing that tells Suite
a run is in flight, and its emoji are matched by a regex in `state.ts`.

```
⏳ Analyzing. A plan, or a question for you, follows in a few minutes ([run](URL)).
🔨 Implementing. A PR will follow ([run](URL)).
💬 Working on your feedback. A reply (and possibly new commits) will follow ([run](URL)).
```

### `from` (a task's body, `<!-- aiswec-from:v1 … -->` on its last line; written by Suite as the person, never by a stage)

A manual todo that is work in another project becomes a task there from Suite (*Make it a task*
on the row, 2026-09-17), and the task's body ends with a `from` line: a marker kind of its own,
carrying a JSON payload in the run line's idiom (`payloadLine` and `readPayload` in
`packages/core/src/protocol/run.ts`; `fromLine` and `parseFromLine` in `protocol/handoff.ts`,
so `>` is written as `\u003e`, the last line of its kind wins, and a line that does not parse
reads as absence). Its members, in this order: `repo` and `issue` (the source task, `owner/repo`
and its number), `spec` (the id of the spec comment the step was read from; absent when there
was none), `todo` (the step's key, `stepKey`: its words lower-cased, one space between them, no
trailing full stop, the follow-up prefix off, which is the join a re-run cannot change) and
`when` (`after` or `before`). Suite reads it for the *From* block on the task page and to find,
once a re-run has rewritten the source's list, the task an older step was made into; nothing else
reads it. It is the person's word, not the bot's: a pointer, never authority, and Suite reads the
source issue itself for anything it shows. `createIssue` appends the ask line after it, and
`parseFromLine` still finds it.

```md
<!-- aiswec-from:v1 {"repo":"yusufseyrek/facts-a-day-backend","issue":26,"spec":2345678901,"todo":"ship the mobile release that sends the answered ids in the request body instead of the query string: mobile repo, then app store and play store","when":"after"} -->
```

The body above the line is `handoffBody`'s, written to stand on its own: the stage that plans
the new task runs with a token scoped to its own repository and fetches no URL an issue offers,
so the pointer alone would leave it nothing to plan from. In order: the person's words from the
sheet (may be empty); one sentence saying where the step came from and when it is wanted, `From a
manual todo on owner/repo#26 (title). Plan it now; ship it only after that plan is built and its
changes are accepted.`, or for `before`, `From a manual todo on owner/repo#26 (title): that plan
waits for this task before AISWEC builds it.`; then `### From that plan`, which quotes the plan's
lede as a `[!NOTE]` alert, `Contract:` with the At a glance line's Contract value, `#### Code
sketch` and `#### Flow` as the plan wrote them (the fences themselves, never wrapped in a fence of their
own; each left out when the plan has none, and the whole section when it has nothing to quote);
then `The whole plan is on owner/repo#26.`; then the from line. Never the plan's approach, files
or checks: those are the other repository's business. The body is capped at 8,000 characters
(`HANDOFF_CAP`): past it the Flow goes first, then the Code sketch, then the whole quote, and the
words, the pointer sentence and the line always remain.

```md
Send the ids in the body.

From a manual todo on yusufseyrek/facts-a-day-backend#26 (Trivia questions are not loading). Plan it now; ship it only after that plan is built and its changes are accepted.

### From that plan

> [!NOTE]
> The trivia hub packs every answered question into the address it asks with.
> I will add a second way to ask that carries the list inside the request.

Contract: three additive POST twins, every GET unchanged

#### Code sketch

```ts
// new: request bodies for the POST twins
interface TriviaSelectionBody {
  language: string;
  exclude_question_ids?: number[];
}
```

```ts
interface TriviaAvailabilityBody {
  language: string;
}
```

#### Flow

- The hub needs questions → `POST /trivia/selection` → the trivia handler

The whole plan is on yusufseyrek/facts-a-day-backend#26.

<!-- aiswec-from:v1 {"repo":"yusufseyrek/facts-a-day-backend","issue":26,"spec":2345678901,"todo":"ship the mobile release that sends the answered ids in the request body instead of the query string: mobile repo, then app store and play store","when":"after"} -->
```

### `with` (a task's body, `<!-- aiswec-with:v1 … -->` on its last line; written by Suite as the person, never by a stage)

One ask can be made in up to five projects at once (*New task* with several picked, 2026-10-08):
Suite opens one issue in each and ends every body with a `with` line, in the run line's idiom
(`withLine` and `parseWithLine` in `packages/core/src/protocol/with.ts`). Its members: `tasks`,
every task of the set as `owner/repo#n`, this one included, in the order they were made, each
project once; and `lead`, one of them, present only when the person chose one project to plan
first. A line that does not parse, names a project twice, or leads with a task outside the set
reads as absence. Suite reads it for the *Shared with* block on the task page and the words on
the row, and to start the waiting tasks when the lead's plan is approved in Suite. A stage never
reads it: every stage takes HTML comments out of an issue before the engine reads it, so what
the engine is told is the sentence above the line (`sharedSentence`), which names the others as
`owner/repo#n` (GitHub links them both ways) and asks for this repository's part alone.

```md
Let people save favourite facts.

This task is shared with yusufseyrek/facts-a-day-app#88, which AISWEC plans once this plan is approved, against it. Plan only this repository's part, and put what the other side builds against (an endpoint, a payload, a name) in the Code sketch.

<!-- aiswec-with:v1 {"tasks":["yusufseyrek/facts-a-day-backend#41","yusufseyrek/facts-a-day-app#88"],"lead":"yusufseyrek/facts-a-day-backend#41"} -->
```

Planned together, each sentence reads `This task is shared with <the others>, where AISWEC plans
that repository's part at the same time. Plan only this repository's part, and put what the two
must agree on (an endpoint, a payload, a name) in the Code sketch.`; a task that waits reads
`This task is shared with <the others>. AISWEC plans <the lead> first, and this one once that plan
is approved, against it. Plan only this repository's part.` The issues are opened without the
label, every body is then written with every number, and only then are the labels added (all of
them, or the lead's alone), so no plan starts before its body names the others.

A waiting task is started with a comment of the person's, posted just before its label
(`startComment`): `Plan this against the approved plan on <lead> (<title>). What it says this side
builds against is settled; where this repository cannot follow it, say so in the plan.`, then the
lead's plan quoted under `### From that plan` exactly as a hand-off body quotes it (the lede, the
Contract, the Code sketch and the Flow, capped at `HANDOFF_CAP` the same way), then `The whole
plan is on <lead>.` Started before that plan is approved, the first sentence says it is not
approved yet and may still change; started before there is a plan, the comment is one line:
`Plan this now, without waiting for <lead> (<title>) to be planned first. Plan only this
repository's part.`

### `files` (a task's body, a comment or a review, `<!-- aiswec-files:v1 … -->` under the words; written by Suite as the person, never by a stage)

A person attaches images and text files to a new task or a reply in Suite (2026-10-09). GitHub
has no API for the uploads its own editor makes, so Suite keeps each file in the repository as a
git blob, written with the person's own token, and one commit on `refs/<namespace>/files` keeps
them reachable: a ref that is neither a branch nor a tag, so no workflow runs on it and no clone
fetches it. Each file sits in that commit's tree at `<first two hex>/<blob sha>.<ext>`
(`filePath`). The body ends with the block: the marker line, in the run line's idiom (`filesLine`
and `parseFilesLine` in `packages/core/src/protocol/files.ts`), then one link per file into
GitHub, an image as `![name](…?raw=true)` and a text file as `[name](…)`, so a reader on GitHub
sees them too. The marker's `files` are one to ten of `{sha, name, type, bytes, w?, h?}`: the
blob's hash, a name `safeFileName` keeps, one of `image/png`, `image/jpeg`, `image/gif`,
`image/webp` or `text/plain` as the bytes say (never as the name or the browser says), the size,
and an image's width and height. A line naming a file twice, a name Suite would not write, an
image without its size or a text with one reads as absence.

```md
The login button does nothing on Safari.

<!-- aiswec-files:v1 {"files":[{"sha":"3f9e…","name":"login.png","type":"image/png","bytes":182044,"w":1568,"h":980},{"sha":"a01c…","name":"console.log","type":"text/plain","bytes":2310}]} -->
![login.png](https://github.com/o/app/blob/<commit>/3f/3f9e….png?raw=true)
[console.log](https://github.com/o/app/blob/<commit>/a0/a01c….log)

<!-- aiswec-ask:v1 {"provider":"anthropic","model":"claude-opus-5-5"} -->
```

Suite shows the files under the words (`shownFiles`, the block taken off the body) from its own
address, `GET /api/r/:owner/:repo/files/:sha`, read with the reader's token, typed again by the
bytes and answered as an image or as plain text, sandboxed, never sniffed. A stage reads the line
the way it reads the ask line: from a body a maintainer wrote and nobody else, every body of the
task and, in revise, of its changes; it fetches each file by its hash with the run's token,
checks the bytes are that hash and that type, and lists the files at the end of the thread file
the engine reads, under `## Files a maintainer attached`. An image reaches a model that takes
images; any other model is told its name. The block itself never reaches the engine: the thread
file takes the marker and the links under it out (`unfiles` in the stages).

## What Suite renders

| key | component | fallback |
| --- | --- | --- |
| `plain` | the lede, alert unwrapped, never folded | `Markdown` |
| `meta` | `MetaPills`: `medium · 4 files · touches a contract · 2 checks`; the size reaches the task page through `specSize` today | the line |
| `problem` `summary` `notes` | `Markdown` | itself |
| `approach` | `StepList`, numbered squares | ordered list |
| `files` `changed` | `FileList`, the path links to its diff | list |
| `schema` | a `<pre>` highlighted in the fence's language (`highlight.js` as a lazy bundle, every fence in Suite since 2026-10-07), its language named in the corner | the code fence |
| `flow` | `FlowPaths` since 2026-10-07: each path a row of steps joined by arrows, a note in parentheses muted; a mermaid fence from an older plan is drawn by `Markdown` (a lazy chunk, redrawn on a theme change) | `Markdown` |
| `criteria` | `Criteria`, count feeds the status line | bullets or ticks |
| `checks` | `Commands`, one row per command with a copy button | `<pre>` |
| `try` | `TryIt`, numbered steps with their Expect | list |
| `open` `needs` | bullets, a lone "None" renders nothing | `Markdown` |
| `found` | quiet list inside the warn notice | list |
| `docs` | list, the source as a link out | list |
| `preview` | nothing of the section itself: the task page reads the marker (`TaskView.preview`) and draws its own line and the Open preview button, and since 2026-09-06 the phone's QR, runtime and group link from `phone`, with the native warning from `native_touched`, and the cloud device from `device` | nothing |
| `from` | nothing of the line itself: the task page reads the marker (`TaskView.from`) and draws the *From* block in its aside, the source task, its title, when this one is wanted and where that one stands (2026-09-17) | nothing |
| `with` | nothing of the line itself: the task page reads the marker (`TaskView.shared`) and draws the *Shared with* block, each other task with where it stands and which is planned first, and the board reads it into the row's words (`BoardCard.shared`, 2026-10-08) | nothing |
| `title` and `## Testing instructions` | nothing, the heading is a container | nothing |
| unknown | `Markdown`, in document order, after the known keys | itself |

Render order is fixed for known keys, so Suite's layout does not depend on the order the
engine emitted. Typed components render only when the comment's author is a bot login;
anyone else's markdown renders as markdown, so a commenter cannot borrow Suite's chrome.

## Writing rules handed to the engine

1. Two sentences maximum before the list, checklist, fence or line that carries the meaning.
2. Keep every heading below, byte for byte, in this order. Omit an optional section whole.
3. No tables: a list, one item per row, and the facts line and the files bullet in their exact
   shapes.
4. Close every fence you open.
5. Pseudo code in a fence beats a paragraph describing code.
6. No em dashes, no emoji, no exclamation marks, no praise, no filler.
7. Show before you tell: Flow whenever something moves, Code sketch whenever a shape changes, and
   prose only for what neither carries.

The engine is not told these rules by hand any more. `packages/core/src/prompt/templates.ts`
renders each document's skeleton **from the registry above**, so the example a prompt tells the
engine to copy is the registry, and `packages/core/test/prompt.test.ts` parses that example back
with `parseDoc` to prove it. Renaming a heading in one place is no longer possible.

## Adding to the format

A new heading is additive: give it a key in the registry, a shape, and a component. Old
comments do not carry it and read back as absent. Renaming a heading needs an alias entry, and
the alias is never removed. Changing the facts line's labels is the same: add, never rename.
