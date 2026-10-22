# Common Crawl Restaurants schema.org dataset

This directory contains examples of an Azure function that can extract [Schema.org](https://schema.org/) metadata from archives fetched from the Common Crawl index. Specifically, we extract [Restaurant](https://schema.org/Restaurant) data entries.

## Per-record size limits

Archive data and index metadata are untrusted. The batch activity applies these
independent limits before passing complete HTML to the existing schema extractor:

| Limit                | Default                   | Applies to                                                                                       |
| -------------------- | ------------------------- | ------------------------------------------------------------------------------------------------ |
| `MAX_DOWNLOAD_BYTES` | 8 MiB (8,388,608 bytes)   | Requested archive range and actual downloaded response body; also redirected-record index reads. |
| `MAX_WARC_BYTES`     | 16 MiB (16,777,216 bytes) | WARC bytes after expanding outer gzip, including headers and the encoded HTTP payload.           |
| `MAX_HTML_BYTES`     | 8 MiB (8,388,608 bytes)   | HTML bytes after HTTP content decoding, before UTF-8 conversion.                                 |
| `READ_CHUNK_BYTES`   | 64 KiB (65,536 bytes)     | Maximum incremental read or decompression output chunk.                                          |

One MiB is 1,048,576 bytes; one KiB is 1,024 bytes. Reads and decompression
permit one detection byte beyond the remaining total allowance, then reject
without retaining that over-limit chunk. A rejected record is logged and skipped,
not returned as partial HTML. Responses and sessions are closed on all exits.

Downloads use undecoded streaming responses, check actual bytes rather than
trusting size headers, and reject live HTTP redirects. An archived 301/302 response
can still trigger one bounded Common Crawl index lookup and archive download.
Archive requests have at most six attempts for retryable server statuses
(500/502/503/504) or connection failures, with DNS failures stopping after at most
three attempts. Index lookups have at most five attempts for 503 or transport
failures. Rejected data is not retried, and retry responses are closed unread.

Supported input is uncompressed or gzip-compressed WARC with complete HTTP
responses. HTML supports identity, gzip (including `x-gzip`), and wrapped/raw
deflate content encoding, optionally with chunked transfer framing and trailers.
Concatenated gzip members share one output budget. Corrupt, truncated, oversized,
unsupported, or repeated/stacked encodings are rejected. Brotli is explicitly
unsupported; installing an optional decoder does not enable an unbounded fallback.
Accepted HTML retains the existing UTF-8 replacement behavior.

These defaults bound individual processing stages, not total worker memory.
Copies, text strings, schema parsing, retained results, and concurrent activities
add overhead. Confirm sizing against representative records and the intended
worker concurrency before production deployment. These limits do not bound the
orchestrator's total activity or result count.

## Offline extraction tests

Use Python 3.11 or later. From the repository root on Windows:

```powershell
Set-Location python\commonCrawlData
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"
.\.venv\Scripts\python.exe -m compileall -q process_url_batch tests
```

The tests use mocked HTTP adapters and small synthetic WARC/gzip records, not
live Common Crawl, Azure storage, or credentials. They also exercise real HTTP
session behavior and real schema extraction, check cleanup and batch continuation,
and measure bounded decoder allocation in an isolated process.

## Trademarks

This project may contain trademarks or logos for projects, products, or services.
Authorized use of Microsoft trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project
must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
