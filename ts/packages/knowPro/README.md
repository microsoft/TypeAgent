# knowpro

**knowpro** is an **experimental sample code and prototype** working towards a shared understanding of the MVP for **Structured RAG**.

**knowpro** is in **active** development with very _frequent_ changes.

- knowpro implements **Structured RAG**.
  - Structured RAG first extracts **dense information** from text.
  - This dense information includes **structured** information such as entities, actions, topics, and tabular data in data frames.
  - This structured information is stored with suitable indexes that allow it to be:
    - Searched and retrieved using **structured queries**.
    - Enumerated and filtered using API calls
    - Retrieved information can also be used to retrieve the source text it was originally found in.
  - Indexes are updated incrementally, on the fly or in the background.
- knowpro also explores:
  - How to translate **natural language user requests** to structured queries.
  - How to use retrieved structured objects and their source text (as needed) to generate **answers** to user requests.
- Earlier iterations of structured RAG (as used by current conversation memory and other examples), are in the [knowledge-processor](../knowledgeProcessor) package.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
