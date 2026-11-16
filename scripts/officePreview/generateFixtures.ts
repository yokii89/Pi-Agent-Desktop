import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import * as XLSX from "xlsx";
import { fixturePng, fixtureZip } from "./fixtureArchive.ts";

const output = path.resolve(process.argv[2] ?? "temp/office-preview/corpus");
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const WORD = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const DRAWING = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PRESENTATION = "http://schemas.openxmlformats.org/presentationml/2006/main";
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const manifest: Array<{
  file: string;
  bytes: number;
  sha256: string;
  scenario: string;
  expected: string;
  pages?: number;
}> = [];
const escapeXml = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const relationships = (body: string): string =>
  `${XML}<Relationships xmlns="${REL}">${body}</Relationships>`;
const relationship = (id: string, kind: string, target: string): string =>
  `<Relationship Id="${id}" Type="${OFFICE}/${kind}" Target="${target}"/>`;
const contentTypes = (overrides: string): string =>
  `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>${overrides}</Types>`;
const images = Array.from({ length: 12 }, (_, i) => fixturePng(i + 1));

async function save(
  file: string,
  bytes: Buffer,
  scenario: string,
  expected: string,
  pages?: number,
): Promise<void> {
  await writeFile(path.join(output, file), bytes);
  manifest.push({
    file,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    scenario,
    expected,
    pages,
  });
  console.log(`${file}: ${(bytes.length / 1024).toFixed(1)} KiB — ${scenario}`);
}

function word(pages: number, paragraphs: number, runs: number, withImages = false): Buffer {
  const parts = new Map<string, string | Buffer>();
  parts.set(
    "[Content_Types].xml",
    contentTypes(
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    ),
  );
  parts.set(
    "_rels/.rels",
    relationships(relationship("office", "officeDocument", "word/document.xml")),
  );
  const body: string[] = [];
  for (let page = 0; page < pages; page++) {
    if (page) body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    body.push(
      `<w:p><w:r><w:rPr><w:b/><w:sz w:val="36"/></w:rPr><w:t>Mock Word 第 ${page + 1} 页</w:t></w:r></w:p>`,
    );
    for (let paragraph = 0; paragraph < paragraphs; paragraph++) {
      body.push(
        `<w:p>${Array.from({ length: runs }, (_, run) => `<w:r><w:rPr>${run % 2 ? "<w:b/>" : ""}<w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">${escapeXml(`段落 ${paragraph + 1} 文本 ${run + 1}：中文与 English mixed content，检索关键字 PERFORMANCE-${page + 1}。 `)}</w:t></w:r>`).join("")}</w:p>`,
      );
    }
    if (withImages) {
      const image = page % images.length;
      parts.set(`word/media/image${image}.png`, images[image]);
      body.push(
        `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="4572000" cy="2571750"/><wp:docPr id="${page + 1}" name="Mock image"/><a:graphic xmlns:a="${DRAWING}"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${page + 1}" name="image${image}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="image${image}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4572000" cy="2571750"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`,
      );
    }
  }
  parts.set(
    "word/document.xml",
    `${XML}<w:document xmlns:w="${WORD}" xmlns:r="${OFFICE}"><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="900" w:right="900" w:bottom="900" w:left="900"/></w:sectPr></w:body></w:document>`,
  );
  if (withImages)
    parts.set(
      "word/_rels/document.xml.rels",
      relationships(
        images.map((_, i) => relationship(`image${i}`, "image", `media/image${i}.png`)).join(""),
      ),
    );
  return fixtureZip(parts);
}

function presentation(slides: number, textBoxes: number, withImages = false): Buffer {
  const parts = new Map<string, string | Buffer>();
  parts.set(
    "[Content_Types].xml",
    contentTypes(
      '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
        Array.from(
          { length: slides },
          (_, i) =>
            `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
        ).join(""),
    ),
  );
  parts.set(
    "_rels/.rels",
    relationships(relationship("office", "officeDocument", "ppt/presentation.xml")),
  );
  parts.set(
    "ppt/presentation.xml",
    `${XML}<p:presentation xmlns:p="${PRESENTATION}" xmlns:r="${OFFICE}"><p:sldIdLst>${Array.from({ length: slides }, (_, i) => `<p:sldId id="${256 + i}" r:id="slide${i + 1}"/>`).join("")}</p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>`,
  );
  parts.set(
    "ppt/_rels/presentation.xml.rels",
    relationships(
      Array.from({ length: slides }, (_, i) =>
        relationship(`slide${i + 1}`, "slide", `slides/slide${i + 1}.xml`),
      ).join(""),
    ),
  );
  for (let slide = 1; slide <= slides; slide++) {
    const shapes: string[] = [];
    for (let box = 0; box < textBoxes; box++) {
      const text =
        box === 0
          ? `Mock PowerPoint 第 ${slide} 张`
          : `图形 ${box} · 中文 English PERFORMANCE-${slide}`;
      shapes.push(
        `<p:sp><p:nvSpPr><p:cNvPr id="${box + 2}" name="Text ${box}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${300000 + (box % 3) * 2800000}" y="${300000 + (Math.floor(box / 3) % 12) * 360000}"/><a:ext cx="2700000" cy="350000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="${box === 0 ? 2200 : 1100}"/><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`,
      );
    }
    if (withImages) {
      const image = (slide - 1) % images.length;
      parts.set(`ppt/media/image${image}.png`, images[image]);
      parts.set(
        `ppt/slides/_rels/slide${slide}.xml.rels`,
        relationships(relationship("image", "image", `../media/image${image}.png`)),
      );
      shapes.push(
        `<p:pic><p:nvPicPr><p:cNvPr id="${textBoxes + 2}" name="Mock image"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="image"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="4600000" y="1800000"/><a:ext cx="4000000" cy="2250000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`,
      );
    }
    parts.set(
      `ppt/slides/slide${slide}.xml`,
      `${XML}<p:sld xmlns:p="${PRESENTATION}" xmlns:a="${DRAWING}" xmlns:r="${OFFICE}"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="EAF3FF"/></a:solidFill></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shapes.join("")}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`,
    );
  }
  return fixtureZip(parts);
}

function structuredWord(): Buffer {
  const parts = new Map<string, string | Buffer>();
  parts.set(
    "[Content_Types].xml",
    contentTypes(
      [
        ["document", "document.main"],
        ["header", "header"],
        ["evenHeader", "header"],
        ["firstHeader", "header"],
        ["footer", "footer"],
        ["footnotes", "footnotes"],
        ["endnotes", "endnotes"],
        ["settings", "settings"],
        ["numbering", "numbering"],
      ]
        .map(
          ([name, kind]) =>
            `<Override PartName="/word/${name}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml"/>`,
        )
        .join(""),
    ),
  );
  parts.set(
    "_rels/.rels",
    relationships(relationship("office", "officeDocument", "word/document.xml")),
  );
  parts.set(
    "word/_rels/document.xml.rels",
    relationships(
      [
        relationship("defaultHeader", "header", "header.xml"),
        relationship("evenHeader", "header", "evenHeader.xml"),
        relationship("firstHeader", "header", "firstHeader.xml"),
        relationship("footer", "footer", "footer.xml"),
        relationship("footnotes", "footnotes", "footnotes.xml"),
        relationship("endnotes", "endnotes", "endnotes.xml"),
        relationship("settings", "settings", "settings.xml"),
        relationship("numbering", "numbering", "numbering.xml"),
      ].join(""),
    ),
  );
  const paragraph = (value: string) => `<w:p><w:r><w:t>${value}</w:t></w:r></w:p>`;
  const bodies = Array.from(
    { length: 3 },
    (_, index) =>
      `${index ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : ""}${paragraph(`Structured Word 第 ${index + 1} 页`)}<w:p><w:r><w:t>Footnote reference </w:t></w:r><w:r><w:footnoteReference w:id="${index + 1}"/></w:r><w:r><w:t> Endnote reference </w:t></w:r><w:r><w:endnoteReference w:id="${index + 1}"/></w:r></w:p><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Numbered item ${index + 1}</w:t></w:r></w:p><w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc>${paragraph(`Table ${index + 1} A`)}</w:tc><w:tc>${paragraph(`Table ${index + 1} B`)}</w:tc></w:tr></w:tbl>`,
  ).join("");
  parts.set(
    "word/document.xml",
    `${XML}<w:document xmlns:w="${WORD}" xmlns:r="${OFFICE}"><w:body>${bodies}<w:sectPr><w:headerReference w:type="default" r:id="defaultHeader"/><w:headerReference w:type="even" r:id="evenHeader"/><w:headerReference w:type="first" r:id="firstHeader"/><w:footerReference w:type="default" r:id="footer"/><w:titlePg/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="900" w:bottom="1000" w:left="900" w:header="400" w:footer="400"/></w:sectPr></w:body></w:document>`,
  );
  for (const [name, text] of [
    ["header", "Default header"],
    ["evenHeader", "Even header"],
    ["firstHeader", "First header"],
  ])
    parts.set(`word/${name}.xml`, `${XML}<w:hdr xmlns:w="${WORD}">${paragraph(text)}</w:hdr>`);
  parts.set(
    "word/footer.xml",
    `${XML}<w:ftr xmlns:w="${WORD}">${paragraph("Shared footer")}</w:ftr>`,
  );
  for (const kind of ["footnote", "endnote"])
    parts.set(
      `word/${kind}s.xml`,
      `${XML}<w:${kind}s xmlns:w="${WORD}">${Array.from({ length: 3 }, (_, i) => `<w:${kind} w:id="${i + 1}">${paragraph(`${kind} text ${i + 1}`)}</w:${kind}>`).join("")}</w:${kind}s>`,
    );
  parts.set(
    "word/settings.xml",
    `${XML}<w:settings xmlns:w="${WORD}"><w:evenAndOddHeaders/></w:settings>`,
  );
  parts.set(
    "word/numbering.xml",
    `${XML}<w:numbering xmlns:w="${WORD}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
  );
  return fixtureZip(parts);
}

function searchableWord(): Buffer {
  const parts = new Map<string, string | Buffer>();
  parts.set(
    "[Content_Types].xml",
    contentTypes(
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    ),
  );
  parts.set(
    "_rels/.rels",
    relationships(relationship("office", "officeDocument", "word/document.xml")),
  );
  const heading = (level: number, text: string) =>
    `<w:p><w:pPr><w:outlineLvl w:val="${level}"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
  const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  const target =
    "<w:p><w:r><w:t>预算校验 Target-</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>预算-2026 金额 123.50</w:t></w:r></w:p>";
  parts.set(
    "word/document.xml",
    `${XML}<w:document xmlns:w="${WORD}"><w:body>${heading(0, "项目报告")}${heading(1, "概览")}${paragraph("背景说明：跨页搜索与来源引用测试")}${pageBreak}${heading(1, "预算")}${target}${target}${pageBreak}${paragraph("跨页引用金额 123.50，沿用预算标题上下文")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="900" w:bottom="1000" w:left="900"/></w:sectPr></w:body></w:document>`,
  );
  return fixtureZip(parts);
}

function workbook(sheetCount: number, rowCount: number, columns: number): XLSX.WorkBook {
  const book = XLSX.utils.book_new();
  for (let index = 0; index < sheetCount; index++) {
    const sheet = XLSX.utils.aoa_to_sheet(
      Array.from({ length: rowCount }, (_, row) =>
        Array.from({ length: columns }, (_, col) =>
          row === 0
            ? `列 ${col + 1}`
            : col === 0
              ? `Mock Excel ${index + 1}/${row}`
              : row * columns + col,
        ),
      ),
    );
    XLSX.utils.book_append_sheet(book, sheet, `工作表 ${index + 1}`);
  }
  return book;
}
function excel(book: XLSX.WorkBook, bookType: XLSX.BookType = "xlsx"): Buffer {
  book.Props = {
    CreatedDate: new Date("2026-01-01T00:00:00Z"),
    ModifiedDate: new Date("2026-01-01T00:00:00Z"),
    Author: "PiDesk test fixtures",
  };
  return XLSX.write(book, { type: "buffer", bookType, compression: true });
}

await mkdir(output, { recursive: true });
await save("word-small.docx", word(3, 8, 2), "普通文档，3 页", "Mock Word 第 1 页", 3);
await save(
  "word-long.docx",
  word(120, 20, 4),
  "长文档，120 页 / 9600 文本段",
  "Mock Word 第 1 页",
  120,
);
await save(
  "word-dense.docx",
  word(1, 4000, 6),
  "单页密集文档，24000 文本段",
  "Mock Word 第 1 页",
  1,
);
await save(
  "word-images.docx",
  word(36, 4, 2, true),
  "多图文档，36 页 / 12 张独立大图",
  "Mock Word 第 1 页",
  36,
);
await save("deck-small.pptx", presentation(5, 8), "普通演示，5 张", "Mock PowerPoint 第 1 张", 5);
await save(
  "deck-long.pptx",
  presentation(120, 45),
  "长演示，120 张 / 5400 个文本框",
  "Mock PowerPoint 第 1 张",
  120,
);
await save(
  "deck-images.pptx",
  presentation(60, 6, true),
  "多图演示，60 张 / 12 张独立大图",
  "Mock PowerPoint 第 1 张",
  60,
);
await save("grid-large.xlsx", excel(workbook(1, 20000, 60)), "120 万单元格", "Mock Excel 1/1");
await save(
  "grid-many-sheets.xlsx",
  excel(workbook(40, 600, 30)),
  "40 张工作表 / 72 万单元格",
  "Mock Excel 1/1",
);
await save("grid-wide.xlsx", excel(workbook(1, 500, 250)), "250 列宽表", "Mock Excel 1/1");
const sparse = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  sparse,
  {
    D50000: { t: "s", v: "Sparse origin 稀疏起点" },
    F50002: { t: "n", v: 123.5 },
    "!ref": "D50000:F50002",
  },
  "偏移区域",
);
await save("grid-sparse.xlsx", excel(sparse), "数据从 D50000 开始的稀疏表", "Sparse origin");
const special = XLSX.utils.book_new();
const specialSheet = XLSX.utils.aoa_to_sheet([
  ["内容", "结果"],
  ["<script>alert('mock')</script>", 123],
  ["长文本".repeat(6000), 0],
  ["cached formula", 246],
  ["uncached formula", null],
]);
specialSheet.B4 = { t: "n", f: "B2*2", v: 246 };
specialSheet.B5 = { t: "n", f: "B2*3" };
XLSX.utils.book_append_sheet(special, specialSheet, "长文本与公式");
XLSX.utils.book_append_sheet(special, XLSX.utils.aoa_to_sheet([]), "空表");
await save("grid-special.xlsx", excel(special), "空表、长文本、公式和字面 HTML", "cached formula");
for (const kind of ["xls", "xlsb", "xlsm"] as const)
  await save(
    `grid-legacy.${kind}`,
    excel(workbook(2, 80, 12), kind),
    `${kind.toUpperCase()} 兼容样本`,
    "Mock Excel 1/1",
  );
await save(
  "word-structure.docx",
  structuredWord(),
  "首页/奇偶页眉、页脚、脚注/尾注、编号及表格",
  "Structured Word 第 1 页",
  3,
);
await save(
  "word-search.docx",
  searchableWord(),
  "标题路径、跨格式文本段搜索、跨阅读页引用",
  "项目报告",
  3,
);
await save("broken.docx", Buffer.from("This is not an Office archive."), "损坏文档", "invalid");
await save(
  "encrypted.docx",
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  "加密容器识别用头部样本，不是真实加密文档",
  "encrypted",
);
await save("oversize.docx", Buffer.alloc(21 * 1024 * 1024), "超过文件读取上限", "tooLarge");
await save("too-many-slides.pptx", presentation(201, 1), "超过幻灯片数量上限", "tooLarge");
await save("legacy.doc", Buffer.from("Legacy Office format placeholder"), "旧格式提示", "legacy");
await writeFile(
  path.join(output, "manifest.json"),
  `${JSON.stringify({ version: 1, files: manifest }, null, 2)}\n`,
);
await writeFile(
  path.join(output, "README.md"),
  `# Office 预览 Mock 文件\n\n生成：\`pnpm fixtures:office\`。所有内容为合成测试数据。\n\n| 文件 | 大小 KiB | 用途 |\n|---|---:|---|\n${manifest.map((item) => `| [${item.file}](./${item.file}) | ${(item.bytes / 1024).toFixed(1)} | ${item.scenario} |`).join("\n")}\n\n加密/旧格式样本仅测试分流提示；文件有效性、范围与 SHA-256 见 manifest.json。\n`,
);
console.log(`Wrote ${manifest.length} fixtures to ${output}`);
