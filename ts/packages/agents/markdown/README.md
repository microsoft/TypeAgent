# Markdown Agent

Markdown Agent is **sample code** that explores editing scenarios for markdown documents.

## Model configuration

Document updates and editor streaming commands use the shared AI client model
resolver without specifying a model name. The default model is selected by
TypeAgent's runtime configuration; a bare `AZURE_OPENAI_ENDPOINT` is not required.
The shared resolver honors the active model provider and configured endpoint pools.
Creating or opening a document does not require model initialization.

Model failures are reported as errors rather than successful edits. The editor
does not substitute placeholder content when generation fails.

## Update targets

When a request names a file, update actions carry its `documentPath` explicitly
instead of relying on the current editor document. Relative paths resolve within
the working directory (or session storage when no working directory is available).
Absolute paths must name an existing file within the working directory. Missing
files and paths outside that directory are rejected, not redirected to another
document.

Requests without a target edit the currently open document. After agent-server
restarts, that defaults to the session's `live.md`; name the intended file or open
it again before issuing an untargeted edit. Update messages include the destination
and distinguish applied edits from model responses that make no changes.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
