export function computeMetrics(trades, { initialBalance = 10000 } = {}) {
  if (trades.length === 0) {
    return {
      total: 0, wins: 0, losses: 0, winRate: 0, totalPnl: 0, profitFactor: null,
      maxDrawdown: 0, maxDrawdownPct: 0, sharpeLike: null, avgWin: 0, avgLoss: 0,
      byDirection: { BUY: { t: 0, w: 0 }, SELL: { t: 0, w: 0 } },
      byExitReason: {}, equityCurve: [initialBalance],
    };
  }

  let equity = initialBalance;
  let peak = initialBalance, maxDD = 0, maxDDPct = 0;
  const equityCurve = [equity];
  let grossWin = 0, grossLoss = 0, wins = 0, losses = 0;
  const byDirection = { BUY: { t: 0, w: 0 }, SELL: { t: 0, w: 0 } };
  const byExitReason = {};
  const returns = [];

  for (const t of trades) {
    equity += t.pnl;
    equityCurve.push(equity);
    peak = Math.max(peak, equity);
    const dd = peak - equity;
    const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
    maxDD = Math.max(maxDD, dd);
    maxDDPct = Math.max(maxDDPct, ddPct);

    if (t.pnl > 0) { wins++; grossWin += t.pnl; } else { losses++; grossLoss += Math.abs(t.pnl); }
    byDirection[t.type].t++;
    if (t.pnl > 0) byDirection[t.type].w++;
    byExitReason[t.reason] = (byExitReason[t.reason] || 0) + 1;
    returns.push(t.pnl);
  }

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  const std = Math.sqrt(variance);
  const sharpeLike = std > 0 ? (mean / std) * Math.sqrt(returns.length) : null;

  return {
    total: trades.length, wins, losses,
    winRate: Math.round((wins / trades.length) * 1000) / 10,
    totalPnl: Math.round((grossWin - grossLoss) * 100) / 100,
    profitFactor: grossLoss > 0 ? Math.round((grossWin / grossLoss) * 100) / 100 : null,
    maxDrawdown: Math.round(maxDD * 100) / 100,
    maxDrawdownPct: Math.round(maxDDPct * 100) / 100,
    sharpeLike: sharpeLike != null ? Math.round(sharpeLike * 100) / 100 : null,
    avgWin: wins ? Math.round((grossWin / wins) * 100) / 100 : 0,
    avgLoss: losses ? Math.round((grossLoss / losses) * 100) / 100 : 0,
    byDirection, byExitReason, equityCurve,
  };
}
