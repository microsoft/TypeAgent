# Model providers

TypeAgent supports provider-specific adapters, but provider-neutral runtime and
generation features must work when only GitHub Copilot is authenticated.

## Defaults

Provider-neutral features default to GitHub Copilot and GPT-5.6 Sol:

| Area                                                                | Default transport                       | Default model |
| ------------------------------------------------------------------- | --------------------------------------- | ------------- |
| Dispatcher reasoning                                                | Copilot SDK                             | `gpt-5.6-sol` |
| Learned action grammar                                              | Copilot SDK                             | `gpt-5.6-sol` |
| Schema, scenario, and grammar warming tools                         | `@typeagent/aiclient` Copilot transport | `gpt-5.6-sol` |
| TaskFlow and PowerShell recipe generation                           | `@typeagent/aiclient` Copilot transport | `gpt-5.6-sol` |
| Browser WebFlow reasoning                                           | Copilot SDK                             | `gpt-5.6-sol` |
| Utility, PowerShell analysis, email KP, KP, and thoughts processing | `@typeagent/aiclient` Copilot transport | `gpt-5.6-sol` |
| Coding-assistant wrapper                                            | GitHub Copilot CLI                      | CLI default   |

Callers using `@typeagent/aiclient` select the transport explicitly with an
endpoint such as `copilot:gpt-5.6-sol`. Code using the Copilot SDK directly
passes the model name `gpt-5.6-sol` to the SDK session.

The `aiclient` Copilot transport normally uses the runtime's provider endpoint.
If the installed Copilot runtime does not implement that optional endpoint RPC,
`aiclient` falls back to a standard Copilot SDK session for non-streaming text
completion. Short-lived CLIs stop the shared Copilot client before exiting.

## Copilot-only operation

Provider-neutral defaults do not invoke the Claude CLI and do not require
Claude authentication. Configure and authenticate the Copilot CLI before using
these features. Transport, authentication, timeout, cancellation, and empty
response failures are surfaced to the caller.

Browser reasoning exposes only the registered WebFlow browser tools to its
Copilot session. It disables tool search, rejects unrelated permission
requests, honors cancellation and the configured step limit, and closes the
session and client after each run.

## Explicit Claude support

Claude remains available only where it is intentionally selected:

- the dispatcher Claude reasoning adapter;
- the `ClaudeGrammarGenerator` and `--provider claude` grammar-tool options;
- the browser WebFlow `provider: "claude"` option;
- Claude-specific SDK wrappers and security validation harnesses.

These paths may require the Claude CLI or Claude authentication. They are not
used by provider-neutral defaults.

## Compatibility

The utility action name `claudeTask` is retained so existing flows continue to
load, but its provider-neutral implementation now uses the configured
`@typeagent/aiclient` model and defaults to Copilot. New flows should prefer
`llmTransform` for one-shot text or JSON generation.
