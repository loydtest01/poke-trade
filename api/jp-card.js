/**
 * api/jp-card.js  –  Vercel Serverless Function
 *
 * Proxy pro japonský Pokémon karet web (pokemon-card.com).
 * Obchází CORS a vrací:
 *   - mode=image  → přímo JPEG obrázek karty
 *   - mode=data   → JSON s názvem, HP, typy, set, číslem, URL obrázku
 *
 * Příklady:
 *   /api/jp-card?set=S8&num=016&mode=image
 *   /api/jp-card?set=S8&num=016&mode=data
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Mapování ZH kódů setů → JP kódy setů pro případy, kde pouhé odstranění "F" dá špatný výsledek.
// ZH "F" sety jsou čínské bundle vydání, která neodpovídají vždy stejnojmennému JP setu.
// Příklad: ZH S8F (Fusion Strike bundle) → JP S8b (VMAX Climax), NIKOLI S8 (Fusion Arts).
const ZH_TO_JP_SET = {
  'S8F': 'S8b',   // ZH Fusion Strike bundle → JP VMAX Climax
  // Další výjimky přidávej sem ve formátu 'ZH_KÓD_UPPERCASE': 'jp-kód'
};

/**
 * Převede ZH/EN kód setu na JP kód pro pokemon-card.com.
 * Zachovává malá/velká písmena (S8a zůstane S8a, ne S8A).
 * Pořadí: 1) přesná shodu v lookup tabulce, 2) odstraň koncové F/f.
 */
function resolveJpSet(raw) {
  const key = raw.toUpperCase();
  if (ZH_TO_JP_SET[key]) return ZH_TO_JP_SET[key];
  // Fallback: odstraň pouze koncové F (zachovej case zbytku: S8aF → S8a, S6a → S6a)
  return raw.replace(/[Ff]$/, '');
}

// Japonské názvy typů → anglické
const TYPE_MAP = {
  '炎': 'Fire', '水': 'Water', '草': 'Grass', '雷': 'Lightning',
  '超': 'Psychic', '闘': 'Fighting', '悪': 'Darkness', '鋼': 'Metal',
  'ドラゴン': 'Dragon', '無色': 'Colorless', 'フェアリー': 'Fairy',
};

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }

  const { set, num, mode = 'image' } = req.query;
  if (!set || !num) {
    res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Chybí parametry set a num' }));
  }

  // Normalizuj ZH/EN kód setu → JP kód; paduj číslo na 3 cifry
  // BUG FIXES: (1) toUpperCase() rozbíjel S6a→S6A; (2) pouhé odstranění F dávalo S8F→S8 místo S8b;
  //            (3) druhý replace byl no-op (nahrazoval znak sebou samým).
  const jpSet  = resolveJpSet(set);
  const padded = String(parseInt(num, 10)).padStart(3, '0');

  // ── OBRÁZEK ─────────────────────────────────────────────────────────────
  if (mode === 'image') {
    // Zkus obě varianty URL (pokemon-card.com vs CDN)
    const urls = [
      `https://www.pokemon-card.com/assets/images/card_images/large/${jpSet}/img_card_${jpSet}_${padded}_1.jpg`,
      `https://www.pokemon-card.com/assets/images/card_images/large/${jpSet}/img_card_${jpSet}_${padded}_2.jpg`,
    ];

    for (const url of urls) {
      try {
        const upstream = await fetch(url, {
          headers: { 'Referer': 'https://www.pokemon-card.com/' },
        });
        if (!upstream.ok) continue;

        const buffer = Buffer.from(await upstream.arrayBuffer());
        res.writeHead(200, {
          ...CORS,
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=604800, immutable', // 7 dní
          'Content-Length': buffer.length,
        });
        return res.end(buffer);
      } catch (_) { /* zkus další */ }
    }

    res.writeHead(404, { ...CORS, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: `Karta nenalezena: ${jpSet} ${padded}` }));
  }

  // ── DATA (JSON) ──────────────────────────────────────────────────────────
  if (mode === 'data') {
    try {
      // Volej detail stránku kartičky
      const detailUrl = `https://www.pokemon-card.com/card-search/details.php/card/${jpSet}-${parseInt(num, 10)}`;
      const pageRes   = await fetch(detailUrl, {
        headers: {
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'ja,en;q=0.9',
          'User-Agent': 'Mozilla/5.0 (compatible; PokeTrade/1.0)',
          'Referer': 'https://www.pokemon-card.com/',
        },
      });

      if (!pageRes.ok) throw new Error(`HTTP ${pageRes.status}`);
      const html = await pageRes.text();

      // ── Parse HTML ──────────────────────────────────────────────────────
      const get = (re) => { const m = html.match(re); return m ? m[1].trim() : ''; };

      // JP název
      const nameJP = get(/<h1[^>]*class="[^"]*card-name[^"]*"[^>]*>([\s\S]*?)<\/h1>/i)
        .replace(/<[^>]+>/g, '').trim()
        || get(/class="name"[^>]*>([\s\S]*?)<\/[^>]+>/i).replace(/<[^>]+>/g, '').trim();

      // HP
      const hp = get(/class="hp"[^>]*>HP\s*<span[^>]*>([\d]+)<\/span>/i)
        || get(/<span[^>]*class="[^"]*hp[^"]*"[^>]*>([\d]+)<\/span>/i);

      // Typ (ikona)
      const typeMatch = html.match(/alt="([炎水草雷超闘悪鋼ドラゴン無色フェアリー]+?)(?:タイプ)?"/);
      const typeJP    = typeMatch ? typeMatch[1] : '';
      const typeEN    = TYPE_MAP[typeJP] || typeJP;

      // Série
      const series = get(/class="[^"]*expansion[^"]*"[^>]*>([\s\S]*?)<\/[^a-z]/i)
        .replace(/<[^>]+>/g, '').trim();

      // Číslo v setu
      const cardNum = get(/class="[^"]*number[^"]*"[^>]*>([\d/]+)<\/[^>]+>/i);

      // Obrázek
      const imgMatch = html.match(/id="illust-image"[^>]*src="([^"]+)"/i)
        || html.match(/class="[^"]*card-image[^"]*"[^>]*src="([^"]+)"/i);
      const imgUrl = imgMatch
        ? (imgMatch[1].startsWith('http') ? imgMatch[1] : 'https://www.pokemon-card.com' + imgMatch[1])
        : `https://www.pokemon-card.com/assets/images/card_images/large/${jpSet}/img_card_${jpSet}_${padded}_1.jpg`;

      // Proxy URL přes náš endpoint (pro frontned bez CORS)
      const proxyImg = `/api/jp-card?set=${jpSet}&num=${padded}&mode=image`;

      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' });
      return res.end(JSON.stringify({
        nameJP,
        hp,
        typeEN,
        typeJP,
        series,
        number: cardNum || padded,
        set: jpSet,
        imageUrl: proxyImg,       // použij přes náš proxy
        imageUrlDirect: imgUrl,   // přímá URL (pro server-side použití)
      }));

    } catch (err) {
      res.writeHead(500, { ...CORS, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Neznámý mode. Použij mode=image nebo mode=data' }));
}
