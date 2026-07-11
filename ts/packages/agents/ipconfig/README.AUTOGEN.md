<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=abe08dc25887cf6e97e9ba932ed8fe636200fe6ed1ae075170307d8caa3d126e -->
<!-- AUTOGEN:DOCS:SOURCE: (no hand-written ./README.md found at last regen) -->

# ipconfig-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `ipconfig-agent` is a TypeAgent application agent that provides a conversational interface to the Windows `ipconfig` command-line tool. It allows users to perform various network configuration tasks, such as managing IP addresses, DNS settings, and DHCP configurations, using natural language commands. This agent simplifies network management by abstracting the complexity of command-line syntax, making it accessible to users who may not be familiar with the `ipconfig` utility.

## What it does

The `ipconfig-agent` supports a wide range of actions that map directly to common `ipconfig` commands. These actions are grouped into the following categories:

### Help and Information Display

- **`displayHelpMessage`**: Provides the help message for the `ipconfig` command, listing available options and their usage.
- **`displayFullConfigurationInformation`**: Displays detailed network configuration information, including IP addresses, DNS settings, and adapter details.
- **`displayDNSResolverCacheContents`**: Shows the current contents of the DNS resolver cache.
- **`displayDHCPClassIDs`** and **`displayIPv6DHCPClassIDs`**: Display the DHCP class IDs for IPv4 and IPv6 adapters, respectively.

### IP Address Management

- **`releaseIPv4Address`** and **`releaseIPv6Address`**: Release the IPv4 or IPv6 address for a specified network adapter. These actions accept an optional `adapter` parameter to specify the target adapter.
- **`renewIPv4Address`** and **`renewIPv6Address`**: Renew the IPv4 or IPv6 address for a specified network adapter. These actions also accept an optional `adapter` parameter.

### DNS and DHCP Management

- **`purgeDNSResolverCache`**: Clears the DNS resolver cache to resolve potential DNS-related issues.
- **`refreshDHCPLeasesAndReRegisterDNSNames`**: Refreshes all DHCP leases and re-registers DNS names to ensure up-to-date network configurations.
- **`modifyDHCPClassID`** and **`modifyIPv6DHCPClassID`**: Modify the DHCP class ID for IPv4 and IPv6 adapters, respectively. These actions require an `adapter` parameter and accept an optional `classID` parameter.

By supporting these actions, the `ipconfig-agent` enables users to perform a variety of network management tasks, such as troubleshooting connectivity issues, updating IP configurations, and managing DNS and DHCP settings, all through natural language commands.

## Setup

The `ipconfig-agent` requires minimal setup. To get started:

1. Ensure you have `pnpm` installed on your system.
2. Navigate to the package directory and install its dependencies by running:

   ```sh
   pnpm install
   ```

No additional environment variables, API keys, or external accounts are required for this package.

## Key Files

The functionality of the `ipconfig-agent` is implemented across several key files:

- **[ipconfigActionHandler.ts](./src/ipconfigActionHandler.ts)**:

  - Contains the core logic for handling actions.
  - The `runCli` function executes the `ipconfig` command with the appropriate arguments, while the `buildArgs` function constructs the command-line arguments based on the action and its parameters.

- **[ipconfigManifest.json](./src/ipconfigManifest.json)**:

  - Defines the agent's metadata, including its description, emoji representation, and references to the schema and grammar files.

- **[ipconfigSchema.ts](./src/ipconfigSchema.ts)**:

  - Defines the TypeScript types for all supported actions, including their names, parameters, and descriptions.

- **[ipconfigSchema.agr](./src/ipconfigSchema.agr)**:

  - Contains the natural language grammar rules that map user utterances to specific actions. For example, phrases like "Show me the full network configuration details" are mapped to the `displayFullConfigurationInformation` action.

- **[tsconfig.json](./src/tsconfig.json)**:
  - Configures the TypeScript compiler for the project, specifying the root directory and output directory for compiled files.

## How to extend

To add new functionality to the `ipconfig-agent`, follow these steps:

1. **Define a new action**:

   - Add a new action type in [ipconfigSchema.ts](./src/ipconfigSchema.ts). Specify the action name, parameters, and a description of its purpose.

2. **Update the grammar**:

   - Add new grammar rules in [ipconfigSchema.agr](./src/ipconfigSchema.agr) to map user utterances to the new action. Ensure the grammar captures various ways users might phrase their requests.

3. **Implement the handler logic**:

   - Extend the `buildArgs` function in [ipconfigActionHandler.ts](./src/ipconfigActionHandler.ts) to handle the new action. Define the appropriate `ipconfig` command-line arguments and process the output as needed.

4. **Test the new action**:

   - Write unit tests to validate the new action's behavior. Ensure the agent correctly interprets user input and executes the desired `ipconfig` command.

5. **Update the manifest**:

   - If necessary, update [ipconfigManifest.json](./src/ipconfigManifest.json) to include the new action in the schema.

6. **Regenerate schema and grammar**:
   - Use the TypeAgent tools, such as `@typeagent/action-schema-compiler` and `@typeagent/action-grammar-compiler`, to regenerate the schema and grammar files.

By following these steps, you can extend the `ipconfig-agent` to support additional `ipconfig` commands or other related functionality. Be sure to test your changes thoroughly to ensure they work as expected.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/ipconfigManifest.json](./src/ipconfigManifest.json)
- `./agent/handlers` → `./dist/ipconfigActionHandler.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/action-grammar-compiler](../../../packages/actionGrammarCompiler/README.md)
- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)

External: _None at runtime._

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

`./src/ipconfigActionHandler.ts`, `./src/ipconfigManifest.json`, `./src/ipconfigSchema.agr`, …and 3 more under `./src/`.

### Agent surface

- Manifest: [./src/ipconfigManifest.json](./src/ipconfigManifest.json)
- Schema: [./src/ipconfigSchema.ts](./src/ipconfigSchema.ts)
- Grammar: [./src/ipconfigSchema.agr](./src/ipconfigSchema.agr)
- Handler: [./src/ipconfigActionHandler.ts](./src/ipconfigActionHandler.ts)

### Actions

_13 actions implemented by this agent, parsed deterministically from `./src/ipconfigSchema.ts`. Sample utterances and parameter shapes are illustrative; consult the schema for the full signature._

| User says                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Action                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| _User: "Can you show me the help message for ipconfig?" Agent: "Displaying the help message for ipconfig." User: "I need some help with ipconfig, please display the help message." Agent: "Displaying the help message for ipconfig." User: "What's the help message for ipconfig?" Agent: "Displaying the help message for ipconfig." Displays the help message for ipconfig._                                                                                                                                                                                                                    | `displayHelpMessage`                           |
| _User: "Show me the full network configuration details." Agent: "Displaying full network configuration details." User: "Can you display all the configuration information for my network?" Agent: "Displaying full network configuration details." User: "I need to see the complete IP configuration." Agent: "Displaying full network configuration details." Displays full configuration information._                                                                                                                                                                                           | `displayFullConfigurationInformation`          |
| _User: "Please release the IPv4 address for the Ethernet adapter." Agent: "Releasing the IPv4 address for the Ethernet adapter." User: "Can you release the IPv4 address on my Wi-Fi adapter?" Agent: "Releasing the IPv4 address for the Wi-Fi adapter." User: "Release the IPv4 address for the network adapter named 'Local Area Connection'." Agent: "Releasing the IPv4 address for the 'Local Area Connection' adapter." Releases the IPv4 address for the specified adapter._                                                                                                                | `releaseIPv4Address`                           |
| _User: "Please release the IPv6 address for the adapter named 'Ethernet'." Agent: "Releasing the IPv6 address for the 'Ethernet' adapter." User: "Can you release the IPv6 address on my Wi-Fi adapter?" Agent: "Releasing the IPv6 address for the Wi-Fi adapter." User: "I need to release the IPv6 address for the 'Local Area Connection' adapter." Agent: "Releasing the IPv6 address for the 'Local Area Connection' adapter." Releases the IPv6 address for the specified adapter._                                                                                                          | `releaseIPv6Address`                           |
| _User: "Can you renew the IPv4 address for the Ethernet adapter?" Agent: "Renewing the IPv4 address for the Ethernet adapter." User: "Please refresh the IPv4 address for my Wi-Fi adapter." Agent: "Renewing the IPv4 address for the Wi-Fi adapter." User: "Renew the IPv4 address for the network adapter named 'Local Area Connection'." Agent: "Renewing the IPv4 address for the 'Local Area Connection' adapter." Renews the IPv4 address for the specified adapter._                                                                                                                        | `renewIPv4Address`                             |
| _User: "Can you renew the IPv6 address for the adapter named 'Ethernet'?" Agent: "Renewing the IPv6 address for the 'Ethernet' adapter." User: "Please refresh the IPv6 address for my Wi-Fi adapter." Agent: "Renewing the IPv6 address for the Wi-Fi adapter." User: "Renew the IPv6 address for the 'Local Area Connection' adapter." Agent: "Renewing the IPv6 address for the 'Local Area Connection' adapter." Renews the IPv6 address for the specified adapter._                                                                                                                            | `renewIPv6Address`                             |
| _User: "Clear the DNS cache, please." Agent: "Purging the DNS resolver cache." User: "Can you purge the DNS resolver cache?" Agent: "Purging the DNS resolver cache." User: "I need to flush the DNS cache." Agent: "Purging the DNS resolver cache." Purges the DNS Resolver cache._                                                                                                                                                                                                                                                                                                               | `purgeDNSResolverCache`                        |
| _User: "Can you refresh the DHCP leases and re-register the DNS names for me?" Agent: "Refreshing all DHCP leases and re-registering DNS names." User: "Please update the DHCP leases and DNS registrations." Agent: "Refreshing all DHCP leases and re-registering DNS names." User: "I need to refresh all DHCP leases and re-register the DNS names." Agent: "Refreshing all DHCP leases and re-registering DNS names." Refreshes all DHCP leases and re-registers DNS names._                                                                                                                   | `refreshDHCPLeasesAndReRegisterDNSNames`       |
| _User: "Show me the DNS cache contents." Agent: "Displaying the contents of the DNS resolver cache." User: "Can you display the DNS resolver cache?" Agent: "Displaying the contents of the DNS resolver cache." User: "I'd like to see the DNS resolver cache details." Agent: "Displaying the contents of the DNS resolver cache." Displays the contents of the DNS Resolver Cache._                                                                                                                                                                                                              | `displayDNSResolverCacheContents`              |
| _User: "Can you show me the DHCP class IDs for the adapter?" Agent: "Displaying the DHCP class IDs for the adapter." User: "Please display the DHCP class IDs for the network adapter." Agent: "Displaying the DHCP class IDs for the network adapter." User: "I need to see the DHCP class IDs for my adapter." Agent: "Displaying the DHCP class IDs for the adapter." Displays all the DHCP class IDs allowed for the adapter._                                                                                                                                                                  | `displayDHCPClassIDs`                          |
| _User: "Can you change the DHCP class ID for the Ethernet adapter to 'newClassID'?" Agent: "Modifying the DHCP class ID for the Ethernet adapter to 'newClassID'." User: "Please update the DHCP class ID on the Wi-Fi adapter to 'newClassID'." Agent: "Modifying the DHCP class ID for the Wi-Fi adapter to 'newClassID'." User: "Set the DHCP class ID for the 'Local Area Connection' adapter to 'newClassID'." Agent: "Modifying the DHCP class ID for the 'Local Area Connection' adapter to 'newClassID'." Modifies the DHCP class ID._                                                      | `modifyDHCPClassID` → `{ "adapter": "…" }`     |
| _User: "Can you show me the IPv6 DHCP class IDs for the adapter?" Agent: "Displaying the IPv6 DHCP class IDs for the adapter." User: "Please display the IPv6 DHCP class IDs for the network adapter." Agent: "Displaying the IPv6 DHCP class IDs for the network adapter." User: "What are the IPv6 DHCP class IDs allowed for the adapter?" Agent: "Displaying the IPv6 DHCP class IDs for the adapter." Displays all the IPv6 DHCP class IDs allowed for the adapter._                                                                                                                           | `displayIPv6DHCPClassIDs`                      |
| _User: "Can you change the IPv6 DHCP class ID for the adapter named 'Ethernet' to 'newClassID'?" Agent: "Modifying the IPv6 DHCP class ID for the 'Ethernet' adapter to 'newClassID'." User: "Please update the IPv6 DHCP class ID for my Wi-Fi adapter to 'classID123'." Agent: "Modifying the IPv6 DHCP class ID for the Wi-Fi adapter to 'classID123'." User: "Set the IPv6 DHCP class ID to 'classID456' for the network adapter 'Local Area Connection'." Agent: "Modifying the IPv6 DHCP class ID for the 'Local Area Connection' adapter to 'classID456'." Modifies the IPv6 DHCP class ID._ | `modifyIPv6DHCPClassID` → `{ "adapter": "…" }` |

---

_Auto-generated against commit `44b34a9ac8794b6f90489ff7e55fe57283c34960` on `2026-07-11T08:34:41.338Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter ipconfig-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
