<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=abe08dc25887cf6e97e9ba932ed8fe636200fe6ed1ae075170307d8caa3d126e -->
<!-- AUTOGEN:DOCS:SOURCE: (no hand-written ./README.md found at last regen) -->

# ipconfig-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `ipconfig-agent` package is a TypeAgent application agent that provides a natural language interface to the Windows `ipconfig` command-line tool. It enables users to perform various network configuration tasks, such as managing IP addresses, DNS settings, and DHCP configurations, through conversational commands.

This agent is particularly useful for automating common network management tasks, making it easier for users to interact with the `ipconfig` tool without needing to remember specific command-line syntax.

## What it does

The `ipconfig-agent` supports a comprehensive set of actions for managing network configurations. These actions are grouped into the following categories:

- **Help and Information Display**:

  - `displayHelpMessage`: Displays the help message for the `ipconfig` command.
  - `displayFullConfigurationInformation`: Shows detailed network configuration information.
  - `displayDNSResolverCacheContents`: Displays the contents of the DNS resolver cache.
  - `displayDHCPClassIDs`: Lists all DHCP class IDs for a specified adapter.
  - `displayIPv6DHCPClassIDs`: Lists all IPv6 DHCP class IDs for a specified adapter.

- **IP Address Management**:

  - `releaseIPv4Address`: Releases the IPv4 address for a specified adapter.
  - `releaseIPv6Address`: Releases the IPv6 address for a specified adapter.
  - `renewIPv4Address`: Renews the IPv4 address for a specified adapter.
  - `renewIPv6Address`: Renews the IPv6 address for a specified adapter.

- **DNS and DHCP Management**:
  - `purgeDNSResolverCache`: Clears the DNS resolver cache.
  - `refreshDHCPLeasesAndReRegisterDNSNames`: Refreshes all DHCP leases and re-registers DNS names.
  - `modifyDHCPClassID`: Updates the DHCP class ID for a specified adapter.
  - `modifyIPv6DHCPClassID`: Updates the IPv6 DHCP class ID for a specified adapter.

These actions allow users to manage their network settings effectively, whether they need to troubleshoot connectivity issues, update IP configurations, or manage DNS and DHCP settings.

## Setup

The `ipconfig-agent` package requires minimal setup. Follow these steps to get started:

1. Ensure you have `pnpm` installed on your system.
2. Navigate to the package directory:
   ```sh
   cd ts/packages/agents/ipconfig/
   ```
3. Install the required dependencies:
   ```sh
   pnpm install
   ```

No additional environment variables, API keys, or external accounts are required for this package.

## Key Files

The `ipconfig-agent` package is organized into several key files that define its functionality:

- **[ipconfigActionHandler.ts](./src/ipconfigActionHandler.ts)**: This file contains the core logic for handling the supported actions. It uses the `execFile` function to execute `ipconfig` commands and processes the output to generate responses.
- **[ipconfigManifest.json](./src/ipconfigManifest.json)**: The manifest file defines the agent's metadata, including its description, emoji representation, and references to the schema and grammar files.
- **[ipconfigSchema.ts](./src/ipconfigSchema.ts)**: This file defines the TypeScript types for the actions supported by the agent, including their names and parameters.
- **[ipconfigSchema.agr](./src/ipconfigSchema.agr)**: Contains the natural language grammar rules that map user utterances to specific actions.
- **[ipconfigSchema.keywords.json](./src/ipconfigSchema.keywords.json)**: Provides a list of keywords associated with each action, which helps in natural language understanding.

These files work together to enable the agent to interpret user commands, execute the corresponding `ipconfig` operations, and return meaningful responses.

## How to extend

To add new features or modify existing functionality in the `ipconfig-agent`, follow these steps:

1. **Define a new action**:

   - Add a new action type in [ipconfigSchema.ts](./src/ipconfigSchema.ts). Include a descriptive name, parameters (if any), and a brief description of the action.

2. **Update the grammar**:

   - Add new grammar rules in [ipconfigSchema.agr](./src/ipconfigSchema.agr) to map user utterances to the new action. Use the existing grammar rules as a reference for syntax and structure.

3. **Implement the action handler**:

   - Extend the logic in [ipconfigActionHandler.ts](./src/ipconfigActionHandler.ts) to handle the new action. Use the `runCli` function to execute the appropriate `ipconfig` command and process the output.

4. **Test the new functionality**:

   - Write unit tests to ensure the new action works as expected. Verify that the agent correctly interprets user commands and performs the desired operation.

5. **Update the manifest**:

   - If necessary, update [ipconfigManifest.json](./src/ipconfigManifest.json) to include the new action in the agent's schema.

6. **Regenerate the grammar and schema**:
   - Use the appropriate TypeAgent tools to regenerate the compiled grammar and schema files. Ensure these files are up-to-date with your changes.

By following these steps, you can extend the `ipconfig-agent` to support additional `ipconfig` commands or other related functionalities.

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

_Auto-generated against commit `656444843518fd1f9bb1b157b6dbf6dcbcde3999` on `2026-07-09T09:05:44.186Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter ipconfig-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
