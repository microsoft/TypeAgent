# Importing Microsoft 365 Copilot conversations

> **Status:** Deferred / not implemented. This document captures the design,
> the verified API facts, and the reusable machinery so the feature can be
> picked up later. The blocker is access setup (Entra app registration +
> tenant admin consent + Copilot license), which the requester is pursuing
> separately.

---

## 1. Context: what already exists

We already import **GitHub Copilot Chat** sessions as read-only TypeAgent
conversation "mirrors". That pipeline lives in
[`packages/agentServer/server/src/copilot/`](../../../packages/agentServer/server/src/copilot/):

- **`sessionStoreReader.ts`** — reads GitHub Copilot's local `session-store.db`
  (SQLite) and the native `chatSessions/*.jsonl` files (for `customTitle`).
- **`displayLogSynthesis.ts`** — `synthesizeDisplayLog(sessionId, turns)` turns
  a session's turns into a `DisplayLogEntry[]` (a `user-request` + markdown
  `set-display` pair per turn, sharing one synthesized `requestId`).
- **`mirrorImporter.ts`** — orchestrates: read → synthesize → register mirror.
  Idempotent per `sessionId`; re-import reconciles the display name to the
  current title.

The mirror is registered via
`ConversationManager.importCopilotMirror(...)` in
[`conversationManager.ts`](../../../packages/agentServer/server/src/conversationManager.ts),
which persists a `displayLog.json` and marks the conversation
`source: "copilot"`. It renders through the **existing** join → replay path —
no rendering code was added.

The command surface is `@copilot import`, implemented server-side in
[`copilotCommandHandlers.ts`](../../../packages/dispatcher/dispatcher/src/context/system/handlers/copilotCommandHandlers.ts),
which streams progress via `clientIO` (`displayStatus`) so it works in every
client (Electron shell, VS Code, CLI). The importer is injected into the
dispatcher context as the `copilotImport` capability (see
`CommandHandlerContext.copilotImport` / `DispatcherOptions.copilotImport`).

**The goal here:** add M365 Copilot conversations as a second source that
flows through the same mirror pipeline.

---

## 2. Key finding: M365 Copilot is cloud-backed (no local store)

Unlike GitHub Copilot, M365 Copilot keeps **no queryable local conversation
store**. Verified on a Windows dev machine (2026-07-02):

- `%LOCALAPPDATA%\copilot\pkg\...` contains only app binaries (tree-sitter,
  ripgrep, foundry-local-sdk, etc.) — **not** the M365 BizChat app's data.
- The M365 Copilot app is a WebView2 host; its `EBWebView` profile has a cache
  and `Local Storage` but **no `.db` / `.sqlite` conversation database**.
- The conversations live server-side in **Substrate** (the user's Exchange
  mailbox). Hosts referenced in the app's Local Storage (frequency): 
  `graph.microsoft.com` (36×), `www.office.com`, `loki.delve.office.com`,
  `outlook.office.com` / `outlook.office365.com`, `ecs.office.com`,
  `substrate.office.com`.

So there is nothing to read off disk. Import must go through an **API call**.

---

## 3. Two API paths (and the chosen one)

| Path | Auth model | Stability | Chosen? |
| --- | --- | --- | --- |
| **Graph export API** — `getAllEnterpriseInteractions` | **Application-only** (`AiEnterpriseInteraction.Read.All`) + tenant admin consent + Copilot license | Documented / supported | ✅ **Yes** (requester is pursuing admin consent) |
| **Internal Substrate endpoint** — the call the M365 Copilot app itself makes to list/load chats | Delegated user token (audience `substrate.office.com`) | Undocumented, can change without notice | ❌ No (fragile) |

We are targeting the **documented Graph export API**. The internal Substrate
call is closer to the "just use the user's token" idea and matches the app's
own behavior 1:1, but it is an internal contract and would be brittle; it is
recorded here only as an alternative if the documented path proves unworkable.

> To pursue the internal path later, capture one live request from the M365
> Copilot app (F12 → Network → open a conversation) to get the exact host,
> path, token audience, and response body — do not guess these.

---

## 4. The documented API (verified 2026-07-02)

Microsoft Graph — **AI interaction export**.

- Resource: `aiInteractionHistory`
- Method: **Get all enterprise interactions**

```http
GET https://graph.microsoft.com/v1.0/copilot/users/{userId}/interactionHistory/getAllEnterpriseInteractions
Authorization: Bearer {token}
```

Returns `200 OK` with a collection of `aiInteraction` objects.

### Permissions

| Type | Supported? | Permission |
| --- | --- | --- |
| Delegated (work/school) | ❌ Not supported | — |
| Delegated (personal MSA) | ❌ Not supported | — |
| **Application** | ✅ | **`AiEnterpriseInteraction.Read.All`** |

**Application-only.** There is no delegated form. Requires an Entra app
registration and **tenant admin consent**.

### Licensing / prerequisites

- Requires a valid Microsoft 365 Copilot license with the **`Microsoft
  Copilot with Graph-grounded chat`** service plan on the target user.
- The target user's tenant must have Copilot enabled and export permitted.
- **Commercial (worldwide) cloud only** — not available in national cloud
  deployments (GCC High, DoD, etc.).
- Never returns consumer/personal-account interactions.

### Query parameters

- `$top` — page size; **100 recommended** for performance.
- `$filter` on `appClass` — scope to a Copilot surface. Examples:
  - `IPM.SkypeTeams.Message.Copilot.BizChat` — the standalone M365 Copilot
    chat app (the one in the screenshot / most relevant here).
  - `IPM.SkypeTeams.Message.Copilot.Teams` — Copilot in Teams meetings.
- `$filter` on `createdDateTime` — must supply **both** a lower and upper
  bound, e.g. `createdDateTime gt 2025-11-24T00:00:00Z and createdDateTime lt
  2025-11-25T00:00:00Z`.
- **No `delta`** support; no incremental cursor. Paging is via `$top` + server
  paging. (Import must window by date or page fully.)
- The API does **not** cover agents created by Copilot Studio.

### `aiInteraction` shape (fields we care about)

```jsonc
{
  "id": "1732148356886",                    // per-message id
  "sessionId": "19:...@thread.v2",          // groups a conversation
  "requestId": "f128b7a9-...",              // pairs a prompt with its response
  "appClass": "IPM.SkypeTeams.Message.Copilot.BizChat",
  "interactionType": "userPrompt",          // OR "aiResponse"
  "conversationType": "bizchat",            // OR "appchat", etc.
  "createdDateTime": "2024-11-21T00:19:16.886Z",
  "locale": "en-us",
  "from": { /* user identity (aadUser) or bot application identity */ },
  "body": {
    "contentType": "text",                  // OR "html", or adaptive-card JSON
    "content": "What should be on my radar from emails last week?"
  },
  "attachments": [ /* may include adaptive cards, file references */ ],
  "links": [ /* meeting/file/event links */ ],
  "mentions": [],
  "contexts": [ /* e.g. Teams meeting reference */ ]
}
```

Notes that affect the importer:

- **No conversation title field.** Like GitHub Copilot's `session-store.db`,
  there is no per-conversation title here — we'll derive one (first user
  prompt, mirroring our existing summary fallback).
- **Content is heterogeneous.** `body.contentType` is `text`, `html`, or an
  adaptive-card payload (common in BizChat responses). Needs sanitizing to
  markdown/plain text before it renders in a bubble.
- Interactions are **flat messages**, not turns. Group by `sessionId`, order by
  `createdDateTime`, and pair `userPrompt` + following `aiResponse` (same
  `requestId`) into a turn.

---

## 5. Mapping to the existing pipeline

| M365 `aiInteraction` | TypeAgent mirror model |
| --- | --- |
| `sessionId` | conversation identity (dedup key for `importCopilotMirror`) |
| `interactionType: "userPrompt"` | `user-request` display entry (`body.content`) |
| `interactionType: "aiResponse"` | `set-display` markdown entry (sanitized `body.content`) |
| `requestId` | pairs a prompt with its response into one turn |
| `createdDateTime` | turn timestamp |
| first `userPrompt` of a session | derived mirror name (title fallback) |
| `appClass` | filter to the desired Copilot surface |

Everything downstream of "a session with ordered turns" is **already built**
and reused unchanged:

- `synthesizeDisplayLog(sessionId, turns)` → `DisplayLogEntry[]`
- `ConversationManager.importCopilotMirror(...)` (idempotent + title reconcile)
- `@copilot import` streaming/progress plumbing and the `copilotImport`
  capability injection
- Grouped "GitHub Copilot" / "TypeAgent" dropdown sectioning (add an "M365
  Copilot" group, or fold under a shared "Copilot" source)

---

## 6. What still needs to be built

1. **Token acquisition (app-only).** MSAL confidential client using the Entra
   app's credential (client secret or, preferred, a cert from Key Vault —
   the repo already has AAD/Key Vault infra via `getKeys` / `aiclient`).
   Acquire a token for `https://graph.microsoft.com/.default`.
   - App-only means the call is **per user id** — the importer must be told
     *which* user to import (the signed-in user's AAD object id, or an admin
     selection). There is no "me".
2. **`GraphInteractionReader`.** Calls
   `getAllEnterpriseInteractions` with paging (`$top=100`) and optional
   `appClass` / date-window `$filter`; yields sessions grouped by `sessionId`
   with ordered, paired turns — i.e. the same shape `mirrorImporter` consumes.
3. **Content sanitization.** Convert `html` and adaptive-card `body.content`
   into markdown/plain text for the `set-display` entries.
4. **Command surface.** Either extend `@copilot import` with an M365 mode
   (e.g. `@copilot import --source m365`) or add `@copilot import-m365`. Reuse
   the server-side `displayStatus` streaming pattern.
5. **Config.** Entra client/tenant id + credential wiring in
   `config.local.yaml` / Key Vault; a way to specify the target user id.

The reader is the only substantial new code; synthesis, registration,
reconcile, progress, and rendering are all reused.

---

## 7. Prerequisites checklist (the access gate)

- [ ] Entra app registration with **`AiEnterpriseInteraction.Read.All`**
      (Application) permission.
- [ ] **Tenant admin consent** granted for that permission.
- [ ] App credential (client secret or cert) available to the agent-server
      (Key Vault preferred).
- [ ] Target user(s) hold a **M365 Copilot** license with the Graph-grounded
      chat service plan.
- [ ] Tenant is **commercial cloud** (not national cloud).
- [ ] The AAD **object id** of the user whose interactions to import.

Until admin consent + license are in place, the API returns nothing (or 403),
so there is no point wiring the reader before then.

---

## 8. Open questions / decisions for implementation time

- **Scope:** just BizChat (`appClass = IPM.SkypeTeams.Message.Copilot.BizChat`)
  to match the M365 Copilot app, or all surfaces (Teams/Word/Outlook)?
- **Title:** first user prompt as the name (consistent with GitHub Copilot
  fallback), or an LLM-generated title? (Prior decision for GitHub Copilot was
  to prefer the real VS Code title and avoid LLM titles for parity; M365 has no
  equivalent title to mirror, so first-prompt is the natural default.)
- **Incremental sync:** no `delta`; would need date-window bookkeeping
  (`createdDateTime` watermark) if we want re-import to fetch only new
  interactions.
- **Adaptive cards / attachments:** render a text summary, or attempt richer
  rendering? Start with sanitized text.
- **Grouping in the dropdown:** separate "M365 Copilot" section vs. a single
  "Copilot" umbrella source.

---

## 9. References

- `aiInteractionHistory` resource — Microsoft Graph (beta):
  `https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/ai-services/interaction-export/resources/aiinteractionhistory`
- `getAllEnterpriseInteractions` method:
  `https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/ai-services/interaction-export/aiinteractionhistory-getallenterpriseinteractions`
- Existing GitHub Copilot import: `packages/agentServer/server/src/copilot/`
