-- Prize economy phase 1: append-only star ledger + payout requests.
-- Writes go through service role only; players read their own rows.

CREATE TABLE prize_ledger (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  season     TEXT NOT NULL,             -- '2026-27'; GW numbers repeat every season
  gw         INTEGER,
  type       TEXT NOT NULL CHECK (type IN ('accrual', 'withdrawal', 'correction')),
  place      INTEGER,
  stars      INTEGER NOT NULL,          -- withdrawals are negative
  meta       JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX prize_ledger_one_accrual
  ON prize_ledger(season, gw, user_id) WHERE type = 'accrual';
CREATE INDEX prize_ledger_user ON prize_ledger(user_id);

CREATE TABLE payouts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- doubles as split.tg transfer_id
  user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  stars              INTEGER NOT NULL CHECK (stars >= 50),
  username_snapshot  TEXT NOT NULL,
  telegram_chat_id   BIGINT NOT NULL,   -- denormalized: audit survives profile deletion
  status             TEXT NOT NULL DEFAULT 'requested'
                     CHECK (status IN ('requested', 'processing', 'paid', 'rejected')),
  invoice_url        TEXT,
  invoice_expires_at TIMESTAMPTZ,
  provider_response  JSONB,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX payouts_one_active
  ON payouts(user_id) WHERE status IN ('requested', 'processing');
CREATE INDEX payouts_status ON payouts(status);

-- explicit finalization marker (covers GWs that produce zero accruals)
ALTER TABLE gw_config ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ;

ALTER TABLE prize_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE payouts      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own ledger" ON prize_ledger
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users read own payouts" ON payouts
  FOR SELECT USING (auth.uid() = user_id);
-- no INSERT/UPDATE/DELETE policies: client roles cannot write even with grants

-- without explicit grants PostgREST returns 401 for these tables
GRANT SELECT ON prize_ledger, payouts TO authenticated;
-- Supabase default privileges auto-grant to anon/authenticated on new tables —
-- strip them: anon gets nothing, authenticated is read-only.
REVOKE ALL ON prize_ledger, payouts FROM anon;
REVOKE INSERT, UPDATE, DELETE ON prize_ledger, payouts FROM authenticated;
