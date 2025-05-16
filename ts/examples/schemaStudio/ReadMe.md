## Schema Studio

This example explores how you could use structured prompting and LLM to:

- Generate variations on user utterances
- Automatically generate possible user utterances for a given schema

### Running

node dist/main.js

### Windows

You can use the run.cmd wrapper to launch node main.js

- cd scripts
- run.cmd @fromSchema --count 25
- run.cmd @variations "Yo, play me some Goldberg Variations by Bach!" --facets "Composer, Piece, Slang" --depth 2

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
