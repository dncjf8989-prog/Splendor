'use strict';

// ============ 싱글 플레이용 AI (0번 자리를 제외한 모든 자리를 조작) ============
// game.js의 전역 G와 실제 행동 함수(confirmTake/buyBoardCard/...)를 그대로 쓴다.
// AI가 자기 턴을 처리하는 동안에는 AI.acting을 켜서 canAct() 가드를 통과한다.

const AI = {
  acting: false,
  timer: null,
  delayMs: 700,
};
window.AI = AI;

// ============ 평가 함수 ============

// 보드에 깔린 카드들이 요구하는 색일수록 보너스 가치가 높다.
function aiColorDemand(color) {
  let n = 0;
  G.tiers.forEach((tier) => {
    tier.faceUp.forEach((card) => {
      if (card && card.cost[color]) n += card.cost[color];
    });
  });
  return n;
}

// 아직 남은 귀족이 요구하는 색이면 가치가 높다.
function aiNobleNeed(player, color) {
  let n = 0;
  G.nobles.forEach((noble) => {
    if (!noble || !noble.requires[color]) return;
    const short = noble.requires[color] - (player.bonuses[color] || 0);
    if (short > 0) n += 1;
  });
  return n;
}

function aiCardScore(card, player) {
  let score = card.points * 3;
  score += aiColorDemand(card.gem) * 0.15;
  score += aiNobleNeed(player, card.gem) * 1.5;
  // 이미 많이 쌓은 색의 보너스는 가치가 떨어진다.
  score -= (player.bonuses[card.gem] || 0) * 0.4;
  // 승리 점수에 가까워질수록 0점짜리 카드에 턴을 쓰지 않는다.
  if (card.points === 0) score -= (player.points / winPoints()) * 3;
  const total = Object.values(card.cost).reduce((a, b) => a + b, 0);
  score -= total * 0.15;
  return score;
}

// 카드를 사기까지 아직 모자란 토큰 개수 (보너스와 보유 골드를 감안)
function aiMissingTokens(player, cost) {
  let missing = 0;
  for (const c of GEMS) {
    const need = Math.max(0, (cost[c] || 0) - (player.bonuses[c] || 0));
    missing += Math.max(0, need - (player.tokens[c] || 0));
  }
  return Math.max(0, missing - (player.tokens.gold || 0));
}

function aiVisibleCards(player) {
  const list = [];
  G.tiers.forEach((tier, t) => {
    tier.faceUp.forEach((card, idx) => {
      if (card) list.push({ card, source: { type: 'board', tier: t, idx } });
    });
  });
  player.reserved.forEach((card, idx) => {
    list.push({ card, source: { type: 'reserved', idx } });
  });
  return list;
}

// 지금 당장 못 사더라도 가장 가까운 "목표 카드"를 고른다.
function aiPickTarget(player) {
  let best = null;
  aiVisibleCards(player).forEach(({ card }) => {
    const dist = aiMissingTokens(player, card.cost);
    const score = aiCardScore(card, player) / (dist + 1);
    if (!best || score > best.score) best = { card, score };
  });
  return best ? best.card : null;
}

// 목표 카드를 사려면 더 필요한 색을, 많이 모자란 순서로
function aiWantedColors(player, cost) {
  return GEMS.map((c) => {
    const need = Math.max(0, (cost[c] || 0) - (player.bonuses[c] || 0));
    return { color: c, short: Math.max(0, need - (player.tokens[c] || 0)) };
  })
    .filter((x) => x.short > 0 && G.bank[x.color] > 0)
    .sort((a, b) => b.short - a.short)
    .map((x) => x.color);
}

function aiPickTokens(player) {
  const target = aiPickTarget(player);
  const wanted = target ? aiWantedColors(player, target.cost) : [];
  const spare = GEMS.filter((c) => G.bank[c] > 0 && !wanted.includes(c));

  // 필요한 색이 하나뿐이고 은행에 넉넉하면 같은 색 2개를 집는다.
  if (wanted.length === 1 && G.bank[wanted[0]] >= 4) return [wanted[0], wanted[0]];

  return wanted.concat(spare).slice(0, 3);
}

// ============ 턴 처리 ============
function aiTakeTurn() {
  if (!window.NET || NET.mode !== 'single') return;
  if (!G || G.gameOver || !isAiSeat(G.currentIndex)) return;

  const me = G.players[G.currentIndex];
  AI.acting = true;
  try {
    // 1) 살 수 있는 카드가 있으면 가장 가치 있는 것을 산다.
    const buyable = aiVisibleCards(me)
      .filter(({ card }) => affordability(me, card.cost).ok)
      .map((entry) => ({ ...entry, score: aiCardScore(entry.card, me) }))
      .sort((a, b) => b.score - a.score);

    if (buyable.length) {
      const pick = buyable[0];
      if (pick.source.type === 'board') buyBoardCard(pick.source.tier, pick.source.idx);
      else buyReservedCard(pick.source.idx);
      return;
    }

    // 2) 아직 못 사는 고득점 카드는 골드를 받으며 선점해 둔다.
    const bigCard = aiVisibleCards(me)
      .filter(({ card, source }) => source.type === 'board' && card.points >= 4)
      .sort((a, b) => b.card.points - a.card.points)[0];
    if (bigCard && me.reserved.length === 0 && G.bank.gold > 0) {
      reserveCard(bigCard.source.tier, bigCard.source.idx);
      return;
    }

    // 3) 목표 카드에 필요한 토큰을 가져온다.
    const picks = aiPickTokens(me);
    if (picks.length) {
      G.pending = picks;
      confirmTake();
      return;
    }

    // 4) 토큰이 동났으면 카드라도 예약한다.
    if (me.reserved.length < 3) {
      const anyCard = aiVisibleCards(me).find(({ source }) => source.type === 'board');
      if (anyCard) {
        reserveCard(anyCard.source.tier, anyCard.source.idx);
        return;
      }
    }

    // 5) 아무것도 할 수 없으면 턴을 넘긴다.
    log(`${me.name}이(가) 할 수 있는 행동이 없어 턴을 넘깁니다.`);
    finishTurnFlow(me);
  } finally {
    AI.acting = false;
  }
}

// 사람이 AI의 진행을 눈으로 따라갈 수 있도록 잠깐 뒤에 움직인다.
function aiScheduleTurn() {
  if (!window.NET || NET.mode !== 'single') return;
  if (!G || G.gameOver || !isAiSeat(G.currentIndex)) return;
  clearTimeout(AI.timer);
  AI.timer = setTimeout(aiTakeTurn, AI.delayMs);
}

// 토큰이 10개를 넘겼을 때 AI가 스스로 버릴 토큰을 고른다.
// 목표 카드에 필요 없는 색부터, 많이 가진 색부터 버린다.
function aiChooseDiscards(player, needed) {
  const target = aiPickTarget(player);
  const wanted = target ? aiWantedColors(player, target.cost) : [];
  const picks = [];
  const held = {};
  GEMS.concat(['gold']).forEach((c) => (held[c] = player.tokens[c]));

  while (picks.length < needed) {
    const candidates = GEMS.concat(['gold']).filter((c) => held[c] > 0);
    if (!candidates.length) break;
    candidates.sort((a, b) => {
      // 골드는 마지막까지 아낀다.
      if (a === 'gold') return 1;
      if (b === 'gold') return -1;
      const aWanted = wanted.includes(a) ? 1 : 0;
      const bWanted = wanted.includes(b) ? 1 : 0;
      if (aWanted !== bWanted) return aWanted - bWanted;
      return held[b] - held[a];
    });
    const drop = candidates[0];
    held[drop]--;
    picks.push(drop);
  }
  return picks;
}
