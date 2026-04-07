// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Runtime.InteropServices;
using System.Text;
using autoShell.Logging;
using UIAutomationClient = Interop.UIAutomationClient;

namespace autoShell.Services.Interop;

/// <summary>
/// This is a placeholder for UIAutomation related functionalities.
/// </summary>
/// <remarks>Only use this as a LAST resort for demo purposes only!</remarks>
[Obsolete("UIAutomation is a last-resort method and should be avoided in production code.")]
internal sealed class UIAutomation
{
    #region P/Invoke

    // Mouse event constants for simulated clicks
    private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    private const uint MOUSEEVENTF_LEFTUP = 0x0004;

    // Keyboard event constants
    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const byte VK_DELETE = 0x2E;

    [DllImport(NativeDlls.User32)]
    private static extern bool SetCursorPos(int X, int Y);

    [DllImport(NativeDlls.User32)]
    private static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, IntPtr dwExtraInfo);

    [DllImport(NativeDlls.User32)]
    private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, IntPtr dwExtraInfo);

    [DllImport(NativeDlls.User32)]
    private static extern IntPtr FindWindowEx(IntPtr hWndParent, IntPtr hWndChildAfter, string lpClassName, string lpWindowName);

    [DllImport(NativeDlls.User32)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    #endregion P/Invoke

    /// <summary>
    /// Uses UI Automation to navigate the Settings app and set the text size.
    /// </summary>
    /// <param name="percentage">The text scaling percentage (100-225).</param>
    internal static void SetTextSizeViaUIAutomation(int percentage, ILogger logger)
    {
        // UI Automation Property IDs (from UIAutomationClient.h)
        const int UIA_AutomationIdPropertyId = 30011;

        // UI Automation Pattern IDs
        const int UIA_RangeValuePatternId = 10003;

        const int MaxRetries = 10;
        const int RetryDelayMs = 500;

        try
        {
            // Create UI Automation instance
            var uiAutomation = new UIAutomationClient.CUIAutomation();
            UIAutomationClient.IUIAutomationElement settingsWindow = null;

            // Wait for Settings window to appear and get it via FindWindow
            for (int i = 0; i < MaxRetries; i++)
            {
                // Find the Settings window by enumerating top-level windows with "Settings" in the title
                // UWP apps use ApplicationFrameWindow class
                IntPtr hWnd = IntPtr.Zero;
                while ((hWnd =
                    FindWindowEx(IntPtr.Zero, hWnd, "ApplicationFrameWindow", null)) != IntPtr.Zero)
                {
                    StringBuilder windowTitle = new StringBuilder(256);
                    int hr = GetWindowText(hWnd, windowTitle, windowTitle.Capacity);
                    logger.Debug(windowTitle + $"(hResult: {hr})");
                    if (windowTitle.ToString().Contains("Settings", StringComparison.OrdinalIgnoreCase))
                    {
                        // Get the automation element directly from the window handle
                        settingsWindow = uiAutomation.ElementFromHandle(hWnd);
                        break;
                    }
                }

                if (settingsWindow != null)
                {
                    break;
                }

                System.Threading.Thread.Sleep(RetryDelayMs);
            }

            if (settingsWindow == null)
            {
                logger.Warning("Could not find Settings window.");
                return;
            }

            logger.Debug("Found Settings window via FindWindowEx");

            // Wait a moment for the UI to fully load
            System.Threading.Thread.Sleep(500);

            // Find and click the "Text Size" navigation item
            var textSizeNavItem = FindTextSizeNavigationItem(uiAutomation, settingsWindow, logger);
            if (textSizeNavItem != null)
            {
                logger.Debug("Found Text Size navigation item, clicking...");
                ClickElement(textSizeNavItem, logger);
                System.Threading.Thread.Sleep(500); // Wait for page to load
            }
            else
            {
                logger.Debug("Text Size navigation item not found, may already be on the page");
            }

            // Find the text size slider
            var sliderCondition = uiAutomation.CreatePropertyCondition(
                UIA_AutomationIdPropertyId,
                "SystemSettings_EaseOfAccess_Experience_TextScalingDesktop_Slider");

            UIAutomationClient.IUIAutomationElement slider = null;
            for (int i = 0; i < MaxRetries; i++)
            {
                slider = settingsWindow.FindFirst(
                    UIAutomationClient.TreeScope.TreeScope_Descendants,
                    sliderCondition);

                if (slider != null)
                {
                    break;
                }

                System.Threading.Thread.Sleep(RetryDelayMs);
            }

            if (slider == null)
            {
                logger.Warning("Could not find text size slider.");
                return;
            }

            logger.Debug("Found text size slider");

            // Set the slider value using RangeValue pattern
            var rangeValuePattern = (UIAutomationClient.IUIAutomationRangeValuePattern)slider.GetCurrentPattern(
                UIA_RangeValuePatternId);

            if (rangeValuePattern != null)
            {
                logger.Debug($"Setting slider value to {percentage}");
                rangeValuePattern.SetValue(percentage);
            }
            else
            {
                logger.Warning("Slider does not support RangeValue pattern.");
                return;
            }

            // Wait a moment for the value to be applied
            System.Threading.Thread.Sleep(300);

            // Focus the slider and simulate a keyboard event to trigger the Apply button to become enabled
            // The Apply button only enables when it detects actual user input on the slider
            try
            {
                slider.SetFocus();
                System.Threading.Thread.Sleep(100);

                // Send a neutral key event (press and release a key that doesn't change the value)
                // Using VK_DELETE followed by setting the value again ensures the UI registers the change
                keybd_event(VK_DELETE, 0, 0, IntPtr.Zero);
                keybd_event(VK_DELETE, 0, KEYEVENTF_KEYUP, IntPtr.Zero);
                System.Threading.Thread.Sleep(100);

                // Reset to the desired value in case the key changed it
                rangeValuePattern.SetValue(percentage);
                System.Threading.Thread.Sleep(200);
            }
            catch (Exception ex)
            {
                logger.Debug($"Error simulating input on slider: {ex.Message}");
            }

            // Find and click the Apply button
            var applyButtonCondition = uiAutomation.CreatePropertyCondition(
                UIA_AutomationIdPropertyId,
                "SystemSettings_EaseOfAccess_Experience_TextScalingDesktop_ButtonRemove");

            UIAutomationClient.IUIAutomationElement applyButton = null;
            for (int i = 0; i < MaxRetries; i++)
            {
                applyButton = settingsWindow.FindFirst(
                    UIAutomationClient.TreeScope.TreeScope_Descendants,
                    applyButtonCondition);

                if (applyButton != null)
                {
                    break;
                }

                System.Threading.Thread.Sleep(RetryDelayMs);
            }

            if (applyButton != null)
            {
                logger.Debug("Found Apply button, clicking...");
                ClickElement(applyButton, logger);
                logger.Info($"Text size set to {percentage}%");
            }
            else
            {
                logger.Warning("Could not find Apply button. The setting may need to be applied manually.");
            }
        }
        catch (Exception ex)
        {
            logger.Error(ex);
        }
    }

    /// <summary>
    /// Finds the "Text Size" navigation item in the Settings window.
    /// </summary>
    private static UIAutomationClient.IUIAutomationElement FindTextSizeNavigationItem(
        UIAutomationClient.CUIAutomation uiAutomation,
        UIAutomationClient.IUIAutomationElement settingsWindow,
        ILogger logger)
    {
        // UI Automation Property IDs
        const int UIA_NamePropertyId = 30005;
        const int UIA_ControlTypePropertyId = 30003;
        const int UIA_ListItemControlTypeId = 50007;

        try
        {
            // Look for elements that contain "Text Size" in their name
            var nameCondition = uiAutomation.CreatePropertyCondition(
                UIA_NamePropertyId,
                "Text size");

            var textSizeElement = settingsWindow.FindFirst(
                UIAutomationClient.TreeScope.TreeScope_Descendants,
                nameCondition);

            if (textSizeElement != null)
            {
                return textSizeElement;
            }

            // Alternative: search for ListItem or similar control containing "Text Size"
            var listItemCondition = uiAutomation.CreatePropertyCondition(
                UIA_ControlTypePropertyId,
                UIA_ListItemControlTypeId);

            var listItems = settingsWindow.FindAll(
                UIAutomationClient.TreeScope.TreeScope_Descendants,
                listItemCondition);

            for (int i = 0; i < listItems.Length; i++)
            {
                var item = listItems.GetElement(i);
                string name = item.CurrentName;
                if (name != null && name.Contains("Text size", StringComparison.OrdinalIgnoreCase))
                {
                    return item;
                }
            }
        }
        catch (Exception ex)
        {
            logger.Debug($"Error finding Text Size navigation item: {ex.Message}");
        }

        return null;
    }

    /// <summary>
    /// Clicks a UI Automation element using the Invoke pattern or simulated click.
    /// </summary>
    private static void ClickElement(UIAutomationClient.IUIAutomationElement element, ILogger logger)
    {
        // UI Automation Pattern IDs
        const int UIA_InvokePatternId = 10000;
        const int UIA_SelectionItemPatternId = 10010;

        try
        {
            // Try using the Invoke pattern first
            var invokePattern = (UIAutomationClient.IUIAutomationInvokePattern)element.GetCurrentPattern(
                UIA_InvokePatternId);

            if (invokePattern != null)
            {
                invokePattern.Invoke();
                return;
            }

            // Try using the SelectionItem pattern
            var selectionItemPattern = (UIAutomationClient.IUIAutomationSelectionItemPattern)element.GetCurrentPattern(
                UIA_SelectionItemPatternId);

            if (selectionItemPattern != null)
            {
                selectionItemPattern.Select();
                return;
            }

            // Fall back to simulating a click at the element's center
            var rect = element.CurrentBoundingRectangle;
            int x = (rect.left + rect.right) / 2;
            int y = (rect.top + rect.bottom) / 2;

            // Move cursor and click
            SetCursorPos(x, y);
            mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, IntPtr.Zero);
            mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, IntPtr.Zero);
        }
        catch (Exception ex)
        {
            logger.Debug($"Error clicking element: {ex.Message}");
        }
    }
}
