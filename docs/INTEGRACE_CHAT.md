# 🔧 Integrace chatu do PokéTrade
## Návod na propojení chat.html s marketplace a ostatními stránkami

---

## 1. SQL Migrace
Spusť obsah souboru `sql/chat-schema.sql` v Supabase → SQL Editor → New Query

---

## 2. Úpravy v marketplace.html

### 2a. Přidej odkaz na chat do navigace (topbar)
Najdi v `<nav class="nav-lnks">` a přidej řádek:

```html
<a href="chat.html" style="position:relative">
  💬 Zprávy
  <span class="unread-badge-nav" id="navUnreadMarket" style="display:none;position:absolute;top:0;right:2px;min-width:16px;height:16px;border-radius:8px;background:#f87171;color:#fff;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;padding:0 4px">0</span>
</a>
```

### 2b. Změň tlačítko "Zpráva" v detailu na odkaz do chatu
Najdi:
```html
<button class="btn-detail-msg" onclick="togglePanel('msgPanel')">✉️ Zpráva</button>
```
Nahraď za:
```html
<button class="btn-detail-msg" onclick="openChat()">✉️ Napsat prodejci</button>
```

### 2c. Přidej funkci openChat() do `<script>`:
```javascript
function openChat() {
  if (!token) { alert('Přihlas se pro psaní zpráv.'); return; }
  if (!currentListing) return;
  const l = currentListing;
  const sellerId = l.user_id;
  const sellerName = encodeURIComponent(l.username || '');
  window.location.href = `chat.html?with=${sellerId}&username=${sellerName}&listing=${l.id}`;
}
```

---

## 3. Úpravy v profile.html

### 3a. Přidej odkaz na chat do navigace (topbar)
Stejně jako v bodě 2a přidej odkaz `💬 Zprávy` do `<nav>`.

### 3b. Změň tlačítko "Napsat zprávu" na profilu
Najdi tlačítko pro psaní zprávy na profilu a změň jeho onclick na:
```javascript
onclick="window.location.href='chat.html?with='+profileUserId+'&username='+encodeURIComponent(profileUsername)"
```

---

## 4. Úpravy v dashboard.html
Přidej odkaz na chat do navigace stejně jako v bodě 2a.

---

## 5. Úpravy v index.html, album.html, moje-album.html, compare.html
Přidej odkaz `💬 Zprávy` do navigace na všech stránkách.

---

## 6. Přijímání parametru ?open=LISTING_ID v marketplace.html
Chat posílá odkazy na nabídky ve formátu `marketplace.html?open=LISTING_ID`.
Přidej na konec init sekce v marketplace.html:
```javascript
// Auto-open listing from chat link
(function checkOpenParam() {
  const p = new URLSearchParams(location.search);
  const openId = p.get('open');
  if (openId) {
    // Wait for listings to load, then open
    const check = setInterval(() => {
      const listing = allListings.find(l => l.id === openId);
      if (listing) {
        clearInterval(check);
        showDetail(listing);
      }
    }, 200);
    setTimeout(() => clearInterval(check), 5000);
  }
})();
```

---

## Shrnutí architektury

```
┌─────────────────────────────────────────────────────────┐
│                     SUPABASE DB                         │
│  ┌──────────────┐  ┌───────────────┐  ┌─────────────┐  │
│  │ conversations │  │ chat_messages │  │  listings    │  │
│  │              │──│               │  │             │  │
│  │ user1_id     │  │ conversation  │  │ id          │  │
│  │ user2_id     │  │ sender_id     │  │ user_id     │  │
│  │ unread_user1 │  │ text          │  │ title       │  │
│  │ unread_user2 │  │ listing_refs  │  │ price_czk   │  │
│  │ last_message │  │ (JSONB array) │  │ ...         │  │
│  └──────────────┘  └───────────────┘  └─────────────┘  │
└─────────────────────────────────────────────────────────┘

┌─────────────────┐     ┌──────────────────┐
│ marketplace.html│────▶│    chat.html      │
│                 │     │                  │
│ "Napsat prodejci"    │ ?with=USER_ID    │
│ → navigace do   │     │ &listing=ID      │
│   chatu s param │     │                  │
│                 │◀────│ Klik na nabídku  │
│ ?open=LISTING_ID│     │ → zpět na detail │
└─────────────────┘     └──────────────────┘

┌─────────────────┐     ┌──────────────────┐
│  profile.html   │────▶│    chat.html      │
│                 │     │                  │
│ "Napsat zprávu" │     │ ?with=USER_ID    │
│ → navigace do   │     │                  │
│   chatu         │     │                  │
└─────────────────┘     └──────────────────┘
```

### Funkce chatu:
- **Konverzace 1:1** – každá konverzace je mezi dvěma uživateli
- **Připojení nabídek** – tlačítko 🃏 otevře picker s nabídkami z marketplace
- **Více nabídek najednou** – lze vybrat libovolný počet nabídek
- **Kliknutí na nabídku v chatu** – otevře marketplace detail
- **Kliknutí na profil** – otevře profil s hodnocením
- **Nepřečtené zprávy** – badge v navigaci + zvýraznění konverzací
- **Polling každých 5s** – automatická aktualizace zpráv
- **Responzivní design** – na mobilu se přepíná mezi seznamem a chatem
- **Optimistic UI** – zpráva se zobrazí okamžitě, pak se potvrdí ze serveru
