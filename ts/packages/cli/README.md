# TypeAgent CLI

## Overview

TypeAgent CLI is a command line entry point to **TypeAgent sample code** that explores architectures for building _interactive agents_ with _natural language interfaces_ using structured prompting and LLM.

TypeAgent CLI hosts multiple subcommands, including the [connect mode](#connect-mode) (the default), a **personal agent** that takes user request and use an extensible set of agents to perform actions, answer questions, and carry a conversation. All CLI commands route through the agent server via WebSocket RPC. [TypeAgent Shell](../shell/) is the UI version, and both shared the core [dispatcher](../dispatcher/) component. Please read dispatcher's [README.md](../dispatcher/README.md) on example requests and usage.

TypeAgent CLI includes addition commands to help with development.

## Running

After setting up and building at the workspace root (repo `ts` directory), there are several additional ways to start the CLI in this directory.

### Workspace root (repo `ts` directory)

At the repo `ts` directory, run `pnpm run cli` or `pnpm run cli:dev` to run the development version.

### Globally Link the package

- Run `pnpm link --global` in this package directory.
- Try `agent-cli` (`agent-cli-dev` for dev version).

NOTES:

- Make sure `pnpm setup` has been run to create the global bin for pnpm, and the project is built.
- To reverse the process run: `pnpm uninstall --global agent-cli`
- This method only works if you have a single enlistment you want call the CLI on.
- Command line examples below assume the method of invocation is used. Please substitute `agent-cli` with the right command as necessary.

### Running Directly

Run the following command in the CLI directory:

- `./bin/run.js` (Linux)
- `.\bin\run` (Windows)

During development, you can run the development version **without building** (using `ts-node`):

- `./bin/dev.js` (Linux)
- `.\bin\dev` (Windows)

### Other Methods

Other more convenient ways to start the CLI with slightly more overhead:

- Running thru package.json's bin: `npx .` or `npx agent-cli-dev` (development version)
- Running thru package.json's script: `npm run start`

## Using the CLI

The CLI hosts multiple subcommands. The main one is **_connect_** (and is the default when no subcommand is specified).

### Connect Mode

The **_connect_** CLI subcommand is a front end to the TypeAgent Dispatcher that takes user request and commands on the console
and sends them to the [dispatcher](../dispatcher/) via the agent server. The dispatcher processes user requests and asks LLM to translate
it into an action. If the user accepts the translation, LLM is asked to **explain** it, i.e. how it transformed the user request
into the action, and constructions - parsing grammar/rule - is created and cached so that it can perform the user request
translation locally bypassing the LLM. See [dispatcher's README](../dispatcher/README.md) for a list of commands.

For example:

```bash
$ agent-cli
[player]🤖> can you play some bach
Generating translation using GPT for 'can you play some bach'
🤖: can you play some bach => play({"query":"bach"}) [3.003s]
Accept? (y/n)y
Generating explanation for 'can you play some bach => play({"query":"bach"})'
Explanation:
{
  "subPhrases": [
    {
      "text": "can you",
      "category": "politeness",
      "isOptional": true,
      "alternatives": [
        "please",
        "could you",
        "would you mind"
      ]
    },
    {
      "text": "play",
      "actionName": "play",
      "isIdiomOrSlang": false,
      "synonyms": [
        "perform",
        "execute",
        "reproduce"
      ]
    },
    {
      "text": "some",
      "category": "filler",
      "isOptional": true,
      "alternatives": [
        "a bit of",
        "a few",
        "any"
      ]
    },
    {
      "text": "bach",
      "paramName": "query",
      "paramValue": "bach",
      "alternatives": [
        {
          "paramText": "mozart",
          "paramValue": "mozart"
        },
        {
          "paramText": "beethoven",
          "paramValue": "beethoven"
        },
        {
          "paramText": "vivaldi",
          "paramValue": "vivaldi"
        }
      ]
    }
  ]
}
```

## Other command line tools

### `agent-cli run`

`agent-cli run` can be used to run TypeAgent dispatcher commands non-interactively on the command line. The agent server is started automatically if it is not already running, hidden by default (no visible window). Use `--show` to start it in a visible window.

There are 3 commands under `agent-cli run`:

- `agent-cli run request <request>` - same as sending a request in connect mode, except doesn't ask for confirmation
- `agent-cli run translate <request>` - only do translation. Same as `@translate` in connect mode.
- `agent-cli run explain <request> => <action>` - only do explanation. Same as `@explain` in connect mode.

All three commands support the following flags:

| Flag             | Short | Description                                                                         |
| ---------------- | ----- | ----------------------------------------------------------------------------------- |
| `--port <port>`  | `-p`  | Port for the agent server (default: 8999)                                           |
| `--session <id>` | `-s`  | Session ID to use. Defaults to the `'CLI'` session if not specified.                |
| `--show`         |       | Start the server in a visible window if it is not already running (default: hidden) |

### `agent-cli replay`

`agent-cli replay <history.json>` replays a chat history file against an isolated ephemeral session. Useful for regression testing and generating test files. The ephemeral session is deleted on exit.

| Flag                    | Short | Description                                                                         |
| ----------------------- | ----- | ----------------------------------------------------------------------------------- |
| `--port <port>`         | `-p`  | Port for the agent server (default: 8999)                                           |
| `--translate`           |       | Translate only, do not execute actions                                              |
| `--generateTest <file>` |       | Record actions to generate a test file                                              |
| `--show`                |       | Start the server in a visible window if it is not already running (default: hidden) |

### `agent-cli connect`

`agent-cli connect` is the default command. It starts the interactive agent, attaching to a running (or auto-started) agent server.

```bash
agent-cli connect                        # connect to the 'CLI' session (created if absent)
agent-cli connect --resume               # resume the last used session
agent-cli connect --session <id>         # connect to a specific session by ID
agent-cli connect --port <port>          # connect to a server on a non-default port (default: 8999)
agent-cli connect --hidden               # start the server hidden (no visible window)
agent-cli connect --memory               # use an ephemeral session (deleted on exit)
```

- By default, `connect` targets a session named `"CLI"`. If no such session exists on the server it is created automatically.
- Pass `--resume` / `-r` to instead resume the last used session (persisted client-side in `~/.typeagent/cli-state.json`). If that session no longer exists, you will be prompted to join the `"CLI"` session.
- Pass `--session` / `-s <id>` to connect to any specific session by its UUID. Takes priority over `--resume` if both are provided.
- Pass `--memory` to use an ephemeral session that is created fresh and automatically deleted when you exit. Cannot be combined with `--session` or `--resume`.
- The server is started automatically if it is not already running. By default it starts in a visible window; pass `--hidden` to suppress the window.
- On connect (and on every conversation switch), the session name is printed after any replayed history, just below the `─── now ─────` separator.

### `@conversation` Commands (Connect Mode)

While in connect mode, you can manage conversations interactively using `@conversation` commands. These commands use conversation names (not UUIDs) everywhere.

| Command                          | Description                                                          |
| -------------------------------- | -------------------------------------------------------------------- |
| `@conversation new <name>`       | Create a new conversation. Prompts to switch to it after creation.   |
| `@conversation switch <name>`    | Switch to an existing conversation by name (case-insensitive).       |
| `@conversation list [<filter>]`  | List all conversations. The current conversation is marked with `▸`. |
| `@conversation rename <newName>` | Rename the current conversation.                                     |
| `@conversation delete <name>`    | Delete a conversation by name (prompts for confirmation).            |

Example:

```
[player]🤖> @conversation new music-chat
Created conversation 'music-chat'.
Switch to 'music-chat' now? [y/N] y
─── now ──────────────────────────────────────────────────────────────────────
Connected to conversation 'music-chat'.
[player]🤖> @conversation list

Conversations:
  NAME            CREATED           CLIENTS
  ──────────────────────────────────────────────────────
▸ music-chat      2026-01-15 10:01  1  (current)
  CLI             2026-01-14 09:00  0
[player]🤖> @conversation rename playlist-session
Renamed current conversation to 'playlist-session'.
```

When multiple clients are connected and one switches conversations, the remaining clients in the old conversation see a status message:

```
[A client has left this conversation. You remain connected to 'playlist-session'.]
```

When a new client joins a conversation that already has connected clients, the existing clients are notified:

```
[A new client has joined this conversation. You are connected to 'playlist-session'.]
```

### `agent-cli server`

`agent-cli server` provides commands to manage the agent server process.

```bash
agent-cli server status                  # show whether the server is running
agent-cli server stop                    # send a graceful shutdown to the server
agent-cli server status --port <port>    # check a non-default port
agent-cli server stop --port <port>      # stop a server on a non-default port
```

### `agent-cli sessions`

`agent-cli sessions` provides full CRUD management of agent server sessions.

#### `agent-cli sessions create [name]`

Create a new named session on the server and print its session ID. If `name` is omitted, defaults to `"CLI"`.

```bash
agent-cli sessions create                          # Created session 'CLI' (a1b2c3d4-e5f6-...)
agent-cli sessions create "workout playlist setup" # Created session 'workout playlist setup' (a1b2c3d4-e5f6-...)
```

#### `agent-cli sessions list`

List all sessions on the server in a formatted table.

```bash
agent-cli sessions list
agent-cli sessions list --name <substring>   # filter by name (case-insensitive)
```

Output columns: `SESSION ID`, `NAME`, `CLIENTS` (currently connected), `CREATED AT`.

#### `agent-cli sessions rename <id> <newName>`

Rename an existing session.

```bash
agent-cli sessions rename a1b2c3d4-e5f6-... "evening playlist"
```

#### `agent-cli sessions delete <id>`

Delete a session and all its persisted data (chat history, conversation memory). Prompts for confirmation unless `--yes` / `-y` is passed.

```bash
agent-cli sessions delete a1b2c3d4-e5f6-...         # prompts: Delete session ...? (y/N)
agent-cli sessions delete a1b2c3d4-e5f6-... --yes   # skip confirmation
```

### `agent-cli data`: Test data management

This command is used for explanation data management:

- `agent-cli data add` - add a request (or request per line text files of requests) to test data file.
- `agent-cli data regenerate` - rerun all or part of the data when translation/explanation schemas are updated.
- `agent-cli data stat` - printing stats on test data.

#### Adding test data

Examples:

1. Adding a single request to a new test data file. Note that a schema needs to be specified

   ```bash
   $ agent-cli data add -o blah.json "play some bach" --schema player
   Processing 1 inputs... Concurrency 40
   [player|v5] blah.json: Processing 1/1 (1 added)
   [1/1][ 19.062s] Generated: play some bach
   [player|v5] blah.json: Finished 1 entries generated with 1 attempts (1.000).
   [player|v5] blah.json: Final stats 1/1, 0 corrections (1.000).
   Result: 1/1 entries, 1 attempts (1.000).
   Execution Time: 19.062s
   Total Elapsed Time: 19.070s
   ```

2. Adding a single request to an existing test data file. Note that translator flags is not necessary and will be inferred from the existing test file

   ```bash
   $ agent-cli data add -o blah.json "play some Beethoven"
   1 existing entries loaded
   Processing 1 inputs... Concurrency 40
   [player|v5] blah.json: Processing 1/2 (1 added)
   [1/1][ 22.090s] Generated: play some Beethoven
   [player|v5] blah.json: Finished 1 entries generated with 1 attempts (1.000).
   [player|v5] blah.json: Final stats 2/2, 0 corrections (1.000).
   Result: 2/2 entries, 2 attempts (1.000).
   Execution Time: 22.090s
   Total Elapsed Time: 22.099s
   ```

3. Adding multiple requests to an existing test data file using an input text file containing a request per line.

   ```bash
   $ agent-cli data add -i blah.txt -o blah.json
   2 existing entries loaded
   Processing 2 inputs... Concurrency 40
   [player|v5] blah.json: Processing 2/4 (2 added)
   [1/2][ 23.178s] Generated: play some Mozart
   [2/2][ 23.289s] Generated: play some Chopin (+1 corrections)
   [player|v5] blah.json: Finished 2 entries generated with 3 attempts (1.500).
   [player|v5] blah.json: Final stats 4/4, 1 corrections (1.250).
   Result: 4/4 entries, 5 attempts (1.250).
   Execution Time: 46.467s
   Total Elapsed Time: 23.304s
   ```

### Switching Translator and Explainer

The translator and explainer models can be changed at runtime using the `@config` command in connect mode:

- `@config translation model <name>`
- `@config explainer model <name>`

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
