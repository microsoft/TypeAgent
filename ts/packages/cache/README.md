# Explanation and Construction cache

With user requests, translation and history, LLM is asked to **explain** how it transformed the user request into the action, and uses the explanation to create constructions - parsing grammar/rule - that can be cached, and used to perform translations of user request locally bypassing the LLM.

## Development

### Adding new explainer

The list of supported explainers is located at [explainerFactories.ts](./src/explanation/explainerFactories.ts)
Multiple explainer support is use to explore changes to the explainer prompt and schema. Each explainer may be configured
with their own validator and construction creator. Some explainers might not support that and some of the scenarios will not work.

Each explainer contains code (validation and construction creation), and the schema(s) (used to ask LLM to break down requests).

### Cloning existing explainer

Each explainer contains code (validation and construction creation), and the schema (used to ask LLM to break down requests).

One way to start a new explainer is to clone an existing one.
Here is an example instruction to create v5 from v4:

- In the directory [./src/explanation](./src/explanation], make a copy of the code (`explanationV4.ts`) and schemas (`explanationSchemaV4.ts` and `actionExplanationSchemaV4.ts`). and change the suffix from V4 to V5
- Rename all `V4` suffix in `explanationV5.ts` to `V5`
- Add the new explainer in the `explainerFactories.ts` by adding a new entry in the `explainerFactories array`, with the key as the name of the explainer and the value the function to create the explainer from `explanationV5.ts`
- After that `@config explainer v5` in the CLI or shell will switch to start using that explainer.

Note that each explainer has their own cache and not reused across different explainers.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
