import { connectBenchmark, writeBenchmarkReport } from "./benchmarkCdp.ts";

/** Search/jump/citation checks use real components, native ranges and production workers. */
export async function checkOfficeSearch(): Promise<void> {
  const cdp = await connectBenchmark();
  const { send, evaluate, wait, errors } = cdp;
  const checks: string[] = [];
  const timings: Record<string, number> = {};
  const searchPanel = "document.querySelector('section[aria-label=\"搜索文档（Ctrl+F）\"]')";
  const page =
    "document.querySelector('iframe').contentDocument.getElementById('office-content').firstElementChild";
  const doc = "document.querySelector('iframe').contentDocument";
  const results = `${searchPanel}.querySelectorAll('ol li button')`;
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const check = async (name: string, condition: string): Promise<void> => {
    if (!(await evaluate(condition))) throw new Error(name);
    checks.push(name);
  };
  const open = async (file: string): Promise<void> => {
    await evaluate(`bench.open(${JSON.stringify(file)})`);
    await wait("bench.ready()");
  };
  const search = async (query: string, scope = "preview"): Promise<void> => {
    const start = performance.now();
    await evaluate(`bench.search(${JSON.stringify(query)},${JSON.stringify(scope)})`);
    await wait(`${searchPanel}?.innerText.includes('找到')`, 30_000);
    timings[query] = Math.round(performance.now() - start);
  };
  const jump = async (value: string): Promise<void> => {
    await evaluate(
      `(() => { const input=document.querySelector('input[aria-label="跳转到页码"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new InputEvent('input',{bubbles:true})); })()`,
    );
    await pause(30);
    await evaluate(
      "document.querySelector('input[aria-label=\"跳转到页码\"]').closest('form').requestSubmit()",
    );
  };
  const selectText = async (expression: string): Promise<void> => {
    await evaluate(
      `(() => {const element=${expression};const owner=element.ownerDocument;const range=owner.createRange();range.selectNodeContents(element);const selection=owner.defaultView.getSelection();selection.removeAllRanges();selection.addRange(range);})()`,
    );
    await wait("document.querySelector('[aria-label=\"选区操作\"]')?.hidden===false");
  };
  const toolbar = async (label: string): Promise<void> => {
    await evaluate(
      `[...document.querySelector('[aria-label="选区操作"]').querySelectorAll('button')].find(button=>button.innerText.includes(${JSON.stringify(label)})).click()`,
    );
  };
  try {
    await send("Runtime.enable");
    await send("Performance.enable");
    await open("word-search.docx");
    await evaluate(
      `${doc}.dispatchEvent(new KeyboardEvent('keydown',{key:'f',ctrlKey:true,bubbles:true,cancelable:true}))`,
    );
    await wait(
      "document.activeElement?.getAttribute('aria-label')==='在文件中查找（Enter 下一个）'",
    );
    checks.push("iframe 内 Ctrl+F 打开并聚焦全文搜索");
    await search("Target-预算-2026");
    await check(
      "跨格式文本匹配与标题路径",
      `${results}.length===2 && ${searchPanel}.innerText.includes('项目报告 › 预算')`,
    );
    await evaluate(`${results}[1].click()`);
    await wait(
      `${page}?.dataset.officePage==='2' && ${doc}.defaultView.CSS.highlights.get('pidesk-office-find-active')?.size===1`,
    );
    await check(
      "第二个结果定位并高亮原文",
      `Array.from(${doc}.defaultView.CSS.highlights.get('pidesk-office-find-active'))[0].toString()==='Target-预算-2026'`,
    );
    await selectText(
      `[...${doc}.querySelectorAll('p')].filter(p=>p.textContent.includes('Target-预算-2026'))[1]`,
    );
    await toolbar("复制文本");
    await check(
      "复制保持纯原文",
      "window.benchmarkCopy.includes('Target-预算-2026')&&!window.benchmarkCopy.includes('标题路径')",
    );
    await selectText(
      `[...${doc}.querySelectorAll('p')].filter(p=>p.textContent.includes('Target-预算-2026'))[1]`,
    );
    await toolbar("添加到输入栏");
    await check(
      "Word 引用含文件、标题路径和阅读页",
      "window.benchmarkQuote.includes('word-search.docx')&&window.benchmarkQuote.includes('项目报告 › 预算')&&window.benchmarkQuote.includes('阅读页 2（非原文档打印页码）')&&window.benchmarkQuote.includes('金额 123.50')",
    );
    await jump("3");
    await wait(`${page}?.dataset.officePage==='3'`);
    await selectText(
      `[...${doc}.querySelectorAll('p')].find(p=>p.textContent.includes('跨页引用金额'))`,
    );
    await toolbar("添加到输入栏");
    await check(
      "无新标题页继承上一页标题路径",
      "window.benchmarkQuote.includes('项目报告 › 预算')&&window.benchmarkQuote.includes('阅读页 3')",
    );
    await jump("0");
    await check(
      "无效页码不改变当前页",
      `${page}.dataset.officePage==='3'&&document.querySelector('input[aria-label="跳转到页码"]').getAttribute('aria-invalid')==='true'`,
    );
    await evaluate(
      `${doc}.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`,
    );
    await wait(`!${searchPanel}`);
    await check(
      "文档内 Esc 关闭搜索并撤掉高亮",
      `!${doc}.defaultView.CSS.highlights.get('pidesk-office-find-active')`,
    );
    await open("deck-long.pptx");
    await search("PERFORMANCE-117");
    await check(
      "PPT 全文结果来自第117张",
      `${results}.length===44&&${searchPanel}.innerText.includes('幻灯片 117')`,
    );
    await evaluate(`${results}[0].click()`);
    await wait(
      `${page}?.dataset.officePage==='117' && ${doc}.defaultView.CSS.highlights.get('pidesk-office-find-active')?.size===1`,
    );
    await selectText(
      `Array.from(${doc}.defaultView.CSS.highlights.get('pidesk-office-find-active'))[0].startContainer.parentElement`,
    );
    await toolbar("添加到输入栏");
    await check(
      "PPT 引用包含原文件与幻灯片编号",
      "window.benchmarkQuote.includes('deck-long.pptx')&&window.benchmarkQuote.includes('幻灯片 117')&&window.benchmarkQuote.includes('PERFORMANCE-117')",
    );
    await evaluate(
      "document.querySelector('input[aria-label=\"在文件中查找（Enter 下一个）\"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true,cancelable:true}))",
    );
    await wait(`${results}[43].getAttribute('aria-current')==='true'`);
    checks.push("Shift+Enter 循环到上一个结果");
    await search("no_such_text_after_selection");
    await check(
      "换关键词清除过期高亮",
      `!${doc}.defaultView.CSS.highlights.get('pidesk-office-find-active')&&${results}.length===0`,
    );
    await search("PERFORMANCE-");
    await check(
      "结果达到上限时明确标示部分结果",
      `${results}.length===200&&${searchPanel}.innerText.includes('已达到搜索上限')`,
    );
    await evaluate(
      `${results}[0].dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`,
    );
    await wait(`!${searchPanel}`);
    checks.push("结果列表支持 Esc 关闭");
    await open("grid-large.xlsx");
    await search("Mock Excel 1/400");
    await evaluate(`${results}[0].click()`);
    await wait(
      "document.querySelector('[data-office-cell=\"A401\"]')&&CSS.highlights.get('pidesk-office-find-active')?.size===1",
    );
    checks.push("预览范围搜索跳到第401行并高亮");
    await selectText("document.querySelector('[data-office-cell=\"A401\"]')");
    await toolbar("添加到输入栏");
    await check(
      "Excel 引用带工作表与单元格地址",
      "window.benchmarkQuote.includes('grid-large.xlsx')&&window.benchmarkQuote.includes('工作表 1')&&window.benchmarkQuote.includes('A401')",
    );
    await search("Mock Excel 1/499");
    await evaluate(`${results}[0].click()`);
    await wait(
      "document.querySelector('[data-office-cell=\"A500\"]')&&CSS.highlights.get('pidesk-office-find-active')?.size===1",
    );
    await check(
      "表格结果滚动到可见区域",
      "(() => {const r=document.querySelector('[data-office-cell=\"A500\"]').getBoundingClientRect(); const panel=document.getElementById('benchmark-panel').getBoundingClientRect();return r.top>=panel.top&&r.bottom<=panel.bottom;})()",
    );
    await search("Mock Excel 1/15555", "file");
    await check(
      "全文查找超出初始500行的内容",
      `${results}.length===1&&${searchPanel}.innerText.includes('A15556')`,
    );
    await evaluate(`${results}[0].click()`);
    await wait(
      "document.querySelector('[data-office-cell=\"A15556\"]')?.textContent.includes('Mock Excel 1/15555')",
    );
    await wait("CSS.highlights.get('pidesk-office-find-active')?.size===1");
    checks.push("全文结果加载目标窗口并保持高亮");
    await open("grid-wide.xlsx");
    await search("列 207");
    await check("默认范围不扫描未预览列", `${results}.length===0`);
    await search("列 207", "file");
    await evaluate(`${results}[0].click()`);
    await wait("document.querySelector('[data-office-cell=\"GY1\"]')?.textContent==='列 207'");
    await wait("CSS.highlights.get('pidesk-office-find-active')?.size===1");
    checks.push("全文结果定位到第207列");
    await open("grid-many-sheets.xlsx");
    await search("Mock Excel 40/599", "file");
    await evaluate(`${results}[0].click()`);
    await wait(
      "document.querySelector('table')?.dataset.officeSheet==='工作表 40'&&document.querySelector('[data-office-cell=\"A600\"]')",
    );
    checks.push("工作簿全文结果跨工作表与预览窗口跳转");
    await open("grid-large.xlsx");
    await evaluate("bench.search('unmatched cancellation probe','file')");
    await wait("document.querySelector('button[title=\"停止搜索\"]')");
    await pause(350);
    await evaluate("document.querySelector('button[title=\"停止搜索\"]').click()");
    await wait(`${searchPanel}.innerText.includes('搜索已停止')`);
    await pause(600);
    await check(
      "取消全文搜索不影响当前工作表",
      `${searchPanel}.innerText.includes('搜索已停止')&&document.querySelector('tbody').innerText.includes('Mock Excel')`,
    );
    await evaluate("bench.search('switching old search','file')");
    await pause(300);
    await open("word-search.docx");
    await pause(500);
    await check("切文件终止旧搜索并清空结果", `${page}.dataset.officePage==='1'&&!${searchPanel}`);
    await evaluate("bench.close()");
    await send("HeapProfiler.collectGarbage");
    const counters = await send("Memory.getDOMCounters");
    if (counters.documents !== 1) throw new Error(`Retained ${counters.documents} documents`);
    checks.push("搜索与引用关闭后释放文档");
    if (errors.length) throw new Error(errors.join("\n"));
  } catch (error) {
    errors.push(String(error));
    process.exitCode = 1;
  } finally {
    await writeBenchmarkReport("search-regression", { checks, timings, errors });
    console.log(JSON.stringify({ checks, timings, errors }, null, 2));
    cdp.close();
  }
}
