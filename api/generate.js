const https = require('https');
const { kv } = require('@vercel/kv');

const BASE_SYSTEM_PROMPT = `Du er en kreativ assistent som genererer engasjerende sjekk-inn-spørsmål for daglige standup-møter i et profesjonelt team.

Generer ETT spørsmål. Roter mellom disse kategoriene i rekkefølge, og velg én tilfeldig underkategori:

KATEGORIER (velg én, veksle bredt):
- Fortid & minner: barndomsminner, pinlige øyeblikk, stolteste øyeblikk, ting du angrer på
- Mat & sanser: smaker, lukter, ritualer, restaurantopplevelser
- Reise & steder: drømmemål, verste reise, overraskende favorittsted
- Penger & prioriteringer: hva ville du brukt en uventet million på, hva er verdt å bruke mye på
- Teknologi & fremtid: hva gleder/skremmer deg ved fremtiden, hvilken teknologi savner du ikke
- Relasjoner & sosiale situasjoner: hvem ville du invitert til middag, hvem har lært deg mest
- Arbeid & kreativitet: drømmejobb, hva ville du gjort annerledes, hva er du uventet god på
- Natur & dyr: favorittårstid og hvorfor, hvilket dyr beskriver deg i dag
- Hverdagsliv & vaner: morgenrutiner, guilty pleasures, rare vaner
- Hypotetiske valg: vanskelige enten/eller-valg uten superkrefter

STRENGE FORBUD – aldri generer spørsmål om:
- Superkrefter eller magiske evner
- Hvilken kjendis du vil møte
- Øde øy med tre ting
- Tidsmaskinen (fortid/fremtid-reise)
- Zombie-apokalypse

Spørsmålet skal være:
- Kort (maks 1-2 setninger)
- Konkret og samtalevekkende – ikke abstrakt
- Passende for et profesjonelt miljø
- Ha et klart svar folk faktisk kan gi raskt

Svar KUN med selve spørsmålet – ingen forklaring, ingen prefiks, ingen hermetegn.`;

function buildSystemPrompt(recentQuestions) {
  if (!recentQuestions || recentQuestions.length === 0) return BASE_SYSTEM_PROMPT;
  const list = recentQuestions.slice(0, 20).map(q => `- ${q.question}`).join('\n');
  return `${BASE_SYSTEM_PROMPT}\n\nTidligere stilte spørsmål – unngå å gjenta disse temaene eller stille lignende spørsmål:\n${list}`;
}

async function getRecentQuestions() {
  try {
    return await kv.lrange('checkin:questions', 0, 19);
  } catch {
    return [];
  }
}

async function saveQuestion(question) {
  try {
    await kv.lpush('checkin:questions', {
      question,
      isoDate: new Date().toISOString().slice(0, 10),
      timestamp: Date.now(),
    });
    await kv.ltrim('checkin:questions', 0, 89);
  } catch {}
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY er ikke konfigurert på serveren.' });
    return;
  }

  const recentQuestions = await getRecentQuestions();
  const systemPrompt = buildSystemPrompt(recentQuestions);

  const body = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 150,
    system: systemPrompt,
    messages: [{ role: 'user', content: 'Generer ett spørsmål.' }]
  });

  try {
    const question = await callWithRetry(API_KEY, body);
    await saveQuestion(question);
    res.status(200).json({ question });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Noe gikk galt.' });
  }
};

async function callWithRetry(apiKey, body, attempts = 2) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await callAnthropic(apiKey, body);
    } catch (err) {
      const isOverloaded = err.code === 'overloaded';
      const isLastAttempt = i === attempts - 1;
      if (isOverloaded && !isLastAttempt) {
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }
      throw err;
    }
  }
}

function friendlyError(apiError) {
  switch (apiError.type) {
    case 'overloaded_error':
      return 'API-en er overbelastet akkurat nå – prøver igjen...';
    case 'authentication_error':
      return 'Ugyldig API-nøkkel. Sjekk ANTHROPIC_API_KEY i Vercel.';
    case 'rate_limit_error':
      return 'For mange forespørsler. Vent litt og prøv igjen.';
    default:
      return apiError.message || 'Noe gikk galt med API-kallet.';
  }
}

function callAnthropic(apiKey, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            const err = new Error(friendlyError(parsed.error));
            err.code = parsed.error.type;
            reject(err);
            return;
          }
          resolve(parsed.content[0].text.trim());
        } catch (e) {
          reject(new Error('Kunne ikke tolke API-svaret.'));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
