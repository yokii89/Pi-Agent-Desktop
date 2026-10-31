/**
 * 把元素滚进**最近的滚动容器**的视野，只改这一层容器的滚动偏移。
 *
 * 为什么不用 `scrollIntoView`：它会沿祖先链滚动**所有**可滚动容器。`#root` 虽然
 * `overflow: hidden`，仍是可被程序化滚动的容器——侧栏展开挂载的那一帧，aside 还按
 * CSS 兜底宽度挂在 0 宽轨道上（伸出视口），页签条定位会把整个应用横滚一次，随后
 * 补间把溢出收窄、浏览器再把偏移夹回 0，肉眼就是整页弹跳。
 * 同理不要用 `Element.scrollIntoView` 做"定位到某行"，用本函数。
 */
export function revealInNearestScroller(el: HTMLElement, axis: "x" | "y" = "y"): void {
  const overflowProp = axis === "x" ? "overflowX" : "overflowY";
  const size = axis === "x" ? "clientWidth" : "clientHeight";
  let host = el.parentElement;
  while (host && host !== document.body) {
    const style = getComputedStyle(host);
    if ((style[overflowProp] === "auto" || style[overflowProp] === "scroll") && host[size] > 0) {
      break;
    }
    host = host.parentElement;
  }
  if (!host || host === document.body) return;

  const rect = el.getBoundingClientRect();
  const hostRect = host.getBoundingClientRect();
  if (axis === "x") {
    const start = rect.left - hostRect.left;
    const end = start + rect.width;
    if (start < host.scrollLeft) host.scrollLeft = start;
    else if (end > host.scrollLeft + host.clientWidth) host.scrollLeft = end - host.clientWidth;
    return;
  }
  const start = rect.top - hostRect.top;
  const end = start + rect.height;
  if (start < host.scrollTop) host.scrollTop = start;
  else if (end > host.scrollTop + host.clientHeight) host.scrollTop = end - host.clientHeight;
}
