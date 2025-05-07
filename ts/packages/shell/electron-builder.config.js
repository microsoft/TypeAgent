// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Configuration used for 'electron-builder build' step, and not 'install-app-deps' step.

const name = "typeagentshell";
const fullName = "TypeAgent Shell";
const account = process.env.AZURESTORAGEACCOUNTNAME;
const container = process.env.AZURESTORAGECONTAINERNAME;
const url =
    account && container
        ? `https://${account}.blob.core.windows.net/${container}/`
        : "";
const channel = process.env.ELECTRON_BUILDER_CHANNEL;
const arch = process.env.ELECTRON_BUILDER_ARCH?.trim();
const channelName = channel && arch ? `${channel}-${arch}` : undefined;

export default {
    extraMetadata: {
        name: fullName,
        author: {
            name: "Microsoft Corporation",
        },
    },
    directories: {
        app: "deploy",
        buildResources: "build",
        output: "dist",
    },
    asarUnpack: [
        // electron can't load the browser extension from the ASAR
        "node_modules/browser-typeagent/dist/electron/**/*",
    ],
    // Don't need to install
    npmRebuild: false,
    artifactName: name + "-${version}-${platform}-${arch}.${ext}",
    win: {
        appId: `Microsoft.TypeAgentShell`,
        executableName: name,
        icon: "build/win/icon.png",
    },
    nsis: {
        artifactName: name + "-${version}-${platform}-${arch}-setup.${ext}",
        shortcutName: "${productName}",
        uninstallDisplayName: "${productName}",
        createDesktopShortcut: "always",
    },
    mac: {
        appId: `com.microsoft.typeagentshell`,
        entitlementsInherit: "build/entitlements.mac.plist",
        extendInfo: {
            NSCameraUsageDescription:
                "Application requests access to the device's camera.",
            NSMicrophoneUsageDescription:
                "Application requests access to the device's microphone.",
            NSDocumentsFolderUsageDescription:
                "Application requests access to the user's Documents folder.",
            NSDownloadsFolderUsageDescription:
                "Application requests access to the user's Downloads folder.",
        },
        notarize: false,
    },
    linux: {
        target: ["AppImage", "snap", "deb"],
        maintainer: "Microsoft Corporation",
        category: "Utility",
        // electron-builder missed the `.so.42` suffix as binary files.
        asarUnpack: ["node_modules/@img/sharp-libvips-linux*/**/*"],
    },
    publish: channelName
        ? {
              provider: "generic",
              channel: channelName,
              url,
          }
        : null,
};
