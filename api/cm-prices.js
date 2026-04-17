// /api/cm-prices.js
// Načte ceny z konkrétní stránky karty na Cardmarket
// Parametry: ?url=https://cardmarket.com/en/Pokemon/Products/Singles/...
//        nebo ?name=Charmander&set=Phantasmal+Flames&number=011

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = process.env.CM_SESSION;
  if (!session) {
    return res.status(500).json({ error: 'CM_SESSION není nastavena' });
  }

  // Zjisti cílovou URL
  let cardUrl = req.query.url || '';

  // Pokud není přímá URL, sestav ji z name+set+number
  if (!cardUrl) {
    const { name, set, number } = req.query;
    if (!name) return res.status(400).json({ error: 'Chybí parametr url nebo name' });

    // Cardmarket slug: mezery -> pomlčky, diakritika pryč
    const slug = (s) => (s || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const setSlug  = slug(set);
    const nameSlug = slug(name);
    const numPart  = number ? `-${number.replace(/\//g, '')}` : '';

    cardUrl = `https://www.cardmarket.com/en/Pokemon/Products/Singles/${setSlug}/${nameSlug}${numPart}`;
  }

  // Normalizuj URL
  if (!cardUrl.startsWith('http')) cardUrl = 'https://www.cardmarket.com' + cardUrl;

  try {
    const response = await fetch(cardUrl, {
      headers: {
        'Cookie': `PHPSESSID=${session}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'cs-CZ,cs;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://www.cardmarket.com/en/Pokemon',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Cache-Control': 'max-age=0',
        'Connection': 'keep-alive',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      return res.status(502).json({
        error: `Cardmarket vrátil ${response.status}`,
        url: cardUrl,
        hint: response.status === 403
          ? 'Bot ochrana aktivní — zkus znovu za chvíli nebo obnov session'
          : 'Zkontroluj URL karty',
      });
    }

    const html = await response.text();

    // ── Extrakce cen z HTML ──────────────────────────────────────

    // 1. JSON-LD structured data — nejspolehlivější
    const jsonLdMatch = html.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
    let fromJsonLd = {};
    if (jsonLdMatch) {
      try {
        const ld = JSON.parse(jsonLdMatch[1]);
        if (ld.offers) {
          fromJsonLd.fromPrice = parseFloat(ld.offers.lowPrice || ld.offers.price || 0);
        }
      } catch(_) {}
    }

    // 2. Trend price
    let trendPrice = 0;
    const trendMatch = html.match(/data-trend="([\d.,]+)"/i)
      || html.match(/id="trend"[^>]*>[^<]*([\d,]+\.\d+)/i)
      || html.match(/Trend[^€<]{0,60}([\d]+[,.][\d]+)\s*€/i);
    if (trendMatch) {
      trendPrice = parseFloat(trendMatch[1].replace(',', '.').replace(/\s/g, '')) || 0;
    }

    // 3. From price (nejnižší dostupná)
    let fromPrice = fromJsonLd.fromPrice || 0;
    if (!fromPrice) {
      const fromMatch = html.match(/data-price="([\d.,]+)"/i)
        || html.match(/(?:From|Von|Da|Od)\s*<[^>]*>([\d,.]+)/i);
      if (fromMatch) fromPrice = parseFloat(fromMatch[1].replace(',', '.')) || 0;
    }

    // 4. 30-day average
    let avg30 = 0;
    const avgMatch = html.match(/data-avg30="([\d.,]+)"/i)
      || html.match(/avg30[^>]*>([\d,.]+)/i);
    if (avgMatch) avg30 = parseFloat(avgMatch[1].replace(',', '.')) || 0;

    // 5. Meta price fallback
    if (!trendPrice && !fromPrice) {
      const metaPrice = html.match(/<meta[^>]+itemprop="price"[^>]+content="([\d.]+)"/i);
      if (metaPrice) fromPrice = parseFloat(metaPrice[1]) || 0;
    }

    const result = {
      trendPrice,
      fromPrice,
      avgPrice: avg30,
      url: cardUrl,
      source: 'cardmarket-scrape',
      found: trendPrice > 0 || fromPrice > 0,
    };

    // Debug: pokud ceny nenalezeny, vrať fragment HTML pro diagnostiku
    if (!result.found) {
      const priceIdx = html.toLowerCase().indexOf('price');
      result._debug = priceIdx >= 0
        ? html.substring(Math.max(0, priceIdx - 100), priceIdx + 600)
            .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        : html.substring(0, 800).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    res.setHeader('Cache-Control', 's-maxage=14400, stale-while-revalidate');
    return res.status(200).json(result);

  } catch (err) {
    return res.status(500).json({ error: err.message, url: cardUrl });
  }
}
