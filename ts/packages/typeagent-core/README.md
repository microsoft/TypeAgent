# @typeagent/core

Shared engine library for TypeAgent Studio extensions. **Skeleton only** at this point — no runtime behavior.

Subsystems (each gets its own subfolder) land in the phases called out in [docs/plans/vscode-devx/05-implementation-plan.md](../../docs/plans/vscode-devx/05-implementation-plan.md):

| Module              | Feature                      | Phase |
| ------------------- | ---------------------------- | ----- |
| `events/`           | F0.3 structured event stream | P-1   |
| `sandbox/`          | F0.1 sandbox lifecycle       | P-1   |
| `corpus/`           | F0.2 federated corpus        | P-1   |
| `feedback/`         | F0.4 feedback wrappers       | P-1   |
| `health/`           | F0.5 health rule engine      | P-1   |
| `collisions/`       | F0.6 collision events        | P-1   |
| `replay/`           | F4.1 `replayCorpus()`        | P-3   |
| `onboardingBridge/` | F1.1 snapshot/restore        | P-2   |

Consumed by `typeagent-studio`, `agr-language`, and `vscode-shell`. Has no `vscode` dependency.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
