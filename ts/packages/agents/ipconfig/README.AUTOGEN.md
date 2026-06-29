<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=ddccfbed4237537057208c308a6c7941c23d6170652afe9cf8711e8bdc49c111 -->
<!-- AUTOGEN:DOCS:SOURCE: (no hand-written ./README.md found at last regen) -->

# ipconfig-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `ipconfig-agent` package is a TypeAgent application agent designed to interact with the Windows IP configuration command-line tool, `ipconfig`. This agent allows users to perform various network configuration tasks through natural language commands, such as displaying network settings, releasing and renewing IP addresses, and managing DNS cache.

## What it does

The `ipconfig-agent` package supports a range of actions related to network configuration. These actions include:

- Displaying help messages (`displayHelpMessage`)
- Showing full network configuration details (`displayFullConfigurationInformation`)
- Releasing and renewing IPv4 and IPv6 addresses (`releaseIPv4Address`, `releaseIPv6Address`, `renewIPv4Address`, `renewIPv6Address`)
- Purging the DNS resolver cache (`purgeDNSResolverCache`)
- Refreshing DHCP leases and re-registering DNS names (`refreshDHCPLeasesAndReRegisterDNSNames`)
- Displaying the contents of the DNS resolver cache (`displayDNSResolverCacheContents`)
- Displaying and modifying DHCP class IDs for both IPv4 and IPv6 (`displayDHCPClassIDs`, `modifyDHCPClassID`, `displayIPv6DHCPClassIDs`, `modifyIPv6DHCPClassID`)

These actions enable users to manage their network settings efficiently using simple, conversational commands.

## Setup

The `ipconfig-agent` package does not require any special setup beyond installing the necessary dependencies. Ensure that you have `pnpm` installed and run the following command to install the dependencies:

```sh
pnpm install
```

No additional environment variables or external accounts are needed for this package.

## Key Files

The package's functionality is distributed across several key files:

- [ipconfigActionHandler.ts](./src/ipconfigActionHandler.ts): Contains the logic for handling the various `ipconfig` actions. It uses the `execFile` function to run `ipconfig` commands and processes the results.
- [ipconfigManifest.json](./src/ipconfigManifest.json): Defines the agent's manifest, including its description, emoji character, and schema details.
- [ipconfigSchema.ts](./src/ipconfigSchema.ts): Defines the types for the various actions supported by the agent.
- [ipconfigSchema.agr](./src/ipconfigSchema.agr): Contains the grammar definitions for mapping natural language commands to specific actions.

## How to extend

To extend the `ipconfig-agent` package, follow these steps:

1. **Add a new action**: Define the new action type in [ipconfigSchema.ts](./src/ipconfigSchema.ts). Ensure it includes the necessary parameters and a description.
2. **Update the grammar**: Add the corresponding grammar rules in [ipconfigSchema.agr](./src/ipconfigSchema.agr) to map user utterances to the new action.
3. **Implement the handler**: Modify [ipconfigActionHandler.ts](./src/ipconfigActionHandler.ts) to include the logic for handling the new action. Use the `runCli` function to execute the appropriate `ipconfig` command.
4. **Test the new action**: Write tests to verify the new action's functionality. Ensure that the agent correctly interprets user commands and performs the expected operations.

By following these steps, you can add new capabilities to the `ipconfig-agent` package and enhance its functionality.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/ipconfigManifest.json](./src/ipconfigManifest.json)
- `./agent/handlers` → [./dist/ipconfigActionHandler.js](./dist/ipconfigActionHandler.js)

### Dependencies

Workspace:

- [@typeagent/action-grammar-compiler](../../../packages/actionGrammarCompiler/README.md)
- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)

External: _None at runtime._

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

`./src/ipconfigActionHandler.ts`, `./src/ipconfigManifest.json`, `./src/ipconfigSchema.agr`, …and 2 more under `./src/`.

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

_Auto-generated against commit `127a36a95a15e918be533d6eaaf08adebe9070d9` on `2026-06-26T03:01:52.873Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter ipconfig-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
