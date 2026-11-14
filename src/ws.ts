/** 极简 WebSocket 服务端：只处理文本帧、ping/pong 与关闭，够壁纸页推送用。 */
import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

interface Client {
  socket: Duplex;
  buffer: Buffer;
  alive: boolean;
}

export class WsHub {
  private readonly clients = new Set<Client>();
  private readonly onMessage: (text: string) => void;

  constructor(onMessage: (text: string) => void = () => {}) {
    this.onMessage = onMessage;
  }

  get size(): number {
    return this.clients.size;
  }

  handleUpgrade(request: IncomingMessage, socket: Duplex): void {
    const key = String(request.headers['sec-websocket-key'] ?? '').trim();
    if (!key || String(request.headers.upgrade ?? '').toLowerCase() !== 'websocket') {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    const accept = createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n',
    );
    const client: Client = { socket, buffer: Buffer.alloc(0), alive: true };
    this.clients.add(client);
    socket.on('data', (chunk: Buffer) => this.consume(client, chunk));
    socket.on('close', () => this.clients.delete(client));
    socket.on('error', () => this.clients.delete(client));
  }

  sendText(text: string): void {
    const payload = Buffer.from(text, 'utf8');
    for (const client of [...this.clients]) this.writeFrame(client, 0x1, payload);
  }

  close(): void {
    for (const client of [...this.clients]) {
      try {
        this.writeFrame(client, 0x8, Buffer.from([0x03, 0xe8]));
        client.socket.end();
      } catch {
        /* 连接已经没了 */
      }
    }
    this.clients.clear();
  }

  private writeFrame(client: Client, opcode: number, payload: Buffer): void {
    if (!client.alive) return;
    const length = payload.length;
    let header: Buffer;
    if (length < 126) {
      header = Buffer.from([0x80 | opcode, length]);
    } else if (length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }
    try {
      client.socket.write(Buffer.concat([header, payload]));
    } catch {
      client.alive = false;
      this.clients.delete(client);
    }
  }

  private consume(client: Client, chunk: Buffer): void {
    client.buffer = Buffer.concat([client.buffer, chunk]);
    while (client.buffer.length >= 2) {
      const first = client.buffer[0];
      const second = client.buffer[1];
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (client.buffer.length < 4) return;
        length = client.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (client.buffer.length < 10) return;
        const big = client.buffer.readBigUInt64BE(2);
        if (big > 1024n * 1024n) {
          client.socket.end();
          return;
        }
        length = Number(big);
        offset = 10;
      }
      const maskLength = masked ? 4 : 0;
      if (client.buffer.length < offset + maskLength + length) return;
      const mask = masked ? client.buffer.subarray(offset, offset + 4) : null;
      const payload = Buffer.from(client.buffer.subarray(offset + maskLength, offset + maskLength + length));
      client.buffer = client.buffer.subarray(offset + maskLength + length);
      if (mask) for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
      if (opcode === 0x8) {
        this.writeFrame(client, 0x8, payload.subarray(0, 2));
        client.socket.end();
        this.clients.delete(client);
        return;
      }
      if (opcode === 0x9) {
        this.writeFrame(client, 0xa, payload);
        continue;
      }
      if (opcode === 0x1) {
        try {
          this.onMessage(payload.toString('utf8'));
        } catch {
          /* 忽略坏消息 */
        }
      }
    }
  }
}
