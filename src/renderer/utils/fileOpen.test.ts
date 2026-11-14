import { describe, expect, it } from "vitest";
import { relativeToPath, toNativePath } from "./fileOpen";

describe("toNativePath", () => {
  it("内部 `/` 分隔转成 Windows 反斜杠（复制给资源管理器 / 终端）", () => {
    expect(toNativePath("D:/Code/PI/pidesk/src/app.ts")).toBe("D:\\Code\\PI\\pidesk\\src\\app.ts");
  });

  it("已是反斜杠的路径不变", () => {
    expect(toNativePath("D:\\Code\\app.ts")).toBe("D:\\Code\\app.ts");
  });
});

describe("relativeToPath", () => {
  it("根下目标取相对路径（大小写不敏感）", () => {
    expect(relativeToPath("D:/Code/PI/pidesk", "d:/code/pi/pidesk/src/app.ts")).toBe("src/app.ts");
  });

  it("根尾带斜杠也认", () => {
    expect(relativeToPath("D:/Code/PI/pidesk/", "D:/Code/PI/pidesk/src")).toBe("src");
  });

  it("不在根下的目标原样返回（不猜、不剥前缀）", () => {
    expect(relativeToPath("D:/Code/PI/pidesk", "D:/Other/app.ts")).toBe("D:/Other/app.ts");
  });

  it("前缀相同但不是子目录时不能误判（pidesk2 不是 pidesk 的子目录）", () => {
    expect(relativeToPath("D:/Code/pidesk", "D:/Code/pidesk2/app.ts")).toBe(
      "D:/Code/pidesk2/app.ts",
    );
  });
});
