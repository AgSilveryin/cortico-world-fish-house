/** 只读 ZIP：主题包解压用，支持 store 与 deflate，拒绝路径穿越与超大条目。 */
import { inflateRawSync } from 'node:zlib';

export interface ZipLimits {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 800,
  maxEntryBytes: 200 * 1024 * 1024,
  maxTotalBytes: 400 * 1024 * 1024,
};

/** 统一成 / 分隔的相对路径；非法路径返回 null。 */
export function safeZipPath(raw: string): string | null {
  const name = String(raw ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!name || name.length > 400) return null;
  if (/^[A-Za-z]:/.test(name)) return null;
  const parts = name.split('/');
  if (parts.some((part) => part === '..' || part === '.' || part === '')) return null;
  return parts.join('/');
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

export function readZip(buffer: Buffer, limits: ZipLimits = DEFAULT_ZIP_LIMITS): Map<string, Buffer> {
  let eocd = -1;
  const start = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= start; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是有效的 zip 文件（找不到目录结尾）');
  const total = buffer.readUInt16LE(eocd + 10);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (total > limits.maxEntries) throw new Error('主题包文件太多（' + total + ' 个）');
  if (cdOffset >= buffer.length) throw new Error('主题包目录偏移不合法');
  const result = new Map<string, Buffer>();
  let cursor = cdOffset;
  let totalBytes = 0;
  for (let index = 0; index < total; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CENTRAL) throw new Error('主题包目录损坏');
    const method = buffer.readUInt16LE(cursor + 10);
    const compressed = buffer.readUInt32LE(cursor + 20);
    const uncompressed = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + extraLength + commentLength;
    if (compressed === 0xffffffff || uncompressed === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error('暂不支持 ZIP64 主题包');
    }
    if (uncompressed > limits.maxEntryBytes) throw new Error('主题包里单个文件过大：' + name);
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== LOCAL) throw new Error('主题包条目损坏：' + name);
    const localName = buffer.readUInt16LE(localOffset + 26);
    const localExtra = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localName + localExtra;
    const dataEnd = dataStart + compressed;
    if (dataEnd > buffer.length) throw new Error('主题包条目越界：' + name);
    const safe = safeZipPath(name);
    if (!safe || safe.endsWith('/')) continue;
    const rawData = buffer.subarray(dataStart, dataEnd);
    let data: Buffer;
    if (method === 0) data = Buffer.from(rawData);
    else if (method === 8) data = inflateRawSync(rawData, { maxOutputLength: limits.maxEntryBytes });
    else throw new Error('主题包用了不支持的压缩方式：' + method);
    totalBytes += data.length;
    if (totalBytes > limits.maxTotalBytes) throw new Error('主题包解压后体积过大');
    result.set(safe, data);
  }
  return result;
}
