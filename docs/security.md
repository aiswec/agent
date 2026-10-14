# Security

AISWEC runs an AI model inside your GitHub Actions, with a token that can write to your repository
and a key that pays for the model. This page says what that can touch, what protects you, and what
does not.

Two kinds of protection are kept apart here, because they are not equally strong:

- **Enforced**: the workflow's own code checks it, whatever the model says or does.
- **Told**: the model is instructed to do it. A model can be talked out of an instruction by text
  written to fool it (a prompt injection), so treat these as good behavior, not as a guarantee.

## What runs where

```mermaid
flowchart LR
    subgraph runner["Your repository's GitHub Actions runner"]
        S["AISWEC stage<br>(this repository, at @v2)"] --> M["Claude Code<br>(the model's tools)"]
    end
    E(["An event in your repository:<br>a label, a comment, a review"]) --> S
    S --> G["GitHub API<br>your repository"]
    M --> P["Model provider<br>Anthropic or OpenRouter"]
    M -. "web search and fetch" .-> W["Any website"]
    S -. "hosted mode only" .-> A["aiswec.com<br>a token for the run"]
```

- **Every run happens in GitHub Actions, in your repository**, on GitHub's runners. Your code is
  checked out there and nowhere else.
- **The model provider** receives what the model reads: your issue, the parts of your code it opens,
  and its own notes. That is Anthropic with your Claude subscription, or OpenRouter with your key.
- **openrouter.ai's public model list** is read, without a key, when the provider is OpenRouter, to
  check the model's context window.
- **Phone previews only**: the npm registry (to run Expo's tools) and Expo's servers, with your
  `EXPO_TOKEN`.
- **Hosted mode only**: aiswec.com, for the run's GitHub token (see
  [Hosted mode](#hosted-mode-what-aiswecs-server-sees)). A self-hosted run never contacts
  AISWEC.

## What a run can touch

The GitHub token a run writes with can do this much, and no more:

- **refine**: Actions, Contents, Issues and Pull requests (write), Metadata (read).
- **build** and **revise**: the same, plus **Workflows** (write), so a task can add or change a CI
  workflow file.

With a GitHub App (yours, or AISWEC's in hosted mode), the token covers your repository alone and
lasts an hour. Without an App, the job's own `GITHUB_TOKEN` is used, limited by the `permissions:`
in your workflow files.

What the model itself may do, by stage (**enforced** by the tool list each stage passes):

- **refine** can read files, write its answer to a scratch file, search and fetch the web, and read
  another issue or pull request through the stage's reader (below). It cannot run commands, commit
  or push.
- **build** can also edit files and run: `git` (status, diff, log, add, commit, new branch, push),
  `bun` and `npm` commands that install, run scripts, test, type-check and lint, `gh pr create`,
  `ls` and `cat`.
- **revise** has build's list without creating a branch or a pull request, plus `gh pr ready`.

**Build and revise can run code they write**, because `bun run` and `npm run` run whatever a
script says. Treat a build or a revise as code running with the run's token and model key. That is
what the protections below are for.

## Who can start a run

**Enforced** by every stage before the model starts:

- **refine** starts when a maintainer adds the `aiswec` label. Opening an issue starts nothing.
- **build** starts when a maintainer approves with a comment or the `aiswec:ready-to-build` label.
- **revise** starts when a maintainer comments on or reviews one of AISWEC's own pull requests: a
  branch under the stage's prefix (`aiswec/` by default), in your repository, still open.
- A stage started by hand from the Actions tab needs write access to the repository, which GitHub
  checks.
- AISWEC's own comments never start a run.
- `aiswec:hold` stops build and revise; removing `aiswec` stops every new run.

Maintainers are the `maintainers` list in `.github/aiswec.yml` **on your default branch**. Whoever
can change that file decides who can direct AISWEC, so guard it as you would a workflow file.

## What the model reads

**Enforced:**

- The issue and its comments reach the model as a file the stage writes, and so does the plan
  build works from. **What GitHub hides on the page is taken out first**, because an instruction
  could sit there unseen: HTML comments (however long, closed or not), Markdown link definitions
  such as `[//]: # (...)`, and characters that draw as nothing. AISWEC's own marker lines are kept.
- **Another issue or pull request reaches it the same way.** The model's one way to read one is a
  reader the stage writes, which prints it through the same filter. `gh issue view` and
  `gh pr view`, which print a body as written, are not in its tools.
- **A plan changed after your approval is not built.** GitHub lets anyone with write access edit a
  comment, AISWEC's included. When you approve with a comment, build checks that the plan was
  neither posted nor edited after your approval, and stops if it was.
- Text from an issue or a comment never becomes part of a script the workflow runs. It reaches the
  workflow's own steps only through environment variables, which closes the classic "script
  injection" hole in GitHub Actions.
- The per-task model choice and attached files count only when a maintainer wrote them. An attached
  file is checked against its hash, its type and a size limit.

**Told:**

- Only a maintainer's words are instructions. Everyone else's are information.
- A link in an issue is data, never a place to go. For documentation, the model searches for the
  vendor's own pages.

**Known gaps**, which we intend to close:

- The strip reads Markdown as text, not as GitHub draws it, so a rarer way to hide text may still
  get through, such as a link definition's title continued on the next line.

## What leaves a run

**Enforced:** after the model finishes and before anything is posted or kept, a step reads what is
about to leave for the exact secrets the run holds (your model key, your Expo token, the GitHub
token) and for anything shaped like a key or a token (Anthropic, OpenRouter, GitHub, a private key).
On a match:

- **refine** throws its answer away and posts a failure notice instead.
- **build** closes the pull request and deletes its branch.
- **revise** deletes its reply and puts the branch back where it found it.

The run then fails and says why.

The commit messages are read too, since a message is public as soon as it is pushed.

**The run's log** shows the model's full transcript only in a private repository, where the log is
as private as the code. In a public one, where anyone can read the log, it shows the outcome alone.
GitHub hides known secret values in the log either way.

**Not covered:** branches other than the one AISWEC works on, and requests the model makes with its
web tools.

## What the model is told, and not forced, to do

- Never push to your default branch, and never force-push.
- Leave AISWEC's own workflow files (`aiswec-*.yml`) and your checks' workflow alone.
- Keep to the approved plan, and ask about anything the plan does not cover.

Each of these can be made a guarantee in your repository's settings. See the next section.

## Make it stronger in your repository

1. **Protect your default branch.** Require a pull request with one approving review, and leave
   *Allow GitHub Actions to create and approve pull requests* off (Settings, Actions, General).
   AISWEC cannot approve the pull requests it opens, so nothing it does reaches your default branch
   without you.
2. **Keep the maintainers list short**, and require a review for changes to `.github/aiswec.yml`,
   for example with a `CODEOWNERS` entry.
3. **Read changes to `.github/workflows/` with care.** A workflow file on a branch runs on that
   branch's events, with your repository's secrets, before anyone merges it.
4. **Use a key you can cap and rotate.** On OpenRouter, give the key a spending limit.
5. **Pin the stages** to a commit instead of `@v2` if you want to read every change before it runs
   in your repository. `@v2` follows the latest release.

## Hosted mode: what AISWEC's server sees

When a repository is set up through Suite, it holds AISWEC's App id but not the App's private key.
The key stays on AISWEC's server. To get a token, a run sends AISWEC the job's OIDC token: a short
proof, signed by GitHub, of which repository and which workflow is asking.

- AISWEC answers only for one of the three stages, from this repository, at `main` or a release
  tag, in a repository where its App is installed.
- The answer is a GitHub token for that one repository, valid for an hour, with the permissions
  above and never more.
- AISWEC never receives your model key, your code or your issues this way.

What reaches AISWEC through the App, and for how long, is on the App's own
[privacy page](https://aiswec.com/privacy/github-app/). Suite, the web app, reads GitHub as the
person signed in to it. What it keeps is in the [privacy policy](https://aiswec.com/privacy/).

## Third-party code a run uses

- `actions/checkout` v4.4.0, `actions/create-github-app-token` v2.2.2 and
  `anthropics/claude-code-action` v1.0.248.
- Build and revise also use `oven-sh/setup-bun` v2.2.0, `actions/setup-node` v4.4.0 and
  `actions/upload-artifact` v4.6.2.
- With phone previews: `eas-cli@23.2.0` and Expo's own CLI, from npm.

Each action is pinned to a commit, with its release named beside it, so a tag moved by its owner
changes nothing that runs in your repository. A new release reaches the stages as a change here.

## Reporting a problem

See [SECURITY.md](../SECURITY.md). Please tell us privately first.
