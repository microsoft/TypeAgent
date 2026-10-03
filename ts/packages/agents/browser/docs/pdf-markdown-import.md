# PDF Markdown Import Boundaries

PDF corpus import uses ordinary Markdown memory ingestion. The viewer or import
client extracts Markdown and calls `memoryImportDocument` with `corpusId`,
`title`, `markdown`, and optional `canonicalUri` and `tags`. The browser agent
submits a `markdown` source in `content` mode with `retainRevisionHistory` to the
shared memory service. Ingestion returns the ordinary job, source and revision
identifiers. Source content, job tracking and forgetting use memory operations.

The browser agent does not save original PDF bytes, extraction artifacts,
location maps or capture manifests. PDF-specific storage RPC, capabilities,
host proofs, token handshakes and retained capture actions are removed. This is
a code removal, not a migration or deletion of existing user data. Files already
saved by earlier versions remain on disk.

## WebSocket Boundary

`AgentWebSocketServer` binds to loopback and enforces its general Origin
allowlist before accepting connections. This is a cross-site connection filter,
not local-client authentication: native callers can omit or forge Origin and
supply their own client and session identifiers.

Each connection multiplexes `agentService` and `browserControl` RPC. Session
registration selects the handler set, including for clients connected before
registration. Duplicate connections are scoped to the client/session pair;
session removal disconnects only that session. Ordinary memory operations do
not require a separate PDF handshake, and browser-control calls have no
retained-PDF trust wrapper. The shell uses normal browser-agent discovery.

## Native Renderer Boundary

Electron's `browser-rpc-message` relay still requires a host-owned browser-tab
WebContents, its actual top-level frame, and an exact packaged view path from
the extension loaded by the host. Ownership and frame URL are rechecked after
connection establishment and before replies. Arbitrary web renderers cannot
appoint themselves as service RPC recipients.

The legacy `send-to-browser-ipc` relay accepts site messages with a string
`method` but rejects channel envelopes. It does not issue credentials or inject
a private PDF host connector. Extension runtime provenance checks remain a
separate client-side boundary.

## Tests

- `test/memoryImportHandlers.spec.mjs` checks Markdown ingestion, optional
  metadata, failure propagation, direct forgetting and the absence of PDF RPC.
- `test/agentConnectionBoundary.spec.mjs` checks ordinary memory RPC over real
  loopback sockets, malformed frames, Origin rejection, late registration,
  session isolation, duplicate reconnects and ordinary outgoing browser control.
- `shell/test/browserRpcBoundary.spec.mts` checks renderer ownership, main-frame
  identity, packaged paths, navigation and channel-envelope rejection.
- `browserControlRpc/test/memoryImportContract.spec.mjs` checks shared type
  contracts without altering the PDF extraction engine.
