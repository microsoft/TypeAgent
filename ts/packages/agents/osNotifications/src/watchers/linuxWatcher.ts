// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
import type {
    OsNotificationListener,
    OsNotificationWatcher,
} from "../watcherProtocol.js";

const debug = registerDebug("typeagent:osNotifications:linux");

// Eavesdrops on the freedesktop notification bus, capturing every
// `org.freedesktop.Notifications.Notify` call as it crosses the session
// bus. Modern dbus-broker / dbus-daemon configurations require the user
// to be in the right group (or the policy to allow eavesdropping); on most
// desktop sessions this works out of the box.
//
// Coverage gap: GNOME and some KDE apps have moved certain notification
// types onto their own portals; those will not appear here. v1 accepts the
// gap and documents it.
export async function startLinuxWatcher(
    listener: OsNotificationListener,
): Promise<OsNotificationWatcher> {
    let dbus: typeof import("dbus-next");
    try {
        // Dynamic import so the package is only loaded on Linux. dbus-next
        // is pure JS but importing it at top level would fail cleanly on
        // Windows test runs anyway — keep the boundary explicit.
        dbus = await import("dbus-next");
    } catch (e: any) {
        listener({
            kind: "error",
            message: `dbus-next is not installed; install the os-notifications-agent package's optional Linux deps. (${e.message ?? e})`,
        });
        return {
            async stop() {},
            async syncNow() {
                throw new Error("dbus-next is not installed.");
            },
        };
    }

    const bus = dbus.sessionBus();

    const matchRule =
        "eavesdrop=true,type='method_call',interface='org.freedesktop.Notifications',member='Notify'";
    const closedRule =
        "eavesdrop=true,type='signal',interface='org.freedesktop.Notifications',member='NotificationClosed'";

    let addMatchOk = true;
    try {
        await bus.call(
            new dbus.Message({
                destination: "org.freedesktop.DBus",
                path: "/org/freedesktop/DBus",
                interface: "org.freedesktop.DBus",
                member: "AddMatch",
                signature: "s",
                body: [matchRule],
            }),
        );
        await bus.call(
            new dbus.Message({
                destination: "org.freedesktop.DBus",
                path: "/org/freedesktop/DBus",
                interface: "org.freedesktop.DBus",
                member: "AddMatch",
                signature: "s",
                body: [closedRule],
            }),
        );
    } catch (e: any) {
        addMatchOk = false;
        listener({
            kind: "error",
            message: `Failed to subscribe to D-Bus notification traffic — eavesdropping may be denied by the bus policy. (${e.message ?? e})`,
        });
    }

    // Track our last-emitted id by the dbus reply serial so we can correlate
    // NotificationClosed with the original Notify. The Notifications spec
    // returns a u32 id from Notify(); some servers replace_id reuses ids,
    // so we key on the server-assigned id when we can capture it.
    const onMessage = (msg: any) => {
        try {
            if (
                msg.member === "Notify" &&
                msg.interface === "org.freedesktop.Notifications" &&
                msg.type === 1 /* METHOD_CALL */
            ) {
                // Notify signature: susssasa{sv}i
                //   app_name, replaces_id, app_icon, summary, body,
                //   actions, hints, expire_timeout
                const body = msg.body ?? [];
                const app = String(body[0] ?? "");
                const replacesId = Number(body[1] ?? 0);
                const summary = String(body[3] ?? "");
                const bodyText = String(body[4] ?? "");

                // Without intercepting the reply we can't see the
                // server-assigned id. Use replaces_id when present; else
                // fall back to a synthesized id derived from serial.
                const id =
                    replacesId > 0
                        ? `replace:${replacesId}`
                        : `serial:${msg.serial}`;

                listener({
                    kind: "added",
                    id,
                    app,
                    title: summary,
                    body: bodyText,
                    timestamp: Date.now(),
                });
            } else if (
                msg.member === "NotificationClosed" &&
                msg.interface === "org.freedesktop.Notifications" &&
                msg.type === 4 /* SIGNAL */
            ) {
                const closedId = Number(msg.body?.[0] ?? 0);
                if (closedId > 0) {
                    // Most notifications we emitted with serial ids won't
                    // match — only replace-id ones will. Best-effort dismiss.
                    listener({
                        kind: "removed",
                        id: `replace:${closedId}`,
                    });
                }
            }
        } catch (e: any) {
            debug("error handling dbus message: %s", e.message ?? e);
        }
    };

    bus.on("message", onMessage);

    return {
        // D-Bus eavesdropping observes notifications as they cross the bus —
        // there is no way to enumerate notifications already in the
        // freedesktop notification daemon. Sync is fundamentally unsupported
        // on Linux.
        async syncNow(): Promise<void> {
            throw new Error(
                "Sync is not supported on Linux: the freedesktop notification spec does not expose existing notifications, only new ones as they arrive on the bus.",
            );
        },
        async stop() {
            bus.off?.("message", onMessage);
            try {
                if (addMatchOk) {
                    await bus.call(
                        new dbus.Message({
                            destination: "org.freedesktop.DBus",
                            path: "/org/freedesktop/DBus",
                            interface: "org.freedesktop.DBus",
                            member: "RemoveMatch",
                            signature: "s",
                            body: [matchRule],
                        }),
                    );
                    await bus.call(
                        new dbus.Message({
                            destination: "org.freedesktop.DBus",
                            path: "/org/freedesktop/DBus",
                            interface: "org.freedesktop.DBus",
                            member: "RemoveMatch",
                            signature: "s",
                            body: [closedRule],
                        }),
                    );
                }
            } catch (e: any) {
                debug("error removing dbus match: %s", e.message ?? e);
            }
            try {
                bus.disconnect();
            } catch {
                // best effort
            }
        },
    };
}
