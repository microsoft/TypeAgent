# TypeAgent Dispatcher

TypeAgent Dispatcher is **sample code** and the core component that explores how to build a **personal agent** implementation with TypeChat:

- [TypeAgent Shell](../shell) and [TypeAgent CLI](../cli) are two front ends that make use of this shared component.
- Extensible [application agents](../agentSdk/README.md) architecture.
- [Agent Cache](../cache/README.md) to lower latency and cost.

Dispatcher processes user requests and asks LLM to translate it into an action based on a schema provided by the application agents. It has ability to automatically switch between different agents to provide a seamless experience in a extensible and scalable way.

See [architecture](../../../docs/architecture/dispatcher.md) doc for more details on the design of the dispatcher component.

## Usage

User can request actions provided by [application agents](../agentSdk/README.md) using natural language.

For example, in the [CLI](../cli):

```bash
[calendar]🤖> can you setup a meeting between 2-3PM
Generating translation using GPT for 'can you setup a meeting between 2-3PM'
🤖: can you setup a meeting between 2-3PM => addEvent({"event":{"day":"today","timeRange":["14:00","15:00"],"description":"meeting"}}) [9.531s]
Accept? (y/n)
```

More sample action requests:

- `play some music by Bach for me please`.
- `create a grocery list`
- `add milk to the grocery list`

Additional system "commands" are available to provide direct interaction with the system, See the [Commands](#commands) section below.

## Commands

Beyond natural language, users can specify system command with inputs starting with `@`.

### Toggling Dispatcher Agents

Dispatcher agent can be enabled and disabled.

Toggle a specific `<agent>`:

- `@config agent <agent>` _(Enable `<agent>`)_
- `@config agent --off <agent>` or `@config agent -x <agent>` _(Disable `<agent>`)_

Toggle using `*` pattern:

- `@config agent *` (Enable all agents)
- `@config agent *l*` | (Enable agents that has "l" in the name)

Reset to default:

- `@config agent --reset` or `@config agent -r`

Dispatcher agent's schema, action and command can be toggled independently as well, using `@config schema`, `@config action`, `@config command`.

To list all avaiable agents and their status, just the command without any parameters:

```bash
🤖🚧💾  [🎧📅📩📝🌐💬🤖🔧📷🖐🖼️📱🗎]> @config agent
|Agent               |Schemas|Actions|Commands|
|--------------------|-------|-------|--------|
|androidMobile       |✅     |✅     |        |
|browser             |✅     |✅     |✅      |
|  browser.commerce  |💤     |💤     |        |
|  browser.crossword |💤     |💤     |        |
|  browser.paleoBioDb|💤     |💤     |        |
|calendar            |✅     |✅     |✅      |
|chat                |✅     |✅     |        |
|code                |❌     |❌     |❔      |
|  code.code-debug   |❌     |❌     |        |
|  code.code-display |❌     |❌     |        |
|  code.code-general |❌     |❌     |        |
|desktop             |❌     |❌     |❔      |
|dispatcher          |✅     |✅     |✅      |
|  dispatcher.clarify|✅     |✅     |        |
|email               |✅     |✅     |✅      |
|greeting            |✅     |✅     |✅      |
|image               |✅     |✅     |        |
|list                |✅     |✅     |        |
|markdown            |✅     |✅     |        |
|photo               |✅     |✅     |        |
|player              |✅     |✅     |✅      |
|system              |       |       |✅      |
|  system.config     |✅     |✅     |        |
|  system.session    |✅     |✅     |        |
```

### Explainer

Explainer is the step where the dispatcher leverages the cache to ask the GPT to explain the generated translations once the user accepted it. The result is used to create constructions if it is enabled (see below). (Explanation is not generated for translations using constructions if it is enabled).

As part of the exploration, the cache has multiple explainer implementations, which can be changed in the CLI's interactive mode using the command `@config explainer name <explainer>`.

For example, in the [CLI](../cli):

```bash
[📅💊📩📝👀🪟⚛️💬🔧]> @config explainer name v4

[📅💊📩📝👀🪟⚛️💬🔧 (explainer: v4)]>
```

To list all configured explainers:

```bash
🤖🚧💾  [📅💊📩📝👀🪟⚛️💬🔧]>@config explainer
Usage: @config explainer name <explainer>
   <explainer>: v4, v5
```

### Shortcut commands

There are other short cut commands to exercise specify part of the TypeAgent Dispatcher system:

- `@translate <request>` - Only do the translation (no follow up explanation )
- `@explain <request> => <action>` - only do the explanation of the request/action combo

### Sessions

TypeAgent dispatcher settings, such as translator, explainer, etc., are stored in sessions, and sessions can be persisted across activation on a per user basis and restored when the app restarts. Use `@session <args>` command to do run operations. Additionally data such as construction store are saved in the sessions as well by default unless an explicit path are provided. The last cache file used is preserved thru reload.

For dispatcher configured to persist sessions (i.e. [CLI](../cli) and [shell](../shell)) the session settings and data are stored in `<home>/.typeagent/profiles/<profile>/sessions/<name>`. (`<home>` is the user profile directory. `~` in Linux, `%USERPROFILE%` in Windows. `<profile>` set for the enlistment, the mapping from enlistment to `<profile>` can be found in `<home>/.typeagent/global.json`).

| Command                         | Description                                                                                                                                                                                   |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@session new`                  | Create a new session with the default settings. Session names are generate implicitly using YYYYMMDD format based on current date. If one already exist, `_<index>` is append to disambiguate |
| `@session open [<name>]`        | Load a sessions with `<name>`. Use `@session list` for a list of session name that can be opened                                                                                              |
| `@session info`                 | Current session name, saved settings and a list of construction stores                                                                                                                        |
| `@session reset`                | Reset all settings to the default, but keep all data.                                                                                                                                         |
| `@session clear`                | Clear all data but keep the settings.                                                                                                                                                         |
| `@session list`                 | List all sessions                                                                                                                                                                             |
| `@session delete [<name>] [-a]` | Delete a session. If no session is specified, delete the current sessions.`-a` to delete all sessions. If the current session is deleted, a new session will be created.                      |

### Constructions

Constructions are local parsing and transform rules built based on the explanations given by LLM.
Use the `@const <args>` command at the prompt to control the construction store.

| Command                   | Description                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@const new [<file>]`     | Initialize the construction store and start saving constructions built using explanations from user prompts. Existing constructions will be removed.<br> If file is not provide, but session is persisted and auto save is on, then it will use a file name generated in the session directory.<br>Otherwise, the cache will be in memory only. Use `@const save` to assign a file name to save to |
| `@const load [<file>]`    | Load a construction store from a file. If the file is not provided, load from the default location for the translation specified in the config. Existing construction will be removed.                                                                                                                                                                                                             |
| `@const import [<file>]`  | Import the construction from the translation and explanation stored in a test data file and add it to the existing construction store.                                                                                                                                                                                                                                                             |
| `@const save [<file>]`    | Save the construction store to a file. If the file is not provided, it will save to location it last saved to or loaded from, or error if it was never backed by a file.                                                                                                                                                                                                                           |
| `@const auto [on\|off]`   | Toggle auto saving mode. When auto saving mode is on, the construction store will be written on every new construction added to the store. If the session is persisted and auto save mode is turned on, but the construction store is not backed by a file, then a new file name will be generated and save in the session.                                                                        |
| `@const off`              | Turn off construction store. The existing constructions will be lost                                                                                                                                                                                                                                                                                                                               |
| `@const info`             | Show state of the construction store                                                                                                                                                                                                                                                                                                                                                               |
| `@const list [<options>]` | List the constructions.<br>Options:<br><table><tr><td>-v, --verbose</td><td>Show verbose match set names</td></tr><tr><td>-a, --all</td><td>Show all items in the match set</td></tr><tr><td>-b, --builtin</td><td>Show built in construction store</td></tr></table>                                                                                                                              |
| `@const merge on\|off`    | Toggle whether the match sets are merged or not                                                                                                                                                                                                                                                                                                                                                    |
| `@const wildcard on\|off` | Toggle whether to use wildcards in matches                                                                                                                                                                                                                                                                                                                                                         |
| `@const delete <id>`      | Delete a construction by ID as shown in `@const list`                                                                                                                                                                                                                                                                                                                                              |

### Debugging

#### Traces

`@trace <trace pattern>` - add a trace pattern for debugging. See [Tracing](../../README.md#tracing) in the ts root README.md.

#### In-proc agent mode.

By default agents runs out of proc in their own process. This is to ensure that agent is built to be able to run independently or in the cloud. For debugging, agents can be forced to run in the same process as the dispatcher by setting the environment variable `TYPEAGENT_EXECMODE=0`

### Other configs

| Command                       | Description                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------ |
| `@config bot on\|off`         | Toggle the LLM translation (Turn off to rely on constructions only if enabled) |
| `@config explanation on\|off` | Toggle LLM explanation (Turn off to stop updating construction store)          |
| `@config log db on\|off`      | Toggle sending logging information to a remote database                        |

## Adding Dispatcher Agent

Additional Dispatcher Agent can be create and added to the dispatcher to extend the capabilities of TypeAgent as a **personal agent**. [Agent SDK](../agentSdk) defines the interfaces and helper needed to develop an agent. The `Echo` agent [tutorial](../../../docs/tutorial/agent.md) illustrate the steps to create a basic agent in a NPM module and install into TypeAgent's [shell](../shell) and [CLI](../cli).

By default dispatcher only comes with `system` and `dispatcher` agents, providing minimal base functionality. Additional agents are provided using [AppAgentProvider](./src/agentProvider/agentProvider.ts) when the dispatcher is created by the host. The host of the dispatcher (like [shell](../shell) and [CLI](../cli)) is configured with the default provider with subset of agents implemented in this repo, and a extensible provider that allow additional agent to be dynamically install/registered. (See [default-agent-provider](../defaultAgentProvider/) package).

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
