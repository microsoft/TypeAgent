# Desktop automation

## Build

This project has two components

1. .NET code which integrates with Windows shell APIs to manage desktop UI. To build this:

   - Launch Visual Studio
   - Open the repo directory [dotnet/autoShell](../../../../dotnet/autoShell/) folder. Build this project.

2. App Agent for TypeAgent that sends actions to the .NET code:
   - Go to the repo directory [ts/packages/agents/desktop](./) folder (current).
   - Run `pnpm run build`

## Running the automation

Launch the [TypeAgent Shell](../../shell) or the [TypeAgent CLI](../../cli) and enable the app agent with command `@config agent desktop`.
You can issue commands from these interfaces such as:

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
