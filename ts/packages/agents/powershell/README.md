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

## Dynamic execution trust foundation

Dynamic flows are **untrusted candidates**, including samples, imported scripts,
reasoning captures, tests and repairs. Registration is never execution approval.
The shared `@typeagent/agent-flows/powershell` store validates identifiers and
fixed storage destinations before reads or writes. It records host-computed
SHA-256 revisions separately in `revisions/`; recipe-authored hashes or approval
fields are ignored.

Scripts are hashed as exact UTF-8 text. Invalid Unicode is rejected; no newline,
whitespace or Unicode normalization is performed. Revision metadata uses JSON
with sorted object keys and preserved array order, covering script identity,
parameter definitions/defaults, sandbox requests, output format and provenance.
Usage counters, timestamps and grammar aliases do not change execution revisions.
An unexpected script or execution-metadata edit fails integrity verification;
loading, schema registration and repair do not silently rebaseline it.

Every dynamic invocation, including `@powershell run`, grammar/cache hits,
create-and-execute and repair tests, requires **Approve once**. **Cancel** is the
default. The prompt shows the exact script, resolved literal arguments, revision
and invocation fingerprints, timeout and effective broker policy. Dynamic
parameters never interpolate arbitrary TypeAgent parent-environment variables.
Headless/batch operation without approval fails closed. A private in-memory
snapshot supplies the broker; no script file is reopened after approval.
Controlled revision changes invalidate outstanding plans. Approval is not stored
or reused for retries, repairs or future invocations.

Policy/integrity/approval failures and cancellation do not initiate reasoning
fallback. When they occur inside Claude or Copilot reasoning, subsequent actions
and native-tool permission requests for that user request are blocked, including
cached session grants. A fresh user request can deliberately try a new invocation.

This is a **restricted foundation**, not expanded sandbox functionality or an
incident-closure assurance. Dynamic execution and broker opt-in gates remain.
The existing command and AST restrictions, ConstrainedLanguage, network denial,
no external directory/module grants and one-process Job Object are unchanged.
Working directory is the broker's private scratch directory, created at launch;
the host cannot select a different cwd. AppContainer has Windows/runtime baseline
access and is not an exact directory-only allowlist. Git and additional modules
may still be rejected. Reviewed-static actions remain a separate execution path.
Host revision records are outside sandbox grants; tampering with TypeAgent itself
or its host records as the same user/administrator is outside this boundary.

### Existing internal data

Older flows without host revision records are deliberately not trusted. Do not
add hashes manually or edit a revision to bypass a failure. Preserve a backup of
the PowerShell instance storage before making changes. Review original scripts
and explicitly re-import them into a fresh storage instance (or under a new name
if the existing instance can load). To reseed samples, close TypeAgent, archive
the entire `powershell` instance-storage directory, then enable the agent again.
No automatic destructive migration or reusable execution approval is provided.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
