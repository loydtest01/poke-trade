/**
 * image-search.js – Vyhledávání Pokémon karet podle fotografie
 * ============================================================
 * Rozpoznání karty dělá společný modul ai-rozpoznani.js (PT_AI) — stejné
 * zadání a odolné čtení odpovědi jako v obchodě. Pak volá PkSearch.search()
 * z card-search.js.
 *
 * POUŽITÍ:
 *   <script src="ai-rozpoznani.js"></script>   (když chybí, načte se sám)
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

  // ── Společný AI modul (ai-rozpoznani.js) ──────────────────────────────────
  // Když ho stránka nenačetla, dotáhne se sám — ImageSearch tak funguje všude.
  let _ptAiSlib = null;
  function _nactiPtAi() {
    if (global.PT_AI) return Promise.resolve(global.PT_AI);
    if (_ptAiSlib) return _ptAiSlib;
    _ptAiSlib = new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = '/ai-rozpoznani.js';
      sc.onload  = () => global.PT_AI ? resolve(global.PT_AI) : reject(new Error('Modul AI rozpoznávání se nenačetl'));
      sc.onerror = () => { _ptAiSlib = null; reject(new Error('Modul AI rozpoznávání se nenačetl')); };
      document.head.appendChild(sc);
    });
    return _ptAiSlib;
  }

  let _rozpSlib = null;
  function _nactiRozpoznani() {
    if (global.PT_ROZPOZNANI) return Promise.resolve(global.PT_ROZPOZNANI);
    if (_rozpSlib) return _rozpSlib;
    _rozpSlib = new Promise(resolve => {
      const sc = document.createElement('script');
      sc.src = '/rozpoznani-karty.js';
      sc.onload  = () => resolve(global.PT_ROZPOZNANI || null);
      sc.onerror = () => { _rozpSlib = null; resolve(null); };
      document.head.appendChild(sc);
    });
    return _rozpSlib;
  }

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

  // ── Rozpoznání přes PT_AI ─────────────────────────────────────────────────
  // Vrací objekt kompatibilní s dřívější verzí (name, set, number, lang, hp,
  // rarity) + všechna pole z PT_AI. name = anglický název (pro vyhledávání
  // a pole hledání v obchodě), nameOriginal = jak je vytištěn na kartě.
  async function _rozpoznej(base64, mimeType) {
    const ai = await _nactiPtAi();
    const token = localStorage.getItem('sb_token') || '';
    const k = await ai.rozpoznejKartu(base64, mimeType, { token, usage: 'search' });

    return _zAI(k);
  }

  function _zAI(k) {
    if (k.chyba) {
      if (k.status === 401) throw new Error('Pro rozpoznání z fotky se přihlas');
      throw new Error(k.notes || 'Rozpoznání selhalo');
    }
    return Object.assign({}, k, {
      zdroj:        'ai',
      name:         k.nameEN || k.name,
      nameOriginal: k.name,
      set:          k.setCode || '',
      number:       (k.number || '').split('/')[0].trim(),   // jen číslo před lomítkem
      numberFull:   k.number || '',
      lang:         k.lang || 'EN',
      hp:           k.hp || null,
    });
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

    // Nejdřív bez AI (kolektivní paměť, otisk obrázku), AI až jako záloha
    let recognized = null;
    const R = await _nactiRozpoznani();
    if (R) {
      status('🔍 Hledám v kolektivní paměti…');
      const v = await R.rozpoznej(`data:${imgData.mimeType};base64,${imgData.base64}`,
        { token: localStorage.getItem('sb_token') || '' });
      if (v.karta) {
        const k = v.karta;
        status(`${R.popisek(v.zdroj)}: ${k.name}…`);
        recognized = { name: k.name, nameOriginal: k.name, nameEN: k.name, set: k.set,
          number: String(k.number || '').split('/')[0].trim(), numberFull: k.number || '',
          lang: 'EN', hp: null, rarity: '', zdroj: v.zdroj, apiId: k.apiId, phash: v.phash,
          confidence: v.jistota >= 0.9 ? 'high' : 'med' };
      } else if (v.ai) {
        recognized = _zAI(v.ai);
        recognized.phash = v.phash;
      } else {
        throw new Error(v.chyba || 'Kartu se nepodařilo rozpoznat');
      }
    } else {
      status('🤖 AI rozpoznává kartu…');
      recognized = await _rozpoznej(imgData.base64, imgData.mimeType);
    }

    console.log('[ImageSearch] Rozpoznáno:', recognized);

    if (!recognized?.name) {
      throw new Error('AI nedokázalo rozpoznat kartu. Zkus lépe osvětlený nebo rovnější záběr.');
    }

    status(`🔍 Hledám: ${recognized.name}…`);

    if (typeof PkSearch === 'undefined') {
      throw new Error('card-search.js není načteno – přidej <script src="card-search.js"> před image-search.js');
    }

    // Neanglická karta: hledá se podle vytištěného jména a jazyka, anglický
    // název od AI se předá jako hotový překlad (PkSearch pak nepřekládá znovu).
    const jeEN = recognized.lang === 'EN';
    const cards = await PkSearch.search(jeEN ? recognized.name : (recognized.nameOriginal || recognized.name), {
      set:      recognized.set    || '',
      number:   recognized.number || '',
      lang:     recognized.lang,
      hp:       recognized.hp     || null,
      rarity:   recognized.rarity || '',
      onStatus: status,
      _preResolvedEnName: jeEN ? '' : (recognized.nameEN || ''),
    });

    // Karta z kolektivní paměti / otisku → přesně tuhle dát na první místo
    if (recognized.apiId && Array.isArray(cards)) {
      const i = cards.findIndex(c => (c.apiId || c.id) === recognized.apiId);
      if (i > 0) cards.unshift(cards.splice(i, 1)[0]);
    }
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
        overlay.querySelector('#imgsRecName').textContent =
          (r.nameOriginal && r.nameOriginal !== r.name ? r.nameOriginal + ' → ' : '') + (r.name || '?') +
          (r.lang && r.lang !== 'EN' ? ' (' + r.lang + ')' : '') +
          (r.confidence === 'low' ? ' ⚠️ nejisté' : '') +
          (r.zdroj && r.zdroj !== 'ai' ? ' · ' + (global.PT_ROZPOZNANI ? global.PT_ROZPOZNANI.popisek(r.zdroj) : r.zdroj) : '');
        overlay.querySelector('#imgsRecSet').textContent  = r.set || r.setName || '?';
        overlay.querySelector('#imgsRecNum').textContent  = r.numberFull || r.number || '?';
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
