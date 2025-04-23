# TypeAgent Best Practices

Here are some best practices listed in no particular order:

- When syncing with the [TypeAgent](/) repo it's always a good idea to run `pnpm i` first. This can help resolve some very common build issues or address updated depenency/references within the project heirarchy.

- There are two process models for agents: **in-proc** and **out-of-proc** with the [dispatcher](../../ts/packages/dispatcher/). It is recommended to run agents out of process from the dispatcher for system stability.  However, this can on occassion make debugging more difficult. Therefore if you are chasing a troublesome issue, try running the affected agent(s) in process with the dispatcher until the issue has been resolved. 