-- botTrading schema (Neon Postgres)
-- Run via: node backtest/db/migrate.mjs

-- Parameter-sweep results, so backtests survive across sessions/machines
-- instead of living only in a terminal scrollback.
CREATE TABLE IF NOT EXISTS sweep_results (
  id               SERIAL PRIMARY KEY,
  symbol           TEXT NOT NULL,
  days             INT NOT NULL,
  interval         TEXT NOT NULL,
  tp_usd           NUMERIC NOT NULL,
  sl_usd           NUMERIC NOT NULL,
  require_agree    INT NOT NULL,
  min_conf_base    INT NOT NULL,
  sample           TEXT NOT NULL,          -- 'in' | 'out' | 'full'
  total_trades     INT NOT NULL,
  wins             INT NOT NULL,
  win_rate         NUMERIC NOT NULL,
  total_pnl        NUMERIC NOT NULL,
  profit_factor    NUMERIC,
  max_drawdown_pct NUMERIC NOT NULL,
  sharpe_like      NUMERIC,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sweep_symbol ON sweep_results (symbol, sample);

-- Server-side trade log — the durable replacement for the bot_trades_v2
-- localStorage key, so history survives closing the browser.
CREATE TABLE IF NOT EXISTS trades (
  id               SERIAL PRIMARY KEY,
  symbol           TEXT NOT NULL,
  type             TEXT NOT NULL,          -- 'BUY' | 'SELL'
  entry_price      NUMERIC NOT NULL,
  exit_price       NUMERIC,
  pnl              NUMERIC,
  confidence       INT,
  patterns         JSONB DEFAULT '[]',
  reasons          JSONB DEFAULT '[]',
  close_reason     TEXT,                    -- 'TP' | 'SL' | 'TRAIL' | 'MANUAL'
  opened_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades (symbol, opened_at DESC);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS close_reason TEXT;

-- Rolling walk-forward folds: params are re-picked on a training window and
-- then judged ONLY on the immediately-following, never-seen block. This is
-- what actually tells you whether a config generalizes vs got lucky on one split.
CREATE TABLE IF NOT EXISTS walkforward_folds (
  id               SERIAL PRIMARY KEY,
  symbol           TEXT NOT NULL,
  days             INT NOT NULL,
  interval         TEXT NOT NULL,
  fold_idx         INT NOT NULL,
  chosen_tp        NUMERIC NOT NULL,
  chosen_sl        NUMERIC NOT NULL,
  chosen_agree     INT NOT NULL,
  chosen_conf      INT NOT NULL,
  train_trades     INT NOT NULL,
  train_pf         NUMERIC,
  test_trades      INT NOT NULL,
  test_win_rate    NUMERIC NOT NULL,
  test_pnl         NUMERIC NOT NULL,
  test_pf          NUMERIC,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wf_symbol ON walkforward_folds (symbol, fold_idx);

-- Currently OPEN positions — a live mirror, not history. A row exists here
-- exactly while the position is open (inserted when it opens, deleted when
-- it closes into `trades`). Without this, reloading the page or opening the
-- dashboard from another device loses track of what's actually open.
CREATE TABLE IF NOT EXISTS open_positions (
  client_id        TEXT PRIMARY KEY,        -- the position's client-generated id (pos.id)
  symbol           TEXT NOT NULL,
  type             TEXT NOT NULL,           -- 'BUY' | 'SELL'
  entry_price      NUMERIC NOT NULL,
  allocated_size   NUMERIC,
  multiplier       INT,
  confidence       INT,
  tp               NUMERIC,                -- this position's own TP in USD (scaledTpSl) —
  sl               NUMERIC,                -- NOT the active symbol's current tpTarget/slTarget
  opened_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS tp NUMERIC;
ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS sl NUMERIC;

-- Server-side bot config (TP/SL/stake/multiplier), the durable replacement
-- for the bot_tp_v2/bot_sl_v2/bot_stake/bot_mult localStorage keys.
CREATE TABLE IF NOT EXISTS bot_config (
  key              TEXT PRIMARY KEY,
  value            TEXT NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
