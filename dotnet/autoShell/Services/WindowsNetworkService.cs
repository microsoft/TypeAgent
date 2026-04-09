// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security;
using System.Text;
using autoShell.Logging;
using autoShell.Services.Interop;
using Newtonsoft.Json;

namespace autoShell.Services;

/// <summary>
/// Concrete implementation of <see cref="INetworkService"/> using Windows WLAN API and Radio Management COM API.
/// </summary>
internal class WindowsNetworkService : INetworkService
{
    #region COM / P/Invoke

    private static readonly Guid s_clsidRadioManagementApi = new Guid(0x581333f6, 0x28db, 0x41be, 0xbc, 0x7a, 0xff, 0x20, 0x1f, 0x12, 0xf3, 0xf6);

    [ComImport]
    [Guid("db3afbfb-08e6-46c6-aa70-bf9a34c30ab7")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IRadioManager
    {
        [PreserveSig]
        int IsRMSupported(out uint pdwState);

        [PreserveSig]
        int GetUIRadioInstances([MarshalAs(UnmanagedType.IUnknown)] out object ppCollection);

        [PreserveSig]
        int GetSystemRadioState(out int pbEnabled, out int param2, out int pChangeReason);

        [PreserveSig]
        int SetSystemRadioState(int bEnabled);

        [PreserveSig]
        int Refresh();

        [PreserveSig]
        int OnHardwareSliderChange(int param1, int param2);
    }

    [DllImport(NativeDlls.WlanApi)]
    private static extern int WlanOpenHandle(uint dwClientVersion, IntPtr pReserved, out uint pdwNegotiatedVersion, out IntPtr phClientHandle);

    [DllImport(NativeDlls.WlanApi)]
    private static extern int WlanCloseHandle(IntPtr hClientHandle, IntPtr pReserved);

    [DllImport(NativeDlls.WlanApi)]
    private static extern int WlanEnumInterfaces(IntPtr hClientHandle, IntPtr pReserved, out IntPtr ppInterfaceList);

    [DllImport(NativeDlls.WlanApi)]
    private static extern int WlanGetAvailableNetworkList(IntPtr hClientHandle, ref Guid pInterfaceGuid, uint dwFlags, IntPtr pReserved, out IntPtr ppAvailableNetworkList);

    [DllImport(NativeDlls.WlanApi)]
    private static extern int WlanScan(IntPtr hClientHandle, ref Guid pInterfaceGuid, IntPtr pDOT11_SSID, IntPtr pIeData, IntPtr pReserved);

    [DllImport(NativeDlls.WlanApi)]
    private static extern void WlanFreeMemory(IntPtr pMemory);

    [DllImport(NativeDlls.WlanApi)]
    private static extern int WlanConnect(IntPtr hClientHandle, ref Guid pInterfaceGuid, ref WLAN_CONNECTION_PARAMETERS pConnectionParameters, IntPtr pReserved);

    [DllImport(NativeDlls.WlanApi)]
    private static extern int WlanDisconnect(IntPtr hClientHandle, ref Guid pInterfaceGuid, IntPtr pReserved);

    [DllImport(NativeDlls.WlanApi)]
    private static extern int WlanSetProfile(IntPtr hClientHandle, ref Guid pInterfaceGuid, uint dwFlags, [MarshalAs(UnmanagedType.LPWStr)] string strProfileXml, [MarshalAs(UnmanagedType.LPWStr)] string strAllUserProfileSecurity, bool bOverwrite, IntPtr pReserved, out uint pdwReasonCode);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WLAN_INTERFACE_INFO
    {
        public Guid InterfaceGuid;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
        public string strInterfaceDescription;
        public int isState;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WLAN_INTERFACE_INFO_LIST
    {
        public uint dwNumberOfItems;
        public uint dwIndex;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 1)]
        public WLAN_INTERFACE_INFO[] InterfaceInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DOT11_SSID
    {
        public uint SSIDLength;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 32)]
        public byte[] SSID;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WLAN_AVAILABLE_NETWORK
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
        public string strProfileName;
        public DOT11_SSID dot11Ssid;
        public int dot11BssType;
        public uint uNumberOfBssids;
        public bool bNetworkConnectable;
        public uint wlanNotConnectableReason;
        public uint uNumberOfPhyTypes;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 8)]
        public int[] dot11PhyTypes;
        public bool bMorePhyTypes;
        public uint wlanSignalQuality;
        public bool bSecurityEnabled;
        public int dot11DefaultAuthAlgorithm;
        public int dot11DefaultCipherAlgorithm;
        public uint dwFlags;
        public uint dwReserved;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WLAN_AVAILABLE_NETWORK_LIST
    {
        public uint dwNumberOfItems;
        public uint dwIndex;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WLAN_CONNECTION_PARAMETERS
    {
        public WLAN_CONNECTION_MODE wlanConnectionMode;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string strProfile;
        public IntPtr pDOT11_SSID;
        public IntPtr pDesiredBssidList;
        public DOT11_BSS_TYPE dot11BssType;
        public uint dwFlags;
    }

    private enum WLAN_CONNECTION_MODE
    {
        wlan_connection_mode_profile = 0,
        wlan_connection_mode_temporary_profile = 1,
        wlan_connection_mode_discovery_secure = 2,
        wlan_connection_mode_discovery_unsecure = 3,
        wlan_connection_mode_auto = 4
    }

    private enum DOT11_BSS_TYPE
    {
        dot11_BSS_type_infrastructure = 1,
        dot11_BSS_type_independent = 2,
        dot11_BSS_type_any = 3
    }

    #endregion COM / P/Invoke

    private readonly ILogger _logger;

    public WindowsNetworkService(ILogger logger)
    {
        _logger = logger;
    }

    /// <inheritdoc/>
    public void ConnectToWifi(string ssid, string password)
    {
        IntPtr clientHandle = IntPtr.Zero;
        IntPtr wlanInterfaceList = IntPtr.Zero;

        try
        {
            int result = WlanOpenHandle(2, IntPtr.Zero, out uint negotiatedVersion, out clientHandle);
            if (result != 0)
            {
                _logger.Warning($"Failed to open WLAN handle: {result}");
                return;
            }

            result = WlanEnumInterfaces(clientHandle, IntPtr.Zero, out wlanInterfaceList);
            if (result != 0)
            {
                _logger.Warning($"Failed to enumerate WLAN interfaces: {result}");
                return;
            }

            WLAN_INTERFACE_INFO_LIST interfaceList = Marshal.PtrToStructure<WLAN_INTERFACE_INFO_LIST>(wlanInterfaceList);

            if (interfaceList.dwNumberOfItems == 0)
            {
                _logger.Warning("No wireless interfaces found.");
                return;
            }

            WLAN_INTERFACE_INFO interfaceInfo = interfaceList.InterfaceInfo[0];

            if (!string.IsNullOrEmpty(password))
            {
                string profileXml = GenerateWifiProfileXml(ssid, password);

                result = WlanSetProfile(clientHandle, ref interfaceInfo.InterfaceGuid, 0, profileXml, null, true, IntPtr.Zero, out uint reasonCode);
                if (result != 0)
                {
                    _logger.Warning($"Failed to set WiFi profile: {result}, reason: {reasonCode}");
                    return;
                }
            }

            WLAN_CONNECTION_PARAMETERS connectionParams = new WLAN_CONNECTION_PARAMETERS
            {
                wlanConnectionMode = WLAN_CONNECTION_MODE.wlan_connection_mode_profile,
                strProfile = ssid,
                pDOT11_SSID = IntPtr.Zero,
                pDesiredBssidList = IntPtr.Zero,
                dot11BssType = DOT11_BSS_TYPE.dot11_BSS_type_any,
                dwFlags = 0
            };

            result = WlanConnect(clientHandle, ref interfaceInfo.InterfaceGuid, ref connectionParams, IntPtr.Zero);
            if (result != 0)
            {
                _logger.Warning($"Failed to connect to WiFi network '{ssid}': {result}");
                return;
            }

            _logger.Info($"Connecting to WiFi network: {ssid}");
        }
        catch (Exception ex)
        {
            _logger.Error(ex);
        }
        finally
        {
            if (wlanInterfaceList != IntPtr.Zero)
            {
                WlanFreeMemory(wlanInterfaceList);
            }

            if (clientHandle != IntPtr.Zero)
            {
                _ = WlanCloseHandle(clientHandle, IntPtr.Zero);
            }
        }
    }

    /// <inheritdoc/>
    public void DisconnectFromWifi()
    {
        IntPtr clientHandle = IntPtr.Zero;
        IntPtr wlanInterfaceList = IntPtr.Zero;

        try
        {
            int result = WlanOpenHandle(2, IntPtr.Zero, out uint negotiatedVersion, out clientHandle);
            if (result != 0)
            {
                _logger.Warning($"Failed to open WLAN handle: {result}");
                return;
            }

            result = WlanEnumInterfaces(clientHandle, IntPtr.Zero, out wlanInterfaceList);
            if (result != 0)
            {
                _logger.Warning($"Failed to enumerate WLAN interfaces: {result}");
                return;
            }

            WLAN_INTERFACE_INFO_LIST interfaceList = Marshal.PtrToStructure<WLAN_INTERFACE_INFO_LIST>(wlanInterfaceList);

            if (interfaceList.dwNumberOfItems == 0)
            {
                _logger.Warning("No wireless interfaces found.");
                return;
            }

            for (int i = 0; i < interfaceList.dwNumberOfItems; i++)
            {
                WLAN_INTERFACE_INFO interfaceInfo = interfaceList.InterfaceInfo[i];

                result = WlanDisconnect(clientHandle, ref interfaceInfo.InterfaceGuid, IntPtr.Zero);
                if (result != 0)
                {
                    _logger.Warning($"Failed to disconnect from WiFi on interface {i}: {result}");
                }
                else
                {
                    _logger.Info("Disconnected from WiFi");
                }
            }
        }
        catch (Exception ex)
        {
            _logger.Error(ex);
        }
        finally
        {
            if (wlanInterfaceList != IntPtr.Zero)
            {
                WlanFreeMemory(wlanInterfaceList);
            }

            if (clientHandle != IntPtr.Zero)
            {
                _ = WlanCloseHandle(clientHandle, IntPtr.Zero);
            }
        }
    }

    /// <inheritdoc/>
    public string ListWifiNetworks()
    {
        IntPtr clientHandle = IntPtr.Zero;
        IntPtr wlanInterfaceList = IntPtr.Zero;
        IntPtr networkList = IntPtr.Zero;

        try
        {
            int result = WlanOpenHandle(2, IntPtr.Zero, out uint negotiatedVersion, out clientHandle);
            if (result != 0)
            {
                _logger.Debug($"Failed to open WLAN handle: {result}");
                return "[]";
            }

            result = WlanEnumInterfaces(clientHandle, IntPtr.Zero, out wlanInterfaceList);
            if (result != 0)
            {
                _logger.Debug($"Failed to enumerate WLAN interfaces: {result}");
                return "[]";
            }

            WLAN_INTERFACE_INFO_LIST interfaceList = Marshal.PtrToStructure<WLAN_INTERFACE_INFO_LIST>(wlanInterfaceList);

            if (interfaceList.dwNumberOfItems == 0)
            {
                return "[]";
            }

            var allNetworks = new List<object>();

            for (int i = 0; i < interfaceList.dwNumberOfItems; i++)
            {
                WLAN_INTERFACE_INFO interfaceInfo = interfaceList.InterfaceInfo[i];

                _ = WlanScan(clientHandle, ref interfaceInfo.InterfaceGuid, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);

                // Small delay to allow scan to complete
                System.Threading.Thread.Sleep(100);

                result = WlanGetAvailableNetworkList(clientHandle, ref interfaceInfo.InterfaceGuid, 0, IntPtr.Zero, out networkList);
                if (result != 0)
                {
                    _logger.Debug($"Failed to get network list: {result}");
                    continue;
                }

                WLAN_AVAILABLE_NETWORK_LIST availableNetworkList = Marshal.PtrToStructure<WLAN_AVAILABLE_NETWORK_LIST>(networkList);

                IntPtr networkPtr = networkList + 8; // Skip dwNumberOfItems and dwIndex

                for (int j = 0; j < availableNetworkList.dwNumberOfItems; j++)
                {
                    WLAN_AVAILABLE_NETWORK network = Marshal.PtrToStructure<WLAN_AVAILABLE_NETWORK>(networkPtr);

                    string ssid = Encoding.ASCII.GetString(network.dot11Ssid.SSID, 0, (int)network.dot11Ssid.SSIDLength);

                    if (!string.IsNullOrEmpty(ssid))
                    {
                        allNetworks.Add(new
                        {
                            SSID = ssid,
                            SignalQuality = network.wlanSignalQuality,
                            Secured = network.bSecurityEnabled,
                            Connected = (network.dwFlags & 1) != 0 // WLAN_AVAILABLE_NETWORK_CONNECTED
                        });
                    }

                    networkPtr += Marshal.SizeOf<WLAN_AVAILABLE_NETWORK>();
                }

                if (networkList != IntPtr.Zero)
                {
                    WlanFreeMemory(networkList);
                    networkList = IntPtr.Zero;
                }
            }

            var uniqueNetworks = allNetworks
                .GroupBy(n => ((dynamic)n).SSID)
                .Select(g => g.OrderByDescending(n => ((dynamic)n).SignalQuality).First())
                .OrderByDescending(n => ((dynamic)n).SignalQuality)
                .ToList();

            return JsonConvert.SerializeObject(uniqueNetworks);
        }
        catch (Exception ex)
        {
            _logger.Debug($"Error listing WiFi networks: {ex.Message}");
            return "[]";
        }
        finally
        {
            if (networkList != IntPtr.Zero)
            {
                WlanFreeMemory(networkList);
            }

            if (wlanInterfaceList != IntPtr.Zero)
            {
                WlanFreeMemory(wlanInterfaceList);
            }

            if (clientHandle != IntPtr.Zero)
            {
                _ = WlanCloseHandle(clientHandle, IntPtr.Zero);
            }
        }
    }

    /// <inheritdoc/>
    public void SetAirplaneMode(bool enable)
    {
        IRadioManager radioManager = null;
        try
        {
            Type radioManagerType = Type.GetTypeFromCLSID(s_clsidRadioManagementApi);
            if (radioManagerType == null)
            {
                _logger.Debug("Failed to get Radio Management API type");
                return;
            }

            object obj = Activator.CreateInstance(radioManagerType);
            radioManager = (IRadioManager)obj;

            if (radioManager == null)
            {
                _logger.Debug("Failed to create Radio Manager instance");
                return;
            }

            int hr = radioManager.GetSystemRadioState(out int currentState, out int _, out int _);
            if (hr < 0)
            {
                _logger.Debug($"Failed to get system radio state: HRESULT 0x{hr:X8}");
                return;
            }

            // currentState: 0 = airplane mode ON (radios off), 1 = airplane mode OFF (radios on)
            bool airplaneModeCurrentlyOn = currentState == 0;
            _logger.Debug($"Current airplane mode state: {(airplaneModeCurrentlyOn ? "on" : "off")}");

            // bEnabled: 0 = turn airplane mode ON (disable radios), 1 = turn airplane mode OFF (enable radios)
            int newState = enable ? 0 : 1;
            hr = radioManager.SetSystemRadioState(newState);
            if (hr < 0)
            {
                _logger.Debug($"Failed to set system radio state: HRESULT 0x{hr:X8}");
                return;
            }

            _logger.Debug($"Airplane mode set to: {(enable ? "on" : "off")}");
        }
        catch (COMException ex)
        {
            _logger.Debug($"COM Exception setting airplane mode: {ex.Message} (HRESULT: 0x{ex.HResult:X8})");
        }
        catch (Exception ex)
        {
            _logger.Debug($"Failed to set airplane mode: {ex.Message}");
        }
        finally
        {
            if (radioManager != null)
            {
                Marshal.ReleaseComObject(radioManager);
            }
        }
    }

    /// <inheritdoc/>
    public void EnableWifi(bool enable)
    {
        string command = enable ? "interface set interface \"Wi-Fi\" enabled" :
                                 "interface set interface \"Wi-Fi\" disabled";
        try
        {
            var psi = new System.Diagnostics.ProcessStartInfo
            {
                FileName = "netsh",
                Arguments = command,
                CreateNoWindow = true,
                UseShellExecute = false
            };
            System.Diagnostics.Process.Start(psi)?.WaitForExit();
            _logger.Debug($"WiFi set to: {(enable ? "enabled" : "disabled")}");
        }
        catch (Exception ex)
        {
            _logger.Debug($"Failed to set WiFi state: {ex.Message}");
        }
    }

    /// <inheritdoc/>
    /// <remarks>
    /// Uses the registry instead of the IRadioManager COM API because
    /// IRadioManager controls all radios. For Bluetooth-specific control,
    /// we'd need IRadioInstanceCollection, but the registry approach is more reliable.
    /// </remarks>
    public void ToggleBluetooth(bool enable)
    {
        try
        {
            using var key = Microsoft.Win32.Registry.LocalMachine.CreateSubKey(
                @"SYSTEM\CurrentControlSet\Services\BTHPORT\Parameters\Radio Support");
            key?.SetValue("SupportDLL", enable ? 1 : 0, Microsoft.Win32.RegistryValueKind.DWord);
            _logger.Debug($"Bluetooth set to: {(enable ? "on" : "off")}");
        }
        catch (Exception ex)
        {
            _logger.Debug($"Failed to toggle Bluetooth: {ex.Message}");
        }
    }

    /// <summary>
    /// Generates a WiFi profile XML for WPA2-Personal (PSK) networks.
    /// </summary>
    private static string GenerateWifiProfileXml(string ssid, string password)
    {
        string ssidHex = BitConverter.ToString(Encoding.UTF8.GetBytes(ssid)).Replace("-", "");
        string escapedSsid = SecurityElement.Escape(ssid);
        string escapedPassword = SecurityElement.Escape(password);

        return $@"<?xml version=""1.0""?>
<WLANProfile xmlns=""http://www.microsoft.com/networking/WLAN/profile/v1"">
    <name>{escapedSsid}</name>
    <SSIDConfig>
        <SSID>
            <hex>{ssidHex}</hex>
            <name>{escapedSsid}</name>
        </SSID>
    </SSIDConfig>
    <connectionType>ESS</connectionType>
    <connectionMode>auto</connectionMode>
    <MSM>
        <security>
            <authEncryption>
                <authentication>WPA2PSK</authentication>
                <encryption>AES</encryption>
                <useOneX>false</useOneX>
            </authEncryption>
            <sharedKey>
                <keyType>passPhrase</keyType>
                <protected>false</protected>
                <keyMaterial>{escapedPassword}</keyMaterial>
            </sharedKey>
        </security>
    </MSM>
</WLANProfile>";
    }
}
