/* ── Google Sheet write endpoint (Apps Script Web App) ──
   Deploy a Google Apps Script Web App (Deploy ▸ New deployment ▸ Web app,
   "Execute as: me", "Who has access: Anyone") whose doPost(e) appends
   JSON.parse(e.postData.contents).question as a new row in the same sheet
   that SHEET_CSV_URL (in index.html) reads from. Set the /exec URL as the
   SHEET_SUBMIT_URL env var on Vercel. */

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const SHEET_SUBMIT_URL = process.env.SHEET_SUBMIT_URL;
  if (!SHEET_SUBMIT_URL) {
    res.status(500).json({ error: 'SHEET_SUBMIT_URL er ikke konfigurert på serveren.' });
    return;
  }

  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
  if (!question) {
    res.status(400).json({ error: 'Spørsmålet kan ikke være tomt.' });
    return;
  }
  if (question.length > 500) {
    res.status(400).json({ error: 'Spørsmålet er for langt (maks 500 tegn).' });
    return;
  }

  try {
    const sheetRes = await fetch(SHEET_SUBMIT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question })
    });
    if (!sheetRes.ok) throw new Error('Sheet responded with ' + sheetRes.status);
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Kunne ikke lagre spørsmålet i arket.' });
  }
};
