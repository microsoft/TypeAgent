# TypeAgent Dispatcher Node Provider

Node implementation of various dispatcher providers.

## Process-backed agents

Separate-process agents start through an IPC control-channel handshake. Process
creation resolves only after the child reports its supported agent interface.
If the child exits first, startup rejects with the exit code and signal instead
of leaving the provider waiting indefinitely.

The process transport explicitly enables trusted RPC trace propagation. The
parent agent server and child agent process retain separate OpenTelemetry
providers and export their own spans.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
