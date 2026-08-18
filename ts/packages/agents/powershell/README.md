# @typeagent/powershell-typeagent

Agent to create and execute PowerShell workflows

## Copilot capability fallback

When the PowerShell fast path cannot match a Copilot dev-mode request, the
reasoning agent checks whether PowerShell can safely complete it. It prefers to
reuse an existing flow, adds validated grammar aliases when only the phrasing
is new, and creates a reusable flow only when no equivalent exists.

New flows are transactional: a pending draft executes once, is promoted only
after success, and is removed if execution or schema activation fails. Existing
flow names are never overwritten. A typed capability outcome distinguishes
reuse, creation, fallthrough, and failure without parsing display text.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
