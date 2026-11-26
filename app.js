(function () {
  const S = window.StudyStorage;
  let appData = S.loadData();
  if (!Array.isArray(appData.folders)) {
    appData.folders = [];
  }

  const settings = {
    mode: 'smart',      // 'smart' | 'all' | 'weak' | 'srs'
    format: 'flip',     // 'flip' | 'choice' | 'input'
    category: 'ALL',
    reverse: false,
    shuffle: false,
    redsheet: false
  };

  const session = {
    active: false,
    phase: 'main',      // 'main' | 'review'
    mainQueue: [],
    mainIndex: 0,
    mainStepsSinceReview: 0,
    wrongPool: [],
    reviewQueue: [],
    reviewIndex: 0,
    isFlipped: false,
    answeredCurrent: false,
    animatingJudge: false
  };

  let currentFolderId = null;
  let movingDeckId = null;
  let pendingImageDataUrl = '';
  let suppressFlipUntil = 0;
  let editingCardId = null;

  const $ = (id) => document.getElementById(id);

  function haptic(ms = 14) {
    if (navigator.vibrate) {
      try {
        navigator.vibrate(ms);
      } catch (_) {}
    }
  }

  function getActiveDeck() {
    return appData.decks.find((d) => d.id === appData.activeDeckId) || appData.decks[0];
  }

  function getFolderById(folderId) {
    if (!folderId) return null;
    return (appData.folders || []).find((f) => f.id === folderId) || null;
  }

  function applyThemeAndRedsheet() {
    document.body.classList.toggle('dark', appData.theme === 'dark');
    document.body.classList.toggle('redsheet-on', settings.redsheet);

    const themeBtn = $('btn-theme');
    if (themeBtn) {
      themeBtn.textContent = appData.theme === 'dark' ? '☀️' : '🌙';
    }

    const optRed = $('opt-redsheet');
    if (optRed) {
      optRed.checked = settings.redsheet;
    }

    const studyBtn = $('btn-study-redsheet');
    if (studyBtn) {
      studyBtn.classList.toggle('active', settings.redsheet);
    }
  }

  function escapeText(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function downloadCsvFile(csvText, filename) {
    const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function readCsvFileWithEncoding(file, callback) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = String(ev.target.result || '');
      if (text.includes('\uFFFD')) {
        const sjisReader = new FileReader();
        sjisReader.onload = (ev2) => callback(String(ev2.target.result || ''));
        sjisReader.readAsText(file, 'Shift_JIS');
      } else {
        callback(text);
      }
    };
    reader.readAsText(file, 'UTF-8');
  }

  /* ==================== 第1段階：ホーム画面（フォルダ・単語帳一覧） ==================== */
  function showHomeView(folderId = currentFolderId) {
    session.active = false;
    if (folderId && !getFolderById(folderId)) {
      currentFolderId = null;
    } else {
      currentFolderId = folderId || null;
    }

    $('view-study').classList.add('hidden');
    $('view-deck').classList.add('hidden');
    $('view-home').classList.remove('hidden');
    renderHomeView();
  }

  function createDeckCardElement(deck) {
    const total = deck.cards.length;
    const mastered = deck.cards.filter((c) => c.correctCount > 0 && c.correctCount >= c.wrongCount).length;
    const weak = deck.cards.filter((c) => c.wrongCount > c.correctCount || c.pinned).length;
    const pct = total > 0 ? Math.round((mastered / total) * 100) : 0;

    const cardEl = document.createElement('div');
    cardEl.className = 'deck-card';
    cardEl.innerHTML = `
      <div class="deck-card-top">
        <div class="deck-card-title">${escapeText(deck.title)}</div>
        <div class="deck-card-right-tools">
          <span class="deck-card-count">${total}問</span>
          <button type="button" class="deck-move-btn" title="フォルダ移動" aria-label="フォルダ移動">📁</button>
        </div>
      </div>
      <div class="progress-slim">
        <div class="progress-slim-fill" style="width: ${pct}%;"></div>
      </div>
      <div class="deck-card-footer">
        <span>定着率 ${pct}%（${mastered}/${total}）</span>
        <span>苦手・★ ${weak}問</span>
      </div>
    `;

    const moveBtn = cardEl.querySelector('.deck-move-btn');
    if (moveBtn) {
      moveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        haptic(10);
        openFolderMoveModal(deck.id);
      });
    }

    cardEl.addEventListener('click', () => {
      haptic(10);
      openDeckView(deck.id);
    });

    return cardEl;
  }

  function renderHomeView() {
    const folderList = $('home-folder-list');
    const deckList = $('home-deck-list');
    const heroEl = $('home-hero');
    const folderNav = $('folder-nav-bar');
    const newFolderBtn = $('btn-new-folder');
    if (!folderList || !deckList) return;

    folderList.innerHTML = '';
    deckList.innerHTML = '';

    const activeFolder = getFolderById(currentFolderId);

    if (activeFolder) {
      // フォルダ内部の表示
      heroEl?.classList.add('hidden');
      folderNav?.classList.remove('hidden');
      folderList.classList.add('hidden');
      newFolderBtn?.classList.add('hidden');
      $('current-folder-title').textContent = activeFolder.name;

      const decksInFolder = appData.decks.filter((d) => d.folderId === activeFolder.id);
      if (decksInFolder.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-folder-box';
        empty.textContent = 'このフォルダにはまだ単語帳がありません。「新しい単語帳を作成」または他の単語帳の📁ボタンから移動できます。';
        deckList.appendChild(empty);
      } else {
        decksInFolder.forEach((deck) => {
          deckList.appendChild(createDeckCardElement(deck));
        });
      }
    } else {
      // トップ一覧の表示
      heroEl?.classList.remove('hidden');
      folderNav?.classList.add('hidden');
      newFolderBtn?.classList.remove('hidden');

      const folders = appData.folders || [];
      if (folders.length > 0) {
        folderList.classList.remove('hidden');
        folders.forEach((folder) => {
          const childDecks = appData.decks.filter((d) => d.folderId === folder.id);
          const totalCards = childDecks.reduce((sum, d) => sum + d.cards.length, 0);

          const fEl = document.createElement('div');
          fEl.className = 'folder-card';
          fEl.innerHTML = `
            <div class="folder-card-left">
              <div class="folder-icon-box">📁</div>
              <div class="folder-card-info">
                <div class="folder-card-title">${escapeText(folder.name)}</div>
                <div class="folder-card-meta">合計 ${totalCards}問</div>
              </div>
            </div>
            <div class="folder-card-right">
              <span class="folder-deck-badge">${childDecks.length}冊</span>
              <span class="folder-chevron">›</span>
            </div>
          `;
          fEl.addEventListener('click', () => {
            haptic(10);
            showHomeView(folder.id);
          });
          folderList.appendChild(fEl);
        });
      } else {
        folderList.classList.add('hidden');
      }

      const rootDecks = appData.decks.filter((d) => !d.folderId || !getFolderById(d.folderId));
      rootDecks.forEach((deck) => {
        deckList.appendChild(createDeckCardElement(deck));
      });
    }
  }

  /* ==================== フォルダ移動モーダル ==================== */
  function openFolderMoveModal(deckId) {
    const deck = appData.decks.find((d) => d.id === deckId);
    if (!deck) return;
    movingDeckId = deck.id;

    $('move-modal-deck-name').textContent = `対象：「${deck.title}」`;
    renderFolderMoveChoices(deck);
    $('folder-move-modal').classList.remove('hidden');
  }

  function closeFolderMoveModal() {
    movingDeckId = null;
    $('folder-move-modal').classList.add('hidden');
  }

  function renderFolderMoveChoices(deck) {
    const list = $('folder-move-list');
    if (!list) return;
    list.innerHTML = '';

    const currentFid = deck.folderId && getFolderById(deck.folderId) ? deck.folderId : '';

    // フォルダなし（トップ一覧）
    const rootBtn = document.createElement('button');
    rootBtn.type = 'button';
    rootBtn.className = 'folder-choice-item' + (currentFid === '' ? ' active' : '');
    rootBtn.innerHTML = `
      <span>📂 フォルダなし（トップ一覧）</span>
      <span>${currentFid === '' ? '✓' : ''}</span>
    `;
    rootBtn.addEventListener('click', () => {
      deck.folderId = '';
      S.saveData(appData);
      haptic(12);
      closeFolderMoveModal();
      if (!$('view-home').classList.contains('hidden')) {
        renderHomeView();
      }
    });
    list.appendChild(rootBtn);

    (appData.folders || []).forEach((folder) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      const isSelected = currentFid === folder.id;
      btn.className = 'folder-choice-item' + (isSelected ? ' active' : '');
      btn.innerHTML = `
        <span>📁 ${escapeText(folder.name)}</span>
        <span>${isSelected ? '✓' : ''}</span>
      `;
      btn.addEventListener('click', () => {
        deck.folderId = folder.id;
        S.saveData(appData);
        haptic(12);
        closeFolderMoveModal();
        if (!$('view-home').classList.contains('hidden')) {
          renderHomeView();
        }
      });
      list.appendChild(btn);
    });
  }

  /* ==================== 第2段階：デッキ詳細画面 ==================== */
  function openDeckView(deckId) {
    appData.activeDeckId = deckId;
    settings.category = 'ALL';
    S.saveData(appData);

    $('view-home').classList.add('hidden');
    $('view-study').classList.add('hidden');
    $('view-deck').classList.remove('hidden');

    refreshDeckHeaderAndFilters();
    switchTab('setup');
  }

  function refreshDeckHeaderAndFilters() {
    const deck = getActiveDeck();
    if (!deck) return;
    $('current-deck-title').textContent = deck.title;

    const filterSel = $('category-filter');
    if (filterSel) {
      const cats = Array.from(new Set(deck.cards.map((c) => c.category || '一般')));
      filterSel.innerHTML = `<option value="ALL">すべての単元（${deck.cards.length}問）</option>`;
      cats.forEach((cat) => {
        const count = deck.cards.filter((c) => (c.category || '一般') === cat).length;
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = `${cat}（${count}問）`;
        if (settings.category === cat) opt.selected = true;
        filterSel.appendChild(opt);
      });
    }

    updateExamCountdown();
    updateStartTargetCount();
  }

  function getFilteredCards(deck) {
    const now = Date.now();
    let list = [...deck.cards];
    if (settings.category && settings.category !== 'ALL') {
      list = list.filter((c) => (c.category || '一般') === settings.category);
    }
    if (settings.mode === 'weak') {
      list = list.filter((c) => c.wrongCount > c.correctCount || c.pinned);
    } else if (settings.mode === 'srs') {
      list = list.filter((c) => !c.nextReview || c.nextReview <= now);
    }
    return list;
  }

  function updateStartTargetCount() {
    const deck = getActiveDeck();
    const countSpan = $('start-target-count');
    const startBtn = $('btn-start-study');
    if (!deck || !countSpan || !startBtn) return;

    const targets = getFilteredCards(deck);
    countSpan.textContent = String(targets.length);
    startBtn.disabled = targets.length === 0;
    startBtn.style.opacity = targets.length === 0 ? '0.45' : '1';
  }

  function updateExamCountdown() {
    const input = $('exam-date');
    const badge = $('exam-countdown');
    if (!input || !badge) return;
    input.value = appData.examDate || '';
    if (!appData.examDate) {
      badge.textContent = '未設定';
      return;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(appData.examDate + 'T00:00:00');
    const diffDays = Math.ceil((target - today) / 86400000);
    const deck = getActiveDeck();
    const unmastered = deck ? deck.cards.filter((c) => c.correctCount === 0).length : 0;

    if (diffDays < 0) {
      badge.textContent = '試験終了';
    } else if (diffDays === 0) {
      badge.textContent = '本日が試験日';
    } else {
      const perDay = Math.ceil(unmastered / diffDays);
      badge.textContent = `あと${diffDays}日（1日${perDay}問目安）`;
    }
  }

  function switchTab(tabName) {
    document.querySelectorAll('.seg-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    document.querySelectorAll('.tab-panel').forEach((panel) => {
      panel.classList.toggle('active', panel.id === `panel-${tabName}`);
    });
    if (tabName === 'setup') updateStartTargetCount();
    if (tabName === 'sheet') renderSheetTab();
    if (tabName === 'stats') renderStatsTab();
    if (tabName === 'manage') renderManageTab();
  }

  function renderSheetTab() {
    const container = $('sheet-list');
    const deck = getActiveDeck();
    if (!container || !deck) return;
    container.innerHTML = '';
    deck.cards.forEach((card) => {
      const row = document.createElement('div');
      row.className = 'sheet-item';
      const qDiv = document.createElement('div');
      qDiv.className = 'sheet-q';
      const aDiv = document.createElement('div');
      aDiv.className = 'sheet-a';
      S.renderContent(qDiv, card.front);
      S.renderContent(aDiv, card.back);
      row.appendChild(qDiv);
      row.appendChild(aDiv);
      container.appendChild(row);
    });
  }

  function renderStatsTab() {
    const container = $('stats-container');
    const catBox = $('category-stats-container');
    const deck = getActiveDeck();
    if (!container || !deck) return;

    const total = deck.cards.length;
    const mastered = deck.cards.filter((c) => c.correctCount > 0 && c.correctCount >= c.wrongCount).length;
    const weak = deck.cards.filter((c) => c.wrongCount > c.correctCount || c.pinned).length;
    const totalCorrect = deck.cards.reduce((sum, c) => sum + c.correctCount, 0);
    const totalWrong = deck.cards.reduce((sum, c) => sum + c.wrongCount, 0);
    const acc = totalCorrect + totalWrong > 0
      ? Math.round((totalCorrect / (totalCorrect + totalWrong)) * 100)
      : 0;

    container.innerHTML = `
      <div class="stat-box"><div class="stat-val">${total}</div><div class="stat-lbl">総問題数</div></div>
      <div class="stat-box"><div class="stat-val" style="color:var(--cta);">${mastered}</div><div class="stat-lbl">定着済み</div></div>
      <div class="stat-box"><div class="stat-val" style="color:var(--wrong);">${weak}</div><div class="stat-lbl">苦手・★ピン</div></div>
      <div class="stat-box"><div class="stat-val">${acc}%</div><div class="stat-lbl">通算正答率</div></div>
    `;

    if (catBox) {
      const cats = Array.from(new Set(deck.cards.map((c) => c.category || '一般')));
      if (cats.length === 0) {
        catBox.classList.add('hidden');
      } else {
        catBox.classList.remove('hidden');
        catBox.innerHTML = '<div class="group-heading">単元別の定着状況</div>';
        cats.forEach((cat) => {
          const items = deck.cards.filter((c) => (c.category || '一般') === cat);
          const m = items.filter((c) => c.correctCount > 0 && c.correctCount >= c.wrongCount).length;
          const pct = items.length > 0 ? Math.round((m / items.length) * 100) : 0;
          const row = document.createElement('div');
          row.className = 'cat-stat-row';
          row.innerHTML = `
            <div class="cat-stat-head">
              <span>${escapeText(cat)}</span>
              <span>${m} / ${items.length}問 (${pct}%)</span>
            </div>
            <div class="progress-slim">
              <div class="progress-slim-fill" style="width: ${pct}%;"></div>
            </div>
          `;
          catBox.appendChild(row);
        });
      }
    }

    if (window.StudyStatsView && typeof window.StudyStatsView.render === 'function') {
      window.StudyStatsView.render(deck, () => {
        S.saveData(appData);
        renderStatsTab();
      });
    }
  }

  function renderManageTab() {
    const list = $('manage-card-list');
    const deck = getActiveDeck();
    if (!list || !deck) return;
    const query = ($('manage-search')?.value || '').trim().toLowerCase();
    list.innerHTML = '';

    deck.cards.forEach((card, idx) => {
      if (query && !card.front.toLowerCase().includes(query) && !card.back.toLowerCase().includes(query) && !card.category.toLowerCase().includes(query)) {
        return;
      }
      const item = document.createElement('div');
      item.className = 'manage-item';

      const info = document.createElement('div');
      info.className = 'manage-item-text';
      info.innerHTML = `<strong>[${escapeText(card.category)}]</strong> ${escapeText(card.front)}<br><span class="muted-small">${escapeText(card.back)}</span>`;

      const btns = document.createElement('div');
      btns.className = 'manage-item-btns';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'icon-circle-btn small';
      editBtn.textContent = '✎';
      editBtn.addEventListener('click', () => openEditModal(card));

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'icon-circle-btn small danger';
      delBtn.textContent = '×';
      delBtn.addEventListener('click', () => {
        if (!confirm('このカードを削除しますか？')) return;
        deck.cards.splice(idx, 1);
        S.saveData(appData);
        refreshDeckHeaderAndFilters();
        renderManageTab();
      });

      btns.appendChild(editBtn);
      btns.appendChild(delBtn);
      item.appendChild(info);
      item.appendChild(btns);
      list.appendChild(item);
    });
  }

  /* ==================== カード編集モーダル ==================== */
  function openEditModal(card) {
    editingCardId = card.id;
    $('edit-card-cat').value = card.category || '';
    $('edit-card-front').value = card.front || '';
    $('edit-card-back').value = card.back || '';
    $('edit-card-hint').value = card.hint || '';
    $('edit-modal').classList.remove('hidden');
  }

  function closeEditModal() {
    editingCardId = null;
    $('edit-modal').classList.add('hidden');
  }

  /* ==================== 第3段階：学習セッション＆復習ロジック ==================== */
  function buildQueueForMode(deck) {
    const list = getFilteredCards(deck);
    if (settings.shuffle) {
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
    }
    return list.map((c) => c.id);
  }

  function setStudyBehindVisible(visible) {
    $('study-main-area')?.classList.toggle('invisible-behind', !visible);
    $('study-bottom-area')?.classList.toggle('invisible-behind', !visible);
  }

  function startStudySession() {
    const deck = getActiveDeck();
    if (!deck || deck.cards.length === 0) return;

    const queue = buildQueueForMode(deck);
    if (queue.length === 0) return;

    haptic(18);
    S.clearUndo();
    session.active = true;
    session.phase = 'main';
    session.mainQueue = queue;
    session.mainIndex = 0;
    session.mainStepsSinceReview = 0;
    session.wrongPool = [];
    session.reviewQueue = [];
    session.reviewIndex = 0;
    session.isFlipped = false;
    session.answeredCurrent = false;
    session.animatingJudge = false;

    $('view-home').classList.add('hidden');
    $('view-deck').classList.add('hidden');
    $('view-study').classList.remove('hidden');
    $('review-interstitial').classList.add('hidden');
    $('complete-interstitial').classList.add('hidden');
    setStudyBehindVisible(true);

    renderCurrentStudyCard();
  }

  function exitStudySession() {
    session.active = false;
    session.animatingJudge = false;
    resetCardTransform(true);
    setStudyBehindVisible(true);
    $('view-study').classList.add('hidden');
    $('view-deck').classList.remove('hidden');
    refreshDeckHeaderAndFilters();
  }

  function getCurrentCard() {
    const deck = getActiveDeck();
    if (!deck) return null;
    const cardId = session.phase === 'review'
      ? session.reviewQueue[session.reviewIndex]
      : session.mainQueue[session.mainIndex];
    return deck.cards.find((c) => c.id === cardId) || null;
  }

  function syncPinButtons(isPinned) {
    [$('btn-pin-front'), $('btn-pin-back')].forEach((btn) => {
      if (!btn) return;
      btn.textContent = isPinned ? '★' : '☆';
      btn.classList.toggle('pinned', isPinned);
    });
  }

  function renderCurrentStudyCard() {
    const card = getCurrentCard();
    if (!card) {
      showCompleteScreen();
      return;
    }

    session.isFlipped = false;
    session.answeredCurrent = false;
    session.animatingJudge = false;

    const isReview = session.phase === 'review';
    const cur = isReview ? session.reviewIndex + 1 : session.mainIndex + 1;
    const total = isReview ? session.reviewQueue.length : session.mainQueue.length;
    $('progress-fill').style.width = `${Math.min(100, Math.round((cur / total) * 100))}%`;
    $('progress-text').textContent = `${cur} / ${total}`;

    let phaseText = '';
    if (!isReview && session.wrongPool.length > 0) {
      phaseText = settings.mode === 'smart'
        ? `間違い蓄積: ${session.wrongPool.length}/5`
        : `間違い: ${session.wrongPool.length}問`;
    }
    $('study-phase-badge').textContent = phaseText;

    syncPinButtons(card.pinned);
    $('front-cat-tag').textContent = card.category || '一般';
    $('back-cat-tag').textContent = card.category || '一般';

    const frontBadge = $('front-badge');
    const backBadge = $('back-badge');
    if (settings.reverse) {
      frontBadge.textContent = 'A';
      frontBadge.classList.add('back');
      backBadge.textContent = 'Q';
      backBadge.classList.remove('back');
    } else {
      frontBadge.textContent = 'Q';
      frontBadge.classList.remove('back');
      backBadge.textContent = 'A';
      backBadge.classList.add('back');
    }

    const frontText = settings.reverse ? card.back : card.front;
    const backText = settings.reverse ? card.front : card.back;

    S.renderContent($('front-content'), frontText);
    S.renderContent($('back-content'), backText);

    const fImg = $('front-image');
    const bImg = $('back-image');
    if (card.image && !settings.reverse) {
      fImg.src = card.image;
      fImg.classList.remove('hidden');
    } else {
      fImg.classList.add('hidden');
    }
    if (card.image && settings.reverse) {
      bImg.src = card.image;
      bImg.classList.remove('hidden');
    } else {
      bImg.classList.add('hidden');
    }

    const hintBtn = $('btn-hint');
    const hintBox = $('hint-text');
    hintBox.classList.add('hidden');
    if (card.hint) {
      hintBtn.classList.remove('hidden');
      S.renderContent(hintBox, card.hint);
    } else {
      hintBtn.classList.add('hidden');
    }

    const flipper = $('card-flipper');
    flipper.style.transition = 'none';
    flipper.classList.remove('is-flipped');
    void flipper.offsetWidth;
    flipper.style.transition = '';

    resetCardTransform(true);

    $('flip-controls').classList.toggle('hidden', settings.format !== 'flip');
    $('choice-container').classList.toggle('hidden', settings.format !== 'choice');
    $('input-container').classList.toggle('hidden', settings.format !== 'input');

    if (settings.format === 'choice') renderMultipleChoice(card);
    if (settings.format === 'input') prepareInputMode(card);
  }

  function flipCard(forceState) {
    if (settings.format !== 'flip') return;
    session.isFlipped = typeof forceState === 'boolean' ? forceState : !session.isFlipped;
    $('card-flipper').classList.toggle('is-flipped', session.isFlipped);
    haptic(12);
  }

  function renderMultipleChoice(card) {
    const container = $('choice-container');
    const deck = getActiveDeck();
    container.innerHTML = '';

    const correctLabel = settings.reverse
      ? card.front
      : S.extractClozeTargets(card.back).join(' / ');

    const sameCat = deck.cards.filter((c) => c.id !== card.id && c.category === card.category);
    const otherCat = deck.cards.filter((c) => c.id !== card.id && c.category !== card.category);
    const pool = [...sameCat, ...otherCat].map((c) =>
      settings.reverse ? c.front : S.extractClozeTargets(c.back).join(' / ')
    );

    const uniqueDistractors = [];
    for (const item of pool) {
      if (item && item !== correctLabel && !uniqueDistractors.includes(item)) {
        uniqueDistractors.push(item);
      }
    }
    for (let i = uniqueDistractors.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [uniqueDistractors[i], uniqueDistractors[j]] = [uniqueDistractors[j], uniqueDistractors[i]];
    }
    const options = [correctLabel, ...uniqueDistractors.slice(0, 3)];
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }

    options.forEach((optText) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'quiz-option';
      const plain = optText.replace(/【|】/g, '');
      btn.textContent = plain;
      if (typeof window.renderMathInElement === 'function') {
        try {
          window.renderMathInElement(btn, {
            delimiters: [
              { left: '$$', right: '$$', display: false },
              { left: '$', right: '$', display: false }
            ],
            throwOnError: false
          });
        } catch (_) {}
      }

      btn.addEventListener('click', () => {
        if (session.answeredCurrent) return;
        session.answeredCurrent = true;
        const isCorrect = optText === correctLabel;
        haptic(isCorrect ? 15 : 35);
        btn.classList.add(isCorrect ? 'is-correct' : 'is-wrong');
        if (!isCorrect) {
          Array.from(container.children).forEach((child, idx) => {
            if (options[idx] === correctLabel) child.classList.add('is-correct');
          });
        }
        $('card-flipper').classList.add('is-flipped');
        setTimeout(() => recordAnswer(isCorrect), isCorrect ? 550 : 1150);
      });
      container.appendChild(btn);
    });
  }

  function getInputTargetsForCard(card) {
    if (!card) return [];
    const sourceText = settings.reverse ? card.front : card.back;
    return S.extractClozeTargets(sourceText);
  }

  function getCardLockedSet(card, totalCount) {
    const raw = Array.isArray(card?.lockedIndices) ? card.lockedIndices : [];
    const valid = raw.filter((n) => Number.isInteger(n) && n >= 0 && n < totalCount);
    return new Set(valid);
  }

  function prepareInputMode(card) {
    const list = $('input-fields-list');
    const fb = $('input-feedback');
    const submitBtn = $('btn-submit-answer');
    const nextBtn = $('btn-input-next');
    const selfJudge = $('input-self-judge');
    if (!list) return;

    const targets = getInputTargetsForCard(card);
    const count = Math.max(1, targets.length);
    const isMulti = count > 1;
    const lockedSet = getCardLockedSet(card, count);

    list.innerHTML = '';
    fb.classList.add('hidden');
    nextBtn.classList.add('hidden');
    selfJudge?.classList.add('hidden');
    submitBtn.classList.remove('hidden');

    const inputs = [];
    const lockBtns = [];

    const updateSubmitAndHints = () => {
      const activeCount = count - lockedSet.size;
      if (activeCount === 0) {
        submitBtn.textContent = '答えを確認（全枠ロック中）';
      } else if (lockedSet.size > 0) {
        submitBtn.textContent = `判定する（対象 ${activeCount}/${count}箇所）`;
      } else {
        submitBtn.textContent = isMulti ? `判定する（全${count}箇所）` : '判定する';
      }

      inputs.forEach((inp, idx) => {
        const hasNextActive = inputs.slice(idx + 1).some((el) => !el.disabled);
        inp.enterKeyHint = hasNextActive ? 'next' : 'done';
      });
    };

    const applyRowLockVisual = (idx) => {
      const isLocked = lockedSet.has(idx);
      const inp = inputs[idx];
      const lBtn = lockBtns[idx];
      if (inp) {
        inp.disabled = isLocked;
        inp.classList.toggle('is-locked', isLocked);
        inp.placeholder = isLocked
          ? '🔒 ロック中（判定に含めない）'
          : (isMulti ? `赤文字 ${idx + 1} を入力...` : '赤文字の答えを入力...');
      }
      if (lBtn) {
        lBtn.textContent = isLocked ? '🔒' : '🔓';
        lBtn.classList.toggle('is-locked', isLocked);
        lBtn.title = isLocked ? 'ロック解除（判定に含める）' : 'ロック（判定に含めない）';
        lBtn.setAttribute('aria-pressed', String(isLocked));
      }
    };

    for (let i = 0; i < count; i++) {
      const item = document.createElement('div');
      item.className = 'input-field-item';

      const row = document.createElement('div');
      row.className = 'input-field-row';

      if (isMulti) {
        const badge = document.createElement('span');
        badge.className = 'input-index-badge';
        badge.textContent = String(i + 1);
        row.appendChild(badge);
      }

      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'cloze-answer-input';
      inp.autocomplete = 'off';
      inp.autocapitalize = 'off';
      inp.spellcheck = false;

      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const nextActive = inputs.slice(i + 1).find((el) => !el.disabled);
          if (nextActive) {
            nextActive.focus();
          } else {
            checkTextAnswer();
          }
        }
      });

      const lockBtn = document.createElement('button');
      lockBtn.type = 'button';
      lockBtn.className = 'input-lock-btn';
      lockBtn.addEventListener('click', () => {
        if (session.answeredCurrent) return;
        haptic(10);
        if (lockedSet.has(i)) {
          lockedSet.delete(i);
        } else {
          lockedSet.add(i);
        }
        card.lockedIndices = Array.from(lockedSet).sort((a, b) => a - b);
        S.saveData(appData);
        applyRowLockVisual(i);
        updateSubmitAndHints();
        if (!lockedSet.has(i)) {
          inp.focus();
        }
      });

      const mark = document.createElement('span');
      mark.className = 'input-item-mark hidden';

      row.appendChild(inp);
      row.appendChild(lockBtn);
      row.appendChild(mark);
      item.appendChild(row);
      list.appendChild(item);

      inputs.push(inp);
      lockBtns.push(lockBtn);
      applyRowLockVisual(i);
    }

    updateSubmitAndHints();

    const firstActive = inputs.find((el) => !el.disabled);
    if (firstActive) {
      setTimeout(() => firstActive.focus(), 60);
    }
  }

  function normalizeAnswerString(str) {
    return String(str || '')
      .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
      .replace(/[\s　\$]/g, '')
      .toLowerCase();
  }

  function checkTextAnswer() {
    const card = getCurrentCard();
    if (!card || session.answeredCurrent) return;
    session.answeredCurrent = true;

    const targets = getInputTargetsForCard(card);
    const items = Array.from($('input-fields-list')?.querySelectorAll('.input-field-item') || []);
    const isMulti = targets.length > 1;
    const lockedSet = getCardLockedSet(card, targets.length);

    let activeTotal = 0;
    let activeCorrect = 0;

    targets.forEach((targetText, idx) => {
      const item = items[idx];
      const inp = item?.querySelector('.cloze-answer-input');
      const lockBtn = item?.querySelector('.input-lock-btn');
      const mark = item?.querySelector('.input-item-mark');
      const cleanAns = targetText.replace(/^\${1,2}|\${1,2}$/g, '');

      if (lockBtn) lockBtn.disabled = true;

      if (lockedSet.has(idx)) {
        if (inp) {
          inp.disabled = true;
          inp.classList.add('is-locked-result');
        }
        if (mark) {
          mark.classList.remove('hidden', 'ok', 'ng', 'locked');
          mark.classList.add('locked');
          mark.textContent = '🔒';
        }
        if (item) {
          const noteLine = document.createElement('div');
          noteLine.className = 'input-item-correct-hint is-locked-note' + (isMulti ? '' : ' no-badge');
          noteLine.textContent = `判定除外（答え: ${cleanAns}）`;
          item.appendChild(noteLine);
        }
        return;
      }

      activeTotal += 1;
      const rawUser = inp ? inp.value : '';
      const normUser = normalizeAnswerString(rawUser);
      const normTarget = normalizeAnswerString(targetText);
      const ok = normUser.length > 0 && normUser === normTarget;

      if (ok) activeCorrect += 1;

      if (inp) {
        inp.disabled = true;
        inp.classList.add(ok ? 'is-ok' : 'is-ng');
      }
      if (mark) {
        mark.classList.remove('hidden', 'ok', 'ng', 'locked');
        mark.classList.add(ok ? 'ok' : 'ng');
        mark.textContent = ok ? '◯' : '×';
      }
      if (!ok && item) {
        const hintLine = document.createElement('div');
        hintLine.className = 'input-item-correct-hint' + (isMulti ? '' : ' no-badge');
        hintLine.textContent = `正解: ${cleanAns}`;
        item.appendChild(hintLine);
      }
    });

    $('btn-submit-answer').classList.add('hidden');
    $('card-flipper').classList.add('is-flipped');

    const fb = $('input-feedback');
    fb.classList.remove('hidden', 'ok', 'ng', 'neutral');

    if (activeTotal === 0) {
      haptic(12);
      fb.classList.add('neutral');
      fb.textContent = '🔒 全枠ロック中：裏面の答えを確認して記録してください';
      const selfJudge = $('input-self-judge');
      selfJudge?.classList.remove('hidden');
      const wBtn = $('btn-input-self-wrong');
      const cBtn = $('btn-input-self-correct');
      if (wBtn) wBtn.onclick = () => animateButtonJudge(false);
      if (cBtn) cBtn.onclick = () => animateButtonJudge(true);
      return;
    }

    const isAllCorrect = activeCorrect === activeTotal;
    const lockedCount = lockedSet.size;
    haptic(isAllCorrect ? 15 : 35);

    fb.classList.add(isAllCorrect ? 'ok' : 'ng');
    const lockNote = lockedCount > 0 ? `（${lockedCount}箇所ロック除外）` : '';
    if (activeTotal > 1) {
      fb.textContent = isAllCorrect
        ? `◯ 対象${activeTotal}箇所 正解！${lockNote}`
        : `× 対象${activeTotal}箇所中 ${activeCorrect}箇所 正解${lockNote}`;
    } else {
      fb.textContent = isAllCorrect
        ? `◯ 正解！${lockNote}`
        : `× 不正解${lockNote}`;
    }

    const nextBtn = $('btn-input-next');
    nextBtn.classList.remove('hidden');
    nextBtn.onclick = () => recordAnswer(isAllCorrect);
    setTimeout(() => nextBtn.focus(), 60);
  }

  function recordAnswer(isCorrect) {
    const card = getCurrentCard();
    if (!card) return;

    S.pushUndo({
      phase: session.phase,
      mainIndex: session.mainIndex,
      mainStepsSinceReview: session.mainStepsSinceReview,
      wrongPool: [...session.wrongPool],
      reviewQueue: [...session.reviewQueue],
      reviewIndex: session.reviewIndex,
      cardId: card.id,
      cardStats: {
        correctCount: card.correctCount,
        wrongCount: card.wrongCount,
        srsLevel: card.srsLevel,
        nextReview: card.nextReview
      }
    });

    if (isCorrect) {
      card.correctCount += 1;
      card.srsLevel = Math.min(6, card.srsLevel + 1);
      const intervals = [1, 3, 7, 14, 30, 60];
      card.nextReview = Date.now() + intervals[card.srsLevel - 1] * 86400000;
    } else {
      card.wrongCount += 1;
      card.srsLevel = 0;
      card.nextReview = Date.now();
    }
    S.saveData(appData);

    if (session.phase === 'review') {
      if (isCorrect) {
        session.wrongPool = session.wrongPool.filter((id) => id !== card.id);
      }
      session.reviewIndex += 1;

      if (session.reviewIndex >= session.reviewQueue.length) {
        session.phase = 'main';
        session.reviewQueue = [];
        session.reviewIndex = 0;

        if (session.mainIndex >= session.mainQueue.length) {
          if (session.wrongPool.length > 0) {
            enterReviewMode();
          } else {
            showCompleteScreen();
          }
          return;
        }
      }
      renderCurrentStudyCard();
      return;
    }

    if (!isCorrect && !session.wrongPool.includes(card.id)) {
      session.wrongPool.push(card.id);
    }
    session.mainIndex += 1;
    session.mainStepsSinceReview += 1;

    if (settings.mode === 'smart') {
      const hitFiveWrong = session.wrongPool.length >= 5;
      const hitFiveCycle = session.mainStepsSinceReview >= 5 && session.wrongPool.length > 0;
      const hitEndWithWrong = session.mainIndex >= session.mainQueue.length && session.wrongPool.length > 0;

      if (hitFiveWrong || hitFiveCycle || hitEndWithWrong) {
        enterReviewMode();
        return;
      }
    }

    if (session.mainIndex >= session.mainQueue.length) {
      showCompleteScreen();
    } else {
      renderCurrentStudyCard();
    }
  }

  function enterReviewMode() {
    session.phase = 'review';
    session.reviewQueue = [...session.wrongPool];
    session.reviewIndex = 0;
    session.mainStepsSinceReview = 0;

    resetCardTransform(true);
    setStudyBehindVisible(false);

    $('review-count-label').textContent = `間違えた ${session.reviewQueue.length}問 を復習します`;
    $('review-interstitial').classList.remove('hidden');
  }

  function showCompleteScreen() {
    resetCardTransform(true);
    const deck = getActiveDeck();
    $('complete-summary').textContent = `${deck ? deck.title : ''} を完了しました`;
    $('complete-interstitial').classList.remove('hidden');
    haptic(25);
  }

  function performSilentUndo() {
    if (!session.active) return;
    const snap = S.popUndo();
    if (!snap) return;

    haptic(12);
    const deck = getActiveDeck();
    const card = deck?.cards.find((c) => c.id === snap.cardId);
    if (card && snap.cardStats) {
      Object.assign(card, snap.cardStats);
      S.saveData(appData);
    }

    session.phase = snap.phase;
    session.mainIndex = snap.mainIndex;
    session.mainStepsSinceReview = snap.mainStepsSinceReview;
    session.wrongPool = snap.wrongPool;
    session.reviewQueue = snap.reviewQueue;
    session.reviewIndex = snap.reviewIndex;

    $('review-interstitial').classList.add('hidden');
    $('complete-interstitial').classList.add('hidden');
    setStudyBehindVisible(true);
    renderCurrentStudyCard();
  }

  /* ==================== カードスワイプ＆横面ハイライト制御 ==================== */
  function animateButtonJudge(isCorrect) {
    if (!session.active || session.animatingJudge || session.answeredCurrent) return;
    session.animatingJudge = true;
    haptic(isCorrect ? 14 : 20);

    const cardEl = $('card-stage');
    const leftBadge = $('swipe-badge-left');
    const rightBadge = $('swipe-badge-right');
    const leftEdge = $('swipe-edge-left');
    const rightEdge = $('swipe-edge-right');

    if (cardEl) {
      cardEl.classList.remove('spring-back', 'swiping-left', 'swiping-right');
      cardEl.classList.add(isCorrect ? 'swiping-right' : 'swiping-left', 'btn-fly-out');
      const dir = isCorrect ? 1 : -1;
      cardEl.style.transform = `translate3d(${dir * 460}px, 24px, 0) rotate(${dir * 16}deg)`;
      cardEl.style.opacity = '0.12';
    }

    if (isCorrect) {
      if (rightBadge) {
        rightBadge.style.opacity = '1';
        rightBadge.classList.add('is-ready');
      }
      if (rightEdge) {
        rightEdge.style.opacity = '1';
        rightEdge.classList.add('is-ready');
      }
    } else {
      if (leftBadge) {
        leftBadge.style.opacity = '1';
        leftBadge.classList.add('is-ready');
      }
      if (leftEdge) {
        leftEdge.style.opacity = '1';
        leftEdge.classList.add('is-ready');
      }
    }

    setTimeout(() => {
      session.animatingJudge = false;
      recordAnswer(isCorrect);
    }, 240);
  }

  function resetCardTransform(instant = false) {
    const cardEl = $('card-stage');
    const leftBadge = $('swipe-badge-left');
    const rightBadge = $('swipe-badge-right');
    const leftEdge = $('swipe-edge-left');
    const rightEdge = $('swipe-edge-right');
    if (!cardEl) return;

    cardEl.classList.remove('swiping-left', 'swiping-right', 'btn-fly-out');

    if (instant) {
      cardEl.classList.remove('spring-back');
      cardEl.style.transition = 'none';
      cardEl.style.transform = 'translate3d(0, 0, 0) rotate(0deg)';
      cardEl.style.opacity = '1';
      void cardEl.offsetWidth;
      cardEl.style.transition = '';
    } else {
      cardEl.classList.add('spring-back');
      cardEl.style.transform = 'translate3d(0, 0, 0) rotate(0deg)';
      cardEl.style.opacity = '1';
    }

    if (leftBadge) {
      leftBadge.style.opacity = '0';
      leftBadge.classList.remove('is-ready');
    }
    if (rightBadge) {
      rightBadge.style.opacity = '0';
      rightBadge.classList.remove('is-ready');
    }
    if (leftEdge) {
      leftEdge.style.opacity = '0';
      leftEdge.classList.remove('is-ready');
    }
    if (rightEdge) {
      rightEdge.style.opacity = '0';
      rightEdge.classList.remove('is-ready');
    }
  }

  function initCardSwipeAndFlip() {
    const cardEl = $('card-stage');
    if (!cardEl) return;

    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let tracking = false;
    let lockedHorizontal = false;
    let aborted = false;
    let thresholdPassed = false;

    const isInteractiveTarget = (target) => {
      return Boolean(target && target.closest('button, input, textarea, select, .cloze-blank'));
    };

    cardEl.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1 || isInteractiveTarget(e.target)) return;
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      currentX = 0;
      tracking = true;
      lockedHorizontal = false;
      aborted = false;
      thresholdPassed = false;
      cardEl.classList.remove('spring-back');
    }, { passive: true });

    cardEl.addEventListener('touchmove', (e) => {
      if (!tracking || aborted || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      if (!lockedHorizontal) {
        if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx)) {
          aborted = true;
          resetCardTransform(false);
          return;
        }
        if (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.2) {
          lockedHorizontal = true;
        } else {
          return;
        }
      }

      if (lockedHorizontal) {
        e.preventDefault();
        currentX = dx;
        const threshold = Math.max(100, cardEl.clientWidth * 0.28);
        const ratio = Math.min(1, Math.abs(dx) / threshold);
        const isReady = ratio >= 1;

        if (isReady && !thresholdPassed) {
          thresholdPassed = true;
          haptic(15);
        } else if (!isReady) {
          thresholdPassed = false;
        }

        cardEl.style.transform = `translate3d(${dx}px, ${Math.abs(dx) * 0.04}px, 0) rotate(${dx * 0.035}deg)`;
        cardEl.classList.toggle('swiping-right', dx > 12);
        cardEl.classList.toggle('swiping-left', dx < -12);

        const rightBadge = $('swipe-badge-right');
        const leftBadge = $('swipe-badge-left');
        const rightEdge = $('swipe-edge-right');
        const leftEdge = $('swipe-edge-left');

        if (rightBadge) {
          rightBadge.style.opacity = dx > 0 ? String(ratio) : '0';
          rightBadge.classList.toggle('is-ready', dx > 0 && isReady);
        }
        if (leftBadge) {
          leftBadge.style.opacity = dx < 0 ? String(ratio) : '0';
          leftBadge.classList.toggle('is-ready', dx < 0 && isReady);
        }
        if (rightEdge) {
          rightEdge.style.opacity = dx > 0 ? String(Math.min(1, ratio * 1.15)) : '0';
          rightEdge.classList.toggle('is-ready', dx > 0 && isReady);
        }
        if (leftEdge) {
          leftEdge.style.opacity = dx < 0 ? String(Math.min(1, ratio * 1.15)) : '0';
          leftEdge.classList.toggle('is-ready', dx < 0 && isReady);
        }
      }
    }, { passive: false });

    const finishTouch = () => {
      if (!tracking) return;
      tracking = false;

      if (lockedHorizontal && !aborted) {
        suppressFlipUntil = Date.now() + 350;
        const threshold = Math.max(100, cardEl.clientWidth * 0.28);

        if (settings.format === 'flip' && Math.abs(currentX) >= threshold) {
          const isRight = currentX > 0;
          haptic(18);
          cardEl.classList.add('spring-back');
          cardEl.style.transform = `translate3d(${isRight ? 520 : -520}px, 30px, 0) rotate(${isRight ? 18 : -18}deg)`;
          setTimeout(() => recordAnswer(isRight), 160);
          return;
        }
      }
      resetCardTransform(false);
    };

    cardEl.addEventListener('touchend', finishTouch);
    cardEl.addEventListener('touchcancel', finishTouch);

    cardEl.addEventListener('click', (e) => {
      if (Date.now() < suppressFlipUntil) return;
      const cloze = e.target.closest('.cloze-blank');
      if (cloze && settings.redsheet) {
        cloze.classList.toggle('revealed');
        haptic(10);
        return;
      }
      if (isInteractiveTarget(e.target)) return;
      flipCard();
    });
  }

  /* ==================== CSV読み込み共通処理（フォルダ復元対応） ==================== */
  function handleCsvFileUpload(file, contextMode) {
    readCsvFileWithEncoding(file, (text) => {
      const result = S.parseCsvAuto(text);
      if (result.type === 'backup' && result.decks.length > 0) {
        const totalCards = result.decks.reduce((s, d) => s + d.cards.length, 0);
        const folderCount = (result.folders || []).length;
        const folderNote = folderCount > 0 ? `・${folderCount}個のフォルダ` : '';
        const replace = confirm(
          `全データバックアップCSV（${result.decks.length}個の単語帳${folderNote} / 計${totalCards}問）を検出しました。\n` +
          `「OK」＝ 現在のデータに追加して取り込む\n` +
          `「キャンセル」＝ 取り込みを中止`
        );
        if (!replace) return;

        // フォルダの統合・IDマッピング
        const importedFolderIdMap = new Map();
        (result.folders || []).forEach((impFolder) => {
          const existing = (appData.folders || []).find((f) => f.name === impFolder.name);
          if (existing) {
            importedFolderIdMap.set(impFolder.id, existing.id);
          } else {
            const newF = { id: S.uid('folder'), name: impFolder.name };
            appData.folders.push(newF);
            importedFolderIdMap.set(impFolder.id, newF.id);
          }
        });

        result.decks.forEach((d) => {
          d.folderId = d.folderId ? (importedFolderIdMap.get(d.folderId) || '') : '';
          appData.decks.push(d);
        });

        if (result.examDate && !appData.examDate) {
          appData.examDate = result.examDate;
        }
        S.saveData(appData);
        if (contextMode === 'home') {
          renderHomeView();
        } else {
          refreshDeckHeaderAndFilters();
          renderManageTab();
        }
        alert(`${result.decks.length}個の単語帳（計${totalCards}問）を復元しました！`);
      } else if (result.type === 'cards' && result.cards.length > 0) {
        const deck = getActiveDeck();
        if (!deck) return;
        deck.cards.push(...result.cards);
        S.saveData(appData);
        if (contextMode === 'home') {
          renderHomeView();
        } else {
          refreshDeckHeaderAndFilters();
          renderManageTab();
        }
        alert(`「${deck.title}」に ${result.cards.length}問 を追加しました！`);
      } else {
        alert('CSVから読み込める問題が見つかりませんでした。\n「見本CSVをDL」から形式を確認してください。');
      }
    });
  }

  /* ==================== イベント登録 ==================== */
  function bindEvents() {
    // テーマ切替
    $('btn-theme')?.addEventListener('click', () => {
      appData.theme = appData.theme === 'dark' ? 'light' : 'dark';
      S.saveData(appData);
      applyThemeAndRedsheet();
    });

    // ホーム画面：新規単語帳作成（フォルダ内なら自動でそのフォルダに作成）
    $('btn-new-deck')?.addEventListener('click', () => {
      const title = prompt('新しい単語帳の名前を入力:');
      if (!title || !title.trim()) return;
      const newDeck = {
        id: S.uid('deck'),
        folderId: currentFolderId || '',
        title: title.trim(),
        cards: []
      };
      appData.decks.push(newDeck);
      S.saveData(appData);
      openDeckView(newDeck.id);
      switchTab('manage');
    });

    // ホーム画面：新規フォルダ作成
    $('btn-new-folder')?.addEventListener('click', () => {
      const name = prompt('新しいフォルダの名前を入力（例：英語、日本史、定期テスト）:');
      if (!name || !name.trim()) return;
      const newFolder = { id: S.uid('folder'), name: name.trim() };
      appData.folders.push(newFolder);
      S.saveData(appData);
      haptic(12);
      showHomeView(newFolder.id);
    });

    // フォルダ内ナビゲーション：戻る・名前変更・削除
    $('btn-folder-back')?.addEventListener('click', () => {
      haptic(10);
      showHomeView(null);
    });

    $('btn-rename-folder')?.addEventListener('click', () => {
      const folder = getFolderById(currentFolderId);
      if (!folder) return;
      const next = prompt('フォルダ名を変更:', folder.name);
      if (!next || !next.trim()) return;
      folder.name = next.trim();
      S.saveData(appData);
      renderHomeView();
    });

    $('btn-delete-folder')?.addEventListener('click', () => {
      const folder = getFolderById(currentFolderId);
      if (!folder) return;
      if (!confirm(`フォルダ「${folder.name}」を削除しますか？\n※中の単語帳は削除されず、トップ一覧に戻ります。`)) return;
      appData.decks.forEach((d) => {
        if (d.folderId === folder.id) d.folderId = '';
      });
      appData.folders = appData.folders.filter((f) => f.id !== folder.id);
      S.saveData(appData);
      showHomeView(null);
    });

    // フォルダ移動モーダル内ボタン
    $('btn-move-create-folder')?.addEventListener('click', () => {
      const deck = appData.decks.find((d) => d.id === movingDeckId);
      if (!deck) return;
      const name = prompt('新しいフォルダの名前を入力:');
      if (!name || !name.trim()) return;
      const newFolder = { id: S.uid('folder'), name: name.trim() };
      appData.folders.push(newFolder);
      deck.folderId = newFolder.id;
      S.saveData(appData);
      haptic(12);
      closeFolderMoveModal();
      if (!$('view-home').classList.contains('hidden')) {
        renderHomeView();
      }
    });

    $('btn-move-cancel')?.addEventListener('click', closeFolderMoveModal);
    $('folder-move-modal')?.addEventListener('click', (e) => {
      if (e.target === $('folder-move-modal')) closeFolderMoveModal();
    });

    // ホーム画面：全データCSVバックアップ＆復元
    $('btn-home-export-csv')?.addEventListener('click', () => {
      const csv = S.generateFullBackupCsvText(appData);
      const dateStr = new Date().toISOString().slice(0, 10);
      downloadCsvFile(csv, `StudyLoop_全データバックアップ_${dateStr}.csv`);
    });

    $('home-import-csv')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      handleCsvFileUpload(file, 'home');
      e.target.value = '';
    });

    // デッキ詳細画面：戻る・フォルダ移動・リネーム・削除
    $('btn-back-home')?.addEventListener('click', () => {
      const deck = getActiveDeck();
      const targetFolderId = deck && deck.folderId && getFolderById(deck.folderId) ? deck.folderId : null;
      showHomeView(targetFolderId);
    });

    $('btn-move-deck-folder')?.addEventListener('click', () => {
      const deck = getActiveDeck();
      if (!deck) return;
      openFolderMoveModal(deck.id);
    });

    $('btn-rename-deck')?.addEventListener('click', () => {
      const deck = getActiveDeck();
      if (!deck) return;
      const next = prompt('単語帳の名前を変更:', deck.title);
      if (!next || !next.trim()) return;
      deck.title = next.trim();
      S.saveData(appData);
      refreshDeckHeaderAndFilters();
    });

    $('btn-delete-deck')?.addEventListener('click', () => {
      if (appData.decks.length <= 1) {
        alert('最後の単語帳は削除できません。');
        return;
      }
      const deck = getActiveDeck();
      if (!confirm(`「${deck.title}」を削除しますか？`)) return;
      const prevFolderId = deck.folderId && getFolderById(deck.folderId) ? deck.folderId : null;
      appData.decks = appData.decks.filter((d) => d.id !== deck.id);
      appData.activeDeckId = appData.decks[0].id;
      S.saveData(appData);
      showHomeView(prevFolderId);
    });

    // タブ切替
    document.querySelectorAll('.seg-tab').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // カテゴリ絞り込み
    $('category-filter')?.addEventListener('change', (e) => {
      settings.category = e.target.value;
      updateStartTargetCount();
    });

    // 進行ルール選択
    document.querySelectorAll('.mode-row').forEach((btn) => {
      btn.addEventListener('click', () => {
        haptic(8);
        settings.mode = btn.dataset.mode;
        document.querySelectorAll('.mode-row').forEach((b) => b.classList.toggle('active', b === btn));
        updateStartTargetCount();
      });
    });

    // 出題形式選択
    document.querySelectorAll('.fmt-seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        haptic(8);
        settings.format = btn.dataset.format;
        document.querySelectorAll('.fmt-seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
      });
    });

    // オプション（トグルスイッチ）
    $('opt-reverse')?.addEventListener('change', (e) => {
      settings.reverse = e.target.checked;
      haptic(8);
    });

    $('opt-shuffle')?.addEventListener('change', (e) => {
      settings.shuffle = e.target.checked;
      haptic(8);
    });

    $('opt-redsheet')?.addEventListener('change', (e) => {
      settings.redsheet = e.target.checked;
      haptic(8);
      applyThemeAndRedsheet();
    });

    // 試験日
    $('exam-date')?.addEventListener('change', (e) => {
      appData.examDate = e.target.value;
      S.saveData(appData);
      updateExamCountdown();
    });

    // 学習開始・履歴リセット
    $('btn-start-study')?.addEventListener('click', startStudySession);

    $('btn-reset-progress')?.addEventListener('click', () => {
      const deck = getActiveDeck();
      if (!deck || !confirm('この単語帳の正誤履歴をリセットしますか？')) return;
      deck.cards.forEach((c) => {
        c.correctCount = 0;
        c.wrongCount = 0;
        c.srsLevel = 0;
        c.nextReview = 0;
      });
      S.saveData(appData);
      refreshDeckHeaderAndFilters();
      alert('学習履歴をリセットしました。');
    });

    // 学習画面内ボタン
    $('btn-exit-study')?.addEventListener('click', exitStudySession);
    $('btn-study-redsheet')?.addEventListener('click', () => {
      settings.redsheet = !settings.redsheet;
      haptic(10);
      applyThemeAndRedsheet();
    });
    $('btn-undo')?.addEventListener('click', performSilentUndo);

    // 表面・裏面両方のピン留めボタン
    [$('btn-pin-front'), $('btn-pin-back')].forEach((btn) => {
      btn?.addEventListener('click', (e) => {
        e.stopPropagation();
        const card = getCurrentCard();
        if (!card) return;
        card.pinned = !card.pinned;
        S.saveData(appData);
        haptic(12);
        syncPinButtons(card.pinned);
      });
    });

    $('btn-hint')?.addEventListener('click', (e) => {
      e.stopPropagation();
      $('hint-text').classList.toggle('hidden');
    });

    $('btn-wrong')?.addEventListener('click', () => animateButtonJudge(false));
    $('btn-correct')?.addEventListener('click', () => animateButtonJudge(true));

    $('btn-start-review')?.addEventListener('click', () => {
      $('review-interstitial').classList.add('hidden');
      setStudyBehindVisible(true);
      renderCurrentStudyCard();
    });

    $('btn-restart-session')?.addEventListener('click', startStudySession);
    $('btn-complete-home')?.addEventListener('click', exitStudySession);

    // 赤文字入力判定
    $('btn-submit-answer')?.addEventListener('click', checkTextAnswer);

    // 一覧シート
    $('sheet-redsheet-toggle')?.addEventListener('click', () => {
      settings.redsheet = !settings.redsheet;
      applyThemeAndRedsheet();
    });
    $('btn-print-sheet')?.addEventListener('click', () => window.print());

    // 管理タブ：CSV操作
    $('btn-download-sample-csv')?.addEventListener('click', () => {
      downloadCsvFile(S.generateSampleCsvText(), 'StudyLoop_見本サンプル.csv');
    });

    $('btn-export-csv')?.addEventListener('click', () => {
      const deck = getActiveDeck();
      if (!deck) return;
      downloadCsvFile(S.generateDeckCsvText(deck), `${deck.title}.csv`);
    });

    $('btn-export-all-csv')?.addEventListener('click', () => {
      const dateStr = new Date().toISOString().slice(0, 10);
      downloadCsvFile(S.generateFullBackupCsvText(appData), `StudyLoop_全データバックアップ_${dateStr}.csv`);
    });

    $('import-csv-file')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      handleCsvFileUpload(file, 'deck');
      e.target.value = '';
    });

    // 管理タブ：AI指示文コピー・一括インポート
    $('btn-copy-prompt')?.addEventListener('click', async () => {
      const promptText = `この内容からテスト対策用の単語カードを作成してください。\n赤シート機能で隠せるよう、重要な語句や公式は【 】で囲んでください。\n数式や化学式はLaTeX形式（インラインは $...$ 、大きな式は $$...$$ ）で記述してください。\n出力は以下の形式で、1行につき1問のコードブロックのみを出力してください（前後の挨拶不要）。\n\nカテゴリ名 | 問題文（表面） | 【重要語句や数式】を含む答え（裏面） | ヒント`;
      try {
        await navigator.clipboard.writeText(promptText);
        $('btn-copy-prompt').textContent = 'コピー完了！';
        setTimeout(() => { $('btn-copy-prompt').textContent = '📋 AI用プロンプトコピー'; }, 1500);
      } catch (_) {
        prompt('以下をコピーしてください:', promptText);
      }
    });

    $('btn-import')?.addEventListener('click', () => {
      const raw = $('import-text')?.value || '';
      const newCards = S.parseImportText(raw);
      if (newCards.length === 0) {
        alert('読み込める問題がありません。「カテゴリ | 問題 | 答え | ヒント」の形式で入力してください。');
        return;
      }
      const deck = getActiveDeck();
      deck.cards.push(...newCards);
      S.saveData(appData);
      $('import-text').value = '';
      refreshDeckHeaderAndFilters();
      renderManageTab();
      alert(`${newCards.length}問を追加しました。`);
    });

    // 管理タブ：画像圧縮付き1問追加
    $('new-card-image')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const maxW = 720;
          const scale = Math.min(1, maxW / img.width);
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          pendingImageDataUrl = canvas.toDataURL('image/jpeg', 0.78);
          $('new-card-image-preview').textContent = file.name;
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });

    $('btn-add-single')?.addEventListener('click', () => {
      const front = ($('new-card-front')?.value || '').trim();
      const back = ($('new-card-back')?.value || '').trim();
      if (!front || !back) return;
      const deck = getActiveDeck();
      deck.cards.push(S.normalizeCard({
        category: $('new-card-cat')?.value || '一般',
        front,
        back,
        hint: $('new-card-hint')?.value || '',
        image: pendingImageDataUrl
      }));
      S.saveData(appData);
      $('new-card-front').value = '';
      $('new-card-back').value = '';
      $('new-card-hint').value = '';
      $('new-card-image-preview').textContent = '画像なし';
      pendingImageDataUrl = '';
      refreshDeckHeaderAndFilters();
      renderManageTab();
    });

    // 検索・モーダルイベント
    $('manage-search')?.addEventListener('input', renderManageTab);

    $('btn-edit-cancel')?.addEventListener('click', closeEditModal);
    $('btn-edit-save')?.addEventListener('click', () => {
      const deck = getActiveDeck();
      const card = deck?.cards.find((c) => c.id === editingCardId);
      if (!card) return;
      const nextFront = $('edit-card-front').value.trim();
      const nextBack = $('edit-card-back').value.trim();
      if (!nextFront || !nextBack) {
        alert('表面と裏面は空欄にできません。');
        return;
      }
      card.category = $('edit-card-cat').value.trim() || '一般';
      card.front = nextFront;
      card.back = nextBack;
      card.hint = $('edit-card-hint').value.trim();
      S.saveData(appData);
      closeEditModal();
      refreshDeckHeaderAndFilters();
      renderManageTab();
    });

    // キーボード操作
    document.addEventListener('keydown', (e) => {
      if (!session.active) return;
      if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
      if (e.key === 'z' || e.key === 'Z' || e.key === 'Backspace') {
        e.preventDefault();
        performSilentUndo();
      } else if (settings.format === 'flip') {
        if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          flipCard();
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          animateButtonJudge(true);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          animateButtonJudge(false);
        }
      }
    });
  }

  /* ==================== 初期化 ==================== */
  document.addEventListener('DOMContentLoaded', () => {
    try {
      applyThemeAndRedsheet();
      bindEvents();
      initCardSwipeAndFlip();
      showHomeView(null);
    } catch (err) {
      console.error('Init error:', err);
    }
  });
})();
