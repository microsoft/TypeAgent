# randomStub

A tiny demo CLI — built with [System.CommandLine](https://learn.microsoft.com/dotnet/standard/commandline/)
— used to exercise **TypeAgent Studio**'s "New Agent" onboarding end to end,
locally and offline.

It exists so a demo can reliably run every onboarding phase against a real tool
without needing network access, credentials, or a third-party service:

- **Discovery** crawls the tool's `--help` output (`crawlCliHelp`) to enumerate
  its actions.
- The generated agent can then **actually invoke** a subcommand and get a real
  result (e.g. "give me a random number between 1 and 10"), so the *Try it* step
  proves the agent runs — not just that help was parsed.

## Commands

```
randomstub --help
randomstub number --min <n> --max <m> [--seed <s>]
randomstub dice   [--sides <n>] [--count <k>] [--seed <s>]
randomstub pick   --from <a,b,c> [--seed <s>]
```

Examples:

```
> randomstub number --min 1 --max 10
7
> randomstub dice --sides 6 --count 2 --seed 42
Rolls: 1, 1
Total: 2
> randomstub pick --from rock,paper,scissors
paper
```

`--seed` makes output reproducible, which is handy for scripted demos.

## Why LF line endings

The onboarding help crawler's subcommand parser only recognises the `Commands:`
block when its lines are separated by `\n`. On Windows, .NET's `Console` defaults
to `\r\n`, which would make the crawler see only the first subcommand. So
`Program.cs` routes every output path — both the command actions' `Console`
writes and System.CommandLine's own help/error rendering (via an
`InvocationConfiguration`) — through writers whose `NewLine` is forced to `\n`.

## Build

Requires the .NET SDK. The first build restores the `System.CommandLine` NuGet
package; after that it builds offline (framework-dependent, `net8.0`):

```
dotnet build dotnet/randomStub/randomStub.csproj -c Release
```

## Deploy for a demo

The onboarding Discovery phase runs the bare command name, so `randomstub` must
be resolvable on the `PATH` of the process running the Studio service.

**One command** (builds, publishes, and copies the binary to a PATH dir):

```
node dotnet/randomStub/deploy.mjs
```

By default it deploys to the npm global bin dir (already on `PATH`). Use
`--to <dir>` to target a specific directory, or `--print-target` to see where it
would land. The script is cross-platform (win/linux/osx) and picks the right RID
automatically.

**Manual** (equivalent to what the script does):

```
dotnet publish dotnet/randomStub/randomStub.csproj -c Release -r win-x64 \
  --self-contained false -p:PublishSingleFile=true -o <a-dir-on-your-PATH>
```

Then, in the New Agent wizard, describe the agent with a phrase that names the
command followed by `--help`, for example:

> A dice-and-random-number helper. Discover its actions by running
> `randomstub --help`.
