# Desktop automation

## Build

This project has two components

1. .NET code which integrates with Windows shell APIs to manage desktop UI. To build this:

   - Launch Visual Studio
   - Open the repo directory [dotnet/src/autoShell](../../../../dotnet/autoShell/) folder. Build this project.

2. The node process that integrates with TypeAgent. To build this:
   - Go to the repo directory [ts/packages/agents/desktop](./) folder.
   - Run `pnpm run build`

## Running the automation

1. In the repo directory [ts/packages/agents/desktop](./), run `pnpm run start`
2. Launch the [TypeAgent Shell](../../shell) or the [TypeAgent CLI](../../cli). These are integrated with the automation agent and can send commands. You can issue commands from this interface such as:
   - launch calculator
   - maximize calculator
   - tile calculator to the left and chrome to the right
   - etc.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
