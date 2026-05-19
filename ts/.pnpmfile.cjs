// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

function readPackage(pkg) {
    // usocket is a native Unix-domain-socket module pulled in by dbus-next.
    // It cannot compile on Windows (requires <sys/ioctl.h>), and
    // electron-builder's install-app-deps tries to rebuild every native module
    // it finds in node_modules — including optional ones whose own build
    // scripts pnpm already skipped. Stripping usocket from dbus-next keeps it
    // out of the resolution graph entirely. dbus-next degrades gracefully to
    // Node's built-in net module without it.
    //
    // dbus-next@0.10.2 lists usocket in BOTH `dependencies` and
    // `optionalDependencies`; we must strip from both, otherwise a fresh
    // resolution (e.g. dependabot regenerating pnpm-lock.yaml) picks it up
    // from `dependencies` and Windows installs fail with
    //   error C1083: Cannot open include file: 'sys/ioctl.h'
    if (pkg.name === "dbus-next") {
        if (pkg.dependencies?.usocket) {
            delete pkg.dependencies.usocket;
        }
        if (pkg.optionalDependencies?.usocket) {
            delete pkg.optionalDependencies.usocket;
        }
    }
    return pkg;
}

module.exports = {
    hooks: { readPackage },
};
