// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Configuration used for 'electron-builder build' step, and not 'install-app-deps' step.

const name = "typeagent-shell";
export default {
    productName: "TypeAgent Shell",
    extraMetadata: {
        name,
        author: {
            name: "Microsoft Corporation",
        },
    },
    directories: {
        app: "deploy",
        buildResources: "build",
        output: "dist",
    },
    asarUnpack: ["node_modules/browser-typeagent/dist/electron/**/*"],
    // Don't need to install
    npmRebuild: false,
    win: {
        executableName: name,
    },
    nsis: {
        artifactName: "${name}-${version}-setup.${ext}",
        shortcutName: "${productName}",
        uninstallDisplayName: "${productName}",
        createDesktopShortcut: "always",
    },
    mac: {
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
    dmg: {
        artifactName: "${name}-${version}.${ext}",
    },
    linux: {
        target: ["AppImage", "snap", "deb"],
        maintainer: "Microsoft Corporation",
        category: "Utility",
    },
    appImage: {
        artifactName: "${name}-${version}.${ext}",
    },
    publish: {
        provider: "generic",
        url: "https://example.com/auto-updates",
    },
};
