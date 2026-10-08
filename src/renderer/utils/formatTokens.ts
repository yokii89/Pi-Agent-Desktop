/** token 数展示：246.5K / 1.0M（AgentRunHeader / 上下文用量环共用）。 */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

/** 成本展示：全 0 / 未上报显示「—」（用量面板与热力图 tooltip 共用）。 */
export function formatCost(total: number): string {
  if (total <= 0) return "—";
  if (total < 0.01) return `$${total.toFixed(4)}`;
  if (total < 1000) return `$${total.toFixed(2)}`;
  return `$${Math.round(total)}`;
}
