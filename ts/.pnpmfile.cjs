// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

function readPackage(pkg) {
    // usocket is a native Unix-domain-socket module pulled in as an optional
    // dep of dbus-next. It cannot compile on Windows (requires <sys/ioctl.h>),
    // and electron-builder's install-app-deps tries to rebuild every native
    // module it finds in node_modules — including optional ones whose own
    // build scripts pnpm already skipped. Stripping usocket from dbus-next's
    // optionalDependencies keeps it out of the resolution graph entirely.
    // dbus-next degrades gracefully to Node's built-in net module without it.
    if (pkg.name === "dbus-next" && pkg.optionalDependencies?.usocket) {
        delete pkg.optionalDependencies.usocket;
    }
    return pkg;
}

module.exports = {
    hooks: { readPackage },
};
