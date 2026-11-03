'use strict';

// ============ 스플렌더 듀얼 연습 상대 (AI) ============
// 화면과 자동 대국 시험이 같이 쓴다. 지금 상태에서 "다음에 할 행동 하나"만 돌려주며,
// 부르는 쪽이 duelApply로 적용하고 자기 차례가 끝날 때까지 되풀이한다.
//
// 생각하는 방식 (한 수 앞만 본다. 깊은 탐색은 하지 않는다)
//  1. 목표 카드를 몇 장 고른다. 값이 크고, 모자란 토큰이 적고, 필요한 토큰이 지금 판에 있는 카드를 높게 본다.
//  2. 이길 수 있으면 이긴다. 상대가 다음에 이길 카드가 있으면 내가 사거나 예약해서 막는다 (견제).
//  3. 살 수 있는 카드 중 값진 것을 산다. 상대가 사려던 카드면 조금 더 쳐 준다.
//  4. 못 사면 목표 카드들에 필요한 토큰이 가장 많이 들어 있는 줄을 집는다. 상대가 필요로 하는 토큰은 조금 더 쳐 준다.
//     특권 두루마리는 "그것으로 지금 살 수 있게 될 때" 아끼지 않고 쓴다.
//  5. 판 채우기는 맨 마지막 수단이다. 채우면 상대가 특권을 받기 때문이다.
// 연습 상대와 규칙 시험용이라 완벽하지는 않다.

const DUEL_AI_POWER = { replay: 3, scroll: 1.5, token: 1, steal: 1.5 };
// 목표 카드 1, 2, 3순위가 토큰 줄을 고를 때 갖는 무게
const DUEL_AI_TARGET_W = [1, 0.7, 0.45];
// 쓸 만한 줄이나 예약의 점수가 이보다 낮을 때만 판을 채운다
const DUEL_AI_REPLENISH_BELOW = 0.4;

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
  const cost = duelCardCost(state, id); // 이번 판의 실제 비용 (색이 섞여 있다)
  const p = state.players[seat];
  const bonus = duelBonus(state, seat);
  const need = {};
  let total = 0;
  DUEL.COLORS.forEach((c) => {
    const n = Math.max(0, (cost[c] || 0) - bonus[c] - p.tokens[c]);
    need[c] = n;
    total += n;
  });
  need.pearl = Math.max(0, (cost.pearl || 0) - p.tokens.pearl);
  total += need.pearl;
  const shortage = Math.max(0, total - p.tokens.gold);
  return { need, total, shortage };
}

// 이 카드를 사면 바로 이기는가 (점수 20, 왕관 10, 한 색 10점). 왕실 카드가 주는 점수는 세지 않는다.
function duelAiWins(state, seat, id) {
  const card = duelCard(id);
  if (duelPoints(state, seat) + card.pts >= DUEL.WIN_POINTS) return true;
  if (duelCrowns(state, seat) + card.crowns >= DUEL.WIN_CROWNS) return true;
  const cp = duelColorPoints(state, seat);
  if (DUEL.COLORS.includes(card.bonus)) return cp[card.bonus] + card.pts >= DUEL.WIN_COLOR;
  if (card.bonus === 'wild') {
    const b = duelBonus(state, seat);
    return DUEL.COLORS.some((c) => b[c] > 0 && cp[c] + card.pts >= DUEL.WIN_COLOR);
  }
  return false;
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

// 지금 판 위에 있는 토큰 수 (종류별)
function duelAiBoardCount(state) {
  const c = {};
  DUEL.TOKEN_TYPES.forEach((t) => (c[t] = 0));
  state.board.forEach((t) => {
    if (t) c[t] += 1;
  });
  return c;
}

// 필요한 토큰(need) 가운데 k개를 지금 판에서 집을 수 있는가
function duelAiBoardCovers(state, need, k) {
  const bc = duelAiBoardCount(state);
  let got = 0;
  DUEL.COLORS.concat(['pearl']).forEach((t) => {
    got += Math.min(need[t] || 0, bc[t]);
  });
  return got >= k;
}

// 목표 후보를 좋은 순으로 줄 세운다. useMem 이면 내 목표 기억을 따른다 (상대를 볼 때는 기억도, 몰래 예약한 카드도 쓰지 않는다).
function duelAiRank(state, seat, useMem) {
  const p = state.players[seat];
  const memKey = (state.gameId || '') + ':' + seat;
  const prevId = useMem ? DUEL_AI_MEM[memKey] : undefined;
  const bonus = duelBonus(state, seat);
  const hasColor = DUEL.COLORS.some((c) => bonus[c] > 0);
  const bc = duelAiBoardCount(state);
  const ids = [];
  [1, 2, 3].forEach((lv) => state.pyramid[lv].forEach((id) => id !== null && ids.push({ id, from: 'pyr' })));
  p.reserved.forEach((r, i) => r.id !== null && (useMem || !r.secret) && ids.push({ id: r.id, from: 'res', i }));
  const list = [];
  ids.forEach((x) => {
    const card = duelCard(x.id);
    if (card.bonus === 'wild' && !hasColor) return;
    const n = duelAiNeeds(state, seat, x.id);
    if (n.shortage > 0 && !duelAiReachable(state, seat, n)) return; // 구할 수 없는 토큰이 필요한 카드는 노리지 않는다
    // 필요한 토큰이 지금 판에 얼마나 있나: 판에도 없고 금도 못 메우는 만큼은 당장 구하기 어렵다
    let collect = 0;
    DUEL.COLORS.concat(['pearl']).forEach((t) => {
      collect += Math.min(n.need[t] || 0, bc[t]);
    });
    const gap = Math.max(0, n.shortage - collect);
    const score = duelAiValue(state, seat, x.id) - n.shortage * 0.9 - gap * 1.0 + (x.id === prevId ? 1.8 : 0);
    list.push({ ref: x, score, needs: n });
  });
  list.sort((a, b) => b.score - a.score);
  return list;
}

function duelAiTarget(state, seat) {
  const list = duelAiRank(state, seat, true);
  const best = list.length ? list[0] : null;
  if (best) DUEL_AI_MEM[(state.gameId || '') + ':' + seat] = best.ref.id;
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

// 상대가 다음 차례에 살 수 있는 판 위의 카드들 (견제할 대상). 특권으로 모자란 토큰을 메울 수 있는 경우도 센다.
function duelAiThreats(state, seat) {
  const opp = 1 - seat;
  const po = state.players[opp];
  const bonus = duelBonus(state, opp);
  const out = [];
  [1, 2, 3].forEach((lv) =>
    state.pyramid[lv].forEach((id, i) => {
      if (id === null) return;
      const now = !!duelPayment(state, opp, id);
      let near = false;
      if (!now && po.scrolls > 0 && !(duelCard(id).bonus === 'wild' && !DUEL.COLORS.some((c) => bonus[c] > 0))) {
        const n = duelAiNeeds(state, opp, id);
        near = n.shortage > 0 && n.shortage <= po.scrolls && duelAiBoardCovers(state, n.need, n.shortage);
      }
      if (!now && !near) return;
      out.push({ id, src: { k: 'pyr', lv, i }, now, gain: Math.min(8, Math.max(0, duelAiValue(state, opp, id))), wins: duelAiWins(state, opp, id) });
    })
  );
  return out;
}

// 목표 후보들이 토큰 한 개(종류 t, 이미 같은 줄에서 j개 집은 뒤)에 매기는 값
function duelAiTokenWant(top, t, j) {
  let g = 0;
  top.forEach((x, k) => {
    if ((x.needs.need[t] || 0) > j) g += DUEL_AI_TARGET_W[k] * 1.6;
  });
  return g;
}

// 지금 상태에서 할 행동 하나
function duelAiAction(state, seat, rng) {
  const r = rng || Math.random;
  const p = state.players[seat];
  const opp = 1 - seat;

  // ---- 선택이 걸려 있으면 그것부터 ----
  if (state.choice) {
    const ch = state.choice;
    if (ch.type === 'wild') {
      // 색상 선택: 이미 모은 색(한 색 점수)과, 지금 목표 카드들이 비용으로 요구하는 색을 함께 본다
      const b = duelBonus(state, seat);
      const cp = duelColorPoints(state, seat);
      const top = duelAiRank(state, seat, true).slice(0, 3);
      const want = (c) => top.reduce((s, x, k) => s + DUEL_AI_TARGET_W[k] * (duelCardCost(state, x.ref.id)[c] || 0), 0);
      const col = ch.options.slice().sort((x, y) => b[y] * 0.5 + cp[y] * 0.4 + want(y) * 0.3 - (b[x] * 0.5 + cp[x] * 0.4 + want(x) * 0.3))[0];
      return { t: 'choose', color: col };
    }
    if (ch.type === 'royal') {
      const id = ch.options.slice().sort((x, y) => duelRoyal(y).pts + (duelRoyal(y).power ? 1 : 0) - duelRoyal(x).pts - (duelRoyal(x).power ? 1 : 0))[0];
      return { t: 'choose', id };
    }
    if (ch.type === 'steal') {
      // 상대에게서 가져온다: 내가 필요한 토큰, 상대가 필요한 토큰(견제), 진주 순으로
      const target = duelAiTarget(state, seat);
      const wanted = target ? target.needs.need : {};
      const oppTop = duelAiRank(state, opp, false)[0];
      const oppWant = oppTop ? oppTop.needs.need : {};
      const sc = (t) => (wanted[t] > 0 ? 2 : 0) + (oppWant[t] > 0 ? 1.2 : 0) + (t === 'pearl' ? 1 : 0);
      const type = ch.options.slice().sort((x, y) => sc(y) - sc(x))[0];
      return { t: 'choose', type };
    }
    if (ch.type === 'pick') {
      // 판에서 같은 색 보석 하나: 목표 카드들이 필요로 하는 색이면 좋다
      const top = duelAiRank(state, seat, true).slice(0, 3);
      const oppTop = duelAiRank(state, opp, false)[0];
      const sc = (pos) => {
        const t = state.board[pos];
        return duelAiTokenWant(top, t, 0) + (oppTop && (oppTop.needs.need[t] || 0) > 0 ? 0.3 : 0);
      };
      return { t: 'choose', pos: ch.options.slice().sort((a, b) => sc(b) - sc(a))[0] };
    }
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

  // ---- 살 수 있는 카드 ----
  const affordable = [];
  const consider = (id, src) => {
    const q = duelPayment(state, seat, id);
    if (q) affordable.push({ id, src, q });
  };
  [1, 2, 3].forEach((lv) => state.pyramid[lv].forEach((id, i) => id !== null && consider(id, { k: 'pyr', lv, i })));
  p.reserved.forEach((rr, i) => rr.id !== null && consider(rr.id, { k: 'res', i }));

  // 이길 수 있으면 이긴다
  const winNow = affordable.find((a) => duelAiWins(state, seat, a.id));
  if (winNow) return { t: 'buy', src: winNow.src };

  // ---- 견제 1: 상대가 다음 차례에 이기는 카드가 딱 한 장이면 막는다 (두 장이면 하나를 막아도 소용없다) ----
  const threats = duelAiThreats(state, seat);
  const killers = threats.filter((t) => t.wins);
  if (killers.length === 1) {
    const k = killers[0];
    const mine = affordable.find((a) => a.id === k.id);
    if (mine) return { t: 'buy', src: mine.src };
    if (!state.mainDone && duelCanReserve(state, seat)) return { t: 'reserve', src: k.src };
  }
  const threatOf = {};
  threats.forEach((t) => (threatOf[t.id] = t));

  // ---- 살 카드 고르기: 값 + 상대가 사려던 카드면 가산(견제) ----
  let buy = null;
  affordable.forEach((a) => {
    const th = threatOf[a.id];
    const deny = th ? th.gain * (th.now ? 0.8 : 0.4) : 0;
    const score = duelAiValue(state, seat, a.id) - a.q.pay.gold * 0.7 + deny;
    if (!buy || score > buy.score) buy = { score, src: a.src };
  });

  const ranked = duelAiRank(state, seat, true);
  const target = ranked.length ? ranked[0] : null;
  if (target) DUEL_AI_MEM[(state.gameId || '') + ':' + seat] = target.ref.id;
  const top = ranked.slice(0, 3);

  // ---- 선택 행동: 특권으로 모자란 토큰을 메워 지금 살 수 있게 한다 ----
  if (!state.mainDone && p.scrolls > 0 && !buy) {
    const pos = duelAiScrollPick(state, seat, ranked);
    if (pos >= 0) return { t: 'priv', pos };
  }

  if (buy) return { t: 'buy', src: buy.src };

  // ---- 토큰을 집는다 ----
  const takes = duelLegalTakes(state);
  let bestTake = null;
  const have = duelTokenTotal(p);
  const oppRank = duelAiRank(state, opp, false);
  const oppTop = oppRank.length && oppRank[0].needs.shortage <= 3 ? oppRank[0] : null; // 상대의 가까운 목표
  takes.forEach((line) => {
    const types = line.map((pos) => state.board[pos]);
    const cnt = {};
    let sc = 0;
    types.forEach((t) => {
      const j = cnt[t] || 0;
      cnt[t] = j + 1;
      let g = duelAiTokenWant(top, t, j);
      if (g === 0) g = t === 'pearl' ? 0.5 : 0.15;
      sc += g;
      if (oppTop && (oppTop.needs.need[t] || 0) > j) sc += 0.6; // 상대가 필요한 토큰을 먼저 집는다 (견제)
    });
    if (duelTakeIsGreedy(types)) sc -= 2.6;
    const over = have + types.length - DUEL.TOKEN_MAX;
    if (over > 0) sc -= over * 1.2;
    sc += r() * 0.05;
    if (!bestTake || sc > bestTake.sc) bestTake = { sc, line };
  });

  const canRep = !state.mainDone && duelBagLen(state) > 0 && state.board.includes(null);

  // ---- 예약: 금(아무 토큰이나 대신한다)을 받고, 목표 카드를 지키고, 상대가 사려는 카드를 가로챈다 ----
  let bestRes = null;
  if (!state.mainDone && duelCanReserve(state, seat)) {
    const slotCost = p.reserved.length * 0.7;
    [1, 2, 3].forEach((lv) =>
      state.pyramid[lv].forEach((id, i) => {
        if (id === null) return;
        const rk = ranked.find((x) => x.ref.id === id);
        let sc = -0.5 - slotCost;
        if (rk) {
          sc += rk.needs.shortage > 0 ? 1.6 : 0; // 금이 모자란 토큰 하나를 메운다
          if (rk === target) sc += 1.0 + Math.min(2, Math.max(0, duelAiValue(state, seat, id)) * 0.1); // 내 목표를 상대에게 뺏기지 않는다
        }
        const th = threatOf[id];
        if (th) sc += th.gain * (th.now ? 1.0 : 0.5);
        if (!bestRes || sc > bestRes.sc) bestRes = { sc, src: { k: 'pyr', lv, i } };
      })
    );
  }

  // 토큰을 한도 가까이 쥐고도 쓸 만한 줄이 없으면, 카드를 예약해 금을 받는다.
  // (목표가 이미 예약한 카드라서 위의 예약 점수에 안 걸릴 때도 막히지 않게)
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

  const takeSc = bestTake ? bestTake.sc : -Infinity;
  const resSc = bestRes ? bestRes.sc : -Infinity;

  // 예약이 집기보다 낫다고 보면 예약한다
  if (bestRes && resSc > takeSc && resSc >= 0.8) return { t: 'reserve', src: bestRes.src };

  // 쓸 만한 줄도 예약도 없을 때만 판을 채운다 (채우면 상대가 특권을 받는다)
  if (canRep && Math.max(takeSc, resSc) < DUEL_AI_REPLENISH_BELOW) return { t: 'replenish' };

  if (bestTake) return { t: 'take', pos: bestTake.line };
  if (bestRes) return { t: 'reserve', src: bestRes.src };
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

// 특권 두루마리를 쓸 자리. 쓰면 지금 살 수 있게 되는 카드가 있을 때, 두루마리를 쥐고 있다가 잃을 위험이 있을 때,
// 두 장 이상 쥐고 있을 때 쓴다. 쓸 곳이 없으면 -1.
function duelAiScrollPick(state, seat, ranked) {
  const p = state.players[seat];
  const bc = duelAiBoardCount(state);
  // (1) 두루마리 p.scrolls 장 이하로 모자란 토큰을 다 채울 수 있는 카드 — 값이 큰 순
  let plan = null;
  ranked.forEach((x) => {
    const n = x.needs;
    if (n.shortage <= 0 || n.shortage > p.scrolls) return;
    let have = 0;
    DUEL.COLORS.concat(['pearl']).forEach((t) => {
      have += Math.min(n.need[t] || 0, bc[t]);
    });
    if (have < n.shortage) return;
    if (!plan || x.score > plan.score) plan = x;
  });
  const pickFor = (need) => {
    let pos = -1;
    state.board.forEach((t, i) => {
      if (pos < 0 && t && t !== 'gold' && (need[t] || 0) > 0) pos = i;
    });
    return pos;
  };
  if (plan) return pickFor(plan.needs.need);
  const target = ranked[0];
  if (!target || target.needs.shortage <= 0) return -1;
  // (2) 두루마리 더미가 비었으면 내 두루마리를 상대가 가져갈 수 있다 / (3) 두 장 이상 쥐고 있다
  if (state.scrolls === 0 || p.scrolls >= 2) return pickFor(target.needs.need);
  return -1;
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
