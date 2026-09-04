import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function projectAsset(path: string): Buffer {
  return readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)));
}

describe('Windows 品牌资产 v1', () => {
  it('提供带透明通道的 1024px PNG 主图标', () => {
    const png = projectAsset('build/icon-1024.png');
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(png.readUInt32BE(16)).toBe(1024);
    expect(png.readUInt32BE(20)).toBe(1024);
    expect(png[25]).toBe(6);
  });

  it('提供覆盖 Windows 常用尺寸的多分辨率 ICO', () => {
    const ico = projectAsset('build/icon.ico');
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    const count = ico.readUInt16LE(4);
    expect(count).toBeGreaterThanOrEqual(7);

    const sizes = new Set<number>();
    for (let index = 0; index < count; index += 1) {
      const widthByte = ico[6 + index * 16];
      const heightByte = ico[7 + index * 16];
      expect(widthByte).toBe(heightByte);
      sizes.add(widthByte === 0 ? 256 : (widthByte ?? 0));
    }
    expect([...sizes].sort((left, right) => left - right)).toEqual([16, 24, 32, 48, 64, 128, 256]);
  });
});
