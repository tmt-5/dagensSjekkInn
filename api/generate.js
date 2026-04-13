const https = require('https');

const SYSTEM_PROMPT = `Du er en kreativ assistent som genererer engasjerende sjekk-inn-spørsmål for daglige standup-møter i et profesjonelt team.

Generer ETT spørsmål som er:
- Kort (maks 1-2 setninger)
- Kreativt og samtalevekkende
- Passende for et profesjonelt miljø
- Varierer mellom kategorier som: hypotetiske dilemmaer, filosofiske refleksjoner, morsomme scenarioer, mat/reise/livspreferanser, kreative "hva om"-scenarioer

Eksempler på stil og tone:
- "Hvis du kunne lagt til en ekstra '0' ett sted i livet ditt, hvor ville du lagt den?"
- "Hva er en morsom eller skummel ting som har skjedd deg på en reise?"
- "Hvis du måtte spist én rett resten av livet, hva ville det vært?"

Svar KUN med selve spørsmålet – ingen forklaring, ingen prefiks, ingen hermetegn rundt svaret.`;

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

  const body = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 150,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: 'Generer ett spørsmål.' }]
  });

  try {
    const question = await callWithRetry(API_KEY, body);
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
