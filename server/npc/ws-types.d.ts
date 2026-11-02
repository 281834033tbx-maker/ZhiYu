// The installed ws package is used only by the local Node gateway.
declare module 'ws' {
  import { EventEmitter } from 'node:events';
  import type { IncomingMessage } from 'node:http';
  import type { Duplex } from 'node:stream';

  export type RawData = Buffer | ArrayBuffer | Buffer[];

  export default class WebSocket extends EventEmitter {
    static readonly CONNECTING: number;
    static readonly OPEN: number;
    static readonly CLOSING: number;
    static readonly CLOSED: number;
    readonly readyState: number;
    readonly bufferedAmount: number;
    constructor(address: string, options?: {
      headers?: Record<string, string>;
      handshakeTimeout?: number;
      maxPayload?: number;
      perMessageDeflate?: boolean;
    });
    send(data: string | Buffer, callback: (error?: Error) => void): void;
    send(data: string | Buffer, options?: { binary?: boolean }, callback?: (error?: Error) => void): void;
    close(code?: number, reason?: string): void;
    terminate(): void;
    ping(): void;
    on(event: 'message', listener: (data: RawData, isBinary: boolean) => void): this;
    on(event: 'open', listener: () => void): this;
    on(event: 'close', listener: (code: number, reason: Buffer) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    on(event: 'pong', listener: () => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
  }

  export class WebSocketServer extends EventEmitter {
    constructor(options: { noServer: boolean; maxPayload?: number; perMessageDeflate?: boolean; clientTracking?: boolean });
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, callback: (client: WebSocket) => void): void;
    close(callback?: () => void): void;
  }
}
