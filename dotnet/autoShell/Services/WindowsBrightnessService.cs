// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Linq;
using autoShell.Logging;
using Microsoft.Win32;

namespace autoShell.Services;

/// <summary>
/// Concrete implementation of <see cref="IBrightnessService"/> using WMI and Windows Registry.
/// </summary>
internal class WindowsBrightnessService : IBrightnessService
{
    private readonly ILogger _logger;

    public WindowsBrightnessService(ILogger logger)
    {
        _logger = logger;
    }

    /// <inheritdoc/>
    public byte GetCurrentBrightness()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(
                @"Software\Microsoft\Windows\CurrentVersion\SettingSync\Settings\SystemSettings\Brightness");
            if (key != null)
            {
                object value = key.GetValue("Data");
                if (value is byte[] data && data.Length > 0)
                {
                    return data[0];
                }
            }
        }
        catch (Exception ex)
        {
            _logger.Debug($"Failed to read brightness: {ex.Message}");
        }
        return 50;
    }

    /// <inheritdoc/>
    public void SetBrightness(byte brightness)
    {
        try
        {
            using var searcher = new System.Management.ManagementObjectSearcher(
                "root\\WMI", "SELECT * FROM WmiMonitorBrightnessMethods");
            using var objectCollection = searcher.Get();
            foreach (System.Management.ManagementObject obj in objectCollection.Cast<System.Management.ManagementObject>())
            {
                obj.InvokeMethod("WmiSetBrightness", [1, brightness]);
            }
        }
        catch (Exception ex)
        {
            _logger.Debug($"Failed to set brightness: {ex.Message}");
        }
    }
}
