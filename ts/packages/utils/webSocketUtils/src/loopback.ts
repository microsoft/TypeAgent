// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Address every same-machine listener in this repo should bind to.
 *
 * Node's `net.Server.listen(port)` and `new WebSocketServer({ port })` bind
 * `0.0.0.0` when no host is given, which publishes the listener on every
 * interface (LAN, corporate wifi, hotspot). TypeAgent's local listeners are
 * unauthenticated RPC surfaces that drive the dispatcher, so they must be
 * restricted to this machine at the socket level.
 */
export const LOOPBACK_HOST = "127.0.0.1";

/**
 * True when `host` names the local machine, so a listener bound to it is
 * only reachable from this machine. Used to decide whether an explicit
 * host override needs a "this is exposed to the network" warning.
 *
 * IPv6 loopback is accepted in both the bracketed (`[::1]`, as it appears
 * in URLs) and bare (`::1`, as it appears in listen options) forms.
 */
export function isLoopbackHost(host: string): boolean {
    const normalized = host.trim().toLowerCase();
    return (
        normalized === "localhost" ||
        normalized === "::1" ||
        normalized === "[::1]" ||
        // 127.0.0.0/8 is entirely loopback, not just 127.0.0.1. Match the
        // dotted-quad literal exactly: a prefix test would also accept
        // hostnames like "127.example.com", which resolve wherever DNS says
        // and would suppress the network-exposure warning on a public bind.
        isLoopbackIPv4(normalized)
    );
}

function isLoopbackIPv4(host: string): boolean {
    const octets = host.split(".");
    if (octets.length !== 4) {
        return false;
    }
    if (!octets.every((o) => /^\d{1,3}$/.test(o) && Number(o) <= 255)) {
        return false;
    }
    return octets[0] === "127";
}
