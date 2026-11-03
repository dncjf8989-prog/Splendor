'use strict';

// ============ 스플렌더 듀얼 연습 상대 (AI) ============
// 화면과 자동 대국 시험이 같이 쓴다. 지금 상태에서 "다음에 할 행동 하나"만 돌려주며,
// 부르는 쪽이 duelApply로 적용하고 자기 차례가 끝날 때까지 되풀이한다.
//
// 아주 영리하지는 않다. 살 수 있는 카드 중 값진 것을 사고, 아니면 목표 카드 하나를 정해
// 그 카드에 필요한 토큰을 집는다. 연습 상대와 규칙 시험용이다.

const DUEL_AI_POWER = { replay: 3, scroll: 1.5, token: 1, steal: 1.5 };

function duelAiValue(state, seat, id) {
  const card = duelCard(id);
  const p = state.players[seat];
  const own = p.cards.length;
  // 초반일수록 할인(보너스)이 값지다
  const discount = card.bonus === 'none' ? 0 : card.bonus === 'wild' ? 1.5 : Math.max(0.3, 2.2 - own * 0.18);
  const cp = duelColorPoints(state, seat);
  let v = card.pts * 3 + card.crowns * 1.6 + discount + (card.power ? DUEL_AI_POWER[card.power] || 0 : 0);
  // 한 색으로 10점을 노릴 수 있는 색이면 조금 더
  if (card.bonus !== 'wild' && card.bonus !== 'none' && cp[card.bonus] + card.pts >= 7) v += 1.5;
  const crowns = duelCrowns(state, seat);
  [3, 6, 10].forEach((n) => {
    if (crowns < n && crowns + card.crowns >= n) v += n === 10 ? 6 : 2.5;
  });
  const total = Object.keys(card.cost).reduce((s, k) => s + card.cost[k], 0);
  return v - total * 0.25;
}

// 카드를 사려면 더 필요한 토큰
function duelAiNeeds(state, seat, id) {
  const card = duelCard(id);
  const p = state.players[seat];
  const bonus = duelBonus(state, seat);
  const need = {};
  let total = 0;
  DUEL.COLORS.forEach((c) => {
    const n = Math.max(0, (card.cost[c] || 0) - bonus[c] - p.tokens[c]);
    need[c] = n;
    total += n;
  });
  need.pearl = Math.max(0, (card.cost.pearl || 0) - p.tokens.pearl);
  total += need.pearl;
  const shortage = Math.max(0, total - p.tokens.gold);
  return { need, total, shortage };
}

// 목표 카드를 기억한다 (같은 판, 같은 자리). 매 턴 목표가 바뀌면 토큰만 쌓고 아무것도 못 산다.
const DUEL_AI_MEM = {};

// 판 위(와 주머니)에서 앞으로 더 가져올 수 있는 토큰 수. 주머니 내용을 모르는 화면(요약 상태)에서는 넉넉히 본다.
function duelAiSupply(state) {
  const a = {};
  DUEL.TOKEN_TYPES.forEach((t) => (a[t] = 0));
  state.board.forEach((t) => {
    if (t) a[t] += 1;
  });
  if (state.bag) state.bag.forEach((t) => (a[t] += 1));
  else if (state.bagN) DUEL.TOKEN_TYPES.forEach((t) => (a[t] += state.bagN));
  return a;
}

// 부족한 토큰을 구할 길이 있는가. 판과 주머니에 없는 색은 금(이미 가졌거나 예약으로 받을 수 있는 만큼)으로만 메운다.
function duelAiReachable(state, seat, needs) {
  const p = state.players[seat];
  const a = duelAiSupply(state);
  let miss = 0;
  DUEL.COLORS.concat(['pearl']).forEach((c) => {
    miss += Math.max(0, (needs.need[c] || 0) - a[c]);
  });
  const slots = DUEL.RESERVE_MAX - p.reserved.length;
  const goldMore = duelCanReserve(state, seat) ? Math.min(a.gold, slots) : 0;
  return miss <= p.tokens.gold + goldMore;
}

function duelAiTarget(state, seat) {
  const p = state.players[seat];
  const memKey = (state.gameId || '') + ':' + seat;
  const prevId = DUEL_AI_MEM[memKey];
  const ids = [];
  [1, 2, 3].forEach((lv) => state.pyramid[lv].forEach((id) => id !== null && ids.push({ id, from: 'pyr' })));
  p.reserved.forEach((r, i) => r.id !== null && ids.push({ id: r.id, from: 'res', i }));
  let best = null;
  ids.forEach((x) => {
    const card = duelCard(x.id);
    if (card.bonus === 'wild' && !DUEL.COLORS.some((c) => duelBonus(state, seat)[c] > 0)) return;
    const n = duelAiNeeds(state, seat, x.id);
    if (n.shortage > 0 && !duelAiReachable(state, seat, n)) return; // 구할 수 없는 토큰이 필요한 카드는 노리지 않는다
    const score = duelAiValue(state, seat, x.id) - n.shortage * 0.9 + (x.id === prevId ? 1.8 : 0);
    if (!best || score > best.score) best = { ref: x, score, needs: n };
  });
  if (best) DUEL_AI_MEM[memKey] = best.ref.id;
  return best;
}

function duelAiSrc(state, x) {
  if (x.from === 'res') return { k: 'res', i: x.i };
  for (const lv of [1, 2, 3]) {
    const i = state.pyramid[lv].indexOf(x.id);
    if (i >= 0) return { k: 'pyr', lv, i };
  }
  return null;
}

// 지금 상태에서 할 행동 하나
function duelAiAction(state, seat, rng) {
  const r = rng || Math.random;
  const p = state.players[seat];

  // ---- 선택이 걸려 있으면 그것부터 ----
  if (state.choice) {
    const ch = state.choice;
    if (ch.type === 'wild') {
      const b = duelBonus(state, seat);
      const col = ch.options.slice().sort((x, y) => b[y] - b[x])[0];
      return { t: 'choose', color: col };
    }
    if (ch.type === 'royal') {
      const id = ch.options.slice().sort((x, y) => duelRoyal(y).pts + (duelRoyal(y).power ? 1 : 0) - duelRoyal(x).pts - (duelRoyal(x).power ? 1 : 0))[0];
      return { t: 'choose', id };
    }
    if (ch.type === 'steal') {
      const target = duelAiTarget(state, seat);
      const wanted = target ? target.needs.need : {};
      const type = ch.options.slice().sort((x, y) => (wanted[y] > 0 ? 2 : 0) + (y === 'pearl' ? 1 : 0) - ((wanted[x] > 0 ? 2 : 0) + (x === 'pearl' ? 1 : 0)))[0];
      return { t: 'choose', type };
    }
    if (ch.type === 'pick') return { t: 'choose', pos: ch.options[0] };
    if (ch.type === 'discard') {
      const target = duelAiTarget(state, seat);
      const wanted = target ? target.needs.need : {};
      const keep = (t) => (t === 'gold' ? 3 : 0) + (wanted[t] > 0 ? 2 : 0) + (t === 'pearl' ? 1 : 0);
      const pool = [];
      DUEL.TOKEN_TYPES.forEach((t) => {
        for (let i = 0; i < p.tokens[t]; i++) pool.push(t);
      });
      pool.sort((a, b) => keep(a) - keep(b));
      return { t: 'choose', discard: pool.slice(0, ch.n) };
    }
  }

  // ---- 살 수 있는 카드가 있으면 가장 값진 것을 산다 ----
  let buy = null;
  const consider = (id, src) => {
    const q = duelPayment(state, seat, id);
    if (!q) return;
    const score = duelAiValue(state, seat, id) - q.pay.gold * 0.7;
    if (!buy || score > buy.score) buy = { score, src };
  };
  [1, 2, 3].forEach((lv) => state.pyramid[lv].forEach((id, i) => id !== null && consider(id, { k: 'pyr', lv, i })));
  p.reserved.forEach((rr, i) => rr.id !== null && consider(rr.id, { k: 'res', i }));

  const target = duelAiTarget(state, seat);

  // ---- 선택 행동: 특권을 써서 필요한 토큰을 바로 집는다 ----
  if (!state.mainDone && p.scrolls > 0 && !buy && target) {
    const wanted = target.needs.need;
    let pos = -1;
    state.board.forEach((t, i) => {
      if (pos < 0 && t && t !== 'gold' && wanted[t] > 0) pos = i;
    });
    if (pos >= 0) return { t: 'priv', pos };
  }

  if (buy) return { t: 'buy', src: buy.src };

  // ---- 토큰을 집는다 ----
  const takes = duelLegalTakes(state);
  let bestTake = null;
  const wanted = target ? target.needs.need : {};
  const have = duelTokenTotal(p);
  takes.forEach((line) => {
    const types = line.map((pos) => state.board[pos]);
    let sc = 0;
    const left = Object.assign({}, wanted);
    types.forEach((t) => {
      if (left[t] > 0) {
        sc += 1.6;
        left[t] -= 1;
      } else sc += t === 'pearl' ? 0.5 : 0.15;
    });
    if (duelTakeIsGreedy(types)) sc -= 2.6;
    const over = have + types.length - DUEL.TOKEN_MAX;
    if (over > 0) sc -= over * 1.2;
    sc += r() * 0.05;
    if (!bestTake || sc > bestTake.sc) bestTake = { sc, line };
  });

  const canRep = !state.mainDone && duelBagLen(state) > 0 && state.board.includes(null);

  // 토큰을 한도 가까이 쥐고도 쓸 만한 줄이 없으면, 카드를 예약해 금을 받는다.
  // (목표가 이미 예약한 카드라서 아래의 예약 규칙에 안 걸릴 때도 막히지 않게)
  if (!state.mainDone && have >= DUEL.TOKEN_MAX - 1 && (!bestTake || bestTake.sc < 1.0) && duelCanReserve(state, seat)) {
    let pick = null;
    [1, 2, 3].forEach((lv) =>
      state.pyramid[lv].forEach((id, i) => {
        if (id === null) return;
        const sc = duelAiValue(state, seat, id) - duelAiNeeds(state, seat, id).shortage * 0.9;
        if (!pick || sc > pick.sc) pick = { sc, src: { k: 'pyr', lv, i } };
      })
    );
    if (pick) return { t: 'reserve', src: pick.src };
  }

  // 쓸 만한 줄이 없으면 먼저 판을 채운다
  if (canRep && (!bestTake || bestTake.sc < 0.4)) return { t: 'replenish' };

  // 목표 카드를 아직 못 사고, 금이 있고 예약 칸이 남았으면 비싼 카드는 미리 잡아 둔다
  if (target && target.ref.from === 'pyr' && duelCanReserve(state, seat) && p.reserved.length < 2) {
    const card = duelCard(target.ref.id);
    if (card.pts >= 3 && target.needs.shortage > 0 && (!bestTake || bestTake.sc < 1.2)) {
      const src = duelAiSrc(state, target.ref);
      if (src) return { t: 'reserve', src };
    }
  }

  if (bestTake) return { t: 'take', pos: bestTake.line };
  if (duelCanReserve(state, seat)) {
    // 집을 것이 하나도 없으면 아무 보이는 카드나 예약한다
    for (const lv of [3, 2, 1]) {
      const i = state.pyramid[lv].findIndex((id) => id !== null);
      if (i >= 0) return { t: 'reserve', src: { k: 'pyr', lv, i } };
    }
    for (const lv of [1, 2, 3]) if (duelDeckLen(state, lv) > 0) return { t: 'reserve', src: { k: 'deck', lv } };
  }
  return { t: 'pass' };
}

// 자기 차례(와 선택)가 끝날 때까지 둔다. 둔 행동 수를 돌려준다.
// 카드 능력으로 한 번 더 두는 경우에는 차례가 그대로 내게 있으므로 계속 둔다.
function duelAiPlayTurn(state, seat, rng) {
  let n = 0;
  while (!state.over && n < 40) {
    const mine = state.choice ? state.choice.seat === seat : state.turn === seat;
    if (!mine) break;
    const a = duelAiAction(state, seat, rng);
    const res = duelApply(state, seat, a, rng);
    if (!res.ok && !duelAiFallback(state, seat, rng)) break; // 규칙에 어긋난 수를 골랐다면 안전한 수로 바꾼다
    n += 1;
  }
  return n;
}

function duelAiFallback(state, seat, rng) {
  if (state.choice) return false;
  const takes = duelLegalTakes(state);
  if (takes.length && duelApply(state, seat, { t: 'take', pos: takes[0] }, rng).ok) return true;
  if (duelApply(state, seat, { t: 'replenish' }, rng).ok) return true;
  return duelApply(state, seat, { t: 'pass' }, rng).ok;
}
