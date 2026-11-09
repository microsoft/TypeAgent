# Conversation content search and migration

The dispatcher is the only producer of live conversation events. Both server
hosts inject their shared MemoryService into dispatcher conversation settings.
The conversation manager also accepts the existing memory-agent
`memoryServiceClient` façade. `search_conversations` delegates the complete
question to `searchEvents` in `typeagent-profile-conversations`, then groups
KnowPro-scored events into conversation snippets. It does not run another text
similarity search or query/ranking engine.

`@conversation index` imports historical user turns from display logs. Request
IDs (or legacy display sequence IDs) identify turns; retained dispatcher events
deduplicate those turns across producers. Imported turns carry user-assertion,
not verified-observation, authority, and preserve original display timestamps
when present. Copilot source-session identity is retained in event metadata.
The service owns event IDs and persistence.
Indexed counts reflect retained user-turn events, not queued work or transcripts.
Append, projection-search, and deletion errors propagate to callers.

The content-free `conversations/_unified/conversationEventReplay.json` stores
consumed turn identities and deleted conversation identities, not answers,
snippets, embeddings, or knowledge. Native migration eligibility is frozen before
dispatchers start, so subsequent live transcript turns are never replayed. New
native conversations have no migration-eligible turns. Imported histories may
grow; consumed identities remain suppressed after forgetting and restart.
Deleted imported source-session identities are also retained: importing the
same Copilot session again is rejected rather than assigning a fresh conversation
ID that evades suppression.
Suppression is persisted before append: an abrupt crash between these steps may
leave a migration gap, rather than risk resurrecting forgotten content. An
ordinary append failure removes that suppression so an explicit retry can work.

Deleting a conversation drains its dispatcher and purges its scoped ledger
events before removing metadata. Startup also purges events for server-tracked
conversations absent from the registry; untracked ledger conversations are not
broadly deleted. Corrupt metadata fails startup rather than treating every
conversation as deleted. Original transcripts remain outside selective
event forgetting. The service's durable `EVENT_FORGOTTEN` suppression also prevents forgotten
canonical turns from being recreated before the first migration checkpoint.
That typed rejection skips the turn without reporting it as newly indexed, and
the attempted identity is retained in the server checkpoint so later backfills
skip it. Other persistence, projection, and purge failures still propagate.

Legacy `unifiedMemory` files are **not imported, read, or written**: their message
tags cannot establish precise durable event provenance. After resolving the
canonical corpus, durable hosts retire exactly `unifiedMemory_data.json`,
`unifiedMemory_embeddings.bin`, and those two files' `.bak` recovery copies.
No directory or wildcard deletion occurs, and replay identities and unrelated
files are retained. Historical native user turns can instead be migrated from
their original display-log identities using `@conversation index`. Neither
event forgetting nor this migration claims to erase every historical artifact.
Hosts without an injected
service can still manage conversations, but content indexing/search explicitly
fails instead of silently reporting successful inert indexing.
