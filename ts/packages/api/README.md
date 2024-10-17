# TypeAgent HTTP API

## Overview

TypeAgent API is a HTTP+WS API server for **TypeAgent sample code**. It explores architectures for building distributed _interactive agents_ with _natural language interfaces_ using [TypeChat](https://github.com/microsoft/typechat). This interface shows devlopers one way of broadening the reach of Agents to web-enabled devices such as internet browsers, mobile phones, and IOT connected devices.

## Running

After setting up and building at the workspace root, there are several additional ways to start the server in this directory.

### Globally Link the package

- Run `pnpm link --global` in this package directory.
- Try `agent-http` (`agent-http-dev`).
- Use VS code to debug the project.

NOTES:

- Make sure `pnpm setup` has been run to create the global bin for pnpm, and the project is built.
- To reverse the process run: `pnpm uninstall --global agent-http`
- This method only works if you have a single enlistment you want call the CLI on.
- Command line examples below assume the method of invocation is used. Please substitute `agent-http` with the right command as necessary.

### Running Directly

Run the following command in the HTTP directory:

- `./bin/run.js` (Linux)
- `.\bin\run` (Windows)

During development, you can run the development version **without building** (using `ts-node`):

- `./bin/dev.js` (Linux)
- `.\bin\dev` (Windows)

### Other Methods

Other more convenient ways to start the server with slightly more overhead:

- Running thru package.json's bin: `npx .` or `npx agent-http-dev` (development version)
- Running thru package.json's script: `npm run start`
