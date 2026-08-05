# Agent Memory MCP Instructions

This package is a standalone MCP server developed inside the TypeAgent monorepo.
Do not add `@typeagent/*` runtime dependencies or load TypeAgent configuration.
Keep domain and query code independent of MCP and SQLite adapters.

Use the official MCP TypeScript SDK v2 documentation when changing the protocol
adapter:

- Server guide: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/get-started/first-server.md
- SDK v2 documentation: https://ts.sdk.modelcontextprotocol.io/v2/
- MCP specification: https://modelcontextprotocol.io/specification/2026-07-28

The package uses `@modelcontextprotocol/server` and
`@modelcontextprotocol/client`, not the legacy combined
`@modelcontextprotocol/sdk` package.
