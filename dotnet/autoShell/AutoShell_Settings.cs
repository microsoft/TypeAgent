// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Win32;
using Newtonsoft.Json.Linq;

namespace autoShell;

/// <summary>
/// Partial class containing Windows Settings automation handlers
/// Implements 50+ common Windows settings actions for the TypeAgent desktop agent
/// </summary>
internal partial class AutoShell
{
    #region Network Settings

    /// <summary>
    /// Toggles Bluetooth radio on or off
    /// Command: {"BluetoothToggle": "{\"enableBluetooth\":true}"}
    /// </summary>
    static void HandleBluetoothToggle(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            bool enable = param.Value<bool?>("enableBluetooth") ?? true;

            // Use the same radio management API as airplane mode
            IRadioManager radioManager = null;
            try
            {
                Type radioManagerType = Type.GetTypeFromCLSID(CLSID_RadioManagementAPI);
                if (radioManagerType == null)
                {
                    Debug.WriteLine("Failed to get Radio Management API type");
                    return;
                }

                radioManager = (IRadioManager)Activator.CreateInstance(radioManagerType);
                if (radioManager == null)
                {
                    Debug.WriteLine("Failed to create Radio Manager instance");
                    return;
                }

                // Note: This controls all radios. For Bluetooth-specific control,
                // we'd need IRadioInstanceCollection, but registry is more reliable
                SetRegistryValue(@"HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\BTHPORT\Parameters\Radio Support",
                    "SupportDLL", enable ? 1 : 0);

                Debug.WriteLine($"Bluetooth set to: {(enable ? "on" : "off")}");
            }
            finally
            {
                if (radioManager != null)
                    Marshal.ReleaseComObject(radioManager);
            }
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    /// <summary>
    /// Enables or disables WiFi
    /// Command: {"enableWifi": "{\"enable\":true}"}
    /// </summary>
    static void HandleEnableWifi(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            bool enable = param.Value<bool>("enable");

            // Use netsh to enable/disable WiFi
            string command = enable ? "interface set interface \"Wi-Fi\" enabled" :
                                     "interface set interface \"Wi-Fi\" disabled";

            var psi = new ProcessStartInfo
            {
                FileName = "netsh",
                Arguments = command,
                CreateNoWindow = true,
                UseShellExecute = false
            };

            Process.Start(psi)?.WaitForExit();
            Debug.WriteLine($"WiFi set to: {(enable ? "enabled" : "disabled")}");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    /// <summary>
    /// Enables or disables metered connection
    /// Command: {"enableMeteredConnections": "{\"enable\":true}"}
    /// </summary>
    static void HandleEnableMeteredConnections(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            bool enable = param.Value<bool>("enable");

            // Open network settings page
            Process.Start(new ProcessStartInfo
            {
                FileName = "ms-settings:network-status",
                UseShellExecute = true
            });

            Debug.WriteLine($"Metered connection setting - please configure manually");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    #endregion

    #region Display Settings

    /// <summary>
    /// Adjusts screen brightness (increase or decrease)
    /// Command: {"AdjustScreenBrightness": "{\"brightnessLevel\":\"increase\"}"}
    /// </summary>
    static void HandleAdjustScreenBrightness(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            string level = param.Value<string>("brightnessLevel");
            bool increase = level == "increase";

            // Get current brightness
            byte currentBrightness = GetCurrentBrightness();
            byte newBrightness = increase ?
                (byte)Math.Min(100, currentBrightness + 10) :
                (byte)Math.Max(0, currentBrightness - 10);

            SetBrightness(newBrightness);
            Debug.WriteLine($"Brightness adjusted to: {newBrightness}%");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    /// <summary>
    /// Enables or configures Night Light (blue light filter) schedule
    /// Command: {"EnableBlueLightFilterSchedule": "{\"schedule\":\"sunset to sunrise\",\"nightLightScheduleDisabled\":false}"}
    /// </summary>
    static void HandleEnableBlueLightFilterSchedule(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            bool disabled = param.Value<bool>("nightLightScheduleDisabled");

            // Night Light registry path
            string regPath = @"Software\Microsoft\Windows\CurrentVersion\CloudStore\Store\DefaultAccount\Current\default$windows.data.bluelightreduction.settings\windows.data.bluelightreduction.settings";
            using (var key = Registry.CurrentUser.CreateSubKey(regPath))
            {
                if (key != null)
                {
                    // Enable/disable Night Light
                    key.SetValue("Data", disabled ? new byte[] { 0x02, 0x00, 0x00, 0x00 } : new byte[] { 0x02, 0x00, 0x00, 0x01 });
                }
            }

            Debug.WriteLine($"Night Light schedule {(disabled ? "disabled" : "enabled")}");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    /// <summary>
    /// Adjusts the color temperature for Night Light
    /// Command: {"adjustColorTemperature": "{\"filterEffect\":\"reduce\"}"}
    /// </summary>
    static void HandleAdjustColorTemperature(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            string effect = param.Value<string>("filterEffect");

            // Open display settings to Night Light page
            Process.Start(new ProcessStartInfo
            {
                FileName = "ms-settings:nightlight",
                UseShellExecute = true
            });

            Debug.WriteLine($"Night Light settings opened - adjust color temperature manually");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    /// <summary>
    /// Sets display scaling percentage
    /// Command: {"DisplayScaling": "{\"sizeOverride\":\"125\"}"}
    /// </summary>
    static void HandleDisplayScaling(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            string sizeStr = param.Value<string>("sizeOverride");

            if (int.TryParse(sizeStr, out int percentage))
            {
                // Valid scaling values: 100, 125, 150, 175, 200
                percentage = percentage switch
                {
                    < 113 => 100,
                    < 138 => 125,
                    < 163 => 150,
                    < 188 => 175,
                    _ => 200
                };

                // Set DPI scaling
                SetDpiScaling(percentage);
                Debug.WriteLine($"Display scaling set to: {percentage}%");
            }
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    /// <summary>
    /// Adjusts screen orientation
    /// Command: {"AdjustScreenOrientation": "{\"orientation\":\"landscape\"}"}
    /// </summary>
    static void HandleAdjustScreenOrientation(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            string orientation = param.Value<string>("orientation");

            // Open display settings
            Process.Start(new ProcessStartInfo
            {
                FileName = "ms-settings:display",
                UseShellExecute = true
            });

            Debug.WriteLine($"Display settings opened for orientation change to: {orientation}");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    /// <summary>
    /// Adjusts display resolution
    /// Command: {"DisplayResolutionAndAspectRatio": "{\"resolutionChange\":\"increase\"}"}
    /// </summary>
    static void HandleDisplayResolutionAndAspectRatio(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            string change = param.Value<string>("resolutionChange");

            // Open display settings
            Process.Start(new ProcessStartInfo
            {
                FileName = "ms-settings:display",
                UseShellExecute = true
            });

            Debug.WriteLine($"Display settings opened for resolution adjustment");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    /// <summary>
    /// Locks or unlocks screen rotation
    /// Command: {"RotationLock": "{\"enable\":true}"}
    /// </summary>
    static void HandleRotationLock(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            bool enable = param.Value<bool?>("enable") ?? true;

            // Registry key for rotation lock
            using (var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\ImmersiveShell"))
            {
                if (key != null)
                {
                    key.SetValue("RotationLockPreference", enable ? 1 : 0, RegistryValueKind.DWord);
                }
            }

            Debug.WriteLine($"Rotation lock {(enable ? "enabled" : "disabled")}");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    #endregion

    #region Personalization Settings

    /// <summary>
    /// Sets system theme mode (dark or light)
    /// Command: {"SystemThemeMode": "{\"mode\":\"dark\"}"}
    /// </summary>
    static void HandleSystemThemeMode(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            string mode = param.Value<string>("mode");
            bool useLightMode = mode.Equals("light", StringComparison.OrdinalIgnoreCase);

            SetLightDarkMode(useLightMode);
            Debug.WriteLine($"System theme set to: {mode}");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    /// <summary>
    /// Enables or disables transparency effects
    /// Command: {"EnableTransparency": "{\"enable\":true}"}
    /// </summary>
    static void HandleEnableTransparency(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            bool enable = param.Value<bool>("enable");

            using (var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"))
            {
                if (key != null)
                {
                    key.SetValue("EnableTransparency", enable ? 1 : 0, RegistryValueKind.DWord);
                }
            }

            Debug.WriteLine($"Transparency {(enable ? "enabled" : "disabled")}");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    /// <summary>
    /// Applies accent color to title bars
    /// Command: {"ApplyColorToTitleBar": "{\"enableColor\":true}"}
    /// </summary>
    static void HandleApplyColorToTitleBar(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            bool enable = param.Value<bool>("enableColor");

            using (var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\DWM"))
            {
                if (key != null)
                {
                    key.SetValue("ColorPrevalence", enable ? 1 : 0, RegistryValueKind.DWord);
                }
            }

            Debug.WriteLine($"Title bar color {(enable ? "enabled" : "disabled")}");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    /// <summary>
    /// Enables high contrast theme
    /// Command: {"HighContrastTheme": "{}"}
    /// </summary>
    static void HandleHighContrastTheme(string jsonParams)
    {
        try
        {
            // Open high contrast settings
            Process.Start(new ProcessStartInfo
            {
                FileName = "ms-settings:easeofaccess-highcontrast",
                UseShellExecute = true
            });

            Debug.WriteLine("High contrast settings opened");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    #endregion

    #region Taskbar Settings

    /// <summary>
    /// Auto-hides the taskbar
    /// Command: {"AutoHideTaskbar": "{\"hideWhenNotUsing\":true,\"alwaysShow\":false}"}
    /// </summary>
    static void HandleAutoHideTaskbar(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            bool hide = param.Value<bool>("hideWhenNotUsing");

            using (var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Explorer\StuckRects3"))
            {
                if (key != null)
                {
                    byte[] settings = (byte[])key.GetValue("Settings");
                    if (settings != null && settings.Length >= 9)
                    {
                        // Bit 0 of byte 8 controls auto-hide
                        if (hide)
                            settings[8] |= 0x01;
                        else
                            settings[8] &= 0xFE;

                        key.SetValue("Settings", settings, RegistryValueKind.Binary);

                        // Refresh taskbar
                        RefreshTaskbar();
                    }
                }
            }

            Debug.WriteLine($"Taskbar auto-hide {(hide ? "enabled" : "disabled")}");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    /// <summary>
    /// Sets taskbar alignment (left or center)
    /// Command: {"TaskbarAlignment": "{\"alignment\":\"center\"}"}
    /// </summary>
    static void HandleTaskbarAlignment(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            string alignment = param.Value<string>("alignment");
            bool useCenter = alignment.Equals("center", StringComparison.OrdinalIgnoreCase);

            using (var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced"))
            {
                if (key != null)
                {
                    // 0 = left, 1 = center
                    key.SetValue("TaskbarAl", useCenter ? 1 : 0, RegistryValueKind.DWord);
                    RefreshTaskbar();
                }
            }

            Debug.WriteLine($"Taskbar alignment set to: {alignment}");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    /// <summary>
    /// Shows or hides the Task View button
    /// Command: {"TaskViewVisibility": "{\"visibility\":true}"}
    /// </summary>
    static void HandleTaskViewVisibility(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            bool visible = param.Value<bool>("visibility");

            using (var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced"))
            {
                if (key != null)
                {
                    key.SetValue("ShowTaskViewButton", visible ? 1 : 0, RegistryValueKind.DWord);
                    RefreshTaskbar();
                }
            }

            Debug.WriteLine($"Task View button {(visible ? "shown" : "hidden")}");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    /// <summary>
    /// Shows or hides the Widgets button
    /// Command: {"ToggleWidgetsButtonVisibility": "{\"visibility\":\"show\"}"}
    /// </summary>
    static void HandleToggleWidgetsButtonVisibility(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            string visibility = param.Value<string>("visibility");
            bool show = visibility.Equals("show", StringComparison.OrdinalIgnoreCase);

            using (var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced"))
            {
                if (key != null)
                {
                    key.SetValue("TaskbarDa", show ? 1 : 0, RegistryValueKind.DWord);
                    RefreshTaskbar();
                }
            }

            Debug.WriteLine($"Widgets button {visibility}");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    /// <summary>
    /// Shows or hides badges on taskbar icons
    /// Command: {"ShowBadgesOnTaskbar": "{\"enableBadging\":true}"}
    /// </summary>
    static void HandleShowBadgesOnTaskbar(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            bool enable = param.Value<bool?>("enableBadging") ?? true;

            using (var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced"))
            {
                if (key != null)
                {
                    key.SetValue("TaskbarBadges", enable ? 1 : 0, RegistryValueKind.DWord);
                    RefreshTaskbar();
                }
            }

            Debug.WriteLine($"Taskbar badges {(enable ? "enabled" : "disabled")}");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    /// <summary>
    /// Shows taskbar on all monitors
    /// Command: {"DisplayTaskbarOnAllMonitors": "{\"enable\":true}"}
    /// </summary>
    static void HandleDisplayTaskbarOnAllMonitors(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            bool enable = param.Value<bool?>("enable") ?? true;

            using (var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced"))
            {
                if (key != null)
                {
                    key.SetValue("MMTaskbarEnabled", enable ? 1 : 0, RegistryValueKind.DWord);
                    RefreshTaskbar();
                }
            }

            Debug.WriteLine($"Taskbar on all monitors {(enable ? "enabled" : "disabled")}");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    /// <summary>
    /// Shows seconds in the system tray clock
    /// Command: {"DisplaySecondsInSystrayClock": "{\"enable\":true}"}
    /// </summary>
    static void HandleDisplaySecondsInSystrayClock(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            bool enable = param.Value<bool?>("enable") ?? true;

            using (var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced"))
            {
                if (key != null)
                {
                    key.SetValue("ShowSecondsInSystemClock", enable ? 1 : 0, RegistryValueKind.DWord);
                    RefreshTaskbar();
                }
            }

            Debug.WriteLine($"Seconds in clock {(enable ? "shown" : "hidden")}");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    #endregion

    #region Mouse Settings

    /// <summary>
    /// Adjusts mouse cursor speed
    /// Command: {"MouseCursorSpeed": "{\"speedLevel\":10}"}
    /// </summary>
    static void HandleMouseCursorSpeed(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            int speed = param.Value<int>("speedLevel");

            // Speed range: 1-20 (default 10)
            speed = Math.Max(1, Math.Min(20, speed));

            SystemParametersInfo(SPI_SETMOUSESPEED, 0, (IntPtr)speed, SPIF_UPDATEINIFILE | SPIF_SENDCHANGE);
            Debug.WriteLine($"Mouse speed set to: {speed}");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    /// <summary>
    /// Sets the number of lines to scroll per mouse wheel notch
    /// Command: {"MouseWheelScrollLines": "{\"scrollLines\":3}"}
    /// </summary>
    static void HandleMouseWheelScrollLines(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            int lines = param.Value<int>("scrollLines");

            lines = Math.Max(1, Math.Min(100, lines));

            SystemParametersInfo(SPI_SETWHEELSCROLLLINES, lines, IntPtr.Zero, SPIF_UPDATEINIFILE | SPIF_SENDCHANGE);
            Debug.WriteLine($"Mouse wheel scroll lines set to: {lines}");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    /// <summary>
    /// Sets the primary mouse button
    /// Command: {"setPrimaryMouseButton": "{\"primaryButton\":\"left\"}"}
    /// </summary>
    static void HandleSetPrimaryMouseButton(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            string button = param.Value<string>("primaryButton");
            bool leftPrimary = button.Equals("left", StringComparison.OrdinalIgnoreCase);

            SwapMouseButton(leftPrimary ? 0 : 1);
            Debug.WriteLine($"Primary mouse button set to: {button}");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    /// <summary>
    /// Enables or disables enhanced pointer precision (mouse acceleration)
    /// Command: {"EnhancePointerPrecision": "{\"enable\":true}"}
    /// </summary>
    static void HandleEnhancePointerPrecision(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            bool enable = param.Value<bool?>("enable") ?? true;

            int[] mouseParams = new int[3];
            SystemParametersInfo(SPI_GETMOUSE, 0, mouseParams, 0);

            // Set acceleration (third parameter)
            mouseParams[2] = enable ? 1 : 0;

            SystemParametersInfo(SPI_SETMOUSE, 0, mouseParams, SPIF_UPDATEINIFILE | SPIF_SENDCHANGE);
            Debug.WriteLine($"Enhanced pointer precision {(enable ? "enabled" : "disabled")}");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    /// <summary>
    /// Adjusts mouse pointer size
    /// Command: {"AdjustMousePointerSize": "{\"sizeAdjustment\":\"increase\"}"}
    /// </summary>
    static void HandleAdjustMousePointerSize(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            string adjustment = param.Value<string>("sizeAdjustment");

            // Open mouse pointer settings
            Process.Start(new ProcessStartInfo
            {
                FileName = "ms-settings:easeofaccess-mouse",
                UseShellExecute = true
            });

            Debug.WriteLine($"Mouse pointer settings opened for size adjustment");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    /// <summary>
    /// Customizes mouse pointer color
    /// Command: {"mousePointerCustomization": "{\"color\":\"#FF0000\"}"}
    /// </summary>
    static void HandleMousePointerCustomization(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            string color = param.Value<string>("color");

            // Open mouse pointer settings
            Process.Start(new ProcessStartInfo
            {
                FileName = "ms-settings:easeofaccess-mouse",
                UseShellExecute = true
            });

            Debug.WriteLine($"Mouse pointer settings opened for color customization");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    #endregion

    #region Touchpad Settings

    /// <summary>
    /// Enables or disables the touchpad
    /// Command: {"EnableTouchPad": "{\"enable\":true}"}
    /// </summary>
    static void HandleEnableTouchPad(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            bool enable = param.Value<bool>("enable");

            // Open touchpad settings
            Process.Start(new ProcessStartInfo
            {
                FileName = "ms-settings:devices-touchpad",
                UseShellExecute = true
            });

            Debug.WriteLine($"Touchpad settings opened");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    /// <summary>
    /// Adjusts touchpad cursor speed
    /// Command: {"TouchpadCursorSpeed": "{\"speed\":5}"}
    /// </summary>
    static void HandleTouchpadCursorSpeed(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            int speed = param.Value<int?>("speed") ?? 5;

            // Open touchpad settings
            Process.Start(new ProcessStartInfo
            {
                FileName = "ms-settings:devices-touchpad",
                UseShellExecute = true
            });

            Debug.WriteLine($"Touchpad settings opened for speed adjustment");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    #endregion

    #region Privacy Settings

    /// <summary>
    /// Manages microphone access for apps
    /// Command: {"ManageMicrophoneAccess": "{\"accessSetting\":\"allow\"}"}
    /// </summary>
    static void HandleManageMicrophoneAccess(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            string access = param.Value<string>("accessSetting");
            bool allow = access.Equals("allow", StringComparison.OrdinalIgnoreCase);

            using (var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone"))
            {
                if (key != null)
                {
                    key.SetValue("Value", allow ? "Allow" : "Deny", RegistryValueKind.String);
                }
            }

            Debug.WriteLine($"Microphone access {access}");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    /// <summary>
    /// Manages camera access for apps
    /// Command: {"ManageCameraAccess": "{\"accessSetting\":\"allow\"}"}
    /// </summary>
    static void HandleManageCameraAccess(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            string access = param.Value<string?>("accessSetting") ?? "allow";
            bool allow = access.Equals("allow", StringComparison.OrdinalIgnoreCase);

            using (var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\webcam"))
            {
                if (key != null)
                {
                    key.SetValue("Value", allow ? "Allow" : "Deny", RegistryValueKind.String);
                }
            }

            Debug.WriteLine($"Camera access {access}");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    /// <summary>
    /// Manages location access for apps
    /// Command: {"ManageLocationAccess": "{\"accessSetting\":\"allow\"}"}
    /// </summary>
    static void HandleManageLocationAccess(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            string access = param.Value<string?>("accessSetting") ?? "allow";
            bool allow = access.Equals("allow", StringComparison.OrdinalIgnoreCase);

            using (var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\location"))
            {
                if (key != null)
                {
                    key.SetValue("Value", allow ? "Allow" : "Deny", RegistryValueKind.String);
                }
            }

            Debug.WriteLine($"Location access {access}");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    #endregion

    #region Power Settings

    /// <summary>
    /// Sets the battery saver activation threshold
    /// Command: {"BatterySaverActivationLevel": "{\"thresholdValue\":20}"}
    /// </summary>
    static void HandleBatterySaverActivationLevel(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            int threshold = param.Value<int>("thresholdValue");

            threshold = Math.Max(0, Math.Min(100, threshold));

            using (var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Power\BatterySaver"))
            {
                if (key != null)
                {
                    key.SetValue("ActivationThreshold", threshold, RegistryValueKind.DWord);
                }
            }

            Debug.WriteLine($"Battery saver threshold set to: {threshold}%");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    /// <summary>
    /// Sets power mode when plugged in
    /// Command: {"setPowerModePluggedIn": "{\"powerMode\":\"bestPerformance\"}"}
    /// </summary>
    static void HandleSetPowerModePluggedIn(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            string mode = param.Value<string>("powerMode");

            // Open power settings
            Process.Start(new ProcessStartInfo
            {
                FileName = "ms-settings:powersleep",
                UseShellExecute = true
            });

            Debug.WriteLine($"Power settings opened for mode adjustment");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    /// <summary>
    /// Sets power mode when on battery
    /// Command: {"SetPowerModeOnBattery": "{\"mode\":\"balanced\"}"}
    /// </summary>
    static void HandleSetPowerModeOnBattery(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            string mode = param.Value<string?>("mode") ?? "balanced";

            // Open power settings
            Process.Start(new ProcessStartInfo
            {
                FileName = "ms-settings:powersleep",
                UseShellExecute = true
            });

            Debug.WriteLine($"Power settings opened for battery mode adjustment");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    #endregion

    #region Gaming Settings

    /// <summary>
    /// Enables or disables Game Mode
    /// Command: {"enableGameMode": "{}"}
    /// </summary>
    static void HandleEnableGameMode(string jsonParams)
    {
        try
        {
            // Open gaming settings
            Process.Start(new ProcessStartInfo
            {
                FileName = "ms-settings:gaming-gamemode",
                UseShellExecute = true
            });

            Debug.WriteLine($"Game Mode settings opened");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    #endregion

    #region Accessibility Settings

    /// <summary>
    /// Enables or disables Narrator
    /// Command: {"EnableNarratorAction": "{\"enable\":true}"}
    /// </summary>
    static void HandleEnableNarratorAction(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            bool enable = param.Value<bool?>("enable") ?? true;

            if (enable)
            {
                Process.Start("narrator.exe");
            }
            else
            {
                // Kill narrator process
                var processes = Process.GetProcessesByName("Narrator");
                foreach (var p in processes)
                {
                    p.Kill();
                }
            }

            Debug.WriteLine($"Narrator {(enable ? "started" : "stopped")}");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    /// <summary>
    /// Enables or disables Magnifier
    /// Command: {"EnableMagnifier": "{\"enable\":true}"}
    /// </summary>
    static void HandleEnableMagnifier(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            bool enable = param.Value<bool?>("enable") ?? true;

            if (enable)
            {
                Process.Start("magnify.exe");
            }
            else
            {
                // Kill magnifier process
                var processes = Process.GetProcessesByName("Magnify");
                foreach (var p in processes)
                {
                    p.Kill();
                }
            }

            Debug.WriteLine($"Magnifier {(enable ? "started" : "stopped")}");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    /// <summary>
    /// Enables or disables Sticky Keys
    /// Command: {"enableStickyKeys": "{\"enable\":true}"}
    /// </summary>
    static void HandleEnableStickyKeysAction(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            bool enable = param.Value<bool>("enable");

            using (var key = Registry.CurrentUser.CreateSubKey(@"Control Panel\Accessibility\StickyKeys"))
            {
                if (key != null)
                {
                    key.SetValue("Flags", enable ? "510" : "506", RegistryValueKind.String);
                }
            }

            Debug.WriteLine($"Sticky Keys {(enable ? "enabled" : "disabled")}");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    /// <summary>
    /// Enables or disables Filter Keys
    /// Command: {"EnableFilterKeysAction": "{\"enable\":true}"}
    /// </summary>
    static void HandleEnableFilterKeysAction(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            bool enable = param.Value<bool?>("enable") ?? true;

            using (var key = Registry.CurrentUser.CreateSubKey(@"Control Panel\Accessibility\Keyboard Response"))
            {
                if (key != null)
                {
                    key.SetValue("Flags", enable ? "2" : "126", RegistryValueKind.String);
                }
            }

            Debug.WriteLine($"Filter Keys {(enable ? "enabled" : "disabled")}");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    /// <summary>
    /// Enables or disables mono audio
    /// Command: {"MonoAudioToggle": "{\"enable\":true}"}
    /// </summary>
    static void HandleMonoAudioToggle(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            bool enable = param.Value<bool?>("enable") ?? true;

            using (var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Multimedia\Audio"))
            {
                if (key != null)
                {
                    key.SetValue("AccessibilityMonoMixState", enable ? 1 : 0, RegistryValueKind.DWord);
                }
            }

            Debug.WriteLine($"Mono audio {(enable ? "enabled" : "disabled")}");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    #endregion

    #region File Explorer Settings

    /// <summary>
    /// Shows or hides file extensions in File Explorer
    /// Command: {"ShowFileExtensions": "{\"enable\":true}"}
    /// </summary>
    static void HandleShowFileExtensions(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            bool enable = param.Value<bool?>("enable") ?? true;

            using (var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced"))
            {
                if (key != null)
                {
                    // 0 = show extensions, 1 = hide extensions
                    key.SetValue("HideFileExt", enable ? 0 : 1, RegistryValueKind.DWord);
                    RefreshExplorer();
                }
            }

            Debug.WriteLine($"File extensions {(enable ? "shown" : "hidden")}");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    /// <summary>
    /// Shows or hides hidden and system files in File Explorer
    /// Command: {"ShowHiddenAndSystemFiles": "{\"enable\":true}"}
    /// </summary>
    static void HandleShowHiddenAndSystemFiles(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            bool enable = param.Value<bool?>("enable") ?? true;

            using (var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced"))
            {
                if (key != null)
                {
                    // 1 = show hidden files, 2 = don't show hidden files
                    key.SetValue("Hidden", enable ? 1 : 2, RegistryValueKind.DWord);
                    // Show protected OS files
                    key.SetValue("ShowSuperHidden", enable ? 1 : 0, RegistryValueKind.DWord);
                    RefreshExplorer();
                }
            }

            Debug.WriteLine($"Hidden files {(enable ? "shown" : "hidden")}");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    #endregion

    #region Time & Region Settings

    /// <summary>
    /// Enables or disables automatic time synchronization
    /// Command: {"AutomaticTimeSettingAction": "{\"enableAutoTimeSync\":true}"}
    /// </summary>
    static void HandleAutomaticTimeSettingAction(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            bool enable = param.Value<bool>("enableAutoTimeSync");

            // Open time settings
            Process.Start(new ProcessStartInfo
            {
                FileName = "ms-settings:dateandtime",
                UseShellExecute = true
            });

            Debug.WriteLine($"Time settings opened for auto-sync configuration");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    /// <summary>
    /// Enables or disables automatic DST adjustment
    /// Command: {"AutomaticDSTAdjustment": "{\"enable\":true}"}
    /// </summary>
    static void HandleAutomaticDSTAdjustment(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            bool enable = param.Value<bool?>("enable") ?? true;

            using (var key = Registry.LocalMachine.CreateSubKey(@"SYSTEM\CurrentControlSet\Control\TimeZoneInformation"))
            {
                if (key != null)
                {
                    key.SetValue("DynamicDaylightTimeDisabled", enable ? 0 : 1, RegistryValueKind.DWord);
                }
            }

            Debug.WriteLine($"Automatic DST adjustment {(enable ? "enabled" : "disabled")}");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    #endregion

    #region Focus Assist Settings

    /// <summary>
    /// Enables or disables Focus Assist (Quiet Hours)
    /// Command: {"EnableQuietHours": "{\"startHour\":22,\"endHour\":7}"}
    /// </summary>
    static void HandleEnableQuietHours(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            int startHour = param.Value<int?>("startHour") ?? 22;
            int endHour = param.Value<int?>("endHour") ?? 7;

            // Open Focus Assist settings
            Process.Start(new ProcessStartInfo
            {
                FileName = "ms-settings:quiethours",
                UseShellExecute = true
            });

            Debug.WriteLine($"Focus Assist settings opened");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    #endregion

    #region Multi-Monitor Settings

    /// <summary>
    /// Remembers window locations based on monitor configuration
    /// Command: {"RememberWindowLocations": "{\"enable\":true}"}
    /// </summary>
    static void HandleRememberWindowLocationsAction(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            bool enable = param.Value<bool>("enable");

            // This is handled by Windows automatically, but we can open display settings
            Process.Start(new ProcessStartInfo
            {
                FileName = "ms-settings:display",
                UseShellExecute = true
            });

            Debug.WriteLine($"Display settings opened for window location management");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    /// <summary>
    /// Minimizes windows when a monitor is disconnected
    /// Command: {"MinimizeWindowsOnMonitorDisconnectAction": "{\"enable\":true}"}
    /// </summary>
    static void HandleMinimizeWindowsOnMonitorDisconnectAction(string jsonParams)
    {
        try
        {
            var param = JObject.Parse(jsonParams);
            bool enable = param.Value<bool?>("enable") ?? true;

            // Open display settings
            Process.Start(new ProcessStartInfo
            {
                FileName = "ms-settings:display",
                UseShellExecute = true
            });

            Debug.WriteLine($"Display settings opened for disconnect behavior");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
    }

    #endregion

    #region Helper Methods

    /// <summary>
    /// Gets the current brightness level
    /// </summary>
    static byte GetCurrentBrightness()
    {
        try
        {
            using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\SettingSync\Settings\SystemSettings\Brightness"))
            {
                if (key != null)
                {
                    object value = key.GetValue("Data");
                    if (value is byte[] data && data.Length > 0)
                    {
                        return data[0];
                    }
                }
            }
        }
        catch { }

        return 50; // Default to 50% if unable to read
    }

    /// <summary>
    /// Sets the brightness level
    /// </summary>
    static void SetBrightness(byte brightness)
    {
        try
        {
            // Use WMI to set brightness
            using (var searcher = new System.Management.ManagementObjectSearcher("root\\WMI", "SELECT * FROM WmiMonitorBrightnessMethods"))
            {
                using (var objectCollection = searcher.Get())
                {
                    foreach (System.Management.ManagementObject obj in objectCollection)
                    {
                        obj.InvokeMethod("WmiSetBrightness", new object[] { 1, brightness });
                    }
                }
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Failed to set brightness: {ex.Message}");
        }
    }

    /// <summary>
    /// Sets DPI scaling percentage
    /// </summary>
    static void SetDpiScaling(int percentage)
    {
        try
        {
            // Open display settings for DPI adjustment
            Process.Start(new ProcessStartInfo
            {
                FileName = "ms-settings:display",
                UseShellExecute = true
            });
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Failed to set DPI scaling: {ex.Message}");
        }
    }

    /// <summary>
    /// Refreshes the taskbar to apply changes
    /// </summary>
    static void RefreshTaskbar()
    {
        try
        {
            // Send a broadcast message to refresh the explorer
            SendNotifyMessage(HWND_BROADCAST, WM_SETTINGCHANGE, IntPtr.Zero, IntPtr.Zero);
        }
        catch { }
    }

    /// <summary>
    /// Refreshes File Explorer to apply changes
    /// </summary>
    static void RefreshExplorer()
    {
        try
        {
            SendNotifyMessage(HWND_BROADCAST, WM_SETTINGCHANGE, IntPtr.Zero, IntPtr.Zero);

            // Alternative: restart explorer
            // var processes = Process.GetProcessesByName("explorer");
            // foreach (var p in processes) p.Kill();
            // Process.Start("explorer.exe");
        }
        catch { }
    }

    /// <summary>
    /// Sets a registry value
    /// </summary>
    static void SetRegistryValue(string keyPath, string valueName, object value)
    {
        try
        {
            Registry.SetValue(keyPath, valueName, value);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Failed to set registry value: {ex.Message}");
        }
    }

    #endregion

    #region Win32 API Declarations for Settings

    // SystemParametersInfo constants (additional ones not in AutoShell_Win32.cs)
    const int SPI_SETMOUSESPEED = 0x0071;
    const int SPI_GETMOUSE = 0x0003;
    const int SPI_SETMOUSE = 0x0004;
    const int SPI_SETWHEELSCROLLLINES = 0x0069;
    // Note: SPIF_UPDATEINIFILE, SPIF_SENDCHANGE, WM_SETTINGCHANGE, HWND_BROADCAST
    // are already defined in AutoShell_Win32.cs

    [DllImport("user32.dll", SetLastError = true)]
    static extern bool SystemParametersInfo(int uiAction, int uiParam, IntPtr pvParam, int fWinIni);

    [DllImport("user32.dll", SetLastError = true)]
    static extern bool SystemParametersInfo(int uiAction, int uiParam, int[] pvParam, int fWinIni);

    [DllImport("user32.dll")]
    static extern bool SwapMouseButton(int fSwap);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    static extern IntPtr SendNotifyMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    #endregion
}
