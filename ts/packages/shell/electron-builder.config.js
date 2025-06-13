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
    files: [
        // For some reason, electron-builder only process "!" and FileSet for node modules.
        {
            filter: [
                "**/*",
                // Ignore all build artifacts
                "!**/*.tsbuildinfo",
                "!**/*.done.build.log",
                // source map doesn't work in asar anyways
                "!**/*.?(c|m)@(t|j)s.map",
                // type definitions files is not needed, but keep the .ts files for schemas for now
                "!**/*.d.?(c|m)ts",
                // Filter native module for platform and arch.
                "!node_modules/koffi/build/koffi",
                "node_modules/koffi/build/koffi/${platform}_${arch}",
                "!node_modules/@img",
                "node_modules/@img/sharp*-${platform}*-${arch}/**/*",
                // appropriate native module already copied to the dist directory at install time. Ignore the original location.
                `!node_modules/@azure/msal-node-runtime/dist/*/*`,
                // Only windows needs it, exclude all of it here and add it back in the win section
                "!node_modules/@azure/msal-node-extensions/bin",
            ],
        },
    ],
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
        files: [
            {
                filter: [
                    "node_modules/@azure/msal-node-extensions/bin/${arch}",
                ],
            },
        ],
    },
    nsis: {
        artifactName: name + "-${version}-${platform}-${arch}-setup.${ext}",
        shortcutName: "${productName}",
        uninstallDisplayName: "${productName}",
        createDesktopShortcut: "always",
    },
    mac: {
        appId: `com.microsoft.typeagentshell`,
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
        target: ["deb"],
        maintainer: "Microsoft Corporation",
        category: "Utility",
        executableName: name,
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
