## Memory

CLI for experimenting with Structured RAG and memory packages under **active development**.

- **Sample code** with _Frequent Updates_

The CLI explores memory scenarios using the following packages:

- [knowpro](../../packages/knowPro/)
- [conversation-memory](../../packages/memory/conversation)
- [image-memory](../../packages/memory/image)

The CLI is also used for interactive adhoc testing of these packages.

Enter @**help** for a list of commands

- All command names must be prefixed with **@**
  - E.g: @kpCmRemember
- Get help for any command using --?
  - E.g: @kpCmRemember --?

You can list all commands matching a prefix by typing the prefix: e.g. @kpSearch

| Feature Area                                               | Command Prefix             |
| ---------------------------------------------------------- | -------------------------- |
| [General Search and Answer](./src/memory/knowproMemory.ts) | @kpSearch..., @kpAnswer... |
| [Podcast Memory](./src/memory/knowproPodcast.ts)           | @kpPodcast...              |
| [Image Memory](./src/memory/knowproImage.ts)               | @kpImage...                |
| [Email Memory](./src/memory/knowproEmail.ts)               | @kpEmail...                |
| [Conversation Memory](./src/memory/knowproConversation.ts) | @kpCm...                   |

### Trying it out

- Use the **@kpPodcastLoadSample** command to load a pre-built Structured-RAG index for a [sample podcast](../../packages/knowPro/test/data/Episode_53_AdrianTchaikovsky.txt).
- Run example commands such as those listed in [input.txt](./src/memory/input.txt)

```
@kpPodcastLoadSample

@kpAnswer --query "List all books"
@kpAnswer --query "List all books that are also movies"
```

### Notes

- Requires file system access. Creates test directories under **/data/testChat**
- May require **_admin (sudo)_** rights. On Linux/WSL, you may need to launch node with sudo.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
