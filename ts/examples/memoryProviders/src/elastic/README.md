# Elastic Memory Provider

This code contains a memory provider implementation using Elastisearch. To get a running instance of Elastisearch use the following steps for running Elastisearch [locally](https://www.elastic.co/guide/en/elasticsearch/reference/current/run-elasticsearch-locally.html)

1. `curl -fsSL https://elastic.co/start-local | sh`

Now with a working Elastisearch instance, set the environment variables:

- `OPENAI_MODEL_EMBEDDING_DIM` - dimension of the model you want to use for embedding.
- `ELASTIC_URI` - URI of the Elastisearch instance you want to use.

Once these variables are set, you can run the chat example with:

- `pnpm run runchat`

The following commands can be used to load and interact with a podcast:

1. `@podcastConvert --sourcePath <path_to_podcast_transcript>` turn podcast transcript into a turn directory.
2. `@podcastIndex --sourcePath <path_to_turns>` to index and create entities, actions, and topics from the podcast.
3. `@podcastEntities` to see the created structure
4. `@podcastSearch --query <query>` to search the imported content.
