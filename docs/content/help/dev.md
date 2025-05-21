---
layout: docs
title: TypeAgent repo for developers
---

## Tips

Here are some tips when working with the TypeAgent repo listed in no particular order:

- When syncing with the [TypeAgent](/) repo it's always a good idea to run `pnpm i` first. This can help resolve some very common build issues or address updated dependency/references within the project hierarchy.
- If there are issue during `pnpm i` or build, it's a good idea to try resetting the repo to a clean state. Make sure you save all your uncommitted changes (commit them or stash them) and use `git clean` to reset the repo, then try to install and build again.
- There are two process models for agents: **in-proc** and **out-of-proc** with the [dispatcher](../../../ts/packages/dispatcher/). It is recommended to run agents out of process from the dispatcher for system stability possible future isolation. However, this can on occasion make debugging more difficult. Therefore if you are chasing a troublesome issue, try running agents in process the same process as the dispatcher until the issue has been resolved by setting the environment variable `TYPEAGENT_EXECMODE=0`
