// api/payout-reconcile.js — settle processing payouts against split.tg
// POST /api/payout-reconcile?secret=GOAT_NOTIFY_SECRET  (n8n, hourly)
// Source of truth is the split.tg invoice/purchase state, not our DB:
// paid -> atomic ledger withdrawal via apply_payout_paid RPC + player ping;
// expired unpaid -> back to requested + admin alert.

const SUPABASE_URL = 'https://zanssnurnzdqwaxuadge.supabase.co';
const { split, tg, sbSelectAll, sbHeaders, env } = require('./_prizes.js');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const secret = req.query.secret;
  const validSecrets = [env('TELEGRAM_WEBHOOK_SECRET'), env('GOAT_NOTIFY_SECRET')].filter(Boolean);
  if (!secret || !validSecrets.includes(secret)) return res.status(403).json({ error: 'Forbidden' });

  try {
    const processing = await sbSelectAll('payouts', 'status=eq.processing&select=*');
    if (!processing.length) return res.status(200).json({ ok: true, processing: 0 });

    const invoices = await split('/user/invoices?limit=50');
    const items = (invoices && invoices.items) || [];

    const results = [];
    for (const p of processing) {
      const inv = matchInvoice(items, p);
      const status = inv && inv.payment ? inv.payment.status : null;

      if (status === 'paid' || (inv && inv.payment && inv.payment.buy_tx_hash)) {
        await rpc('apply_payout_paid', { p_payout_id: p.id, p_provider: inv });
        await tg('sendMessage', {
          chat_id: p.telegram_chat_id,
          text: `⭐ ${p.stars} stars are on their way to @${p.username_snapshot} — check Settings → My Stars in a minute!`,
        });
        results.push({ id: p.id, result: 'paid' });
      } else if (p.invoice_expires_at && new Date(p.invoice_expires_at) < new Date()) {
        await fetch(`${SUPABASE_URL}/rest/v1/payouts?id=eq.${p.id}`, {
          method: 'PATCH',
          headers: sbHeaders({ Prefer: 'return=minimal' }),
          body: JSON.stringify({ status: 'requested', invoice_url: null, invoice_expires_at: null, updated_at: new Date().toISOString() }),
        });
        const adminChat = env('GOAT_ADMIN_CHAT_ID') || '292048';
        await tg('sendMessage', {
          chat_id: adminChat,
          text: `⚠️ Інвойс для @${p.username_snapshot} (${p.stars} ⭐) протух неоплаченим — заявка повернута в чергу.`,
        });
        results.push({ id: p.id, result: 'expired' });
      } else {
        results.push({ id: p.id, result: 'waiting' });
      }
    }
    return res.status(200).json({ ok: true, processing: processing.length, results });
  } catch (err) {
    console.error('payout-reconcile error:', err);
    return res.status(500).json({ error: err.message });
  }
};

// Match a split.tg invoice to our payout: prefer explicit ids captured at
// confirm time, fall back to username+quantity created after the request.
function matchInvoice(items, payout) {
  const pr = payout.provider_response || {};
  const knownIds = [pr.id, pr.invoice && pr.invoice.id].filter(Boolean);
  let inv = items.find(i => knownIds.includes(i.id));
  if (inv) return inv;
  return items.find(i =>
    i.data && i.data.username === payout.username_snapshot &&
    i.data.quantity === payout.stars &&
    new Date(i.created_at) >= new Date(new Date(payout.created_at).getTime() - 60e3)
  ) || null;
}

async function rpc(fn, args) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: sbHeaders(),
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`rpc ${fn} ${r.status}: ${await r.text()}`);
}
