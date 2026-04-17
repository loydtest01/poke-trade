// /api/cm-prices.js
// Stáhne Price Guide CSV z Cardmarketu a vrátí ceny pro konkrétní kartu

export default async function handler(req, res) {
  // CORS hlavičky pro volání z frontendu
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { name, set } = req.query;
  if (!name) {
    return res.status(400).json({ error: 'Chybí parametr name' });
  }

  const session = process.env.CM_SESSION;
  if (!session) {
    return res.status(500).json({ error: 'CM_SESSION není nastavena' });
  }

  try {
    // Stáhnout Price Guide CSV pro Pokémon
    const csvUrl = 'https://www.cardmarket.com/en/Pokemon/Data/Price-Guide';
    const response = await fetch(csvUrl, {
      headers: {
        'Cookie': `PHPSESSID=${session}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'cs-CZ,cs;q=0.9,en;q=0.8',
        'Referer': 'https://www.cardmarket.com/en/Pokemon',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      return res.status(502).json({ 
        error: `Cardmarket vrátil ${response.status}`,
        hint: 'Zkus obnovit CM_SESSION cookie' 
      });
    }

    const csvText = await response.text();

    // Pokud vrátil HTML místo CSV (session expirovala), hlásit chybu
    if (csvText.trim().startsWith('<')) {
      return res.status(401).json({ 
        error: 'Session expirovala — obnov CM_SESSION v Vercelu',
        hint: 'DevTools → Application → Cookies → PHPSESSID'
      });
    }

    // Parsovat CSV
    const lines = csvText.split('\n');
    const headers = lines[0].split(';').map(h => h.replace(/"/g, '').trim());

    // Relevantní sloupce (Cardmarket CSV má: Name, Expansion, Nr, Rarity, Price, TrendPrice, AvgSellPrice...)
    const nameIdx    = headers.findIndex(h => h === 'Name');
    const setIdx     = headers.findIndex(h => h === 'Expansion' || h === 'Set');
    const trendIdx   = headers.findIndex(h => h === 'TrendPrice' || h === 'Trend Price');
    const fromIdx    = headers.findIndex(h => h === 'Price' || h === 'Low Price');
    const avgIdx     = headers.findIndex(h => h === 'AvgSellPrice' || h === 'Avg. Sell Price');

    // Hledat shodu — normalizovat jméno pro porovnání
    const normalize = (s) => (s || '').toLowerCase()
      .replace(/[^a-z0-9]/g, '');

    const searchName = normalize(name);
    const searchSet  = set ? normalize(set) : null;

    let bestMatch = null;

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(';').map(c => c.replace(/"/g, '').trim());
      if (cols.length < 3) continue;

      const cardName = normalize(cols[nameIdx] || '');
      const cardSet  = normalize(cols[setIdx]  || '');

      const nameMatch = cardName.includes(searchName) || searchName.includes(cardName);
      const setMatch  = !searchSet || cardSet.includes(searchSet) || searchSet.includes(cardSet);

      if (nameMatch && setMatch) {
        const trendPrice = parseFloat((cols[trendIdx] || '0').replace(',', '.')) || 0;
        const fromPrice  = parseFloat((cols[fromIdx]  || '0').replace(',', '.')) || 0;
        const avgPrice   = parseFloat((cols[avgIdx]   || '0').replace(',', '.')) || 0;

        bestMatch = {
          name:       cols[nameIdx],
          set:        cols[setIdx],
          trendPrice,
          fromPrice,
          avgPrice,
          source:     'cardmarket-csv',
        };
        break; // první shoda stačí
      }
    }

    if (!bestMatch) {
      return res.status(404).json({ 
        error: 'Karta nenalezena v Price Guide',
        searched: { name, set }
      });
    }

    // Cache na 6 hodin (CSV se nemění každou minutu)
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate');
    return res.status(200).json(bestMatch);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
