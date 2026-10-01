# @typeagent/memory-client

Typed in-process and MCP clients plus Zod protocol schemas for the TypeAgent
memory service. The management surface includes corpus status, paged source and
job listing, bounded content reads, source-scoped knowledge, revision-guarded
replacement, preview/confirm source deletion, and source/corpus reindexing.
It also exposes the personal how-to settings, candidate lifecycle, and
versioned procedure save, get, list, search, and archive operations through
both in-process and MCP clients.

Document ingestion uses one model-driven `content` pipeline and KnowPro
retrieval. The mode can be omitted; chunk sizing remains configurable.
The protocol rejects the removed `basic`, `summary`, and `full` modes rather
than translating them or falling back to a different search engine. An
accepted ingestion request is not an assertion that indexing has completed;
use the job status to observe completion or failures.

The typed `answer` operation returns an answer with source-linked citations.
By default the answer is synthesized by KnowPro's answer generator over the
retrieved evidence (`mode: "synthesized"`); `answerMode: "extractive"` returns
the ranked evidence snippets verbatim (`mode: "extractive"`).

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
