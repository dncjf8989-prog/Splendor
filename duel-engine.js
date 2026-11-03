'use strict';

// ============ 스플렌더 듀얼 규칙 엔진 ============
// 화면도 네트워크도 모른다. 상태(state)는 평범한 JSON이고, 모든 행동은
// duelApply(state, 자리, 행동)로만 바뀐다. 방장(또는 혼자 하기)이 이것을 돌리고,
// 나머지는 결과 상태를 받아 그리기만 한다.
//
// 규칙은 아래 DUEL 상수로 모았다. 규칙서 원문을 열어 보지 못해서 기억에 의존한
// 값에는 [기억] 표시를 달아 두었다. 실제와 다르면 이 상수만 고치면 된다.

const DUEL = {
  COLORS: ['white', 'blue', 'green', 'red', 'black'],
  TOKEN_TYPES: ['white', 'blue', 'green', 'red', 'black', 'pearl', 'gold'],
  SIZE: 5, // 토큰판은 5x5
  PER_COLOR: 4, // [기억] 색마다 4개 (보석 20 + 진주 3 + 금 2 = 25칸)
  PEARLS: 3,
  GOLDS: 2,
  PYRAMID: { 1: 5, 2: 4, 3: 3 }, // [기억] 티어1 5장, 티어2 4장, 티어3 3장이 깔린다
  SCROLLS: 3, // 특권 두루마리는 모두 3개
  SECOND_PLAYER_SCROLLS: 1, // [기억] 두 번째 플레이어가 특권 1개를 갖고 시작
  RESERVE_MAX: 3, // [기억]
  TOKEN_MAX: 10, // [기억] 턴이 끝났을 때 들고 있을 수 있는 토큰
  WIN_POINTS: 20,
  WIN_CROWNS: 10,
  WIN_COLOR: 10, // 한 색 카드로만 모은 점수
  ROYAL_AT: [3, 6], // 왕관이 처음 3개, 6개가 될 때 왕실 카드 한 장씩
  LOG_MAX: 40,
};

const DUEL_COLOR_LABEL = { white: '흰색', blue: '파랑', green: '초록', red: '빨강', black: '검정', pearl: '진주', gold: '금' };

// ---- 카드 조회 ----
function duelCard(id) {
  return DUEL_CARDS[id] || null;
}
function duelRoyal(id) {
  return DUEL_ROYALS.find((r) => r.id === id) || null;
}

// ---- 토큰판 좌표 ----
function duelPos(r, c) {
  return r * DUEL.SIZE + c;
}
function duelRC(pos) {
  return [Math.floor(pos / DUEL.SIZE), pos % DUEL.SIZE];
}

// 가운데에서 바깥으로 도는 소용돌이 순서. 판을 채울 때 이 순서로 놓는다.
const DUEL_SPIRAL = (() => {
  const out = [];
  let r = 2;
  let c = 2;
  out.push(duelPos(r, c));
  const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]];
  const lens = [1, 1, 2, 2, 3, 3, 4, 4, 4];
  lens.forEach((len, k) => {
    const [dr, dc] = dirs[k % 4];
    for (let i = 0; i < len; i++) {
      r += dr;
      c += dc;
      out.push(duelPos(r, c));
    }
  });
  return out;
})();

// 일직선(가로, 세로, 대각선)으로 이어진 칸인지. 1개는 항상 맞다.
function duelIsLine(positions) {
  const n = positions.length;
  if (n < 1 || n > 3) return false;
  if (new Set(positions).size !== n) return false;
  if (!positions.every((p) => Number.isInteger(p) && p >= 0 && p < DUEL.SIZE * DUEL.SIZE)) return false;
  if (n === 1) return true;
  const sorted = positions.slice().sort((a, b) => a - b);
  const rc = sorted.map(duelRC);
  const dr = rc[1][0] - rc[0][0];
  const dc = rc[1][1] - rc[0][1];
  const ok = (dr === 0 && dc === 1) || (dr === 1 && dc === 0) || (dr === 1 && dc === 1) || (dr === 1 && dc === -1);
  if (!ok) return false;
  for (let i = 2; i < n; i++) {
    if (rc[i][0] - rc[i - 1][0] !== dr || rc[i][1] - rc[i - 1][1] !== dc) return false;
  }
  return true;
}

// ---- 상태 만들기 ----
function duelEmptyTokens() {
  const t = {};
  DUEL.TOKEN_TYPES.forEach((k) => (t[k] = 0));
  return t;
}

function duelShuffle(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function duelNewGame(opts) {
  const o = opts || {};
  const rng = o.rng || Math.random;
  const start = Number.isInteger(o.start) ? o.start : Math.floor(rng() * 2);

  const bag = [];
  DUEL.COLORS.forEach((c) => {
    for (let i = 0; i < DUEL.PER_COLOR; i++) bag.push(c);
  });
  for (let i = 0; i < DUEL.PEARLS; i++) bag.push('pearl');
  for (let i = 0; i < DUEL.GOLDS; i++) bag.push('gold');

  const decks = { 1: [], 2: [], 3: [] };
  DUEL_CARDS.forEach((c) => decks[c.lv].push(c.id));
  [1, 2, 3].forEach((lv) => (decks[lv] = duelShuffle(decks[lv], rng)));

  const pyramid = {};
  [1, 2, 3].forEach((lv) => {
    pyramid[lv] = [];
    for (let i = 0; i < DUEL.PYRAMID[lv]; i++) pyramid[lv].push(decks[lv].length ? decks[lv].pop() : null);
  });

  const mkPlayer = (name) => ({
    name: name || '',
    tokens: duelEmptyTokens(),
    cards: [], // 산 카드 id
    assigned: {}, // 와일드 카드가 어떤 색이 되었는지 { 카드id: 색 }
    reserved: [], // { id, secret } secret=덱에서 몰래 예약한 카드
    royals: [],
    scrolls: 0,
    claimed: 0, // 지금까지 받은 왕실 카드 수
  });

  const state = {
    v: 1,
    gameId: o.gameId || 'd-' + Date.now().toString(36) + Math.floor(rng() * 1e9).toString(36),
    rev: 0,
    start,
    turn: start,
    turnNo: 1,
    mainDone: false, // 이번 턴의 필수 행동을 했는가
    extra: false, // 카드 능력으로 한 번 더 두는가 (이번 차례가 끝나면 같은 사람이 다시 둔다)
    extraTurn: false, // 지금 두는 차례가 "한 번 더"로 얻은 추가 턴인가 (화면에 알리려는 표시)
    fx: [], // 이번 행동으로 능력이 일으킨 일들. 화면이 "방금 일어난 일"로 보여 준다. 다음 행동이 오면 비운다.
    board: new Array(DUEL.SIZE * DUEL.SIZE).fill(null),
    bag,
    decks,
    pyramid,
    royals: DUEL_ROYALS.map((r) => r.id),
    scrolls: DUEL.SCROLLS,
    players: [mkPlayer(o.names && o.names[0]), mkPlayer(o.names && o.names[1])],
    queue: [],
    choice: null,
    over: null,
    log: [],
    last: null,
    actionNo: 0,
  };

  duelFillBoard(state, rng);
  // 두 번째 플레이어에게 특권 한 장을 준다 (선공의 이점을 덜어 주려는 것) [기억]
  const second = 1 - start;
  for (let i = 0; i < DUEL.SECOND_PLAYER_SCROLLS; i++) {
    state.scrolls -= 1;
    state.players[second].scrolls += 1;
  }
  duelLog(state, `게임을 시작합니다. 선공은 ${duelName(state, start)}입니다.`);
  return state;
}

// ---- 도움 함수 ----
// 덱과 주머니의 개수. 상대에게 보내는 요약 상태에는 내용 없이 개수만 있다.
function duelDeckLen(state, lv) {
  return state.decks ? state.decks[lv].length : state.deckN[lv];
}
function duelBagLen(state) {
  return state.bag ? state.bag.length : state.bagN;
}

function duelName(state, seat) {
  return state.players[seat].name || (seat === 0 ? '플레이어 1' : '플레이어 2');
}

function duelLog(state, msg) {
  state.log.unshift(msg);
  if (state.log.length > DUEL.LOG_MAX) state.log.length = DUEL.LOG_MAX;
}

// 능력이 일으킨 일을 남긴다. 상대에게 숨길 것이 없다 (토큰 종류는 모두 공개).
function duelFx(state, ev) {
  if (!Array.isArray(state.fx)) state.fx = [];
  state.fx.push(ev);
}

function duelNote(state, seat, kind, extra) {
  state.actionNo += 1;
  state.last = Object.assign({ no: state.actionNo, seat, kind }, extra || {});
}

function duelFillBoard(state, rng) {
  for (const pos of DUEL_SPIRAL) {
    if (!state.bag.length) break;
    if (state.board[pos] !== null) continue;
    const i = Math.floor(rng() * state.bag.length);
    state.board[pos] = state.bag.splice(i, 1)[0];
  }
}

function duelTokenTotal(p) {
  return DUEL.TOKEN_TYPES.reduce((s, k) => s + p.tokens[k], 0);
}

// 산 카드의 보너스 색 (와일드는 정해진 색)
function duelCardColor(p, id) {
  const c = duelCard(id);
  if (!c) return null;
  if (c.bonus === 'none') return null; // 황금 카드: 보너스 색이 없다 (점수만 있다)
  return c.bonus === 'wild' ? p.assigned[id] || null : c.bonus;
}

function duelBonus(state, seat) {
  const p = state.players[seat];
  const b = {};
  DUEL.COLORS.forEach((k) => (b[k] = 0));
  p.cards.forEach((id) => {
    const col = duelCardColor(p, id);
    if (col) b[col] += 1;
  });
  return b;
}

function duelColorPoints(state, seat) {
  const p = state.players[seat];
  const pts = {};
  DUEL.COLORS.forEach((k) => (pts[k] = 0));
  p.cards.forEach((id) => {
    const col = duelCardColor(p, id);
    if (col) pts[col] += duelCard(id).pts;
  });
  return pts;
}

function duelPoints(state, seat) {
  const p = state.players[seat];
  let s = 0;
  p.cards.forEach((id) => (s += duelCard(id).pts));
  p.royals.forEach((id) => (s += duelRoyal(id).pts));
  return s;
}

function duelCrowns(state, seat) {
  let s = 0;
  state.players[seat].cards.forEach((id) => (s += duelCard(id).crowns));
  return s;
}

// 특권을 한 장 받는다. 판 옆에 남은 것이 있으면 그것을, 없으면 상대가 가진 것을 가져온다.
function duelGainScroll(state, seat) {
  const p = state.players[seat];
  const o = state.players[1 - seat];
  if (state.scrolls > 0) {
    state.scrolls -= 1;
    p.scrolls += 1;
    return true;
  }
  if (o.scrolls > 0) {
    o.scrolls -= 1;
    p.scrolls += 1;
    return true;
  }
  return false;
}

// ---- 살 수 있는가 / 얼마를 내는가 ----
// 반환: null(못 산다) 또는 { pay: {토큰종류: 개수}, wildColors: [와일드면 고를 수 있는 색] }
function duelPayment(state, seat, cardId) {
  const card = duelCard(cardId);
  if (!card) return null;
  const p = state.players[seat];
  const bonus = duelBonus(state, seat);
  const pay = duelEmptyTokens();
  let needGold = 0;

  DUEL.COLORS.forEach((col) => {
    const need = Math.max(0, (card.cost[col] || 0) - bonus[col]);
    const use = Math.min(need, p.tokens[col]);
    pay[col] = use;
    needGold += need - use;
  });
  const needPearl = card.cost.pearl || 0; // 진주 비용에는 할인이 없다
  const usePearl = Math.min(needPearl, p.tokens.pearl);
  pay.pearl = usePearl;
  needGold += needPearl - usePearl;

  if (needGold > p.tokens.gold) return null;
  pay.gold = needGold;

  let wildColors = [];
  if (card.bonus === 'wild') {
    wildColors = DUEL.COLORS.filter((col) => bonus[col] > 0);
    if (!wildColors.length) return null; // 이미 가진 색 카드가 없으면 와일드를 못 산다
  }
  return { pay, wildColors };
}

function duelPyramidCard(state, lv, i) {
  const row = state.pyramid[lv];
  if (!row || !Number.isInteger(i) || i < 0 || i >= row.length) return null;
  return row[i];
}

function duelCanBuyAny(state, seat) {
  const p = state.players[seat];
  for (const lv of [1, 2, 3]) {
    for (const id of state.pyramid[lv]) if (id !== null && duelPayment(state, seat, id)) return true;
  }
  return p.reserved.some((r) => r.id !== null && duelPayment(state, seat, r.id));
}

function duelCanReserve(state, seat) {
  const p = state.players[seat];
  if (p.reserved.length >= DUEL.RESERVE_MAX) return false;
  if (!state.board.includes('gold')) return false;
  return [1, 2, 3].some((lv) => state.pyramid[lv].some((id) => id !== null) || duelDeckLen(state, lv) > 0);
}

// 지금 집을 수 있는 줄 목록 (1~3개)
function duelLegalTakes(state) {
  const out = [];
  const ok = (pos) => state.board[pos] !== null && state.board[pos] !== 'gold';
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (let r = 0; r < DUEL.SIZE; r++) {
    for (let c = 0; c < DUEL.SIZE; c++) {
      const p0 = duelPos(r, c);
      if (!ok(p0)) continue;
      out.push([p0]);
      dirs.forEach(([dr, dc]) => {
        const line = [p0];
        for (let k = 1; k < 3; k++) {
          const rr = r + dr * k;
          const cc = c + dc * k;
          if (rr < 0 || rr >= DUEL.SIZE || cc < 0 || cc >= DUEL.SIZE) break;
          const pk = duelPos(rr, cc);
          if (!ok(pk)) break;
          line.push(pk);
          out.push(line.slice());
        }
      });
    }
  }
  return out;
}

// 둘 수 있는 필수 행동이 하나도 없는가 (판 채우기도 못 하는 경우에만 넘길 수 있다)
function duelStuck(state, seat) {
  if (duelLegalTakes(state).length) return false;
  if (duelCanReserve(state, seat)) return false;
  if (duelCanBuyAny(state, seat)) return false;
  if (duelBagLen(state) && state.board.includes(null)) return false; // 판 채우기는 가능
  return true;
}

// 같은 색 3개나 진주 2개를 집었는가 (상대에게 특권을 주는 벌)
function duelTakeIsGreedy(types) {
  if (types.filter((t) => t === 'pearl').length >= 2) return true;
  return types.length === 3 && types[0] === types[1] && types[1] === types[2];
}

// ---- 행동 ----
function duelFail(err) {
  return { ok: false, err };
}

function duelBump(state) {
  state.rev += 1;
}

function duelApply(state, seat, action, rng) {
  const r = rng || Math.random;
  if (!action || typeof action.t !== 'string') return duelFail('알 수 없는 행동입니다.');
  if (seat !== 0 && seat !== 1) return duelFail('자리가 맞지 않습니다.');
  if (state.over) return duelFail('이미 끝난 판입니다.');

  if (state.choice) {
    if (action.t !== 'choose') return duelFail('먼저 선택을 마쳐야 합니다.');
    if (state.choice.seat !== seat) return duelFail('상대가 선택하는 중입니다.');
    return duelChoose(state, seat, action, r);
  }
  if (action.t === 'choose') return duelFail('지금은 고를 것이 없습니다.');
  if (seat !== state.turn) return duelFail('내 차례가 아닙니다.');

  // 새 행동이면 지난 행동의 "방금 일어난 일"을 비운다. 실패한 행동은 상태를 건드리지 않으므로 되돌린다.
  const prevFx = state.fx;
  state.fx = [];
  let res;
  switch (action.t) {
    case 'priv':
      res = duelActPrivilege(state, seat, action);
      break;
    case 'replenish':
      res = duelActReplenish(state, seat, r);
      break;
    case 'take':
      res = duelActTake(state, seat, action, r);
      break;
    case 'reserve':
      res = duelActReserve(state, seat, action, r);
      break;
    case 'buy':
      res = duelActBuy(state, seat, action, r);
      break;
    case 'pass':
      res = duelActPass(state, seat, r);
      break;
    default:
      res = duelFail('알 수 없는 행동입니다.');
  }
  if (!res.ok) state.fx = prevFx;
  return res;
}

function duelActPrivilege(state, seat, a) {
  if (state.mainDone) return duelFail('필수 행동을 한 뒤에는 특권을 쓸 수 없습니다.');
  const p = state.players[seat];
  if (p.scrolls < 1) return duelFail('특권 두루마리가 없습니다.');
  const pos = a.pos;
  if (!Number.isInteger(pos) || pos < 0 || pos >= state.board.length) return duelFail('칸이 맞지 않습니다.');
  const t = state.board[pos];
  if (t === null) return duelFail('빈 칸입니다.');
  if (t === 'gold') return duelFail('특권으로 금은 집을 수 없습니다.');
  p.scrolls -= 1;
  state.scrolls += 1;
  state.board[pos] = null;
  p.tokens[t] += 1;
  duelLog(state, `${duelName(state, seat)}이(가) 특권을 써서 ${DUEL_COLOR_LABEL[t]}을(를) 가져갔습니다.`);
  duelNote(state, seat, 'priv', { token: t });
  duelBump(state);
  return { ok: true };
}

function duelActReplenish(state, seat, rng) {
  if (state.mainDone) return duelFail('필수 행동을 한 뒤에는 판을 채울 수 없습니다.');
  if (!state.bag.length) return duelFail('주머니에 토큰이 없습니다.');
  if (!state.board.includes(null)) return duelFail('판에 빈 칸이 없습니다.');
  duelFillBoard(state, rng);
  const gained = duelGainScroll(state, 1 - seat);
  duelLog(state, `${duelName(state, seat)}이(가) 토큰판을 채웠습니다.${gained ? ` ${duelName(state, 1 - seat)}이(가) 특권을 받습니다.` : ''}`);
  duelNote(state, seat, 'replenish');
  duelBump(state);
  return { ok: true };
}

function duelActTake(state, seat, a, rng) {
  if (state.mainDone) return duelFail('이번 턴의 필수 행동을 이미 했습니다.');
  const pos = a.pos;
  if (!Array.isArray(pos) || !duelIsLine(pos)) return duelFail('이어진 일직선의 1~3칸을 골라야 합니다.');
  const types = [];
  for (const p0 of pos) {
    const t = state.board[p0];
    if (t === null) return duelFail('빈 칸이 들어 있습니다.');
    if (t === 'gold') return duelFail('금은 집을 수 없습니다. (예약할 때만 받습니다)');
    types.push(t);
  }
  const p = state.players[seat];
  pos.forEach((p0, i) => {
    state.board[p0] = null;
    p.tokens[types[i]] += 1;
  });
  const greedy = duelTakeIsGreedy(types);
  let note = '';
  if (greedy) {
    const gained = duelGainScroll(state, 1 - seat);
    note = gained ? ` (욕심을 부려 ${duelName(state, 1 - seat)}이(가) 특권을 받습니다)` : '';
  }
  duelLog(state, `${duelName(state, seat)}이(가) ${types.map((t) => DUEL_COLOR_LABEL[t]).join(', ')}을(를) 가져갔습니다.${note}`);
  duelNote(state, seat, 'take', { tokens: types });
  state.mainDone = true;
  state.queue = [{ k: 'limit' }, { k: 'endturn' }];
  duelBump(state);
  duelAdvance(state, rng);
  return { ok: true };
}

function duelDrawFromDeck(state, lv) {
  return state.decks[lv].length ? state.decks[lv].pop() : null;
}

function duelActReserve(state, seat, a, rng) {
  if (state.mainDone) return duelFail('이번 턴의 필수 행동을 이미 했습니다.');
  const p = state.players[seat];
  if (p.reserved.length >= DUEL.RESERVE_MAX) return duelFail(`예약은 ${DUEL.RESERVE_MAX}장까지입니다.`);
  const goldPos = state.board.indexOf('gold');
  if (goldPos < 0) return duelFail('판에 금이 없어서 예약할 수 없습니다.');
  const src = a.src;
  if (!src) return duelFail('예약할 카드를 골라야 합니다.');

  let id;
  let secret = false;
  let lv;
  if (src.k === 'pyr') {
    id = duelPyramidCard(state, src.lv, src.i);
    if (id === null || id === undefined) return duelFail('그 자리에 카드가 없습니다.');
    lv = src.lv;
    state.pyramid[lv][src.i] = duelDrawFromDeck(state, lv);
  } else if (src.k === 'deck') {
    lv = src.lv;
    if (![1, 2, 3].includes(lv)) return duelFail('티어가 맞지 않습니다.');
    if (!state.decks[lv].length) return duelFail('그 덱에는 카드가 없습니다.');
    id = duelDrawFromDeck(state, lv);
    secret = true;
  } else {
    return duelFail('예약할 카드를 골라야 합니다.');
  }

  state.board[goldPos] = null;
  p.tokens.gold += 1;
  p.reserved.push({ id, secret });
  duelLog(
    state,
    secret
      ? `${duelName(state, seat)}이(가) 티어${lv} 덱에서 한 장을 몰래 예약했습니다. (금 +1)`
      : `${duelName(state, seat)}이(가) 티어${lv} 카드를 예약했습니다. (금 +1)`
  );
  duelNote(state, seat, 'reserve', { lv, secret, id: secret ? null : id });
  state.mainDone = true;
  state.queue = [{ k: 'limit' }, { k: 'endturn' }];
  duelBump(state);
  duelAdvance(state, rng);
  return { ok: true };
}

function duelActBuy(state, seat, a, rng) {
  if (state.mainDone) return duelFail('이번 턴의 필수 행동을 이미 했습니다.');
  const p = state.players[seat];
  const src = a.src;
  if (!src) return duelFail('살 카드를 골라야 합니다.');

  let id = null;
  if (src.k === 'pyr') id = duelPyramidCard(state, src.lv, src.i);
  else if (src.k === 'res') id = p.reserved[src.i] ? p.reserved[src.i].id : null;
  if (id === null || id === undefined) return duelFail('그 카드를 찾을 수 없습니다.');

  const quote = duelPayment(state, seat, id);
  if (!quote) return duelFail('토큰이 모자라서 살 수 없습니다.');

  // 값을 치르고 주머니로 돌려보낸다
  DUEL.TOKEN_TYPES.forEach((t) => {
    for (let i = 0; i < quote.pay[t]; i++) state.bag.push(t);
    p.tokens[t] -= quote.pay[t];
  });

  // 카드를 가져온다
  let lv = duelCard(id).lv;
  if (src.k === 'pyr') state.pyramid[src.lv][src.i] = duelDrawFromDeck(state, src.lv);
  else p.reserved.splice(src.i, 1);

  const card = duelCard(id);
  duelLog(state, `${duelName(state, seat)}이(가) 티어${lv} 카드를 샀습니다. (+${card.pts}점${card.crowns ? `, 왕관 ${card.crowns}` : ''})`);
  duelNote(state, seat, 'buy', { id, lv, from: src.k === 'pyr' ? 'pyr' : 'res', paid: Object.assign({}, quote.pay) });

  state.mainDone = true;
  // 카드를 먼저 내 앞에 놓고, 와일드면 색을 정한다. (고르는 동안 카드가 공중에 뜨지 않게)
  state.queue = [
    { k: 'place', id },
    { k: 'wild', id },
    { k: 'cardpower', id },
    { k: 'royalcheck' },
    { k: 'victory' },
    { k: 'limit' },
    { k: 'endturn' },
  ];
  duelBump(state);
  duelAdvance(state, rng);
  return { ok: true };
}

function duelActPass(state, seat, rng) {
  if (state.mainDone) return duelFail('이번 턴의 필수 행동을 이미 했습니다.');
  if (!duelStuck(state, seat)) return duelFail('둘 수 있는 수가 있어서 넘길 수 없습니다.');
  duelLog(state, `${duelName(state, seat)}은(는) 둘 수 있는 수가 없어 차례를 넘깁니다.`);
  duelNote(state, seat, 'pass');
  state.mainDone = true;
  state.queue = [{ k: 'endturn' }];
  duelBump(state);
  duelAdvance(state, rng);
  return { ok: true };
}

// ---- 차례가 이어지는 동안의 처리 ----
// 선택이 필요하면 state.choice 를 세우고 멈춘다. 선택이 오면 이어서 돈다.
function duelAdvance(state, rng) {
  let guard = 0;
  while (state.queue.length && !state.choice && !state.over && guard++ < 50) {
    const step = state.queue.shift();
    const seat = state.turn;
    const p = state.players[seat];

    switch (step.k) {
      case 'wild': {
        const card = duelCard(step.id);
        if (card.bonus !== 'wild') break;
        const cols = DUEL.COLORS.filter((c) => duelBonus(state, seat)[c] > 0);
        if (cols.length === 1) {
          p.assigned[step.id] = cols[0];
          duelLog(state, `색상 선택 카드가 ${DUEL_COLOR_LABEL[cols[0]]} 보너스가 되었습니다.`);
        } else if (cols.length > 1) {
          state.choice = { type: 'wild', seat, id: step.id, options: cols };
        } else {
          p.assigned[step.id] = null; // 산 뒤에 색이 사라지는 경우는 없지만 안전하게
        }
        break;
      }
      case 'place':
        p.cards.push(step.id);
        break;
      case 'cardpower':
        duelRunPower(state, seat, duelCard(step.id).power, duelCardColor(p, step.id), rng);
        break;
      case 'royalpower':
        duelRunPower(state, seat, duelRoyal(step.id).power, null, rng);
        break;
      case 'royalcheck': {
        const crowns = duelCrowns(state, seat);
        const should = DUEL.ROYAL_AT.filter((n) => crowns >= n).length;
        if (p.claimed < should && state.royals.length) {
          state.choice = { type: 'royal', seat, options: state.royals.slice() };
        }
        break;
      }
      case 'victory':
        duelCheckVictory(state);
        break;
      case 'limit': {
        const excess = duelTokenTotal(p) - DUEL.TOKEN_MAX;
        if (excess > 0) state.choice = { type: 'discard', seat, n: excess };
        break;
      }
      case 'endturn':
        duelEndTurn(state);
        break;
      default:
        break;
    }
  }
}

function duelRunPower(state, seat, power, color, rng) {
  if (!power) return;
  const p = state.players[seat];
  const opp = state.players[1 - seat];
  if (power === 'replay') {
    state.extra = true;
    duelLog(state, `${duelName(state, seat)}이(가) 한 번 더 둡니다.`);
    duelFx(state, { k: 'replay', seat });
  } else if (power === 'scroll') {
    const got = duelGainScroll(state, seat);
    if (got) duelLog(state, `${duelName(state, seat)}이(가) 특권을 받았습니다.`);
    duelFx(state, { k: 'scroll', seat, got });
  } else if (power === 'token') {
    if (!color) return;
    const spots = [];
    state.board.forEach((t, i) => {
      if (t === color) spots.push(i);
    });
    if (spots.length === 1) {
      state.board[spots[0]] = null;
      p.tokens[color] += 1;
      duelLog(state, `${duelName(state, seat)}이(가) 판에서 ${DUEL_COLOR_LABEL[color]}을(를) 가져왔습니다.`);
      duelFx(state, { k: 'token', seat, color, got: true });
    } else if (spots.length > 1) {
      state.choice = { type: 'pick', seat, color, options: spots };
    } else {
      duelFx(state, { k: 'token', seat, color, got: false }); // 판에 그 색이 없어 아무 일도 없다
    }
  } else if (power === 'steal') {
    const types = DUEL.TOKEN_TYPES.filter((t) => t !== 'gold' && opp.tokens[t] > 0);
    if (types.length === 1) {
      opp.tokens[types[0]] -= 1;
      p.tokens[types[0]] += 1;
      duelLog(state, `${duelName(state, seat)}이(가) 상대의 ${DUEL_COLOR_LABEL[types[0]]}을(를) 빼앗았습니다.`);
      duelFx(state, { k: 'steal', seat, type: types[0], got: true });
    } else if (types.length > 1) {
      state.choice = { type: 'steal', seat, options: types };
    } else {
      duelFx(state, { k: 'steal', seat, type: null, got: false }); // 빼앗을 토큰이 없다
    }
  }
}

function duelCheckVictory(state) {
  const seat = state.turn;
  const pts = duelPoints(state, seat);
  if (pts >= DUEL.WIN_POINTS) return duelWin(state, seat, 'points');
  if (duelCrowns(state, seat) >= DUEL.WIN_CROWNS) return duelWin(state, seat, 'crowns');
  const cp = duelColorPoints(state, seat);
  const col = DUEL.COLORS.find((c) => cp[c] >= DUEL.WIN_COLOR);
  if (col) return duelWin(state, seat, 'color', col);
  return null;
}

function duelWin(state, seat, kind, color) {
  state.over = { winner: seat, kind, color: color || null };
  state.queue = [];
  state.choice = null;
  const why =
    kind === 'points'
      ? `명성 ${duelPoints(state, seat)}점`
      : kind === 'crowns'
        ? `왕관 ${duelCrowns(state, seat)}개`
        : `${DUEL_COLOR_LABEL[color]} 카드로만 ${duelColorPoints(state, seat)[color]}점`;
  duelLog(state, `${duelName(state, seat)} 승리! (${why})`);
  duelNote(state, seat, 'win', { kind });
  return state.over;
}

function duelEndTurn(state) {
  if (state.extra) {
    state.extra = false;
    state.extraTurn = true; // 같은 사람이 이어서 두는 추가 턴
    state.mainDone = false;
    state.turnNo += 1;
    return;
  }
  state.turn = 1 - state.turn;
  state.extraTurn = false;
  state.mainDone = false;
  state.turnNo += 1;
}

// ---- 선택 ----
function duelChoose(state, seat, a, rng) {
  const ch = state.choice;
  const p = state.players[seat];
  const opp = state.players[1 - seat];

  if (ch.type === 'wild') {
    if (!ch.options.includes(a.color)) return duelFail('고를 수 없는 색입니다.');
    p.assigned[ch.id] = a.color;
    duelLog(state, `색상 선택 카드가 ${DUEL_COLOR_LABEL[a.color]} 보너스가 되었습니다.`);
  } else if (ch.type === 'royal') {
    if (!ch.options.includes(a.id)) return duelFail('고를 수 없는 왕실 카드입니다.');
    state.royals.splice(state.royals.indexOf(a.id), 1);
    p.royals.push(a.id);
    p.claimed += 1;
    const rc = duelRoyal(a.id);
    duelLog(state, `${duelName(state, seat)}이(가) 왕실 카드를 받았습니다. (+${rc.pts}점)`);
    duelNote(state, seat, 'royal', { id: a.id });
    // 능력을 먼저 쓰고, 왕관이 한꺼번에 둘을 채웠다면 다시 확인한다
    state.queue.unshift({ k: 'royalpower', id: a.id }, { k: 'royalcheck' });
  } else if (ch.type === 'steal') {
    if (!ch.options.includes(a.type) || opp.tokens[a.type] < 1) return duelFail('가져올 수 없는 토큰입니다.');
    opp.tokens[a.type] -= 1;
    p.tokens[a.type] += 1;
    duelLog(state, `${duelName(state, seat)}이(가) 상대의 ${DUEL_COLOR_LABEL[a.type]}을(를) 빼앗았습니다.`);
    duelFx(state, { k: 'steal', seat, type: a.type, got: true });
  } else if (ch.type === 'pick') {
    if (!ch.options.includes(a.pos) || state.board[a.pos] !== ch.color) return duelFail('가져올 수 없는 칸입니다.');
    state.board[a.pos] = null;
    p.tokens[ch.color] += 1;
    duelLog(state, `${duelName(state, seat)}이(가) 판에서 ${DUEL_COLOR_LABEL[ch.color]}을(를) 가져왔습니다.`);
    duelFx(state, { k: 'token', seat, color: ch.color, got: true });
  } else if (ch.type === 'discard') {
    const list = a.discard;
    if (!Array.isArray(list) || list.length !== ch.n) return duelFail(`${ch.n}개를 골라야 합니다.`);
    const need = {};
    for (const t of list) {
      if (!DUEL.TOKEN_TYPES.includes(t)) return duelFail('토큰 종류가 맞지 않습니다.');
      need[t] = (need[t] || 0) + 1;
    }
    for (const t of Object.keys(need)) if (p.tokens[t] < need[t]) return duelFail('가진 것보다 많이 버릴 수 없습니다.');
    list.forEach((t) => {
      p.tokens[t] -= 1;
      state.bag.push(t);
    });
    duelLog(state, `${duelName(state, seat)}이(가) 토큰 ${ch.n}개를 버렸습니다.`);
  }

  state.choice = null;
  duelBump(state);
  duelAdvance(state, rng);
  return { ok: true };
}

// ---- 상대에게 보여 줄 모습 ----
// 덱과 주머니는 순서와 내용을 숨기고 개수만, 상대가 몰래 예약한 카드는 티어만 보여 준다.
function duelViewFor(state, seat) {
  const v = JSON.parse(JSON.stringify(state));
  v.deckN = { 1: v.decks[1].length, 2: v.decks[2].length, 3: v.decks[3].length };
  v.bagN = v.bag.length;
  delete v.decks;
  delete v.bag;
  const other = v.players[1 - seat];
  if (other) {
    other.reserved = other.reserved.map((r) => (r.secret ? { id: null, secret: true, lv: duelCard(r.id).lv } : r));
  }
  return v;
}

// 화면에 쓰는 요약
function duelSummary(state, seat) {
  return {
    points: duelPoints(state, seat),
    crowns: duelCrowns(state, seat),
    colorPoints: duelColorPoints(state, seat),
    bonus: duelBonus(state, seat),
  };
}
