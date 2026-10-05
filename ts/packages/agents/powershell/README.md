# @typeagent/powershell-typeagent

Agent to create and execute PowerShell workflows

## Copilot capability fallback

When the PowerShell fast path cannot match a Copilot dev-mode request, the
reasoning agent checks whether PowerShell can safely complete it. It prefers to
reuse an existing flow, adds validated grammar aliases when only the phrasing
is new, and creates a reusable flow only when no equivalent exists.

Registration is transactional: a pending draft executes once, is promoted only
after success, and is removed if execution or schema activation fails. This does
not roll back execution side effects. Existing flow names are never overwritten.
A typed capability outcome distinguishes
reuse, creation, fallthrough, and failure without parsing display text.

## Dynamic execution security

Generated, imported, edited, and seeded flows require both
`powershell.dynamicExecution.enabled` and
`powershell.brokerExecution.enabled` in trusted YAML configuration. Both default
to false. When enabled, flows always use authorization-required local execution.
There is no additional mode-selection flag, and enabling execution does not
automatically approve any script.

### Approved-local execution

To run saved samples and ordinary local scripts, enable the existing operational
gates in `config.local.yaml` (merge into the existing `powershell` section):

```yaml
powershell:
  dynamicExecution:
    enabled: true
  brokerExecution:
    enabled: true
```

PowerShell flows execute local code with the current user's privileges, subject
to operating-system policy. TypeAgent requires authorization before executing a
new or changed script and verifies that reusable scripts still match the approved
version. It does not claim to sandbox arbitrary approved PowerShell.

Before execution, a compact confirmation shows the flow, working directory,
arguments, and a warning that the code runs with TypeAgent's user privileges
without a sandbox. Changed versions are identified. Long summary fields are
explicitly marked as truncated. **Review script and details** opens the full
script, definition, arguments, prior remembered script when changed, account,
runtime, timeout, and hash. Reviewing or going back does not grant permission;
only an explicit execution choice does. Cancel is the default in both views.
Tests, drafts, repairs, reasoning-loop and background invocations require
fresh confirmation; an import merely saves a script and cannot authorize it.
Missing or unavailable confirmation fails closed.

Execution consent uses a dedicated security-approval channel, not an ordinary
question or a model-callable structured continuation. The Shell, CLI, and VS Code
Shell display the question to the initiating client only. Reasoning forwards this
channel to that client. A headless/model-only MCP client cannot answer it by
calling `continueAction`; without an interactive approval endpoint, execution is
unavailable. A refusal blocks executor switching for that reasoning request, not
future independent user requests.

Direct connected-client flow invocations can remember an exact invocation for
the active session. SHA-256 binds the script and definition, and a separate
invocation hash binds its arguments, working directory, and timeout. Changes
require confirmation again. Approval is held in application memory, never in a
recipe-provided hash or approval flag. A restart/reinitialization asks again;
persistent cross-session approvals are not implemented.

Approval state is scoped by the host-issued session lifetime and connection,
including across out-of-process agent calls. Only positively identified direct
user calls may reuse it; reasoning, structured tool calls and unknown callers
cannot. Teardown and `@powershell revoke` invalidate outstanding permits.

Use `@powershell show <flowName>` to inspect execution availability and version status.
Use `@powershell revoke` to clear remembered approvals for the session.

New recipes and generated action schemas no longer request `allowedCmdlets`.
Old `allowedCmdlets`, `allowedPaths`, and `networkAccess` fields are accepted for
compatibility, not enforced as security restrictions. `requiredModules` lists
installed module names or paths to load after approval, before the root script.
Older saved `allowedModules` lists are interpreted as these dependencies, not as
an import whitelist. Module-load failure stops the invocation with an error.
Git, native programs, custom modules, and .NET can run after approval. There is
no AppContainer, restrictive AST/command policy, forced CLM, or single-process
limit on this path. The launcher does not elevate or specify an execution-policy
bypass. OS policy and normal access rights still apply.

The Windows execution broker uses a private owner-accessible request directory,
structured parameter binding, bounded output, timeouts, and a kill-on-close job
for its owned process tree. Owned child processes terminate when the execution
ends, including successful completion. Work submitted to external services is
not rolled back or necessarily stopped. Scripts and arguments are not placed in process
command-line arguments. The runtime is Windows PowerShell without profiles;
the working directory is the TypeAgent process directory unless explicitly
supplied by a trusted caller. The environment retains normal user/tool paths,
but not arbitrary parent API-key variables. Approved code can nevertheless read
user-accessible credentials and modify user-owned files: this is not containment.

The hash covers the root script and its definition, not all dynamically loaded
files, modules, or executables. The application and approval authority must remain
trusted; a compromised same-user process or malicious already-approved code is
outside that integrity guarantee. Independent shell/MCP tools need their own
authorization policy. No denial automatically falls back to an unrestricted tool.

### Parameters, output, and errors

Path and executable parameters support the case-insensitive aliases
`$env:USERPROFILE`, `$env:HOME`, `$env:TEMP`, `$env:TMP`, and `$env:PWD`.
They resolve to the user's home, temporary directory, or application working
directory, not arbitrary parent environment variables. Other environment
references in path parameters are rejected; ordinary string parameters remain
literal. Expanding an alias does not grant filesystem access.

Script execution errors are displayed without automatically falling back to
tool-enabled reasoning or retrying the script. Failed scripts may already have
produced side effects. An explicitly requested repair remains subject to the
selected execution mode and authorization requirements.

Native stderr with a successful exit is displayed as a warning, not treated as
a script failure. A nonzero final native exit code is a failure; scripts that
intentionally handle such an exit must reset `LASTEXITCODE` after recovery.

The broker retains restricted protocol v1 for compatibility, not as a selectable
flow execution mode. Its OS-isolation tests use a separate test-only host and
do not establish containment of approved-local execution. Existing
profiling/cache hashes remain separate from the approved-local session authority.

### Stored fingerprints are not approvals

The shared `@typeagent/agent-flows/powershell` store handles imports, generated
candidates, samples, edits and reasoning capture. It validates flow names and
fixed storage destinations before reading or writing them. There is no separate
unchecked capture writer.

`revisions/<name>.json` records SHA-256 fingerprints of saved code, parameter
definitions/defaults, module dependencies, timeout and provenance. This means
"this is the version that was saved", not "the user permitted it to run".
Recording, importing, testing and promoting a recipe cannot persist execution
approval. Script bytes are decoded as strict UTF-8 without normalizing line endings.

Older flows without a revision record remain listed and reviewable. They are
shown as `unverified`; loading does not create a record or execute them. Their
first authorized run establishes a fingerprint. An external edit produces a
`changed` warning and requires review of the new version. The runner checks that
the stored candidate did not change during approval, then executes its captured
copy. It never deletes older flows or overwrites them with current samples.

These records detect changes while the application and records remain trusted.
They do not resist an attacker who can replace both the script and its record,
or pin the contents of dynamically loaded modules, executables or files.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
