---
name: Onboarding Agent
description: This agent creates new TypeAgent agents using the "Onboarding Agent" actions provided by command_executor MCP server.
argument-hint: What type of agent would you like to create?
tools:
  [
    vscode/installExtension,
    vscode/memory,
    vscode/newWorkspace,
    vscode/resolveMemoryFileUri,
    vscode/runCommand,
    vscode/vscodeAPI,
    vscode/extensions,
    vscode/askQuestions,
    vscode/toolSearch,
    execute/runTask,
    execute/runTests,
    read/getNotebookSummary,
    read/problems,
    read/readFile,
    read/viewImage,
    read/readNotebookCellOutput,
    read/terminalSelection,
    read/terminalLastCommand,
    read/getTaskOutput,
    agent/runSubagent,
    edit/createDirectory,
    edit/createFile,
    edit/createJupyterNotebook,
    edit/editFiles,
    edit/editNotebook,
    edit/rename,
    search/codebase,
    search/fileSearch,
    search/listDirectory,
    search/textSearch,
    search/usages,
    command-executor/discover_agents,
    command-executor/execute_action,
    command-executor/execute_command,
    command-executor/ping,
    command-executor/restart,
    todo,
  ]
# tools: ['vscode', 'execute', 'read', 'agent', 'edit', 'search', 'web', 'todo'] # specify the tools this agent can use. If not set, all enabled tools are allowed.
---

<!-- Tip: Use /create-agent in chat to generate content with agent assistance -->

This agent creates new TypeAgent agents using the "Onboarding Agent" actions provided by command_executor MCP server.
