
// Enables your PC to discover and connect to other devices
export interface NetworkDiscovery {
    actionName: "NetworkDiscovery";
    id: "Device_Discovery";
    parameters: {        
        originalUserRequest: string;
        deviceType: string;
    };
}

// Turn on/off bluetooth
export interface BluetoothToggleAction {
  actionName: "BluetoothToggle";
  id: "Device_BluetoothRadioToggle";
  parameters: {
    originalUserRequest: string;
    enableBluetooth?: boolean;
  };
}

// Duplicate your screen to a connected display for mirrored viewing.
export interface ScreenDuplicationMode {
  actionName: "ScreenDuplicationMode";
  id: "Display_Duplicate";
  parameters: {        
    originalUserRequest: string;
    externalMonitor: string;
  };
}

// Share your internet connection
export interface InternetConnectionSharing {
  actionName: "InternetConnectionSharing";
  id: "Connections_InternetSharingEnabled";
  parameters: {
    originalUserRequest: string;
  };
}

// Adjusts the volume level for audio output on your Windows device.
export interface AdjustVolumeLevel {
  actionName: "AdjustVolumeLevel";
  id: "Audio_Output_VolumeValue";
  parameters: {
    originalUserRequest: string;
    volumeLevel?: number;
  };
}

// Adjust the screen resolution and aspect ratio for optimal display settings on your monitor.
export interface DisplayResolutionAndAspectRatio {
  actionName: "DisplayResolutionAndAspectRatio";
  id: "Display_Resolution";
  parameters: {
    originalUserRequest: string;
    resolutionChange: "increase" | "lower";
  };
}

// Select how your desktop background picture fits the screen.
export interface DesktopBackgroundFit {
  actionName: "DesktopBackgroundFit";
  id: "Personalize_Background_ChooseFit";
  parameters: {
    originalUserRequest: string;
    fitType: "center" | "stretch" | "fill" | "fit" | "tile" | "span";
  };
}

// Adjust the size of text, apps, and other items on your display for better readability and clarity.
export interface DisplayScaling {
    actionName: "DisplayScaling";
    id: "Display_Scaling_ItemSizeOverride";
    parameters: {       
        originalUserRequest: string;
        sizeOverride: string;
    };
}

// Adjusts the screen brightness level on your Windows device to enhance visibility and conserve battery life.
export interface AdjustScreenBrightnessAction {
  actionName: "AdjustScreenBrightness";
  id: "Display_Brightness";
  parameters: {
    originalUserRequest: string;
    brightnessLevel: "increase" | "decrease";
  };
}

// 'Adjusts the volume level for audio input devices, such as microphones, to control the sound input level on your Windows device.'
export interface AdjustMicrophoneVolumeAction {
    actionName: "adjustMicrophoneVolume";
    id: "Audio_Input_VolumeValue";
    parameters: {
        originalUserRequest: string;
        // The default delta is 5  
        volumeLevelDelta: number;
        actionType: "increase" | "decrease";
    };
}

// This setting allows your Windows device to automatically enable blue light reduction at scheduled times, helping to minimize eye strain during evening hours. By adjusting the screen's color temperature, it reduces the amount of blue light emitted, promoting better sleep and comfort during nighttime usage.
export interface EnableBlueLightFilterSchedule {
  actionName: "EnableBlueLightFilterSchedule";
  id: "Display_BlueLight_AutomaticOnScheduleWithTime";
  parameters: {    
    originalUserRequest: string;
    schedule: string;
    nightLightScheduleDisabled: boolean;
  };
}

// Adjusts the color temperature of the display to reduce blue light, helping to minimize eye strain and improve sleep quality.
export interface AdjustColorTemperature {
  actionName: "adjustColorTemperature";
  id: "Display_BlueLight_ColorTemperature";
  parameters: {
    originalUserRequest: string;
    filterEffect?: "reduce" | "increase";
  };
}

// to a
export interface WirelessDisplayConnection {
    actionName: "WirelessDisplayConnection";
    id: "Display_ConnectWireless";
    parameters: {
        originalUserRequest: string;
        deviceType: "wireless_monitor";
    };
}

// Adjust the speed at which the mouse cursor moves on the screen
export interface MouseCursorSpeedAction {
    actionName: "MouseCursorSpeed",
    id: "Input_Mouse_SetCursorSpeed",
    parameters: {
        originalUserRequest: string;
        speedLevel: number;
        reduceSpeed?: boolean;
    };
}

// Turn automatic time setting on/off
export interface AutomaticTimeSettingAction {
    actionName: "AutomaticTimeSettingAction";
    id: "DateTime_IsTimeSetAutomaticallyEnabled";
    parameters: {        
        originalUserRequest: string;
        enableAutoTimeSync: boolean;
    };
}

// Adjusts the brightness levels for multiple monitors connected to a Windows system.
export interface AdjustBrightnessLevels {
  actionName: "AdjustBrightnessLevels";
  id: "Display_Multimon_Brightness";
  parameters: {
    originalUserRequest: string;
    brightnessLevel: number; // Brightness level to be set
    monitorIds?: string[]; // Optional list of monitor IDs to be specifically adjusted
  };
}

// Adjust the text size on your desktop to make it easier to read by scaling fonts and app sizes.
export interface AdjustTextSize {
  actionName: "adjustTextSize";
  id: "EaseOfAccess_Experience_TextScalingDesktop";
  parameters: {
    originalUserRequest: string;
    textSize: string;
  };
}

// Turn WiFi on or off.
export interface EnableWifiAction {
    actionName: "enableWifi";
    id: "Network_Wifi_QuickAction";
    parameters: {
        originalUserRequest: string;
        enable: boolean;
    };
}

// Adjust the size of the mouse pointer for better visibility and accessibility.
export interface AdjustMousePointerSize {
    actionName: "AdjustMousePointerSize";
    id: "Accessibility_MouseCursorSize";
    parameters: {
        originalUserRequest: string;
        sizeAdjustment: "increase" | "decrease";
    };
}

// Automatically hide the taskbar
export interface AutoHideTaskbar {
  actionName: "AutoHideTaskbar";
  id: "Taskbar_Autohide";
  parameters: {
    originalUserRequest: string;
    hideWhenNotUsing: boolean;
    alwaysShow: boolean;
  };
}


// Enables high contrast themes to improve visibility for users with visual impairments by increasing color contrast and inverting colors.
export interface HighContrastTheme {
    actionName: "HighContrastTheme";
    id: "Accessibility_HighContrast";
    parameters: {
        originalUserRequest: string;
    };
}

// Enables dark or light mode across the entire system.
export interface SystemThemeMode {
  actionName: "SystemThemeMode";
  id: "Personalize_Color_ColorMode";
  parameters: {
    originalUserRequest: string;
    mode: "dark" | "light";
  };
}

// Change the mouse pointer color and style for better visibility and accessibility.
export interface MousePointerCustomization {
  actionName: "mousePointerCustomization";
  id: "Accessibility_MouseCursorColor";
  parameters: {
    originalUserRequest: string;
    color: string;
    style?: string;
  };
}

// Adjust the screen orientation between portrait and landscape modes in display settings.
export interface AdjustScreenOrientation {
  actionName: "AdjustScreenOrientation";
  id: "Display_Orientation";
  parameters: {
    originalUserRequest: string;
    orientation: 'portrait' | 'landscape';
  };
}

// 'This setting controls the visibility of the Widgets button on the Windows taskbar, allowing users to enable or disable the feature as per their preference.'
export interface ToggleWidgetsButtonVisibility {
    actionName: "ToggleWidgetsButtonVisibility";
    id: "DesktopTaskbar_Da";
    parameters: {
        originalUserRequest: string;
        visibility: "show" | "hide";
    };
}

// 'This setting controls the visibility of the Task View button on the Windows taskbar. Task View allows users to see all open windows and virtual desktops, enhancing multitasking capabilities. Adjusting this setting enables or disables the display of the Task View button, impacting how users manage their active tasks and timelines.'
export interface TaskViewVisibilityAction {
  actionName: "TaskViewVisibility";
  id: "DesktopTaskbar_TaskView";
  parameters: {
    originalUserRequest: string;
    visibility: boolean;
  }
}

// this setting allows desktop applications to access your microphone, enabling them to capture audio for various functionalities.
export interface ManageMicrophoneAccess {
    actionName: "ManageMicrophoneAccess";
    id: "CapabilityAccess_Microphone_SystemGlobal";
    parameters: {        
        originalUserRequest: string;
        accessSetting: "allow" | "deny";
    };
}

// Control the alignment of the taskbar between left and center
export interface TaskbarAlignmentAction {
    actionName: "TaskbarAlignment";
    id: "DesktopTaskbar_Al";
    parameters: {
        originalUserRequest: string;
        alignment: "left" | "center";
    };
}

// 'MusUpdate_ContinuousInnovationOptin is a Windows setting that allows users to opt into continuous innovation updates for Microsoft products. When enabled, it ensures that users receive the latest features and improvements as they become available, rather than waiting for major version releases. This setting is aimed at users who prefer to stay up-to-date with the latest enhancements and functionalities.'
export interface MusUpdateContinuousInnovationOptin {
  actionName: "MusUpdateContinuousInnovationOptin";
  id: "MusUpdate_ContinuousInnovationOptin";
  parameters: {
    originalUserRequest: string;
    pcPreference: string;
  };
}

// Set the number of lines to scroll with each notch of the mouse wheel.
export interface MouseWheelScrollLines {
    actionName: "MouseWheelScrollLines";
    id: "Input_Mouse_SetScrollLines";
    parameters: {
        originalUserRequest: string;
        scrollLines: number;
    };
}

// The Metered Connection setting allows users to designate a network as metered, meaning Windows and apps will try to reduce data usage when connected to this network. This can help prevent excessive data consumption, especially on limited or mobile data plans.
export interface EnableMeteredConnectionsAction {
  actionName: "enableMeteredConnections";
  id: "Device_DsmDownloadOverMeteredConnections";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// The setting allows users to adjust lighting colors, brightness, and effects on desktop devices. It provides access to dynamic lighting settings, enabling customization of the visual experience according to personal preferences.
export interface AdjustDynamicLighting {
  actionName: "AdjustDynamicLighting";
  id: "Devices_DLToggle";
  parameters: { 
    originalUserRequest: string; 
    dynamicLightingStatus: boolean;
  };
}

// The 'Enable Transparency' setting in Windows allows users to adjust the transparency levels of various interface elements. When activated, it enhances visual aesthetics by allowing background elements to show through, creating a translucent effect on taskbars, menus, and other UI components. Users can toggle this feature to either enhance or reduce transparency according to their preferences.
export interface EnableTransparencyAction {
  actionName: "EnableTransparency";
  id: "Personalize_Color_EnableTransparency";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// Optimize device based on power use and performance when its plugged in
export interface SetPowerModePluggedIn {
  actionName: "setPowerModePluggedIn";
  id: "PowerAndBattery_PowerModes_AC";
  parameters: {
    originalUserRequest: string;
    powerMode: "bestPerformance"; 
  };
}

// The On-Screen Keyboard (OSK) is an accessibility feature in Windows that provides a virtual keyboard on the screen, allowing users to input text using a mouse, touch, or other pointing devices. It supports various input methods, including hover and scan modes, making it ideal for individuals with mobility impairments. Users can customize settings for enhanced usability through Ease of Access options.
export interface EnableOnScreenKeyboard {
  actionName: "EnableOnScreenKeyboard";
  id: "Accessibility_Keyboard_IsOSKEnabled";
  parameters: {
    originalUserRequest: string;
  };
}

// This setting enables Quiet Hours, allowing users to mute notifications during specified times. When activated, notifications will be sent directly to notification center, ensuring a distraction-free environment. Users can customize the hours during which notifications are muted, helping to maintain focus or rest without interruptions from alerts or messages.
export interface EnableQuietHours {
  actionName: "EnableQuietHours";
  id: "Notifications_QuietHours_MuteNotification_Enabled";
  parameters: {
    originalUserRequest: string;
    startHour?: number;
    endHour?: number;
  };
}

// This setting allows you to enable or disable the touchpad on a desktop computer. It provides options for managing touchpad functionality, ensuring that users can control whether the touchpad is active or inactive based on their preferences.
export interface EnableTouchPad {
    actionName: "EnableTouchPad";
    id: "Input_Touch_EnableTouchPad";
    parameters: {        
        originalUserRequest: string;
        enable: boolean;
    };
}

// This setting allows Windows to automatically manage your default printer based on your usage patterns. When enabled, Windows will select the printer that you used most recently in your current location, streamlining the printing process without the need for manual selection.
export interface LetWindowsManageDefaultPrinterAction {
  actionName: "LetWindowsManageDefaultPrinter";
  id: "DefaultPrinterManagedByWindows";
  parameters: {
    originalUserRequest: string;
    enabled: boolean
  };
}

// This setting allows users to enable or disable automatic proxy detection on desktop devices. When turned on, the system can automatically find and configure proxy settings, streamlining internet access and enhancing network connectivity.
export interface AutomaticProxyDetection {
  actionName: "AutomaticProxyDetection";
  id: "Proxy_AutomaticDetection";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// This setting allows users to apply a color to the title bar of desktop applications in Windows. It is part of the personalization options, enabling customization of the desktop appearance by adjusting the color scheme to enhance visual aesthetics.
export interface ApplyColorToTitleBar {
  actionName: "ApplyColorToTitleBar";
  id: "Personalize_Color_ColorPrevalenceTitleBar";
  parameters: {
    originalUserRequest: string;
    enableColor: boolean;
  };
}

// This setting allows Windows to remember the positions of application windows based on the current monitor configuration. When connecting or disconnecting displays, it restores the previously saved layout, ensuring that applications appear in their designated locations, enhancing the user experience with multiple monitors.
export interface RememberWindowLocationsAction {
  actionName: "RememberWindowLocations";
  id: "Display_MultiDisplay_RWTest";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// Optimize device based on power use and performance when its using battery
export interface SetPowerModeOnBattery {
    actionName: "SetPowerModeOnBattery";
    id: "PowerAndBattery_PowerModes_DC";
    parameters: {
        originalUserRequest: string;
        mode?: string;
    };
}

// Adjusts the battery level percentage at which Battery Saver mode activates to conserve power.
export interface BatterySaverActivationLevel {
  actionName: "BatterySaverActivationLevel";
  id: "BatterySaver_SettingsPage_ThresholdValue";
  parameters: {
    originalUserRequest: string;
    thresholdValue: number;
  };
}

// The 'Devices DL Global Controlled By Foreground App Toggle' setting allows applications running in the foreground to manage and control device settings, such as audio output and input devices. When enabled, the active app can take precedence over background processes, ensuring a seamless user experience by prioritizing the device interactions of the currently focused application.
export interface DevicesDlGlobalControlledByForegroundAppToggleAction {
  actionName: "DevicesDlGlobalControlledByForegroundAppToggle",
  id: "Devices_DLGlobalControlledByForegroundAppToggle",
  parameters: {
    originalUserRequest: string;
    enabled: boolean;
  };
}


// This setting controls the display of badges on the taskbar icons in Windows. Badges are small notifications that indicate the status of an application, such as unread messages or alerts. Enabling this feature allows users to quickly see important updates without needing to open the applications.
export interface ShowBadgesOnTaskbar {
  actionName: "ShowBadgesOnTaskbar";
  id: "Taskbar_Badging";
  parameters: {
    originalUserRequest: string;
    enableBadging?: boolean;
  };
}


// Select what the primary mouse button is
export interface SetPrimaryMouseButton {
  actionName: "setPrimaryMouseButton";
  id: "Input_Mouse_SetButtonConfiguration";
  parameters: {
    originalUserRequest: string;
    primaryButton: "left" | "right";
  };
}

// 'Sticky Keys is an accessibility feature in Windows that allows users to press keyboard modifier keys (like Shift, Ctrl, or Alt) one at a time instead of holding them down. This is particularly helpful for individuals with mobility challenges. When enabled, it provides audio alerts and options for locking modifier keys, enhancing ease of access to keyboard commands.'
export interface EnableStickyKeysAction {
    actionName: "enableStickyKeys";
    id: "Accessibility_Keyboard_IsStickyKeysEnabled";
    parameters: {
        originalUserRequest: string;
        enable: boolean;
    };
}

// 'Game Mode is a Windows setting designed to optimize your PC for gaming by prioritizing system resources for games, reducing background activity, and enhancing performance. When enabled, it helps improve frame rates and overall gaming experience by ensuring that the game runs smoothly without interruptions from other applications.'
export interface EnableGameMode {
    actionName: "enableGameMode";
    id: "Gaming_GameMode_Toggle";
    parameters: {
        originalUserRequest: string;
    };
}

// The Touch Indicator setting allows users to enable visual feedback for touch interactions on desktop devices by providing larger and darker visual cues when touch inputs are detected, making it easier to see where the screen is being touched.
export interface EnableEnhancedVisualFeedback {
  actionName: "enableEnhancedVisualFeedback";
  id: "Input_Touch_EnableVisualFeedbackPM";
  parameters: {
    originalUserRequest: string;
    feedbackType: string;
  };
}

// This setting minimizes all windows automatically when a monitor is disconnected from the system. It is useful in multi-display configurations, ensuring a clean workspace when docking or undocking devices. Keywords associated with this feature include monitor disconnected, minimizing apps, and multiple displays.
export interface MinimizeWindowsOnMonitorDisconnectAction {
  actionName: "MinimizeWindowsOnMonitorDisconnect";
  id: "Display_MultiDisplay_MWTest";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// 'The CapabilityAccess_Camera_ClassicGlobal setting in Windows pertains to the permissions management for camera access across applications. It allows users to control which apps can use the camera, providing a way to enhance privacy and security by restricting access to the camera functionality globally or for specific applications.'
export interface ManageCameraAccess {
    actionName: "ManageCameraAccess";
    id: "CapabilityAccess_Camera_SystemGlobal";
    parameters: {        
        originalUserRequest: string;
        enableCameraAccess: boolean;
    };
}

// this setting allows the user to enable or disable the energy saver feature to always be on, helping to conserve battery life by reducing power usage.
export interface EnergySaverToggle {
  actionName: "EnergySaverToggle";
  id: "PowerAndBattery_EnergySaverAlwaysOn";
  parameters: {
    originalUserRequest: string;
    mode: "on" | "off";
  };
}

// The SysTray Chevron Toggle setting controls the visibility of the overflow menu in the system tray (notification area) of the Windows taskbar. When enabled, it allows users to easily access additional icons that are not displayed directly in the tray, helping to manage space and keep the taskbar organized.
export interface SysTrayChevronToggle { 
  actionName: "SysTrayChevronToggle"; 
  id: "SysTray_Chevron_Toggle"; 
  parameters: { 
    originalUserRequest: string;
    action: 'enable' | 'disable'; 
  }; 
}

// Adjust the speed of the cursor movement when using the touchpad.
export interface TouchpadCursorSpeed {
  actionName: "TouchpadCursorSpeed";
  id: "Input_Touch_CursorSpeed";
  parameters: {
    originalUserRequest: string;
    cursorSpeed: string;
  };
}

// this setting automatically manages color settings for apps to enhance visual performance and ensure consistent color representation across applications.
export interface ManageColorForApps {
  actionName: "ManageColorForApps";
  id: "Display_AdvancedColorSupportAcm";
  parameters: {
    originalUserRequest: string;
  };
}

// this setting allows users to improve mouse pointer movement accuracy by enabling acceleration based on the speed of mouse movements.
export interface EnhancePointerPrecision {
    actionName: "EnhancePointerPrecision";
    id: "Input_Mouse_Acceleration";
    parameters: {
        originalUserRequest: string;
        enable: boolean;
    };
}

// 'The 'Show flashing on the taskbar' setting controls whether applications can flash their icons in the taskbar to alert users of notifications or events. This feature helps draw attention to specific programs or messages when they require user interaction, enhancing productivity and ensuring important alerts are not missed.'
export interface FlashingTaskbarIcons {
  actionName: "FlashingTaskbarIcons";
  id: "DesktopTaskbar_Flashing";
  parameters: {
    originalUserRequest: string;
  };
}

// This setting controls the brightness dimming feature in Battery Saver mode on Windows devices. When enabled, it automatically reduces screen brightness to conserve battery life when the device is running low on power, helping to extend usage time before needing a recharge.
export interface EnableBrightnessDimming {
  actionName: "EnableBrightnessDimming";
  id: "BatterySaver_SettingsPage_BrightnessDimmingEnabled";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// This setting controls whether the lock screen background picture is displayed on the sign-in screen. Enabling it allows users to see the same background on both the lock screen and the sign-in screen, enhancing the visual continuity of the desktop personalization.
export interface LogonScreenBackgroundUseColor {
  actionName: "LogonScreenBackgroundUseColor";
  id: "Personalize_LogonScreenBackgroundUseColor";
  parameters: {
    originalUserRequest: string;
    enableColorForLogonScreenBackground: boolean;
  };
}

// Adjust the size of the text cursor indicator for better visibility.
export interface TextCursorIndicatorSize {
    actionName: "TextCursorIndicatorSize";
    id: "Accessibility_CursorIndicator_IndicatorType";
    parameters: {
        originalUserRequest: string;
        size: "larger" | "smaller";
    };
}

// The Color Filtering setting allows users to enable or disable color filters to assist individuals with color blindness or other visual impairments. It offers options such as inverting colors, applying grayscale, and adjusting colors to improve visibility. This feature is part of the accessibility tools in Windows, enhancing the user experience for those with specific visual needs.
export interface EnableColorFiltering {
  actionName: "EnableColorFiltering";
  parameters: {
    originalUserRequest: string;
    id: "Accessibility_ColorFiltering_IsEnabled";
    enabled: boolean;
  };
}

// 'The Cursor Deadzone Jumping setting facilitates smoother cursor movement across multiple displays by reducing the snapping effect at monitor edges. This helps prevent the cursor from accidentally jumping to another screen or getting lost when moving between displays, enhancing the user experience in a multi-monitor setup.'
export interface EnableCursorDeadzoneJumping {
    actionName: "EnableCursorDeadzoneJumping";
    id: "Display_MultiDisplay_CursorDeadzoneJumping";
    parameters: {
        originalUserRequest: string;
        status: "enable" | "disable";
    };
}

// The Sticky Keys feature in Windows allows users to press keyboard shortcuts one key at a time instead of simultaneously. When the StickyShortcutEnabled setting is activated, it enables this functionality, making it easier for individuals with mobility challenges to use keyboard shortcuts by reducing the need for multiple key presses at once.
export interface EnableStickyShortcut {
    actionName: "enableStickyShortcut";
    id: "Accessibility_Keyboard_StickyShortcutEnabled";
    parameters: {
        originalUserRequest: string;
        enableStickyKeys: boolean;
    };
}

// This setting allows users to enable or disable the display of seconds in the system tray clock on the desktop. By adjusting this setting, users can choose whether to show the seconds in the clock for more precise timekeeping or to hide them for a cleaner appearance.
export interface DisplaySecondsInSystrayClock {
  actionName: "DisplaySecondsInSystrayClock";
  id: "DesktopTaskbar_SecondsInSystrayClock";
  parameters: {
    originalUserRequest: string;
    showSeconds: boolean;
  };
}

// This setting allows users to configure VPN usage over metered networks on desktop devices. When enabled, it permits the VPN to operate even when the network connection has data usage limits, providing flexibility for users who need secure connections without exceeding their data caps.
export interface AllowVpnOverMeteredNetworks {
  actionName: "allowVpnOverMeteredNetworks";
  id: "Vpn_Costed_Slider";
  parameters: {
    originalUserRequest: string;
    status: "enable" | "disable";
  };
}

// 'Airplane mode is a Windows setting that allows users to quickly disable all wireless communication, including Wi-Fi, Bluetooth, and cellular connections, with a single toggle. This feature is useful for conserving battery life or complying with airline regulations. It can be easily turned on or off from the settings app on desktop devices.'
export interface AirplaneModeEnabled {
    actionName: "AirplaneModeEnabled";
    id: "Radio_IsAirplaneModeEnabled_SettingsApp";
    parameters: {
        originalUserRequest: string;
        enable: boolean;
    };
}

// 'MusUpdate_RestartNotifications is a Windows setting that controls the notification system related to system restarts required for updates. When enabled, it alerts users about pending restarts due to updates, helping them manage their time and minimize disruptions. This setting ensures users are informed about necessary actions to maintain system security and performance.'
export interface MusUpdateRestartNotifications {
  actionName: "MusUpdateRestartNotifications";
  id: "MusUpdate_RestartNotifications";
  parameters: {
    originalUserRequest: string;
    enableNotifications: boolean;
  };
}

// The Wi-Fi Randomization Toggle allows users to enable or disable the use of random hardware addresses for Wi-Fi connections. When activated, this feature enhances privacy by preventing tracking based on the device's MAC address. It applies to desktop systems and is found within the internet and network settings.
export interface EnableRandomMacAddress {
  actionName: "enableRandomMacAddress";
  id: "Connections_Wifi_Randomization_Toggle";
  parameters: {
    originalUserRequest: string;
    toggleState: boolean;
  };
}

// The Personalize_LockScreenOverlayEnabled setting allows users to enable or disable overlays on the lock screen, such as widgets or notifications. When enabled, this feature provides quick access to information without unlocking the device, enhancing user convenience while maintaining security.
export interface PersonalizeLockScreenOverlayEnabledAction {
  actionName: "PersonalizeLockScreenOverlayEnabled";
  id: "Personalize_LockScreenOverlayEnabled";
  parameters: {
    originalUserRequest: string;
    overlayEnabled: boolean;
  };
}

// 'this setting allows users to enable or disable location access for apps and services on their device, ensuring control over personal location data.'
export interface ManageLocationAccess {
  actionName: "ManageLocationAccess";
  id: "CapabilityAccess_Location_UserGlobal";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  }; 
}

// 'This setting enables text suggestions while typing on a hardware keyboard. When activated, it displays predictive text options to enhance typing efficiency, helping users select words or phrases as they type.'
export interface EnableTextPrediction {
  actionName: "enableTextPrediction";
  id: "Keyboard_IsHwkbTextPredictionEnabled_DeviceTyping";
  parameters: {
    originalUserRequest: string;
    isEnabled: boolean;
  };
}

// The Game Bar Nexus Button settings allow users to configure the Game Bar controller functionalities on desktop. This includes options for managing game-related features and shortcuts, enhancing the gaming experience with Xbox and wireless controllers.
export interface CustomizeNexusButton {
  actionName: "CustomizeNexusButton";
  id: "Gaming_GameBar_NexusButton";
  parameters: {
    originalUserRequest: string;
    enableCustomization: boolean;
  };
}

// The Ink Workspace setting allows you to toggle the visibility of the pen menu icon on the desktop taskbar.
// This feature provides quick access to pen-related tools and functions, enhancing your experience with pen input devices.
// You can enable or disable the pen icon according to your preference, making it easier to access pen settings and features directly from the taskbar.
export interface TogglePenMenuIcon {
    actionName: "TogglePenMenuIcon";
    parameters: {
        originalUserRequest: string;
        toggleAction: "turnOn" | "turnOff";
        id: "DesktopTaskbar_InkWorkspace";
    };
}

// This setting controls the visibility of the 'Show Desktop' button on the taskbar in Windows. When enabled, users can quickly minimize all open windows and view the desktop with a single click.
export interface ShowDesktopButtonVisibility {
    actionName: "ShowDesktopButtonVisibility";
    id: "DesktopTaskbar_Sd";
    parameters: {
        originalUserRequest: string;
        visibility: "enable" | "disable";
    };
}

// 'The 'Allow VPN while roaming' setting enables the use of Virtual Private Network (VPN) connections when your device is on a roaming network. This option is found in the advanced VPN settings and is applicable to desktop environments, allowing users to maintain secure internet access even when connected to mobile networks outside their home area.'
export interface AllowVpnWhileRoamingAction {
  actionName: "AllowVpnWhileRoaming";
  id: "Vpn_Roaming_Slider";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// Determines how much to scroll when the user rolls their wheel
export interface SetMouseScroll {
    actionName: "SetMouseScroll";
    id: "Input_Mouse_SetScrollPage";
    parameters: {
        originalUserRequest: string;
        scrollType: "multipleLines" | "screen" | "singleLine";
    };
}

// 'The Background Slideshow Shuffle setting allows users to enable or disable the randomization of images in the desktop background slideshow. When activated, images will appear in a random order rather than sequentially, providing a dynamic and varied visual experience. This setting enhances personalization by allowing users to enjoy different wallpapers without repetition.'
export interface BackgroundSlideshowShuffle {
  actionName: "backgroundSlideshowShuffle";
  id: "Personalize_Background_SlideshowShuffle";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// The Touch Enable Visual Feedback setting in Windows allows users to see visual cues when they interact with the touchscreen.
export interface EnableVisualFeedbackForTouch {
  actionName: "enableVisualFeedbackForTouch";
  id: "Input_Touch_EnableVisualFeedback";
  parameters: {
    originalUserRequest: string;
    feedbackEnabled: boolean;
  };
}

// 'this setting allows users to enable HDR video streaming even when HDR is turned off, enhancing the video playback experience.'
export interface HdrVideoStreamingToggle {
    actionName: "HdrVideoStreamingToggle";
    id: "Video_HDRPlayback";
    parameters: {        
        originalUserRequest: string;
        enable: boolean;
    };
}

// 'Filter Keys is an accessibility feature in Windows that helps prevent accidental keystrokes by ignoring brief or repeated key presses. When enabled, it allows users to adjust the delay before a key press is accepted and to filter out unintentional keystrokes. This setting is particularly useful for individuals with motor difficulties, ensuring a smoother typing experience by minimizing errors.'
export interface EnableFilterKeysAction {
    actionName: "EnableFilterKeys";
    id: "Accessibility_Keyboard_IsFilterKeysEnabled";
    parameters: {
        originalUserRequest: string;
        enable: boolean;
    };
}

// 'This setting controls the visibility of recently opened files in the Start menu, File Explorer, and Jump Lists. It allows users to manage how recent items are displayed, enhancing quick access to frequently used files and applications.'
export interface DisplayRecentlyOpenedItems {
    actionName: "displayRecentlyOpenedItems";
    id: "Start_StoreRecentlyOpenedItems";
    parameters: {
        originalUserRequest: string;
        enable: boolean;
    };
}

// This Windows setting controls the visibility of the Share button in the window preview feature. It allows users to share content from any window via the Share option, which can be useful for applications like Teams. The setting affects the desktop environment and is related to thumbnail previews and flyout menus.
export interface ShowShareButtonAction {
  actionName: "ShowShareButton";
  id: "DesktopTaskbar_Sn";
  parameters: {
    originalUserRequest: string;
    enableShareButton: boolean;
  };
}


// This setting allows you to enable or disable automatic adjustments for daylight saving time on your Windows desktop. When enabled, the system will automatically shift the clock forward or backward as required by daylight saving time changes.
export interface AutomaticDSTAdjustment {
  actionName: "AutomaticDSTAdjustment";
  id: "DateTime_IsAutomaticDSTAdjustEnabled";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// The Multilingual text suggestions setting enhances typing by providing suggestions in multiple languages. This feature is designed for desktop use and can be accessed through keyboard and typing settings, allowing users to receive contextually relevant word suggestions based on their selected languages.
export interface MultilingualEnable {
  actionName: "MultilingualEnable";
  id: "Multilingual_MultilingualEnable";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// Dynamic Lock is a Windows feature that automatically locks your PC when you step away, using a paired Bluetooth device, such as your smartphone. When the device moves out of range, the system locks, enhancing security by preventing unauthorized access. This setting is found under lock settings in the system settings menu.
export interface EnableDynamicLock {
  actionName: "EnableDynamicLock";
  id: "Users_DynamicLock";
  parameters: {
    originalUserRequest: string;
  };
}

// The Passwordless Sign-in setting allows users to enable or disable the option to sign in to their Windows desktop without using a password. This feature enhances security and convenience by allowing alternative authentication methods, such as biometrics or security keys, for accessing the system.
export interface PasswordLessSignInAction {
  actionName: "passwordLessSignIn";
  id: "Users_PasswordLessSignIn";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// 'The 'Show recently added apps' setting in the Start menu allows users to view newly installed applications directly on the desktop interface. This feature helps users quickly access and launch recently added apps, enhancing the overall user experience by keeping important tools readily accessible.'
export interface ShowRecentlyAddedApps {
  actionName: "ShowRecentlyAddedApps";
  id: "Start_ShowRecentlyAddedAppsGroup";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// The Text Cursor Indicator setting enhances visibility by displaying a visible marker at the text cursor's location, making it easier for users to locate the insertion point. This feature is especially beneficial for individuals who have difficulty seeing the standard blinking cursor, improving accessibility and usability in text input areas.
export interface EnableCursorIndicator {
    actionName: "EnableCursorIndicator";
    id: "Accessibility_CursorIndicator_IsEnabled";
    parameters: {
        originalUserRequest: string;
        enable: boolean;
    };
}

// Adjust the size of the touch keyboard on your device.
export interface AdjustTouchKeyboardSize {
  actionName: "AdjustTouchKeyboardSize";
  id: "Personalize_TouchKeyboard_Keyboard_Scale";
  parameters: { 
    originalUserRequest: string;
    adjustmentType: "increase" | "decrease";
  };
}

// 'this setting allows users to enable or disable recommendations for tips, shortcuts, new apps, and more in the Start menu.'
export interface ShowRecommendations {
  actionName: "ShowRecommendations";
  id: "Start_IrisRecommendations";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// Toggle Keys is an accessibility feature in Windows that plays a sound when the Caps Lock, Num Lock, or Scroll Lock keys are pressed. This helps users with visual impairments or those who need audio confirmation of their keyboard inputs. It can be enabled through the Ease of Access settings under keyboard options.
export interface ToggleKeysEnabled {
  actionName: "ToggleKeysEnabled";
  id: "Accessibility_Keyboard_IsToggleKeysEnabled";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// The Keyboard Language Bar Selection setting allows users to choose and manage the input languages and keyboard layouts available on their Windows system. This setting enables easy switching between different languages and keyboard configurations for typing, enhancing accessibility for multilingual users.
export interface KeyboardLanguageBarSelectionAction {
  actionName: "keyboardLanguageBarSelection";
  id: "Keyboard_LanguageBarSelection";
  parameters: {
    originalUserRequest: string;
    enableDisable: "enable" | "disable";
  };
}

// The Rotation Lock setting allows you to enable or disable the automatic rotation of your display between portrait and landscape modes. When activated, the screen orientation remains fixed regardless of how you physically position the device, making it useful for maintaining a consistent view while using applications or reading content.
export interface RotationLock {
  actionName: "RotationLock";
  parameters: {
    originalUserRequest: string;
    id: "Display_IsRotationLocked";
    enable: boolean;
  };
}

// 'Keyboard Input Language Switching allows users to change the input language or keyboard layout while typing. This feature enables easy switching between multiple languages or layouts configured in Windows, typically using a keyboard shortcut like Alt + Shift or Windows key + Space. It enhances multilingual typing efficiency and supports diverse language input for users.'
export interface KeyboardInputLanguageSwitching {
    actionName: "KeyboardInputLanguageSwitching";
    id: "Keyboard_InputLanguageSwitching";
    parameters: {
        originalUserRequest: string;
        // Define whether to allow or disable different input methods for each app
        allowDifferentInputMethods: boolean;
    };
}

// The 'Show taskbar on all displays' setting allows the taskbar to be visible on multiple monitors connected to a desktop. This feature enhances productivity by providing easy access to applications and system notifications across all screens, making multitasking more efficient for users with multi-monitor setups.
export interface DisplayTaskbarOnAllMonitors {
    actionName: "DisplayTaskbarOnAllMonitors";
    id: "Taskbar_MultiMon";
    parameters: {
        originalUserRequest: string;
        enable: boolean;
        disable: boolean;
    };
}

// 'this setting allows users to enable or disable mono audio, ensuring that sound is played equally through both left and right channels for accessibility purposes.'
export interface MonoAudioToggle {
  actionName: "MonoAudioToggle";
  id: "Accessibility_IsAudioMonoMixStateEnabled";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// The 'Show most used apps' setting in Windows allows users to display their frequently used applications in the Start menu.
// This feature helps enhance productivity by providing quick access to commonly used programs directly from the Start screen.
export interface ShowMostUsedAppsAction {
  actionName: "ShowMostUsedApps";
  id: "Start_ShowMostUsedApps";
  parameters: {        
    originalUserRequest: string;
    enable: boolean;
  };
}

// The Remote Desktop setting allows users to enable or disable Remote Desktop connections to their Windows computer. When enabled, users can connect remotely to their system using Remote Desktop Protocol (RDP), facilitating remote management and access. This setting is crucial for IT support, remote work, and accessing files and applications from different locations.
export interface ToggleRemoteDesktopAction {
  actionName: "ToggleRemoteDesktop";
  id: "RemoteDesktop_ToggleRemoteDesktop";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// 'This setting controls the global Auto HDR feature for the entire system.When enabled, Windows will automatically apply HDR enhancements to SDR content on an HDR-compatible display.This is a higher-level setting that applies Auto HDR system-wide, unlike the Graphics Settings version, which allows per-app control.'
export interface AutoHDRToggle {
    actionName: "AutoHDRToggle";
    id: "Display_AdvancedColorSupportAutoHDR";
    parameters: {
        originalUserRequest: string;
        enable: boolean;
    };
}

// This setting allows users to scroll inactive windows by hovering the mouse cursor over them, enhancing multitasking efficiency without needing to click to activate a window first. It's part of the mouse settings that improve the scrolling experience on the desktop.
export interface ScrollInactiveWindowsAction {
  actionName: "ScrollInactiveWindows";
  id: "Input_Mouse_WheelRouting";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// 'The USB Error Notification setting allows users to receive alerts when there are problems connecting to USB devices. This feature helps in quickly identifying and addressing connection issues, ensuring a smoother experience with USB peripherals.'
export interface UsbErrorNotify {
  actionName: "UsbErrorNotify";
  id: "Usb_ErrorNotify";
  parameters: {
    originalUserRequest: string;
    enabled: boolean;
  };
}

// 'The 'Automatically turn off mobile hotspot' setting allows the system to disable the mobile hotspot feature when it is no longer in use. This helps conserve battery life and data usage on the device. It is applicable to desktop settings and falls under various network-related categories, ensuring efficient management of internet sharing functionalities.'
export interface AutomaticallyTurnOffMobileHotspot {
  actionName: "AutomaticallyTurnOffMobileHotspot";
  id: "Connections_InternetSharingAutoTurnOff";
  parameters: {
    originalUserRequest: string;
  };
}

// 'The Sticky Keys feature in Windows allows users to press keyboard shortcuts sequentially instead of simultaneously. When the Sticky Two Key Press setting is enabled, users can activate keyboard shortcuts that require pressing two keys at once by pressing the keys one after the other, making it easier for individuals with mobility impairments to use keyboard commands.'
export interface EnableStickyTwoKeyPress {
  actionName: "EnableStickyTwoKeyPress";
  id: "Accessibility_Keyboard_StickyTwoKeyPressEnabled";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// 'Sticky Keys is an accessibility feature in Windows that allows users to press one key at a time for keyboard shortcuts instead of holding multiple keys simultaneously. When enabled, it helps individuals with mobility impairments by simplifying the use of modifier keys like Shift, Ctrl, and Alt. The setting 'StickyLockModifierEnabled' indicates whether this feature is activated.'
export interface EnableStickyLockModifier {
    actionName: "EnableStickyLockModifier";
    id: "Accessibility_Keyboard_StickyLockModifierEnabled";
    parameters: {
        originalUserRequest: string;
        enable: boolean;
    };
}

// 'The Sticky Keys feature in Windows allows users to press modifier keys (like Shift, Ctrl, or Alt) one at a time instead of simultaneously. When the Sticky Indicator is enabled, a visual cue appears on the screen, indicating that Sticky Keys is active, helping users understand that the feature is in use and providing better accessibility for those with mobility impairments.'
export interface StickyKeysIndicatorEnabled {
  actionName: "StickyKeysIndicatorEnabled";
  id: "Accessibility_Keyboard_StickyIndicatorEnabled";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// The Auto Enhance setting for video automatically processes and improves video quality during playback on desktop devices. It enhances aspects such as brightness, contrast, and color accuracy to provide a better viewing experience, especially for HDR content.
export interface AutoEnhanceVideoAction {
    actionName: "autoEnhanceVideo";
    parameters: {
        originalUserRequest: string;
        id: "Video_AutoEnhance";
        enabled: boolean;
    };
}

// Determine whether a downward motion scrolls up or down
export interface SetMouseReverseWheelDirectionAction {
  actionName: "SetMouseReverseWheelDirection";
  id: "Input_Mouse_ReverseWheelDirection";
  parameters: {
    originalUserRequest: string;
  };
}

// This setting enables or disables Auto HDR (High Dynamic Range) for compatible applications, enhancing the visual quality of games and videos by providing a wider range of colors and brightness levels.
export interface AutoHDRInGraphicsSettingAction {
  actionName: "AutoHDRInGraphicsSetting";
  id: "Display_AdvancedColorSupportAutoHDR_GraphicsSettings";
  parameters: {
    originalUserRequest: string;
    enableHDR: boolean;
  };
}

// This setting allows users to control whether websites can access and utilize the language preferences specified in their language list. It enhances web content control by enabling or disabling the use of preferred languages for a more personalized browsing experience.
export interface WebContentControl {
  actionName: "WebContentControl";
  id: "Language_Web_Content_Control";
  parameters: {
    originalUserRequest: string;
    enableLanguageAccess: boolean;
  };
}

// This setting allows you to disable suggested content within the Settings app on your desktop. By turning off suggestions, you can enhance your privacy by preventing personalized recommendations from appearing, ensuring a more streamlined and focused experience while navigating through your system settings.
export interface EnableSuggestionsInSettingsAction {
  actionName: "EnableSuggestionsInSettings";
  id: "Privacy_EnableSuggestionsInSettings";
  parameters: {
    originalUserRequest: string;
    enableSuggestions: boolean;
  };
}

// 'This setting enables or disables the sound feedback for sticky keys when modifier keys (Shift, Ctrl, Alt) are pressed. When enabled, a sound will play to indicate that a sticky key has been activated, assisting users who may have difficulty with keyboard input.'
export interface EnableStickyModifierSound {
    actionName: "EnableStickyModifierSound";
    id: "Accessibility_Keyboard_StickyModifierSoundEnabled";
    parameters: {
        originalUserRequest: string;
        enable: boolean;
    };
}

// This setting allows Windows to track app launches to enhance the Start menu and search results. By enabling this feature, users can receive personalized suggestions based on their frequently used applications, improving overall navigation and accessibility. However, it may raise privacy concerns as it involves data collection regarding app usage.
export interface StoreAppUsage {
    actionName: "StoreAppUsage";
    id: "Privacy_StoreAppUsage";
    parameters: {
        originalUserRequest: string;
        enableTracking: boolean;
    };
}

// This setting controls the visibility of scroll bars in Windows.
// When enabled, scroll bars are automatically hidden until needed, providing a cleaner interface.
// Users can choose to always show scroll bars for easier navigation, ensuring they remain visible regardless of interaction.
// This option enhances user accessibility and improves the overall display experience on the desktop.
export interface AutoHideConsciousScrollbars {
  actionName: "AutoHideConsciousScrollbars";
  id: "Accessibility_Display_AutoHideConsciousScrollbars";
  parameters: {
    originalUserRequest: string;
    enableAutoHide: boolean;
  };
}

// 'This setting enables account-related notifications to be displayed in the Start menu. It provides users with suggestions and recommendations tailored to their account, enhancing personalization and user experience within the desktop environment.'
export interface ShowAccountNotificationsInStart {
    actionName: "showAccountNotificationsInStart";
    id: "Start_AccountNotifications";
    parameters: {
        originalUserRequest: string;
    };
}

// 'Narrator is an accessibility feature in Windows that provides a screen reader for users with visual impairments. It reads aloud text displayed on the screen and describes elements like buttons and icons, enabling users to navigate their computer more effectively. Narrator can be easily toggled on or off, allowing for customizable usage based on individual needs.'
export interface EnableNarratorAction {
    actionName: "EnableNarratorAction";
    id: "Accessibility_Narrator_IsEnabled";
    parameters: {
        originalUserRequest: string; 
        enable: boolean;
    };
}

// The Animation Effects setting in Windows allows users to enable or disable visual animations throughout the operating system. Disabling animations can help reduce motion sensitivity and enhance performance, particularly for those who may experience dizziness or discomfort from animated transitions when opening apps and navigating the desktop.
export interface IsAnimationsEnabled {
  actionName: "IsAnimationsEnabled";
  id: "Accessibility_IsAnimationsEnabled";
  parameters: {
    originalUserRequest: string;
    enableAnimations: boolean;
  };
}

// This setting allows you to keep the touchpad enabled even when a mouse is connected to your desktop. It prevents the touchpad from turning off automatically, providing flexibility for users who prefer using both input methods simultaneously.
export interface LeaveTouchPadActiveWithMouse {
    actionName: "LeaveTouchPadActiveWithMouse";
    id: "Input_Touch_LeaveOnWithMouse";
    parameters: {
        originalUserRequest: string;
    };
}

// The allow users to reclaim storage by aggressively cleaning up temporary system and app files
export interface EnableStorageSenseGlobalToggleRejuv {
  actionName: "EnableStorageSenseGlobalToggleRejuv";
  id: "StorageSense_SmartPoliciesAdvanced_GlobalToggleRejuv";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// The Mobile Opt-In Toggle setting allows users to manage whether they want to receive mobile notifications and communications from Windows devices. Enabling this toggle opts users in for mobile-related features and updates, enhancing connectivity and user experience on mobile platforms.
export interface MobileOptInToggleAction {
    actionName: "MobileOptInToggle";
    id: "Device_Phone_MobileOptInToggle";
    parameters: {        
        originalUserRequest: string;
        enable: boolean;
    };
}

// 'Voice Access is a Windows accessibility feature that allows users to control their device and dictate text using voice commands. It enhances productivity and accessibility by enabling hands-free operation, making it easier for users with mobility challenges to interact with their computer. This setting includes options for microphone configuration and dictation settings.'
export interface EnableVoiceAccess {
    actionName: "EnableVoiceAccess";
    id: "Accessibility_VA_IsEnabled";
    parameters: {
        originalUserRequest: string;
        activateVoiceAccess?: boolean;
        deactivateVoiceAccess?: boolean;
    };
}

// 'The Copilot setting controls the visibility of the Copilot button on the Windows taskbar. Users can enable or disable this feature to customize their desktop experience, allowing for easy access to Copilot functionality directly from the taskbar.'
export interface ControlCopilotVisibility {
    actionName: "ControlCopilotVisibility";
    id: "DesktopTaskbar_Copilot";
    parameters: {
        originalUserRequest: string;
        enableCopilotButton: boolean;
    };
}

// this setting allows users to enable or disable the dynamic refresh rate feature, which adjusts the display's refresh rate based on the content being viewed to enhance visual performance and battery efficiency.
export interface DynamicRefreshRateToggle {
  actionName: "DynamicRefreshRateToggle";
  id: "Display_AdvancedDisplaySettingsDynamicRefreshRate";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// The Gaming Background Recording Toggle is a setting in Windows that allows users to enable or disable the background recording feature of the Xbox Game Bar. When enabled, it captures gameplay footage in the background, allowing users to save clips of their gaming sessions. Disabling this feature can free up system resources and improve performance during gameplay.
export interface GamingBackgroundRecordingToggle {
    actionName: "GamingBackgroundRecordingToggle";
    id: "Gaming_BackgroundRecording_Toggle";
    parameters: {
        originalUserRequest: string;
        enable?: boolean;
    };
}

// This setting allows applications to access and utilize the device's location. It enables users to override the default location with a remote location, providing more control over location permissions for apps on desktop systems.
export interface UserLocationOverride {
  actionName: "UserLocationOverride";
  id: "Privacy_UserLocationOverride";
  parameters: {
    originalUserRequest: string;
    enableOverride: boolean;
  };
}

// Adjust the maximum speed of the mouse pointer when using Mouse Keys for accessibility.
export interface MouseKeysPointerSpeedAction {
    actionName: "mouseKeysPointerSpeed";
    id: "Accessibility_MouseKeys_MaximumSpeed";
    parameters: {
        originalUserRequest: string;
        speed: number;
    };
}

// Adjust the speed of text-to-speech playback.
export interface TextToSpeechPlaybackSpeedAction {
  actionName: "TextToSpeechPlaybackSpeed";
  id: "Speech_TextToSpeechSpeed";
  parameters: {
    originalUserRequest: string;
    speedAdjustment: "increase" | "slow down";
  };
}

// 'The 'Save multiple clipboard items' setting allows users to store multiple items in the clipboard, enabling easy access to previously copied content. This feature is accessed using the shortcut Win +�V�and enhances productivity by facilitating the management of clipboard history. It applies to desktop systems and includes options for cloud clipboard settings.'
export interface SaveClipboardItemsAction {
    actionName: "saveClipboardItems";
    id: "Clipboard_IsSaveClipboardItemsEnabled";
    parameters: {
        originalUserRequest: string;
        enable: boolean; // true to enable, false to disable
    };
}

// The setting in Windows allows users to access their Setting shortcut directly from the Start menu or Start screen.
export interface StartPlacesSettings {
  actionName: "StartPlacesSettings";
  id: "Start_PlacesSettings";
  parameters: {
    originalUserRequest: string;
    folderAction: string; // Indicates whether to add or delete the Settings folder
  };
}

// 'The 'Usb_AttemptRecoveryFromPowerDrain' setting in Windows is related to the USB power management feature. It allows the system to attempt recovery of USB devices that may have entered a low-power state or become unresponsive due to power drain issues. This setting can help maintain device functionality and prevent connection problems, ensuring a more stable USB experience.'
export interface AttemptRecoveryFromPowerDrainAction {
  actionName: "attemptRecoveryFromPowerDrain";
  id: "Usb_AttemptRecoveryFromPowerDrain";
  parameters: {
    originalUserRequest: string;
    enableDisable: boolean;
  };
}

// 'The 'Restart apps after signing in' setting allows Windows to automatically reopen applications that were running before you signed out or restarted your device. This feature enhances user convenience by saving time, as it eliminates the need to manually launch each app again upon signing in.'
export interface RestartAppsAfterSignInAction {
    actionName: "restartAppsAfterSignIn";
    id: "Users_RestartApps";
    parameters: {
        originalUserRequest: string;
        enableRestartingApps: boolean;
    };
}

// 'Adjusts the frame rate for recorded game videos, allowing selection between 30 fps and 60 fps for game captures.'
export interface GameCaptureFrameRate {
  actionName: "GameCaptureFrameRate";
  id: "Gaming_RecordedVideo_FrameRate";
  parameters: {
    originalUserRequest: string;
    frameRate: "30 fps" | "60 fps";
  };
}

// This setting allows you to enable or disable the slideshow feature for your desktop background while the device is running on battery power. When enabled, the background will cycle through a series of images, enhancing personalization but potentially impacting battery life.
export interface SlideshowEnabledOnBatteryAction {
    actionName: "SlideshowEnabledOnBattery";
    id: "Personalize_Background_SlideshowEnabledOnBattery";
    parameters: {
        originalUserRequest: string;
        enableSlideshowOnBattery: boolean;
    };
}

// The Automatic Sign-On Lock setting allows a device to automatically sign in after a restart or update, streamlining the process for users. This feature is particularly useful for ensuring that applications reopen and restart seamlessly, enhancing the overall user experience during device setup and updates.
export interface AutomaticSignOnLock {
  actionName: "AutomaticSignOnLock";
  id: "Users_AutomaticSignOnLock";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// 'Live captions is an accessibility feature in Windows that provides automatic on-screen captions for audio content. It enhances accessibility by transcribing spoken words in real-time, allowing users to follow along with podcasts, videos, and other audio sources. This feature can be activated on the desktop to display captions for any audio played on the device, improving the experience for individuals with hearing impairments.'
export interface EnableLiveCaptions {
  actionName: "EnableLiveCaptions";
  id: "Accessibility_Caption_LCToggle";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// 'The Magnifier feature in Windows is an accessibility tool that allows users to enlarge parts of the screen for better visibility. It can be activated to zoom in up to 200 percent, making it easier to read text and view images. This feature is particularly useful for individuals with visual impairments, enhancing their ability to interact with content on the desktop.'
export interface EnableMagnifier {
  actionName: 'EnableMagnifier';
  parameters: {
    originalUserRequest: string;
    id: 'Accessibility_Magnifier_IsEnabled';
    enable: boolean;
  };
}

// The 'Allow Low Resolution' setting enables users to stream video at a lower resolution, which can help save data, especially on metered connections. This setting is applicable to desktop environments and is part of video playback options, allowing for adjustments in video quality to optimize performance and data usage.
export interface AllowLowResolutionAction {
  actionName: "AllowLowResolution";
  id: "Video_AllowLowResolution";
  parameters: {
    originalUserRequest: string;
    enableLowResolution: boolean;
  };
}

// this setting allows users to enable or disable the virtual touchpad feature, enhancing navigation on devices without a physical touchpad.
export interface VirtualTouchpadAction {
  actionName: "VirtualTouchpad";
  id: "DesktopTaskbar_Touchpad";
  parameters: {
    originalUserRequest: string;
    enableTouchpad: boolean;
  };
}

// 'The 'Devices_DLGlobalMatchAccentColor' setting refers to a feature in Windows that allows the system to automatically synchronize the accent color across various user interface elements, providing a cohesive and personalized visual experience. This setting ensures that the accent color matches throughout the desktop environment, enhancing aesthetic consistency.'
export interface MatchAccentColorAction {
  actionName: "matchAccentColor";
  id: "Devices_DLGlobalMatchAccentColor";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// The Continuum Power Mode setting in Windows is designed for devices that support Continuum, enabling a seamless transition between desktop and mobile environments. This setting adjusts power management features to optimize performance and battery life based on whether the device is docked or undocked, ensuring efficient use of resources while providing an optimal user experience.
export interface ContinuumPowerMode {
  actionName: "ContinuumPowerMode";
  id: "Continuum_PowerMode";
  parameters: {
    originalUserRequest: string;
  };
}

// When enabled, a shortcut to File Explorer will appear on the Start menu, providing quick access to your files and folders.
export interface ToggleStartMenuSettingsFolder {
    actionName: "toggleStartMenuSettingsFolder";
    id: "Start_PlacesFileExplorer";
    parameters: {
        originalUserRequest: string;
        enable: boolean;
    };
}

// This Windows setting enhances search results by utilizing your device's search history. It allows the system to improve the relevance of search queries based on previously searched items on your device. Enabling this feature may require granting specific permissions related to your search history.
export interface EnableMyDeviceHistoryAction {
  actionName: "EnableMyDeviceHistory";
  id: "Search_MyDeviceHistory";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// The AutoCorrect feature in Windows automatically corrects misspelled words as you type. This setting can enhance typing efficiency by fixing common typos and spelling errors in real-time, ensuring a smoother writing experience. It is applicable to desktop environments and can be customized to suit individual preferences for spelling corrections.
export interface EnableAutoCorrectionAction {
  actionName: "enableAutoCorrection";
  parameters: {
    originalUserRequest: string;
    id: "Keyboard_IsAutoCorrectionEnabled";
    isEnabled: boolean;
  };
}

// 'this setting allows users to enable or disable the Windows welcome experience after updates and upon signing in, providing suggestions and information about new features.'
export interface ShowWelcomeExperience {
  actionName: "ShowWelcomeExperience";
  id: "Notifications_SignInSuggestionsEnabled";
  parameters: {
    originalUserRequest: string;
    isEnabled: boolean;
  };
}

// The 'Show notification bell icon' setting allows users to display the notification icon on the desktop taskbar. This icon provides quick access to notifications and alerts, including the Do Not Disturb feature, enhancing user awareness of updates and messages.
export interface ShowNotificationIconAction {
  actionName: "ShowNotificationIcon";
  id: "DesktopTaskbar_ShowNotificationIcon";
  parameters: {
    originalUserRequest: string;
    enable: boolean; 
  };
}

// Adjust the acceleration speed for mouse keys, affecting how quickly the pointer moves when using keyboard controls.
export interface MouseKeysAccelerationSpeed {
    actionName: "MouseKeysAccelerationSpeed";
    id: "Accessibility_MouseKeys_TimeToMaximumSpeed";
    parameters: {
        originalUserRequest: string;
        speed: number;
    };
}

// This setting controls whether account details, such as the email address associated with
// the user account, are displayed on the Windows sign-in screen. It affects desktop devices
// and is related to user privacy and account settings, allowing users to choose their preferred
// level of information visibility during the sign-in process.
export interface ShowAccountDetailsOnSignInScreen {
  actionName: "ShowAccountDetailsOnSignInScreen";
  id: "Users_LogonShowEmail";
  parameters: {
    originalUserRequest: string;
    action: "enable" | "disable";
  };
}

// The Scoobe feature in Windows Notifications suggests ways to optimize your device setup for better performance. It provides personalized recommendations to help you complete the configuration of your computer, enhancing your overall experience. This setting applies to desktop users and is designed to assist with finishing device setup and adjusting notification preferences.
export interface ScoobeEnabled {
  actionName: "ScoobeEnabled";
  id: "Notifications_ScoobeEnabled";
  parameters: {        
    originalUserRequest: string;
    enable: boolean;
  };
}

// Aero Snap is a Windows feature that allows users to automatically snap windows to the sides or corners of the screen, enhancing window management and multitasking capabilities. This setting helps in organizing open applications efficiently by adjusting their layout on the desktop.
export interface EnableAeroSnapAction {
    actionName: "EnableAeroSnap";
    id: "MultiTasking_AeroSnapEnabled";
    parameters: {        
        originalUserRequest: string;
        enable: boolean;
    };
}

// The 'Show search highlights' setting enables dynamic search suggestions on the desktop, providing users with relevant content and suggestions as they type in the search box. This feature enhances the search experience by offering contextual information and potential results based on user input.
export interface DynamicSearchBox {
  actionName: "DynamicSearchBox";
  id: "Search_DynamicSearchBox";
  parameters: { 
    originalUserRequest: string;
    enable: boolean;
  };
}

// 'The Recorded Audio setting allows users to enable or disable audio recording when capturing gameplay. This setting is part of the gaming options on desktop, ensuring that any sound from the game is included in the recorded video. It is essential for enhancing the gaming experience by capturing both visual and audio elements during gameplay recordings.'
export interface RecordedAudioToggleAction {
  actionName: "RecordedAudioToggle";
  id: "Gaming_RecordedAudio_Toggle";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// The 'Filter Keys' setting in Windows Accessibility allows users to modify keyboard input behavior to ignore brief or repeated keystrokes. When enabled, it helps users with dexterity impairments by providing a shortcut to toggle this feature on and off, enhancing their typing experience.
export interface EnableFilterShortcutAction {
    actionName: "EnableFilterShortcut";
    id: "Accessibility_Keyboard_FilterShortcutEnabled";
    parameters: {        
        originalUserRequest: string;
    };
}

// This setting allows notifications on the desktop to play sound. Users can enable or disable notification sounds, which affects how alerts are perceived, especially in environments where sound is crucial for awareness. Adjusting this setting can help manage notification volume and mute notifications as needed.
export interface AllowNotificationSound {
  actionName: "allowNotificationSound";
  id: "Notifications_AllowNotificationSound";
  parameters: {
    originalUserRequest: string;
    enableNotificationSound: boolean;
  };
}

export interface GlobalLightingEffectSpeed {
  // Adjusts the speed of global lighting effects for connected devices.
  actionName: "GlobalLightingEffectSpeed";
  id: "Devices_DLGlobalEffectSpeedSlider";
  parameters: {
    originalUserRequest: string;
    effectSpeed: "increase" | "decrease";
  };
}

// The Expandable Taskbar setting optimizes the Windows taskbar for touch interactions when the device is used as a tablet. It enhances usability by allowing the taskbar to expand, making it easier to access apps and features in tablet mode.
export interface ExpandableTaskbarAction {
  actionName: "expandableTaskbarAction";
  id: "DesktopTaskbar_ExpandableTaskbar";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// The 'Quiet Moments on Full Screen' setting allows users to enable a feature that minimizes notifications and distractions while using applications in full-screen mode. This setting enhances focus by reducing interruptions, ensuring a more immersive experience during activities such as gaming, presentations, or video watching.
export interface QuietMomentsOnFullScreenAction {
    actionName: "QuietMomentsOnFullScreen";
    id: "QuietMoments_On_FullScreen_Enabled";
    parameters: {
        originalUserRequest: string;
        enableQuietMoments: boolean;
    };
}

// The 'Warning Enabled' setting for keyboard accessibility notifies users when Sticky Keys, Filter Keys, or Toggle Keys are activated. This feature provides alerts to help users manage keyboard shortcuts and settings effectively, ensuring they are aware when these accessibility options are turned on.
export interface WarningEnabledAction {
  actionName: "WarningEnabled";
  id: "Accessibility_Keyboard_WarningEnabled";
  parameters: {
    originalUserRequest: string;
    enableNotification: boolean;
  };
}

// The setting in Windows allows users to access their Downloads folder directly from the Start menu or Start screen.
export interface StartPlacesDownloads {
    actionName: "StartPlacesDownloads";
    id: "Start_PlacesDownloads";
    parameters: {
        originalUserRequest: string;
        showDownloadsShortcut?: boolean;
    };
}

// The 'Capture mouse cursor in game recordings' setting allows users to include the mouse cursor in their gameplay recordings. This feature enhances the viewing experience by showing cursor movements during gameplay, useful for tutorials or gameplay analysis. It is applicable to desktop environments and is part of the gaming settings in Windows.
export interface CaptureMouseCursorAction {
  actionName: "CaptureMouseCursorAction";
  id: "Gaming_RecordedVideo_MouseCapture";
  parameters: {
    originalUserRequest: string;
    enableCapture: boolean;
  };
}

// The Quiet Moments feature in Windows is designed to minimize distractions during presentations by silencing notifications and alerts. When enabled, it helps users maintain focus by preventing interruptions from incoming messages, app alerts, and other system notifications while giving presentations or attending important meetings.
export interface QuietMomentsOnPresentationEnabledAction {
  actionName: "QuietMomentsOnPresentationEnabled";
  id: "QuietMoments_On_Presentation_Enabled";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// The 'Start Places Documents' setting in Windows allows users to access their Documents folder directly from the Start menu or Start screen. This provides quick access to saved documents and files, enhancing productivity and organization by making frequently used files easily reachable.
export interface StartPlacesDocuments {
  actionName: "StartPlacesDocuments";
  id: "Start_PlacesDocuments";
  parameters: {
    originalUserRequest: string;
    showShortcut: boolean;
  };
}

// 'Search Cloud SearchMSA' is a Windows setting that manages the integration of cloud-based search capabilities in the Microsoft Search ecosystem. It allows users to access search results from cloud services and applications, enhancing the search experience across devices and platforms. This setting is typically configured in enterprise environments to improve productivity and information retrieval.
export interface SearchCloudSearchMSAAction {
  actionName: "SearchCloudSearchMSA";
  id: "Search_CloudSearchMSA";
  parameters: {
    originalUserRequest: string;
    enableCloudSearchFunctionality: boolean;
  };
}

// This setting allows users to enable or disable account notifications within the Windows Settings app. When enabled, users receive alerts about account-related activities, enhancing awareness and security regarding their account status and changes.
export interface EnableAccountNotificationsInSettings {
  actionName: "EnableAccountNotificationsInSettings";
  id: "Privacy_EnableAccountNotificationsInSettings";
  parameters: {
    originalUserRequest: string;
    enableNotifications: boolean;
  };
}

// this setting allows users to enable a quiet period for one hour after a Windows feature update to minimize disruptions.
export interface EnableQuietMoments {
    actionName: "EnableQuietMoments";
    id: "QuietMoments_On_OOBE_Enabled";
    parameters: {
        originalUserRequest: string;
        enable: boolean;
    };
}

// This setting enables or disables storage sense, which helps manage storage automatically based on usage patterns and system preferences.
export interface EnableStorageSense {
    actionName: "EnableStorageSense";
    id: "StorageSense_SmartPoliciesAdvanced_GlobalToggle";
    parameters: {
        originalUserRequest: string;
        activate: boolean;
    };
}

// The Keyboard Shortcut Sound Enabled setting allows users to play an audio alert when activating Sticky Keys, Filter Keys, or Toggle Keys. This feature enhances accessibility by providing auditory feedback for keyboard modifications, aiding users who may benefit from additional cues while typing.
export interface ShortcutSoundEnabled {
  actionName: "ShortcutSoundEnabled";
  parameters: {
    originalUserRequest: string;
    id: "Accessibility_Keyboard_ShortcutSoundEnabled";
    enable: boolean;
  };
}

// This setting controls the display of notifications on the lock screen of a Windows device. When enabled, it allows users to view notifications while the screen is locked, ensuring important alerts are visible without unlocking the device. This feature can be managed through notification settings to enhance user accessibility and awareness of events.
export interface ShowNotificationsOnLockScreen {
  actionName: "ShowNotificationsOnLockScreen";
  id: "Notifications_ToastsAboveLock";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// 'this setting allows users to receive notifications when applications request access to their location, enhancing privacy control.'
export interface NotifyWhenAppsRequestLocation {
    actionName: "NotifyWhenAppsRequestLocation";
    id: "CapabilityAccess_Location_OneClickSuppression";
    parameters: {
        originalUserRequest: string;
        notificationsStatus: boolean;
    };
}

// this setting enables or disables Quiet Moments when playing a game, allowing users to minimize distractions and focus on gameplay.
export interface GameQuietModeToggle {
  actionName: "GameQuietModeToggle";
  id: "QuietMoments_On_Game_Enabled";
  parameters: {
    originalUserRequest: string;
    enableQuietMode: boolean;
  };
}

// The 'Search_CloudSearchAAD' setting pertains to the integration of Azure Active Directory (AAD) with Windows Search functionality. It enhances search capabilities by allowing users to access and retrieve data from cloud-based sources and services associated with their AAD accounts, improving overall productivity and search efficiency within the Windows environment.
export interface SearchCloudSearchAADAction {
    actionName: "SearchCloudSearchAAD";
    id: "Search_CloudSearchAAD";
    parameters: {
        originalUserRequest: string;
        enable: boolean;
    };
}

// Aero Shake is a multitasking feature in Windows that allows users to minimize all other open windows by grabbing and shaking a window's title bar. This functionality enhances window management and helps focus on a specific task by temporarily hiding distractions.
export interface EnableAeroShake {
  actionName: "enableAeroShake";
  id: "MultiTasking_AeroShakeEnabled";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// 'The 'Play key sounds as I type' setting enables audio feedback when keys are pressed on the keyboard. This feature provides auditory confirmation of keystrokes, enhancing the typing experience by allowing users to hear sounds corresponding to their input. It applies to desktop environments and can be adjusted in keyboard settings.'
export interface EnableKeyAudioFeedback {
  actionName: "EnableKeyAudioFeedback";
  id: "Keyboard_IsKeyAudioFeedbackEnabled";
  parameters: {        
    originalUserRequest: string;
    enableAudioFeedback: boolean;
  };
}

// This setting allows you to enable or disable the keyboard shortcut for the Narrator feature in Windows. When enabled, you can quickly start or stop Narrator using the designated shortcut key, providing easy access to screen reading functionality. Disabling the shortcut prevents Narrator from being activated via the keyboard, ensuring it does not turn on unintentionally.
export interface EnableNarratorShortcutKey {
    actionName: "EnableNarratorShortcutKey";
    id: "Accessibility_Narrator_IsShortcutKeyEnabled";
    parameters: {
        originalUserRequest: string;
    };
}

// The Relaxed Mode in Windows Speech Recognition is designed to improve the recognition of non-native accents, enhancing user interaction with the speech recognition feature. It allows users to adjust language and speech settings to better accommodate diverse speech patterns, making it more accessible for individuals with varying accents.
export interface SpeechRecognizerRelaxedMode {
    actionName: "SpeechRecognizerRelaxedMode";
    id: "Speech_RecognizerRelaxedMode";
    parameters: {
        originalUserRequest: string;
        enable: boolean;
    };
}

// The Filter Keys setting in Windows allows users to control the sensitivity of the keyboard, particularly for those who may have difficulty pressing multiple keys at once. When the 'Beep Enabled' option is activated, a sound will be emitted when the Filter Keys feature is triggered, providing auditory feedback. This can help users confirm that their key presses are being recognized while using the Filter Keys function.
export interface EnableFilterKeyBeep {
    actionName: "enableFilterKeyBeep";
    id: "Accessibility_Keyboard_FilterKeyBeepEnabled";
    parameters: {
        originalUserRequest: string;
        enabled: boolean;
    };
}

// This setting enables the 'End Task' feature in the taskbar, allowing users to terminate unresponsive applications directly from the taskbar interface. It's part of developer mode settings and enhances user control over running applications.
export interface EnableEndTaskInTaskbarAction {
    actionName: "EnableEndTaskInTaskbar";
    id: "Taskbar_Endtask";
    parameters: {
        originalUserRequest: string;
        enable: boolean;
    };
}

// 'The Spell Checking feature in Windows highlights misspelled words as you type, providing visual cues to correct spelling errors. This setting enhances typing accuracy by underlining incorrect spellings with a squiggly line, helping users to easily identify and rectify mistakes in text inputs.'
export interface EnableSpellchecking {
    actionName: "EnableSpellchecking";
    id: "Keyboard_IsSpellcheckingEnabled";
    parameters: {
        originalUserRequest: string;
    };
}

// this setting allows users to display hidden and system files in the Windows file explorer for easier access and management of files that are usually concealed.
export interface ShowHiddenAndSystemFiles {
  actionName: "showHiddenAndSystemFiles";
  id: "Developer_Mode_Setting_HiddenFiles2";
  parameters: {
    originalUserRequest: string;
    showHiddenFiles: boolean;
    showSystemFiles: boolean;
  };
}

// The setting in Windows allows users to access their Personal folder directly from the Start menu or Start screen.
export interface StartPlacesUserProfile {
  actionName: "StartPlacesUserProfile";
  id: "Start_PlacesUserProfile";
  parameters: {
    originalUserRequest: string;
    folderVisibility: "show" | "hide";
  };
}

// The 'Show important notifications on the lock screen' setting allows critical notifications, such as reminders and incoming VoIP calls, to be displayed on the lock screen. This feature ensures that high-priority alerts are visible even when the device is locked, enhancing accessibility and user awareness of important communications.
export interface ShowCriticalToastsAboveLock {
    actionName: "showCriticalToastsAboveLock";
    id: "Notifications_CriticalToastsAboveLock";
    parameters: {        
        originalUserRequest: string;
        enable: boolean;
    };
}

// 'The Filter Keys feature in Windows allows users to adjust keyboard settings to ignore brief or repeated key presses. When the Filter Indicator is enabled, it visually indicates when Filter Keys are active, helping users understand their current keyboard input mode.'
export interface EnableFilterIndicator {
  actionName: "EnableFilterIndicator";
  id: "Accessibility_Keyboard_FilterIndicatorEnabled";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// 'Adaptive Color is a Windows setting that automatically adjusts the display's color temperature based on the surrounding lighting conditions. This feature enhances visual comfort by ensuring that colors appear more natural in varying environments, making it suitable for desktop use.'
export interface AdaptiveColor {
    actionName: "AdaptiveColor";
    id: "Display_AdaptiveColor";
    parameters: {
        originalUserRequest: string;
        enable: boolean;
    };
}

// 'Auto brightness is a feature in Windows that automatically adjusts the screen brightness based on ambient light conditions. When enabled, it enhances visibility and reduces eye strain by ensuring the display is neither too bright nor too dim in varying lighting environments. This setting can be found in the display options and may be influenced by the capabilities of the device's sensors.'
export interface AutoBrightnessEnabled {
  actionName: "AutoBrightnessEnabled";
  id: "Display_IsAutoBrightnessEnabled";
  parameters: {
    originalUserRequest: string;
    enableAutoBrightness: boolean;
  };
}

// The Color Filtering Shortcut Key setting allows users to enable or disable a keyboard shortcut that toggles color filters on and off. This feature is useful for individuals with visual impairments, providing quick access to different color filter options to enhance visibility and usability on the desktop.
export interface EnableColorFilterShortcutKey {
    actionName: "EnableColorFilterShortcutKey";
    id: "Accessibility_ColorFiltering_IsShortcutKeyEnabled";
    parameters: {
        originalUserRequest: string;
        enableShortcutKey: boolean;
    };
}

// 'Find My Device is a Windows feature that helps users locate their lost or stolen devices. It saves the device's last known location, allowing users to track it via their Microsoft account. This setting enhances security and provides peace of mind by enabling users to find their devices quickly if misplaced.'
export interface SaveLocationAction {
  actionName: "SaveLocation";
  id: "FindMyDevice_SaveLocation2";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// The setting in Windows allows users to access their Picture folder directly from the Start menu or Start screen.
export interface StartPlacesPictures {
    actionName: "StartPlacesPictures";
    id: "Start_PlacesPictures";
    parameters: {
        originalUserRequest: string;
        action: "Show" | "Remove";
        target: string; // Expected values: "pictures shortcut", "Start menu"
    };
}

// The setting in Windows allows users to access their Network setting directly from the Start menu or Start screen.
export interface StartPlacesNetworkAction {
  actionName: "startPlacesNetwork";
  id: "Start_PlacesNetwork";
  parameters: {
    originalUserRequest: string;
    action: "Show" | "Remove";
    target: "network shortcut";
    location: "Start menu" | "Start screen";
  };
}

// The Global Touch Gestures setting allows users to enable or disable touch gestures on a desktop device. This feature is particularly useful for optimizing touch screen interactions by customizing how gestures are recognized and executed, enhancing user experience with touch-based navigation and controls.
export interface GlobalTouchGestures {
  actionName: "GlobalTouchGestures";
  id: "Input_Touch_GlobalTouchGestures";
  parameters: {
    originalUserRequest: string;
    enableTouchGestures: boolean;
  };
}

// Enable or disable automatic start of visual accessibility features
export interface EnableVisualAccessibilityAutoStart {
  actionName: "enableVisualAccessibilityAutoStart";
  id: "Accessibility_VA_IsAutoStartEnabled";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// 'This setting pertains to the Remote Desktop feature in Windows, specifically focusing on Network Level Authentication (NLA). NLA enhances security by requiring users to authenticate before establishing a remote session, reducing the risk of unauthorized access. When enabled, users must provide credentials before the remote desktop connection is fully established, leading to a more secure remote access environment.'
export interface EnableRemoteDesktopNLA {
  actionName: "EnableRemoteDesktopNLA";
  id: "RemoteDesktopAdvanced_NLA";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// The 'Tap to Click' setting allows users to enable or disable the feature that permits tapping on the touchpad to register a click. Disabling this option prevents accidental clicks while using the touchpad, ensuring that only physical button presses are recognized. This setting is applicable to desktop devices with touchpads.
export interface TouchTapsEnabledAction {
  actionName: "TouchTapsEnabled";
  id: "Input_Touch_TapsEnabled";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// The Weak Charger Notification setting alerts users when their mobile device is charging slowly via USB. This feature helps ensure that users are aware of suboptimal charging conditions, enabling them to take necessary actions, such as using a different charger or port for faster charging.
export interface NotifyUsbWeakCharger {
    actionName: "NotifyUsbWeakCharger";
    id: "Usb_WeakChargerNotify";
    parameters: {        
        originalUserRequest: string;
        enable: boolean; 
    };
}

// The AutoPlay setting allows users to enable or disable the automatic action taken when a new media or device is connected to the computer, such as playing music or displaying files. This feature can help streamline the user experience by automatically suggesting actions based on the type of media detected.
export interface EnableAutoPlay {
    actionName: "EnableAutoPlay";
    id: "Autoplay_IsEnabled";
    parameters: {
        originalUserRequest: string;
        enable: boolean;
    };
}

// This setting allows you to disable right-click functionality on the touchpad. When enabled, it prevents accidental right-clicks, enhancing the touchpad experience, particularly for desktop users. You can manage this feature through touchpad settings to tailor your interaction with the device.
export interface EnableRightClickZone {
  actionName: "enableRightClickZone";
  id: "Input_Touch_RightClickZoneEnabled";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// 'The Backup_AppList setting is a feature in Windows that allows users to create a backup of the list of installed applications on their system. This can be useful for restoring or migrating software configurations when reinstalling the operating system or moving to a new device. However, it does not back up the actual application files or data, only the list of applications.'
export interface BackupApplistAction {
  actionName: "BackupApplist";
  id: "Backup_AppList";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// Adjusts the intensity of color filters to enhance screen visibility for users with color blindness or visual impairments.
export interface ColorFilterIntensity {
  actionName: "ColorFilterIntensity";
  id: "Accessibility_ColorFiltering_Intensity";
  parameters: {
    originalUserRequest: string;
    intensityLevel: "increase" | "reduce";
  };
}

// The setting in Windows allows users to access their Music folder directly from the Start menu or Start screen.
export interface StartPlacesMusic {
  actionName: "StartPlacesMusic";
  id: "Start_PlacesMusic";
  parameters: {    
    originalUserRequest: string;
    operation: "Show" | "Remove";
  };
}

// 'this setting enables or disables the collection of typing insights to improve text prediction and autocorrect features in Windows. When enabled, it allows the system to learn from your typing patterns for a better user experience.'
export interface TypingInsightsToggle {
  actionName: "TypingInsightsToggle";
  id: "Keyboard_Insights_Enabled";
  parameters: {
    originalUserRequest: string;
    enableTypingInsights?: boolean;
  };
}

// The Mouse Keys setting allows users to control the mouse pointer using the numeric keypad on the keyboard. This specific option enables Mouse Keys functionality only when Num Lock is activated, ensuring that the numeric keypad can be used for both input and mouse control.
export interface EnableMouseKeysNumLockAction {
  actionName: "EnableMouseKeysNumLock";
  id: "Accessibility_IsMouseKeysNumLockEnabled";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// this setting allows users to enable or disable the sudo command in developer mode, providing elevated permissions for executing commands.
export interface EnableSudo {
    actionName: "EnableSudo";
    id: "Developer_Mode_Setting_Sudo";
    parameters: {
        originalUserRequest: string;
        sudoCommand: string;
        developerMode: boolean;
    };
  }


// This setting determines whether the User Account Control (UAC) prompt for elevated permissions automatically starts on the secure desktop. When enabled, the secure desktop isolates the UAC prompt from other applications, enhancing security by preventing malicious software from interacting with it.
export interface EnableAccessibilityOnSecureDesktop {
    actionName: "EnableAccessibilityOnSecureDesktop";
    id: "Accessibility_VA_IsAutoStartOnSecureDesktopEnabled";
    parameters: {
        originalUserRequest: string;
        enableFeature: boolean;
    };
}

// The Auto Shift feature for the touch keyboard in Windows capitalizes the first letter of a sentence automatically. This setting enhances typing efficiency by ensuring that the initial letter is always in uppercase, streamlining the writing process on desktop devices.
export interface EnableAutoCapitalizeAction {
  actionName: "EnableAutoCapitalize";
  id: "Keyboard_IsAutoShiftEngageEnabled";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// This setting allows users to disable HDR (High Dynamic Range) when the PC is running on battery power, helping to conserve energy.
export interface HDRSupportOnBatteryToggle {
  actionName: "HDRSupportOnBatteryToggle";
  id: "Video_HDRSupportOnBattery";
  parameters: {
    originalUserRequest: string;
    enableHDR: boolean;
  };
}

// this setting allows the user to adjust the speed of mouse movements when using Mouse Keys by holding the Ctrl key to speed up and the Shift key to slow down.
export interface MouseKeysSpeedControl {
  actionName: "MouseKeysSpeedControl";
  id: "Accessibility_IsMouseKeysCtrlShiftEnabled";
  parameters: {
    originalUserRequest: string;
    keyModifier: 'ctrl' | 'shift';
    speedAdjustment: 'speed up' | 'slow down';
  };
}

// The Two-Finger Tap setting on the touchpad allows you to disable right-click functionality when tapping with two fingers. This setting can enhance the touchpad experience by preventing accidental right clicks during navigation.
export interface DisableTwoFingerTapAction {
    actionName: "DisableTwoFingerTap";
    id: "Input_Touch_TwoFingerTapEnabled";
    parameters: {
        originalUserRequest: string;
        enable: boolean;
    };
}

// This setting allows users to include Camera Roll folders in the Lock Screen slideshow on their Windows desktop. It enhances personalization by enabling the display of images from the Camera Roll as part of the rotating background on the Lock Screen.
export interface IncludeCameraRollInLockScreenSlideshow {
    actionName: "IncludeCameraRollInLockScreenSlideshow";
    id: "Personalize_LockScreenSlideshowIncludeCameraRoll";
    parameters: {
        originalUserRequest: string;
        disableCameraRoll: boolean;
    };
}

// 'Filter Keys is an accessibility feature in Windows that allows users to ignore brief or repeated keystrokes. When the 'Repeat Enabled' setting is turned on, it permits the user to control the rate at which keys are repeated when held down, helping those with motor impairments to avoid unintended multiple key presses.'
export interface FilterSlowKeysRepeatEnabledAction {
    actionName: "FilterSlowKeysRepeatEnabled";
    id: "Accessibility_Keyboard_FilterSlowKeysRepeatEnabled";
    parameters: {
        originalUserRequest: string;
        enabled: boolean;
    };
}

// This setting optimizes the Lock Screen slideshow by selecting only those pictures that fit your screen resolution. It ensures a tailored visual experience, enhancing the personalization of your desktop environment.
export interface OptimizeLockScreenSlideshowAction {
    actionName: "OptimizeLockScreenSlideshow";
    id: "Personalize_LockScreenSlideshowOptimizePhotoSelection";
    parameters: {
        originalUserRequest: string;
    };
}

// The Delivery Optimization setting allows Windows to download updates and apps from other PCs on your local network or the internet, enhancing download speed and reducing bandwidth usage. Enabling this feature can improve the efficiency of system updates and app installations.
export interface EnableDeliveryOptimization {
    actionName: "enableDeliveryOptimization";
    id: "DeliveryOptimization_IsEnabled";
    parameters: {
        originalUserRequest: string;
        state: "on" | "off";
    };
}

// 'The 'Keyboard_IsVoiceTypingKeyEnabled' setting controls whether the voice typing feature can be activated using a designated keyboard shortcut. When enabled, users can easily initiate voice typing by pressing the specific key, enhancing accessibility and convenience for dictation tasks.'
export interface KeyboardIsVoiceTypingKeyEnabledAction {
  actionName: "KeyboardIsVoiceTypingKeyEnabled";
  id: "Keyboard_IsVoiceTypingKeyEnabled";
  parameters: {
    originalUserRequest: string;
    enabled: boolean;
  };
}

// This setting allows you to disable typing and inking personalization features on your Windows desktop. By turning off typing history, you can enhance your privacy regarding how your inputs are used for personalized suggestions and experiences. This applies to both typing and inking settings within the system.
export interface PersonalizeInkType {
  actionName: "PersonalizeInkType";
  id: "Privacy_PersonalizeInkType_Toggle";
  parameters: {
    originalUserRequest: string;
    featureType: string;
  };
}

// 'The 'Share Clipboard Items' setting allows users to share clipboard content across devices linked through Microsoft accounts. When enabled, it facilitates seamless transfer of copied text, images, and files between devices, enhancing productivity and continuity in multi-device environments. If disabled, clipboard sharing is restricted to the local device only.'
export interface ShareClipboardItemsAction {
    actionName: "ShareClipboardItems";
    id: "Clipboard_IsShareClipboardItemsEnabled";
    parameters: {
        originalUserRequest: string;
        enable: boolean;
    };
}

// The setting in Windows allows users to access their Videos folder directly from the Start menu or Start screen.
export interface StartPlacesVideosAction {
  actionName: "StartPlacesVideos";
  id: "Start_PlacesVideos";
  parameters: {
    originalUserRequest: string;
    actionType: "show" | "remove";
    target: "video shortcut";
  };
}

// 'Filter Keys is an accessibility feature in Windows that helps users with motor impairments by ignoring brief or repeated keystrokes. When Filter Keys is enabled, it can be customized to prevent the keyboard from registering bounces, allowing for more deliberate input. This setting enhances typing accuracy and reduces errors when using the keyboard.'
export interface FilterBounceKeysEnabledAction {
    actionName: "filterBounceKeysEnabled";
    id: "Accessibility_Keyboard_FilterBounceKeysEnabled";
    parameters: {
        originalUserRequest: string;
        enabled: boolean;
    };
}

// This setting controls the visibility of the key background on the touch keyboard in Windows. When enabled, the keys can have a transparent background, allowing for a more seamless appearance with the desktop environment. This option is particularly useful for users who prefer a minimalist look while using the touch keyboard.
export interface EnableKeyBackground {
  actionName: "EnableKeyBackground";
  id: "Personalize_TouchKeyboard_Enable_KeyBackground";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// This setting determines the video resolution for your display when the device is running on battery power. Lowering the resolution can help conserve battery life by reducing power consumption, which is particularly useful for laptops and portable devices.
export interface AdjustVideoResolutionOnBatteryAction {
  actionName: "AdjustVideoResolutionOnBattery";
  id: "Video_ResolutionOnBattery";
  parameters: {
    originalUserRequest: string;
    enable: boolean; // Enable or disable video resolution adjustment on battery
  };
}

// 'This setting enables users to write in the handwriting panel using their fingertip on desktop devices. It is part of the Windows Ink feature, which enhances handwriting and typing experiences, allowing for better interaction with touch and pen input.'
export interface EnableIhmInkingWithTouch {
    actionName: "EnableIhmInkingWithTouch";
    id: "Devices_Pen_IhmInkingWithTouchEnabled";
    parameters: {
        originalUserRequest: string;
    };
}

// This setting allows you to disable scrolling when dragging with two fingers on the touchpad. It is applicable to desktop environments and helps control touchpad behavior, particularly for users who prefer not to have unintended scrolling while using gestures.
export interface PanEnabled {
 actionName: "PanEnabled";
 id: "Input_Touch_PanEnabled";
 parameters: {
 originalUserRequest: string;
 enabled: boolean;
 };
}

// Adjust the microphone volume for game captures.
export interface AdjustMicrophoneVolumeForGameCaptures {
    actionName: "AdjustMicrophoneVolumeForGameCaptures";
    id: "Gaming_RecordedAudio_MicVolume";
    parameters: {
        originalUserRequest: string;
        volumeAction: "increase" | "decrease";
    };
}

// The 'Stereo 3D' setting allows you to enable or
// disable stereoscopic 3D visuals on your desktop.
// When enabled, it enhances the visual experience by
// providing a three-dimensional effect, suitable for
// compatible displays and applications.
export interface EnableStereoscopic3DAction {
  actionName: "EnableStereoscopic3D";
  id: "Display_IsStereoEnabled";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// This setting allows you to enable the double-tap and drag functionality on your touchpad. By turning off this feature, you can prevent unintentional dragging of items on the desktop when tapping twice, enhancing precision and control while using the touchpad.
export interface EnableTouchPadDoubleTapDrag {
    actionName: "EnableTouchPadDoubleTapDrag";
    id: "Input_Touch_TapAndDrag";
    parameters: {
        originalUserRequest: string;
        enable: boolean;
    };
}

// 'This setting allows you to sync your passwords, including Wi-Fi networks and account credentials, across devices using your Microsoft account. By enabling this option, your saved passwords will be accessible on other synced PCs, enhancing convenience and security.'
export interface SyncCredentials {
  actionName: "SyncCredentials";
  id: "SyncSettings_SyncCredentials_Toggle";
  parameters: {
    originalUserRequest: string;
    enableSync?: boolean;
  };
}

// this setting allows users to enable or disable the double-tap space bar feature, which automatically inserts a period and space after double-tapping the space bar while typing.
export interface DoubleTapSpaceToggle {
  actionName: "DoubleTapSpaceToggle";
  id: "Keyboard_IsDoubleTapSpaceEnabled";
  parameters: {
    originalUserRequest: string;
  };
}

// This setting allows you to enable or disable the lock screen slideshow while your device is running on battery power. It is part of the personalization settings for customizing your lock screen experience.
export interface LockScreenSlideshowOnBatteryAction {
    actionName: "LockScreenSlideshowOnBattery";
    id: "Personalize_LockScreenSlideshowEnabledOnBattery";
    parameters: {
        originalUserRequest: string;
        enable?: boolean;
    };
}

// This setting enables a slideshow on the Lock Screen when your PC is locked, allowing you to display a series of images as a backdrop. It is part of the personalization options in Windows, enhancing the visual appeal of your lock screen.
export interface EnableLockScreenSlideshowAutoLockAction {
  actionName: "EnableLockScreenSlideshowAutoLock";
  id: "Personalize_LockScreenSlideshowAutoLock";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// 'This setting allows your desktop to automatically turn off the screen when you leave the area, using human presence detection. It enhances security by locking the screen when you are not present, helping to conserve power and protect your data.'
export interface LockOnSwitch {
    actionName: "LockOnSwitch";
    id: "PowerAndSleep_HumanPresence_LockOnSwitch";
    parameters: {
        originalUserRequest: string;
        enable: boolean;
    };
}

// The 'Narrator Audio Ducking' setting allows users to lower the volume of other apps while Narrator is speaking. This feature helps ensure that spoken content from Narrator can be heard clearly without interference from background audio, enhancing accessibility for users who rely on this screen reader.
export interface EnableNarratorAudioDucking {
  actionName: "EnableNarratorAudioDucking";
  id: "Accessibility_Narrator_IsDuckAudioEnabled";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// The Magnifier's color inversion feature allows users to invert colors on the screen for improved visibility and accessibility. This setting is particularly beneficial for individuals with visual impairments, enabling them to enhance contrast and reduce glare while using the desktop environment.
export interface EnableMagnifierColorInversion {
    actionName: "EnableMagnifierColorInversion";
    id: "Accessibility_Magnifier_IsInversionColorEnabled";
    parameters: {
        originalUserRequest: string;
        isEnabled: boolean;
    };
}

// This setting allows your pen to function as a mouse in legacy applications on desktop devices. It enhances compatibility for older software that may not fully support pen input, enabling smoother interactions with traditional mouse-based interfaces.
export interface EnablePenInteractionModel {
  actionName: "enablePenInteractionModel";
  id: "Devices_Pen_EnablePenInteractionModel";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// Allows users to manage which specific applications can access their account information. When enabled, users can grant or revoke access for individual apps. Disabling this setting prevents all listed apps from retrieving account details.
export interface ManageAccountInfoAccess {
    actionName: "manageAccountInfoAccess";
    id: "CapabilityAccess_AccountInfo_SystemGlobal";
    parameters: {
        originalUserRequest: string;
        specificApps: string[];
        accessStatus: 'enabled' | 'disabled';
    };
}

// 'The Fast Key Entry setting for Narrator on desktop allows users to choose how touch keyboard keys are activated while using Narrator. It enables faster typing by allowing keys to be pressed when the finger is lifted, enhancing the touch typing experience for users with accessibility needs.'
export interface EnableFastKeyEntry {
    actionName: "enableFastKeyEntry";
    id: "Accessibility_Narrator_IsFastKeyEntryEnabled";
    parameters: {
        originalUserRequest: string;
    };
}

// This setting allows users to display file extensions for all files in Windows File Explorer, enabling better identification of file types and enhancing file management capabilities.
export interface ShowFileExtensions {
  actionName: "ShowFileExtensions";
  id: "Developer_Mode_Setting_ShowFileExt2";
  parameters: {
    originalUserRequest: string;
    turnOn: boolean;
    turnOff: boolean;
  };
}

// Advanced Display Settings in Windows allows users to customize monitor-specific features such as resolution, refresh rate, and color depth. It provides options tailored for different types of displays, optimizing performance and visual quality based on the monitor's specifications. This setting is useful for gamers, graphic designers, and anyone needing precise control over their display output.
export interface ConfigureAdvancedDisplaySettings {
  actionName: "ConfigureAdvancedDisplaySettings";
  parameters: {
    originalUserRequest: string;
    id: "Display_AdvancedDisplaySettingsMonitorSpecialization";
  };
}

// 'The CapabilityAccess_BluetoothSync_UserGlobal setting controls the global permissions for Bluetooth synchronization on a Windows device. When enabled, it allows applications to access and synchronize data with Bluetooth devices, facilitating seamless connectivity and data exchange. This setting impacts user experience with Bluetooth features across different applications.'
export interface ManageBluetoothSyncAccess {
  actionName: "ManageBluetoothSyncAccess";
  id: "CapabilityAccess_BluetoothSync_UserGlobal";
  parameters: {
    originalUserRequest: string;
  };
}

// The Wi-Fi only setting for offline maps allows users to download maps only when connected to non-metered Wi-Fi networks.
// This helps manage data usage by preventing downloads over metered connections, ensuring users can access maps offline without incurring additional data charges.
export interface WiFiOnlyMaps {
  actionName: "WiFiOnlyMaps";
  id: "Maps_Wifi_Only_Setting";
  parameters: {
    originalUserRequest: string;
  };
}

// 'The Mouse Keys Indicator setting allows you to display an icon on the taskbar that indicates when Mouse Keys is enabled. Mouse Keys enables users to control the mouse pointer using the numeric keypad, providing an alternative method for navigation. This feature is especially useful for individuals with limited mobility or those who prefer keyboard input over a traditional mouse.'
export interface EnableMouseKeysIndicator {
    actionName: "EnableMouseKeysIndicator";
    id: "Accessibility_IsMouseKeysIndicatorEnabled";
    parameters: {
        originalUserRequest: string;
    };
}

// This setting allows users to ignore touch input while using a pen on their desktop. It ensures that when the pen is in use, any accidental touch interactions do not interfere with the pen's functionality, enhancing the user experience for pen-based tasks.
export interface SetArbitrationType {
  actionName: "SetArbitrationType";
  id: "Devices_Pen_SetArbitrationType";
  parameters: {
    originalUserRequest: string;
  };
}

// The Narrator mouse settings allow users to enable Narrator to read and interact with the screen using the mouse
export interface EnableNarratorReadMouse {
  actionName: "enableNarratorReadMouse";
  id: "Accessibility_Narrator_IsReadMouseEnabled";
  parameters: {
    originalUserRequest: string;
  };
}

// This setting disables the zoom function that occurs when using a two-finger pinch gesture on the touchpad. When enabled, users will not zoom in or out unintentionally while using the touchpad, providing a more stable experience for tasks that involve gestures.
export interface DisableTouchZoomAction {
    actionName: "disableTouchZoom";
    id: "Input_Touch_ZoomEnabled";
    parameters: {
        originalUserRequest: string;
    };
}

// The 'Dim my screen when I look away' setting allows your desktop to automatically dim the screen when it detects that you are no longer present, helping to conserve power and enhance privacy. This feature utilizes presence sensing technology to determine your attention and adjust screen brightness accordingly.
export interface DimMyScreenWhenILookAwayAction {
    actionName: "DimMyScreenWhenILookAway";
    id: "PowerAndSleep_HumanPresence_DimSwitch";
    parameters: {        
        originalUserRequest: string;
        enable: boolean;
    };
}


// This setting allows users to change the execution policy for PowerShell scripts. It enables local scripts to run without a signature while requiring signed scripts for remote execution, enhancing security and flexibility in script management.
export interface ChangeExecutionPolicyAction {
    actionName: "changeExecutionPolicy";
    id: "Developer_Mode_Setting_PowerShellExecution2";
    parameters: {
        originalUserRequest: string;
        executionPolicy: string;
    };
}


// Adjust the system volume for audio recorded during game captures.
export interface GameCaptureAudioVolume {
  actionName: "GameCaptureAudioVolume";
  id: "Gaming_RecordedAudio_SystemVolume";
  parameters: {
    originalUserRequest: string;
    volumeLevel: number;
  };
}

// this setting allows desktop applications to capture screenshots and record the screen, enhancing user control over privacy and security settings.
export interface ManageGraphicsCaptureAccessAction {
    actionName: "ManageGraphicsCaptureAccess";
    id: "CapabilityAccess_GraphicsCaptureProgrammatic_SystemGlobal";
    parameters: {
        originalUserRequest: string;
    };
}

// This setting determines whether video enhancements are enabled when the device is running on battery power. Enabling video enhancements can improve visual quality for media playback but may lead to higher battery consumption. Disabling it can help conserve battery life while still allowing basic video functionality.
export interface VideoEnhancementsOnBattery {
    actionName: "VideoEnhancementsOnBattery";
    id: "Video_EnhancementsOnBattery";
    parameters: {        
        originalUserRequest: string;
        enableEnhancements: boolean;
    };
}

// The setting 'Video_HDROnBattery' controls whether High Dynamic Range (HDR) video playback is enabled while the device is running on battery power. Enabling this feature can enhance visual quality but may impact battery life.
export interface VideoHDROnBatteryAction {
  actionName: "VideoHDROnBattery";
  id: "Video_HDROnBattery";
  parameters: {
    originalUserRequest: string;
  };
}

// This setting enables experimental scripting features for Narrator, aimed at enhancing its functionality in certain applications like Outlook and Excel. It facilitates improved reading experiences, allowing users to navigate and interact with app content more efficiently using Narrator.
export interface EnableNarratorScripting {
  actionName: "EnableNarratorScripting";
  id: "Accessibility_Narrator_IsScriptingEnabled";
  parameters: {
    originalUserRequest: string;
  };
}

// 'this setting allows users to display the full path of the current folder in the title bar of File Explorer, enhancing navigation and clarity.'
export interface ShowFullPathInTitleBar {
    actionName: "showFullPathInTitleBar";
    id: "Developer_Mode_Setting_FullPath2";
    parameters: {        
        originalUserRequest: string;
    };
}

// The 'Enable Shell Handwriting' setting allows users to write directly into text fields using a pen or stylus when supported.
// This feature enhances input options, enabling more natural text entry and interaction within applications that support handwriting recognition.
export interface EnableShellHandwriting {
    actionName: "enableShellHandwriting";
    id: "Devices_Pen_EnableShellHandwriting";
    parameters: {
        originalUserRequest: string;
    };
}

// The Narrator cursor setting allows you to show or hide a visual indicator (a blue rectangle) that represents the Narrator's focus on the desktop. When enabled, it highlights the position of the Narrator cursor, making it easier to track as it moves across the screen. This feature is useful for users who rely on Narrator for accessibility, enhancing the visibility of the cursor during navigation.
export interface EnableNarratorCursorHighlight {
    actionName: "EnableNarratorCursorHighlight";
    id: "Accessibility_Narrator_IsHighlightCursorEnabled";
    parameters: {
        originalUserRequest: string;
    };
}

// The Narrator function key echo setting allows users to hear a spoken confirmation
// of function keys as they type. This feature enhances accessibility by providing
// auditory feedback on key presses, helping users understand which keys they are using in real-time.
export interface EnableNarratorFunctionKeyEcho {
  actionName: "enableNarratorFunctionKeyEcho";
  id: "Accessibility_Narrator_IsEchoFunctionKeyEnabled"
  parameters: { 
    originalUserRequest: string;    
  };
}


// Adjust the speed at which Narrator reads text aloud, allowing you to make the voice faster or slower.
export interface NarratorReadingSpeed {
  actionName: "NarratorReadingSpeed";
  id: "Accessibility_Narrator_SpeechSpeed";
  parameters: {
    originalUserRequest: string;
    speed: number;
  };
}

// this setting allows users to enable or disable apps from showing search results from the web, affecting their privacy and search experience.
export interface GlobalWebSearchToggle {
  actionName: "GlobalWebSearchToggle";
  id: "Search_GlobalWebSearchToggle";
  parameters: {
    originalUserRequest: string;
    enableWebSearch: boolean;
  };
}


// This setting enables the display of snapped windows as groups in the taskbar, Task View, and when using Alt+Tab. It enhances multitasking by allowing users to see and manage groups of snapped applications together, improving workflow efficiency and organization of open windows.
export interface ShowSnapGroupsInSwitchersAction {
  actionName: "ShowSnapGroupsInSwitchersAction";
  id: "MultiTasking_ShowSnapGroupsInSwitchers";
  parameters: {
    originalUserRequest: string;
  };
}

// Snap Assist is a Windows feature that helps users multitask by suggesting available windows to snap alongside an active window. When enabled, it displays thumbnails of other open applications when you snap a window to one side of the screen, making it easier to select and arrange multiple windows for improved productivity.
export interface SnapAssistEnabled {
    actionName: "SnapAssistEnabled";
    id: "MultiTasking_SnapAssistEnabled";
    parameters: {
        originalUserRequest: string;
        enabled: boolean;
    };
}

// The Toggle Key Echo setting in Narrator allows users to hear audio cues for Caps Lock, Num Lock, and other toggle keys while typing. This feature enhances accessibility by providing auditory feedback, helping users confirm their key presses. When enabled, it ensures that toggle keys are announced, improving the typing experience for those relying on screen reading technology.
export interface EnableNarratorEchoToggleKeyAction {
  actionName: "EnableNarratorEchoToggleKey";
  id: "Accessibility_Narrator_IsEchoToggleKeyEnabled";
  parameters: {
    originalUserRequest: string;
  };
}

// 'The Snap Layouts feature allows users to view and arrange multiple open windows side-by-side by displaying snap layouts when hovering over the maximize button. This enhances multitasking by simplifying window organization, allowing for efficient use of screen space on desktop devices.'
export interface ShowSnapLayoutsFromMaximizeButton {
  actionName: "showSnapLayoutsFromMaximizeButton";
  id: "MultiTasking_SAFlyout";
  parameters: {
    originalUserRequest: string;
  };
}

// 'The 'Wake my device when I approach' setting allows your desktop to automatically wake up when it detects your presence, enhancing convenience and accessibility. This feature utilizes human presence sensing technology to ensure your device is ready for use as you approach, improving the overall user experience with instant access to your system.'
export interface WakeOnSwitchAction {
  actionName: "WakeOnSwitch";
  id: "PowerAndSleep_HumanPresence_WakeOnSwitch";
  parameters: {
    originalUserRequest: string;
  };
}

// The Snap Bar setting allows you to enable or disable the display of snap layouts at the top of your screen. This feature helps you easily arrange windows side-by-side or in specific configurations, enhancing multitasking efficiency on your desktop. It supports touch and drag interactions for seamless window management.
export interface EnableSnapBar {
  actionName: "enableSnapBar";
  id: "MultiTasking_SnapBar";
  parameters: {
    originalUserRequest: string;
  };
}

// 'The 'Enable Key Pressed Display' setting allows users to display visual indicators of additional keys pressed while using a pen on desktop devices. This feature enhances interaction by providing feedback on key inputs, making it easier to understand pen functionality in conjunction with keyboard actions.'
export interface EnableKeyPressedDisplayAction {
  actionName: "EnableKeyPressedDisplay";
  id: "Devices_Pen_EnableKeyPressedDisplay";
  parameters: {
    originalUserRequest: string;
  };
}

// 'this setting allows apps to capture screenshots without displaying the border, enhancing privacy and security for users.'
export interface ManageGraphicsCaptureWithoutBorder {
  actionName: "manageGraphicsCaptureWithoutBorder";
  id: "CapabilityAccess_GraphicsCaptureWithoutBorder_SystemGlobal";
  parameters: {
    originalUserRequest: string;
  };
}

// This setting allows users to manage global access permissions for radios,
// such as Wi-Fi and Bluetooth, enhancing privacy and security by controlling
// which applications can utilize these features.
export interface ManageRadiosAccess {
  actionName: "ManageRadiosAccess";
  id: "CapabilityAccess_Radios_SystemGlobal";
  parameters: {
    originalUserRequest: string;
  };
}

// Adjust the pitch of the Narrator's voice for a higher or lower tone
export interface NarratorVoicePitch {
  actionName: "NarratorVoicePitch";
  id: "Accessibility_Narrator_SpeechPitch";
  parameters: {
    originalUserRequest: string;
    pitchLevel?: number;
  };
}

// The 'Follow Mouse Cursor' setting in the Magnifier tool allows the magnified view to automatically track and follow the mouse cursor as it moves across the screen. This feature helps users with visual impairments to easily locate the cursor and focus on the area of interest without needing to manually adjust the magnification view.
export interface FollowMouseCursorInMagnifier {
    actionName: "FollowMouseCursorInMagnifier";
    id: "Accessibility_Magnifier_IsFollowMouseCursorEnabled";
    parameters: {        
        originalUserRequest: string;
    };
}

// This setting allows you to access to picture libraries for all applications on your Windows system. It is part of the privacy settings, ensuring that apps cannot access your photos and images without your permission, thereby enhancing your privacy and control over your personal data.
export interface ManagePicturesAccess {
  actionName: "ManagePicturesAccess";
  id: "CapabilityAccess_Pictures_SystemGlobal";
  parameters: {
    originalUserRequest: string;
  };
}


// 'this setting allows users to display or hide empty drives in the file explorer, enhancing visibility for developers when managing storage devices.'
export interface ShowEmptyDrivesAction {
  actionName: "ShowEmptyDrives";
  id: "Developer_Mode_Setting_EmptyDrives2";
  parameters: {
    originalUserRequest: string;
  };
}

// this setting allows users to see the option to run applications as a different user from the Start menu, enhancing flexibility in user access management.
export interface RunAsDifferentUserOption {
  actionName: "RunAsDifferentUserOption";
  id: "Developer_Mode_Setting_RunAsUser2";
  parameters: {
    originalUserRequest: string;
  };
}

// The Echo Navigation Key setting in Narrator allows users to hear sounds for navigation keys like Arrow and Tab as they type. This feature enhances keyboard feedback, enabling users to better understand their typing actions and navigate more effectively with auditory cues.
export interface EnableEchoNavigationKey {
  actionName: "EnableEchoNavigationKey";
  id: "Accessibility_Narrator_IsEchoNavigationKeyEnabled";
  parameters: {
    originalUserRequest: string;
  };
}

// The Magnifier setting for bitmap smoothing enhances the appearance of images and text by applying anti-aliasing techniques.
// This feature smooths edges, reducing jaggedness and improving clarity, making it easier to read text and view images while using the Magnifier tool on desktop.
// It is particularly beneficial for users with visual impairments, ensuring a more pleasant visual experience.
export interface UseBitmapSmoothingAction {
  actionName: "useBitmapSmoothing";
  id: "Accessibility_Magnifier_UseBitmapSmoothing";
  parameters: {
    originalUserRequest: string;
  };
}

// 'this setting allows apps to access and use files in your downloads folder, which can enhance functionality but may raise privacy concerns.'
export interface ManageDownloadsFolderAccess {
  actionName: "ManageDownloadsFolderAccess";
  id: "CapabilityAccess_DownloadsFolder_SystemGlobal";
  parameters: {
    originalUserRequest: string;
  };
}

// 'The 'Enable Ripple' setting for pen devices allows users to turn visual feedback on or off when using a pen on desktop devices. This feature provides a visual indication of pen interactions, enhancing the user experience during drawing or writing tasks.'
export interface EnableRippleEffectAction {
  actionName: "EnableRippleEffect";
  id: "Devices_Pen_EnableRipple";
  parameters: {
    originalUserRequest: string;
  };
}

// this setting allows users to control whether apps can access their file system, enhancing privacy and security.
export interface ManageFileSystemAccess {
  actionName: "ManageFileSystemAccess";
  id: "CapabilityAccess_FileSystem_SystemGlobal";
  parameters: {
    originalUserRequest: string;
  };
}

// This setting allows apps to access your calendar information for better functionality and personalized experiences.
export interface ManageCalendarAccess {
  actionName: "manageCalendarAccess";
  id: "CapabilityAccess_Calendar_SystemGlobal";
  parameters: {
    originalUserRequest: string;
  };
}

// 'this setting enables users to swipe from the left edge of the screen to access various system features or apps, enhancing multitasking and navigation on touch-enabled devices.'
export interface SwipeFromLeftEdge {
  actionName: "SwipeFromLeftEdge";
  id: "Input_Touch_EdgyLeft";
  parameters: {
    originalUserRequest: string;
  };
}

// this setting controls the user's ability to grant or restrict access to phone call functionalities for apps on the device. It helps manage privacy by allowing users to choose which applications can initiate phone calls.
export interface ManagePhoneCallAccess {
  actionName: "ManagePhoneCallAccess";
  id: "CapabilityAccess_PhoneCall_SystemGlobal";
  parameters: {
    originalUserRequest: string;
  };
}

export interface EnableNarratorFollowInsertion {
  actionName: "EnableNarratorFollowInsertion";
  id: "Accessibility_Narrator_IsFollowInsertionEnabled";
  parameters: {
    // 'This setting enables the Narrator to move the text cursor in sync with the Narrator cursor while reading text. It helps users who rely on the Narrator to maintain focus on both the text and the cursor, enhancing accessibility and navigation within documents and applications.'
    originalUserRequest: string;    
  };
}

// This setting allows users to disable access to contacts for all applications on the desktop. It is part of the privacy settings, ensuring that apps cannot access contact information without permission, thereby enhancing user privacy and control over personal data.
export interface ManageContactsAccess {
  actionName: "ManageContactsAccess";
  id: "CapabilityAccess_Contacts_SystemGlobal";
  parameters: {
    originalUserRequest: string;
  };
}

// The Echo Modifier Key setting in Narrator allows users to hear sounds for Shift, Alt, and other modifier keys while typing. This feature enhances accessibility by providing auditory feedback on key presses, helping users to understand which modifier keys are being activated during typing.
export interface EnableEchoModifierKey {
    actionName: "EnableEchoModifierKey";
    id: "Accessibility_Narrator_IsEchoModifierKeyEnabled";
    parameters: {        
        originalUserRequest: string;
    };
}

// This setting enables the use of online services with Narrator, enhancing its capabilities by providing additional features such as privacy-focused image descriptions, page titles, popular links, and headings. It improves the accessibility experience for users by allowing Narrator to fetch more detailed contextual information from the web.
export interface EnableNarratorOnlineServices {
    actionName: "enableNarratorOnlineServices";
    id: "Accessibility_Narrator_IsOnlineServicesEnabled";
    parameters: {        
        originalUserRequest: string;
    };
}

// This setting allows you to sync your personalization preferences across devices, including color schemes, lock screen settings, and high contrast options. Enabling it ensures a consistent look and feel on all your Windows devices by automatically applying your selected personalization settings.
export interface SyncPersonalization {
  actionName: "SyncPersonalization";
  id: "SyncSettings_SyncPersonalization_Toggle";
  parameters: {
    originalUserRequest: string;
  };
}

// 'this setting controls whether apps can access the user's messaging capabilities, ensuring user privacy and security.'
export interface ManageMessagingAccess {
  actionName: "ManageMessagingAccess";
  id: "CapabilityAccess_Messaging_SystemGlobal";
  parameters: {
    originalUserRequest: string;    
  };
}

// this setting allows users to control whether apps can access their email, enhancing privacy and security by managing permissions.
export interface ManageEmailAccess {
  actionName: "manageEmailAccess";
  id: "CapabilityAccess_Email_SystemGlobal";
  parameters: {
    originalUserRequest: string;
  };
}

// this setting allows users to enable or disable the synchronization of Windows settings across devices.
export interface SyncSettingsToggle {
  actionName: "SyncSettingsToggle";
  id: "SyncSettings_Windows_Toggle2";
  parameters: {
    originalUserRequest: string;
  };
}

// Adjust the volume level of the Narrator's voice for better accessibility.
export interface AdjustNarratorVolume {
  actionName: "AdjustNarratorVolume";
  id: "Accessibility_Narrator_SpeechVolume";
  parameters: {
    originalUserRequest: string;
    volumeLevel?: number;
  };
}

// 'this setting allows users to enable or disable the automatic display of Narrator Home when Narrator is started, enhancing accessibility for users who rely on screen reading features.'
export interface ShowNarratorHomeOnStart {
  actionName: "ShowNarratorHomeOnStart";
  id: "Accessibility_Narrator_IsNarratorHomeAutoStartEnabled";
  parameters: {
    originalUserRequest: string;
  };
}

// 'This setting allows you to disable access to call history for all applications on your desktop. By turning off this access, you enhance your privacy by preventing apps from viewing or utilizing your call history.'
export interface ManageCallHistoryAccess {
  actionName: "ManageCallHistoryAccess";
  id: "CapabilityAccess_PhoneCallHistory_SystemGlobal";
  parameters: {
    originalUserRequest: string;
  };
}

// This setting manages the user-specific permission for apps to access cross-app diagnostic information. It is dependent on the device-level permission being enabled and potentially involves managing a list of apps allowed or disallowed access
export interface ManageAppDiagnosticAccess {
  actionName: "ManageAppDiagnosticAccess";
  id: "CapabilityAccess_AppDiagnostics_SystemGlobal";
  parameters: {
    originalUserRequest: string;
  };
}

// 'The Snap settings allow users to quickly position windows on their desktop by snapping them to the edges of the screen without the need to drag them fully.
// This feature enhances multitasking by enabling easy organization of open applications, making it simpler to view and work with multiple windows simultaneously.
export interface EnableSnapAction {
  actionName: "EnableSnap";
  id: "MultiTasking_DITest";
  parameters: {
    originalUserRequest: string;
  };
}

// This setting is checked, which means that while recording, system and application audio will be muted in the recording, possibly allowing only microphone input or no audio at all.
export interface MuteSystemAudioDuringGameRecording {
    actionName: "muteSystemAudioDuringGameRecording";
    id: "Gaming_RecordedAudio_PerAppAudio";
    parameters: {
        originalUserRequest: string;
    };
}

// This setting allows you to enable a dynamic lock screen image that reacts to the movement of your PC. It is part of the personalization options for the desktop and sign-in screen, enhancing the visual experience when you access your device.
export interface EnableDynamicLockScreenImageAction {
  actionName: "EnableDynamicLockScreenImage";
  id: "Personalize_LockScreenBackground3";
  parameters: {
    originalUserRequest: string;
  };
}

// The Maps Auto Update Setting allows users to enable or disable automatic updates for mapping applications on Windows. When enabled, the system will periodically check for and install updates to ensure that maps and navigation features are current, improving accuracy and functionality. Disabling this setting prevents automatic downloads, requiring manual updates instead.
export interface AutoUpdateMaps {
  actionName: "AutoUpdateMaps";
  id: "Maps_Auto_Update_Setting";
  parameters: {
    originalUserRequest: string;
  };
}

// This setting allows you to synchronize your accessibility preferences across devices. By enabling it, your configurations for features like voice access, voice typing, and speech recognition will be saved and applied automatically, ensuring a consistent experience on all devices linked to your account.
export interface SyncAccessibilitySettings {
  actionName: "SyncAccessibilitySettings";
  id: "SyncSettings_SyncAccessibility_Toggle";
  parameters: {
    originalUserRequest: string;
  };
}

// 'This setting controls whether background recording for gaming is enabled when the device is unplugged. When activated, it allows the system to capture and save gameplay footage even when the laptop or device is running on battery power, which can impact battery life. Users can toggle this option based on their preference for performance versus power conservation while gaming on the go.'
export interface GamingBackgroundRecordingWhenUnplugged {
  actionName: "GamingBackgroundRecordingWhenUnplugged";
  id: "Gaming_BackgroundRecording_WhenUnplugged";
  parameters: {        
    originalUserRequest: string;
    enabled: boolean;
  };
}

// this setting allows applications to access and manage your tasks for better integration and functionality across apps.
export interface ManageTasksAccess {
  actionName: "ManageTasksAccess";
  id: "CapabilityAccess_Tasks_SystemGlobal";
  parameters: {
    originalUserRequest: string;
  };
}

// Determines whether the background download limit is set as an absolute value (in Mbps) rather than a percentage of available bandwidth. When enabled, the background download speed is capped at a fixed Mbps value instead of a percentage.
export interface DeliveryOptimizationIsDownloadLimitAbsBack {
    actionName: "DeliveryOptimizationIsDownloadLimitAbsBack";
    id: "DeliveryOptimization_IsDownloadLimitAbsBack";
    parameters: {
        originalUserRequest: string;        
    };
}

// This setting determines whether background recording for gaming is enabled when projecting wirelessly. If activated, it allows gameplay footage to be recorded even while using a wireless display, enhancing the gaming experience by capturing moments without interrupting gameplay.
export interface GamingBackgroundRecordingWhenWirelessProjectingAction {
    actionName: "GamingBackgroundRecordingWhenWirelessProjecting";
    id: "Gaming_BackgroundRecording_WhenWirelessProjecting";
    parameters: {        
        originalUserRequest: string;
        // No specific parameters information available from the sample, thus, only originalUserRequest included
    };
}

// This setting determines whether Narrator automatically launches after you have logged into your Windows user account., If enabled, Narrator will begin reading the desktop or the currently active window immediately upon login.
export interface EnableNarratorAutoStart {
    actionName: "EnableNarratorAutoStart";
    id: "Accessibility_Narrator_IsAutoStartEnabled";
    parameters: {
        originalUserRequest: string;
    };
}

// This setting allows you to enable access to music libraries for all applications on your desktop. It is part of the privacy settings and controls which apps can access your music data, enhancing your privacy by restricting music permissions.
export interface ManageMusicLibraryAccess {
  actionName: "ManageMusicLibraryAccess";
  id: "CapabilityAccess_MusicLibrary_SystemGlobal";
  parameters: {
    originalUserRequest: string;
  };
}

// 'The Sync Language Settings option allows you to synchronize your language preferences across devices in Windows. This setting ensures that your selected language, including dictionaries and other language-related configurations, is consistent across all your Windows devices, enhancing your user experience.'
export interface SyncLanguageSettings {
    actionName: "SyncLanguageSettings";
    id: "SyncSettings_SyncLanguage_Toggle";
    parameters: {
        originalUserRequest: string;
    };
}

// this setting allows users to enable or disable the narrator's feature that reads letters, numbers, and punctuation aloud as they type, enhancing accessibility for individuals with visual impairments.
export interface EchoCharacterToggle {
    actionName: "EchoCharacterToggle";
    id: "Accessibility_Narrator_IsEchoCharacterEnabled";
    parameters: {
        originalUserRequest: string;
    };
}

// The 'Echo Words' setting in Narrator allows users to hear each word spoken aloud as they type.
// This feature enhances typing feedback, making it easier to confirm input, especially for individuals with visual impairments.
// It can be customized in the Narrator settings to toggle on or off, providing flexibility in how users interact with text input on their desktop.
export interface EnableEchoWords {
    actionName: "EnableEchoWords";
    id: "Accessibility_Narrator_IsEchoWordEnabled";
    parameters: {
        originalUserRequest: string;
    };
}

// this setting allows apps to access and utilize files stored in your documents library, enabling a more integrated experience while ensuring you have control over your privacy settings.
export interface ManageDocumentsAccess {
    actionName: "ManageDocumentsAccess";
    id: "CapabilityAccess_Documents_SystemGlobal";
    parameters: {
        originalUserRequest: string;
    };
}

// The setting controls whether a background download bandwidth limit is applied. When enabled, background update downloads will be restricted to the configured percentage or absolute Mbps limit.
export interface DeliveryOptimizationIsDownloadLimitBackAction {
  actionName: "DeliveryOptimizationIsDownloadLimitBack",
  id: "DeliveryOptimization_IsDownloadLimitBack",
  parameters: {
    originalUserRequest: string;
  };
}

// This setting controls whether Narrator automatically begins speaking when you arrive at the Windows login screen. When enabled, Narrator will read aloud the login prompts and options, providing auditory guidance before you even enter your password.
export interface EnableNarratorAutoStartOnLogon {
    actionName: "EnableNarratorAutoStartOnLogon";
    id: "Accessibility_Narrator_IsAutoStartOnLogonDesktopEnabled";
    parameters: {
        originalUserRequest: string;
    };
}

// 'this setting automatically archives infrequently used apps to save storage space and internet bandwidth, preserving your files and data. When you access an archived app, it will connect to the internet to restore the full version if available.'
export interface AppOffloadAction {
  actionName: "AppOffload";
  id: "Apps_Offloading";
  parameters: {
    originalUserRequest: string;
  };
}

// This setting allows apps to access your videos library for enhanced functionality while ensuring your privacy preferences are respected.
export interface ManageVideosAccess {
  actionName: "ManageVideosAccess";
  id: "CapabilityAccess_Videos_SystemGlobal";
  parameters: {
    originalUserRequest: string;
  };
}

// Adjust the intensity of haptic feedback for touchpad interactions
export interface HapticFeedbackIntensity {
  actionName: "HapticFeedbackIntensity";
  id: "Input_Touch_FeedbackIntensity";
  parameters: {
    originalUserRequest: string;
    intensityLevel: string;
  };
}

// Determines whether the foreground download limit is set as an absolute value (in Mbps) instead of a percentage of available bandwidth. When enabled, Windows will limit foreground download speeds to a specific Mbps value
export interface DeliveryOptimizationIsDownloadLimitAbsForeAction {
  actionName: "DeliveryOptimizationIsDownloadLimitAbsFore";
  id: "DeliveryOptimization_IsDownloadLimitAbsFore";
  parameters: {
    originalUserRequest: string;
  };
}

// This setting allows applications to override the default behavior of the pen's shortcut button on desktop devices, enabling users to customize how the button functions for different apps.
export interface EnablePenButtonOverride {
  actionName: "EnablePenButtonOverride";
  id: "Devices_Pen_EnablePenButtonOverride";
  parameters: {
    originalUserRequest: string;
  };
}

// this setting allows users to configure the pen button to function as a right-click equivalent when available.
export interface PenRightClickToggle {
  actionName: "PenRightClickToggle";
  id: "Devices_Pen_RightClickEquivalent";
  parameters: {
    originalUserRequest: string;
  };
}

// This setting controls whether a foreground download bandwidth limit is applied. When enabled, Windows will restrict foreground update downloads to the configured percentage or absolute Mbps limit.
export interface DeliveryOptimizationIsDownloadLimitFore {
  actionName: "DeliveryOptimizationIsDownloadLimitFore";
  id: "DeliveryOptimization_IsDownloadLimitFore";
  parameters: {
    originalUserRequest: string;
  };
}

// 'this setting allows the user to automatically send diagnostic and performance data related to Narrator, enhancing accessibility features and improving user experience.'
export interface EnableNarratorLogging {
  actionName: "EnableNarratorLogging";
  id: "Accessibility_Narrator_IsAlwaysLoggingEnabled";
  parameters: {
      originalUserRequest: string;
      // Additional parameters can be added as necessary
  };
}

// This setting allows the user to lock the Narrator key, enabling command execution without the need to press the key for each action.
export interface NarratorKeyLockToggle {
  actionName: "NarratorKeyLockToggle";
  id: "Accessibility_Narrator_IsNarratorKeyLocked";
  parameters: {
    originalUserRequest: string;
  };
}

// Adjust the strength of enhanced pen support settings.
export interface EnhancedPenSupportStrength {
  actionName: "EnhancedPenSupportStrength";
  id: "Devices_Pen_EnhancedSupportIntensity";
  parameters: {
    originalUserRequest: string;    
  };
}

// this setting allows the user to enable or disable the display of the pen menu when the pen is removed from its storage.
export interface PenMenuToggle {
  actionName: "PenMenuToggle";
  id: "Devices_Pen_EnablePenWorkspaceLaunchOnPenDetach_Rejuv";
  parameters: {
    originalUserRequest: string;
  };
}

// this setting allows users to use the top of the pen to erase ink when available, enhancing the functionality of the pen for drawing or note-taking.
export interface PenEraseInkToggle {
  actionName: "PenEraseInkToggle";
  id: "Devices_Pen_EraseInk";
  parameters: {
    originalUserRequest: string;
  };
}

// The 'Start Magnifier after sign-in' setting enables the Magnifier tool to automatically launch whenever you sign into your Windows account. This feature is particularly useful for users who require visual assistance, ensuring that the magnification tool is readily available without needing to manually start it each time.
export interface EnableMagnifierAutoStart {
    actionName: "enableMagnifierAutoStart";
    id: "Accessibility_Magnifier_IsAutoStartEnabled";
    parameters: {
        originalUserRequest: string;
    };
}

// The Diagnostic Data Viewer setting allows users to enable or disable the viewing of diagnostic data collected by Windows. This feature provides transparency into the data Microsoft collects, helping users manage their privacy related to telemetry and feedback settings. Users can access and review their diagnostic data to understand what information is being shared.
export interface DiagnosticDataViewerAction {
    actionName: "DiagnosticDataViewer";
    id: "Privacy_Telemetry_Viewer_Toggle_2";
    parameters: {
        originalUserRequest: string;
    };
}

// The 'Magnifier Follow Narrator' setting allows the Magnifier tool to follow the voice feedback provided by the Narrator feature. When enabled, as the Narrator reads text or interacts with elements on the screen, the Magnifier zooms in on those areas, enhancing accessibility for users with visual impairments by providing a clearer view of the content being read.
export interface EnableFollowNarrator {
    actionName: "EnableFollowNarrator";
    id: "Accessibility_Magnifier_IsFollowNarratorEnabled";
    parameters: {
        originalUserRequest: string;
    };
}

// The Magnifier Is Follow Key Focus Enabled setting in Windows Accessibility allows the Magnifier tool to follow the keyboard focus. When enabled, the Magnifier will automatically adjust its view to center on the item currently selected or focused by the keyboard, enhancing visibility for users with visual impairments.
export interface MagnifierIsFollowKeyFocusEnabled {
  actionName: "MagnifierIsFollowKeyFocusEnabled";
  id: "Accessibility_Magnifier_IsFollowKeyFocusEnabled";
  parameters: {
    originalUserRequest: string;
  };
}

// The 'Follow the Insert Point' feature in the Magnifier settings allows the magnified view to automatically track the location of the text cursor (insert point) as you type or navigate. This ensures that the area around the cursor is always visible and easily readable, enhancing accessibility for users with visual impairments.
export interface EnableMagnifierFollowInsertPoint {
  actionName: "enableMagnifierFollowInsertPoint";
  id: "Accessibility_Magnifier_IsFollowInsertPointEnabled";
  parameters: {
    originalUserRequest: string;
  };
}

// The Video Lighting setting in Windows allows users to adjust video quality based on ambient lighting conditions. This feature enhances video playback by optimizing brightness and contrast, ensuring a better viewing experience in varying light environments. It is applicable to desktop settings and can improve overall visual performance in apps that utilize video playback.
export interface AdjustVideoLightingAction {
  actionName: "AdjustVideoLighting";
  id: "Video_Lighting";
  parameters: {
    originalUserRequest: string;
  };
}

// this setting allows the Magnifier tool to automatically start when signing into the desktop, enhancing accessibility for users who require magnification of on-screen content.
export interface StartMagnifierBeforeSignIn {
  actionName: "StartMagnifierBeforeSignIn";
  id: "Accessibility_Magnifier_IsAutoStartOnLogonDesktopEnabled";
  parameters: {
    originalUserRequest: string;
  };
}

// this setting determines whether the narrator will vocalize errors related to actions that cannot be performed, enhancing accessibility for users who rely on audio feedback.
export interface VoicedNarratorErrorsToggle {
  actionName: "VoicedNarratorErrorsToggle";
  id: "Accessibility_Narrator_AreNarratorErrorsVoiced";
  parameters: {
    originalUserRequest: string;
  };
}

// this setting allows users to enable or disable the syncing of their preferences across devices, ensuring a consistent experience.
export interface RememberPreferencesToggle {
  actionName: "RememberPreferencesToggle";
  id: "SyncSettings_SyncMaster_Toggle2";
  parameters: {
    originalUserRequest: string;
  };
}

// 'this setting allows the Narrator to provide hints on how to interact with buttons and other controls, enhancing accessibility for users.'
export interface ReadHintsToggle {
  actionName: "readHintsToggle";
  id: "Accessibility_Narrator_IsReadHintsEnabled";
  parameters: {        
    originalUserRequest: string;
  };
}

// 'The 'Near Share' feature in Windows allows users to share files and links with nearby devices over Bluetooth
// or Wi-Fi. When 'SharedExperiences_NearShareEnabled' is enabled, it facilitates seamless content sharing between devices,
// enhancing collaboration and connectivity without the need for email or cloud services.'
export interface NearShareEnabledAction {
    actionName: "NearShareEnabled";
    id: "SharedExperiences_NearShareEnabled";
    parameters: {
        originalUserRequest: string;
    };
}

// 'this setting allows users to enable or disable slight pauses when the Narrator reads punctuation, enhancing the clarity of speech output.'
export interface IntonationPauseToggle {
    actionName: "IntonationPauseToggle";
    id: "Accessibility_Narrator_IsIntonationPauseEnabled";
    parameters: {
        originalUserRequest: string;
        enablePause: boolean;
    };
}

// This setting determines the behavior of the external display when human presence is detected. It controls whether the external display will lock or remain active based on user proximity, helping to enhance security and conserve energy by automatically managing screen activity when the user is not present.
export interface PowerAndSleepHumanPresenceLockExternalDisplayAction {
    actionName: "PowerAndSleepHumanPresenceLockExternalDisplay";
    id: "PowerAndSleep_HumanPresence_LockExternalDisplay";
    parameters: {
        originalUserRequest: string;
    };
}

// 'this setting enables the Narrator to read characters phonetically, enhancing accessibility for users who may benefit from phonetic reading.'
export interface ReadPhoneticallyToggle {
  actionName: "ReadPhoneticallyToggle";
  id: "Accessibility_Narrator_IsReadCharactersPhoneticallyEnabled";
  parameters: {
    originalUserRequest: string;
  };
}

// This setting dims your screen automatically when it detects that you are not looking at it, provided an external display is connected, helping to save power and enhance privacy.
export interface DimScreenWhenAwayAction {
  actionName: "DimScreenWhenAway";
  id: "PowerAndSleep_HumanPresence_DimExternalDisplay";
  parameters: {
    originalUserRequest: string;
  };
}

// 'The 'Follow Mouse' feature in Narrator allows the screen reader cursor to automatically track the position of the mouse pointer on the desktop. This setting enhances accessibility by providing real-time feedback as you move the mouse, making it easier for users who rely on Narrator to navigate and interact with their system.'
export interface EnableNarratorFollowMouse {
    actionName: "EnableNarratorFollowMouse";
    id: "Accessibility_Narrator_IsFollowMouseEnabled";
    parameters: {
        originalUserRequest: string;
    };
}

// this setting allows the Narrator to automatically find and download new scripts or extensions when it starts up, enhancing its functionality and user experience.
export interface FindAndDownloadScriptsAction {
  actionName: "FindAndDownloadScripts";
  id: "Accessibility_Narrator_FindAndDownloadScripts";
  parameters: {
    originalUserRequest: string;
  };
}

// 'this setting allows users to enable or disable the improvement of ink input recognition for handwriting, enhancing the overall experience when using touch or stylus input on devices.'
export interface ImproveInkTypeToggle {
    actionName: "ImproveInkTypeToggle";
    id: "Privacy_ImproveInkType_Toggle_2";
    parameters: {
        originalUserRequest: string;
    };
}

// The 'Wake on Touch' setting allows users to enable or disable the feature that wakes the device from sleep mode when the touch screen is tapped. This setting is applicable to desktop devices and enhances accessibility by allowing quick access to the system with a simple touch gesture.
export interface WakeOnTouch {
  actionName: "WakeOnTouch";
  id: "Input_Touch_WakeOnTouch";
  parameters: {
    originalUserRequest: string;    
  };
}

// this setting allows users to enable or disable the resume feature for apps, enhancing multitasking by allowing apps to continue from where they left off after being closed or interrupted.
export interface ResumeToggle {
    actionName: "ResumeToggle";
    id: "Toggle_Resume";
    parameters: {        
        originalUserRequest: string;
        // No specific parameters in sample
    };
}

// this setting allows users to enable or disable the emphasis of formatted text when Narrator is reading, enhancing the reading experience for users with visual impairments.
export interface EmphasizeFormattedText {
    actionName: "EmphasizeFormattedText";
    id: "Accessibility_Narrator_IsReadingWithIntentEnabled";
    parameters: {
        originalUserRequest: string;
    };
}

// This setting allows you to control the amount of diagnostic data sent to Microsoft from your desktop. You can choose between different levels of data sharing, which influences how Microsoft collects feedback and telemetry information. Adjusting these settings helps manage your privacy and the extent of information shared with Microsoft.
export interface ControlDiagnosticData {
    actionName: "controlDiagnosticData";
    id: "Privacy_Diagnostic_Data_Toggle_2";
    parameters: {
        originalUserRequest: string;
    };
}

// this setting allows the device to automatically wake up when the user approaches while an external display is connected.
export interface WakeDeviceOnApproach {
  actionName: "WakeDeviceOnApproach";
  id: "PowerAndSleep_HumanPresence_WakeExternalDisplay";
  parameters: {
    originalUserRequest: string;
  };
}

// this setting allows users to enable or disable tailored experiences based on their activity and feedback, enhancing personalization while managing privacy preferences.
export interface TailoredExperiencesToggle {
  actionName: "TailoredExperiencesToggle";
  id: "Privacy_TailoredExperiences";
  parameters: {
    originalUserRequest: string;
    enable: boolean;
  };
}

// 'this setting controls whether applications can access the presence sensing feature, which detects if a user is present in front of the device, enhancing privacy and security by managing access to this capability.'
export interface PresenceSensingAccess {
  actionName: "PresenceSensingAccess";
  id: "CapabilityAccess_HumanPresence_SystemGlobal";
  parameters: {
    originalUserRequest: string;
  };
}

// 'this setting allows users to choose to hear sounds instead of spoken announcements for common actions, enhancing the accessibility experience.'
export interface PlaySoundsInsteadOfAnnouncements {
    actionName: "PlaySoundsInsteadOfAnnouncements";
    id: "Accessibility_Narrator_IsHearOnlySoundsForCommonActionsEnabled";
    parameters: {        
        originalUserRequest: string;
    };
}

// this setting restricts the Developer Portal to accept connections only from loopback addresses, enhancing security by limiting access to the local machine.
export interface LoopbackConnectionRestrict {
    actionName: "LoopbackConnectionRestrict";
    id: "Developer_DevicePortalLoopbackToggle";
    parameters: {
        originalUserRequest: string;
    };
}

// 'this setting enhances the interaction experience when using a pen with your device, providing better responsiveness and functionality for creative and productivity tasks.'
export interface EnhancedPenSupportInteraction {
  actionName: "enhancedPenSupportInteraction";
  id: "Devices_Pen_EnhancedSupportInteraction";
  parameters: {
    originalUserRequest: string; // the original request of the user
  };
}

export type SettingsAction =
    | NetworkDiscovery
    | BluetoothToggleAction
    | ScreenDuplicationMode
    | InternetConnectionSharing
    | AdjustVolumeLevel
    | DisplayResolutionAndAspectRatio
    | DesktopBackgroundFit
    | DisplayScaling
    | AdjustScreenBrightnessAction
    | AdjustMicrophoneVolumeAction
    | EnableBlueLightFilterSchedule
    | AdjustColorTemperature
    | WirelessDisplayConnection
    | MouseCursorSpeedAction
    | AutomaticTimeSettingAction
    | AdjustBrightnessLevels
    | AdjustTextSize
    | EnableWifiAction
    | AdjustMousePointerSize
    | AutoHideTaskbar
    | HighContrastTheme
    | SystemThemeMode
    | MousePointerCustomization
    | AdjustScreenOrientation
    | ToggleWidgetsButtonVisibility
    | TaskViewVisibilityAction
    | ManageMicrophoneAccess
    | TaskbarAlignmentAction
    | MusUpdateContinuousInnovationOptin
    | MouseWheelScrollLines
    | EnableMeteredConnectionsAction
    | AdjustDynamicLighting
    | EnableTransparencyAction
    | SetPowerModePluggedIn
    | EnableOnScreenKeyboard
    | EnableQuietHours
    | EnableTouchPad
    | LetWindowsManageDefaultPrinterAction
    | AutomaticProxyDetection
    | ApplyColorToTitleBar
    | RememberWindowLocationsAction
    | SetPowerModeOnBattery
    | BatterySaverActivationLevel
    | DevicesDlGlobalControlledByForegroundAppToggleAction
    | ShowBadgesOnTaskbar
    | SetPrimaryMouseButton
    | EnableStickyKeysAction
    | EnableGameMode
    | EnableEnhancedVisualFeedback
    | MinimizeWindowsOnMonitorDisconnectAction
    | ManageCameraAccess
    | EnergySaverToggle
    | SysTrayChevronToggle
    | TouchpadCursorSpeed
    | ManageColorForApps
    | EnhancePointerPrecision
    | FlashingTaskbarIcons
    | EnableBrightnessDimming
    | LogonScreenBackgroundUseColor
    | TextCursorIndicatorSize
    | EnableColorFiltering
    | EnableCursorDeadzoneJumping
    | EnableStickyShortcut
    | DisplaySecondsInSystrayClock
    | AllowVpnOverMeteredNetworks
    | AirplaneModeEnabled
    | MusUpdateRestartNotifications
    | EnableRandomMacAddress
    | PersonalizeLockScreenOverlayEnabledAction
    | ManageLocationAccess
    | EnableTextPrediction
    | CustomizeNexusButton
    | TogglePenMenuIcon
    | ShowDesktopButtonVisibility
    | AllowVpnWhileRoamingAction
    | SetMouseScroll
    | BackgroundSlideshowShuffle
    | EnableVisualFeedbackForTouch
    | HdrVideoStreamingToggle
    | EnableFilterKeysAction
    | DisplayRecentlyOpenedItems
    | ShowShareButtonAction
    | AutomaticDSTAdjustment
    | MultilingualEnable
    | EnableDynamicLock
    | PasswordLessSignInAction
    | ShowRecentlyAddedApps
    | EnableCursorIndicator
    | AdjustTouchKeyboardSize
    | ShowRecommendations
    | ToggleKeysEnabled
    | KeyboardLanguageBarSelectionAction
    | RotationLock
    | KeyboardInputLanguageSwitching
    | DisplayTaskbarOnAllMonitors
    | MonoAudioToggle
    | ShowMostUsedAppsAction
    | ToggleRemoteDesktopAction
    | AutoHDRToggle
    | ScrollInactiveWindowsAction
    | UsbErrorNotify
    | AutomaticallyTurnOffMobileHotspot
    | EnableStickyTwoKeyPress
    | EnableStickyLockModifier
    | StickyKeysIndicatorEnabled
    | AutoEnhanceVideoAction
    | SetMouseReverseWheelDirectionAction
    | AutoHDRInGraphicsSettingAction
    | WebContentControl
    | EnableSuggestionsInSettingsAction
    | EnableStickyModifierSound
    | StoreAppUsage
    | AutoHideConsciousScrollbars
    | ShowAccountNotificationsInStart
    | EnableNarratorAction
    | IsAnimationsEnabled
    | LeaveTouchPadActiveWithMouse
    | EnableStorageSenseGlobalToggleRejuv
    | MobileOptInToggleAction
    | EnableVoiceAccess
    | ControlCopilotVisibility
    | DynamicRefreshRateToggle
    | GamingBackgroundRecordingToggle
    | UserLocationOverride
    | MouseKeysPointerSpeedAction
    | TextToSpeechPlaybackSpeedAction
    | SaveClipboardItemsAction
    | StartPlacesSettings
    | AttemptRecoveryFromPowerDrainAction
    | RestartAppsAfterSignInAction
    | GameCaptureFrameRate
    | SlideshowEnabledOnBatteryAction
    | AutomaticSignOnLock
    | EnableLiveCaptions
    | EnableMagnifier
    | AllowLowResolutionAction
    | VirtualTouchpadAction
    | MatchAccentColorAction
    | ContinuumPowerMode
    | ToggleStartMenuSettingsFolder
    | EnableMyDeviceHistoryAction
    | EnableAutoCorrectionAction
    | ShowWelcomeExperience
    | ShowNotificationIconAction
    | MouseKeysAccelerationSpeed
    | ShowAccountDetailsOnSignInScreen
    | ScoobeEnabled
    | EnableAeroSnapAction
    | DynamicSearchBox
    | RecordedAudioToggleAction
    | EnableFilterShortcutAction
    | AllowNotificationSound
    | GlobalLightingEffectSpeed
    | ExpandableTaskbarAction
    | QuietMomentsOnFullScreenAction
    | WarningEnabledAction
    | StartPlacesDownloads
    | CaptureMouseCursorAction
    | QuietMomentsOnPresentationEnabledAction
    | StartPlacesDocuments
    | SearchCloudSearchMSAAction
    | EnableAccountNotificationsInSettings
    | EnableQuietMoments
    | EnableStorageSense
    | ShortcutSoundEnabled
    | ShowNotificationsOnLockScreen
    | NotifyWhenAppsRequestLocation
    | GameQuietModeToggle
    | SearchCloudSearchAADAction
    | EnableAeroShake
    | EnableKeyAudioFeedback
    | EnableNarratorShortcutKey
    | SpeechRecognizerRelaxedMode
    | EnableFilterKeyBeep
    | EnableEndTaskInTaskbarAction
    | EnableSpellchecking
    | ShowHiddenAndSystemFiles
    | StartPlacesUserProfile
    | ShowCriticalToastsAboveLock
    | EnableFilterIndicator
    | AdaptiveColor
    | AutoBrightnessEnabled
    | EnableColorFilterShortcutKey
    | SaveLocationAction
    | StartPlacesPictures
    | StartPlacesNetworkAction
    | GlobalTouchGestures
    | EnableVisualAccessibilityAutoStart
    | EnableRemoteDesktopNLA
    | TouchTapsEnabledAction
    | NotifyUsbWeakCharger
    | EnableAutoPlay
    | EnableRightClickZone
    | BackupApplistAction
    | ColorFilterIntensity
    | StartPlacesMusic
    | TypingInsightsToggle
    | EnableMouseKeysNumLockAction
    | EnableSudo
    | EnableAccessibilityOnSecureDesktop
    | EnableAutoCapitalizeAction
    | HDRSupportOnBatteryToggle
    | MouseKeysSpeedControl
    | DisableTwoFingerTapAction
    | IncludeCameraRollInLockScreenSlideshow
    | FilterSlowKeysRepeatEnabledAction
    | OptimizeLockScreenSlideshowAction
    | EnableDeliveryOptimization
    | KeyboardIsVoiceTypingKeyEnabledAction
    | PersonalizeInkType
    | ShareClipboardItemsAction
    | StartPlacesVideosAction
    | FilterBounceKeysEnabledAction
    | EnableKeyBackground
    | AdjustVideoResolutionOnBatteryAction
    | EnableIhmInkingWithTouch
    | PanEnabled
    | AdjustMicrophoneVolumeForGameCaptures
    | EnableStereoscopic3DAction
    | EnableTouchPadDoubleTapDrag
    | SyncCredentials
    | DoubleTapSpaceToggle
    | LockScreenSlideshowOnBatteryAction
    | EnableLockScreenSlideshowAutoLockAction
    | LockOnSwitch
    | EnableNarratorAudioDucking
    | EnableMagnifierColorInversion
    | EnablePenInteractionModel
    | ManageAccountInfoAccess
    | EnableFastKeyEntry
    | ShowFileExtensions
    | ConfigureAdvancedDisplaySettings
    | ManageBluetoothSyncAccess
    | WiFiOnlyMaps
    | EnableMouseKeysIndicator
    | SetArbitrationType
    | EnableNarratorReadMouse
    | DisableTouchZoomAction
    | DimMyScreenWhenILookAwayAction
    | ChangeExecutionPolicyAction
    | GameCaptureAudioVolume
    | ManageGraphicsCaptureAccessAction
    | VideoEnhancementsOnBattery
    | VideoHDROnBatteryAction
    | EnableNarratorScripting
    | ShowFullPathInTitleBar
    | EnableShellHandwriting
    | EnableNarratorCursorHighlight
    | EnableNarratorFunctionKeyEcho
    | NarratorReadingSpeed
    | GlobalWebSearchToggle
    | ShowSnapGroupsInSwitchersAction
    | SnapAssistEnabled
    | EnableNarratorEchoToggleKeyAction
    | ShowSnapLayoutsFromMaximizeButton
    | WakeOnSwitchAction
    | EnableSnapBar
    | EnableKeyPressedDisplayAction
    | ManageGraphicsCaptureWithoutBorder
    | ManageRadiosAccess
    | NarratorVoicePitch
    | FollowMouseCursorInMagnifier
    | ManagePicturesAccess
    | ShowEmptyDrivesAction
    | RunAsDifferentUserOption
    | EnableEchoNavigationKey
    | UseBitmapSmoothingAction
    | ManageDownloadsFolderAccess
    | EnableRippleEffectAction
    | ManageFileSystemAccess
    | ManageCalendarAccess
    | SwipeFromLeftEdge
    | ManagePhoneCallAccess
    | EnableNarratorFollowInsertion
    | ManageContactsAccess
    | EnableEchoModifierKey
    | EnableNarratorOnlineServices
    | SyncPersonalization
    | ManageMessagingAccess
    | ManageEmailAccess
    | SyncSettingsToggle
    | AdjustNarratorVolume
    | ShowNarratorHomeOnStart
    | ManageCallHistoryAccess
    | ManageAppDiagnosticAccess
    | EnableSnapAction
    | MuteSystemAudioDuringGameRecording
    | EnableDynamicLockScreenImageAction
    | AutoUpdateMaps
    | SyncAccessibilitySettings
    | GamingBackgroundRecordingWhenUnplugged
    | ManageTasksAccess
    | DeliveryOptimizationIsDownloadLimitAbsBack
    | GamingBackgroundRecordingWhenWirelessProjectingAction
    | EnableNarratorAutoStart
    | ManageMusicLibraryAccess
    | SyncLanguageSettings
    | EchoCharacterToggle
    | EnableEchoWords
    | ManageDocumentsAccess
    | DeliveryOptimizationIsDownloadLimitBackAction
    | EnableNarratorAutoStartOnLogon
    | AppOffloadAction
    | ManageVideosAccess
    | HapticFeedbackIntensity
    | DeliveryOptimizationIsDownloadLimitAbsForeAction
    | EnablePenButtonOverride
    | PenRightClickToggle
    | DeliveryOptimizationIsDownloadLimitFore
    | EnableNarratorLogging
    | NarratorKeyLockToggle
    | EnhancedPenSupportStrength
    | PenMenuToggle
    | PenEraseInkToggle
    | EnableMagnifierAutoStart
    | DiagnosticDataViewerAction
    | EnableFollowNarrator
    | MagnifierIsFollowKeyFocusEnabled
    | EnableMagnifierFollowInsertPoint
    | AdjustVideoLightingAction
    | StartMagnifierBeforeSignIn
    | VoicedNarratorErrorsToggle
    | RememberPreferencesToggle
    | ReadHintsToggle
    | NearShareEnabledAction
    | IntonationPauseToggle
    | PowerAndSleepHumanPresenceLockExternalDisplayAction
    | ReadPhoneticallyToggle
    | DimScreenWhenAwayAction
    | EnableNarratorFollowMouse
    | FindAndDownloadScriptsAction
    | ImproveInkTypeToggle
    | WakeOnTouch
    | ResumeToggle
    | EmphasizeFormattedText
    | ControlDiagnosticData
    | WakeDeviceOnApproach
    | TailoredExperiencesToggle
    | PresenceSensingAccess
    | PlaySoundsInsteadOfAnnouncements
    | LoopbackConnectionRestrict
    | EnhancedPenSupportInteraction
;
