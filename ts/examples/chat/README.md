## Chat and Memory example

- **Sample code** used to interactively experiment with several **conversation** and **memory** related packages as they are being developed.
- Requires file system access. The app creates test directories under **/data/testChat**
- **Frequent changes**

Interaction is via a set of commands.

- Enter @**help** for a list of commands
- All command names must be prefixed with **@**
  - E.g: @kpCmRemember
- Get help for any command using --?
  - E.g: @kpCmRemember --?

## knowpro and memory

Packages explored:

- [knowpro](../../packages/knowPro/)
- [memory](../../packages/memory/)

All knowPro commands prefixed with @**kp**.

You can list all commands matching a prefix by typing the prefix: e.g. @kpSearch

| Feature Area                                               | Command Prefix             |
| ---------------------------------------------------------- | -------------------------- |
| [knowpro Search/Answer](./src/memory/knowproMemory.ts)     | @kpSearch..., @kpAnswer... |
| [Podcast Memory](./src/memory/knowproPodcast.ts)           | @kpPodcast...              |
| [Image Memory](./src/memory/knowproImage.ts)               | @kpImage...                |
| [Email](./src/memory/knowproEmail.ts)                      | @kpEmail...                |
| [Conversation Memory](./src/memory/knowproConversation.ts) | @kpCm...                   |

## knowledge-processor

Any command that does not have the prefix "@kp".
Experiments with older packages:

- [knowledge-processor](../../packages/knowledgeProcessor/)

## code-processor

Packages targeted:

- [code-processor](../../packages/codeProcessor/)

Run the test app with argument:

- "code": Code analysis, search and other ideas
- "codeMemory": Experiments with memory for devs

### Notes

- This test app creates test directories.
- This may require **_admin (sudo)_** rights. On Linux/WSL, you may need to launch node with sudo.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
