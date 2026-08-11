-- Payout hardening after implementation premortem:
-- 1) 'expired' status — stuck invoices go here for manual review, never back
--    to 'requested' (an already-paid invoice could be re-confirmed = double buy).
-- 2) explicit EXECUTE for service_role on the settle RPC (REVOKE-only left it
--    dependent on default privileges).
-- 3) settle RPC keeps the original buy response and appends settle info.

ALTER TABLE payouts DROP CONSTRAINT payouts_status_check;
ALTER TABLE payouts ADD CONSTRAINT payouts_status_check
  CHECK (status IN ('requested', 'processing', 'paid', 'rejected', 'expired'));

CREATE OR REPLACE FUNCTION apply_payout_paid(p_payout_id UUID, p_provider JSONB)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p RECORD;
  v_year INT;
  v_season TEXT;
BEGIN
  v_year := CASE WHEN EXTRACT(MONTH FROM NOW()) >= 7
            THEN EXTRACT(YEAR FROM NOW())::int
            ELSE EXTRACT(YEAR FROM NOW())::int - 1 END;
  v_season := v_year || '-' || lpad(((v_year + 1) % 100)::text, 2, '0');

  SELECT * INTO p FROM payouts WHERE id = p_payout_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payout % not found', p_payout_id; END IF;
  IF p.status = 'paid' THEN RETURN; END IF;  -- idempotent
  IF p.status NOT IN ('processing', 'expired') THEN
    RAISE EXCEPTION 'payout % is %, expected processing/expired', p_payout_id, p.status;
  END IF;

  INSERT INTO prize_ledger (user_id, season, gw, type, stars, meta)
  VALUES (p.user_id, v_season, NULL, 'withdrawal', -p.stars,
          jsonb_build_object('payout_id', p_payout_id));

  UPDATE payouts
  SET status = 'paid',
      provider_response = COALESCE(provider_response, '{}'::jsonb)
                          || jsonb_build_object('settled', p_provider),
      updated_at = NOW()
  WHERE id = p_payout_id;
END;
$$;

REVOKE ALL ON FUNCTION apply_payout_paid(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION apply_payout_paid(UUID, JSONB) TO service_role;

-- 'expired' still reserves the player's balance and still blocks a new request
-- until the admin resolves it (Paid ✓ or Reject) — the invoice may be paid.
DROP INDEX payouts_one_active;
CREATE UNIQUE INDEX payouts_one_active
  ON payouts(user_id) WHERE status IN ('requested', 'processing', 'expired');
