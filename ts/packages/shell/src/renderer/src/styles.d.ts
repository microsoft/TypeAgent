// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Ambient declarations for the shared stylesheet side-effect imports. These
// resolve to `.css` files that are injected by the bundler at runtime; tsc
// only needs to know the modules exist.
declare module "@typeagent/chat-ui/styles";
declare module "@typeagent/completion-ui/styles.css";
