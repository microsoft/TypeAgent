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

## Crawl counts and activity scheduling

The HTTP starter, orchestrator, and initial index activity share the policy in
`crawl_limits.py`. The HTTP endpoint remains function-key protected.

| Setting                          | Default             | Allowed range or budget                                                                                |
| -------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------ |
| `limit`                          | 1,000               | 1-1,000 accepted index records                                                                         |
| `batch_size`                     | 50                  | 1-50 input records per processing activity                                                             |
| `crawl_id`                       | `2025-13`           | Nonempty collection identifier without whitespace, control characters, or `/`, `\`, `?`, `#`, `&`, `%` |
| `url_prefix`                     | Required            | Nonblank search string; existing prefix patterns are supported                                         |
| Direct `get_urls` activity limit | 100                 | Same 1-1,000 range; orchestration calls pass their explicit limit                                      |
| Outstanding activities           | 4 per orchestration | Processing and batch saves use separate windows and wait before starting the next window               |
| Total logical activity calls     | At most 2,002       | One index call, up to 1,000 processing calls and 1,000 batch saves, and one combined save              |

For `N` accepted records and batch size `B`, there are `ceil(N / B)` batches,
with at most `2 * ceil(N / B) + 2` logical activity calls. The default 1,000/50
crawl has 20 batches and at most 42 calls. These counts are not HTTP-attempt
budgets or exactly-once execution guarantees; the existing per-record network
retries remain unchanged.

Missing or empty numeric HTTP query values retain their defaults. Other values
must be decimal integers within the documented range; surrounding whitespace,
an optional `+`, and leading zeros are accepted. Zero, negatives, fractions,
exponents, and malformed values are rejected. Missing direct-orchestration
fields retain defaults, but explicit null/empty/boolean/fractional values do not.
Invalid starter requests return HTTP 400 JSON, for example:

```json
{
  "status": "error",
  "message": "batch_size must be an integer between 1 and 50"
}
```

No orchestration is started for invalid HTTP input. Invalid direct orchestration
input returns an explicit error payload before scheduling any activity; Durable
may report the instance as **Completed**, with `status: error` in its output,
rather than **Failed**. Activity exceptions still propagate.

The initial index request sends the validated limit and counts streamed JSON
records locally. More records than requested cause an explicit error, not silent
truncation. The orchestrator independently rejects excess/malformed index output
before processing. The index connect/read timeouts are 5/30 seconds; a read timeout
limits inactivity, not the entire download duration. The existing logged non-200
index response still returns an empty result, so it remains indistinguishable
from no captures to the orchestrator.

Rejected archive records may yield fewer extraction results, including empty
batches. Empty batches keep their batch saves and original numbering. The combined
save runs only when some data was extracted. `total_urls_processed` counts accepted
input records, not successful downloads; `restaurants_extracted` counts actual
results. Result formats, combined blob merging, and the starter's Durable status
response are unchanged.

`host.json` initially limits loaded activities and orchestrators to one each per
worker. Four outstanding tasks can include queued tasks; this is not a promise of
four simultaneous executions. Do not increase activity concurrency without
reviewing worker threads/processes and the save activity's shared container state.
Neither these host settings nor per-orchestration windows are a global rate limit.
The numeric limits are conservative starting policy, not measured worker capacity.
Record counts do not impose byte limits on initial-index lines, extraction objects,
or retained workflow history. Per-record byte caps also do not establish a total
worker-memory ceiling.

This example retains the Python v1 (`function.json`) programming model and requires
`azure-functions-durable<2`. The Durable Python SDK 2.x does not support that model;
do not upgrade the SDK major version without a separately reviewed migration.
The Requests, urllib3, and warcio pins from the per-record fix are unchanged.

### Replay and rollout

Output names use one recorded Durable UTC timestamp for all saves in a crawl.
Domain naming uses tldextract's bundled suffix list without network fetching or
disk caching. Its snapshot can classify rare/new suffixes differently from an
older downloaded list; verify representative domains before rollout.

This change alters activity scheduling history. Stop new starts and drain active
instances on their old code before deployment. If draining is not possible, use
a separately versioned deployment/task hub. Do not change the policy constants,
dependencies, or bundled suffix data underneath active instances without the same
replay-compatibility review.

## Offline tests

Use Python 3.11 or later. From the repository root on Windows:

```powershell
Set-Location python\commonCrawlData
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"
.\.venv\Scripts\python.exe -m compileall -q crawl_limits.py http_start get_urls orchestrator process_url_batch save_results tests
```

The tests use mocked HTTP adapters and small synthetic WARC/gzip records, not
live Common Crawl, Azure storage, or credentials. They also exercise real HTTP
session behavior and real schema extraction, check cleanup and batch continuation,
and measure bounded decoder allocation in an isolated process. The crawl tests also
cover parameter boundaries, zero scheduling on rejection, both activity windows,
total calls, partial/empty extraction, output contracts, and replay-safe naming.
Run the suites together to check the record-size and crawl-count fixes coexist.

## Trademarks

This project may contain trademarks or logos for projects, products, or services.
Authorized use of Microsoft trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project
must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
