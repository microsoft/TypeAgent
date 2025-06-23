## Knowpro and Memory Test App

A CLI to test and experiment with the [KnowPro](../../packages/knowPro/README.md) and [memory](../../packages/memory/README.md) packages. This is **sample code** in active development with frequent updates.

The CLI explores:

- [KnowPro](../../packages/knowPro/README.md)
- [conversation-memory](../../packages/memory/conversation/README.md)
- [image-memory](../../packages/memory/image/README.md)

The CLI also uses the [knowProTest](../../packages/knowProTest/README.md) package to wrap and invoke KnowPro APIs.

Enter @**help** for a list of commands

- All command names must be prefixed with **@**
  - E.g: @kpCmRemember
- Get help for any command using --?
  - E.g: @kpCmRemember --?

You can list all commands matching a prefix by typing the prefix: e.g. @kpSearch

| Feature Area                                               | Command Prefix             |
| ---------------------------------------------------------- | -------------------------- |
| [Search and Answer Commnds](./src/memory/knowproMemory.ts) | @kpSearch..., @kpAnswer... |
| [Podcast Memory](./src/memory/knowproPodcast.ts)           | @kpPodcast...              |
| [Email Memory](./src/memory/knowproEmail.ts)               | @kpEmail...                |
| [Conversation Memory](./src/memory/knowproConversation.ts) | @kpCm...                   |
| [Image Memory](./src/memory/knowproImage.ts)               | @kpImage...                |
| [Document Memory](./src/memory/knowproDoc.ts)              | @kpDoc...                  |

### Trying it out

- Ensure you have a [.env](../../README.md#service-keys) configured with Service keys.
- Examples have been tested with **GPT-4o** only.
- Run the app:
  - cd ts/examples/chat
  - node dist/main.js
- Use the **@kpPodcastLoadSample** command to load a pre-built Structured-RAG index for a [sample podcast](../../packages/knowPro/test/data/Episode_53_AdrianTchaikovsky.txt).
- Run example commands such as those listed in [input.txt](./src/memory/input.txt)

```
@kpPodcastLoadSample

@kpSearchTerms book

@kpSearchTerms book --genre fantasy

@kpAnswer --query "List the names of all books"
```

### Batching commands

You can place commands in a text file and run them as a batch by using the **batch** command.

```
@batch --filePath <>
```

Type batch --? for options.

### Notes

- Requires file system access. Creates test directories under **/data/testChat**
- May require **_admin (sudo)_** rights. On Linux/WSL, you may need to launch node with sudo.

### knowledge-processor

The CLI additionally lets you explore the [knowledge-processor](../../packages/knowledgeProcessor/README.md) package. See [instructions](./src/knowledgeProc/README.md) for how to do so.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
