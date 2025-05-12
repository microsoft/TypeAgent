// test/serviceWorker/websocket.test.ts
import { MockWebSocket } from '../mock-chrome-api';

// Mock dependencies
jest.mock('../../src/extension/serviceWorker/storage', () => ({
  getSettings: jest.fn().mockImplementation(() => Promise.resolve({
    websocketHost: 'ws://localhost:8080/'
  }))
}));

jest.mock('../../src/extension/serviceWorker/ui', () => ({
  showBadgeError: jest.fn(),
  showBadgeHealthy: jest.fn(),
  showBadgeBusy: jest.fn()
}));

jest.mock('../../src/extension/serviceWorker/browserActions', () => ({
  runBrowserAction: jest.fn().mockImplementation(() => Promise.resolve({ message: 'OK' }))
}));

// Import these AFTER mocks are set up to avoid issues
let websocketModule: any;

describe('WebSocket Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset the module for each test
    jest.isolateModules(() => {
      websocketModule = require('../../src/extension/serviceWorker/websocket');
    });
  });

  describe('createWebSocket', () => {
    it('should create a WebSocket connection', async () => {
      const createWebSocket = websocketModule.createWebSocket;
      const socket = await createWebSocket();
      
      expect(socket).toBeDefined();
      expect(socket.url).toContain('ws://localhost:8080/');
      expect(socket.url).toContain('channel=browser');
    });
  });

  describe('ensureWebsocketConnected', () => {
    it('should create a new connection if none exists', async () => {
      const ensureWebsocketConnected = websocketModule.ensureWebsocketConnected;
      const getWebSocket = websocketModule.getWebSocket;
      
      const socket = await ensureWebsocketConnected();
      expect(socket).toBeDefined();
      expect(getWebSocket()).toBe(socket);
    });
  });

  describe('reconnectWebSocket', () => {
    it('should set up a reconnection interval', () => {
      // Mock setInterval
      jest.useFakeTimers();
      
      const reconnectWebSocket = websocketModule.reconnectWebSocket;
      reconnectWebSocket();
      
      // Verify setInterval was called
      expect(setInterval).toHaveBeenCalled();
      
      jest.useRealTimers();
    });
  });

  describe('sendActionToAgent', () => {
    it('should throw error if no websocket connection', async () => {
      const sendActionToAgent = websocketModule.sendActionToAgent;
      
      await expect(async () => {
        await sendActionToAgent({
          actionName: 'testAction',
          parameters: { test: true }
        });
      }).rejects.toThrow();
    });
  });
});