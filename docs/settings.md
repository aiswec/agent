# Settings

AISWEC is configured by one file in your repository, `.github/aiswec.yml`. Every stage reads it from
your default branch when it starts, so a change takes effect on the next run. Every key is optional
except `maintainers`.

```yaml
maintainers: [alice, bob]       # who may assign, approve and review (required)

# provider: anthropic           # or openrouter
# model: claude-opus-5          # leave out to use each stage's default
effort: high                    # low, medium, high, xhigh or max

advance:
  build: approval               # or auto: build starts as soon as a plan is posted

runtime:
  setup: bun                    # bun, node or none
  version: "1.3.14"             # in quotes, or YAML reads 1.30 as 1.3
  install: bun install --frozen-lockfile

gates:                          # the checks every change must pass
  - bun test
  - bun run typecheck

reserved_prefixes: ["/deploy"]  # comments that are for another bot

preview:
  web:
    command: bun run build
    dir: dist
```

## Who

### `maintainers`

A list of GitHub logins. Maintainers are the only people who can assign a task, approve a plan and
steer a review, and only their per-task model choices and attached files count. Without it every
run stops with "maintainers is empty".

## The model

### `provider`

- `anthropic`, the default: Claude, paid by your Claude subscription. Needs the
  `CLAUDE_CODE_OAUTH_TOKEN` secret.
- `openrouter`: any model OpenRouter serves. Needs the `OPENROUTER_API_KEY` secret, and `model`.

### `model`

Under `anthropic`, a Claude model id. Leave it out to use each stage's default: `claude-sonnet-5` to
plan, `claude-opus-5` to build and revise. Set here, it applies to all three.

Under `openrouter` it is required: an OpenRouter model id, such as `vendor/model`. The model must
hold a million tokens of context or more, or the run stops with a comment saying so before it
starts: a smaller window runs out on a real repository.

### `small_model`

OpenRouter only. The model Claude Code uses for its small background jobs. Defaults to `model`.

### `effort`

`low`, `medium`, `high`, `xhigh` or `max`: how hard the model thinks. Claude only; ignored with a
warning under OpenRouter. At `xhigh` or `max` a plan gets more turns and minutes (see *Not settings*).

## After a plan

### `advance.build`

- `approval`, the default: build waits for a maintainer to approve the plan.
- `auto`: build starts as soon as the plan is posted, unless the issue has `aiswec:hold`. Your
  refine workflow file then needs `actions: write` under `permissions`.

## Checks

### `gates`

The commands that say a change works, run from the repository's root. Build and revise run every
one, and fix what fails, before they push. Refine names them in the plan. Without gates, nothing
checks the code.

The gates are run by the model as it works. Your own CI still runs on every push, and is what a
merge should wait for.

The model may run `bun` commands (`bun test`, `bun run lint`) and `npm run` scripts
(`npm run test`), and `jest`, `tsc` and `eslint` through `bunx` or `npx`. Write each gate in one of
those forms; `npm test` on its own, `cargo test` or `pytest` will be refused. For another language,
put the command in a `package.json` script, or pass the whole list of tools the model may use as
`allowed_tools` in your build and revise workflow files.

### `runtime`

What build and revise install before the model starts.

- `setup`: `bun`, `node` or `none`. Default `bun`.
- `version`: the version of that runtime. Default `"1.3.14"`, which is a bun version, so set it if
  you use `node`. Put it in quotes.
- `install`: a command to run first, such as `npm ci`. Left out, nothing is installed.

## Comments that are not for AISWEC

### `reserved_prefixes`

A list of prefixes. A comment whose first line starts with one is never read as an approval or as
review feedback. Use it for other bots' commands, such as `/deploy`.

## Previews

A preview builds each change so you can try it before you merge.

### `preview.web`

- `command` (required): builds the site, for example `bun run build`.
- `dir`: where the built files land. Default `dist`.
- `env`: plain values the build needs, such as `API_URL: https://staging.example.com`. Never
  secrets: the build runs without your secrets and tokens, on purpose.
- `storage`: `true` lets the preview use the browser's storage, which many single-page apps read at
  start. Default `false`.

After each change, build and revise run the command on the pushed commit and keep the result as a
workflow artifact named `aiswec-preview-<number>`, for 14 days. In hosted mode, Suite serves it at
`https://<owner>-<repo>-<number>.aiswec.com/`. Self-hosted, download the artifact from the run; the
link in the pull request works only through Suite.

### `preview.access`

Hosted mode only. `repository`, the default: only people who can read the repository, signed in to
Suite. `link`: anyone with the link.

### `preview.phone`

For Expo apps. `eas` publishes each change as an EAS Update on the branch `pr-<number>`, which you
open in a development build of your app (not Expo Go) by scanning the QR code in the pull request.
It needs the `EXPO_TOKEN` secret; without it, the exact command goes under Manual todos instead.

The longer form takes options:

```yaml
preview:
  phone:
    update: eas
    profile: development        # the eas.json profile your development builds come from
    env:                        # plain values baked into the update
      EXPO_PUBLIC_API_URL: https://staging.example.com
```

`device` is reserved for Suite's cloud phone, which is not available yet.

## One task at a time: the ask line

Suite's *New task* form can pick the provider, the model and the effort for one task. It writes them
into the issue as a line of its own, which GitHub hides:

```
<!-- aiswec-ask:v1 {"provider":"anthropic","model":"claude-opus-5","effort":"high"} -->
```

All three stages read it, but only when a maintainer wrote the issue.

## Which value wins

1. The ask line in the issue, for the provider, the model and the effort.
2. `.github/aiswec.yml`.
3. The `with:` block in your workflow files.
4. The stage's own default.

An empty value falls through to the next.

## When the file is wrong

The run stops before anything else and leaves one comment, such as "aiswec cannot start:
`.github/aiswec.yml`, maintainers is empty". Every run leaves that comment until the file is fixed.

## Not settings

- **Turns and minutes** belong to each stage: refine has 60 turns and 20 minutes (90 and 35 at an
  effort of `xhigh` or `max`, which thinks longer on every turn), build and revise 120 turns and 40
  minutes each. A task that needs more is too large. Split it. A run that finishes a few turns past
  its cap keeps its work; one that runs out of minutes does not.
- **`detail`, `stages` and `type`** are older keys. They are ignored.

## In the workflow files

Your three workflow files pass a few values of their own, under `with:`:

- `namespace`: the prefix of the labels and of AISWEC's markers, `aiswec` by default. Keep it the
  same in all three.
- `branch_prefix`: the start of AISWEC's branch names, in build and revise.
- `base_branch`: the branch pull requests are opened against, in build. Default `main`.
