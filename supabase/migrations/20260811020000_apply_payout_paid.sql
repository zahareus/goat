-- Atomic "payout paid": ledger withdrawal + status flip in one transaction.
-- Callable by service role only.

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
  IF p.status <> 'processing' THEN
    RAISE EXCEPTION 'payout % is %, expected processing', p_payout_id, p.status;
  END IF;

  INSERT INTO prize_ledger (user_id, season, gw, type, stars, meta)
  VALUES (p.user_id, v_season, NULL, 'withdrawal', -p.stars,
          jsonb_build_object('payout_id', p_payout_id));

  UPDATE payouts
  SET status = 'paid', provider_response = p_provider, updated_at = NOW()
  WHERE id = p_payout_id;
END;
$$;

REVOKE ALL ON FUNCTION apply_payout_paid(UUID, JSONB) FROM PUBLIC, anon, authenticated;
