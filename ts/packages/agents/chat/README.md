# Chat Agent

Chat Agent is **sample code** that explores how to build a typed Chat agent with structured prompting and LLM.

The sample demonstrates:

- How to use schema to get a **structured** [Chat Response](./src/chatResponseActionSchema.ts) from the LLM.
- How the Chat Response schema allows the LLM to include one more **_lookups_** for additional information.
- How the [Chat Response Handler](./src/chatResponseHandler.ts) may use a web search engine to perform the lookups and produce a typed response.

The sample includes an example implementation of lookups with Bing. To experiment with lookups, please add your Bing API key to the root **.env** file with the following key:  
**BING_API_KEY**

If a key is not available, the agent will return a "No Information available" response.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
