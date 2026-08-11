// api/payout-reconcile.js — watchdog for processing payouts
// POST /api/payout-reconcile?secret=GOAT_NOTIFY_SECRET  (n8n, hourly)
//
// Settlement is ADMIN-ONLY (payout-paid action): split.tg /user/invoices keeps
// xrocket invoices as status=pending even after real payment and delivery
// (verified live 11.08.2026), so there is no machine-readable payment truth.
// This job only flags stale invoices: expired processing -> status 'expired'
// + admin alert for manual review. Never back to 'requested' — the invoice
// may have been paid already, and a re-confirm would buy stars twice.

const SUPABASE_URL = 'https://zanssnurnzdqwaxuadge.supabase.co';
const { tg, sbSelectAll, sbHeaders, env } = require('./_prizes.js');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const secret = req.query.secret;
  const validSecrets = [env('TELEGRAM_WEBHOOK_SECRET'), env('GOAT_NOTIFY_SECRET')].filter(Boolean);
  if (!secret || !validSecrets.includes(secret)) return res.status(403).json({ error: 'Forbidden' });

  try {
    const processing = await sbSelectAll('payouts', 'status=eq.processing&select=*');
    const results = [];
    const adminChat = env('GOAT_ADMIN_CHAT_ID') || '292048';

    for (const p of processing) {
      try {
        if (p.invoice_expires_at && new Date(p.invoice_expires_at) < new Date()) {
          await fetch(`${SUPABASE_URL}/rest/v1/payouts?id=eq.${p.id}&status=eq.processing`, {
            method: 'PATCH',
            headers: sbHeaders({ Prefer: 'return=minimal' }),
            body: JSON.stringify({ status: 'expired', updated_at: new Date().toISOString() }),
          });
          await tg('sendMessage', {
            chat_id: adminChat,
            parse_mode: 'HTML',
            text: `⚠️ Інвойс для @${p.username_snapshot} (${p.stars} ⭐) прострочений.\nЯкщо ти його ОПЛАТИВ — натисни Paid ✓ в адмінці (спише баланс). Якщо НІ — Reject поверне зірки гравцю.\nID: <code>${p.id}</code>`,
          });
          results.push({ id: p.id, result: 'expired' });
        } else {
          results.push({ id: p.id, result: 'waiting' });
        }
      } catch (e) {
        console.error('reconcile item failed', p.id, e);
        results.push({ id: p.id, result: 'error', error: e.message });
      }
    }
    return res.status(200).json({ ok: true, processing: processing.length, results });
  } catch (err) {
    console.error('payout-reconcile error:', err);
    return res.status(500).json({ error: err.message });
  }
};
