// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

chrome.runtime.onMessage.addListener((message, sender, reply) => {
    switch (message.type) {
      case 'initialize':
        console.log("Browser Agent Service Worker started");  
        //chrome.runtime.getPlatformInfo(reply);        
        reply("Service worker initialize called");
        break;
    }
  
    // Respond asynchronously
    return true;
  });
  
  