# Read-only structured actions

This first pass covers eight exact actions across five built-in agents.
Their schema manifests declare `effects: "read-only"` without an explicit
confirmation requirement, so structured discovery reports
`confirmation: "not-required"` and execution skips only the dispatcher's
outer effect-confirmation prompt. Natural-language routing is unchanged.

| Agent      | Action (exact schemaName.actionName) | Why no confirmation                                                                                         |
| ---------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| List       | `list.listLists`                     | It reads the names of existing lists without changing their contents.                                       |
| List       | `list.getList`                       | It reads one named list without adding, removing, or saving items.                                          |
| Weather    | `weather.getCurrentConditions`       | It queries fixed Open-Meteo endpoints for a supplied place without changing settings.                       |
| Weather    | `weather.getForecast`                | It reads a one-to-seven-day forecast from fixed Open-Meteo endpoints.                                       |
| Player     | `player.listDevices`                 | It reads Spotify device and playback metadata without selecting a device or controlling playback.           |
| Player     | `player.showSelectedDevice`          | It reports the selected or default Spotify device without changing that selection.                          |
| GitHub CLI | `github-cli.prFiles`                 | It reads bounded pull-request file details using fixed GitHub CLI commands without changing the repository. |
| Timer      | `timer.listReminders`                | It reads pending reminders without scheduling, cancelling, or firing them.                                  |

## Boundaries

Validation, enabled-agent checks, readiness, authorization, live policy
rechecks, and handler-originated questions still apply. An explicit
`confirmation: "required"` overrides a read-only declaration. Every omitted
action remains unclassified and requires outer confirmation, including list
edits, timer changes, player controls, GitHub mutations, and generic commands.
This is not a new permission system or an exemption for every action whose
name sounds like a read.

Read-only describes the action's domain effects, not a guarantee of zero
infrastructure activity: normal authorized agent startup, token refresh,
read caches, result/history bookkeeping, and existing timer background tasks
are unchanged. List storage is initialized when the agent is enabled, not by
these read actions. Tests use an isolated instance and preseed disposable data.
External reads return data to the requesting client under existing service
authorization; these policies do not authorize arbitrary uploads or execution.
Weather sends the supplied place to Open-Meteo. `prFiles` uses the existing
GitHub CLI account/host selection and fixed PR metadata/files GET operations;
optional patch excerpts remain bounded. A bare repository name can still
require the handler's repository-choice prompt.

Narrow exclusions from this pass:

- Utility: unrestricted file paths, browser navigation, and model/tool execution
  need a separate boundary audit rather than blanket read exemptions.
- Calendar: the Microsoft date-range adapter currently passes an object to a
  client that interpolates it into a query string and retains the failing
  pagination link on error; defer calendar scenarios until that path is fixed.
- GitHub CLI: `prFailedChecks` derives annotation hosts from check links;
  `authStatus` can expose tokens, and generic API/CLI actions are not covered.
- Weather: `getAlerts` currently returns placeholder data, so it is not a useful
  real-service scenario. Player searches/playlists and all playback/UI changes
  are outside this device-inventory-only pass.

## Safe manual scenarios

Use an isolated instance with existing lists and already-configured services.
Do not approve setup, mutation, or handler questions unattended.

| Scenario                         | Structured action and parameters                                                    |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| Inventory existing lists         | `list.listLists {}`                                                                 |
| Read two disposable lists        | `list.getList {"listName":"groceries"}`, then `{"listName":"packing"}`              |
| Read weather in two places       | `weather.getCurrentConditions {"location":"Seattle"}`, then `{"location":"Boston"}` |
| Read a short forecast            | `weather.getForecast {"location":"Seattle","days":3}`                               |
| Inspect Spotify devices          | `player.listDevices`, then `player.showSelectedDevice` (omit parameters)            |
| Inspect PR files without patches | `github-cli.prFiles {"repo":"microsoft/TypeAgent","number":2991,"maxFiles":5}`      |
| Inventory existing reminders     | `timer.listReminders {}`                                                            |

For timing, compare discovery plus the first completed structured action,
a repeat using its known identity/contract, and similar natural-language
wording with different parameters. Record completed outcomes and separate
connection, model, discovery, and execution time. Removing a confirmation
blocker does not establish an end-to-end speedup.

`ts/packages/defaultAgentProvider/test/readOnlyActionPolicies.spec.ts` checks
this rationale table against the selected production manifests and exercises
their contracts through the real structured dispatcher.
