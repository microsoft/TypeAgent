// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type IpconfigActions =
  | DisplayHelpMessageAction
  | DisplayFullConfigurationInformationAction
  | ReleaseIPv4AddressAction
  | ReleaseIPv6AddressAction
  | RenewIPv4AddressAction
  | RenewIPv6AddressAction
  | PurgeDNSResolverCacheAction
  | RefreshDHCPLeasesAndReRegisterDNSNamesAction
  | DisplayDNSResolverCacheContentsAction
  | DisplayDHCPClassIDsAction
  | ModifyDHCPClassIDAction
  | DisplayIPv6DHCPClassIDsAction
  | ModifyIPv6DHCPClassIDAction;

// User: "Can you show me the help message for ipconfig?"
// Agent: "Displaying the help message for ipconfig."
// User: "I need some help with ipconfig, please display the help message."
// Agent: "Displaying the help message for ipconfig."
// User: "What's the help message for ipconfig?"
// Agent: "Displaying the help message for ipconfig."
// Displays the help message for ipconfig.
export type DisplayHelpMessageAction = {
  actionName: "displayHelpMessage";
  parameters: {};
};

// User: "Show me the full network configuration details."
// Agent: "Displaying full network configuration details."
// User: "Can you display all the configuration information for my network?"
// Agent: "Displaying full network configuration details."
// User: "I need to see the complete IP configuration."
// Agent: "Displaying full network configuration details."
// Displays full configuration information.
export type DisplayFullConfigurationInformationAction = {
  actionName: "displayFullConfigurationInformation";
  parameters: {};
};

// User: "Please release the IPv4 address for the Ethernet adapter."
// Agent: "Releasing the IPv4 address for the Ethernet adapter."
// User: "Can you release the IPv4 address on my Wi-Fi adapter?"
// Agent: "Releasing the IPv4 address for the Wi-Fi adapter."
// User: "Release the IPv4 address for the network adapter named 'Local Area Connection'."
// Agent: "Releasing the IPv4 address for the 'Local Area Connection' adapter."
// Releases the IPv4 address for the specified adapter.
export type ReleaseIPv4AddressAction = {
  actionName: "releaseIPv4Address";
  parameters: {
    // The name of the network adapter.
    adapter?: string;
  };
};

// User: "Please release the IPv6 address for the adapter named 'Ethernet'."
// Agent: "Releasing the IPv6 address for the 'Ethernet' adapter."
// User: "Can you release the IPv6 address on my Wi-Fi adapter?"
// Agent: "Releasing the IPv6 address for the Wi-Fi adapter."
// User: "I need to release the IPv6 address for the 'Local Area Connection' adapter."
// Agent: "Releasing the IPv6 address for the 'Local Area Connection' adapter."
// Releases the IPv6 address for the specified adapter.
export type ReleaseIPv6AddressAction = {
  actionName: "releaseIPv6Address";
  parameters: {
    // The name of the network adapter.
    adapter?: string;
  };
};

// User: "Can you renew the IPv4 address for the Ethernet adapter?"
// Agent: "Renewing the IPv4 address for the Ethernet adapter."
// User: "Please refresh the IPv4 address for my Wi-Fi adapter."
// Agent: "Renewing the IPv4 address for the Wi-Fi adapter."
// User: "Renew the IPv4 address for the network adapter named 'Local Area Connection'."
// Agent: "Renewing the IPv4 address for the 'Local Area Connection' adapter."
// Renews the IPv4 address for the specified adapter.
export type RenewIPv4AddressAction = {
  actionName: "renewIPv4Address";
  parameters: {
    // The name of the network adapter.
    adapter?: string;
  };
};

// User: "Can you renew the IPv6 address for the adapter named 'Ethernet'?"
// Agent: "Renewing the IPv6 address for the 'Ethernet' adapter."
// User: "Please refresh the IPv6 address for my Wi-Fi adapter."
// Agent: "Renewing the IPv6 address for the Wi-Fi adapter."
// User: "Renew the IPv6 address for the 'Local Area Connection' adapter."
// Agent: "Renewing the IPv6 address for the 'Local Area Connection' adapter."
// Renews the IPv6 address for the specified adapter.
export type RenewIPv6AddressAction = {
  actionName: "renewIPv6Address";
  parameters: {
    // The name of the network adapter.
    adapter?: string;
  };
};

// User: "Clear the DNS cache, please."
// Agent: "Purging the DNS resolver cache."
// User: "Can you purge the DNS resolver cache?"
// Agent: "Purging the DNS resolver cache."
// User: "I need to flush the DNS cache."
// Agent: "Purging the DNS resolver cache."
// Purges the DNS Resolver cache.
export type PurgeDNSResolverCacheAction = {
  actionName: "purgeDNSResolverCache";
  parameters: {};
};

// User: "Can you refresh the DHCP leases and re-register the DNS names for me?"
// Agent: "Refreshing all DHCP leases and re-registering DNS names."
// User: "Please update the DHCP leases and DNS registrations."
// Agent: "Refreshing all DHCP leases and re-registering DNS names."
// User: "I need to refresh all DHCP leases and re-register the DNS names."
// Agent: "Refreshing all DHCP leases and re-registering DNS names."
// Refreshes all DHCP leases and re-registers DNS names.
export type RefreshDHCPLeasesAndReRegisterDNSNamesAction = {
  actionName: "refreshDHCPLeasesAndReRegisterDNSNames";
  parameters: {};
};

// User: "Show me the DNS cache contents."
// Agent: "Displaying the contents of the DNS resolver cache."
// User: "Can you display the DNS resolver cache?"
// Agent: "Displaying the contents of the DNS resolver cache."
// User: "I'd like to see the DNS resolver cache details."
// Agent: "Displaying the contents of the DNS resolver cache."
// Displays the contents of the DNS Resolver Cache.
export type DisplayDNSResolverCacheContentsAction = {
  actionName: "displayDNSResolverCacheContents";
  parameters: {};
};

// User: "Can you show me the DHCP class IDs for the adapter?"
// Agent: "Displaying the DHCP class IDs for the adapter."
// User: "Please display the DHCP class IDs for the network adapter."
// Agent: "Displaying the DHCP class IDs for the network adapter."
// User: "I need to see the DHCP class IDs for my adapter."
// Agent: "Displaying the DHCP class IDs for the adapter."
// Displays all the DHCP class IDs allowed for the adapter.
export type DisplayDHCPClassIDsAction = {
  actionName: "displayDHCPClassIDs";
  parameters: {};
};

// User: "Can you change the DHCP class ID for the Ethernet adapter to 'newClassID'?"
// Agent: "Modifying the DHCP class ID for the Ethernet adapter to 'newClassID'."
// User: "Please update the DHCP class ID on the Wi-Fi adapter to 'newClassID'."
// Agent: "Modifying the DHCP class ID for the Wi-Fi adapter to 'newClassID'."
// User: "Set the DHCP class ID for the 'Local Area Connection' adapter to 'newClassID'."
// Agent: "Modifying the DHCP class ID for the 'Local Area Connection' adapter to 'newClassID'."
// Modifies the DHCP class ID.
export type ModifyDHCPClassIDAction = {
  actionName: "modifyDHCPClassID";
  parameters: {
    // The name of the network adapter.
    adapter: string;
    // The new DHCP class ID.
    classID?: string;
  };
};

// User: "Can you show me the IPv6 DHCP class IDs for the adapter?"
// Agent: "Displaying the IPv6 DHCP class IDs for the adapter."
// User: "Please display the IPv6 DHCP class IDs for the network adapter."
// Agent: "Displaying the IPv6 DHCP class IDs for the network adapter."
// User: "What are the IPv6 DHCP class IDs allowed for the adapter?"
// Agent: "Displaying the IPv6 DHCP class IDs for the adapter."
// Displays all the IPv6 DHCP class IDs allowed for the adapter.
export type DisplayIPv6DHCPClassIDsAction = {
  actionName: "displayIPv6DHCPClassIDs";
  parameters: {};
};

// User: "Can you change the IPv6 DHCP class ID for the adapter named 'Ethernet' to 'newClassID'?"
// Agent: "Modifying the IPv6 DHCP class ID for the 'Ethernet' adapter to 'newClassID'."
// User: "Please update the IPv6 DHCP class ID for my Wi-Fi adapter to 'classID123'."
// Agent: "Modifying the IPv6 DHCP class ID for the Wi-Fi adapter to 'classID123'."
// User: "Set the IPv6 DHCP class ID to 'classID456' for the network adapter 'Local Area Connection'."
// Agent: "Modifying the IPv6 DHCP class ID for the 'Local Area Connection' adapter to 'classID456'."
// Modifies the IPv6 DHCP class ID.
export type ModifyIPv6DHCPClassIDAction = {
  actionName: "modifyIPv6DHCPClassID";
  parameters: {
    // The name of the network adapter.
    adapter: string;
    // The new IPv6 DHCP class ID.
    classID?: string;
  };
};