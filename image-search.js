/**
 * image-search.js – Vyhledávání Pokémon karet podle fotografie
 * ============================================================
 * Používá Groq Vision (Llama 4 Scout) k rozpoznání karty z obrázku,
 * pak zavolá PkSearch.search() z card-search.js.
 *
 * POUŽITÍ:
 *   <script src="card-search.js"></script>
 *   <script src="image-search.js"></script>
 *
 *   // Otevřít modál s výběrem foto:
 *   ImageSearch.open({ onResult: (cards) => console.log(cards) });
 *
 *   // Nebo přímo analyzovat obrázek (File nebo dataURL):
 *   const cards = await ImageSearch.searchByImage(fileOrDataUrl);
 * ============================================================
 */

(function (global) {
  'use strict';

  const GROQ_PROXY = '/api/groq';
  const GROQ_MODEL = 'qwen/qwen3.6-27b';

  // ── Prompt pro AI rozpoznávání karty ──────────────────────────────────────
  const RECOGNIZE_PROMPT = `Jsi expert na Pokémon karty. Analyzuj tento obrázek Pokémon karty a vrať JSON.

Povinná pole:
- "name": anglický název Pokémona (nebo trénera/energii), přesně jak je na kartě (en)
- "number": číslo karty (jen číslo před lomítkem, např. "025" nebo "SV001")
- "set": kód série (PTCGO kód nebo ID série, např. "PAL", "OBF", "sv3pt5", "mcd24")
- "lang": jazyk karty ("EN", "JP", "DE", "FR", "IT", "ES", "PT", "KO")

Volitelná pole:
- "hp": hodnota HP (číslo jako string, např. "120")
- "rarity": vzácnost (Common, Uncommon, Rare, etc.)
- "confidence": tvá jistota 0.0–1.0

Pokud něco nedokážeš přečíst, nastav null.
Odpověz POUZE validním JSON objektem, bez markdown bloků.`;

  // ── Převod File/Blob/URL na base64 ───────────────────────────────────────
  async function _toBase64(source) {
    if (typeof source === 'string') {
      // Už je dataURL
      if (source.startsWith('data:')) {
        const m = source.match(/^data:(image\/[a-z+]+);base64,(.+)$/);
        return m ? { base64: m[2], mimeType: m[1] } : null;
      }
      // HTTP URL – stáhni
      const resp = await fetch(source);
      const blob = await resp.blob();
      return _blobToBase64(blob);
    }
    if (source instanceof Blob || source instanceof File) {
      return _blobToBase64(source);
    }
    return null;
  }

  function _blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        const m = dataUrl.match(/^data:(image\/[a-z+]+);base64,(.+)$/);
        resolve(m ? { base64: m[2], mimeType: m[1] } : null);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // ── Komprese obrázku před odesláním (max 1280px) ─────────────────────────
  function _resizeImage(file, maxPx = 1280) {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => resolve(blob || file), 'image/jpeg', 0.85);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  // ── Volání Groq Vision API ────────────────────────────────────────────────
  async function _callGroqVision(base64, mimeType) {
    const token = localStorage.getItem('sb_token') || '';
    const groqKey = localStorage.getItem('groq_key') || localStorage.getItem('pkGroqKey') || '';

    const headers = { 'Content-Type': 'application/json' };
    if (token)   headers['Authorization'] = 'Bearer ' + token;
    if (groqKey) headers['X-Groq-Key']    = groqKey;

    const resp = await fetch(GROQ_PROXY, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        usage_type: 'search',
        model: GROQ_MODEL,
        max_tokens: 400,
        temperature: 0.1,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
            { type: 'text', text: RECOGNIZE_PROMPT }
          ]
        }]
      })
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      if (resp.status === 401) throw new Error('Neplatný Groq klíč nebo session');
      if (resp.status === 429) throw new Error('Groq rate limit – počkej chvíli nebo zadej vlastní klíč');
      throw new Error('Groq chyba: ' + (err?.error || resp.status));
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || '';
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('AI nevrátilo validní JSON');
    return JSON.parse(match[0]);
  }

  // ── Hlavní veřejná funkce ─────────────────────────────────────────────────

  /**
   * Rozpozná kartu z obrázku a vrátí pole výsledků z PkSearch.
   *
   * @param {File|Blob|string} imageSource – File objekt, Blob nebo dataURL/URL
   * @param {function}         [onStatus]  – Callback pro stavové hlášky
   * @returns {Promise<{ cards: Array, recognized: object }>}
   */
  async function searchByImage(imageSource, onStatus = null) {
    const status = msg => { if (onStatus) onStatus(msg); };

    status('🖼️ Připravuji obrázek…');

    // Komprimuj pokud je to File
    let source = imageSource;
    if (imageSource instanceof File) {
      source = await _resizeImage(imageSource);
    }

    const imgData = await _toBase64(source);
    if (!imgData) throw new Error('Nepodařilo se zpracovat obrázek');

    status('🤖 AI rozpoznává kartu…');
    const recognized = await _callGroqVision(imgData.base64, imgData.mimeType);

    console.log('[ImageSearch] Rozpoznáno:', recognized);

    if (!recognized?.name) {
      throw new Error('AI nedokázalo rozpoznat kartu. Zkus lépe osvětlený nebo rovnější záběr.');
    }

    status(`🔍 Hledám: ${recognized.name}…`);

    if (typeof PkSearch === 'undefined') {
      throw new Error('card-search.js není načteno – přidej <script src="card-search.js"> před image-search.js');
    }

    const cards = await PkSearch.search(recognized.name, {
      set:      recognized.set    || '',
      number:   recognized.number || '',
      lang:     recognized.lang   || 'EN',
      hp:       recognized.hp     || null,
      onStatus: status,
    });

    return { cards, recognized };
  }

  // ── Modální okno UI ───────────────────────────────────────────────────────

  const MODAL_CSS = `
    #imgSearchOverlay {
      position: fixed; inset: 0; z-index: 9999;
      background: rgba(0,0,0,0.75); backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center;
      animation: imgsFadeIn 0.2s ease;
    }
    @keyframes imgsFadeIn { from { opacity:0 } to { opacity:1 } }
    #imgSearchModal {
      background: #1a1a2e; border: 1px solid #f5c842;
      border-radius: 16px; padding: 28px 24px; width: 92%; max-width: 420px;
      color: #fff; font-family: inherit; box-shadow: 0 20px 60px rgba(0,0,0,0.6);
    }
    #imgSearchModal h3 {
      margin: 0 0 6px; font-size: 18px; color: #f5c842;
      display: flex; align-items: center; gap: 8px;
    }
    #imgSearchModal p { margin: 0 0 20px; font-size: 13px; color: #aaa; }
    .imgs-drop-zone {
      border: 2px dashed #444; border-radius: 12px;
      padding: 32px 16px; text-align: center; cursor: pointer;
      transition: border-color 0.2s, background 0.2s;
      background: rgba(255,255,255,0.03);
    }
    .imgs-drop-zone:hover, .imgs-drop-zone.drag-over {
      border-color: #f5c842; background: rgba(245,200,66,0.07);
    }
    .imgs-drop-zone .imgs-icon { font-size: 40px; margin-bottom: 10px; }
    .imgs-drop-zone .imgs-hint { font-size: 13px; color: #888; margin-top: 6px; }
    .imgs-drop-zone strong { font-size: 15px; color: #ddd; }
    #imgSearchFileInput { display: none; }
    .imgs-preview {
      margin-top: 16px; border-radius: 10px; overflow: hidden;
      max-height: 220px; display: flex; align-items: center; justify-content: center;
      background: #111;
    }
    .imgs-preview img { max-width: 100%; max-height: 220px; object-fit: contain; }
    .imgs-status {
      margin-top: 14px; font-size: 13px; color: #f5c842;
      min-height: 20px; text-align: center;
    }
    .imgs-recognized {
      margin-top: 10px; font-size: 12px; color: #888;
      background: rgba(255,255,255,0.04); border-radius: 8px; padding: 8px 12px;
      display: none;
    }
    .imgs-recognized span { color: #ddd; }
    .imgs-btn-row {
      margin-top: 18px; display: flex; gap: 10px;
    }
    .imgs-btn {
      flex: 1; padding: 10px; border-radius: 8px; border: none;
      font-size: 14px; font-weight: 600; cursor: pointer; transition: opacity 0.2s;
    }
    .imgs-btn:hover { opacity: 0.85; }
    .imgs-btn-primary { background: #f5c842; color: #1a1a2e; }
    .imgs-btn-secondary { background: #333; color: #fff; }
    .imgs-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .imgs-camera-btn {
      margin-top: 12px; width: 100%; padding: 9px;
      border-radius: 8px; border: 1px solid #555; background: transparent;
      color: #aaa; font-size: 13px; cursor: pointer; transition: border-color 0.2s;
    }
    .imgs-camera-btn:hover { border-color: #f5c842; color: #f5c842; }
  `;

  function _injectStyles() {
    if (document.getElementById('imgSearchStyles')) return;
    const style = document.createElement('style');
    style.id = 'imgSearchStyles';
    style.textContent = MODAL_CSS;
    document.head.appendChild(style);
  }

  function _createModal(opts = {}) {
    _injectStyles();

    const overlay = document.createElement('div');
    overlay.id = 'imgSearchOverlay';
    overlay.innerHTML = `
      <div id="imgSearchModal">
        <h3>📷 Hledat podle fotky</h3>
        <p>Vyfoť nebo nahraj obrázek karty – AI ji automaticky rozpozná</p>

        <div class="imgs-drop-zone" id="imgsDropZone">
          <div class="imgs-icon">🃏</div>
          <strong>Přetáhni sem obrázek</strong>
          <div class="imgs-hint">nebo klikni pro výběr souboru</div>
        </div>

        <input type="file" id="imgSearchFileInput" accept="image/*">

        <button class="imgs-camera-btn" id="imgsCameraBtn">
          📷 Vyfotit kartičku (telefon / webkamera)
        </button>
        <input type="file" id="imgSearchCameraInput" accept="image/*" capture="environment" style="display:none">

        <div class="imgs-preview" id="imgsPreview" style="display:none">
          <img id="imgsPreviewImg" src="" alt="Preview">
        </div>

        <div class="imgs-status" id="imgsStatus"></div>

        <div class="imgs-recognized" id="imgsRecognized">
          🤖 Rozpoznáno: <span id="imgsRecName">–</span>
          • Série: <span id="imgsRecSet">–</span>
          • č. <span id="imgsRecNum">–</span>
        </div>

        <div class="imgs-btn-row">
          <button class="imgs-btn imgs-btn-secondary" id="imgsCloseBtn">Zavřít</button>
          <button class="imgs-btn imgs-btn-primary" id="imgsSearchBtn" disabled>🔍 Hledat</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    let selectedFile = null;
    let lastResult = null;
    let searching = false;

    const dropZone   = overlay.querySelector('#imgsDropZone');
    const fileInput  = overlay.querySelector('#imgSearchFileInput');
    const camInput   = overlay.querySelector('#imgSearchCameraInput');
    const camBtn     = overlay.querySelector('#imgsCameraBtn');
    const preview    = overlay.querySelector('#imgsPreview');
    const previewImg = overlay.querySelector('#imgsPreviewImg');
    const statusEl   = overlay.querySelector('#imgsStatus');
    const recBox     = overlay.querySelector('#imgsRecognized');
    const searchBtn  = overlay.querySelector('#imgsSearchBtn');
    const closeBtn   = overlay.querySelector('#imgsCloseBtn');

    function setStatus(msg) { statusEl.textContent = msg; }

    function showPreview(file) {
      const url = URL.createObjectURL(file);
      previewImg.src = url;
      preview.style.display = 'flex';
      recBox.style.display = 'none';
      searchBtn.disabled = false;
      searchBtn.textContent = '🔍 Hledat';
      setStatus('');
    }

    function handleFile(file) {
      if (!file || !file.type.startsWith('image/')) {
        setStatus('❌ Vyber obrázek (JPG, PNG, WEBP)');
        return;
      }
      selectedFile = file;
      lastResult = null;
      showPreview(file);
    }

    // Drag & drop
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      handleFile(e.dataTransfer.files[0]);
    });

    // Klik na drop zone
    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => handleFile(fileInput.files[0]));

    // Kamera
    camBtn.addEventListener('click', () => camInput.click());
    camInput.addEventListener('change', () => handleFile(camInput.files[0]));

    // Paste z clipboardu
    document.addEventListener('paste', function onPaste(e) {
      if (!document.body.contains(overlay)) { document.removeEventListener('paste', onPaste); return; }
      const item = Array.from(e.clipboardData?.items || []).find(i => i.type.startsWith('image/'));
      if (item) handleFile(item.getAsFile());
    }, { once: false });

    // Hledání
    searchBtn.addEventListener('click', async () => {
      if (!selectedFile || searching) return;
      searching = true;
      searchBtn.disabled = true;
      searchBtn.textContent = '⏳ Rozpoznávám…';

      try {
        const result = await searchByImage(selectedFile, setStatus);
        lastResult = result;

        // Zobraz co AI rozpoznalo
        const r = result.recognized;
        overlay.querySelector('#imgsRecName').textContent = r.name || '?';
        overlay.querySelector('#imgsRecSet').textContent  = r.set  || '?';
        overlay.querySelector('#imgsRecNum').textContent  = r.number || '?';
        recBox.style.display = 'block';

        if (!result.cards.length) {
          setStatus('😕 Karta nebyla nalezena v databázi');
          searchBtn.textContent = '🔍 Zkusit znovu';
          searchBtn.disabled = false;
        } else {
          setStatus(`✅ Nalezeno ${result.cards.length} výsledků`);
          searchBtn.textContent = '✅ Hotovo';

          // Zavři modál a předej výsledky
          setTimeout(() => {
            _closeModal();
            if (opts.onResult) opts.onResult(result.cards, result.recognized);
          }, 800);
        }
      } catch (err) {
        setStatus('❌ ' + err.message);
        searchBtn.textContent = '🔍 Zkusit znovu';
        searchBtn.disabled = false;
      } finally {
        searching = false;
      }
    });

    closeBtn.addEventListener('click', _closeModal);
    overlay.addEventListener('click', e => { if (e.target === overlay) _closeModal(); });

    function _closeModal() {
      overlay.remove();
      if (opts.onClose) opts.onClose(lastResult);
    }
  }

  // ── Veřejné API ───────────────────────────────────────────────────────────

  const ImageSearch = {
    /**
     * Otevře modál pro výběr obrázku a vyhledávání.
     *
     * @param {object} opts
     *   onResult(cards, recognized) – zavoláno po úspěšném vyhledání
     *   onClose(lastResult)         – zavoláno při zavření
     */
    open(opts = {}) {
      // Odstraň existující modál pokud je
      document.getElementById('imgSearchOverlay')?.remove();
      _createModal(opts);
    },

    /**
     * Přímé vyhledání bez UI – pro integraci do vlastních workflow.
     *
     * @param {File|Blob|string} imageSource
     * @param {function}         [onStatus]
     * @returns {Promise<{ cards: Array, recognized: object }>}
     */
    searchByImage,
  };

  global.ImageSearch = ImageSearch;

})(typeof window !== 'undefined' ? window : global);
