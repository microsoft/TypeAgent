// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionContext } from "@typeagent/agent-sdk";
import {
  createAgentRpcClient,
  createGenericChannelProvider,
} from "agent-rpc/client";
import { BrowserActionContext } from "./actionHandler.mjs";

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
  type: string,
  data: any,
  context: SessionContext<BrowserActionContext>,
) {
  const channelProvider = ensureSharedChannelProvider(context);
  if (channelProvider === undefined) {
    return;
  }
  switch (type) {
    case "add":
      context.addDynamicAgent(
        data.name,
        data.manifest,
        await createAgentRpcClient(data.name, channelProvider),
      );
      break;
    case "message":
      channelProvider.message(data);
      break;
    case "disconnect":
      channelProvider.deleteChannel(data);
      break;
  }
}
