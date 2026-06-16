# studio-service

The standalone, per-workspace host of the TypeAgent Studio runtime
(`@typeagent/core/runtime`) and its typed `agent-rpc` service channel.

The Studio runtime's affinity is to the developer's workspace, not to an
agent-server session, so it runs here — launched by the `typeagent-studio`
extension or the `typeagent-studio serve` CLI (`bin: typeagent-studio-service`) —
and the `studio` agent and the extension are clients of it. See
[`docs/plans/vscode-devx/DESIGN.md`](../../docs/plans/vscode-devx/DESIGN.md) §3.5.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
