---
name: typeagent-memory
description: Save and recall workspace facts with TypeAgent conversation memory. Use when the user asks to remember something, or asks about a prior decision, convention, or session in this workspace.
user-invocable: true
---

# TypeAgent memory

This workspace has a persistent conversation memory. Turns are captured automatically. Use the tools when the user wants an explicit save or a direct lookup.

## remember

Call `remember` when the user asks to remember a fact, or when you learn a durable workspace rule that later sessions must follow.

```json
{
  "memory": "This repo uses pnpm. Never run npm install here.",
  "source": "chat"
}
```

## recall

Call `recall` when the user asks what was decided, how something is done here, or what happened in an earlier session.

```json
{ "query": "what package manager does this repo use?" }
```

Answer from the tool result. If `type` is `NoAnswer`, say you do not have that in memory.

Do not invent memories. Do not use these tools for the current turn's ordinary work when the injected memory context already answers the question.
