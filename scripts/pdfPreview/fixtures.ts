/** Small deterministic PDFs that require external CMaps and non-embedded standard fonts. */
export function pdfFixtures(
  fontData: Uint8Array,
): { name: string; text: string; data: number[]; color?: number[] }[] {
  const dingbatMap =
    "/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /DingbatsUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<00> <FF>\nendcodespacerange\n4 beginbfchar\n<21> <2701>\n<22> <2702>\n<23> <2703>\n<24> <2704>\nendbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend";
  function pdf(
    fonts: string[],
    content: string,
    resources = "/Font << /F1 5 0 R >>",
    secondPage = false,
  ): number[] {
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 480 240] /Resources << ${resources} >> /Contents 4 0 R >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
      ...fonts,
    ];
    if (secondPage) {
      objects[1] = `<< /Type /Pages /Kids [3 0 R ${objects.length + 1} 0 R] /Count 2 >>`;
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 480 240] /Rotate 90 /Resources << ${resources} >> /Contents 4 0 R >>`,
      );
    }
    let body = "%PDF-1.7\n";
    const offsets = [0];
    for (const [index, object] of objects.entries()) {
      offsets.push(body.length);
      body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    }
    const xref = body.length;
    body += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
    for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
    body += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Array.from(new TextEncoder().encode(body));
  }
  const cjk = [
    ["simplified-chinese", "中文预览测试", "STSong-Light", "GB1", "UniGB-UCS2-H"],
    ["traditional-chinese", "繁體中文測試", "MSung-Light", "CNS1", "UniCNS-UCS2-H"],
    ["japanese", "日本語テスト", "HeiseiMin-W3", "Japan1", "UniJIS-UCS2-H"],
    ["korean", "한국어테스트", "HYSMyeongJo-Medium", "Korea1", "UniKS-UCS2-H"],
  ];
  const fontHex = `${Buffer.from(fontData).toString("hex")}>`;
  // An 8 x 8 solid RGB image generated with OpenJPEG; no external fixture or image library needed.
  const jpx = `${Buffer.from(
    "/0//UQAvAAAAAAAIAAAACAAAAAAAAAAAAAAACAAAAAgAAAAAAAAAAAADBwEBBwEBBwEB/1IADAAAAAEAAwQEAAH/XAANQEBISFBISFBISFD/ZAAlAAFDcmVhdGVkIGJ5IE9wZW5KUEVHIHZlcnNpb24gMi41LjT/kAAKAAAAAAAmAAH/k8+0CAmXx9QEBr/H1AQBv4CAgICAgICAgP/Z",
    "base64",
  ).toString("hex")}>`;
  return [
    ...cjk.map(([name, text, font, ordering, encoding]) => ({
      name,
      text,
      data: pdf(
        [
          `<< /Type /Font /Subtype /Type0 /BaseFont /${font} /Encoding /${encoding} /DescendantFonts [6 0 R] >>`,
          `<< /Type /Font /Subtype /CIDFontType0 /BaseFont /${font} /CIDSystemInfo << /Registry (Adobe) /Ordering (${ordering}) /Supplement 0 >> /FontDescriptor 7 0 R /DW 1000 >>`,
          `<< /Type /FontDescriptor /FontName /${font} /Flags 6 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 900 /Descent -200 /CapHeight 700 /StemV 80 >>`,
        ],
        `BT /F1 28 Tf 30 140 Td <${Array.from(text, (char) => char.charCodeAt(0).toString(16).padStart(4, "0")).join("")}> Tj ET`,
      ),
    })),
    {
      name: "symbol",
      text: "ΑΒΓαβγ",
      data: pdf(
        ["<< /Type /Font /Subtype /Type1 /BaseFont /Symbol >>"],
        "BT /F1 28 Tf 30 140 Td (ABGabg) Tj ET",
      ),
    },
    {
      name: "dingbats",
      text: "✁✂✃✄",
      data: pdf(
        [
          "<< /Type /Font /Subtype /Type1 /BaseFont /ZapfDingbats /ToUnicode 6 0 R >>",
          `<< /Length ${dingbatMap.length} >>\nstream\n${dingbatMap}\nendstream`,
        ],
        'BT /F1 28 Tf 30 140 Td (!"#$) Tj ET',
      ),
    },
    {
      name: "latin",
      text: "PDF preview 123",
      data: pdf(
        ["<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"],
        "BT /F1 28 Tf 30 140 Td (PDF preview 123) Tj ET",
        undefined,
        true,
      ),
    },
    {
      name: "embedded-truetype",
      text: "Café preview 123",
      data: pdf(
        [
          `<< /Type /Font /Subtype /TrueType /BaseFont /LiberationSans /Encoding /WinAnsiEncoding /FirstChar 32 /LastChar 126 /Widths [${Array(95).fill(600).join(" ")}] /FontDescriptor 6 0 R >>`,
          "<< /Type /FontDescriptor /FontName /LiberationSans /Flags 32 /FontBBox [-600 -400 2000 1200] /ItalicAngle 0 /Ascent 900 /Descent -200 /CapHeight 700 /StemV 80 /FontFile2 7 0 R >>",
          `<< /Length ${fontHex.length} /Length1 ${fontData.length} /Filter /ASCIIHexDecode >>\nstream\n${fontHex}\nendstream`,
        ],
        "BT /F1 28 Tf 30 140 Td <436166e9207072657669657720313233> Tj ET",
      ),
    },
    {
      name: "jpeg2000",
      text: "",
      color: [10, 90, 180],
      data: pdf(
        [
          `<< /Type /XObject /Subtype /Image /Width 8 /Height 8 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /JPXDecode] /Length ${jpx.length} >>\nstream\n${jpx}\nendstream`,
        ],
        "q 80 0 0 80 30 100 cm /Im1 Do Q",
        "/XObject << /Im1 5 0 R >>",
      ),
    },
  ];
}
