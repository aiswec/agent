/**
 * Where the repository stands, against what its documentation says it should.
 *
 * Added 2026-09-04 after `facts-a-day-app#28`, "Implement EAS Workflows", was
 * refused: the engine had no way to read `docs.expo.dev`, so what it wrote
 * about EAS Workflows came out of the model's memory, and the answer to a task
 * whose whole content is "follow this vendor's guide" was that a person should
 * go and read the guide. Two things fix that, and both live here: the engine
 * reads the vendor's own documentation at the version the repository pins, and
 * it posts the comparison rather than a summary of one side of it.
 */
import { WEB_TRUST } from "./trust.js";
import type { Stage } from "./stage.js";

const HOW = `1. What the repository has today. Its ground rules first (CODE.md,
   CLAUDE.md, README.md), then the files this task touches. Pin versions from the
   repository itself, never from memory: package.json and the lockfile,
   the tool's own config file (eas.json, tsconfig.json, Cargo.toml,
   go.mod, pyproject.toml), the CI workflows, the scripts directory.
2. What the authoritative guide says, at that version. Find the official
   documentation for each technology this task names: WebSearch for it,
   WebFetch to read it. The vendor's own docs, the library's guide, the
   framework's migration notes, the standard's text; not a blog, a forum
   answer or your memory of the API. Read the version the repository
   pins, and say so when the repository is behind.`;

export function ground(stage: Stage): string {
  if (stage === "refine") {
    return `## Where the repository stands
Before you choose an outcome, establish both sides and write down the
difference: a plan that only restates the issue is worth nothing, and
one built on a half-remembered API is worse.

${HOW}
3. Compare them: what the guide says the shape is, what the repository
   has, what is missing or wrong. That difference is your Problem,
   posted under "What the docs say", one bullet per source.

When the task names nothing outside this repository, steps 2 and 3 read
its own documentation instead: CLAUDE.md, the READMEs, the docs
directory, the header comment of the module you are changing; a plan
with no "What the docs say" should be rare.

${WEB_TRUST}`;
  }
  return `## Before you write against an API
Never write a call, a config key, a flag or a file format from memory.
Read it: the repository's own usage first (grep for another call site),
then the dependency's types or source under the lockfile's version, then
the vendor's documentation with WebSearch and WebFetch when the first
two do not settle it. The spec may name the source; read it anyway if
you are about to depend on a detail it does not spell out.

${WEB_TRUST}`;
}
