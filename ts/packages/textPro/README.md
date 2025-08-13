# TextPro

TextPro is **sample code** for parsing, converting and manipulating text data and documents.

TextPro uses markdown as an intermediate format. Other formats like html are converted (and simplified) into markdown.

TextPro analyzes markdown documents and extracts:

- Document blocks/chunks such as headings, lists, tables, links, images, etc.
- Inferred knowledge such as entities, topics and structured tags. This knowledge can be inferred from markdown information without using an LLM.

TextPro is used by [Document Memory](../memory//conversation/src/docImport.ts) to import html and markdown documents.

## Module Overview

- [markdown](./src/markdown.ts)
  - Markdown parsing and analysis
  - Markdown chunking, including splitting large lists and tables
- [html](./src/html.ts)
  - html to markdown conversion
  - html simplification
  - html to text

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
