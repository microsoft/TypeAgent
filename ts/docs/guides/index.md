# Guides

Task-oriented guides for **building on** TypeAgent, using its components as
libraries inside your own application. These are how-tos for integrators and
consumers, distinct from the [Architecture](../architecture/index.md)
deep-dives (how it works internally) and [Contributing](../contributing/index.md)
(how to change this repo and its wiki).

- [Build an agent](./build-an-agent/index.md): the canonical walkthrough for
  authoring a TypeAgent application agent. Pick a pattern, scaffold, define
  actions and grammar, iterate locally, and distribute via path, catalog, or
  feed. Sub-guides in this section (starting with
  [User interaction (`ActionIO`)](./build-an-agent/user-interaction.md)) go
  deeper on individual topics.
- [Embedding the dispatcher](./embedding-dispatcher.md): run the TypeAgent
  dispatcher engine inside your own host process. `createDispatcher` options,
  which package to depend on, and the three common setups (your own agents,
  the ready-made default agents, or your own source).
