# linear-cli

A fast, single-binary CLI for [Linear](https://linear.app) — built to be driven
equally well by a human and by local AI agents.

Every command speaks two languages: human-friendly text/CSV by default, and
stable, documented **`--json`** for scripts and agents. It's a typed
[Effect](https://effect.website) app under the hood, compiled to one `linear`
binary with [Bun](https://bun.sh).

```bash
linear issues --assignee me --state active     # what's on my plate
linear issue SPR-123                            # full detail for one issue
linear issues --project <id> --json | jq '.[].identifier'
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
id,title,state,priority,team
SPR-9308,Card error on signup,Done,medium,Spritz Product
GROW-1631,End-of-week insights,Prioritized,high,Growth
```

Add `--json` to any command for stable, machine-readable output. Field names are
consistent across commands and `Date` fields are ISO-8601 strings:

```text
$ linear issues --limit 1 --json
[
  {
    "id": "a28e99cb-…",
    "identifier": "GROW-1631",
    "title": "End-of-week insights",
    "state": "Prioritized",
    "priority": 2,
    "createdAt": "2026-05-23T04:25:51.001Z",
    "updatedAt": "2026-05-23T04:25:51.001Z",
    "team": "Growth",
    "url": "https://linear.app/…/GROW-1631"
  }
]
```

```text
$ linear project-statuses --json
[
  { "id": "…", "name": "Backlog", "type": "backlog", "position": 0 },
  { "id": "…", "name": "In Progress", "type": "started", "position": 1 }
]
```

## Command reference

Run `linear --help` for the full list and `linear <command> --help` for any
command's options. `--json` is available on **every** command.

### Auth

```bash
linear auth login [--key <key>]                 # verify + save a key
linear auth status                              # who am I? exits non-zero if unauthenticated
linear auth logout                              # remove the saved key
```

### Issues

```bash
linear issues [--assignee me|<id>] [--state active|completed|canceled|<name>] \
              [--team SPR] [--project <id>] [--cycle <id>] [--limit 50]
linear issue <identifier>                       # e.g. SPR-123
linear create --title "..." --team <id> [--description "..."] [--priority 0-4] \
              [--estimate N] [--assignee <id>] [--project <id>] [--state <id>] \
              [--cycle <id>] [--milestone <id>] [--parent <id|SPR-1>]
linear update <id> [--title "..."] [--description "..."] [--state <id>] \
              [--priority 0-4] [--estimate N] [--assignee <id>] [--project <id>] \
              [--cycle <id>] [--milestone <id>]
linear search <query> [--limit 50]
linear comment <issue-id> <body...>
```

`--parent` creates a **sub-issue** (accepts a UUID or an identifier like `SPR-1`).

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
linear users
linear user-issues <user-id> [--state active] [--limit 100]
linear user-comments <user-id> [--since YYYY-MM-DD] [--limit 100]
linear user-activity <user-id> [--since YYYY-MM-DD]
linear issue-history <issue-id>
```

### Projects

```bash
linear projects [--team SPR] [--limit 50]
linear project <project-id>                     # detail + milestones
linear project-create --name "..." --team <id> [--lead <id>] [--description "..."] \
              [--target-date YYYY-MM-DD] [--initiative <id>] [--status <id>]
linear project-edit <project-id> [--name "..."] [--status <id>] [--lead <id>] \
              [--description "..."] [--target-date YYYY-MM-DD]
linear project-statuses                          # org project statuses (id, name, type)
linear project-update <project-id> <body...> [--health onTrack|atRisk|offTrack]
linear milestone-create --project <id> --name "..." [--target-date YYYY-MM-DD] \
              [--description "..."]
```

### Documents, views, cycles

```bash
linear doc --title "..." (--project <id> | --team <id> | --issue <id>) [--file path] [content...]
linear views
linear view <view-id> [--limit 50]
linear favorites
linear cycles <team-id> [--type current|previous|next]
```

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
   JSON is the stable contract. Field names are consistent across commands, so an
   agent can `linear issues --json | jq ...` and rely on the shape.
3. **Keep a short Linear block in each consuming repo's `AGENTS.md`** with the
   workspace IDs the agent needs and your house conventions. Agents don't know
   your team/project/state IDs — write them down once. Copy-paste template:

   ````markdown
   ## Linear — Project Tracking

   Use the `linear` CLI (https://github.com/ohitslaurence/linear-cli). Requires
   `LINEAR_API_KEY` in the environment.

   ```bash
   linear --help                                 # full command list
   linear issue <ID>                             # issue detail
   linear issues --project <PROJECT_ID>          # this project's issues
   linear <command> --json                       # machine-readable output
   ```

   ### Key IDs

   | Thing            | ID            |
   | ---------------- | ------------- |
   | Team — <name>    | `<team-id>`   |
   | Project — <name> | `<project-id>`|
   | Initiative       | `<init-id>`   |
   | Owner — <name>   | `<user-id>`   |

   Workflow states: Backlog `<id>` · In Progress `<id>` · In Review `<id>` ·
   Done `<id>`. (Get state IDs from `linear issue <ID> --json` / your settings.)

   ### Conventions

   - New tickets default to **Backlog**, created **unassigned**.
   - Estimates are in points on the 0–7 scale; split anything bigger.
   - **Confirm before mutating.** Don't create/close/reassign tickets or post
     project updates without the human's go-ahead, unless this file says
     otherwise.
   ````

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
