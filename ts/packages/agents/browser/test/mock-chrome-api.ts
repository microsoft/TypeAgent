// test/mock-chrome-api.ts

// Create a comprehensive mock of the Chrome API
const mockChrome = {
    action: {
      setBadgeText: jest.fn(),
      setBadgeBackgroundColor: jest.fn(),
      getBadgeText: jest.fn(),
      onClicked: {
        addListener: jest.fn(),
        hasListeners: jest.fn().mockReturnValue(false),
        removeListener: jest.fn()
      }
    },
    contextMenus: {
      create: jest.fn(),
      remove: jest.fn(),
      onClicked: {
        addListener: jest.fn(),
        hasListeners: jest.fn().mockReturnValue(false),
        removeListener: jest.fn()
      }
    },
    downloads: {
      download: jest.fn().mockImplementation(() => Promise.resolve(123))
    },
    history: {
      search: jest.fn().mockImplementation(() => Promise.resolve([]))
    },
    bookmarks: {
      search: jest.fn().mockImplementation(() => Promise.resolve([]))
    },
    runtime: {
      getURL: jest.fn().mockImplementation((path) => `chrome-extension://abcdefgh/${path}`),
      getManifest: jest.fn().mockReturnValue({ version: '1.0.0' }),
      sendMessage: jest.fn().mockImplementation(() => Promise.resolve({})),
      onMessage: {
        addListener: jest.fn(),
        hasListeners: jest.fn().mockReturnValue(false),
        removeListener: jest.fn()
      },
      onInstalled: {
        addListener: jest.fn(),
        hasListeners: jest.fn().mockReturnValue(false),
        removeListener: jest.fn()
      },
      onStartup: {
        addListener: jest.fn(),
        hasListeners: jest.fn().mockReturnValue(false), 
        removeListener: jest.fn()
      },
      onConnect: {
        addListener: jest.fn(),
        hasListeners: jest.fn().mockReturnValue(false),
        removeListener: jest.fn()
      },
      id: 'test-extension-id',
      connect: jest.fn(() => ({
        postMessage: jest.fn(),
        onMessage: {
          addListener: jest.fn(),
          hasListeners: jest.fn().mockReturnValue(false),
          removeListener: jest.fn()
        },
        onDisconnect: {
          addListener: jest.fn(),
          hasListeners: jest.fn().mockReturnValue(false),
          removeListener: jest.fn()
        },
        disconnect: jest.fn()
      }))
    },
    scripting: {
      executeScript: jest.fn().mockImplementation(() => Promise.resolve([{ result: 'result' }]))
    },
    search: {
      query: jest.fn().mockImplementation(() => Promise.resolve())
    },
    sidePanel: {
      open: jest.fn().mockImplementation(() => Promise.resolve()),
      setPanelBehavior: jest.fn().mockImplementation(() => Promise.resolve())
    },
    storage: {
      local: {
        get: jest.fn().mockImplementation(() => Promise.resolve({})),
        set: jest.fn().mockImplementation(() => Promise.resolve()),
        remove: jest.fn().mockImplementation(() => Promise.resolve()),
        clear: jest.fn().mockImplementation(() => Promise.resolve())
      },
      session: {
        get: jest.fn().mockImplementation(() => Promise.resolve({})),
        set: jest.fn().mockImplementation(() => Promise.resolve()),
        remove: jest.fn().mockImplementation(() => Promise.resolve()),
        clear: jest.fn().mockImplementation(() => Promise.resolve())
      },
      sync: {
        get: jest.fn().mockImplementation(() => Promise.resolve({})),
        set: jest.fn().mockImplementation(() => Promise.resolve()),
        remove: jest.fn().mockImplementation(() => Promise.resolve()),
        clear: jest.fn().mockImplementation(() => Promise.resolve())
      },
      onChanged: {
        addListener: jest.fn(),
        hasListeners: jest.fn().mockReturnValue(false),
        removeListener: jest.fn()
      }
    },
    tabs: {
      query: jest.fn().mockImplementation(() => Promise.resolve([])),
      get: jest.fn().mockImplementation((tabId) => Promise.resolve({ id: tabId, title: 'Test Tab', url: 'https://example.com' })),
      create: jest.fn().mockImplementation(() => Promise.resolve({ id: 123 })),
      update: jest.fn().mockImplementation(() => Promise.resolve({ id: 123 })),
      remove: jest.fn().mockImplementation(() => Promise.resolve()),
      sendMessage: jest.fn().mockImplementation(() => Promise.resolve({})),
      captureVisibleTab: jest.fn().mockImplementation(() => Promise.resolve('data:image/png;base64,test')),
      getZoom: jest.fn().mockImplementation(() => Promise.resolve(1)),
      setZoom: jest.fn().mockImplementation(() => Promise.resolve()),
      goBack: jest.fn().mockImplementation(() => Promise.resolve()),
      goForward: jest.fn().mockImplementation(() => Promise.resolve()),
      onActivated: {
        addListener: jest.fn(),
        hasListeners: jest.fn().mockReturnValue(false),
        removeListener: jest.fn()
      },
      onCreated: {
        addListener: jest.fn(),
        hasListeners: jest.fn().mockReturnValue(false),
        removeListener: jest.fn()
      },
      onRemoved: {
        addListener: jest.fn(),
        hasListeners: jest.fn().mockReturnValue(false),
        removeListener: jest.fn()
      },
      onUpdated: {
        addListener: jest.fn(),
        hasListeners: jest.fn().mockReturnValue(false),
        removeListener: jest.fn()
      }
    },
    tts: {
      speak: jest.fn(),
      stop: jest.fn()
    },
    webNavigation: {
      getAllFrames: jest.fn().mockImplementation(() => Promise.resolve([{ frameId: 0, url: 'https://example.com' }]))
    },
    windows: {
      get: jest.fn().mockImplementation(() => Promise.resolve({ id: 1, focused: true })),
      getAll: jest.fn().mockImplementation(() => Promise.resolve([{ id: 1, focused: true, tabs: [{ id: 123, active: true, title: 'Test Tab', url: 'https://example.com' }] }])),
      create: jest.fn().mockImplementation(() => Promise.resolve({ id: 1 })),
      update: jest.fn().mockImplementation(() => Promise.resolve({ id: 1 })),
      remove: jest.fn().mockImplementation(() => Promise.resolve()),
      onCreated: {
        addListener: jest.fn(),
        hasListeners: jest.fn().mockReturnValue(false),
        removeListener: jest.fn()
      },
      onRemoved: {
        addListener: jest.fn(),
        hasListeners: jest.fn().mockReturnValue(false),
        removeListener: jest.fn()
      },
      onFocusChanged: {
        addListener: jest.fn(),
        hasListeners: jest.fn().mockReturnValue(false),
        removeListener: jest.fn()
      },
      WINDOW_ID_NONE: -1
    }
  };
  
  // Assign the mock to global.chrome
  global.chrome = mockChrome as unknown as typeof chrome;
  
  // Define WebSocket constants
  const CONNECTING = 0;
  const OPEN = 1;
  const CLOSING = 2;
  const CLOSED = 3;
  
  // Create a simplified mock for WebSocket that avoids TypeScript errors
  class MockWebSocket {
    static readonly CONNECTING = CONNECTING;
    static readonly OPEN = OPEN;
    static readonly CLOSING = CLOSING;
    static readonly CLOSED = CLOSED;
    
    url: string;
    protocol: string = '';
    readyState: number = CONNECTING;
    bufferedAmount: number = 0;
    extensions: string = '';
    binaryType: BinaryType = 'blob';
    
    // Event handlers
    onopen: ((ev: Event) => any) | null = null;
    onmessage: ((ev: MessageEvent) => any) | null = null;
    onclose: ((ev: CloseEvent) => any) | null = null;
    onerror: ((ev: Event) => any) | null = null;
    
    // Event map for addEventListener
    private eventListeners: {[key: string]: Array<(ev: any) => any>} = {
      open: [],
      message: [],
      close: [],
      error: []
    };
  
    constructor(url: string, protocols?: string | string[]) {
      this.url = url;
      
      // Simulate an asynchronous connection
      setTimeout(() => {
        this.readyState = OPEN;
        
        // Create open event
        const openEvent = new Event('open');
        
        // Trigger onopen if defined
        if (this.onopen) {
          this.onopen(openEvent);
        }
        
        // Trigger any registered event listeners
        this.eventListeners.open.forEach(listener => {
          listener(openEvent);
        });
      }, 10);
    }
  
    close(code?: number, reason?: string): void {
      this.readyState = CLOSED;
      
      // Create close event
      const closeEvent = {
        code: code || 1000,
        reason: reason || '',
        wasClean: true,
        type: 'close',
        target: this,
        currentTarget: this,
        srcElement: this,
        composed: false,
        bubbles: false,
        cancelable: false,
        defaultPrevented: false,
        returnValue: true,
        timeStamp: Date.now(),
        preventDefault: () => {},
        stopPropagation: () => {},
        stopImmediatePropagation: () => {},
        composedPath: () => [this],
        NONE: 0,
        CAPTURING_PHASE: 1,
        AT_TARGET: 2,
        BUBBLING_PHASE: 3,
        eventPhase: 2,
        initEvent: () => {}
      } as CloseEvent;
      
      // Trigger onclose if defined
      if (this.onclose) {
        this.onclose(closeEvent);
      }
      
      // Trigger any registered event listeners
      this.eventListeners.close.forEach(listener => {
        listener(closeEvent);
      });
    }
  
    send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
      // Just a mock implementation, does nothing
    }
  
    addEventListener(type: string, listener: (ev: any) => any, options?: any): void {
      if (this.eventListeners[type]) {
        this.eventListeners[type].push(listener);
      } else {
        this.eventListeners[type] = [listener];
      }
    }
  
    removeEventListener(type: string, listener: (ev: any) => any, options?: any): void {
      if (this.eventListeners[type]) {
        this.eventListeners[type] = this.eventListeners[type].filter(l => l !== listener);
      }
    }
  
    dispatchEvent(event: Event): boolean {
      return true;
    }
  
    // Simulate receiving a message
    mockReceiveMessage(data: string): void {
      const messageEvent = {
        data: new Blob([data]),
        origin: this.url,
        lastEventId: '',
        source: null,
        ports: [],
        type: 'message',
        target: this,
        currentTarget: this,
        srcElement: this,
        composed: false,
        bubbles: false,
        cancelable: false,
        defaultPrevented: false,
        returnValue: true,
        timeStamp: Date.now(),
        preventDefault: () => {},
        stopPropagation: () => {},
        stopImmediatePropagation: () => {},
        composedPath: () => [this],
        NONE: 0,
        CAPTURING_PHASE: 1,
        AT_TARGET: 2,
        BUBBLING_PHASE: 3,
        eventPhase: 2,
        initEvent: () => {}
      } as MessageEvent;
      
      // Trigger onmessage if defined
      if (this.onmessage) {
        this.onmessage(messageEvent);
      }
      
      // Trigger any registered event listeners
      this.eventListeners.message.forEach(listener => {
        listener(messageEvent);
      });
    }
  }
  
  // Create and apply a WebSocket interface that matches our MockWebSocket
  interface WebSocketInterface {
    readonly CONNECTING: number;
    readonly OPEN: number;
    readonly CLOSING: number;
    readonly CLOSED: number;
    new(url: string, protocols?: string | string[]): MockWebSocket;
    prototype: MockWebSocket;
  }
  
  // Replace global WebSocket with our mock
  (global as any).WebSocket = MockWebSocket as unknown as WebSocketInterface;
  
  // Export for use in tests
  export { MockWebSocket };