# TypeAgent CLI

## Overview

TypeAgent CLI is a command line entry point to **TypeAgent sample code** that explores architectures for building _interactive agents_ with _natural language interfaces_ using [TypeChat](https://github.com/microsoft/typechat).

TypeAgent CLI host multiple subcommands, including the [interactive mode](#interactive-mode), a **personal agent** that takes user request and use an extensible set of agents to perform actions, answer questions, and carry a conversation. [TypeAgent Shell](../shell/) is the UI version of the interactive mode, and both shared the core [Dispatcher](../dispatcher/) component. Please read Dispatcher's [README.md](../dispatcher/README.md) on example requests and usage.

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

The CLI hosts multiple subcommands. The main one is **_interactive_**

### Interactive Mode

The **_interactive_** CLI subcommand is a front end to the TypeAgent Dispatcher that takes user request and commands on the console
and send to to the [TypeAgent Dispatcher](../dispatcher/). The dispatcher processes user requests and asks LLM to translate
it into an action. If the user accepts the translation, LLM is asked to **explain** it, i.e. how it transformed the user request
into the action, and constructions - parsing grammar/rule - is created and cached so that it can perform the user request
translation locally bypassing the LLM. See [TypeAgent Dispatcher's README](../dispatcher/README.md) for a list of commands.

For example:

```bash
$ agent-cli interactive
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

`agent-cli run` can be use to run TypeAgent dispatcher without user interactive on the command line.

There are 3 command under `agent-cli run`:

- `agent-cli run request <request>` - same with sending a request in the interactive mode, except doesn't ask for confirmation
- `agent-cli run translate <request>` - only do translation. Same as `@translate` in interactive mode.
- `agent-cli run explain <request> => <action>` - only do explanation. Same as `@explain` in interactive mode.

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

2. Adding a single request to an existing test data file. Note that translator flags is not necessary and willb infered from the existing test file

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

### Switching Translator and Explainer on command Line

Most command on the CLI accept the `--schema` option to select the schema and `--explainer` option to select
the explainer.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
