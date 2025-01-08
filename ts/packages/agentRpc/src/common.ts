// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";

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
    createChannel(name: string): RpcChannel;
    deleteChannel(name: string): void;
};
export type GenericChannelProvider = ChannelProvider & {
    message(message: any): void;
    disconnect(): void;
};

type GenericChannel = {
    channel: RpcChannel;
    message: (message: any) => void;
    disconnect: () => void;
};

function createGenericChannel(
    sendFunc: (message: any) => void,
): GenericChannel {
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
            sendFunc(message);
        },
    };

    const message = (message: any) => {
        data.handlers.message.forEach((h) => h(message));
        const callbacks = data.once.message;
        data.once.message = [];
        callbacks.forEach((h) => h(message));
    };

    const disconnect = () => {
        data.handlers.disconnect.forEach((h) => h());
        const callbacks = data.once.disconnect;
        data.once.disconnect = [];
        callbacks.forEach((h) => h());
    };

    return {
        message,
        disconnect,
        channel,
    };
}

export function createGenericChannelProvider(
    sendFunc: (message: any) => void,
): GenericChannelProvider {
    const genericSharedChannel = createGenericChannel(sendFunc);

    return {
        ...createChannelProvider(genericSharedChannel.channel),
        message: genericSharedChannel.message,
        disconnect: genericSharedChannel.disconnect,
    };
}

export function createChannelProvider(
    sharedChannel: SharedRpcChannel,
): ChannelProvider {
    const channels = new Map<string, GenericChannel>();
    sharedChannel.on("message", (message: any) => {
        if (message.name === undefined) {
            debugError("Missing channel name in message");
            return;
        }
        const channel = channels.get(message.name);
        if (channel === undefined) {
            debugError(`Invalid channel name ${message.name} in message`);
            return;
        }
        channel.message(message.message);
    });

    sharedChannel.on("disconnect", () => {
        for (const channel of channels.values()) {
            channel.disconnect();
        }
    });
    function createChannel(name: string): RpcChannel {
        if (channels.has(name)) {
            throw new Error(`Channel ${name} already exists`);
        }
        const genericChannel = createGenericChannel((message: any) => {
            sharedChannel.send({
                name,
                message,
            });
        });

        channels.set(name, genericChannel);
        return genericChannel.channel;
    }

    function deleteChannel(name: string) {
        if (!channels.delete(name)) {
            throw new Error(`Channel ${name} does not exists`);
        }
    }
    return {
        createChannel,
        deleteChannel,
    };
}
