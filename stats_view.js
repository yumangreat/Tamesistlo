(function () {
  const state = {
    filter: 'all',      // 'all' | 'mastered' | 'weak' | 'unstudied' | 'pinned'
    sort: 'wrong_desc', // 'wrong_desc' | 'acc_asc' | 'correct_desc' | 'default'
    category: 'ALL'
  };

  function getCardStatus(card) {
    const c = Number(card.correctCount || 0);
    const w = Number(card.wrongCount || 0);
    if (c === 0 && w === 0) return 'unstudied';
    if (c > 0 && c >= w) return 'mastered';
    return 'weak';
  }

  function getCardAccuracy(card) {
    const c = Number(card.correctCount || 0);
    const w = Number(card.wrongCount || 0);
    const total = c + w;
    if (total === 0) return null;
    return Math.round((c / total) * 100);
  }

  function render(deck, onSave) {
    const root = document.getElementById('stats-detail-container');
    if (!root || !deck) return;

    const S = window.StudyStorage;
    const cards = deck.cards || [];

    // 単元リストの整合性チェック
    const cats = Array.from(new Set(cards.map((c) => c.category || '一般')));
    if (state.category !== 'ALL' && !cats.includes(state.category)) {
      state.category = 'ALL';
    }

    // カウント集計（単元絞り込み反映）
    const baseCards = state.category === 'ALL'
      ? cards
      : cards.filter((c) => (c.category || '一般') === state.category);

    const counts = {
      all: baseCards.length,
      mastered: baseCards.filter((c) => getCardStatus(c) === 'mastered').length,
      weak: baseCards.filter((c) => getCardStatus(c) === 'weak').length,
      unstudied: baseCards.filter((c) => getCardStatus(c) === 'unstudied').length,
      pinned: baseCards.filter((c) => Boolean(c.pinned)).length
    };

    // フィルター適用
    let filtered = baseCards.map((card, idx) => ({ card, idx }));
    if (state.filter === 'mastered') {
      filtered = filtered.filter(({ card }) => getCardStatus(card) === 'mastered');
    } else if (state.filter === 'weak') {
      filtered = filtered.filter(({ card }) => getCardStatus(card) === 'weak');
    } else if (state.filter === 'unstudied') {
      filtered = filtered.filter(({ card }) => getCardStatus(card) === 'unstudied');
    } else if (state.filter === 'pinned') {
      filtered = filtered.filter(({ card }) => Boolean(card.pinned));
    }

    // ソート適用
    filtered.sort((a, b) => {
      const ca = Number(a.card.correctCount || 0);
      const wa = Number(a.card.wrongCount || 0);
      const cb = Number(b.card.correctCount || 0);
      const wb = Number(b.card.wrongCount || 0);

      if (state.sort === 'wrong_desc') {
        if (wb !== wa) return wb - wa;
        const diffA = wa - ca;
        const diffB = wb - cb;
        if (diffB !== diffA) return diffB - diffA;
        return a.idx - b.idx;
      }
      if (state.sort === 'acc_asc') {
        const accA = getCardAccuracy(a.card);
        const accB = getCardAccuracy(b.card);
        if (accA === null && accB === null) return a.idx - b.idx;
        if (accA === null) return 1;
        if (accB === null) return -1;
        if (accA !== accB) return accA - accB;
        return wb - wa;
      }
      if (state.sort === 'correct_desc') {
        if (cb !== ca) return cb - ca;
        return wa - wb;
      }
      return a.idx - b.idx;
    });

    root.innerHTML = '';

    const heading = document.createElement('div');
    heading.className = 'group-heading';
    heading.textContent = '問題別の成績・ミス分析';
    root.appendChild(heading);

    // フィルターチップ行
    const chipDefs = [
      { key: 'all', label: `すべて (${counts.all})` },
      { key: 'mastered', label: `定着済み (${counts.mastered})` },
      { key: 'weak', label: `苦手 (${counts.weak})` },
      { key: 'unstudied', label: `未学習 (${counts.unstudied})` },
      { key: 'pinned', label: `★ピン (${counts.pinned})` }
    ];

    const chipBar = document.createElement('div');
    chipBar.className = 'stats-filter-chips';
    chipDefs.forEach((def) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'stats-chip' + (state.filter === def.key ? ' active' : '');
      btn.dataset.filter = def.key;
      btn.textContent = def.label;
      btn.addEventListener('click', () => {
        state.filter = def.key;
        render(deck, onSave);
      });
      chipBar.appendChild(btn);
    });
    root.appendChild(chipBar);

    // ソート＆単元セレクトバー
    const controlsBar = document.createElement('div');
    controlsBar.className = 'stats-controls-bar';

    const selectGroup = document.createElement('div');
    selectGroup.className = 'stats-select-group';

    const sortSel = document.createElement('select');
    sortSel.className = 'stats-mini-select';
    sortSel.setAttribute('aria-label', '並び替え');
    [
      { value: 'wrong_desc', label: '並び替え: ミスが多い順' },
      { value: 'acc_asc', label: '並び替え: 正答率が低い順' },
      { value: 'correct_desc', label: '並び替え: 正解数が多い順' },
      { value: 'default', label: '並び替え: 登録順' }
    ].forEach((optDef) => {
      const opt = document.createElement('option');
      opt.value = optDef.value;
      opt.textContent = optDef.label;
      if (state.sort === optDef.value) opt.selected = true;
      sortSel.appendChild(opt);
    });
    sortSel.addEventListener('change', (e) => {
      state.sort = e.target.value;
      render(deck, onSave);
    });
    selectGroup.appendChild(sortSel);

    if (cats.length > 1) {
      const catSel = document.createElement('select');
      catSel.className = 'stats-mini-select';
      catSel.setAttribute('aria-label', '単元絞り込み');
      const allOpt = document.createElement('option');
      allOpt.value = 'ALL';
      allOpt.textContent = '単元: すべて';
      catSel.appendChild(allOpt);

      cats.forEach((cat) => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        if (state.category === cat) opt.selected = true;
        catSel.appendChild(opt);
      });
      catSel.addEventListener('change', (e) => {
        state.category = e.target.value;
        render(deck, onSave);
      });
      selectGroup.appendChild(catSel);
    }

    const countLabel = document.createElement('span');
    countLabel.className = 'stats-result-count';
    countLabel.textContent = `${filtered.length}問`;

    controlsBar.appendChild(selectGroup);
    controlsBar.appendChild(countLabel);
    root.appendChild(controlsBar);

    // カード一覧
    const list = document.createElement('div');
    list.className = 'stats-card-list';

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'stats-empty-msg';
      empty.textContent = '条件に一致する問題がありません';
      list.appendChild(empty);
    } else {
      filtered.forEach(({ card }) => {
        const status = getCardStatus(card);
        const acc = getCardAccuracy(card);
        const cCount = Number(card.correctCount || 0);
        const wCount = Number(card.wrongCount || 0);

        const item = document.createElement('div');
        item.className = 'stats-card-item';

        const top = document.createElement('div');
        top.className = 'stats-card-top';

        const tags = document.createElement('div');
        tags.className = 'stats-card-tags';

        const statusBadge = document.createElement('span');
        statusBadge.className = `stats-status-badge ${status}`;
        statusBadge.textContent =
          status === 'mastered' ? '定着済み' : (status === 'weak' ? '苦手' : '未学習');

        const catPill = document.createElement('span');
        catPill.className = 'stats-cat-pill';
        catPill.textContent = card.category || '一般';

        tags.appendChild(statusBadge);
        tags.appendChild(catPill);

        const pinBtn = document.createElement('button');
        pinBtn.type = 'button';
        pinBtn.className = 'stats-pin-toggle' + (card.pinned ? ' pinned' : '');
        pinBtn.textContent = card.pinned ? '★' : '☆';
        pinBtn.title = 'ピン留め切替';
        pinBtn.addEventListener('click', () => {
          card.pinned = !card.pinned;
          if (typeof onSave === 'function') onSave();
          render(deck, onSave);
        });

        top.appendChild(tags);
        top.appendChild(pinBtn);

        const qa = document.createElement('div');
        qa.className = 'stats-card-qa';

        const qDiv = document.createElement('div');
        qDiv.className = 'stats-card-q';
        const aDiv = document.createElement('div');
        aDiv.className = 'stats-card-a';

        if (S && typeof S.renderContent === 'function') {
          S.renderContent(qDiv, card.front);
          S.renderContent(aDiv, card.back);
        } else {
          qDiv.textContent = card.front;
          aDiv.textContent = card.back;
        }

        qa.appendChild(qDiv);
        qa.appendChild(aDiv);

        const metrics = document.createElement('div');
        metrics.className = 'stats-card-metrics';

        const wrongPill = document.createElement('span');
        wrongPill.className = 'metric-pill wrong' + (wCount > 0 ? ' has-val' : '');
        wrongPill.textContent = `ミス ${wCount}回`;

        const correctPill = document.createElement('span');
        correctPill.className = 'metric-pill correct' + (cCount > 0 ? ' has-val' : '');
        correctPill.textContent = `正解 ${cCount}回`;

        const accPill = document.createElement('span');
        accPill.className = 'metric-pill';
        accPill.textContent = acc !== null ? `正答率 ${acc}%` : '未挑戦';

        metrics.appendChild(wrongPill);
        metrics.appendChild(correctPill);
        metrics.appendChild(accPill);

        item.appendChild(top);
        item.appendChild(qa);
        item.appendChild(metrics);
        list.appendChild(item);
      });
    }

    root.appendChild(list);
  }

  window.StudyStatsView = {
    render
  };
})();
