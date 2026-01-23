// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;

namespace autoShell;

/// <summary>
/// This is a placeholder for UIAutomation related functionalities.
/// </summary>
/// <remarks>Only use this as a LAST resort for demo purposes only!</remarks>
[Obsolete("UIAutomation is a last-resort method and should be avoided in production code.")]
internal sealed class UIAutomation
{
    /// <summary>
    /// Uses UI Automation to navigate the Settings app and set the text size.
    /// </summary>
    /// <param name="percentage">The text scaling percentage (100-225).</param>
    internal static void SetTextSizeViaUIAutomation(int percentage)
    {
        // UI Automation Property IDs (from UIAutomationClient.h)
        const int UIA_AutomationIdPropertyId = 30011;

        // UI Automation Pattern IDs
        const int UIA_RangeValuePatternId = 10003;

        const int maxRetries = 10;
        const int retryDelayMs = 500;

        try
        {
            // Create UI Automation instance
            var uiAutomation = new UIAutomationClient.CUIAutomation();
            UIAutomationClient.IUIAutomationElement settingsWindow = null;

            // Wait for Settings window to appear and get it via FindWindow
            for (int i = 0; i < maxRetries; i++)
            {
                // Find the Settings window by enumerating top-level windows with "Settings" in the title
                // UWP apps use ApplicationFrameWindow class
                IntPtr hWnd = IntPtr.Zero;
                while ((hWnd =
                    AutoShell.FindWindowEx(IntPtr.Zero, hWnd, "ApplicationFrameWindow", null)) != IntPtr.Zero)
                {
                    StringBuilder windowTitle = new StringBuilder(256);
                    int hr = AutoShell.GetWindowText(hWnd, windowTitle, windowTitle.Capacity);
                    Debug.WriteLine(windowTitle + $"(hResult: {hr})");
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

                System.Threading.Thread.Sleep(retryDelayMs);
            }

            if (settingsWindow == null)
            {
                AutoShell.LogWarning("Could not find Settings window.");
                return;
            }

            Debug.WriteLine("Found Settings window via FindWindowEx");

            // Wait a moment for the UI to fully load
            System.Threading.Thread.Sleep(500);

            // Find and click the "Text Size" navigation item
            var textSizeNavItem = FindTextSizeNavigationItem(uiAutomation, settingsWindow);
            if (textSizeNavItem != null)
            {
                Debug.WriteLine("Found Text Size navigation item, clicking...");
                ClickElement(textSizeNavItem);
                System.Threading.Thread.Sleep(500); // Wait for page to load
            }
            else
            {
                Debug.WriteLine("Text Size navigation item not found, may already be on the page");
            }

            // Find the text size slider
            var sliderCondition = uiAutomation.CreatePropertyCondition(
                UIA_AutomationIdPropertyId,
                "SystemSettings_EaseOfAccess_Experience_TextScalingDesktop_Slider");

            UIAutomationClient.IUIAutomationElement slider = null;
            for (int i = 0; i < maxRetries; i++)
            {
                slider = settingsWindow.FindFirst(
                    UIAutomationClient.TreeScope.TreeScope_Descendants,
                    sliderCondition);

                if (slider != null)
                {
                    break;
                }

                System.Threading.Thread.Sleep(retryDelayMs);
            }

            if (slider == null)
            {
                AutoShell.LogWarning("Could not find text size slider.");
                return;
            }

            Debug.WriteLine("Found text size slider");

            // Set the slider value using RangeValue pattern
            var rangeValuePattern = (UIAutomationClient.IUIAutomationRangeValuePattern)slider.GetCurrentPattern(
                UIA_RangeValuePatternId);

            if (rangeValuePattern != null)
            {
                Debug.WriteLine($"Setting slider value to {percentage}");
                rangeValuePattern.SetValue(percentage);
            }
            else
            {
                AutoShell.LogWarning("Slider does not support RangeValue pattern.");
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
                Debug.WriteLine($"Error simulating input on slider: {ex.Message}");
            }

            // Find and click the Apply button
            var applyButtonCondition = uiAutomation.CreatePropertyCondition(
                UIA_AutomationIdPropertyId,
                "SystemSettings_EaseOfAccess_Experience_TextScalingDesktop_ButtonRemove");

            UIAutomationClient.IUIAutomationElement applyButton = null;
            for (int i = 0; i < maxRetries; i++)
            {
                applyButton = settingsWindow.FindFirst(
                    UIAutomationClient.TreeScope.TreeScope_Descendants,
                    applyButtonCondition);

                if (applyButton != null)
                {
                    break;
                }

                System.Threading.Thread.Sleep(retryDelayMs);
            }

            if (applyButton != null)
            {
                Debug.WriteLine("Found Apply button, clicking...");
                ClickElement(applyButton);
                Console.WriteLine($"Text size set to {percentage}%");
            }
            else
            {
                AutoShell.LogWarning("Could not find Apply button. The setting may need to be applied manually.");
            }
        }
        catch (Exception ex)
        {
            AutoShell.LogError(ex);
        }
    }

    /// <summary>
    /// Finds the "Text Size" navigation item in the Settings window.
    /// </summary>
    static UIAutomationClient.IUIAutomationElement FindTextSizeNavigationItem(
        UIAutomationClient.CUIAutomation uiAutomation,
        UIAutomationClient.IUIAutomationElement settingsWindow)
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
            Debug.WriteLine($"Error finding Text Size navigation item: {ex.Message}");
        }

        return null;
    }

    /// <summary>
    /// Clicks a UI Automation element using the Invoke pattern or simulated click.
    /// </summary>
    static void ClickElement(UIAutomationClient.IUIAutomationElement element)
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
            Debug.WriteLine($"Error clicking element: {ex.Message}");
        }
    }

    // Mouse event constants for simulated clicks
    private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    private const uint MOUSEEVENTF_LEFTUP = 0x0004;

    // Keyboard event constants
    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const byte VK_DELETE = 0x2E;

    [DllImport("user32.dll")]
    private static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    private static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, IntPtr dwExtraInfo);

    [DllImport("user32.dll")]
    private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, IntPtr dwExtraInfo);

}
