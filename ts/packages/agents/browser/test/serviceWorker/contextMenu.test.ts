// test/serviceWorker/contextMenu.test.ts

// Mock dependencies
jest.mock('../../src/extension/serviceWorker/storage', () => ({
    removePageSchema: jest.fn().mockImplementation(() => Promise.resolve())
  }));
  
  jest.mock('../../src/extension/serviceWorker/websocket', () => ({
    sendActionToAgent: jest.fn().mockImplementation(() => Promise.resolve({ success: true })),
    getWebSocket: jest.fn().mockReturnValue({
      readyState: 1, // WebSocket.OPEN
      send: jest.fn()
    })
  }));
  
  // Load the module under test
  let contextMenuModule: any;
  
  describe('Context Menu Module', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      
      // Reload the module under test for each test
      jest.isolateModules(() => {
        contextMenuModule = require('../../src/extension/serviceWorker/contextMenu');
      });
    });
    
    describe('initializeContextMenu', () => {
      it('should create context menu items', () => {
        contextMenuModule.initializeContextMenu();
        
        // Check that chrome.contextMenus.create was called
        expect(chrome.contextMenus.create).toHaveBeenCalled();
      });
    });
    
    describe('handleContextMenuClick', () => {
      it('should handle menu clicks', async () => {
        const mockTab = { id: 123, url: 'https://example.com' };
        const mockInfo = { menuItemId: 'discoverPageSchema' };
        
        await contextMenuModule.handleContextMenuClick(mockInfo, mockTab);
        
        // Check that the side panel was opened
        expect(chrome.sidePanel.open).toHaveBeenCalledWith({ tabId: 123 });
      });
      
      it('should handle reInitCrosswordPage menu click', async () => {
        const mockTab = { id: 123, url: 'https://example.com' };
        const mockInfo = { menuItemId: 'reInitCrosswordPage' };
        
        await contextMenuModule.handleContextMenuClick(mockInfo, mockTab);
        
        // Check that the message was sent
        expect(chrome.tabs.sendMessage).toHaveBeenCalled();
      });
      
      it('should return early if tab is undefined', async () => {
        const mockInfo = { menuItemId: 'reInitCrosswordPage' };
        
        await contextMenuModule.handleContextMenuClick(mockInfo, undefined);
        
        // Should not attempt to use the tab
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
      });
    });
  });