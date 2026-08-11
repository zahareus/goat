-- Manager Profile shows stars earned per GW for any player, so signed-in
-- users may read accrual rows of others. Withdrawals/corrections stay own-only.
-- anon has no table grant, so nothing is exposed to the open web.
CREATE POLICY "Signed-in read accruals" ON prize_ledger
  FOR SELECT TO authenticated USING (type = 'accrual');
