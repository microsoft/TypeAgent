# Greeting Agent

Greeting Agent is **sample code** that explores how to build a typed Greeting agent with structured prompting and LLM.

The sample demonstrates:

- How to use schema to get a **structured** [Greeting Response](./src/greetingActionSchema.ts) from the LLM.
- How the Chat Response schema allows the LLM to generate several responses and select one at random from the generated options.
- How the [Greeting Command Handler](./src/greetingCommandHandler.ts) may use a web search engine to augment the generated responses with personalized information.

The sample includes an example implementation of lookups with Bing. To experiment with lookups, please add your Bing API key to the root **.env** file with the following key:  
**BING_API_KEY**

If a key is not available, the agent will return a "No Information available" response.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
