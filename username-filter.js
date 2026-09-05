/* ══════════════════════════════════════════════════════════════
   username-filter.js — kontrola přezdívek při registraci
   ------------------------------------------------------------
   Použití:
     <script src="username-filter.js"></script>
     const v = UsernameFilter.check('nazev');
     if (!v.ok) showError(v.reason);

   Klientská kontrola je jen pro rychlou zpětnou vazbu.
   Skutečné vynucení dělá trigger v databázi (username_filter.sql) —
   bez něj se filtr obejde přímým voláním Supabase API.
══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  // ── Normalizace ────────────────────────────────────────────
  // Cílem je, aby "k0k0t", "k-o-k-o-t" i "KoKoT" spadly na "kokot".
  const LEET = {
    '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's',
    '6': 'g', '7': 't', '8': 'b', '9': 'g', '@': 'a', '$': 's',
  };

  function normalize(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // diakritika: č → c
      .replace(/[0-9@$]/g, ch => LEET[ch] || ch)
      .replace(/[^a-z]/g, '');                            // pryč _ . - mezery
  }

  // Zkolabuj opakovaná písmena: "koooot" → "kot". Chytá protahování.
  function collapse(s) {
    return s.replace(/(.)\1+/g, '$1');
  }

  // ── Seznamy ────────────────────────────────────────────────
  // BLOCKED_SUBSTRING: stačí, když se objeví kdekoli v přezdívce.
  // Drž tu jen výrazy, které jsou jednoznačné — čím kratší slovo,
  // tím větší riziko, že chytneš nevinnou přezdívku.
  const BLOCKED_SUBSTRING = [
    // CS
    'kokot', 'kurva', 'kurwa', 'piča', 'pica', 'picus', 'mrdat', 'mrdka',
    'čurák', 'curak', 'hovno', 'sračka', 'srac', 'debil', 'jebat', 'jebac',
    'vyjeban', 'zmrd', 'buzerant', 'buzna', 'prcat', 'šoustat', 'soustat',
    'cecky', 'kozy', 'penis', 'vagina', 'onanie', 'masturb',
    // EN
    'fuck', 'shit', 'bitch', 'cunt', 'dick', 'cock', 'pussy', 'whore',
    'slut', 'bastard', 'wanker', 'boobs', 'titties', 'blowjob', 'anal',
    'porn', 'rape', 'nazi', 'hitler',
    // rasistické / nenávistné
    'nigger', 'nigga', 'faggot', 'retard', 'cikan', 'cigan',
  ];

  // BLOCKED_EXACT: zakázané jen jako celá přezdívka. Sem patří krátká
  // slova, která jsou jinde nevinná ("gay", "sex" v "sexton" apod.).
  const BLOCKED_EXACT = [
    'sex', 'gay', 'ass', 'fag', 'jebo', 'chuj', 'kunda',
  ];

  // RESERVED: vydávání se za provoz aplikace nebo autoritu.
  // Blokované i s příponami: "admin1", "poketrade_support"…
  const RESERVED = [
    'admin', 'administrator', 'spravce', 'moderator', 'mod',
    'support', 'podpora', 'staff', 'system', 'root', 'official',
    'poketrade', 'poke-trade', 'pokemon', 'nintendo',
    'null', 'undefined', 'anonymous', 'deleted', 'me', 'api',
  ];

  // ── Kontrola ───────────────────────────────────────────────
  function check(raw) {
    const original = String(raw || '').trim();

    if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(original)) {
      return { ok: false, code: 'FORMAT',
        reason: 'Přezdívka smí obsahovat jen písmena, čísla, _ . - (3–30 znaků)' };
    }

    const n = normalize(original);
    const c = collapse(n);

    if (n.length < 2) {
      return { ok: false, code: 'FORMAT',
        reason: 'Přezdívka musí obsahovat aspoň dvě písmena' };
    }

    for (const w of BLOCKED_SUBSTRING) {
      const wn = normalize(w);
      if (n.includes(wn) || c.includes(collapse(wn))) {
        return { ok: false, code: 'PROFANITY',
          reason: 'Tuhle přezdívku použít nejde. Zvol prosím jinou.' };
      }
    }

    for (const w of BLOCKED_EXACT) {
      if (n === normalize(w)) {
        return { ok: false, code: 'PROFANITY',
          reason: 'Tuhle přezdívku použít nejde. Zvol prosím jinou.' };
      }
    }

    for (const w of RESERVED) {
      const wn = normalize(w);
      if (n === wn || n.startsWith(wn) || n.endsWith(wn)) {
        return { ok: false, code: 'RESERVED',
          reason: 'Tahle přezdívka je vyhrazená pro provoz aplikace.' };
      }
    }

    return { ok: true };
  }

  global.UsernameFilter = { check, normalize, BLOCKED_SUBSTRING, BLOCKED_EXACT, RESERVED };

})(typeof window !== 'undefined' ? window : globalThis);
