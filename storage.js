(function () {
  const STORAGE_KEY = 'studyloop_v5_data';
  const LEGACY_KEYS = ['studyloop_pro_data', 'studyloop_v4_data', 'studyloop_v3_data', 'studyloop_data'];
  const undoStack = [];

  function uid(prefix = 'id') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function createDefaultData() {
    const deckId = uid('deck');
    return {
      activeDeckId: deckId,
      examDate: '',
      theme: 'light',
      decks: [
        {
          id: deckId,
          title: 'サンプル（数式・赤シート確認）',
          cards: [
            {
              id: uid('c'),
              category: '数学',
              front: '二次方程式 $ax^2 + bx + c = 0$ ($a \\neq 0$) の解の公式',
              back: '【$$x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$$】',
              hint: '判別式 $D = b^2 - 4ac$ をルートの中に入れます。',
              image: '',
              correctCount: 0,
              wrongCount: 0,
              pinned: false,
              srsLevel: 0,
              nextReview: 0
            },
            {
              id: uid('c'),
              category: '物理',
              front: '真空中のクーロンの法則の比例定数 $k$ を含む静電気力 $F$ の式',
              back: '【$$F = k\\frac{|q_1 q_2|}{r^2}$$】',
              hint: '距離 $r$ の2乗に反比例します。',
              image: '',
              correctCount: 0,
              wrongCount: 0,
              pinned: false,
              srsLevel: 0,
              nextReview: 0
            },
            {
              id: uid('c'),
              category: '化学',
              front: '理想気体の状態方程式',
              back: '【$$PV = nRT$$】',
              hint: '圧力 $P$、体積 $V$、物質量 $n$、気体定数 $R$、絶対温度 $T$',
              image: '',
              correctCount: 0,
              wrongCount: 0,
              pinned: false,
              srsLevel: 0,
              nextReview: 0
            }
          ]
        }
      ]
    };
  }

  function normalizeCard(raw) {
    return {
      id: raw.id || uid('c'),
      category: String(raw.category || '一般').trim(),
      front: String(raw.front || raw.q || '').trim(),
      back: String(raw.back || raw.a || '').trim(),
      hint: String(raw.hint || '').trim(),
      image: String(raw.image || ''),
      correctCount: Number(raw.correctCount || raw.correct || 0),
      wrongCount: Number(raw.wrongCount || raw.wrong || 0),
      pinned: Boolean(raw.pinned),
      srsLevel: Number(raw.srsLevel || 0),
      nextReview: Number(raw.nextReview || 0)
    };
  }

  function migrateLegacyData() {
    const candidateKeys = [...LEGACY_KEYS];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k !== STORAGE_KEY && k.toLowerCase().includes('studyloop') && !candidateKeys.includes(k)) {
        candidateKeys.push(k);
      }
    }
    for (const key of candidateKeys) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.decks) && parsed.decks.length > 0) {
          const decks = parsed.decks.map((d) => ({
            id: d.id || uid('deck'),
            title: String(d.title || d.name || '引き継ぎデッキ'),
            cards: Array.isArray(d.cards) ? d.cards.map(normalizeCard).filter((c) => c.front && c.back) : []
          }));
          return {
            activeDeckId: parsed.activeDeckId && decks.some((d) => d.id === parsed.activeDeckId)
              ? parsed.activeDeckId
              : decks[0].id,
            examDate: parsed.examDate || '',
            theme: parsed.theme || 'light',
            decks
          };
        }
      } catch (e) {
        console.warn('Migration skip:', key, e);
      }
    }
    return null;
  }

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.decks) && parsed.decks.length > 0) {
          parsed.decks.forEach((d) => {
            d.cards = Array.isArray(d.cards) ? d.cards.map(normalizeCard) : [];
          });
          if (!parsed.decks.some((d) => d.id === parsed.activeDeckId)) {
            parsed.activeDeckId = parsed.decks[0].id;
          }
          return parsed;
        }
      }
    } catch (e) {
      console.error('Failed to read storage:', e);
    }
    const migrated = migrateLegacyData();
    if (migrated) {
      saveData(migrated);
      return migrated;
    }
    const fresh = createDefaultData();
    saveData(fresh);
    return fresh;
  }

  function saveData(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('Failed to save storage:', e);
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function formatCardHtml(rawText) {
    const escaped = escapeHtml(rawText || '');
    const withCloze = escaped.replace(/【([\s\S]*?)】/g, (_, inner) => {
      return `<span class="cloze-blank" tabindex="0"><span class="cloze-inner">${inner}</span></span>`;
    });
    return withCloze.replace(/\n/g, '<br>');
  }

  function renderContent(element, rawText) {
    if (!element) return;
    element.innerHTML = formatCardHtml(rawText);
    if (typeof window.renderMathInElement === 'function') {
      try {
        window.renderMathInElement(element, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false }
          ],
          throwOnError: false
        });
      } catch (e) {
        console.warn('KaTeX render warning:', e);
      }
    }
  }

  function extractClozeTargets(backText) {
    const matches = [];
    const regex = /【([\s\S]*?)】/g;
    let m;
    while ((m = regex.exec(backText || '')) !== null) {
      const val = m[1].trim();
      if (val) matches.push(val);
    }
    return matches.length > 0 ? matches : [String(backText || '').trim()];
  }

  function parseImportText(rawText) {
    const lines = String(rawText || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('```'));

    const cards = [];
    for (const line of lines) {
      const parts = line.split('|').map((p) => p.trim());
      if (parts.length < 2) continue;
      let category = '一般';
      let front = '';
      let back = '';
      let hint = '';

      if (parts.length === 2) {
        [front, back] = parts;
      } else {
        category = parts[0] || '一般';
        front = parts[1] || '';
        back = parts[2] || '';
        hint = parts.slice(3).join(' | ');
      }
      if (front && back) {
        cards.push(normalizeCard({ category, front, back, hint }));
      }
    }
    return cards;
  }

  function pushUndo(snapshot) {
    undoStack.push(snapshot);
    if (undoStack.length > 30) undoStack.shift();
  }

  function popUndo() {
    return undoStack.length > 0 ? undoStack.pop() : null;
  }

  function clearUndo() {
    undoStack.length = 0;
  }

  function encodeSharePayload(deck) {
    const minimal = {
      t: deck.title,
      c: deck.cards.map((card) => [card.category, card.front, card.back, card.hint])
    };
    const json = JSON.stringify(minimal);
    const bytes = new TextEncoder().encode(json);
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodeSharePayload(encoded) {
    const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const json = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json);
    if (!parsed || !Array.isArray(parsed.c)) return null;
    return {
      id: uid('deck'),
      title: String(parsed.t || '共有デッキ'),
      cards: parsed.c.map((arr) => normalizeCard({
        category: arr[0],
        front: arr[1],
        back: arr[2],
        hint: arr[3]
      }))
    };
  }

  window.StudyStorage = {
    uid,
    loadData,
    saveData,
    normalizeCard,
    formatCardHtml,
    renderContent,
    extractClozeTargets,
    parseImportText,
    pushUndo,
    popUndo,
    clearUndo,
    encodeSharePayload,
    decodeSharePayload
  };
})();
