import initSqlJs from "sql.js";
import type { BrowserLoginSource } from "../../shared/ipc";
import { readCookieDbBytes } from "./chromiumCookieDb";

/**
 * Cookie 库的「保护等级」体检（docs/design/42 §6.7）。
 *
 * 只读密文前缀，不解密任何一条 Cookie：Windows 上 Chrome 127+ 把 Cookie 换成 App-Bound
 * Encryption（`v20`），密钥由 **SYSTEM 级** CNG 凭据保护，第三方进程在用户态解不开，连
 * 浏览器本体在一次性 profile 里也读不出来（实测：Chrome 155 会把整库清空，3046 → 0）。
 *
 * 有这份体检，导入才能把「一条都没导进来」说清楚：先体检、再决定报错还是继续，而不是
 * 静默地“成功导入 0 条”，让用户以为登录态已经进来了。
 */

const V20_PREFIX = "v20";

export interface ChromiumCookieProtection {
  /** 解析失败时为 null：调用方应把体检失败当作「无法判定」而不是「没有保护」。 */
  total: number | null;
  /** `v20` App-Bound 密文条数。 */
  appBound: number | null;
}

/** 读取 Cookie 库并统计密文前缀分布。库被占用 / 表结构异常时返回 null。 */
export async function inspectChromiumCookieProtection(
  source: BrowserLoginSource,
): Promise<ChromiumCookieProtection> {
  let fileBuf: Buffer;
  try {
    fileBuf = await readCookieDbBytes(source.cookieDbPath);
  } catch {
    return { total: null, appBound: null };
  }

  const SQL = await initSqlJs({
    locateFile: (file) => {
      try {
        return require.resolve(`sql.js/dist/${file}`);
      } catch {
        return file;
      }
    },
  });
  const db = new SQL.Database(fileBuf);
  try {
    // 只取 encrypted_value 一列：体检不碰 value，也不落任何明文
    const result = db.exec("SELECT encrypted_value FROM cookies");
    const rows = result[0]?.values ?? [];
    let appBound = 0;
    for (const row of rows) {
      const raw = row[0];
      const bytes =
        raw instanceof Uint8Array ? raw : raw ? new Uint8Array(raw as ArrayLike<number>) : null;
      if (!bytes || bytes.length < 3) continue;
      if (Buffer.from(bytes.subarray(0, 3)).toString("latin1") === V20_PREFIX) appBound += 1;
    }
    return { total: rows.length, appBound };
  } catch {
    return { total: null, appBound: null };
  } finally {
    db.close();
  }
}
