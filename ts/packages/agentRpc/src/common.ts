// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";

const debug = registerDebug("typeagent:rpc");
const debugError = registerDebug("typeagent:rpc:error");

type MessageHandler<T> = (message: Partial<T>) => void;
type DisconnectHandler = () => void;

export type SharedRpcChannel<T = any> = {
    on(event: "message", cb: MessageHandler<T>): void;
    on(event: "disconnect", cb: DisconnectHandler): void;
    off(event: "message", cb: MessageHandler<T>): void;
    off(event: "disconnect", cb: DisconnectHandler): void;
    send(message: T, cb?: (err: Error | null) => void): void;
};

// Compatible with ChildProcess | NodeJS.Process
export type RpcChannel<T = any> = SharedRpcChannel<T> & {
    once(event: "message", cb: MessageHandler<T>): void;
    once(event: "disconnect", cb: DisconnectHandler): void;
};

type ChannelEventHandlers = {
    message: ((message: any) => void)[];
    disconnect: (() => void)[];
};

type ChannelData = {
    handlers: ChannelEventHandlers;
    once: ChannelEventHandlers;
};

export type ChannelProvider = {
    on(event: "disconnect", cb: DisconnectHandler): void;
    off(event: "disconnect", cb: DisconnectHandler): void;
    createChannel<T = any>(name: string): RpcChannel<T>;
    deleteChannel(name: string): void;
};

// Channel provider adapter to hook up with an actual transport (like a websocket)
export type ChannelProviderAdapter = ChannelProvider & {
    // Deliver messages or notify disconnects to the local client from a connection transport.
    notifyMessage(message: any): void;
    notifyDisconnected(): void;
};

// Channel adapter to hook up with an actual transport (like a websocket)
export type ChannelAdapter = {
    // To actual channel
    channel: RpcChannel;

    // Deliver messages or notify disconnects to the local client from a connection transport.
    notifyMessage(message: any): void;
    notifyDisconnected(): void;
};

type GenericSendFunc = (message: any, cb?: (err: Error | null) => void) => void;

// A generic channel to wrap any transport by providing a send function.
// Returns RpcChannel and functions to trigger `message` and `disconnect` events.
export function createChannelAdapter(
    sendFunc: GenericSendFunc,
): ChannelAdapter {
    const data: ChannelData = {
        handlers: {
            message: [],
            disconnect: [],
        },
        once: {
            message: [],
            disconnect: [],
        },
    };
    const channel: RpcChannel = {
        on(event: "message" | "disconnect", cb: any) {
            data.handlers[event].push(cb);
        },
        once(event: "message" | "disconnect", cb: any) {
            data.once[event].push(cb);
        },
        off(event: "message" | "disconnect", cb: any) {
            data.handlers[event] = data.handlers[event].filter(
                (h) => h !== cb,
            ) as any;
            data.once[event] = data.handlers[event].filter(
                (h) => h !== cb,
            ) as any;
        },
        send(message: any, cb?: (err: Error | null) => void) {
            sendFunc(message, cb);
        },
    };

    const notifyMessage = (message: any) => {
        data.handlers.message.forEach((h) => h(message));
        const callbacks = data.once.message;
        data.once.message = [];
        callbacks.forEach((h) => h(message));
    };

    const notifyDisconnected = () => {
        data.handlers.disconnect.forEach((h) => h());
        const callbacks = data.once.disconnect;
        data.once.disconnect = [];
        callbacks.forEach((h) => h());
    };

    return {
        notifyMessage,
        notifyDisconnected,
        channel,
    };
}

export function createChannelProviderAdapter(
    sendFunc: GenericSendFunc,
): ChannelProviderAdapter {
    const genericSharedChannel = createChannelAdapter(sendFunc);

    return {
        ...createChannelProvider(genericSharedChannel.channel),
        notifyMessage: genericSharedChannel.notifyMessage,
        notifyDisconnected: genericSharedChannel.notifyDisconnected,
    };
}

export function createChannelProvider(
    sharedChannel: SharedRpcChannel,
): ChannelProvider {
    const channelAdapters = new Map<string, ChannelAdapter>();
    sharedChannel.on("message", (message: any) => {
        if (message.name === undefined) {
            debugError(
                `Missing channel name in message: ${JSON.stringify(message)}`,
            );
            return;
        }
        const channelAdapter = channelAdapters.get(message.name);
        if (channelAdapter === undefined) {
            debugError(`Invalid channel name ${message.name} in message`);
            return;
        }
        channelAdapter.notifyMessage(message.message);
    });

    sharedChannel.on("disconnect", () => {
        for (const channel of channelAdapters.values()) {
            channel.notifyDisconnected();
        }
    });
    function createChannel(name: string): RpcChannel {
        debug(`createChannel ${name}`);
        if (channelAdapters.has(name)) {
            throw new Error(`Channel ${name} already exists`);
        }
        const channelAdapter = createChannelAdapter((message, cb) => {
            sharedChannel.send(
                {
                    name,
                    message,
                },
                cb,
            );
        });

        channelAdapters.set(name, channelAdapter);
        return channelAdapter.channel;
    }

    function deleteChannel(name: string) {
        debug(`deleteChannel ${name}`);
        const channel = channelAdapters.get(name);
        if (channel) {
            channelAdapters.delete(name);
            channel.notifyDisconnected();
            debug(`deleteChannel ${name} - deleted`);
        } else {
            debug(`deleteChannel ${name} - already deleted, ignoring`);
        }
    }
    return {
        createChannel,
        deleteChannel,
        on(event: "disconnect", cb: DisconnectHandler) {
            sharedChannel.on(event, cb);
        },
        off(event: "disconnect", cb: DisconnectHandler) {
            sharedChannel.off(event, cb);
        },
    };
}
