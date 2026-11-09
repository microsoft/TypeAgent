# @typeagent/browser-control-rpc

Browser control types and the content-script RPC client for TypeAgent. This is
the light, dependency-free package that shared browser code depends on, so
consumers (the Electron shell, the core `browser-typeagent` agent, and the
`utility` agent) can use the browser types and RPC client without pulling in the
agent's heavy transitive deps (embeddings, puppeteer, the extension toolchain).

## Export subpaths

| Subpath                     | Provides                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| `./types`                   | `BrowserControl`, `BrowserControlInvokeFunctions`, `BrowserControlCallFunctions`, `SearchProvider` |
| `./webAgentMessageTypes`    | Web-agent message wire types                                                                       |
| `./serviceTypes`            | Browser service type contracts                                                                     |
| `./extensionEvents`         | Extension event types                                                                              |
| `./platformServices`        | Platform service abstractions                                                                      |
| `./htmlReducer`             | Cross-context HTML reducer (`crossContextHtmlReducer`)                                             |
| `./pdfTypes`                | PDF annotation/service types                                                                       |
| `./pdfMarkdown`             | PDF extraction and Markdown conversion                                                             |
| `./answerEnhancement`       | Answer-enhancement types                                                                           |
| `./contentScriptRpc/types`  | Content-script RPC contract                                                                        |
| `./contentScriptRpc/client` | `createContentScriptRpcClient` (runtime)                                                           |

## PDF Markdown Imports

PDF-derived content uses the ordinary `memoryImportDocument` service operation:
`corpusId`, `title`, `markdown`, optional `canonicalUri` and `tags`. Sources,
revisions, content, jobs, search and forgetting use the shared memory contracts.
There are no retained-PDF capture/read/search APIs, capability grants or
capture/open browser-control operation types. Extraction algorithms and their
authored regeneration tools remain available.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
