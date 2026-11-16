import { mkdir, open, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { createDeflate } from "node:zlib";

// Run with Node 24+: node scripts/generate-image-preview-fixtures.ts [output-directory]
// Synthetic fixtures separate compressed-file transfer costs from decoded pixel costs.
const outputDir = path.resolve(process.argv[2] ?? "temp/image-preview-fixtures");
const mib = 1024 * 1024;
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function chunk(type: string, data: Buffer): Buffer {
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0);
  result.write(type, 4, 4, "ascii");
  data.copy(result, 8);
  let crc = 0xffffffff;
  for (let index = 4; index < result.length - 4; index++) {
    crc = (crcTable[(crc ^ result[index]) & 255] ?? 0) ^ (crc >>> 8);
  }
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}

type Fixture = {
  name: string;
  width: number;
  height: number;
  pattern: "noise" | "grid";
  purpose: string;
  minMiB: number;
  maxMiB: number;
};

const fixtures: Fixture[] = [
  {
    name: "01-noise-under-10MiB.png",
    width: 2048,
    height: 1536,
    pattern: "noise",
    purpose: "现有 10MiB 上限内的加载基线",
    minMiB: 9,
    maxMiB: 10,
  },
  {
    name: "02-noise-over-10MiB.png",
    width: 2048,
    height: 2048,
    pattern: "noise",
    purpose: "超过现有上限；验证放宽后的加载",
    minMiB: 12,
    maxMiB: 13,
  },
  {
    name: "03-noise-36MiB.png",
    width: 4096,
    height: 3072,
    pattern: "noise",
    purpose: "大文件传输、切换和内存回收",
    minMiB: 36,
    maxMiB: 37,
  },
  {
    name: "04-noise-near-40MiB.png",
    width: 4096,
    height: 3328,
    pattern: "noise",
    purpose: "约 39MiB，接近拟定的 40MiB 上限",
    minMiB: 39,
    maxMiB: 40,
  },
  {
    name: "05-noise-over-40MiB.png",
    width: 4096,
    height: 3584,
    pattern: "noise",
    purpose: "约 42MiB，验证超限反馈",
    minMiB: 42,
    maxMiB: 43,
  },
  {
    name: "06-grid-8k.png",
    width: 8192,
    height: 8192,
    pattern: "grid",
    purpose: "小文件、高像素：RGBA 解码约 256MiB；检查缩放清晰度",
    minMiB: 0,
    maxMiB: 10,
  },
];

async function generate(fixture: Fixture): Promise<number> {
  const { width, height, pattern } = fixture;
  let state = 0x12345678;
  function* rows(): Generator<Buffer> {
    for (let y = 0; y < height; y++) {
      const row = Buffer.alloc(1 + width * 3);
      for (let x = 0; x < width; x++) {
        const offset = 1 + x * 3;
        if (pattern === "noise") {
          // A fixed seed keeps bytes and file sizes reproducible across runs.
          state ^= state << 13;
          state ^= state >>> 17;
          state ^= state << 5;
          row[offset] = state & 255;
          row[offset + 1] = (state >>> 8) & 255;
          row[offset + 2] = (state >>> 16) & 255;
        } else {
          const line = x % 256 < 3 || y % 256 < 3 || Math.abs(x - y) < 3;
          row[offset] = line ? 255 : Math.floor((x / width) * 255);
          row[offset + 1] = line ? 255 : Math.floor((y / height) * 255);
          row[offset + 2] = line ? 255 : ((x >>> 8) + (y >>> 8)) % 2 ? 144 : 48;
        }
      }
      yield row;
    }
  }

  const file = await open(path.join(outputDir, fixture.name), "w");
  try {
    await file.writeFile(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 2; // RGB, no alpha; decoded browser surfaces generally use RGBA.
    await file.writeFile(chunk("IHDR", header));
    const compressed = Readable.from(rows()).pipe(createDeflate({ level: 6 }));
    for await (const data of compressed) {
      await file.writeFile(chunk("IDAT", Buffer.from(data)));
    }
    await file.writeFile(chunk("IEND", Buffer.alloc(0)));
    return (await file.stat()).size;
  } finally {
    await file.close();
  }
}

await mkdir(outputDir, { recursive: true });
const results = [];
for (const fixture of fixtures) {
  const bytes = await generate(fixture);
  const sizeMiB = bytes / mib;
  if (sizeMiB <= fixture.minMiB || sizeMiB >= fixture.maxMiB) {
    throw new Error(`${fixture.name}: unexpected file size ${sizeMiB.toFixed(3)} MiB`);
  }
  results.push({
    ...fixture,
    bytes,
    sizeMiB,
    decodedRgbaMiB: (fixture.width * fixture.height * 4) / mib,
  });
  console.log(`${fixture.name}: ${fixture.width}×${fixture.height}, ${sizeMiB.toFixed(3)} MiB`);
}
await writeFile(path.join(outputDir, "manifest.json"), `${JSON.stringify(results, null, 2)}\n`);
await writeFile(
  path.join(outputDir, "README.md"),
  [
    "# 图片预览性能样本",
    "",
    "运行 `node scripts/generate-image-preview-fixtures.ts` 可重新生成。均为真实 RGB PNG，大小来自像素数据，不使用无效填充。噪声图用于传输压力测试，不代表普通照片的压缩率。",
    "",
    "| 文件 | 分辨率 | 文件 MiB | 解码 RGBA MiB（估算） | 用途 |",
    "|---|---|---:|---:|---|",
    ...results.map(
      (item) =>
        `| ${item.name} | ${item.width}×${item.height} | ${item.sizeMiB.toFixed(3)} | ${item.decodedRgbaMiB.toFixed(1)} | ${item.purpose} |`,
    ),
    "",
    "RGBA 值仅为单张像素缓冲区估算；不含原文件、base64、IPC 副本及 GPU 纹理。40MiB = 41,943,040 字节。这组样本用于性能基线，不是精确到单字节的边界测试。",
    "",
    "建议分别记录首次打开、重复打开、连续切换与离开预览后的耗时和内存；用 8K 网格检查缩放和细线显示。现有 10MiB 限制仍在时，02–05 会被拒绝，01 和 06 可直接用于基线观察。",
    "",
  ].join("\n"),
);
console.log(`Fixtures written to ${outputDir}`);
