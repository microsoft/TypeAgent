// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows;
using autoShell.Services;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace autoShell.Handlers;

/// <summary>
/// Handles virtual desktop commands: createDesktop, switchDesktop, nextDesktop, previousDesktop,
/// moveWindowToDesktop, pinWindow.
/// </summary>
internal class VirtualDesktopCommandHandler : ICommandHandler
{
    private readonly IAppRegistry _appRegistry;
    private readonly IServiceProvider10 _shell;
    private readonly IVirtualDesktopManagerInternal _virtualDesktopManagerInternal;
    private readonly IVirtualDesktopManagerInternal_BUGBUG _virtualDesktopManagerInternal_BUGBUG;
    private readonly IVirtualDesktopManager _virtualDesktopManager;
    private readonly IApplicationViewCollection _applicationViewCollection;
    private readonly IVirtualDesktopPinnedApps _virtualDesktopPinnedApps;

    public VirtualDesktopCommandHandler(IAppRegistry appRegistry)
    {
        this._appRegistry = appRegistry;

        // Desktop management COM initialization
        this._shell = (IServiceProvider10)Activator.CreateInstance(Type.GetTypeFromCLSID(s_clsidImmersiveShell));
        this._virtualDesktopManagerInternal = (IVirtualDesktopManagerInternal)this._shell.QueryService(s_clsidVirtualDesktopManagerInternal, typeof(IVirtualDesktopManagerInternal).GUID);
        this._virtualDesktopManagerInternal_BUGBUG = (IVirtualDesktopManagerInternal_BUGBUG)this._shell.QueryService(s_clsidVirtualDesktopManagerInternal, typeof(IVirtualDesktopManagerInternal).GUID);
        this._virtualDesktopManager = (IVirtualDesktopManager)Activator.CreateInstance(Type.GetTypeFromCLSID(s_clsidVirtualDesktopManager));
        this._applicationViewCollection = (IApplicationViewCollection)this._shell.QueryService(typeof(IApplicationViewCollection).GUID, typeof(IApplicationViewCollection).GUID);
        this._virtualDesktopPinnedApps = (IVirtualDesktopPinnedApps)this._shell.QueryService(s_clsidVirtualDesktopPinnedApps, typeof(IVirtualDesktopPinnedApps).GUID);
    }

    /// <inheritdoc/>
    public IEnumerable<string> SupportedCommands { get; } =
    [
        "CreateDesktop",
        "MoveWindowToDesktop",
        "NextDesktop",
        "PinWindow",
        "PreviousDesktop",
        "SwitchDesktop",
    ];

    /// <inheritdoc/>
    public void Handle(string key, string value, JToken rawValue)
    {
        switch (key)
        {
            case "CreateDesktop":
                this.CreateDesktop(value);
                break;

            case "SwitchDesktop":
                this.SwitchDesktop(value);
                break;

            case "NextDesktop":
                this.BumpDesktopIndex(1);
                break;

            case "PreviousDesktop":
                this.BumpDesktopIndex(-1);
                break;

            case "MoveWindowToDesktop":
                this.MoveWindowToDesktop(rawValue);
                break;

            case "PinWindow":
                this.PinWindow(value);
                break;
        }
    }

    #region Virtual Desktop Methods

    /// <summary>
    /// Creates virtual desktops from a JSON array of desktop names.
    /// </summary>
    /// <param name="jsonValue">JSON array containing desktop names, e.g., ["Work", "Personal", "Gaming"]</param>
    private void CreateDesktop(string jsonValue)
    {
        try
        {
            // Parse the JSON array of desktop names
            JArray desktopNames = JArray.Parse(jsonValue);

            if (desktopNames == null || desktopNames.Count == 0)
            {
                desktopNames = ["desktop X"];
            }

            if (this._virtualDesktopManagerInternal == null)
            {
                Debug.WriteLine($"Failed to get Virtual Desktop Manager Internal");
                return;
            }

            foreach (JToken desktopNameToken in desktopNames)
            {
                string desktopName = desktopNameToken.ToString();


                try
                {
                    // Create a new virtual desktop
                    IVirtualDesktop newDesktop = this._virtualDesktopManagerInternal.CreateDesktop();

                    if (newDesktop != null)
                    {
                        // Set the desktop name (Windows 10 build 20231+ / Windows 11)
                        try
                        {
                            // TODO: debug & get working
                            // Works in .NET framework but not .NET
                            //s_virtualDesktopManagerInternal_BUGBUG.SetDesktopName(newDesktop, desktopName);
                            //Debug.WriteLine($"Created virtual desktop: {desktopName}");
                        }
                        catch (Exception ex2)
                        {
                            // Older Windows version - name setting not supported
                            Debug.WriteLine($"Created virtual desktop (naming not supported on this Windows version): {ex2.Message}");
                        }
                    }
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"Failed to create desktop '{desktopName}': {ex.Message}");
                }
            }
        }
        catch (JsonException ex)
        {
            Debug.WriteLine($"Failed to parse desktop names JSON: {ex.Message}");
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Error creating desktops: {ex.Message}");
        }
    }

    private void SwitchDesktop(string desktopIdentifier)
    {
        if (!int.TryParse(desktopIdentifier, out int index))
        {
            // Try to find the desktop by name
            this._virtualDesktopManagerInternal.SwitchDesktop(this.FindDesktopByName(desktopIdentifier));
        }
        else
        {
            this.SwitchDesktop(index);
        }
    }

    private void SwitchDesktop(int index)
    {
        this._virtualDesktopManagerInternal.GetDesktops(out IObjectArray desktops);
        desktops.GetAt(index, typeof(IVirtualDesktop).GUID, out object od);

        // BUGBUG: different windows versions use different COM interfaces
        // Different Windows versions use different COM interfaces for desktop switching
        // Windows 11 22H2 (build 22621) and later use the updated interface
        if (OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22621))
        {
            // Use the BUGBUG interface for Windows 11 22H2+
            this._virtualDesktopManagerInternal_BUGBUG.SwitchDesktopWithAnimation((IVirtualDesktop)od);
        }
        else if (OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22000))
        {
            // Windows 11 21H2 (build 22000)
            this._virtualDesktopManagerInternal.SwitchDesktopWithAnimation((IVirtualDesktop)od);
        }
        else
        {
            // Windows 10 - use the original interface
            this._virtualDesktopManagerInternal.SwitchDesktopAndMoveForegroundView((IVirtualDesktop)od);
        }

        Marshal.ReleaseComObject(desktops);
    }

    private void BumpDesktopIndex(int bump)
    {
        IVirtualDesktop desktop = this._virtualDesktopManagerInternal.GetCurrentDesktop();
        int index = GetDesktopIndex(desktop);
        int count = this._virtualDesktopManagerInternal.GetCount();

        if (index == -1)
        {
            Debug.WriteLine("Undable to get the index of the current desktop");
            return;
        }

        index += bump;

        if (index > count)
        {
            index = 0;
        }
        else if (index < 0)
        {
            index = count - 1;
        }

        this.SwitchDesktop(index);
    }

    private IVirtualDesktop FindDesktopByName(string name)
    {
        int count = this._virtualDesktopManagerInternal.GetCount();

        this._virtualDesktopManagerInternal.GetDesktops(out IObjectArray desktops);
        for (int i = 0; i < count; i++)
        {
            desktops.GetAt(i, typeof(IVirtualDesktop).GUID, out object od);

            if (string.Equals(((IVirtualDesktop)od).GetName(), name, StringComparison.OrdinalIgnoreCase))
            {
                Marshal.ReleaseComObject(desktops);
                return (IVirtualDesktop)od;
            }
        }

        Marshal.ReleaseComObject(desktops);

        return null;
    }

    private int GetDesktopIndex(IVirtualDesktop desktop)
    {
        int count = this._virtualDesktopManagerInternal.GetCount();

        this._virtualDesktopManagerInternal.GetDesktops(out IObjectArray desktops);
        for (int i = 0; i < count; i++)
        {
            desktops.GetAt(i, typeof(IVirtualDesktop).GUID, out object od);

            if (desktop.GetId() == ((IVirtualDesktop)od).GetId())
            {
                Marshal.ReleaseComObject(desktops);
                return i;
            }
        }

        Marshal.ReleaseComObject(desktops);

        return -1;
    }

    /// <summary>
    /// 
    /// </summary>
    /// <param name="value"></param>
    /// <remarks>Currently not working correction, returns ACCESS_DENIED // TODO: investigate</remarks>
    private void MoveWindowToDesktop(JToken value)
    {
        string process = value.SelectToken("process").ToString();
        string desktop = value.SelectToken("desktop").ToString();
        if (string.IsNullOrEmpty(process))
        {
            Debug.WriteLine("No process name supplied");
            return;
        }

        if (string.IsNullOrEmpty(desktop))
        {
            Debug.WriteLine("No desktop id supplied");
            return;
        }

        IntPtr hWnd = WindowCommandHandler.FindProcessWindowHandle(process, this._appRegistry);

        if (int.TryParse(desktop, out int desktopIndex))
        {
            this._virtualDesktopManagerInternal.GetDesktops(out IObjectArray desktops);
            if (desktopIndex < 1 || desktopIndex > this._virtualDesktopManagerInternal.GetCount())
            {
                Debug.WriteLine("Desktop index out of range");
                Marshal.ReleaseComObject(desktops);
                return;
            }
            desktops.GetAt(desktopIndex - 1, typeof(IVirtualDesktop).GUID, out object od);
            Guid g = ((IVirtualDesktop)od).GetId();
            this._virtualDesktopManager.MoveWindowToDesktop(hWnd, ref g);
            Marshal.ReleaseComObject(desktops);
            return;
        }

        IVirtualDesktop ivd = FindDesktopByName(desktop);
        if (ivd is not null)
        {
            Guid desktopGuid = ivd.GetId();
            this._virtualDesktopManager.MoveWindowToDesktop(hWnd, ref desktopGuid);
        }
    }

    private void PinWindow(string processName)
    {
        IntPtr hWnd = WindowCommandHandler.FindProcessWindowHandle(processName, this._appRegistry);

        if (hWnd != IntPtr.Zero)
        {
            this._applicationViewCollection.GetViewForHwnd(hWnd, out IApplicationView view);

            if (view is not null)
            {
                this._virtualDesktopPinnedApps.PinView((IApplicationView)view);
            }
        }
        else
        {
            Console.WriteLine($"The window handle for '{processName}' could not be found");
        }
    }

    private IVirtualDesktopManagerInternal GetVirtualDesktopManagerInternal()
    {
        try
        {
            IServiceProvider shellServiceProvider = (IServiceProvider)Activator.CreateInstance(
                Type.GetTypeFromCLSID(s_clsidImmersiveShell));

            Guid guidService = s_clsidVirtualDesktopManagerInternal;
            Guid riid = typeof(IVirtualDesktopManagerInternal).GUID;
            shellServiceProvider.QueryService(
                ref guidService,
                ref riid,
                out object objVirtualDesktopManagerInternal);

            return (IVirtualDesktopManagerInternal)objVirtualDesktopManagerInternal;
        }
        catch
        {
            return null;
        }
    }

    #endregion

    #region Virtual Desktop COM Interfaces

    private enum APPLICATION_VIEW_CLOAK_TYPE : int
    {
        AVCT_NONE = 0,
        AVCT_DEFAULT = 1,
        AVCT_VIRTUAL_DESKTOP = 2
    }

    private enum APPLICATION_VIEW_COMPATIBILITY_POLICY : int
    {
        AVCP_NONE = 0,
        AVCP_SMALL_SCREEN = 1,
        AVCP_TABLET_SMALL_SCREEN = 2,
        AVCP_VERY_SMALL_SCREEN = 3,
        AVCP_HIGH_SCALE_FACTOR = 4
    }

    // Virtual Desktop COM Interface GUIDs
    private static readonly Guid s_clsidImmersiveShell = new Guid("C2F03A33-21F5-47FA-B4BB-156362A2F239");
    private static readonly Guid s_clsidVirtualDesktopManagerInternal = new Guid("C5E0CDCA-7B6E-41B2-9FC4-D93975CC467B");
    private static readonly Guid s_clsidVirtualDesktopManager = new Guid("AA509086-5CA9-4C25-8F95-589D3C07B48A");
    private static readonly Guid s_clsidVirtualDesktopPinnedApps = new Guid("B5A399E7-1C87-46B8-88E9-FC5747B171BD");

    // IServiceProvider COM Interface
    [ComImport]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    [Guid("6D5140C1-7436-11CE-8034-00AA006009FA")]
    private interface IServiceProvider
    {
        [return: MarshalAs(UnmanagedType.IUnknown)]
        void QueryService(ref Guid guidService, ref Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object ppvObject);
    }

    // IVirtualDesktopManager COM Interface
    [ComImport]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    [Guid("A5CD92FF-29BE-454C-8D04-D82879FB3F1B")]
    private interface IVirtualDesktopManager
    {
        bool IsWindowOnCurrentVirtualDesktop(IntPtr topLevelWindow);
        Guid GetWindowDesktopId(IntPtr topLevelWindow);
        void MoveWindowToDesktop(IntPtr topLevelWindow, ref Guid desktopId);
    }

    // IVirtualDesktop COM Interface (Windows 10/11)
    [ComImport]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    [Guid("3F07F4BE-B107-441A-AF0F-39D82529072C")]
    private interface IVirtualDesktop
    {
        bool IsViewVisible(IApplicationView view);
        Guid GetId();
        // TODO: proper HSTRING custom marshaling
        [return: MarshalAs(UnmanagedType.HString)]
        string GetName();
        [return: MarshalAs(UnmanagedType.HString)]
        string GetWallpaperPath();
        bool IsRemote();
    }

    // IVirtualDesktopManagerInternal COM Interface
    [ComImport]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    [Guid("53F5CA0B-158F-4124-900C-057158060B27")]
    private interface IVirtualDesktopManagerInternal_BUGBUG
    {
        int GetCount();
        void MoveViewToDesktop(IApplicationView view, IVirtualDesktop desktop);
        bool CanViewMoveDesktops(IApplicationView view);
        IVirtualDesktop GetCurrentDesktop();
        void GetDesktops(out IObjectArray desktops);
        [PreserveSig]
        int GetAdjacentDesktop(IVirtualDesktop from, int direction, out IVirtualDesktop desktop);
        void SwitchDesktop(IVirtualDesktop desktop);
        IVirtualDesktop CreateDesktop();
        void MoveDesktop(IVirtualDesktop desktop, int nIndex);
        void RemoveDesktop(IVirtualDesktop desktop, IVirtualDesktop fallback);
        IVirtualDesktop FindDesktop(ref Guid desktopid);
        void GetDesktopSwitchIncludeExcludeViews(IVirtualDesktop desktop, out IObjectArray unknown1, out IObjectArray unknown2);
        void SetDesktopName(IVirtualDesktop desktop, [MarshalAs(UnmanagedType.HString)] string name);
        void SetDesktopWallpaper(IVirtualDesktop desktop, [MarshalAs(UnmanagedType.HString)] string path);
        void UpdateWallpaperPathForAllDesktops([MarshalAs(UnmanagedType.HString)] string path);
        void CopyDesktopState(IApplicationView pView0, IApplicationView pView1);
        void CreateRemoteDesktop([MarshalAs(UnmanagedType.HString)] string path, out IVirtualDesktop desktop);
        void SwitchRemoteDesktop(IVirtualDesktop desktop, IntPtr switchtype);
        void SwitchDesktopWithAnimation(IVirtualDesktop desktop);
        void GetLastActiveDesktop(out IVirtualDesktop desktop);
        void WaitForAnimationToComplete();
    }

    // IVirtualDesktopManagerInternal COM Interface
    [ComImport]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    [Guid("53F5CA0B-158F-4124-900C-057158060B27")]
    private interface IVirtualDesktopManagerInternal
    {
        int GetCount();
        void MoveViewToDesktop(IApplicationView view, IVirtualDesktop desktop);
        bool CanViewMoveDesktops(IApplicationView view);
        IVirtualDesktop GetCurrentDesktop();
        void GetDesktops(out IObjectArray desktops);
        [PreserveSig]
        int GetAdjacentDesktop(IVirtualDesktop from, int direction, out IVirtualDesktop desktop);
        void SwitchDesktop(IVirtualDesktop desktop);
        void SwitchDesktopAndMoveForegroundView(IVirtualDesktop desktop);
        IVirtualDesktop CreateDesktop();
        void MoveDesktop(IVirtualDesktop desktop, int nIndex);
        void RemoveDesktop(IVirtualDesktop desktop, IVirtualDesktop fallback);
        IVirtualDesktop FindDesktop(ref Guid desktopid);
        void GetDesktopSwitchIncludeExcludeViews(IVirtualDesktop desktop, out IObjectArray unknown1, out IObjectArray unknown2);
        void SetDesktopName(IVirtualDesktop desktop, [MarshalAs(UnmanagedType.HString)] string name);
        void SetDesktopWallpaper(IVirtualDesktop desktop, [MarshalAs(UnmanagedType.HString)] string path);
        void UpdateWallpaperPathForAllDesktops([MarshalAs(UnmanagedType.HString)] string path);
        void CopyDesktopState(IApplicationView pView0, IApplicationView pView1);
        void CreateRemoteDesktop([MarshalAs(UnmanagedType.HString)] string path, out IVirtualDesktop desktop);
        void SwitchRemoteDesktop(IVirtualDesktop desktop, IntPtr switchtype);
        void SwitchDesktopWithAnimation(IVirtualDesktop desktop);
        void GetLastActiveDesktop(out IVirtualDesktop desktop);
        void WaitForAnimationToComplete();
    }

    // IObjectArray COM Interface
    [ComImport]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    [Guid("92CA9DCD-5622-4BBA-A805-5E9F541BD8C9")]
    private interface IObjectArray
    {
        void GetCount(out int pcObjects);
        void GetAt(int uiIndex, ref Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object ppv);
    }

    [ComImport]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    [Guid("372E1D3B-38D3-42E4-A15B-8AB2B178F513")]
    private interface IApplicationView
    {
        int SetFocus();
        int SwitchTo();
        int TryInvokeBack(IntPtr /* IAsyncCallback* */ callback);
        int GetThumbnailWindow(out IntPtr hwnd);
        int GetMonitor(out IntPtr /* IImmersiveMonitor */ immersiveMonitor);
        int GetVisibility(out int visibility);
        int SetCloak(APPLICATION_VIEW_CLOAK_TYPE cloakType, int unknown);
        int GetPosition(ref Guid guid /* GUID for IApplicationViewPosition */, out IntPtr /* IApplicationViewPosition** */ position);
        int SetPosition(ref IntPtr /* IApplicationViewPosition* */ position);
        int InsertAfterWindow(IntPtr hwnd);
        int GetExtendedFramePosition(out Rect rect);
        int GetAppUserModelId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        int SetAppUserModelId(string id);
        int IsEqualByAppUserModelId(string id, out int result);
        int GetViewState(out uint state);
        int SetViewState(uint state);
        int GetNeediness(out int neediness);
        int GetLastActivationTimestamp(out ulong timestamp);
        int SetLastActivationTimestamp(ulong timestamp);
        int GetVirtualDesktopId(out Guid guid);
        int SetVirtualDesktopId(ref Guid guid);
        int GetShowInSwitchers(out int flag);
        int SetShowInSwitchers(int flag);
        int GetScaleFactor(out int factor);
        int CanReceiveInput(out bool canReceiveInput);
        int GetCompatibilityPolicyType(out APPLICATION_VIEW_COMPATIBILITY_POLICY flags);
        int SetCompatibilityPolicyType(APPLICATION_VIEW_COMPATIBILITY_POLICY flags);
        int GetSizeConstraints(IntPtr /* IImmersiveMonitor* */ monitor, out Size size1, out Size size2);
        int GetSizeConstraintsForDpi(uint uint1, out Size size1, out Size size2);
        int SetSizeConstraintsForDpi(ref uint uint1, ref Size size1, ref Size size2);
        int OnMinSizePreferencesUpdated(IntPtr hwnd);
        int ApplyOperation(IntPtr /* IApplicationViewOperation* */ operation);
        int IsTray(out bool isTray);
        int IsInHighZOrderBand(out bool isInHighZOrderBand);
        int IsSplashScreenPresented(out bool isSplashScreenPresented);
        int Flash();
        int GetRootSwitchableOwner(out IApplicationView rootSwitchableOwner);
        int EnumerateOwnershipTree(out IObjectArray ownershipTree);
        int GetEnterpriseId([MarshalAs(UnmanagedType.LPWStr)] out string enterpriseId);
        int IsMirrored(out bool isMirrored);
        int Unknown1(out int unknown);
        int Unknown2(out int unknown);
        int Unknown3(out int unknown);
        int Unknown4(out int unknown);
        int Unknown5(out int unknown);
        int Unknown6(int unknown);
        int Unknown7();
        int Unknown8(out int unknown);
        int Unknown9(int unknown);
        int Unknown10(int unknownX, int unknownY);
        int Unknown11(int unknown);
        int Unknown12(out Size size1);
    }

    [ComImport]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    [Guid("1841C6D7-4F9D-42C0-AF41-8747538F10E5")]
    private interface IApplicationViewCollection
    {
        int GetViews(out IObjectArray array);
        int GetViewsByZOrder(out IObjectArray array);
        int GetViewsByAppUserModelId(string id, out IObjectArray array);
        int GetViewForHwnd(IntPtr hwnd, out IApplicationView view);
        int GetViewForApplication(object application, out IApplicationView view);
        int GetViewForAppUserModelId(string id, out IApplicationView view);
        int GetViewInFocus(out IntPtr view);
        int Unknown1(out IntPtr view);
        void RefreshCollection();
        int RegisterForApplicationViewChanges(object listener, out int cookie);
        int UnregisterForApplicationViewChanges(int cookie);
    }

    [ComImport]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    [Guid("4CE81583-1E4C-4632-A621-07A53543148F")]
    private interface IVirtualDesktopPinnedApps
    {
        bool IsAppIdPinned(string appId);
        void PinAppID(string appId);
        void UnpinAppID(string appId);
        bool IsViewPinned(IApplicationView applicationView);
        void PinView(IApplicationView applicationView);
        void UnpinView(IApplicationView applicationView);
    }

    [ComImport]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    [Guid("6D5140C1-7436-11CE-8034-00AA006009FA")]
    private interface IServiceProvider10
    {
        [return: MarshalAs(UnmanagedType.IUnknown)]
        object QueryService(ref Guid service, ref Guid riid);
    }

    #endregion
}
