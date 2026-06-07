const { kv } = require('@vercel/kv');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { question, reaction } = req.body || {};
  if (!question || !['up', 'down'].includes(reaction)) {
    res.status(400).json({ error: 'Invalid input' });
    return;
  }

  try {
    const key = reaction === 'up' ? 'checkin:reactions:up' : 'checkin:reactions:down';
    await kv.hincrby(key, question, 1);
    const [upvotes, downvotes] = await Promise.all([
      kv.hget('checkin:reactions:up', question),
      kv.hget('checkin:reactions:down', question),
    ]);
    res.status(200).json({ ok: true, upvotes: Number(upvotes) || 0, downvotes: Number(downvotes) || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
