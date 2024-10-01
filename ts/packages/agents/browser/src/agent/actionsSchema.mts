// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type BrowserActions =
  | OpenTabAction
  | CloseTabAction
  | SwitchToTabAction
  | SwitchToTabByPositionAction
  | CloseWindowAction
  | GoBackAction
  | GoForwardAction
  | ScrollDownAction
  | ScrollUpAction
  | FollowLinkByTextAction
  | FollowLinkByPositionAction
  | OpenFromHistory
  | OpenFromBookmarks
  | AddToBookmarks
  | SearchAction
  | ReadPageContent
  | StopReadPageContent
  | ZoomIn
  | ZoomOut
  | ZoomReset
  | CaptureScreenshot
  | ReloadPage
  | UnknownAction;

export type UnknownAction = {
  actionName: "unknown";
  parameters: {
    // text typed by the user that the system did not understand
    text: string;
  };
};

// This opens a new tab in an existing browser window.
// IMPORTANT: This does NOT launch new browser windows.
export type OpenTabAction = {
  actionName: "openTab";
  parameters: {
    url?: string; // full URL to website
    query?: string;
  };
};

// This closes a tab in an existing browser window.
// IMPORTANT: This does NOT close browser programs.
export type CloseTabAction = {
  actionName: "closeTab";
  parameters: {
    title?: string;
  };
};

export type CloseWindowAction = {
  actionName: "closeWindow";
  parameters: {
    title?: string;
  };
};

export type SearchAction = {
  actionName: "search";
  parameters: {
    query?: string;
  };
};

export type GoBackAction = {
  actionName: "goBack";
  parameters: {};
};

export type GoForwardAction = {
  actionName: "goForward";
  parameters: {};
};

export type ScrollDownAction = {
  actionName: "scrollDown";
  parameters: {};
};

export type ScrollUpAction = {
  actionName: "scrollUp";
  parameters: {};
};

// Switch to an open tab, based on the tab's title
// Example:
//  user: Switch to the Haiti tab
//  agent: {
//     "actionName": "switchToTabByText",
//     "parameters": {
//        "keywords": "Haiti"
//     }
//  }
export type SwitchToTabAction = {
  actionName: "switchToTabByText";
  parameters: {
    keywords: string; // text that shows up as part of the tab title. Remove filler words such as "the", "article", "link","page" etc.
  };
};

export type SwitchToTabByPositionAction = {
  actionName: "switchToTabByPosition";
  parameters: {
    position: number;
  };
};

// follow a link on the page to open a related page or article
// Example:
//  user: Open the Haiti link
//  agent: {
//     "actionName": "followLinkByText",
//     "parameters": {
//        "keywords": "Haiti"
//     }
//  }
export type FollowLinkByTextAction = {
  actionName: "followLinkByText";
  parameters: {
    keywords: string; // text that shows up as part of the link. Remove filler words such as "the", "article", "link","page" etc.
    openInNewTab?: boolean;
  };
};

export type FollowLinkByPositionAction = {
  actionName: "followLinkByPosition";
  parameters: {
    position: number;
    openInNewTab?: boolean;
  };
};

export type OpenFromHistory = {
  actionName: "openFromHistory";
  parameters: {
    keywords: string; // text that shows up as part of the link. Remove filler words such as "the", "article", "link","page" etc.
    startDate?: ApproxDatetime;
    endDate?: ApproxDatetime;
  };
};

export type OpenFromBookmarks = {
  actionName: "openFromBookmarks";
  parameters: {
    keywords: string; // text that shows up as part of the link. Remove filler words such as "the", "article", "link","page" etc.
  };
};

export type ZoomIn = {
  actionName: "zoomIn";
  parameters: {};
};

export type ZoomOut = {
  actionName: "zoomOut";
  parameters: {};
};

export type ZoomReset = {
  actionName: "zoomReset";
  parameters: {};
};

export type AddToBookmarks = {
  actionName: "addToBookmarks";
  parameters: {
    url: string;
  };
};

export type ReadPageContent = {
  actionName: "readPage";
  parameters: {};
};

export type StopReadPageContent = {
  actionName: "stopReadPage";
  parameters: {};
};

export type CaptureScreenshot = {
  actionName: "captureScreenshot";
  parameters: {};
};

export type ReloadPage = {
  actionName: "reloadPage";
  parameters: {};
};

export interface ApproxDatetime {
  // Default: "unknown"
  displayText: string;
  // If precise timestamp can be set
  timestamp?: string;
}
