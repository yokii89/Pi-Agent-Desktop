import type { ViewNode } from "../../../shared/view";

export type FormValues = Record<string, unknown>;

/**
 * Collect form field defaults from a ViewNode tree.
 * When `previous` is provided, keep the user's live value for any id that still
 * exists — Client `update()` is a full-tree replace and must not wipe typing.
 * Client-sent `value` / `checked` on the new tree win over `previous` (the tree
 * is the authoritative snapshot the extension just pushed).
 *
 * tabs：非激活页签的 children 仍属于树本身，值收集覆盖全部页签——
 * 切页签（乃至扩展只回显部分状态）不得清空其它页签已填内容（docs/design/08 §5.2）。
 */
export function collectFormValues(root: ViewNode, previous?: FormValues): FormValues {
  const values: FormValues = {};
  // 同一子树内 id 必须唯一；重复时取先出现的（docs/design/08 §5.2）
  const take = (id: string, assign: () => unknown): void => {
    if (id in values) return;
    values[id] = assign();
  };
  const walk = (node: ViewNode): void => {
    switch (node.type) {
      case "input": {
        take(node.id, () => {
          if (typeof node.value === "string") return node.value;
          if (previous && node.id in previous) return previous[node.id];
          return "";
        });
        return;
      }
      case "select": {
        take(node.id, () => {
          if (node.value !== undefined) return node.value;
          if (previous && node.id in previous) return previous[node.id];
          return "";
        });
        return;
      }
      case "checkbox": {
        take(node.id, () => {
          if (node.checked !== undefined) return node.checked === true;
          if (previous && node.id in previous) return previous[node.id] === true;
          return false;
        });
        return;
      }
      case "list": {
        take(node.id, () => {
          if (node.value !== undefined) {
            if (node.multiple) {
              return Array.isArray(node.value)
                ? node.value
                : typeof node.value === "string"
                  ? [node.value]
                  : [];
            }
            return typeof node.value === "string"
              ? node.value
              : Array.isArray(node.value)
                ? (node.value[0] ?? "")
                : "";
          }
          if (previous && node.id in previous) return previous[node.id];
          return node.multiple ? [] : "";
        });
        return;
      }
      case "tabs":
        for (const tab of node.tabs) {
          for (const child of tab.children) walk(child);
        }
        return;
      case "column":
      case "row":
      case "card":
        for (const child of node.children) walk(child);
        return;
      default:
        return;
    }
  };
  walk(root);
  return values;
}
