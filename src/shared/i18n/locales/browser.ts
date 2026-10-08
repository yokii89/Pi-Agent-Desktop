import { defineMessages } from "../types";

export const browserMessages = defineMessages({
  "browser.tab.pick": { "zh-CN": "拾取", "en-US": "Pick" },
  "browser.tab.styles": { "zh-CN": "样式", "en-US": "Styles" },
  "browser.tab.boxModel": { "zh-CN": "盒模型", "en-US": "Box model" },
  "browser.tab.dom": { "zh-CN": "DOM", "en-US": "DOM" },
  "browser.tab.structure": { "zh-CN": "结构", "en-US": "Structure" },
  "browser.address.placeholder": {
    "zh-CN": "输入地址，如 localhost:5173",
    "en-US": "Enter an address, e.g. localhost:5173",
  },
  "browser.go": { "zh-CN": "前往", "en-US": "Go" },
  "browser.reload": { "zh-CN": "刷新", "en-US": "Reload" },
  "browser.stop": { "zh-CN": "停止", "en-US": "Stop" },
  "browser.back": { "zh-CN": "后退", "en-US": "Back" },
  "browser.forward": { "zh-CN": "前进", "en-US": "Forward" },
  "browser.home": { "zh-CN": "主页", "en-US": "Home" },
  "browser.newPage": { "zh-CN": "新建页面", "en-US": "New page" },
  "browser.page.untitled": { "zh-CN": "新页面", "en-US": "New page" },
  "browser.page.close": { "zh-CN": "关闭页面", "en-US": "Close page" },
  "browser.page.atLimit": {
    "zh-CN": "最多 {count} 个浏览器页面",
    "en-US": "Up to {count} browser pages",
  },
  "browser.pages.label": { "zh-CN": "浏览器页面", "en-US": "Browser pages" },
  "browser.pick.hint": {
    "zh-CN": "在页面上移动鼠标拾取元素",
    "en-US": "Hover the page to pick an element",
  },
  "browser.pick.empty": {
    "zh-CN": "尚未拾取元素",
    "en-US": "No element picked yet",
  },
  "browser.pick.idle": {
    "zh-CN": "点上方「选择元素」进入拾取会话，然后点击页面里的元素。",
    "en-US": "Click “Pick element” above, then click an element on the page.",
  },
  "browser.pick.idleHint": {
    "zh-CN": "选中后按 Enter 把元素加入对话（默认不带截图），或切到「样式 / 盒模型 / 结构」深看。",
    "en-US":
      "Press Enter to add it to chat (no screenshot by default), or open Styles / Box model / Structure.",
  },
  "browser.pick.mode.select": { "zh-CN": "圈选", "en-US": "Select" },
  "browser.pick.mode.selectHint": {
    "zh-CN": "点击页面元素即选中；此时页面鼠标事件被高亮层接管，滚不动页面。",
    "en-US":
      "Click a page element to select it. The highlight layer captures mouse events, so the page cannot scroll.",
  },
  "browser.pick.mode.browse": { "zh-CN": "浏览", "en-US": "Browse" },
  "browser.pick.mode.browseHint": {
    "zh-CN": "高亮层已关闭，可自由滚动 / 点击页面；检查器保留上一个元素的数据。",
    "en-US":
      "Highlight layer is off. Scroll and click freely; the inspector keeps the last element.",
  },
  "browser.pick.modeFooter": {
    "zh-CN": "选中后按 Enter 直接加入对话；ESC 可从圈选退到浏览，再按一次退出拾取。",
    "en-US": "Press Enter to add to chat. ESC: select → browse → exit pick.",
  },
  "browser.pick.ancestor": {
    "zh-CN": "检查器正查看祖先节点 {label}",
    "en-US": "Inspector is on ancestor {label}",
  },
  "browser.pick.backToSelected": {
    "zh-CN": "回到选中元素",
    "en-US": "Back to selected",
  },
  "browser.pick.noSelection": { "zh-CN": "尚未选中元素。", "en-US": "No element selected." },
  "browser.pick.addToChat": { "zh-CN": "加入对话", "en-US": "Add to chat" },
  "browser.pick.inChat": { "zh-CN": "已在对话中", "en-US": "Already in chat" },
  "browser.pick.copySelector": { "zh-CN": "复制 selector", "en-US": "Copy selector" },
  "browser.pick.copyStyles": { "zh-CN": "复制样式", "en-US": "Copy styles" },
  "browser.pick.copySelectorLabel": { "zh-CN": "selector", "en-US": "selector" },
  "browser.pick.copyStylesLabel": { "zh-CN": "关键样式", "en-US": "Key styles" },
  "browser.pick.screenshotOnly": { "zh-CN": "仅截图", "en-US": "Screenshot only" },
  "browser.pick.screenshotOnlyHint": {
    "zh-CN": "截图是最次级兜底，默认不加入对话",
    "en-US": "Screenshot is the last-resort option and is not added to chat by default",
  },
  "browser.pick.screenshotItem": { "zh-CN": "仅截图条目", "en-US": "Screenshot item only" },
  "browser.pick.detail.selector": { "zh-CN": "selector", "en-US": "selector" },
  "browser.pick.detail.text": { "zh-CN": "文本", "en-US": "Text" },
  "browser.pick.detail.a11y": { "zh-CN": "无障碍", "en-US": "Accessibility" },
  "browser.pick.detail.source": { "zh-CN": "来源", "en-US": "Source" },
  "browser.pick.viewportSize": {
    "zh-CN": "视口 {width}×{height}",
    "en-US": "viewport {width}×{height}",
  },
  "browser.styles.empty": {
    "zh-CN": "先拾取元素以查看样式",
    "en-US": "Pick an element to inspect styles",
  },
  "browser.styles.loading": { "zh-CN": "正在读取样式…", "en-US": "Reading styles…" },
  "browser.styles.stale": {
    "zh-CN": "节点数据已失效，请重新拾取元素。",
    "en-US": "Node data is stale. Pick an element again.",
  },
  "browser.styles.noSelectionHint": {
    "zh-CN": "尚未选中元素。在预览页圈选后即可热更样式。",
    "en-US": "No element selected. Pick one in the preview to live-edit styles.",
  },
  "browser.styles.computedHint": {
    "zh-CN": "computed 为最终生效值；点属性左侧 + 可搬入临时调整。matched 只读，不做层叠胜出判定。",
    "en-US":
      "computed is the final value; click + to move it into live adjust. matched is read-only; no cascade winner is computed.",
  },
  "browser.styles.narrowMatched": {
    "zh-CN": "侧栏偏窄，已只显示 computed；加宽后可查看匹配规则来源。",
    "en-US": "Sidebar is narrow; showing computed only. Widen to see matched rules.",
  },
  "browser.styles.matchedEmpty": {
    "zh-CN": "没有匹配的规则。",
    "en-US": "No matching rules.",
  },
  "browser.styles.matchedMeta": {
    "zh-CN": "{count} 条规则 · 只读",
    "en-US": "{count} rules · read-only",
  },
  "browser.styles.computedMeta": { "zh-CN": "{count} 项", "en-US": "{count} items" },
  "browser.styles.computedFiltered": {
    "zh-CN": "{shown} / {total} 项",
    "en-US": "{shown} / {total} items",
  },
  "browser.styles.computedFilterPlaceholder": {
    "zh-CN": "过滤属性…",
    "en-US": "Filter properties…",
  },
  "browser.styles.computedFilterClear": {
    "zh-CN": "清除过滤",
    "en-US": "Clear filter",
  },
  "browser.styles.computedFilterEmpty": {
    "zh-CN": "没有匹配的属性。",
    "en-US": "No matching properties.",
  },
  "browser.styles.inheritedFrom": {
    "zh-CN": "继承自 {from}",
    "en-US": "Inherited from {from}",
  },
  "browser.styles.origin.ua": { "zh-CN": "UA", "en-US": "UA" },
  "browser.styles.origin.author": { "zh-CN": "作者", "en-US": "Author" },
  "browser.styles.origin.inspected": { "zh-CN": "注入", "en-US": "Inspected" },
  "browser.styles.promote": { "zh-CN": "搬入临时调整", "en-US": "Move to live adjust" },
  "browser.styles.alreadyAdjusted": {
    "zh-CN": "已在临时调整中",
    "en-US": "Already in live adjust",
  },
  "browser.styles.adjust": { "zh-CN": "临时调整", "en-US": "Live adjust" },
  "browser.styles.copyCss": { "zh-CN": "复制 CSS", "en-US": "Copy CSS" },
  "browser.styles.copyCssLabel": {
    "zh-CN": "临时调整 CSS",
    "en-US": "Live-adjust CSS",
  },
  "browser.styles.add": { "zh-CN": "添加属性", "en-US": "Add property" },
  "browser.styles.computed": { "zh-CN": "计算样式", "en-US": "Computed" },
  "browser.styles.localPage": { "zh-CN": "本地页面", "en-US": "Local page" },
  "browser.styles.currentCount": {
    "zh-CN": "当前元素 {count} 条",
    "en-US": "{count} on current element",
  },
  "browser.styles.editHere": {
    "zh-CN": "在这里改，页面立刻生效",
    "en-US": "Edit here; the page updates instantly",
  },
  "browser.styles.pickFirst": { "zh-CN": "先拾取元素", "en-US": "Pick an element first" },
  "browser.styles.otherNodes": {
    "zh-CN": "另 {count} 个节点",
    "en-US": "{count} other nodes",
  },
  "browser.styles.clearCurrent": {
    "zh-CN": "清除当前元素的全部调整",
    "en-US": "Clear all adjustments on this element",
  },
  "browser.styles.adjustNote": {
    "zh-CN": "写入 PiDesk 调整样式表 · 刷新即失效 · 作者规则保持只读",
    "en-US": "Written to PiDesk adjust sheet · cleared on reload · author rules stay read-only",
  },
  "browser.styles.emptyAdjust": {
    "zh-CN": "在预览页圈选元素后，这里会变成可拧的属性控件；改动即时热更，不会写进源码。",
    "en-US":
      "Pick an element in the preview to get tweakable controls. Changes hot-update and are never written to source.",
  },
  "browser.styles.addPlaceholder.name": { "zh-CN": "属性名", "en-US": "Property" },
  "browser.styles.addPlaceholder.value": { "zh-CN": "值", "en-US": "Value" },
  "browser.styles.addSubmit": { "zh-CN": "添加临时调整", "en-US": "Add live adjust" },
  "browser.styles.added": { "zh-CN": "已添加", "en-US": "Added" },
  "browser.styles.addHint.text": {
    "zh-CN": "未在目录中的属性按文本值写入。",
    "en-US": "Properties not in the catalog are written as text values.",
  },
  "browser.styles.addHint.default": {
    "zh-CN": "Enter 添加 · 在 computed 上点 + 可直接搬入调整。",
    "en-US": "Enter to add · click + on computed to move it into adjust.",
  },
  "browser.styles.group.boxModel": { "zh-CN": "盒模型", "en-US": "Box model" },
  "browser.styles.group.border": { "zh-CN": "边框", "en-US": "Border" },
  "browser.styles.group.layout": { "zh-CN": "布局", "en-US": "Layout" },
  "browser.styles.group.flex": { "zh-CN": "Flex", "en-US": "Flex" },
  "browser.styles.group.typography": { "zh-CN": "排版", "en-US": "Typography" },
  "browser.styles.group.visual": { "zh-CN": "视觉", "en-US": "Visual" },
  "browser.styles.group.position": { "zh-CN": "定位", "en-US": "Position" },
  "browser.styles.group.other": { "zh-CN": "其他", "en-US": "Other" },
  "browser.styles.toggleOff": {
    "zh-CN": "临时关闭该声明",
    "en-US": "Temporarily disable this declaration",
  },
  "browser.styles.toggleOn": {
    "zh-CN": "重新启用该声明",
    "en-US": "Re-enable this declaration",
  },
  "browser.styles.toggleOffLabel": { "zh-CN": "关闭", "en-US": "Disable" },
  "browser.styles.toggleOnLabel": { "zh-CN": "启用", "en-US": "Enable" },
  "browser.styles.importantOn": { "zh-CN": "标记 !important", "en-US": "Mark !important" },
  "browser.styles.importantOff": {
    "zh-CN": "取消 !important",
    "en-US": "Unmark !important",
  },
  "browser.styles.removeDecl": { "zh-CN": "删除该调整", "en-US": "Remove this adjust" },
  "browser.styles.targetEmpty": { "zh-CN": "未选中元素", "en-US": "No element selected" },
  "browser.styles.liveBadgeTitle": {
    "zh-CN": "临时调整，刷新即失效",
    "en-US": "Live adjust; cleared on reload",
  },
  "browser.styles.cleared": { "zh-CN": "已清除", "en-US": "Cleared" },
  "browser.styles.applying": { "zh-CN": "应用中…", "en-US": "Applying…" },
  "browser.styles.liveCount": { "zh-CN": "{count} 项临时", "en-US": "{count} live" },
  "browser.styles.noLive": { "zh-CN": "无临时调整", "en-US": "No live adjusts" },
  "browser.styles.gotIt": { "zh-CN": "知道了", "en-US": "Got it" },
  "browser.styles.copyAsCss": {
    "zh-CN": "复制临时调整为 CSS",
    "en-US": "Copy live adjusts as CSS",
  },
  "browser.styles.clearAll": {
    "zh-CN": "全部清除临时调整",
    "en-US": "Clear all live adjusts",
  },
  "browser.styles.colorUnparsed": {
    "zh-CN": "当前值无法解析为取色器",
    "en-US": "Current value cannot open the color picker",
  },
  "browser.styles.pickColor": { "zh-CN": "选择颜色", "en-US": "Pick a color" },
  "browser.styles.lengthHint": {
    "zh-CN": "拖拽 / 滚轮调数值；Shift ×10",
    "en-US": "Drag or scroll to step; Shift ×10",
  },
  "browser.styles.enumPlaceholder": { "zh-CN": "选择…", "en-US": "Select…" },

  // 设计面板（拾取后自动填入 + 手调热更）
  "browser.design.modeLabel": { "zh-CN": "样式编辑模式", "en-US": "Style edit mode" },
  "browser.design.mode.design": { "zh-CN": "设计", "en-US": "Design" },
  "browser.design.mode.css": { "zh-CN": "CSS", "en-US": "CSS" },
  "browser.design.position": { "zh-CN": "位置", "en-US": "Position" },
  "browser.design.layout": { "zh-CN": "布局", "en-US": "Layout" },
  "browser.design.appearance": { "zh-CN": "外观", "en-US": "Appearance" },
  "browser.design.text": { "zh-CN": "文本", "en-US": "Text" },
  "browser.design.background": { "zh-CN": "背景", "en-US": "Background" },
  "browser.design.border": { "zh-CN": "边框", "en-US": "Border" },
  "browser.design.shadow": { "zh-CN": "阴影与模糊", "en-US": "Shadow & blur" },
  "browser.design.rotate": { "zh-CN": "旋转", "en-US": "Rotation" },
  "browser.design.rotateReset": { "zh-CN": "旋转归零", "en-US": "Reset rotation" },
  "browser.design.flipH": { "zh-CN": "水平翻转", "en-US": "Flip horizontal" },
  "browser.design.flipV": { "zh-CN": "垂直翻转", "en-US": "Flip vertical" },
  "browser.design.resetSection": {
    "zh-CN": "清除本组临时调整",
    "en-US": "Clear live adjusts in this section",
  },
  "browser.design.flow": { "zh-CN": "Flow", "en-US": "Flow" },
  "browser.design.flow.block": { "zh-CN": "块级", "en-US": "Block" },
  "browser.design.flow.row": { "zh-CN": "水平 Flex", "en-US": "Flex row" },
  "browser.design.flow.column": { "zh-CN": "垂直 Flex", "en-US": "Flex column" },
  "browser.design.flow.grid": { "zh-CN": "网格", "en-US": "Grid" },
  "browser.design.padding": { "zh-CN": "Padding", "en-US": "Padding" },
  "browser.design.margin": { "zh-CN": "Margin", "en-US": "Margin" },
  "browser.design.horizontal": { "zh-CN": "水平", "en-US": "H" },
  "browser.design.vertical": { "zh-CN": "垂直", "en-US": "V" },
  "browser.design.link": { "zh-CN": "四边联动", "en-US": "Link all sides" },
  "browser.design.unlink": { "zh-CN": "取消联动", "en-US": "Unlink sides" },
  "browser.design.borderBox": { "zh-CN": "Border box", "en-US": "Border box" },
  "browser.design.opacity": { "zh-CN": "不透明度", "en-US": "Opacity" },
  "browser.design.opacityShort": { "zh-CN": "透明", "en-US": "Opa" },
  "browser.design.radius": { "zh-CN": "圆角", "en-US": "Radius" },
  "browser.design.radiusShort": { "zh-CN": "圆角", "en-US": "R" },
  "browser.design.visibility": { "zh-CN": "显示 / 隐藏", "en-US": "Show / hide" },
  "browser.design.drop": { "zh-CN": "提高饱和度", "en-US": "Boost saturation" },
  "browser.design.font": { "zh-CN": "字体", "en-US": "Font" },
  "browser.design.size": { "zh-CN": "Size", "en-US": "Size" },
  "browser.design.color": { "zh-CN": "Color", "en-US": "Color" },
  "browser.design.lineHeight": { "zh-CN": "Line Height", "en-US": "Line Height" },
  "browser.design.lineHeightShort": { "zh-CN": "行高", "en-US": "LH" },
  "browser.design.letterSpacing": {
    "zh-CN": "Letter Spacing",
    "en-US": "Letter Spacing",
  },
  "browser.design.letterSpacingShort": { "zh-CN": "字距", "en-US": "LS" },
  "browser.design.align": { "zh-CN": "对齐方式", "en-US": "Align" },
  "browser.design.alignShort": { "zh-CN": "对齐", "en-US": "Align" },
  "browser.design.align.left": { "zh-CN": "左对齐", "en-US": "Align left" },
  "browser.design.align.center": { "zh-CN": "居中", "en-US": "Align center" },
  "browser.design.align.right": { "zh-CN": "右对齐", "en-US": "Align right" },
  "browser.design.align.justify": { "zh-CN": "两端对齐", "en-US": "Justify" },
  "browser.design.pickColor": { "zh-CN": "选择颜色", "en-US": "Pick color" },
  "browser.design.clearBg": { "zh-CN": "清除背景色", "en-US": "Clear background" },
  "browser.design.add": { "zh-CN": "添加", "en-US": "Add" },
  "browser.design.borderWidth": { "zh-CN": "Width", "en-US": "Width" },
  "browser.design.borderStyle": { "zh-CN": "Style", "en-US": "Style" },
  "browser.design.boxShadow": { "zh-CN": "Box Shadow", "en-US": "Box Shadow" },
  "browser.design.filter": { "zh-CN": "Filter", "en-US": "Filter" },
  "browser.dom.empty": {
    "zh-CN": "连接页面后显示 DOM 树",
    "en-US": "Connect to a page to see the DOM tree",
  },
  "browser.dom.loading": { "zh-CN": "正在读取元素树…", "en-US": "Reading element tree…" },
  "browser.dom.stale": {
    "zh-CN": "节点数据已失效，请重新拾取元素。",
    "en-US": "Node data is stale. Pick an element again.",
  },
  "browser.dom.noSelection": { "zh-CN": "尚未选中元素。", "en-US": "No element selected." },
  "browser.dom.compactChildren": {
    "zh-CN": "侧栏偏窄，暂不展示子元素。",
    "en-US": "Sidebar is narrow; children are hidden.",
  },
  "browser.dom.switchTo": { "zh-CN": "切换到 {label}", "en-US": "Switch to {label}" },
  "browser.box.loading": { "zh-CN": "正在读取盒模型…", "en-US": "Reading box model…" },
  "browser.box.stale": {
    "zh-CN": "节点数据已失效，请重新拾取元素。",
    "en-US": "Node data is stale. Pick an element again.",
  },
  "browser.box.noSelection": { "zh-CN": "尚未选中元素。", "en-US": "No element selected." },
  "browser.box.content": { "zh-CN": "内容区", "en-US": "Content" },
  "browser.loginImport.title": { "zh-CN": "导入登录状态", "en-US": "Import login state" },
  "browser.loginImport.consent": {
    "zh-CN": "我已了解导入浏览器登录状态的风险",
    "en-US": "I understand the risks of importing browser login state",
  },
  "browser.loginImport.preparing": { "zh-CN": "正在准备…", "en-US": "Preparing…" },
  "browser.loginImport.intro": {
    "zh-CN":
      "可从本机 Chrome / Edge 读取登录态（按站点，或整套浏览器数据）或手动粘贴，写入 PiDesk 内置浏览器以减少重复登录。",
    "en-US":
      "Read login state from local Chrome / Edge (a single site, or the whole browser session) or paste it, into PiDesk's browser to avoid repeated logins.",
  },
  "browser.loginImport.consent.sites": {
    "zh-CN":
      "按站点导入只读取你确认的站点；「导入浏览器数据」会覆盖全部站点，但两者都只取 Cookie 与站点存储，不读密码、书签或历史",
    "en-US":
      "A site import touches only the site you confirm; “Import browser data” covers all sites — both read cookies and site storage only, never passwords, bookmarks, or history",
  },
  "browser.loginImport.consent.local": {
    "zh-CN": "Cookie 仅写入本机 persist:browser 分区，不会上传，也不会交给 AI",
    "en-US":
      "Cookies stay in the local persist:browser partition; never uploaded or given to the AI",
  },
  "browser.loginImport.consent.revoke": {
    "zh-CN": "可随时在「更多 → 清除 Cookie」撤销本次导入",
    "en-US": "Revoke anytime via More → Clear cookies",
  },
  "browser.loginImport.consent.once": {
    "zh-CN": "你只需同意一次，之后打开将直接进入导入流程",
    "en-US": "Consent once; later opens go straight to the import flow",
  },
  "browser.loginImport.understood": {
    "zh-CN": "我已了解，继续",
    "en-US": "I understand, continue",
  },
  "browser.loginImport.methodTitle": {
    "zh-CN": "选择导入方式",
    "en-US": "Choose import method",
  },
  "browser.loginImport.methodHint": {
    "zh-CN": "优先尝试从本机浏览器自动读取；失败时再用手动粘贴。",
    "en-US": "Try reading from a local browser first; fall back to paste if that fails.",
  },
  "browser.loginImport.method.auto": {
    "zh-CN": "从本机浏览器读取",
    "en-US": "Read from local browser",
  },
  "browser.loginImport.method.autoDesc": {
    "zh-CN":
      "读取 Chrome / Edge 某个 Profile 中与目标站点相关的 Cookie（新版 Chrome 的 App-Bound 加密读不到，会直接提示改用粘贴）",
    "en-US":
      "Read cookies for the target site from a Chrome / Edge profile (App-Bound encryption in newer Chrome is unreadable and will point you to paste)",
  },
  "browser.loginImport.method.paste": {
    "zh-CN": "手动粘贴",
    "en-US": "Paste manually",
  },
  "browser.loginImport.method.pasteDesc": {
    "zh-CN": "从 DevTools 复制 Cookie 表格（含域名 / 有效期），不受系统级加密限制",
    "en-US":
      "Copy the cookie table from DevTools (domain + expiry included); unaffected by system-level encryption",
  },
  "browser.loginImport.method.full": {
    "zh-CN": "导入浏览器数据（全部站点）",
    "en-US": "Import browser data (all sites)",
  },
  "browser.loginImport.method.fullDesc": {
    "zh-CN": "把本机浏览器的整套登录态搬进面板（含 Google 等三方账号），可一并带上站点存储",
    "en-US":
      "Bring the whole local browser session into the panel (including Google/third-party accounts), optionally with site storage",
  },
  "browser.loginImport.fullTitle": {
    "zh-CN": "导入浏览器数据",
    "en-US": "Import browser data",
  },
  "browser.loginImport.fullHint": {
    "zh-CN":
      "完整导入依赖浏览器本体解密 Cookie（新版 Chrome 的应用绑定加密只能由 Chrome 自己解开）。请先完全退出 Chrome / Edge，再点导入；导入期间会临时拉起一个无界面实例，结束后立即清理。",
    "en-US":
      "A full import relies on the browser itself to decrypt cookies (App-Bound encryption in newer Chrome can only be unwrapped by Chrome). Fully quit Chrome / Edge first, then import; a headless instance is started for the import and cleaned up right after.",
  },
  "browser.loginImport.includeLocalStorage": {
    "zh-CN": "同时导入站点存储（LocalStorage，较慢）",
    "en-US": "Also import site storage (LocalStorage, slower)",
  },
  "browser.loginImport.includeLocalStorageHint": {
    "zh-CN":
      "站点登录态（如 Supabase / Firebase 的会话）常存在 LocalStorage 里，不导就会出现「Cookie 有了但站点仍显示未登录」。代价是逐个站点导航读取，可能要几十秒。",
    "en-US":
      "Site sessions (Supabase / Firebase) usually live in LocalStorage; skipping it often leaves a site still showing as signed out. Cost: one visit per site, so it may take tens of seconds.",
  },
  "browser.loginImport.fullWarning": {
    "zh-CN":
      "这会把本机浏览器的全部站点 Cookie 写进面板分区（面板与主窗口仍然隔离）。随时可用「更多 → 清除 Cookie」回到干净分区。",
    "en-US":
      "This writes all local browser cookies into the panel partition (still isolated from the main window). Use “More → Clear cookies” to return to a clean partition.",
  },
  "browser.loginImport.fullAction": {
    "zh-CN": "开始导入",
    "en-US": "Start import",
  },
  "browser.loginImport.fullRunning": {
    "zh-CN": "导入中…（请勿关闭面板）",
    "en-US": "Importing… (do not close the panel)",
  },
  "browser.loginImport.fullToast": {
    "zh-CN": "已导入 {cookies} 条 Cookie、{origins} 个站点的 {entries} 条存储数据{suffix}",
    "en-US":
      "Imported {cookies} cookies and {entries} storage entries across {origins} sites{suffix}",
  },
  "browser.loginImport.errLocked": {
    "zh-CN": "Chrome / Edge 正在运行并占用 Cookie 库，请完全退出浏览器后重试",
    "en-US": "Chrome / Edge is running and holds the cookie DB. Quit the browser and retry.",
  },
  "browser.loginImport.warnNoBrowser": {
    "zh-CN": "未找到 Chrome / Edge 可执行文件，退回旧版解密（新版加密的 Cookie 会漏掉）",
    "en-US":
      "Chrome / Edge executable not found; fell back to legacy decryption (App-Bound cookies are skipped)",
  },
  "browser.loginImport.warnHelperFallback": {
    "zh-CN": "浏览器 helper 读取失败，已退回旧版解密，可关闭浏览器后重试",
    "en-US":
      "Browser helper read failed; fell back to legacy decryption. Quit the browser and retry.",
  },
  "browser.loginImport.warnAppBound": {
    "zh-CN": "有 {count} 条 Cookie 解不开（新版应用绑定加密）",
    "en-US": "{count} cookies could not be decrypted (App-Bound encryption)",
  },
  "browser.loginImport.errAppBound": {
    "zh-CN":
      "本机浏览器的 Cookie 被系统级加密保护（App-Bound，共 {appBound}/{total} 条），第三方程序无法读取，所以这次一条也没能导入——不是导入失败，而是这条路被系统堵死了。可行做法：改用「手动粘贴」从 DevTools 复制 Cookie 表格（DevTools 能直接看到明文），或在面板内用该站点支持的其他方式登录（GitHub / 微软 / 邮箱）。",
    "en-US":
      "Your browser's cookies are protected by system-level App-Bound encryption ({appBound}/{total}), which no third-party program can read — so nothing was imported. This is a hard system limit, not a transient failure. What works instead: use “Paste manually” to copy the cookie table from DevTools (DevTools shows the plaintext), or sign in to the site inside the panel with another provider (GitHub / Microsoft / email).",
  },
  "browser.loginImport.warnAppBoundSkipped": {
    "zh-CN": "另有 {count} 条 Cookie 受系统级加密保护，未能导入",
    "en-US": "{count} more cookies are App-Bound protected and were skipped",
  },
  "browser.loginImport.warnLocalStoragePartial": {
    "zh-CN": "有 {count} 个站点的 LocalStorage 未读到（站点不可达或读超时）",
    "en-US": "LocalStorage for {count} sites could not be read (unreachable or timed out)",
  },
  "browser.loginImport.warnLocalStorageWrite": {
    "zh-CN": "有 {count} 个站点的 LocalStorage 未能写入面板",
    "en-US": "LocalStorage for {count} sites could not be written into the panel",
  },
  "browser.loginImport.autoTitle": {
    "zh-CN": "从本机浏览器读取",
    "en-US": "Read from local browser",
  },
  "browser.loginImport.profile": {
    "zh-CN": "浏览器 Profile",
    "en-US": "Browser profile",
  },
  "browser.loginImport.defaultBrowser": {
    "zh-CN": "（默认浏览器）",
    "en-US": " (default browser)",
  },
  "browser.loginImport.targetHost": { "zh-CN": "目标站点", "en-US": "Target site" },
  "browser.loginImport.hostPlaceholder": {
    "zh-CN": "例如 localhost 或 staging.example.com",
    "en-US": "e.g. localhost or staging.example.com",
  },
  "browser.loginImport.previewCount": {
    "zh-CN": "将导入 {count} 条（仅名称，不含值）",
    "en-US": "Will import {count} (names only, no values)",
  },
  "browser.loginImport.autoHint": {
    "zh-CN": "读取的是本机浏览器 Cookie 库副本，用完即删；value 不会显示在界面上。",
    "en-US":
      "Reads a copy of the local browser cookie DB and deletes it after use; values are never shown.",
  },
  "browser.loginImport.pasteTitle": { "zh-CN": "粘贴 Cookie", "en-US": "Paste cookies" },
  "browser.loginImport.cookieBody": {
    "zh-CN": "Cookie 内容",
    "en-US": "Cookie body",
  },
  "browser.loginImport.cookiePlaceholder": {
    "zh-CN": "name=value; name2=value2",
    "en-US": "name=value; name2=value2",
  },
  "browser.loginImport.pasteHint": {
    "zh-CN":
      "支持两种粘贴：DevTools Cookie 表格（推荐，含域名与有效期），以及 `name=value; name2=value2`（没域名时会写到上面填的站点）。",
    "en-US":
      "Two formats: a DevTools cookie table (recommended — includes domain and expiry) or `name=value; name2=value2` (written to the site above when no domain is present).",
  },
  "browser.loginImport.paste.devtools": {
    "zh-CN": "从 Chrome / Edge DevTools 复制（推荐）",
    "en-US": "Copy from Chrome / Edge DevTools (recommended)",
  },
  "browser.loginImport.paste.devtoolsSteps": {
    "zh-CN":
      "DevTools → Application → Storage → Cookies → 选中左侧的域（如 `.google.com` 与 `accounts.google.com` 各选一次）→ 在表格里 Ctrl+A、Ctrl+C → 粘到下框。表格自带 Domain / Path / 有效期 / HttpOnly，所以域 Cookie 能正确还原。",
    "en-US":
      "DevTools → Application → Storage → Cookies → pick each domain on the left (e.g. `.google.com` and `accounts.google.com`) → Ctrl+A then Ctrl+C in the table → paste below. The table carries Domain / Path / expiry / HttpOnly, so domain cookies are restored correctly.",
  },
  "browser.loginImport.hostOptional": {
    "zh-CN": "（粘贴表格时可留空）",
    "en-US": " (leave blank when pasting a table)",
  },
  "browser.loginImport.import": { "zh-CN": "导入", "en-US": "Import" },
  "browser.loginImport.importN": { "zh-CN": "导入 {count} 条", "en-US": "Import {count}" },
  "browser.loginImport.importing": { "zh-CN": "导入中…", "en-US": "Importing…" },
  "browser.loginImport.preview": { "zh-CN": "读取预览", "en-US": "Preview" },
  "browser.loginImport.reading": { "zh-CN": "读取中…", "en-US": "Reading…" },
  "browser.loginImport.usePaste": {
    "zh-CN": "改用手动粘贴",
    "en-US": "Switch to paste",
  },
  "browser.loginImport.errNoSources": {
    "zh-CN": "未检测到本机 Chrome / Edge 的 Cookie 数据库，可改用手动粘贴",
    "en-US": "No local Chrome / Edge cookie DB found. Try manual paste.",
  },
  "browser.loginImport.errDetect": {
    "zh-CN": "检测浏览器失败",
    "en-US": "Failed to detect browsers",
  },
  "browser.loginImport.errNeedHost": {
    "zh-CN": "请填写目标站点",
    "en-US": "Enter a target site",
  },
  "browser.loginImport.errNeedPaste": {
    "zh-CN": "请粘贴 Cookie 内容",
    "en-US": "Paste cookie content",
  },
  "browser.loginImport.errDecrypt": {
    "zh-CN": "未能解密该站点的 Cookie，可改用手动粘贴",
    "en-US": "Could not decrypt cookies for this site. Try manual paste.",
  },
  "browser.loginImport.errNoMatch": {
    "zh-CN": "该 Profile 下没有匹配此站点的 Cookie",
    "en-US": "No cookies for this site in that profile",
  },
  "browser.loginImport.errRead": { "zh-CN": "读取失败", "en-US": "Read failed" },
  "browser.loginImport.errImport": { "zh-CN": "导入失败", "en-US": "Import failed" },
  "browser.loginImport.warnManual": {
    "zh-CN": "自动读取失败时，可返回并改用手动粘贴 Cookie。",
    "en-US": "If auto-read fails, go back and paste cookies manually.",
  },
  "browser.loginImport.toast": {
    "zh-CN": "已导入 {count} 条 Cookie{suffix}",
    "en-US": "Imported {count} cookies{suffix}",
  },
  "browser.loginImport.toastSuffix": {
    "zh-CN": "（{warning}）",
    "en-US": " ({warning})",
  },
  "browser.viewport.width": { "zh-CN": "视口宽度", "en-US": "Viewport width" },
  "browser.viewport.follow": { "zh-CN": "跟随面板", "en-US": "Follow panel" },
  "browser.viewport.followPanel": {
    "zh-CN": "跟随面板宽度",
    "en-US": "Follow panel width",
  },
  "browser.viewport.preset": {
    "zh-CN": "视口宽度 {width}px",
    "en-US": "Viewport {width}px",
  },
  "browser.viewport.custom": {
    "zh-CN": "自定义视口宽度",
    "en-US": "Custom viewport width",
  },
  "browser.viewport.widthPlaceholder": { "zh-CN": "宽度", "en-US": "Width" },
  "browser.more": { "zh-CN": "更多操作", "en-US": "More actions" },
  "browser.moreTrigger": { "zh-CN": "更多", "en-US": "More" },
  "browser.forceReload": { "zh-CN": "强制刷新", "en-US": "Hard reload" },
  "browser.loginImport.menuItem": {
    "zh-CN": "导入登录状态…",
    "en-US": "Import login state…",
  },
  "browser.zoom": { "zh-CN": "缩放", "en-US": "Zoom" },
  "browser.zoom.out": { "zh-CN": "缩小", "en-US": "Zoom out" },
  "browser.zoom.in": { "zh-CN": "放大", "en-US": "Zoom in" },
  "browser.clearCookies": { "zh-CN": "清除 Cookie", "en-US": "Clear cookies" },
  "browser.clearCache": { "zh-CN": "清除缓存", "en-US": "Clear cache" },
  "browser.copyText": { "zh-CN": "复制文本", "en-US": "Copy text" },
  "browser.openDevtools": { "zh-CN": "打开开发者工具", "en-US": "Open DevTools" },
  "browser.openExternal": {
    "zh-CN": "在系统浏览器中打开",
    "en-US": "Open in system browser",
  },
  "browser.popup.blocked": {
    "zh-CN": "站内窗口过多（上限 {limit} 个），请先关闭一些页面窗口",
    "en-US": "Too many in-app popups (limit {limit}) — close some windows first",
  },
  "browser.capture": { "zh-CN": "截图", "en-US": "Capture" },
  "browser.capture.region": {
    "zh-CN": "区域截图（拖拽框选）",
    "en-US": "Region capture (drag to select)",
  },
  "browser.region.hint": {
    "zh-CN": "拖拽框选截图区域 · Esc 取消",
    "en-US": "Drag to select · Esc to cancel",
  },
  "browser.disablePick": { "zh-CN": "退出拾取", "en-US": "Exit pick mode" },
  "browser.enablePick": { "zh-CN": "进入拾取", "en-US": "Enter pick mode" },
  "browser.pick.enter": { "zh-CN": "选择元素", "en-US": "Pick element" },
  "browser.pick.exit": { "zh-CN": "退出元素选择", "en-US": "Exit element pick" },
  "browser.pick.exitSelect": {
    "zh-CN": "退出元素选择（ESC 先退到浏览，再按一次退出）",
    "en-US": "Exit element pick (ESC: select → browse → exit)",
  },
  "browser.recents": { "zh-CN": "最近访问", "en-US": "Recent" },
  "browser.recents.title": {
    "zh-CN": "最近访问（本地地址优先）",
    "en-US": "Recent (local addresses first)",
  },
  "browser.recents.empty": { "zh-CN": "暂无记录", "en-US": "No history yet" },
  "browser.errors.title": { "zh-CN": "控制台错误", "en-US": "Console errors" },
  "browser.errors.sectionTitle": {
    "zh-CN": "控制台错误（最近 5 条将随上下文发送）",
    "en-US": "Console errors (last 5 sent with context)",
  },
  "browser.errors.copyAll": { "zh-CN": "复制全部", "en-US": "Copy all" },
  "browser.errors.copyLabel": { "zh-CN": "错误信息", "en-US": "Error messages" },
  "browser.errors.empty": { "zh-CN": "暂无错误", "en-US": "No errors" },
  "browser.empty.title": {
    "zh-CN": "输入地址打开本地开发预览",
    "en-US": "Enter an address to open a local preview",
  },
  "browser.empty.hint": {
    "zh-CN": "如 http://localhost:5173，选中元素后按 Enter 加入对话",
    "en-US": "e.g. http://localhost:5173 — pick an element, press Enter to add to chat",
  },
  "browser.inspector.label": { "zh-CN": "元素检查器", "en-US": "Element inspector" },
  "browser.inspector.resize": {
    "zh-CN": "拖拽调整检查器高度",
    "en-US": "Drag to resize inspector",
  },
  "browser.inspector.content": { "zh-CN": "检查器内容", "en-US": "Inspector content" },
  "browser.inspector.refreshNode": {
    "zh-CN": "重新读取当前元素",
    "en-US": "Refresh current element",
  },
  "browser.inspector.expand": { "zh-CN": "展开检查器", "en-US": "Expand inspector" },
  "browser.inspector.collapse": { "zh-CN": "收起检查器", "en-US": "Collapse inspector" },
  "browser.inspector.float": {
    "zh-CN": "浮窗显示检查器",
    "en-US": "Open inspector as floating window",
  },
  "browser.inspector.floatTitle": {
    "zh-CN": "元素检查器",
    "en-US": "Element inspector",
  },
  "browser.inspector.floatDock": {
    "zh-CN": "停靠回主窗口",
    "en-US": "Dock back to main window",
  },
  "browser.inspector.floatClose": {
    "zh-CN": "关闭浮窗（停靠回来）",
    "en-US": "Close float (dock back)",
  },
  "browser.inspector.repick": { "zh-CN": "重新拾取", "en-US": "Pick again" },
  "browser.inspector.narrowHint": {
    "zh-CN": "侧栏较窄，检查器展示受限。",
    "en-US": "Sidebar is narrow; inspector is limited.",
  },
  "browser.inspector.stale.navigated": {
    "zh-CN": "页面已刷新，请重新拾取元素",
    "en-US": "Page refreshed; pick an element again",
  },
  "browser.inspector.stale.detached": {
    "zh-CN": "调试器会话已断开（可能被 DevTools 抢占），请重新拾取",
    "en-US": "Debugger session detached (DevTools may have taken over); pick again",
  },
  "browser.inspector.stale.stale": {
    "zh-CN": "该节点已不在文档中，请重新拾取",
    "en-US": "That node is no longer in the document; pick again",
  },

  "browser.toast.externalWarn": {
    "zh-CN": "正在访问外部页面：该页面可执行任意 Web 内容，请注意敏感数据",
    "en-US":
      "Opening an external page: it can run arbitrary web content — watch for sensitive data",
  },
  "browser.toast.maxInstances": {
    "zh-CN": "最多 {count} 个浏览器页面",
    "en-US": "At most {count} browser pages",
  },
  "browser.toast.createFailed": {
    "zh-CN": "新建浏览器页面失败",
    "en-US": "Failed to create browser page",
  },
  "browser.toast.keepOne": {
    "zh-CN": "至少保留一个浏览器页面",
    "en-US": "Keep at least one browser page",
  },
  "browser.toast.closeFailed": {
    "zh-CN": "关闭浏览器页面失败",
    "en-US": "Failed to close browser page",
  },
  "browser.toast.switchFailed": {
    "zh-CN": "切换浏览器页面失败",
    "en-US": "Failed to switch browser page",
  },
  "browser.toast.navigateFailed": { "zh-CN": "导航失败", "en-US": "Navigation failed" },
  "browser.toast.openLocalFailed": {
    "zh-CN": "在侧栏浏览器中打开失败",
    "en-US": "Failed to open in sidebar browser",
  },
  "browser.toast.pickFailed": {
    "zh-CN": "进入拾取模式失败",
    "en-US": "Failed to enter pick mode",
  },
  "browser.toast.pickModeFailed": {
    "zh-CN": "切换拾取模式失败",
    "en-US": "Failed to switch pick mode",
  },
  "browser.toast.captureNoPage": {
    "zh-CN": "截图失败：请确认已打开页面",
    "en-US": "Capture failed: make sure a page is open",
  },
  "browser.toast.regionTooSmall": {
    "zh-CN": "选区太小，请重新框选",
    "en-US": "Selection too small; try again",
  },
  "browser.toast.regionSaveFailed": {
    "zh-CN": "区域截图保存失败",
    "en-US": "Failed to save region capture",
  },
  "browser.toast.regionFailed": {
    "zh-CN": "区域截图失败",
    "en-US": "Region capture failed",
  },
  "browser.toast.noPage": {
    "zh-CN": "浏览器面板尚未打开页面",
    "en-US": "No page open in the browser panel",
  },
  "browser.toast.reloadFailed": { "zh-CN": "刷新失败", "en-US": "Reload failed" },
  "browser.toast.captureFailed": { "zh-CN": "截图失败", "en-US": "Capture failed" },
  "browser.toast.forceReloadFailed": {
    "zh-CN": "强制刷新失败",
    "en-US": "Force reload failed",
  },
  "browser.toast.devtoolsFailed": {
    "zh-CN": "打开 DevTools 失败",
    "en-US": "Failed to open DevTools",
  },
  "browser.toast.cookiesCleared": {
    "zh-CN": "Cookie 已清除",
    "en-US": "Cookies cleared",
  },
  "browser.toast.clearCookiesFailed": {
    "zh-CN": "清除 Cookie 失败",
    "en-US": "Failed to clear cookies",
  },
  "browser.toast.cacheCleared": { "zh-CN": "缓存已清除", "en-US": "Cache cleared" },
  "browser.toast.clearCacheFailed": {
    "zh-CN": "清除缓存失败",
    "en-US": "Failed to clear cache",
  },
});
