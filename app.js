(function () {
  const S = window.StudyStorage;
  let appData = S.loadData();

  const settings = {
    mode: 'smart',      // 'smart' | 'all' | 'weak' | 'srs'
    format: 'flip',     // 'flip' | 'choice' | 'input'
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
    answeredCurrent: false
  };

  let pendingImageDataUrl = '';
  let suppressFlipUntil = 0;

  const $ = (id) => document.getElementById(id);

  function getActiveDeck() {
    return appData.decks.find((d) => d.id === appData.activeDeckId) || appData.decks[0];
  }

  function applyThemeAndRedsheet() {
    document.body.classList.toggle('dark', appData.theme === 'dark');
    document.body.classList.toggle('redsheet-on', settings.redsheet);
    const optBtn = $('opt-redsheet');
    if (optBtn) {
      optBtn.textContent = `赤シート: ${settings.redsheet ? 'ON' : 'OFF'}`;
      optBtn.classList.toggle('active', settings.redsheet);
    }
    const studyBtn = $('btn-study-redsheet');
    if (studyBtn) {
      studyBtn.classList.toggle('active', settings.redsheet);
    }
  }

  function checkIncomingShareHash() {
    const hash = window.location.hash || '';
    if (!hash.startsWith('#share=')) return;
    try {
      const payload = hash.slice(7);
      const sharedDeck = S.decodeSharePayload(payload);
      if (sharedDeck && sharedDeck.cards.length > 0) {
        appData.decks.push(sharedDeck);
        appData.activeDeckId = sharedDeck.id;
        S.saveData(appData);
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    } catch (e) {
      console.warn('Share decode failed:', e);
    }
  }

  /* ==================== 設定画面レンダリング ==================== */
  function renderDeckSelector() {
    const sel = $('deck-select');
    if (!sel) return;
    sel.innerHTML = '';
    appData.decks.forEach((deck) => {
      const opt = document.createElement('option');
      opt.value = deck.id;
      opt.textContent = `${deck.title} (${deck.cards.length}問)`;
      if (deck.id === appData.activeDeckId) opt.selected = true;
      sel.appendChild(opt);
    });
    updateExamCountdown();
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
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    document.querySelectorAll('.tab-panel').forEach((panel) => {
      panel.classList.toggle('active', panel.id === `panel-${tabName}`);
    });
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
      <div class="stat-box"><div class="stat-val">${mastered}</div><div class="stat-lbl">定着済み</div></div>
      <div class="stat-box"><div class="stat-val">${weak}</div><div class="stat-lbl">苦手・★ピン</div></div>
      <div class="stat-box"><div class="stat-val">${acc}%</div><div class="stat-lbl">通算正答率</div></div>
    `;
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
      info.innerHTML = `<strong>[${card.category}]</strong> ${card.front}<br><span class="muted-small">${card.back}</span>`;

      const btns = document.createElement('div');
      btns.className = 'manage-item-btns';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn-icon';
      editBtn.textContent = '✎';
      editBtn.addEventListener('click', () => {
        const nextFront = prompt('表面（Q）を編集:', card.front);
        if (nextFront === null) return;
        const nextBack = prompt('裏面（A）を編集:', card.back);
        if (nextBack === null) return;
        const nextCat = prompt('カテゴリを編集:', card.category);
        if (nextCat !== null) card.category = nextCat.trim() || '一般';
        card.front = nextFront.trim() || card.front;
        card.back = nextBack.trim() || card.back;
        S.saveData(appData);
        renderManageTab();
      });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn-icon';
      delBtn.textContent = '×';
      delBtn.addEventListener('click', () => {
        deck.cards.splice(idx, 1);
        S.saveData(appData);
        renderDeckSelector();
        renderManageTab();
      });

      btns.appendChild(editBtn);
      btns.appendChild(delBtn);
      item.appendChild(info);
      item.appendChild(btns);
      list.appendChild(item);
    });
  }

  /* ==================== 学習セッション＆復習ロジック ==================== */
  function buildQueueForMode(deck) {
    const now = Date.now();
    let list = [...deck.cards];
    if (settings.mode === 'weak') {
      list = list.filter((c) => c.wrongCount > c.correctCount || c.pinned);
    } else if (settings.mode === 'srs') {
      const due = list.filter((c) => !c.nextReview || c.nextReview <= now);
      if (due.length > 0) list = due;
    }
    if (settings.shuffle) {
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
    }
    return list.map((c) => c.id);
  }

  function startStudySession() {
    const deck = getActiveDeck();
    if (!deck || deck.cards.length === 0) return;

    const queue = buildQueueForMode(deck);
    if (queue.length === 0) {
      alert('該当する問題がありません。進行ルールを変更してください。');
      return;
    }

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

    $('view-setup').classList.add('hidden');
    $('view-study').classList.remove('hidden');
    $('review-interstitial').classList.add('hidden');
    $('complete-interstitial').classList.add('hidden');

    renderCurrentStudyCard();
  }

  function exitStudySession() {
    session.active = false;
    $('view-study').classList.add('hidden');
    $('view-setup').classList.remove('hidden');
    renderDeckSelector();
  }

  function getCurrentCard() {
    const deck = getActiveDeck();
    if (!deck) return null;
    const cardId = session.phase === 'review'
      ? session.reviewQueue[session.reviewIndex]
      : session.mainQueue[session.mainIndex];
    return deck.cards.find((c) => c.id === cardId) || null;
  }

  function renderCurrentStudyCard() {
    const card = getCurrentCard();
    if (!card) {
      showCompleteScreen();
      return;
    }

    session.isFlipped = false;
    session.answeredCurrent = false;

    // 進捗表示
    const isReview = session.phase === 'review';
    const cur = isReview ? session.reviewIndex + 1 : session.mainIndex + 1;
    const total = isReview ? session.reviewQueue.length : session.mainQueue.length;
    $('progress-fill').style.width = `${Math.min(100, Math.round((cur / total) * 100))}%`;
    $('progress-text').textContent = `${cur} / ${total}`;
    $('study-phase-badge').textContent = isReview
      ? '復習中'
      : (session.wrongPool.length > 0 ? `間違い蓄積: ${session.wrongPool.length}/5` : '');

    // ピン留め状態
    const pinBtn = $('btn-pin');
    pinBtn.textContent = card.pinned ? '★' : '☆';
    pinBtn.classList.toggle('pinned', card.pinned);

    // 表裏のテキスト準備（逆向き対応）
    const frontText = settings.reverse
      ? S.extractClozeTargets(card.back).join(' / ')
      : card.front;
    const backText = settings.reverse
      ? `${card.front}\n\n${card.back}`
      : card.back;

    S.renderContent($('front-content'), frontText);
    S.renderContent($('back-content'), backText);

    // 画像
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

    // ヒント（表面のみ）
    const hintBtn = $('btn-hint');
    const hintBox = $('hint-text');
    hintBox.classList.add('hidden');
    if (card.hint && !settings.reverse) {
      hintBtn.classList.remove('hidden');
      S.renderContent(hintBox, card.hint);
    } else {
      hintBtn.classList.add('hidden');
    }

    // 表裏表示リセット
    $('card-front').classList.remove('hidden');
    $('card-back').classList.add('hidden');
    resetCardTransform();

    // 下部UI切替
    $('flip-controls').classList.toggle('hidden', settings.format !== 'flip');
    $('choice-container').classList.toggle('hidden', settings.format !== 'choice');
    $('input-container').classList.toggle('hidden', settings.format !== 'input');

    if (settings.format === 'choice') renderMultipleChoice(card);
    if (settings.format === 'input') prepareInputMode();
  }

  function flipCard(forceState) {
    if (settings.format !== 'flip') return;
    session.isFlipped = typeof forceState === 'boolean' ? forceState : !session.isFlipped;
    $('card-front').classList.toggle('hidden', session.isFlipped);
    $('card-back').classList.toggle('hidden', !session.isFlipped);
  }

  function renderMultipleChoice(card) {
    const container = $('choice-container');
    const deck = getActiveDeck();
    container.innerHTML = '';

    const correctLabel = settings.reverse
      ? card.front
      : S.extractClozeTargets(card.back).join(' / ');

    // 同カテゴリ優先でダミー候補を収集
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
    // シャッフルして3つ抽出
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
      // 選択肢内は赤シートで隠さず数式のみ描画
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
        btn.classList.add(isCorrect ? 'is-correct' : 'is-wrong');
        if (!isCorrect) {
          Array.from(container.children).forEach((child, idx) => {
            if (options[idx] === correctLabel) child.classList.add('is-correct');
          });
        }
        $('card-front').classList.add('hidden');
        $('card-back').classList.remove('hidden');
        setTimeout(() => recordAnswer(isCorrect), isCorrect ? 500 : 1100);
      });
      container.appendChild(btn);
    });
  }

  function prepareInputMode() {
    const input = $('answer-input');
    const fb = $('input-feedback');
    const nextBtn = $('btn-input-next');
    input.value = '';
    input.disabled = false;
    fb.classList.add('hidden');
    nextBtn.classList.add('hidden');
    $('btn-submit-answer').classList.remove('hidden');
    setTimeout(() => input.focus(), 60);
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

    const userVal = normalizeAnswerString($('answer-input').value);
    const targets = settings.reverse ? [card.front] : S.extractClozeTargets(card.back);
    const isCorrect = targets.some((t) => normalizeAnswerString(t) === userVal && userVal.length > 0);

    $('answer-input').disabled = true;
    $('btn-submit-answer').classList.add('hidden');
    $('card-front').classList.add('hidden');
    $('card-back').classList.remove('hidden');

    const fb = $('input-feedback');
    fb.classList.remove('hidden', 'ok', 'ng');
    fb.classList.add(isCorrect ? 'ok' : 'ng');
    fb.textContent = isCorrect ? '◯ 正解' : `× 正解: ${targets.join(' / ')}`;

    const nextBtn = $('btn-input-next');
    nextBtn.classList.remove('hidden');
    nextBtn.onclick = () => recordAnswer(isCorrect);
  }

  function recordAnswer(isCorrect) {
    const card = getCurrentCard();
    if (!card) return;

    // 無音Undo用スナップショット保存
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

    // カード成績更新
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

    // 進行ロジック分岐
    if (session.phase === 'review') {
      if (isCorrect) {
        session.wrongPool = session.wrongPool.filter((id) => id !== card.id);
      }
      session.reviewIndex += 1;

      // 復習1周が終わったら告知画面なしでそのまま未学習へ戻る
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

    // phase === 'main'
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

    $('review-count-label').textContent = `${session.reviewQueue.length}問`;
    $('review-interstitial').classList.remove('hidden');
  }

  function showCompleteScreen() {
    const deck = getActiveDeck();
    $('complete-summary').textContent = `${deck ? deck.title : ''} を完了しました`;
    $('complete-interstitial').classList.remove('hidden');
  }

  function performSilentUndo() {
    if (!session.active) return;
    const snap = S.popUndo();
    if (!snap) return;

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
    renderCurrentStudyCard();
  }

  /* ==================== カードスワイプ制御（表面・裏面両対応） ==================== */
  function resetCardTransform() {
    const cardEl = $('card-stage');
    const leftBadge = $('swipe-badge-left');
    const rightBadge = $('swipe-badge-right');
    if (!cardEl) return;
    cardEl.classList.add('spring-back');
    cardEl.style.transform = 'translate3d(0, 0, 0) rotate(0deg)';
    if (leftBadge) leftBadge.style.opacity = '0';
    if (rightBadge) rightBadge.style.opacity = '0';
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
          resetCardTransform();
          return;
        }
        if (Math.abs(dx) > 16 && Math.abs(dx) > Math.abs(dy) * 1.25) {
          lockedHorizontal = true;
        } else {
          return;
        }
      }

      if (lockedHorizontal) {
        e.preventDefault();
        currentX = dx;
        const threshold = Math.max(105, cardEl.clientWidth * 0.30);
        const ratio = Math.min(1, Math.abs(dx) / threshold);
        cardEl.style.transform = `translate3d(${dx}px, ${Math.abs(dx) * 0.04}px, 0) rotate(${dx * 0.035}deg)`;
        $('swipe-badge-right').style.opacity = dx > 0 ? String(ratio) : '0';
        $('swipe-badge-left').style.opacity = dx < 0 ? String(ratio) : '0';
      }
    }, { passive: false });

    const finishTouch = () => {
      if (!tracking) return;
      tracking = false;

      if (lockedHorizontal && !aborted) {
        suppressFlipUntil = Date.now() + 350;
        const threshold = Math.max(105, cardEl.clientWidth * 0.30);

        if (settings.format === 'flip' && Math.abs(currentX) >= threshold) {
          const isRight = currentX > 0;
          cardEl.classList.add('spring-back');
          cardEl.style.transform = `translate3d(${isRight ? 520 : -520}px, 30px, 0) rotate(${isRight ? 18 : -18}deg)`;
          setTimeout(() => recordAnswer(isRight), 150);
          return;
        }
      }
      resetCardTransform();
    };

    cardEl.addEventListener('touchend', finishTouch);
    cardEl.addEventListener('touchcancel', finishTouch);

    // タップで表面 Q ⇔ 裏面 A 反転（赤シートピーキングにも対応）
    cardEl.addEventListener('click', (e) => {
      if (Date.now() < suppressFlipUntil) return;
      const cloze = e.target.closest('.cloze-blank');
      if (cloze && settings.redsheet) {
        cloze.classList.toggle('revealed');
        return;
      }
      if (isInteractiveTarget(e.target)) return;
      flipCard();
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

    // デッキ操作
    $('deck-select')?.addEventListener('change', (e) => {
      appData.activeDeckId = e.target.value;
      S.saveData(appData);
      updateExamCountdown();
      switchTab(document.querySelector('.tab-btn.active')?.dataset.tab || 'setup');
    });

    $('btn-new-deck')?.addEventListener('click', () => {
      const title = prompt('新しいデッキ名を入力:');
      if (!title || !title.trim()) return;
      const newDeck = { id: S.uid('deck'), title: title.trim(), cards: [] };
      appData.decks.push(newDeck);
      appData.activeDeckId = newDeck.id;
      S.saveData(appData);
      renderDeckSelector();
      switchTab('manage');
    });

    $('btn-rename-deck')?.addEventListener('click', () => {
      const deck = getActiveDeck();
      if (!deck) return;
      const next = prompt('デッキ名を変更:', deck.title);
      if (!next || !next.trim()) return;
      deck.title = next.trim();
      S.saveData(appData);
      renderDeckSelector();
    });

    $('btn-delete-deck')?.addEventListener('click', () => {
      if (appData.decks.length <= 1) {
        alert('最後のデッキは削除できません。');
        return;
      }
      const deck = getActiveDeck();
      if (!confirm(`「${deck.title}」を削除しますか？`)) return;
      appData.decks = appData.decks.filter((d) => d.id !== deck.id);
      appData.activeDeckId = appData.decks[0].id;
      S.saveData(appData);
      renderDeckSelector();
    });

    // タブ切替
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // 進行ルール選択
    document.querySelectorAll('.mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        settings.mode = btn.dataset.mode;
        document.querySelectorAll('.mode-btn').forEach((b) => b.classList.toggle('active', b === btn));
      });
    });

    // 出題形式選択
    document.querySelectorAll('.format-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        settings.format = btn.dataset.format;
        document.querySelectorAll('.format-btn').forEach((b) => b.classList.toggle('active', b === btn));
      });
    });

    // オプション切替
    $('opt-reverse')?.addEventListener('click', (e) => {
      settings.reverse = !settings.reverse;
      e.currentTarget.textContent = settings.reverse ? '逆向き（A→Q）' : '通常（Q→A）';
      e.currentTarget.classList.toggle('active', settings.reverse);
    });

    $('opt-shuffle')?.addEventListener('click', (e) => {
      settings.shuffle = !settings.shuffle;
      e.currentTarget.textContent = settings.shuffle ? 'シャッフル' : '登録順';
      e.currentTarget.classList.toggle('active', settings.shuffle);
    });

    $('opt-redsheet')?.addEventListener('click', () => {
      settings.redsheet = !settings.redsheet;
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
      if (!deck || !confirm('このデッキの正誤履歴をリセットしますか？')) return;
      deck.cards.forEach((c) => {
        c.correctCount = 0;
        c.wrongCount = 0;
        c.srsLevel = 0;
        c.nextReview = 0;
      });
      S.saveData(appData);
      renderDeckSelector();
    });

    // 学習画面内ボタン
    $('btn-exit-study')?.addEventListener('click', exitStudySession);
    $('btn-study-redsheet')?.addEventListener('click', () => {
      settings.redsheet = !settings.redsheet;
      applyThemeAndRedsheet();
    });
    $('btn-undo')?.addEventListener('click', performSilentUndo);

    $('btn-pin')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = getCurrentCard();
      if (!card) return;
      card.pinned = !card.pinned;
      S.saveData(appData);
      $('btn-pin').textContent = card.pinned ? '★' : '☆';
      $('btn-pin').classList.toggle('pinned', card.pinned);
    });

    $('btn-hint')?.addEventListener('click', (e) => {
      e.stopPropagation();
      $('hint-text').classList.toggle('hidden');
    });

    $('btn-wrong')?.addEventListener('click', () => recordAnswer(false));
    $('btn-correct')?.addEventListener('click', () => recordAnswer(true));

    $('btn-start-review')?.addEventListener('click', () => {
      $('review-interstitial').classList.add('hidden');
      renderCurrentStudyCard();
    });

    $('btn-restart-session')?.addEventListener('click', startStudySession);
    $('btn-complete-home')?.addEventListener('click', exitStudySession);

    // 赤文字入力判定
    $('btn-submit-answer')?.addEventListener('click', checkTextAnswer);
    $('answer-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') checkTextAnswer();
    });

    // 一覧シート
    $('sheet-redsheet-toggle')?.addEventListener('click', () => {
      settings.redsheet = !settings.redsheet;
      applyThemeAndRedsheet();
    });
    $('btn-print-sheet')?.addEventListener('click', () => window.print());

    // 管理タブ：AI指示文コピー・一括インポート
    $('btn-copy-prompt')?.addEventListener('click', async () => {
      const promptText = `この内容からテスト対策用の単語カードを作成してください。\n赤シート機能で隠せるよう、重要な語句や公式は【 】で囲んでください。\n数式や化学式はLaTeX形式（インラインは $...$ 、大きな式は $$...$$ ）で記述してください。\n出力は以下の形式で、1行につき1問のコードブロックのみを出力してください（前後の挨拶不要）。\n\nカテゴリ名 | 問題文（表面） | 【重要語句や数式】を含む答え（裏面） | ヒント`;
      try {
        await navigator.clipboard.writeText(promptText);
        $('btn-copy-prompt').textContent = 'コピー完了';
        setTimeout(() => { $('btn-copy-prompt').textContent = 'AI用指示文をコピー'; }, 1500);
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
      renderDeckSelector();
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
      renderDeckSelector();
      renderManageTab();
    });

    // JSON出力・読込・URL共有
    $('btn-export-json')?.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(appData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `studyloop_backup_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

    $('import-json-file')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const parsed = JSON.parse(ev.target.result);
          if (parsed && Array.isArray(parsed.decks) && parsed.decks.length > 0) {
            appData = parsed;
            S.saveData(appData);
            renderDeckSelector();
            renderManageTab();
            alert('バックアップを復元しました。');
          }
        } catch (_) {
          alert('JSONファイルの読み込みに失敗しました。');
        }
      };
      reader.readAsText(file);
    });

    $('btn-share-url')?.addEventListener('click', () => {
      const deck = getActiveDeck();
      if (!deck) return;
      const encoded = S.encodeSharePayload(deck);
      const url = `${window.location.origin}${window.location.pathname}#share=${encoded}`;
      const box = $('share-output');
      box.classList.remove('hidden');
      box.textContent = url;
      if (navigator.clipboard) navigator.clipboard.writeText(url).catch(() => {});
    });

    $('manage-search')?.addEventListener('input', renderManageTab);

    // キーボード操作（PC/外付けキーボード対応）
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
          recordAnswer(true);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          recordAnswer(false);
        }
      }
    });
  }

  /* ==================== 初期化 ==================== */
  document.addEventListener('DOMContentLoaded', () => {
    try {
      checkIncomingShareHash();
      applyThemeAndRedsheet();
      renderDeckSelector();
      bindEvents();
      initCardSwipeAndFlip();
    } catch (err) {
      console.error('Init error:', err);
    }
  });
})();
