// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text;
using FlaUI.Core.AutomationElements;
using UiAutomationHelper.Models;

namespace UiAutomationHelper.Uia;

internal static class Selectors
{
    /// <summary>
    /// Builds a desktop-rooted selector path for the given element by walking
    /// up to (but not including) the desktop root. Required when the element
    /// might be a non-top-level window (e.g., FlaUI returns UWP CoreWindow as
    /// the main window, but it lives under an ApplicationFrameWindow).
    /// </summary>
    public static string BuildAbsolutePath(AutomationElement el)
    {
        // We need a desktop-rooted selector. For most elements that's just
        // BuildSegment. The hard case is a UWP CoreWindow returned by
        // app.GetMainWindow — Win32-wise it's a top-level window, but UIA's
        // logical tree puts it under an ApplicationFrameWindow (different
        // process). Strategies in order:
        //   1) `el` IS a desktop child (matches by RuntimeId).
        //   2) `el`'s Win32 OWNER is a desktop child.
        //   3) Same-named desktop child exists (UWP CoreWindow / frame share name).
        //   4) Fallback to single-segment selector.
        var desktop = AutomationHost.Automation.GetDesktop();
        var elRid = el.Properties.RuntimeId.ValueOrDefault;
        var elName = el.Properties.Name.ValueOrDefault ?? "";
        var elHwnd = (IntPtr)el.Properties.NativeWindowHandle.ValueOrDefault;

        // UWP apps create the ApplicationFrameWindow asynchronously after the
        // CoreWindow appears. Poll desktop's children for up to 2 seconds.
        for (int attempt = 0; attempt < 10; attempt++)
        {
            var topLevels = desktop.FindAllChildren();

            // 1) Identity: el itself is a top-level child.
            if (elRid != null)
            {
                foreach (var top in topLevels)
                {
                    var topRid = top.Properties.RuntimeId.ValueOrDefault;
                    if (topRid != null && RidEquals(elRid, topRid))
                    {
                        return BuildSegment(top);
                    }
                }
            }

            // 2) Win32 owner is a top-level child.
            if (elHwnd != IntPtr.Zero)
            {
                var ownerHwnd = NativeMethods.GetAncestor(elHwnd, NativeMethods.GA_ROOTOWNER);
                if (ownerHwnd != IntPtr.Zero && ownerHwnd != elHwnd)
                {
                    foreach (var top in topLevels)
                    {
                        if ((IntPtr)top.Properties.NativeWindowHandle.ValueOrDefault == ownerHwnd)
                        {
                            return BuildSegment(top);
                        }
                    }
                }
            }

            // 3) Name match (UWP frame and core share the app's display name).
            if (!string.IsNullOrEmpty(elName))
            {
                foreach (var top in topLevels)
                {
                    if (top.Properties.Name.ValueOrDefault == elName)
                    {
                        return BuildSegment(top);
                    }
                }
            }

            Thread.Sleep(200);
        }

        return BuildSegment(el);
    }

    private static bool RidEquals(int[] a, int[] b)
    {
        if (a.Length != b.Length) return false;
        for (int i = 0; i < a.Length; i++)
        {
            if (a[i] != b[i]) return false;
        }
        return true;
    }


    /// <summary>
    /// Builds a "/ControlType[predicate]" segment for an element.
    /// Priority: AutomationId → Name → ClassName → bare ControlType.
    /// </summary>
    public static string BuildSegment(AutomationElement el)
    {
        var ct = el.ControlType.ToString();
        var aid = NullIfEmpty(el.Properties.AutomationId.ValueOrDefault);
        var name = NullIfEmpty(el.Properties.Name.ValueOrDefault);
        var cls = NullIfEmpty(el.Properties.ClassName.ValueOrDefault);

        // AutomationId on its own is unique enough. Otherwise include Name +
        // ClassName as joint identifiers — two siblings can easily share Name
        // (UWP wraps app windows in multiple layers, all named after the app).
        SelectorSegment seg;
        if (aid != null)
        {
            seg = new SelectorSegment(ct, AutomationId: aid);
        }
        else if (name != null && cls != null)
        {
            seg = new SelectorSegment(ct, Name: name, ClassName: cls);
        }
        else if (name != null)
        {
            seg = new SelectorSegment(ct, Name: name);
        }
        else if (cls != null)
        {
            seg = new SelectorSegment(ct, ClassName: cls);
        }
        else
        {
            seg = new SelectorSegment(ct);
        }
        return SelectorParser.FormatSegment(seg);
    }

    private static string? NullIfEmpty(string? s) => string.IsNullOrEmpty(s) ? null : s;
}
