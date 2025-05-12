// test/types.d.ts

// Define our mock WebSocket interface
declare class MockWebSocket {
    static readonly CONNECTING: number;
    static readonly OPEN: number;
    static readonly CLOSING: number;
    static readonly CLOSED: number;
  
    url: string;
    protocol: string;
    readyState: number;
    bufferedAmount: number;
    extensions: string;
    binaryType: BinaryType;
    
    // Event handlers
    onopen: ((ev: Event) => any) | null;
    onmessage: ((ev: MessageEvent) => any) | null;
    onclose: ((ev: CloseEvent) => any) | null;
    onerror: ((ev: Event) => any) | null;
    
    constructor(url: string, protocols?: string | string[]);
    
    close(code?: number, reason?: string): void;
    send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
    addEventListener(type: string, listener: (ev: any) => any, options?: any): void;
    removeEventListener(type: string, listener: (ev: any) => any, options?: any): void;
    dispatchEvent(event: Event): boolean;
    
    // Additional methods for testing
    mockReceiveMessage(data: string): void;
  }
  
  // Define any custom modules or types here
  declare module 'common-utils' {
    export class WebSocketMessageV2 {
      [key: string]: any;
      constructor(data?: any);
      toJSON(): any;
    }
  }