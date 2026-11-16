import { connectBenchmark, writeBenchmarkReport } from "./benchmarkCdp.ts";

/** Interactive regression checks against the same production-built Office surfaces as the benchmark. */
export async function checkOfficePreview(): Promise<void> {
  const cdp = await connectBenchmark();
  const { send, evaluate, wait } = cdp;
  const failures = cdp.errors;
  const checks: string[] = [];
  async function check(name: string, expression: string) {
    if (!(await evaluate(expression))) throw new Error(name);
    checks.push(name);
  }
  const next =
    "[...document.querySelectorAll('button')].find(button=>button.title.includes('前进')).click()";
  const text = "document.querySelector('iframe').contentDocument.body.innerText";
  try {
    await send("Runtime.enable");
    await send("Page.enable");
    await send("Performance.enable");
    await evaluate("bench.open('word-structure.docx')");
    await wait("bench.ready()");
    await check(
      "第一页页眉、页脚、脚注、表格",
      `${text}.includes('First header')&&${text}.includes('Shared footer')&&${text}.includes('footnote text 1')&&${text}.includes('Table 1 A')`,
    );
    await evaluate(next);
    await wait(`${text}.includes('第 2 页')`);
    await check(
      "偶数页眉与第二页脚注",
      `${text}.includes('Even header')&&${text}.includes('footnote text 2')&&!${text}.includes('footnote text 1')`,
    );
    await check(
      "跨页编号从第二项继续",
      "document.querySelector('iframe').contentDocument.querySelector('section.docx').style.counterReset.endsWith(' 1')",
    );
    await evaluate(next);
    await wait(`${text}.includes('第 3 页')`);
    await check(
      "默认页眉、尾注全集",
      `${text}.includes('Default header')&&[1,2,3].every(n=>${text}.includes('endnote text '+n))`,
    );
    await check(
      "第三页编号累计正确",
      "document.querySelector('iframe').contentDocument.querySelector('section.docx').style.counterReset.endsWith(' 2')",
    );
    await evaluate(
      "[...document.querySelectorAll('button')].find(button=>button.title.includes('后退')||button.title.includes('返回上一个')).click()",
    );
    await wait(`${text}.includes('第 2 页')`);
    await check(
      "回看页面脚注未累加",
      `document.querySelector('iframe').contentDocument.querySelectorAll('sup').length===2`,
    );
    await evaluate("bench.open('word-long.docx')");
    await wait("bench.ready()");
    for (let page = 2; page <= 9; page++) {
      await evaluate(next);
      await wait(`${text}.includes('第 ${page} 页')`);
    }
    await send("HeapProfiler.collectGarbage");
    const docDom = await send("Memory.getDOMCounters");
    if ((docDom.nodes ?? 0) > 2000) throw new Error(`Page cache grew to ${docDom.nodes}`);
    checks.push(`Word 翻 9 页后缓存节点 ${docDom.nodes}`);
    await evaluate("bench.find('PERFORMANCE-9')");
    await wait(
      "document.querySelector('iframe').contentWindow.CSS.highlights.get('pidesk-find')?.size>0",
    );
    await evaluate("bench.close()");
    await send("HeapProfiler.collectGarbage");
    const closedDom = await send("Memory.getDOMCounters");
    if (closedDom.documents !== 1) throw new Error("Search retained document");
    checks.push("查找后关闭文档恢复单文档");
    await evaluate("bench.open('word-dense.docx')");
    await wait("bench.ready()");
    await check(
      "密集文档拆成阅读页",
      "document.querySelector('input[aria-label=\"跳转到页码\"]').closest('form').innerText.includes('/ 17')",
    );
    await evaluate(next);
    await wait(`${text}.includes('段落 250')`);
    checks.push("无分页标记文档可继续阅读");
    await evaluate("bench.open('deck-long.pptx')");
    await wait("bench.ready()");
    for (let page = 2; page <= 6; page++) {
      await evaluate(next);
      await wait(`${text}.includes('第 ${page} 张')`);
    }
    await send("HeapProfiler.collectGarbage");
    const deckDom = await send("Memory.getDOMCounters");
    if ((deckDom.nodes ?? 0) > 1500) throw new Error(`Slide cache grew to ${deckDom.nodes}`);
    checks.push(`PPT 翻 6 张后缓存节点 ${deckDom.nodes}`);
    await evaluate("bench.open('grid-large.xlsx')");
    await wait("bench.ready()");
    await check("Excel 首批仅渲染50行", "document.querySelectorAll('tbody tr').length===50");
    for (let page = 1; page <= 9; page++) {
      await evaluate("document.querySelector('button[title=\"下一批行\"]').click()");
      await wait(`document.querySelector('tbody th').textContent==='${page * 50 + 1}'`);
    }
    await check(
      "Excel 可读至预览范围末行",
      "document.querySelector('tbody tr:last-child th').textContent==='500'&&document.querySelector('button[title=\"下一批行\"]').disabled",
    );
    await evaluate("bench.open('grid-many-sheets.xlsx')");
    await wait("bench.ready()");
    for (const sheet of [40, 2, 1]) {
      await evaluate("document.querySelector('button[aria-label=\"工作表\"]').click()");
      await wait("document.querySelectorAll('[role=option]').length===40");
      await evaluate(
        `[...document.querySelectorAll('[role=option]')].find(option=>option.innerText.trim()==='工作表 ${sheet}').click()`,
      );
      await wait(`document.querySelector('tbody')?.innerText.includes('Mock Excel ${sheet}/1')`);
    }
    checks.push("40工作表按需切换、回看缓存");
    await evaluate("bench.open('grid-sparse.xlsx')");
    await wait("bench.ready()");
    await check(
      "稀疏表保留D50000起点",
      "document.body.innerText.includes('D50000:F50002')&&document.querySelector('tbody th').textContent==='50000'&&document.querySelector('tbody').innerText.includes('Sparse origin')",
    );
    await evaluate("bench.open('grid-special.xlsx')");
    await wait("bench.ready()");
    await check(
      "长文本、公式与字面HTML",
      "document.querySelector('tbody').innerText.includes('<script>')&&!document.querySelector('tbody script')&&document.querySelector('tbody').innerText.includes('246')",
    );
    await evaluate("bench.open('word-dense.docx')");
    await new Promise((resolve) => setTimeout(resolve, 15));
    await evaluate("bench.open('grid-legacy.xls')");
    await wait("document.querySelector('tbody')?.innerText.includes('Mock Excel')");
    await new Promise((resolve) => setTimeout(resolve, 300));
    await check(
      "解析中切文件不回流旧文档",
      "!document.querySelector('iframe')&&document.querySelector('tbody').innerText.includes('Mock Excel')",
    );
    await evaluate("bench.close()");
    await send("HeapProfiler.collectGarbage");
    await check(
      "最终主页面无预览残留",
      "!document.querySelector('iframe')&&!document.querySelector('table')",
    );
  } catch (error) {
    failures.push(String(error));
    process.exitCode = 1;
  } finally {
    const result = { checks, failures };
    await writeBenchmarkReport("regression", result);
    console.log(JSON.stringify(result, null, 2));
    cdp.close();
  }
}
