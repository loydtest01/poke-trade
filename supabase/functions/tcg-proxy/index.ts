/**
 * supabase/functions/tcg-proxy/index.ts
 *
 * Proxy pro api.pokemontcg.io – klíč uložen jako Supabase Secret.
 *
 * Deploy:
 *   supabase functions deploy tcg-proxy
 *
 * Secret:
 *   supabase secrets set POKEMONTCG_API_KEY=tvůj-klíč
 *
 * Volání z frontendu (přes tcgFetch helper v app.js):
 *   /functions/v1/tcg-proxy?q=name:"Pikachu"&pageSize=20
 *   /functions/v1/tcg-proxy?id=swsh12pt5-4
 *   /functions/v1/tcg-proxy?path=sets&orderBy=-releaseDate&pageSize=250
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  try {
    const { searchParams } = new URL(req.url);
    const id       = searchParams.get('id');
    const endpoint = searchParams.get('path') || 'cards';

    // Odstraníme naše interní parametry, zbytek předáme pokemontcg.io
    searchParams.delete('id');
    searchParams.delete('path');

    let tcgUrl: string;
    if (id) {
      tcgUrl = `https://api.pokemontcg.io/v2/cards/${encodeURIComponent(id)}`;
    } else {
      const qs = searchParams.toString();
      tcgUrl = `https://api.pokemontcg.io/v2/${endpoint}${qs ? '?' + qs : ''}`;
    }

    const apiKey = Deno.env.get('POKEMONTCG_API_KEY');
    const headers: Record<string, string> = {
      'User-Agent': 'PokeTrade-Proxy/1.0',
    };
    if (apiKey) headers['X-Api-Key'] = apiKey;

    const upstream = await fetch(tcgUrl, { headers });
    const data = await upstream.json();

    return new Response(JSON.stringify(data), {
      status: upstream.status,
      headers: {
        ...CORS,
        'Content-Type': 'application/json',
        'Cache-Control': 's-maxage=300',
      },
    });

  } catch (err) {
    return new Response(
      JSON.stringify({ error: true, message: 'TCG proxy chyba: ' + (err as Error).message }),
      { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }
});
