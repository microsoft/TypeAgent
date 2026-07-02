// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export {
    PlatformAdapter,
    ChatSettingsView,
    defaultChatSettings,
} from "./platformAdapter.js";

export { setContent, swapContent } from "./setContent.js";

export {
    PartialCompletion,
    PcCompletionState,
    PcDirection,
    PcPostMessage,
    PcPost,
} from "./partialCompletion.js";

export {
    ChatPanel,
    ChatPanelOptions,
    CompletionResult,
    DynamicDisplayResult,
    DEFAULT_AVATAR_MAP,
    NotifyExplainedData,
    HistoryEntry,
} from "./chatPanel.js";

export {
    FEEDBACK_VARIANTS,
    FeedbackController,
    FeedbackUIVariant,
    FeedbackWidget,
} from "./feedbackWidget.js";

export {
    ConversationBar,
    type ConversationBarController,
    type ConversationBarConversation,
    type ConversationBarIcon,
    type ConversationBarIconName,
    type ConversationBarIcons,
    type ConversationBarOptions,
    type ConversationBarStatus,
} from "./conversationBar.js";

export {
    formatConnectionStatusText,
    renderConnectionStatus,
    type ConnectionStatus,
    type ConnectionActionId,
    type ConnectionActionHandler,
} from "./connectionStatus.js";

export { ChatContextMenu, ContextMenuTargetOptions } from "./contextMenu.js";

export type {
    SpeechState,
    SpeechInputProvider,
    TtsMetrics,
    TtsProvider,
    ImageCaptureProvider,
    ChoiceOption,
    SettingsField,
    SettingsSection,
    SettingsPanelSchema,
    HelpPanelContent,
} from "./providers.js";

export { openSettingsPopup, openHelpPopup } from "./popups.js";

export { TemplateEditor, type TemplateEditServices } from "./templateEditor.js";
