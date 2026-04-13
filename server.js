const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY;

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

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    const filePath = path.join(__dirname, 'index.html');
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/generate') {
    if (!API_KEY) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'ANTHROPIC_API_KEY er ikke satt på serveren.' }));
      return;
    }

    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 150,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: 'Generer ett spørsmål.' }]
    });

    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const apiReq = https.request(options, (apiRes) => {
      let data = '';
      apiRes.on('data', chunk => { data += chunk; });
      apiRes.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: parsed.error.message || 'API-feil' }));
            return;
          }
          const question = parsed.content[0].text.trim();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ question }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Kunne ikke tolke API-svaret.' }));
        }
      });
    });

    apiReq.on('error', (e) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    });

    apiReq.write(body);
    apiReq.end();
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n  ▶ Dagens Sjekk-inn kjører på http://localhost:${PORT}\n`);
  if (!API_KEY) {
    console.warn('  ⚠  ADVARSEL: ANTHROPIC_API_KEY er ikke satt!\n');
  }
});
