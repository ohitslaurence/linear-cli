# linear-cli

A fast, single-binary CLI for [Linear](https://linear.app) — built to be driven
equally well by a human and by local AI agents.

Every command speaks two languages: human-friendly text/CSV by default, and
stable, documented **`--json`** for scripts and agents. It's a typed
[Effect](https://effect.website) app under the hood, compiled to one `linear`
binary with [Bun](https://bun.sh).

```bash
linear issues --assignee me --state open        # what's still on my plate
linear issue SPR-123                            # detail, sub-issues, PR links
linear comments SPR-123 --json                  # the whole thread, in order
linear issues --team SPR --json | jq '.items[].identifier'
linear update SPR-1,SPR-2 --state "In Progress" --dry-run
```

## Quickstart (20 seconds)

```bash
git clone https://github.com/ohitslaurence/linear-cli && cd linear-cli
bun install && bun run build
ln -s "$PWD/dist/linear" ~/.local/bin/linear     # put it on your PATH
export LINEAR_API_KEY=lin_xxx                     # see "Authentication" below
linear issues --assignee me
```

## Install

Requires [Bun](https://bun.sh) (`curl -fsSL https://bun.sh/install | bash`).

```bash
bun install
bun run build        # compiles a standalone binary to dist/linear
```

Then put it on your `PATH`. Either symlink the binary:

```bash
ln -s "$PWD/dist/linear" ~/.local/bin/linear
# ensure ~/.local/bin is on your PATH
```

…or use Bun's linker (runs from source, no compile step):

```bash
bun link            # exposes `linear` globally via bun
```

Verify:

```bash
linear --version
linear --help
```

## Authentication

The CLI needs a **personal API key**. Get one from **Linear → Settings →
Security & access → Personal API keys** (`https://linear.app/<workspace>/settings/account/security`).

The easiest way to set it up — `auth login` verifies the key and saves it:

```bash
linear auth login                  # prompts for the key (input hidden)
linear auth status                 # → Logged in as You <you@example.com>
```

```bash
linear auth login --key lin_api_xxx   # non-interactive (CI / agents)
linear auth logout                    # remove the saved key
```

`auth login` stores the key in `~/.config/linear/env` (mode `0600`). Prefer not
to persist it? Just export it instead — the **environment takes precedence**
over the file:

```bash
export LINEAR_API_KEY=lin_api_xxx
```

**Never commit your key** — the repo's `.gitignore` excludes `.env`.

## Output modes

Default output is compact and human-readable (CSV for lists, text for detail):

```text
$ linear issues --limit 2
id,title,state,assignee,due,labels,priority,team
SPR-9308,Card error on signup,Done,laurence,2026-05-30,bug,medium,SPR
GROW-1631,End-of-week insights,Prioritized,pedro,-,,high,GROW
```

Add `--json` to any command for stable, machine-readable output. Field names are
consistent across commands and `Date` fields are ISO-8601 strings.

**Every list command returns an envelope**, never a bare array:

```text
$ linear issues --limit 1 --json
{
  "items": [
    {
      "id": "a28e99cb-…",
      "identifier": "GROW-1631",
      "title": "End-of-week insights",
      "state": "Prioritized",
      "stateType": "unstarted",
      "priority": 2,
      "createdAt": "2026-05-23T04:25:51.001Z",
      "updatedAt": "2026-05-23T04:25:51.001Z",
      "dueDate": "2026-05-30",
      "team": "Growth",
      "teamKey": "GROW",
      "assignee": "pedro",
      "assigneeId": "…",
      "labels": ["insight"],
      "url": "https://linear.app/…/GROW-1631"
    }
  ],
  "pageInfo": {
    "returned": 1,
    "limit": 1,
    "hasNextPage": true,
    "truncated": true,
    "endCursor": "…"
  }
}
```

`pageInfo.truncated` is the field to branch on: it is `true` exactly when
`--limit` cut the result short. Without it a diff built on a truncated list
looks identical to one built on a complete list, and quietly drops whatever fell
off the end. `totalCount` appears only where Linear reports one (`linear search`);
it is left out rather than guessed.

Fields that have no value are **omitted**, not set to `null`.

Issue payloads carry `assignee`, `dueDate` and `labels` in the list itself, so
reading sixteen tickets is one API call rather than seventeen. `linear issue`
additionally returns `children` (a non-empty list means the ticket is a
container, not work) and `attachments` (a `sourceType` of `github` is the PR
link, which makes "marked Done with no pull request" computable).

### Errors

On failure, `--json` writes a `{"error": …}` object to **stdout** and exits
non-zero. Errors also go to stderr in human mode. Writing only to stderr is what
leaves a 0-byte output file that downstream `jq` reads as a legitimately empty
result.

```text
$ linear issue SPR-99999 --json; echo "exit=$?"
{
  "error": {
    "tag": "LinearNotFoundError",
    "operation": "getIssue",
    "message": "Entity not found: Issue",
    "displayMessage": "Not found (getIssue): Entity not found: Issue",
    "exitCode": 3,
    "retryable": false
  }
}
exit=3
```

| Exit | Meaning | Retry? |
| ---- | ------------------------------------------------- | ------------------------ |
| 0    | success                                           | — |
| 1    | unclassified API error                            | no |
| 2    | invalid input or bad arguments                    | no |
| 3    | not found                                         | no |
| 4    | authentication / no usable API key                | no |
| 5    | transport failure or 5xx from Linear              | yes, once |
| 6    | rate limited (429)                                | yes, after `retryAfterSeconds` |

A 429 and a 503 are deliberately different codes: "retry once" is right for the
503 and wrong for the 429, where the only correct move is to wait first. A
`RateLimitError` payload carries `retryAfterSeconds`, `requestsRemaining` and
`requestsResetAt` when the API supplies them.

### Empty values are rejected

`--assignee ""` is an error, not "no filter". An unset shell variable expands to
the empty string, so a silently-ignored blank turns "my issues" into "the whole
team's issues" — and on a write, "clear my labels" into "clear everyone's".
Drop the flag entirely if you mean no filter.

## Command reference

Run `linear --help` for the full list and `linear <command> --help` for any
command's options. `--json` is available on **every** command.

### Auth

```bash
linear auth login [--key <key>]                 # verify + save a key
linear auth status                              # is a key configured, and from where
linear auth logout                              # remove the saved key
linear whoami                                   # who the key belongs to (id, name, email)
```

`auth status` answers "am I set up"; `whoami` answers "whose account am I about
to write to". Set-up scripts should check the second — running someone else's
routine against your key aims every subsequent write at the wrong person's day,
and it looks like it worked.

### Issues

```bash
linear issues [--assignee me|<email|name|id>] [--state open|active|completed|canceled|<name>] \
              [--team SPR] [--label today] [--project <id>] [--cycle <id>] [--limit 50]
linear issue <identifier>                       # e.g. SPR-123
linear comments <issue-id> [--limit 100]        # one issue's thread, in order
linear create --title "..." --team SPR [--description "..."] [--priority 0-4] \
              [--estimate N] [--assignee me] [--project <id>] [--state "In Progress"] \
              [--due-date YYYY-MM-DD] [--label a,b] [--cycle <id>] [--milestone <id>] \
              [--parent <id|SPR-1>] [--dry-run]
linear update <id[,id...]> [--title "..."] [--description "..."] [--state "In Progress"] \
              [--priority 0-4] [--estimate N] [--assignee me] [--due-date YYYY-MM-DD] \
              [--project <id>] [--cycle <id>] [--milestone <id>] [--dry-run]
linear search <query> [--limit 50]
linear comment <issue-id> <body...> [--dry-run]
linear label   <id[,id...]> <label[,label...]>  [--dry-run]
linear unlabel <id[,id...]> <label[,label...]>  [--dry-run]
linear labels [--team SPR]                      # names → ids
linear states [--team SPR]                      # workflow states → ids
linear teams                                    # keys, names, ids
linear attach-slack <issue-id> <slack-url> [--no-sync] [--dry-run]
```

`--parent` creates a **sub-issue** (accepts a UUID or an identifier like `SPR-1`).

**Names, not UUIDs.** `--state` takes a workflow state name (`"In Progress"`),
resolved against the issue's own team; `--assignee` takes `me`, an email, or a
display name; `--team` takes a key (`SPR`), a name, or an id — interchangeably,
everywhere. An unrecognised value is an error listing the valid ones, never an
empty result set.

**Batches.** `update`, `label` and `unlabel` take comma-separated ids and apply
the change sequentially, so a morning's worth of re-labelling is one invocation
instead of one call per ticket. They always return the `{items, pageInfo}`
envelope, whether you passed one id or ten.

**`--dry-run`** is available on every write. It resolves everything a real run
would resolve — names to ids, `me` to a user, `In Progress` to a workflow state
— and then writes nothing, so a preview fails on exactly the inputs the real run
would fail on:

```text
$ linear update SPR-1,SPR-2 --state "In Progress" --assignee me --dry-run
DRY RUN — nothing was written.
Operation: update
Targets (2): SPR-1, SPR-2
Requested:
  state: In Progress
  assignee: me
Would send to SPR-1:
  stateId: b1e68455-…
  assigneeId: d9e367b5-…
```

### Inbox

```bash
linear inbox [--unread] [--limit 50]            # read + unread; --unread = unread only
linear mark-read <notification-id>
linear mark-all-read
linear archive <notification-id>
linear archive-read                             # archive all read notifications
```

### Users & activity

```bash
linear whoami                                   # who this API key belongs to
linear users
linear user-issues    <me|email|name|id> [--state open] [--limit 100]
linear user-comments  <me|email|name|id> [--since <date|instant>] [--limit 100]
linear user-activity  <me|email|name|id> [--since <date|instant>]
linear issue-history <issue-id>
```

`--since` accepts `YYYY-MM-DD` or a full ISO-8601 instant
(`2026-07-30T14:30:00Z`). Use the instant form when ordering *within* a day
matters — a four-hour response target cannot be judged against two timestamps
that both say "Jul 30". An unparseable value is an error, not a dropped filter.

For one issue's full conversation — every author, in order, with replies
attached to what they answer — use `linear comments <issue-id>` rather than
diffing per-author streams.

### Projects

```bash
linear projects [--team SPR] [--limit 50]
linear project <project-id>                     # detail + milestones
linear project-create --name "..." --team SPR [--lead me] [--description "..."] \
              [--target-date YYYY-MM-DD] [--initiative <id>] [--status <id>]
linear project-edit <project-id> [--name "..."] [--status <id>] [--lead me] \
              [--description "..."] [--target-date YYYY-MM-DD]
linear project-statuses                          # org project statuses (id, name, type)
linear project-update <project-id> <body...> [--health onTrack|atRisk|offTrack]
linear milestone-create --project <id> --name "..." [--target-date YYYY-MM-DD] \
              [--description "..."]
```

### Documents, views, cycles

```bash
linear doc --title "..." (--project <id> | --team SPR | --issue <id>) [--file path] [content...]
linear views
linear view <view-id> [--limit 50]
linear view-create --name "..." [--team SPR] [--description "..."] [--private] \
              [--assignee me] [--state open] [--label today] [--project <id>] [--dry-run]
linear favorites
linear cycles <team> [--type current|previous|next]     # team key, name, or id
```

`view-create` builds a saved view from the same filter vocabulary `linear
issues` uses, so setting up a workspace no longer ends with "now go make this
view in the UI" — the one step a script cannot verify.

`doc` reads content from `--file <path>`, inline positional text, or **stdin**:

```bash
echo "## Notes" | linear doc --title "Spec" --project <id>
linear doc --title "Spec" --project <id> --file ./spec.md
```

## Using with AI agents

This is the headline feature: the CLI is designed so an agent can drive Linear
reliably with almost no bespoke glue.

**Give the agent the right context, in this order:**

1. **Point it at the help.** `linear --help` lists every command; `linear
   <command> --help` documents each one's options. An agent that reads these
   first will use the tool correctly without you enumerating flags.
2. **Use `--json` for anything programmatic.** The text output is for humans; the
   JSON is the stable contract. Lists come back as `{items, pageInfo}`, so read
   `.items[]` and check `.pageInfo.truncated` before trusting a diff.
3. **Check the exit code, and read stdout on failure.** A non-zero exit means
   stdout holds `{"error": …}` rather than data. Exit `6` means wait
   `retryAfterSeconds`; exit `5` is worth one immediate retry; everything else is
   a stop.
4. **Names beat IDs.** `--assignee me`, `--state "In Progress"`, `--team SPR` all
   work, and `linear teams` / `linear states` / `linear labels` list the rest. An
   `AGENTS.md` full of pasted UUIDs goes stale silently; a name does not.
5. **Gate writes on `--dry-run`** rather than on prose. Run the write with
   `--dry-run`, show the resolved change, then run it for real.
6. **Keep a short Linear block in each consuming repo's `AGENTS.md`** with your
   house conventions. Copy-paste template:

   ````markdown
   ## Linear — Project Tracking

   Use the `linear` CLI (https://github.com/ohitslaurence/linear-cli). Requires
   `LINEAR_API_KEY` in the environment.

   ```bash
   linear --help                                 # full command list
   linear whoami --json                          # verify whose key this is
   linear teams / linear states / linear labels  # names and ids, current
   linear issue <ID>                             # detail, incl. sub-issues + PR links
   linear comments <ID> --json                   # one issue's full thread
   linear <command> --json                       # machine-readable output
   ```

   ### Conventions

   - Refer to things by name: `--team SPR`, `--state "In Progress"`,
     `--assignee me`. Don't paste UUIDs into this file; they go stale silently.
   - Read `.items[]`, and treat `.pageInfo.truncated == true` as "this list is
     incomplete" — never diff against a truncated list.
   - New tickets default to **Backlog**, created **unassigned**.
   - Estimates are in points on the 0–7 scale; split anything bigger.
   - **Confirm before mutating.** Run the write with `--dry-run` first, show the
     resolved change, and get a human's go-ahead — unless this file says
     otherwise.
   ````

**Checks these commands make possible.** `linear issue <ID> --json` returns
`children` and `attachments`, so "this is a parent ticket, not work"
(`children | length > 0`) and "marked Done with no PR"
(`[.attachments[] | select(.sourceType == "github")] | length == 0`) are both
computable. `linear comments <ID> --json` gives "blocked and silent" a data
path — the newest `createdAt` on the issue, from any author, threading intact.

4. **Safety convention.** Treat mutating commands (`create`, `update`,
   `comment`, `project-*`, `milestone-create`, `doc`, `mark-*`, `archive*`) as
   actions to **confirm before running**, unless the consuming repo explicitly
   opts into autonomy. Read-only commands are always safe.

## Development

See [AGENTS.md](./AGENTS.md) for the architecture (Effect services, layers,
tagged errors), how to add a command end-to-end, the testing approach, and the
house Effect anti-patterns. In short:

```bash
bun run typecheck   # tsc --noEmit (must be clean; no `as any`)
bun run lint        # oxlint
bun test            # unit tests — never hit the live API
bun run build       # compile dist/linear
```

## License

[MIT](./LICENSE) © 2026 Laurence ([@ohitslaurence](https://github.com/ohitslaurence))
