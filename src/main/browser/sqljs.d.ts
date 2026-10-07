/** sql.js 最小类型声明（上游无官方 d.ts，主进程只用到 Database 子集）。 */
declare module "sql.js" {
  interface QueryExecResult {
    columns: string[];
    values: unknown[][];
  }

  interface Statement {
    run(values?: unknown[]): void;
    free(): void;
  }

  interface Database {
    exec(sql: string): QueryExecResult[];
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
  }

  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database;
  }

  interface SqlJsConfig {
    locateFile?: (file: string) => string;
  }

  export default function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>;
}
