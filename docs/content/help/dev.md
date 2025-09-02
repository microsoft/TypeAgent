---
layout: docs
title: TypeAgent repo for developers
---

## Tips

Here are some tips when working with the TypeAgent repo listed in no particular order:

- When syncing with the [TypeAgent](/) repo it's always a good idea to run `pnpm i` first. This can help resolve some very common build issues or address updated dependency/references within the project hierarchy.

- If there are issue during `pnpm i` or build, it's a good idea to try resetting the repo to a clean state. Make sure you save all your uncommitted changes (commit them or stash them) and use `git clean` to reset the repo, then try to install and build again.

- There are two process models for agents: **in-proc** and **out-of-proc** with the [dispatcher](../../../ts/packages/dispatcher/). It is recommended to run agents out of process from the dispatcher for system stability possible future isolation. However, this can on occasion make debugging more difficult. Therefore if you are chasing a troublesome issue, try running agents in process the same process as the dispatcher until the issue has been resolved by setting the environment variable `TYPEAGENT_EXECMODE=0`

- To reset your git repo without having to re-clone, you can run `git clean -dfX` and then `pnpm i`

## Issues

- **Test projects aren't appearing in Jest Explorer** - To fix this modify the [settings.json](../../../ts/.vscode/settings.json) file and add the project to the `jest.virtualFolders` section.  
- **Unable to debug tests** - If you try to debug a test using jest and in the output you get a message `No tests found, exiting with code 1` it's possible that the [launch.json](../../../ts/.vscode/launch.json) file is pointing to another project. Modify the working directory of the `vscode-jest-tests.v2` launch spec to point to the project folder you are wanting to debug.

## Errors

Here are some troubleshooting steps and or possible solutions to specific errors you might encounter.

- **`Embedding file corrupt` error message** The conversation memory embeddings file has become corrupted and is not recoverable. Delete it and restart the shell/CLI. You can find this file in the current session folder: `<user home dir>/.typeagent/sessions/<current session>/conversationMemory_embeddings.bin`.

-- **Error running pnpm i**

` postinstall$ cd node_modules/.pnpm/node_modules/better-sqlite3 && shx rm -rf ./build && pnpm exec prebuild-install && shx mkdir build/Release-Node && shx cp build/Release/better_sqlite3.node build/Release-Node/better_sqlite3.node
│ rm: could not remove file (code EPERM): ./build/Release/better_sqlite3.node
│ rm: could not remove directory (code ENOTEMPTY): ./build/Release
│ rm: could not remove directory (code ENOTEMPTY): ./build
└─ Failed in 2.5s at F:\repos\TypeAgent\ts`

For this error the either the shell or CLI have some files locked preventing the better_sqlite3 module from being built. Just close any TypeAgent running applications and try again.
