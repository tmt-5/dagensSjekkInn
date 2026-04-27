const { kv } = require('@vercel/kv');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const questions = await kv.lrange('checkin:questions', 0, -1);
    res.status(200).json({ questions: questions || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
