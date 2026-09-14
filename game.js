'use strict';

// ============ 유틸 ============
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function nobleReqString(noble) {
  return Object.entries(noble.requires)
    .map(([c, n]) => `${GEM_LABEL[c]} x${n}`)
    .join(', ');
}

function costString(cost) {
  return Object.entries(cost)
    .map(([c, n]) => `${GEM_LABEL[c]} x${n}`)
    .join(', ');
}

// 닉네임은 상대 브라우저에서 오는 값이므로 화면에 넣기 전에 반드시 이스케이프한다.
function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============ 전역 상태 ============
// 인원수별 규칙. 토큰/귀족 수는 원작 스플렌더와 같은 비율이고, 승리 점수는
// 인원이 늘수록 한 사람이 가져갈 수 있는 카드가 줄어드는 만큼 낮춘다.
// (AI끼리 대국시킨 시뮬레이션으로 한 판 길이가 비슷해지도록 맞춘 값)
const RULES = {
  2: { tokens: 4, gold: 5, nobles: 3, winPoints: 21 },
  3: { tokens: 5, gold: 5, nobles: 4, winPoints: 20 },
  4: { tokens: 7, gold: 5, nobles: 5, winPoints: 19 },
};
const DEFAULT_PLAYER_COUNT = 2;
const HUMAN_SEAT = 0; // 싱글 플레이에서 사람이 앉는 자리

let G = null;

function newPlayer(name) {
  return {
    name,
    tokens: { white: 0, blue: 0, green: 0, red: 0, black: 0, gold: 0 },
    bonuses: { white: 0, blue: 0, green: 0, red: 0, black: 0 },
    cards: [],
    reserved: [],
    nobles: [],
    points: 0,
  };
}

function newGame(playerCount) {
  const count = RULES[playerCount] ? playerCount : currentPlayerCount();
  const rules = RULES[count];

  const tiers = [TIER1_CARDS, TIER2_CARDS, TIER3_CARDS].map((list) => {
    const deck = shuffle(list);
    const faceUp = [deck.pop(), deck.pop(), deck.pop(), deck.pop()];
    return { deck, faceUp };
  });

  const bank = { gold: rules.gold };
  GEMS.forEach((c) => (bank[c] = rules.tokens));

  const myName = typeof statsMyDisplayName === 'function' ? statsMyDisplayName() : '플레이어 1';
  const isSingle = !window.NET || NET.mode === 'single';
  const players = [];
  for (let i = 0; i < count; i++) {
    if (i === 0) players.push(newPlayer(myName));
    else if (isSingle) players.push(newPlayer(count > 2 ? `AI ${i}` : 'AI'));
    else players.push(newPlayer(`플레이어 ${i + 1}`));
  }

  G = {
    gameId: 'g-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    playerCount: count,
    winPoints: rules.winPoints,
    bank,
    tiers,
    nobles: shuffle(NOBLES).slice(0, rules.nobles),
    players,
    currentIndex: 0,
    pending: [],
    discardState: null,
    logs: [],
    gameOver: false,
    winnerText: '',
  };

  log(`${count}인 게임을 시작합니다. (목표 ${rules.winPoints}점)`);
  render();
}

// 화면에 설정된 인원수. 게임이 진행 중이면 그 게임의 인원을 따른다.
let selectedPlayerCount = DEFAULT_PLAYER_COUNT;
function currentPlayerCount() {
  return G && G.playerCount ? G.playerCount : selectedPlayerCount;
}

function winPoints() {
  return G && G.winPoints ? G.winPoints : RULES[currentPlayerCount()].winPoints;
}

function currentPlayer() {
  return G.players[G.currentIndex];
}

// 온라인 대전 중에는 자신의 차례일 때만, 싱글 플레이 중에는 AI 턴이 아닐 때만
// (또는 AI가 스스로 행동 중일 때만) 행동할 수 있다. (net.js/ai.js가 window.NET/AI를 채워준다)
function canAct() {
  if (!window.NET) return true;
  if (NET.mode === 'online') return NET.seat === G.currentIndex;
  if (NET.mode === 'single') {
    if (window.AI && AI.acting) return true;
    return G.currentIndex === HUMAN_SEAT;
  }
  return true;
}

function totalTokens(player) {
  return GEMS.reduce((s, c) => s + player.tokens[c], 0) + player.tokens.gold;
}

function log(msg) {
  G.logs.unshift(msg);
  if (G.logs.length > 60) G.logs.length = 60;
}

// ============ 보석 가져오기(take) ============
function tryAddPending(color) {
  if (G.gameOver || G.discardState || G.nobleChoice || !canAct()) return;
  if (G.bank[color] <= 0) return;

  if (G.pending.length === 0) {
    G.pending.push(color);
  } else if (G.pending.length === 1) {
    if (G.pending[0] === color) {
      if (G.bank[color] >= 4) G.pending.push(color);
    } else {
      G.pending.push(color);
    }
  } else if (G.pending.length === 2) {
    if (G.pending[0] === G.pending[1]) {
      // 이미 동일 색 2개 선택(잠김) - 추가 불가
      return;
    }
    if (G.pending.includes(color)) return;
    G.pending.push(color);
  }
  render();
}

function removePendingAt(idx) {
  G.pending.splice(idx, 1);
  render();
}

function confirmTake() {
  if (G.pending.length === 0 || !canAct()) return;
  const player = currentPlayer();
  G.pending.forEach((c) => {
    G.bank[c]--;
    player.tokens[c]++;
  });
  log(`${player.name}이(가) ${G.pending.map((c) => GEM_LABEL[c]).join(', ')} 토큰을 가져왔습니다.`);
  G.pending = [];
  resolveActionEnd(player);
}

function cancelTake() {
  G.pending.forEach(() => {});
  G.pending = [];
  render();
}

// ============ 카드 구매 / 예약 ============
function affordability(player, cost) {
  let goldNeeded = 0;
  const colorPay = {};
  for (const c of GEMS) {
    const need = Math.max(0, (cost[c] || 0) - (player.bonuses[c] || 0));
    const have = player.tokens[c] || 0;
    const pay = Math.min(need, have);
    colorPay[c] = pay;
    goldNeeded += need - pay;
  }
  const ok = goldNeeded <= (player.tokens.gold || 0);
  return { ok, colorPay, goldNeeded };
}

function drawFromDeck(tierIdx) {
  const tier = G.tiers[tierIdx];
  return tier.deck.length ? tier.deck.pop() : null;
}

function buyBoardCard(tierIdx, idx) {
  if (G.pending.length > 0 || G.discardState || G.gameOver || G.nobleChoice || !canAct()) return;
  const card = G.tiers[tierIdx].faceUp[idx];
  if (!card) return;
  const player = currentPlayer();
  const { ok, colorPay, goldNeeded } = affordability(player, card.cost);
  if (!ok) {
    log(`토큰이 부족하여 구매할 수 없습니다. (필요: ${costString(card.cost)})`);
    render();
    return;
  }
  for (const c of GEMS) {
    player.tokens[c] -= colorPay[c];
    G.bank[c] += colorPay[c];
  }
  player.tokens.gold -= goldNeeded;
  G.bank.gold += goldNeeded;

  G.tiers[tierIdx].faceUp[idx] = drawFromDeck(tierIdx);
  player.cards.push(card);
  player.bonuses[card.gem] = (player.bonuses[card.gem] || 0) + 1;
  player.points += card.points;
  log(`${player.name}이(가) 티어${tierIdx + 1} 카드를 구매했습니다. (+${card.points}점)`);
  resolveActionEnd(player);
}

function buyReservedCard(idx) {
  if (G.pending.length > 0 || G.discardState || G.gameOver || G.nobleChoice || !canAct()) return;
  const player = currentPlayer();
  const card = player.reserved[idx];
  if (!card) return;
  const { ok, colorPay, goldNeeded } = affordability(player, card.cost);
  if (!ok) {
    log(`토큰이 부족하여 구매할 수 없습니다. (필요: ${costString(card.cost)})`);
    render();
    return;
  }
  for (const c of GEMS) {
    player.tokens[c] -= colorPay[c];
    G.bank[c] += colorPay[c];
  }
  player.tokens.gold -= goldNeeded;
  G.bank.gold += goldNeeded;

  player.reserved.splice(idx, 1);
  player.cards.push(card);
  player.bonuses[card.gem] = (player.bonuses[card.gem] || 0) + 1;
  player.points += card.points;
  log(`${player.name}이(가) 예약 카드를 구매했습니다. (+${card.points}점)`);
  resolveActionEnd(player);
}

function reserveCard(tierIdx, idx) {
  if (G.pending.length > 0 || G.discardState || G.gameOver || G.nobleChoice || !canAct()) return;
  const player = currentPlayer();
  if (player.reserved.length >= 3) {
    log('예약 카드는 최대 3장까지 가능합니다.');
    render();
    return;
  }
  const card = G.tiers[tierIdx].faceUp[idx];
  if (!card) return;
  player.reserved.push(card);
  G.tiers[tierIdx].faceUp[idx] = drawFromDeck(tierIdx);
  let gainedGold = false;
  if (G.bank.gold > 0) {
    G.bank.gold--;
    player.tokens.gold++;
    gainedGold = true;
  }
  log(`${player.name}이(가) 티어${tierIdx + 1} 카드를 예약했습니다.${gainedGold ? ' (골드 +1)' : ''}`);
  resolveActionEnd(player);
}

// ============ 턴 종료 처리 (초과 토큰 / 귀족 / 승리 판정) ============
// 싱글 플레이에서 0번 자리는 사람, 나머지 자리는 전부 AI가 맡는다.
function isAiSeat(index) {
  return !!(window.NET && NET.mode === 'single' && index !== HUMAN_SEAT);
}

function isAiPlayer(player) {
  return isAiSeat(G.players.indexOf(player));
}

function resolveActionEnd(player) {
  const total = totalTokens(player);
  if (total > 10) {
    if (isAiPlayer(player)) {
      // AI는 모달 없이 스스로 버릴 토큰을 골라 즉시 처리한다.
      aiChooseDiscards(player, total - 10).forEach((c) => {
        player.tokens[c]--;
        G.bank[c]++;
      });
      finishTurnFlow(player);
      return;
    }
    openDiscardModal(player, total - 10, () => finishTurnFlow(player));
  } else {
    finishTurnFlow(player);
  }
}

function openDiscardModal(player, needed, callback) {
  G.discardState = { player, needed, callback };
  render();
}

function discardToken(color) {
  if (!G.discardState) return;
  const { player } = G.discardState;
  if (player.tokens[color] <= 0) return;
  player.tokens[color]--;
  G.bank[color]++;
  G.discardState.needed--;
  if (G.discardState.needed <= 0) {
    const cb = G.discardState.callback;
    G.discardState = null;
    cb();
  } else {
    render();
  }
}

function checkNoblesAndContinue(player, callback) {
  const qualifying = G.nobles.filter(
    (n) => n && Object.keys(n.requires).every((c) => (player.bonuses[c] || 0) >= n.requires[c])
  );
  if (qualifying.length === 0) {
    callback();
    return;
  }
  if (qualifying.length === 1 || isAiPlayer(player)) {
    claimNoble(player, qualifying[0]);
    callback();
    return;
  }
  G.nobleChoice = { player, qualifying, callback };
  render();
}

function claimNoble(player, noble) {
  player.nobles.push(noble);
  player.points += noble.points;
  G.nobles = G.nobles.map((n) => (n && n.id === noble.id ? null : n));
  log(`${player.name}이(가) 귀족의 방문을 받았습니다. (+${noble.points}점)`);
}

function chooseNoble(nobleId) {
  if (!G.nobleChoice) return;
  const { player, qualifying, callback } = G.nobleChoice;
  const noble = qualifying.find((n) => n.id === nobleId);
  G.nobleChoice = null;
  claimNoble(player, noble);
  callback();
}

function finishTurnFlow(player) {
  checkNoblesAndContinue(player, () => {
    const isLastPlayerOfRound = G.currentIndex === G.players.length - 1;
    if (isLastPlayerOfRound && G.players.some((p) => p.points >= winPoints())) {
      endGame();
      notifyNet();
      return;
    }
    G.currentIndex = (G.currentIndex + 1) % G.players.length;
    render();
    notifyNet();
  });
}

// 온라인 대전 중이면 턴이 끝날 때마다 상대방에게 최신 상태를 전송하고,
// 싱글 플레이 중이면 AI 턴으로 넘어왔는지 확인해 AI를 움직인다.
function notifyNet() {
  if (window.NET && NET.mode === 'online' && typeof NET.commit === 'function') {
    NET.commit();
  }
  if (window.AI && typeof aiScheduleTurn === 'function') {
    aiScheduleTurn();
  }
}

function endGame() {
  G.gameOver = true;
  let winner = G.players[0];
  for (const p of G.players) {
    if (p.points > winner.points) winner = p;
    else if (p.points === winner.points && p.cards.length < winner.cards.length) winner = p;
  }
  const tie = G.players.every((p) => p.points === winner.points && p.cards.length === winner.cards.length);
  if (tie) {
    G.winnerText = `무승부! 두 플레이어 모두 ${winner.points}점입니다.`;
  } else {
    G.winnerText = `${winner.name} 승리! (${winner.points}점, 개발 카드 ${winner.cards.length}장)`;
  }
  log(G.winnerText);
  render();
}

// ============ 렌더링 ============
function gemDot(color, count) {
  return `<span class="gemdot gem-${color}" title="${GEM_LABEL[color]}">${count != null ? count : ''}</span>`;
}

function renderCostIcons(cost) {
  return GEMS.filter((c) => cost[c] > 0)
    .map((c) => `<span class="cost-icon gem-${c}">${cost[c]}</span>`)
    .join('');
}

function renderCardTile(card, opts) {
  // opts: { buyable, affordable, reservable, reserveEnabled, buyAct, reserveAct }
  const affordHint = opts.affordable ? ' affordable' : '';
  return `
    <div class="card-tile gem-border-${card.gem}${affordHint}">
      <div class="card-top">
        <span class="card-points">${card.points > 0 ? card.points : ''}</span>
        <span class="card-gem gem-${card.gem}"></span>
      </div>
      <div class="card-cost">${renderCostIcons(card.cost)}</div>
      <div class="card-actions">
        ${opts.buyable ? `<button data-act="${opts.buyAct}" ${opts.affordable ? '' : 'disabled'}>구매</button>` : ''}
        ${opts.reservable ? `<button data-act="${opts.reserveAct}" ${opts.reserveEnabled ? '' : 'disabled'}>예약</button>` : ''}
      </div>
    </div>`;
}

function render() {
  if (!G) return;
  if (typeof maybeRecordResult === 'function') maybeRecordResult();
  renderBanner();
  renderNobles();
  renderBoard();
  renderBank();
  renderPending();
  renderPlayers();
  renderLog();
  renderModal();
}

function renderBanner() {
  const el = document.getElementById('banner');
  if (G.gameOver) {
    el.innerHTML = `<div class="banner over">${escapeHtml(G.winnerText)}</div>`;
    return;
  }
  let turnText = `${escapeHtml(currentPlayer().name)}의 차례입니다. (목표: ${winPoints()}점 이상)`;
  if (window.NET && NET.mode === 'online') {
    turnText = canAct() ? `당신의 차례입니다. (목표: ${winPoints()}점 이상)` : `${escapeHtml(currentPlayer().name)}(상대방)의 차례를 기다리는 중입니다.`;
  } else if (window.NET && NET.mode === 'single') {
    turnText = canAct() ? `당신의 차례입니다. (목표: ${winPoints()}점 이상)` : 'AI가 생각하는 중입니다...';
  }
  el.innerHTML = `<div class="banner">${turnText}</div>`;
}

function renderNobles() {
  const el = document.getElementById('nobles');
  el.innerHTML = G.nobles
    .map((n) => {
      if (!n) return `<div class="noble-tile empty"></div>`;
      return `<div class="noble-tile">
        <div class="noble-points">${n.points}</div>
        <div class="noble-req">${Object.entries(n.requires)
          .map(([c, cnt]) => `<span class="cost-icon gem-${c}">${cnt}</span>`)
          .join('')}</div>
      </div>`;
    })
    .join('');
}

function renderBoard() {
  const player = G.gameOver ? null : currentPlayer();
  for (let t = 0; t < 3; t++) {
    const container = document.getElementById(`tier${t + 1}`);
    const tier = G.tiers[t];
    const cardsHtml = tier.faceUp
      .map((card, idx) => {
        if (!card) return `<div class="card-tile empty"></div>`;
        const afford = player ? affordability(player, card.cost).ok : false;
        const actionEnabled = !G.gameOver && G.pending.length === 0 && !G.discardState && !G.nobleChoice && canAct();
        return renderCardTile(card, {
          buyable: true,
          reservable: true,
          affordable: actionEnabled && afford,
          reserveEnabled: actionEnabled && player.reserved.length < 3,
          buyAct: `buy:${t}:${idx}`,
          reserveAct: `reserve:${t}:${idx}`,
        });
      })
      .join('');
    container.innerHTML = `
      <div class="tier-label">티어 ${t + 1} <span class="deck-count">(남은 덱: ${tier.deck.length})</span></div>
      <div class="tier-cards">${cardsHtml}</div>
    `;
  }
}

function renderBank() {
  const el = document.getElementById('bank');
  const clickable = !G.gameOver && !G.discardState && !G.nobleChoice && canAct();
  const chips = GEMS.map((c) => {
    return `<button class="bank-chip gem-${c}" data-take="${c}" ${clickable && G.bank[c] > 0 ? '' : 'disabled'}>
      <span class="chip-label">${GEM_LABEL[c]}</span><span class="chip-count">${G.bank[c]}</span>
    </button>`;
  }).join('');
  const goldChip = `<div class="bank-chip gem-gold static">
      <span class="chip-label">${GEM_LABEL.gold}</span><span class="chip-count">${G.bank.gold}</span>
    </div>`;
  el.innerHTML = `<div class="bank-title">은행</div><div class="bank-row">${chips}${goldChip}</div>`;
}

function renderPending() {
  const chipsEl = document.getElementById('pendingChips');
  chipsEl.innerHTML = G.pending
    .map((c, i) => `<button class="pending-chip gem-${c}" data-remove="${i}">${GEM_LABEL[c]} ✕</button>`)
    .join('');
  document.getElementById('confirmTakeBtn').disabled = G.pending.length === 0 || G.gameOver || !!G.discardState || !canAct();
  document.getElementById('cancelTakeBtn').disabled = G.pending.length === 0;
}

// 짝수 번째 플레이어는 왼쪽, 홀수 번째는 오른쪽 칼럼에 놓는다.
// (2인: 좌/우 한 명씩, 3인: 좌 2 우 1, 4인: 좌우 2명씩)
function renderPlayers() {
  const left = document.getElementById('playerColLeft');
  const right = document.getElementById('playerColRight');
  if (!left || !right) return;
  const html = ['', ''];
  G.players.forEach((p, i) => {
    html[i % 2] += renderPlayerPanel(p, i);
  });
  left.innerHTML = html[0];
  right.innerHTML = html[1];
}

function renderPlayerPanel(p, i) {
  const isCurrent = i === G.currentIndex && !G.gameOver;
  const canActNow = isCurrent && canAct();
  const tokensHtml = GEMS.concat(['gold'])
    .map((c) => (p.tokens[c] > 0 ? gemDot(c, p.tokens[c]) : ''))
    .join('');
  const bonusHtml = GEMS.map((c) => (p.bonuses[c] > 0 ? gemDot(c, p.bonuses[c]) : '')).join('');
  const reservedHtml = p.reserved
    .map((card, idx) => {
      const afford = canActNow ? affordability(p, card.cost).ok : false;
      return renderCardTile(card, {
        buyable: canActNow,
        reservable: false,
        affordable: canActNow && afford && G.pending.length === 0 && !G.discardState && !G.nobleChoice,
        buyAct: `buyReserved:${idx}`,
      });
    })
    .join('');
  const netTag = window.NET && NET.mode === 'online' && NET.seat === i ? ' <span class="you-tag">나</span>' : '';
  const noblesHtml = p.nobles.map(() => `<span class="noble-mini">★</span>`).join('');
  return `
    <div class="player-panel ${isCurrent ? 'active' : ''}">
      <h3>${escapeHtml(p.name)}${netTag} ${isCurrent ? '<span class="turn-tag">현재 턴</span>' : ''}</h3>
      <div class="player-points">점수: ${p.points}점 ${noblesHtml}</div>
      <div class="player-row"><span class="row-label">보유 토큰</span><span class="row-items">${tokensHtml || '<em>없음</em>'}</span></div>
      <div class="player-row"><span class="row-label">카드 보너스</span><span class="row-items">${bonusHtml || '<em>없음</em>'}</span></div>
      <div class="player-row"><span class="row-label">예약 카드 (${p.reserved.length}/3)</span></div>
      <div class="reserved-cards">${reservedHtml}</div>
    </div>`;
}

function renderLog() {
  const el = document.getElementById('log');
  el.innerHTML = `<div class="log-title">진행 기록</div><ul>${G.logs.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`;
}

function renderModal() {
  const overlay = document.getElementById('modalOverlay');
  const modal = document.getElementById('modal');
  if (G.discardState) {
    const { player, needed } = G.discardState;
    modal.innerHTML = `
      <h3>${escapeHtml(player.name)}의 토큰이 10개를 초과했습니다.</h3>
      <p>${needed}개를 버려야 합니다.</p>
      <div class="modal-tokens">
        ${GEMS.concat(['gold'])
          .filter((c) => player.tokens[c] > 0)
          .map((c) => `<button class="token-btn gem-${c}" data-discard="${c}">${GEM_LABEL[c]} x${player.tokens[c]}</button>`)
          .join('')}
      </div>`;
    overlay.classList.remove('hidden');
  } else if (G.nobleChoice) {
    const { qualifying } = G.nobleChoice;
    modal.innerHTML = `
      <h3>방문할 귀족을 선택하세요.</h3>
      <div class="modal-nobles">
        ${qualifying
          .map((n) => `<button class="noble-btn" data-noble="${n.id}">${nobleReqString(n)} (+${n.points}점)</button>`)
          .join('')}
      </div>`;
    overlay.classList.remove('hidden');
  } else {
    overlay.classList.add('hidden');
    modal.innerHTML = '';
  }
}

// 새 게임 버튼: 로컬 모드면 즉시 재시작, 온라인 모드면 방장만 재대결을 요청한다.
function onNewGameClick() {
  if (window.NET && NET.mode === 'online' && typeof NET.requestNewGame === 'function') {
    NET.requestNewGame();
  } else {
    newGame();
  }
}

// ============ 이벤트 바인딩 ============
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('newGameBtn').addEventListener('click', onNewGameClick);
  document.getElementById('confirmTakeBtn').addEventListener('click', confirmTake);
  document.getElementById('cancelTakeBtn').addEventListener('click', cancelTake);

  document.getElementById('bank').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-take]');
    if (btn) tryAddPending(btn.dataset.take);
  });

  document.getElementById('pendingChips').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (btn) removePendingAt(Number(btn.dataset.remove));
  });

  document.getElementById('board').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const [act, a, b] = btn.dataset.act.split(':');
    if (act === 'buy') buyBoardCard(Number(a), Number(b));
    if (act === 'reserve') reserveCard(Number(a), Number(b));
  });

  document.querySelectorAll('.player-column').forEach((slot) => {
    slot.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const [act, a] = btn.dataset.act.split(':');
      if (act === 'buyReserved') buyReservedCard(Number(a));
    });
  });

  document.getElementById('modal').addEventListener('click', (e) => {
    const discardBtn = e.target.closest('[data-discard]');
    if (discardBtn) discardToken(discardBtn.dataset.discard);
    const nobleBtn = e.target.closest('[data-noble]');
    if (nobleBtn) chooseNoble(nobleBtn.dataset.noble);
  });

  newGame();
});
