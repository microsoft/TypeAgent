// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Runtime.InteropServices;
using System.Windows;
using autoShell.Logging;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace autoShell.Services;

/// <summary>
/// Concrete implementation of <see cref="IVirtualDesktopService"/> using Windows COM APIs.
/// </summary>
internal class WindowsVirtualDesktopService : IVirtualDesktopService
{
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

    private readonly IServiceProvider10 _shell;
    private readonly IVirtualDesktopManagerInternal _virtualDesktopManagerInternal;
    private readonly IVirtualDesktopManagerInternal_BUGBUG _virtualDesktopManagerInternal_BUGBUG;
    private readonly IVirtualDesktopManager _virtualDesktopManager;
    private readonly IApplicationViewCollection _applicationViewCollection;
    private readonly IVirtualDesktopPinnedApps _virtualDesktopPinnedApps;
    private readonly ILogger _logger;

    public WindowsVirtualDesktopService(ILogger logger)
    {
        _logger = logger;
        _shell = (IServiceProvider10)Activator.CreateInstance(Type.GetTypeFromCLSID(s_clsidImmersiveShell));
        _virtualDesktopManagerInternal = (IVirtualDesktopManagerInternal)_shell.QueryService(s_clsidVirtualDesktopManagerInternal, typeof(IVirtualDesktopManagerInternal).GUID);
        _virtualDesktopManagerInternal_BUGBUG = (IVirtualDesktopManagerInternal_BUGBUG)_shell.QueryService(s_clsidVirtualDesktopManagerInternal, typeof(IVirtualDesktopManagerInternal).GUID);
        _virtualDesktopManager = (IVirtualDesktopManager)Activator.CreateInstance(Type.GetTypeFromCLSID(s_clsidVirtualDesktopManager));
        _applicationViewCollection = (IApplicationViewCollection)_shell.QueryService(typeof(IApplicationViewCollection).GUID, typeof(IApplicationViewCollection).GUID);
        _virtualDesktopPinnedApps = (IVirtualDesktopPinnedApps)_shell.QueryService(s_clsidVirtualDesktopPinnedApps, typeof(IVirtualDesktopPinnedApps).GUID);
    }

    /// <inheritdoc/>
    public void CreateDesktops(string jsonDesktopNames)
    {
        try
        {
            JArray desktopNames = JArray.Parse(jsonDesktopNames);

            if (desktopNames.Count == 0)
            {
                desktopNames = ["desktop X"];
            }

            if (_virtualDesktopManagerInternal == null)
            {
                _logger.Debug($"Failed to get Virtual Desktop Manager Internal");
                return;
            }

            foreach (JToken desktopNameToken in desktopNames)
            {
                string desktopName = desktopNameToken.ToString();

                try
                {
                    IVirtualDesktop newDesktop = _virtualDesktopManagerInternal.CreateDesktop();

                    if (newDesktop != null)
                    {
                        try
                        {
                            // TODO: debug & get working
                            // Works in .NET framework but not .NET
                            //s_virtualDesktopManagerInternal_BUGBUG.SetDesktopName(newDesktop, desktopName);
                        }
                        catch (Exception ex2)
                        {
                            _logger.Debug($"Created virtual desktop (naming not supported on this Windows version): {ex2.Message}");
                        }
                    }
                }
                catch (Exception ex)
                {
                    _logger.Debug($"Failed to create desktop '{desktopName}': {ex.Message}");
                }
            }
        }
        catch (JsonException ex)
        {
            _logger.Debug($"Failed to parse desktop names JSON: {ex.Message}");
        }
        catch (Exception ex)
        {
            _logger.Debug($"Error creating desktops: {ex.Message}");
        }
    }

    /// <inheritdoc/>
    /// <remarks>
    /// Currently may return ACCESS_DENIED on some configurations. TODO: investigate.
    /// </remarks>
    public void MoveWindowToDesktop(IntPtr hWnd, string desktopIdentifier)
    {
        if (hWnd == IntPtr.Zero)
        {
            _logger.Debug("Invalid window handle");
            return;
        }

        if (string.IsNullOrEmpty(desktopIdentifier))
        {
            _logger.Debug("No desktop id supplied");
            return;
        }

        if (int.TryParse(desktopIdentifier, out int desktopIndex))
        {
            _virtualDesktopManagerInternal.GetDesktops(out IObjectArray desktops);
            if (desktopIndex < 1 || desktopIndex > _virtualDesktopManagerInternal.GetCount())
            {
                _logger.Debug("Desktop index out of range");
                Marshal.ReleaseComObject(desktops);
                return;
            }
            desktops.GetAt(desktopIndex - 1, typeof(IVirtualDesktop).GUID, out object od);
            Guid g = ((IVirtualDesktop)od).GetId();
            _virtualDesktopManager.MoveWindowToDesktop(hWnd, ref g);
            Marshal.ReleaseComObject(desktops);
            return;
        }

        IVirtualDesktop ivd = FindDesktopByName(desktopIdentifier);
        if (ivd is not null)
        {
            Guid desktopGuid = ivd.GetId();
            _virtualDesktopManager.MoveWindowToDesktop(hWnd, ref desktopGuid);
        }
    }

    /// <inheritdoc/>
    public void NextDesktop()
    {
        BumpDesktopIndex(1);
    }

    /// <inheritdoc/>
    public void PinWindow(IntPtr hWnd)
    {
        if (hWnd != IntPtr.Zero)
        {
            _applicationViewCollection.GetViewForHwnd(hWnd, out IApplicationView view);

            if (view is not null)
            {
                _virtualDesktopPinnedApps.PinView(view);
            }
        }
        else
        {
            _logger.Warning("The window handle could not be found");
        }
    }

    /// <inheritdoc/>
    public void PreviousDesktop()
    {
        BumpDesktopIndex(-1);
    }

    /// <inheritdoc/>
    public void SwitchDesktop(string desktopIdentifier)
    {
        if (!int.TryParse(desktopIdentifier, out int index))
        {
            _virtualDesktopManagerInternal.SwitchDesktop(FindDesktopByName(desktopIdentifier));
        }
        else
        {
            SwitchDesktopByIndex(index);
        }
    }

    private void SwitchDesktopByIndex(int index)
    {
        _virtualDesktopManagerInternal.GetDesktops(out IObjectArray desktops);
        desktops.GetAt(index, typeof(IVirtualDesktop).GUID, out object od);

        // BUGBUG: different Windows versions use different COM interfaces for desktop switching.
        // Windows 11 22H2 (build 22621) and later use the updated "BUGBUG" interface.
        if (OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22621))
        {
            _virtualDesktopManagerInternal_BUGBUG.SwitchDesktopWithAnimation((IVirtualDesktop)od);
        }
        else if (OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22000))
        {
            // Windows 11 21H2 (build 22000)
            _virtualDesktopManagerInternal.SwitchDesktopWithAnimation((IVirtualDesktop)od);
        }
        else
        {
            // Windows 10 — use the original interface
            _virtualDesktopManagerInternal.SwitchDesktopAndMoveForegroundView((IVirtualDesktop)od);
        }

        Marshal.ReleaseComObject(desktops);
    }

    private void BumpDesktopIndex(int bump)
    {
        IVirtualDesktop desktop = _virtualDesktopManagerInternal.GetCurrentDesktop();
        int index = GetDesktopIndex(desktop);
        int count = _virtualDesktopManagerInternal.GetCount();

        if (index == -1)
        {
            _logger.Debug("Unable to get the index of the current desktop");
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

        SwitchDesktopByIndex(index);
    }

    private IVirtualDesktop FindDesktopByName(string name)
    {
        int count = _virtualDesktopManagerInternal.GetCount();

        _virtualDesktopManagerInternal.GetDesktops(out IObjectArray desktops);
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
        int count = _virtualDesktopManagerInternal.GetCount();

        _virtualDesktopManagerInternal.GetDesktops(out IObjectArray desktops);
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
}
