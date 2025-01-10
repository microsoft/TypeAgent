// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionContext } from "@typeagent/agent-sdk";
import {
  createAgentRpcClient,
  createGenericChannelProvider,
} from "agent-rpc/client";
import { BrowserActionContext } from "./actionHandler.mjs";
import { WebAgentMessage } from "../common/webAgentMessageTypes.mjs";

function ensureSharedChannelProvider(
  context: SessionContext<BrowserActionContext>,
) {
  const existing = context.agentContext.channelProvider;
  if (existing) {
    return existing;
  }

  const webSocket = context.agentContext.webSocket;
  if (webSocket === undefined) {
    return undefined;
  }

  const provider = createGenericChannelProvider((message) => {
    webSocket.send(
      JSON.stringify({
        target: "webAgent",
        source: "dispatcher",
        messageType: "message",
        body: message,
      }),
    );
  });
  context.agentContext.channelProvider = provider;
  return provider;
}

export async function processWebAgentMessage(
  message: WebAgentMessage,
  context: SessionContext<BrowserActionContext>,
) {
  const channelProvider = ensureSharedChannelProvider(context);
  if (channelProvider === undefined) {
    return;
  }
  switch (message.messageType) {
    case "add":
      context.addDynamicAgent(
        message.body.name,
        message.body.manifest,
        await createAgentRpcClient(message.body.name, channelProvider),
      );
      break;
    case "message":
      channelProvider.message(message.body);
      break;
    case "disconnect":
      channelProvider.deleteChannel(message.body);
      context.removeDynamicAgent(message.body);
      break;
  }
}
