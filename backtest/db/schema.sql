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
  close_reason     TEXT,                    -- 'TP' | 'TP+' | 'SL' | 'TRAIL' | 'MANUAL'
                                              -- 'TP+' = closed above the original validated
                                              -- target once extendedStopLevel() let it run further
  deriv_contract_id TEXT,                    -- set only for trades actually executed on Deriv —
                                              -- presence of this IS the sim-vs-real signal, no
                                              -- separate source/mode column needed
  commission       NUMERIC,                  -- real $ commission Deriv charged (from
                                              -- proposal_open_contract) — null for simulated trades
  allocated_size   NUMERIC,                  -- stake used for this trade
  multiplier       INT,                      -- leverage multiplier used — allocated_size×multiplier
                                              -- is the "volumen" (notional exposure) shown in the UI
  opened_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades (symbol, opened_at DESC);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS close_reason TEXT;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS deriv_contract_id TEXT;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS commission NUMERIC;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS allocated_size NUMERIC;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS multiplier INT;

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
  deriv_contract_id TEXT,                  -- set only when actually executed on Deriv (real money)
  commission       NUMERIC,                -- real $ commission Deriv charged, from the sync
  opened_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS tp NUMERIC;
ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS sl NUMERIC;
ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS deriv_contract_id TEXT;
ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS commission NUMERIC;
-- The Deriv-portfolio-sync effect (trading-bot-v3.jsx) decides a contract is
-- "new" by checking React's in-memory positions state — if that state was
-- momentarily incomplete (e.g. the tab had just reloaded and the DB-restore
-- fetch hadn't finished yet), it re-inserted an already-tracked contract
-- under a different client_id ("deriv-<contractId>"), creating a real
-- duplicate the app then double-counted as two open positions. Client-side
-- checks can't be trusted alone for something this consequential — this
-- index makes a second row for the same real contract impossible at the
-- database level regardless of any future client race condition.
CREATE UNIQUE INDEX IF NOT EXISTS idx_open_positions_deriv_contract
  ON open_positions (deriv_contract_id) WHERE deriv_contract_id IS NOT NULL;

-- Server-side bot config (TP/SL/stake/multiplier), the durable replacement
-- for the bot_tp_v2/bot_sl_v2/bot_stake/bot_mult localStorage keys.
CREATE TABLE IF NOT EXISTS bot_config (
  key              TEXT PRIMARY KEY,
  value            TEXT NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Live copy of SYMBOL_STRATEGY (src/lib/symbolStrategy.js), refreshed by
-- backtest/update-strategy.mjs on a schedule (see .github/workflows) so
-- tiers/TP/SL drift with the market instead of needing a manual code edit +
-- redeploy every time someone re-runs the walk-forward validation by hand.
-- The frontend's hardcoded SYMBOL_STRATEGY stays as the fallback when this
-- table is empty or unreachable.
CREATE TABLE IF NOT EXISTS symbol_strategy (
  symbol           TEXT PRIMARY KEY,
  tier             TEXT NOT NULL,           -- 'ROBUSTO' | 'MIXTO' | 'SIN-EDGE'
  tp               NUMERIC,                 -- effective values the app reads — NULL for SIN-EDGE
  sl               NUMERIC,
  min_conf         INT,
  profitable_folds INT,
  total_folds      INT,
  -- The walk-forward-validated ANCHOR, set only by update-strategy.mjs (the
  -- weekly market-data re-validation) — never touched by retrain-live.mjs.
  -- tp/sl/min_conf above are nudged off THIS baseline (bounded, see
  -- retrain-live.mjs), so a run that goes stale or wrong can never drift the
  -- effective values far from what was actually validated, and the weekly
  -- job resetting tp/sl/min_conf = wf_tp/wf_sl/wf_min_conf wipes any drift.
  wf_tp            NUMERIC,
  wf_sl            NUMERIC,
  wf_min_conf      INT,
  live_trades_used INT,                     -- sample size retrain-live.mjs last used, for transparency
  live_adjusted_at TIMESTAMPTZ,              -- NULL if retrain-live.mjs has never touched this symbol
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE symbol_strategy ADD COLUMN IF NOT EXISTS wf_tp NUMERIC;
ALTER TABLE symbol_strategy ADD COLUMN IF NOT EXISTS wf_sl NUMERIC;
ALTER TABLE symbol_strategy ADD COLUMN IF NOT EXISTS wf_min_conf INT;
ALTER TABLE symbol_strategy ADD COLUMN IF NOT EXISTS live_trades_used INT;
ALTER TABLE symbol_strategy ADD COLUMN IF NOT EXISTS live_adjusted_at TIMESTAMPTZ;
