import { createReadStream } from 'node:fs';

export async function readBoundedFile(path: string, maximumBytes: number): Promise<Buffer> {
  const stream = createReadStream(path, { highWaterMark: 64 * 1024 });
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    for await (const chunk of stream) {
      length += (chunk as Buffer).byteLength;
      if (length > maximumBytes) throw new Error('文件超过允许的大小。');
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks, length);
  } finally { stream.destroy(); }
}
