// Mirrors SYMBOL_STRATEGY in src/trading-bot-v3.jsx. Duplicated here because
// the frontend file can't be imported by a plain Node script — keep both in
// sync when you re-run backtest/walkforward.mjs and get new numbers.
export const SYMBOL_STRATEGY = {
  "ETH/USDT": { tier:"ROBUSTO", tp:8, sl:4, minConf:70 },
  "XAU/USD":  { tier:"ROBUSTO", tp:8, sl:4, minConf:70 },
  "USD/CAD":  { tier:"ROBUSTO", tp:6, sl:3, minConf:60 },
  "AUD/USD":  { tier:"ROBUSTO", tp:6, sl:6, minConf:70 },

  "BTC/USDT": { tier:"MIXTO",   tp:9, sl:3, minConf:80 },
  "EUR/USD":  { tier:"MIXTO",   tp:8, sl:4, minConf:80 },
  "GBP/USD":  { tier:"MIXTO",   tp:6, sl:3, minConf:80 },
  "USD/JPY":  { tier:"MIXTO",   tp:9, sl:3, minConf:80 },
  "NZD/USD":  { tier:"MIXTO",   tp:8, sl:4, minConf:80 },
  "USD/CHF":  { tier:"MIXTO",   tp:6, sl:3, minConf:80 },

  "SOL/USDT": { tier:"SIN-EDGE" },
  "EUR/GBP":  { tier:"SIN-EDGE" },
  "XAG/USD":  { tier:"SIN-EDGE" },
  "XTI/USD":  { tier:"SIN-EDGE" },
};

export const BACKTEST_STAKE = 10, BACKTEST_MULT = 100;

export function scaledTpSl(sym, stake, multiplier){
  const strat=SYMBOL_STRATEGY[sym];
  if(!strat?.tp||!strat?.sl||!stake||!multiplier) return null;
  const factor=(stake*multiplier)/(BACKTEST_STAKE*BACKTEST_MULT);
  return{
    tp:Math.max(0.001,+(strat.tp*factor).toFixed(4)),
    sl:Math.max(0.001,+(strat.sl*factor).toFixed(4)),
  };
}
