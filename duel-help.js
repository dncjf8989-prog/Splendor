'use strict';

// ============ 스플렌더 듀얼 규칙 도우미 ============
// 켜 두면 판 옆에 도우미 창이 떠서, 지금 어떤 규칙이 걸려 있는지와 왜 못 하는지를 알려 준다.
// 켜고 끄는 것은 저장된다 (처음 오면 켜진 채로 시작한다).
//
// - 화면에 보이는 정보(dView())만 쓴다. 덱 내용이나 상대가 몰래 예약한 카드는 이 화면에
//   애초에 없으므로 도우미가 새게 할 수가 없다. 온라인에서도 같다.
// - 규칙 숫자는 전부 duel-engine.js 의 DUEL 상수에서 읽는다. 문구를 따로 외워 두지 않는다.
// - 수를 추천하지 않는다. "이 규칙이 이렇다", "이래서 못 한다"까지만 알려 준다.

const DHELP = {
  KEY: 'splendorDuelHelp', // 'on' | 'off'
  MIN_KEY: 'splendorDuelHelpMin', // '1' 접음 | '0' 폄
  DONE_KEY: 'splendorDuelHelpDone', // 해 본 것들 (JSON 배열)
  WIDE: 1480, // 이보다 넓으면 판 오른쪽에 붙이고, 좁으면 아래에 띄운다
  mem: {}, // 저장소가 막힌 환경을 위한 임시 보관
  picked: null, // 설명을 보려고 누른 카드
  seenGame: null,
  seenNo: 0,
  done: null,
  refBuilt: false,
};

function dhGet(k) {
  if (k in DHELP.mem) return DHELP.mem[k];
  try {
    return localStorage.getItem(k);
  } catch (e) {
    return null;
  }
}
function dhSet(k, val) {
  DHELP.mem[k] = val;
  try {
    localStorage.setItem(k, val);
  } catch (e) {
    /* 저장이 막힌 환경: 이번 접속 동안만 유지된다 */
  }
}

function dHelpOn() {
  return dhGet(DHELP.KEY) !== 'off';
}
function dHelpMin() {
  const s = dhGet(DHELP.MIN_KEY);
  if (s === '1') return true;
  if (s === '0') return false;
  return window.innerWidth < DHELP.WIDE; // 좁은 화면에서는 한 줄짜리로 시작한다
}

// ---- 연습 과제: 해 본 것에 체크한다 ----
const D_HELP_TASKS = [
  { id: 'take', label: '토큰 가져오기', how: '토큰판에서 이어진 1~3칸(가로·세로·대각선)을 눌러 고르고 "확정"을 누르세요.' },
  { id: 'priv', label: '특권 쓰기', how: '특권 두루마리가 있을 때 "특권 사용"을 누르고, 판에서 금이 아닌 토큰 1개를 고르세요. 필수 행동 전에만 쓸 수 있습니다.' },
  { id: 'replenish', label: '판 채우기', how: '"판 채우기"를 누르면 주머니의 토큰이 빈 칸을 채웁니다. 대신 상대가 특권을 받습니다.' },
  { id: 'reserve', label: '카드 예약', how: '카드의 "예약", 또는 티어 옆 "덱에서 예약"을 누르세요. 판의 금 1개를 받습니다.' },
  { id: 'buy', label: '카드 구매', how: '테두리가 강조된 카드의 "구매"를 누르세요. 산 카드는 이후 같은 색 비용을 영구히 깎아 줍니다.' },
  { id: 'power', label: '능력 카드 사기', how: '카드 위쪽에 능력(한 번 더, 보석 1개, 특권, 훔치기)이 적힌 카드를 사 보세요.' },
  { id: 'royal', label: '왕실 카드 받기', how: `산 카드의 왕관(♛)이 합쳐서 ${DUEL.ROYAL_AT.join('개, ')}개가 되면 왕실 카드를 한 장씩 고릅니다.` },
];

function dhDone() {
  if (DHELP.done) return DHELP.done;
  let list = [];
  try {
    const a = JSON.parse(dhGet(DHELP.DONE_KEY) || '[]');
    if (Array.isArray(a)) list = a.filter((x) => D_HELP_TASKS.some((t) => t.id === x));
  } catch (e) {
    /* 깨진 값은 처음부터 */
  }
  DHELP.done = new Set(list);
  return DHELP.done;
}
function dhMark(id) {
  const d = dhDone();
  if (d.has(id)) return;
  d.add(id);
  dhSet(DHELP.DONE_KEY, JSON.stringify(Array.from(d)));
}

// 내가 한 행동을 알아챈다. 혼자 하든 온라인이든 상태의 last(마지막 행동 기록)로 본다.
function dHelpObserve(v) {
  if (!v) return;
  if (DHELP.seenGame !== v.gameId) {
    // 새 판이거나 처음 보는 판이다. 이미 있던 기록은 센 걸로 치지 않고 기준만 잡는다.
    DHELP.seenGame = v.gameId;
    DHELP.seenNo = v.last ? v.last.no : 0;
    DHELP.picked = null;
    return;
  }
  const l = v.last;
  if (!l || l.no === DHELP.seenNo) return;
  DHELP.seenNo = l.no;
  if (l.seat !== DAPP.seat) return;
  if (l.kind === 'take') dhMark('take');
  else if (l.kind === 'priv') dhMark('priv');
  else if (l.kind === 'replenish') dhMark('replenish');
  else if (l.kind === 'reserve') dhMark('reserve');
  else if (l.kind === 'royal') dhMark('royal');
  else if (l.kind === 'buy') {
    dhMark('buy');
    const c = duelCard(l.id);
    if (c && c.power) dhMark('power');
  }
}

// ---- 문구 조각 ----
function dhLabels(types) {
  return types.map((t) => DUEL_COLOR_LABEL[t]).join(', ');
}
function dhChip(t) {
  return dTok(t, null);
}
function dhP(html) {
  return `<p>${html}</p>`;
}
function dhList(items) {
  return items.length ? `<ul>${items.map((x) => `<li>${x}</li>`).join('')}</ul>` : '';
}
function dhSection(title, body) {
  return body ? `<div class="d-help-sec"><h4>${title}</h4>${body}</div>` : '';
}

// 지금 이 카드를 살 때 무엇이 얼마나 모자란가
function dhShortage(v, seat, id) {
  const card = duelCard(id);
  const cost = duelCardCost(v, id); // 이번 판의 실제 비용 (색이 섞여 있다)
  const p = v.players[seat];
  const bonus = duelBonus(v, seat);
  const rows = [];
  let missing = 0;
  DUEL.COLORS.forEach((c) => {
    const base = cost[c] || 0;
    if (!base) return;
    const disc = Math.min(base, bonus[c]);
    const need = base - disc;
    const have = Math.min(need, p.tokens[c]);
    rows.push({ t: c, base, disc, need, have, miss: need - have });
    missing += need - have;
  });
  if (cost.pearl) {
    const need = cost.pearl;
    const have = Math.min(need, p.tokens.pearl);
    rows.push({ t: 'pearl', base: need, disc: 0, need, have, miss: need - have });
    missing += need - have;
  }
  const wildBlocked = card.bonus === 'wild' && !DUEL.COLORS.some((c) => bonus[c] > 0);
  return { rows, missing, gold: p.tokens.gold, wildBlocked };
}

// ---- 카드 하나를 풀어서 설명 ----
function dhCardHtml(v, id) {
  const c = duelCard(id);
  if (!c) return '';
  const seat = DAPP.seat;
  const where = [];
  [1, 2, 3].forEach((lv) => {
    if (v.pyramid[lv].includes(id)) where.push('판 위');
  });
  if (v.players[seat].reserved.some((r) => r.id === id)) {
    where.push('내 예약');
  }
  if (v.players[seat].cards.includes(id)) {
    where.push('내가 산 카드');
  }
  if (v.players[1 - seat].cards.includes(id)) where.push('상대가 산 카드');
  if (v.players[1 - seat].reserved.some((r) => r.id === id)) where.push('상대의 예약');

  const head = `티어${c.lv} · ${c.bonus === 'wild' ? '색상 선택' : c.bonus === 'none' ? '황금 카드' : DUEL_COLOR_LABEL[c.bonus] + ' 보너스'} · ${c.pts}점${c.crowns ? ` · 왕관 ${c.crowns}개` : ''}`;
  const lines = [];
  lines.push(`<b>${head}</b>${where.length ? ` <span class="d-label">(${where.join(', ')})</span>` : ''}`);

  const sh = dhShortage(v, seat, id);
  const costRows = sh.rows.map((r) => {
    if (r.t === 'pearl') return `${dhChip('pearl')} 진주 ${r.base}개 (진주 비용은 보너스로 깎이지 않습니다) — 가진 진주 ${v.players[seat].tokens.pearl}개`;
    return `${dhChip(r.t)} ${DUEL_COLOR_LABEL[r.t]} ${r.base}개${r.disc ? ` − 보너스 ${r.disc}` : ''} = <b>${r.need}개</b> — 가진 토큰 ${v.players[seat].tokens[r.t]}개`;
  });
  lines.push(dhList(costRows) || '비용이 없는 카드입니다.');

  const onTable = where.includes('판 위') || where.includes('내 예약');
  if (onTable) {
    const q = duelPayment(v, seat, id);
    if (q) {
      const pays = DUEL.TOKEN_TYPES.filter((t) => q.pay[t] > 0).map((t) => `${DUEL_COLOR_LABEL[t]} ${q.pay[t]}`);
      lines.push(dhP(`<span class="d-help-ok">지금 살 수 있습니다.</span> 내는 토큰: ${pays.length ? pays.join(', ') : '없음 (보너스만으로 충분)'}${q.pay.gold ? ` — 금 ${q.pay.gold}개가 모자란 만큼을 대신합니다` : ''}.`));
    } else if (sh.wildBlocked) {
      lines.push(dhP('<span class="d-help-no">지금은 못 삽니다.</span> 색상 선택 카드는 이미 가진 카드의 색 중에서 고르므로, 색 카드가 한 장도 없으면 살 수 없습니다.'));
    } else {
      lines.push(dhP(`<span class="d-help-no">지금은 못 삽니다.</span> 토큰이 <b>${sh.missing - sh.gold}개</b> 모자랍니다. 모자란 ${sh.missing}개는 금으로 대신 낼 수 있는데 금이 ${sh.gold}개뿐입니다.`));
    }
  }
  if (c.power) lines.push(dhP(`<b>능력 · ${D_POWER[c.power][0]}</b>: ${D_POWER[c.power][1]}`));
  if (c.bonus === 'none') lines.push(dhP('<b>황금 카드</b>: 보너스 색이 없어서 다음 카드의 비용을 깎아 주지 못합니다. 점수만 줍니다. 어느 색의 "한 색 점수"에도 들어가지 않습니다.'));
  lines.push(dhP(`<span class="d-label">이 판의 비용은 티어${c.lv}의 색 섞기가 반영된 값입니다. 카드 목록의 기본 비용과 색이 다를 수 있습니다.</span>`));
  if (c.bonus === 'wild') lines.push(dhP('<b>색상 선택</b>: 산 직후, 이미 가진 카드의 색 중 하나를 골라 그 색 보너스로 씁니다. 한 번 정하면 바뀌지 않고, 그 색의 "한 색 점수"에도 들어갑니다.'));
  if (c.crowns) lines.push(dhP(`<b>왕관 ${c.crowns}개</b>: 산 카드의 왕관이 합쳐서 ${DUEL.ROYAL_AT.join('개, ')}개가 되면 왕실 카드를 받고, ${DUEL.WIN_CROWNS}개가 되면 즉시 승리합니다.`));
  return lines.join('');
}

// ---- 방금 일어난 일을 규칙으로 설명 ----
function dhLast(v) {
  const l = v.last;
  if (!l || l.kind === 'win') return '';
  const mine = l.seat === DAPP.seat;
  const who = mine ? '내가' : '상대가';
  const gets = mine ? '상대가' : '내가';
  switch (l.kind) {
    case 'take': {
      const types = l.tokens || [];
      if (duelTakeIsGreedy(types)) {
        return `${who} ${dhLabels(types)}을(를) 가져갔습니다. 같은 색 3개나 진주 2개를 한꺼번에 가져가면 <b>${gets} 특권 두루마리를 받습니다</b>. (더미에 두루마리가 없으면 ${mine ? '내' : '상대'} 것을 가져갑니다)`;
      }
      return `${who} 토큰 ${types.length}개(${dhLabels(types)})를 가져갔습니다.`;
    }
    case 'priv':
      return `${who} 특권 두루마리 1장을 써서 ${DUEL_COLOR_LABEL[l.token] || '토큰'} 1개를 가져갔습니다. 쓴 두루마리는 판 옆 더미로 돌아갑니다.`;
    case 'replenish':
      return `${who} 토큰판을 채웠습니다. 판을 채우면 <b>${gets} 특권 두루마리를 받습니다</b>.`;
    case 'reserve':
      return l.secret
        ? `${who} 티어${l.lv} 덱의 맨 위 카드를 <b>몰래</b> 예약했습니다. 금 1개를 받았고, 어떤 카드인지는 예약한 사람만 압니다.`
        : `${who} 티어${l.lv} 카드를 예약하고 금 1개를 받았습니다.`;
    case 'buy': {
      const c = duelCard(l.id);
      if (!c) return `${who} 카드를 샀습니다.`;
      const bits = [`티어${c.lv} 카드를 샀습니다 (+${c.pts}점${c.crowns ? `, 왕관 ${c.crowns}` : ''})`];
      if (c.power) bits.push(`능력 "${D_POWER[c.power][0]}": ${D_POWER[c.power][1].replace(/\.$/, '')}`);
      return `${who} ${bits.join(' · ')}.`;
    }
    case 'royal':
      return `${who} 왕관이 ${DUEL.ROYAL_AT.join('개, ')}개에 처음 닿아 왕실 카드를 한 장 받았습니다.`;
    case 'pass':
      return `${who} 둘 수 있는 수가 하나도 없어 차례를 넘겼습니다.`;
    default:
      return '';
  }
}

// ---- 지금 상황별 안내 ----
function dhIdle() {
  return {
    tone: 'idle',
    summary: '판이 시작되면 지금 할 일을 알려 드립니다',
    html:
      dhP('<b>스플렌더 듀얼</b>은 둘이서 하는 스플렌더입니다. 판이 시작되면 <b>지금 할 수 있는 것과 못 하는 이유</b>를 여기서 알려 드립니다.') +
      dhP('카드를 누르면 값과 능력을 풀어서 보여 줍니다. 이 창은 위쪽 <b>도우미 끔</b>으로 언제든 끌 수 있습니다.'),
  };
}

function dhOver(v) {
  const o = v.over;
  const winnerMe = o.winner === DAPP.seat;
  const w = v.players[o.winner];
  const why =
    o.kind === 'points'
      ? `명성 점수 <b>${duelPoints(v, o.winner)}점</b>으로 ${DUEL.WIN_POINTS}점을 넘겼습니다.`
      : o.kind === 'crowns'
        ? `왕관 <b>${duelCrowns(v, o.winner)}개</b>로 ${DUEL.WIN_CROWNS}개를 채웠습니다.`
        : `<b>${DUEL_COLOR_LABEL[o.color]}</b> 카드로만 <b>${duelColorPoints(v, o.winner)[o.color]}점</b>을 모아 ${DUEL.WIN_COLOR}점을 넘겼습니다.`;
  return {
    tone: 'over',
    summary: `게임 종료 — ${winnerMe ? '내가' : '상대가'} 이겼습니다`,
    html:
      dhP(`<b>${winnerMe ? '내가 이겼습니다' : dEsc(w.name || '상대') + '이(가) 이겼습니다'}.</b> ${why}`) +
      dhP(`듀얼은 점수가 높은 쪽이 아니라 <b>세 가지 조건 중 하나를 먼저 채우는 쪽</b>이 이깁니다. 조건을 채우는 순간 바로 끝납니다. (점수 ${DUEL.WIN_POINTS}점 · 왕관 ${DUEL.WIN_CROWNS}개 · 한 색 ${DUEL.WIN_COLOR}점)`),
  };
}

// "방금 일어난 일" 절. 설명할 것이 없으면 아예 만들지 않는다.
function dhLastSec(v) {
  const t = dhLast(v);
  return t ? dhSection('방금 일어난 일', dhP(t)) : '';
}

function dhOppChoice(v) {
  const opp = v.players[1 - DAPP.seat];
  const t = v.choice.type;
  const what = { wild: '색상 선택 카드의 색을 고르는', royal: '왕실 카드를 고르는', steal: '훔칠 토큰을 고르는', pick: '판에서 토큰을 고르는', discard: '넘치는 토큰을 버리는' }[t] || '선택하는';
  return {
    tone: 'wait',
    summary: `${opp.name || '상대'}이(가) 선택하는 중`,
    html: dhP(`${dEsc(opp.name || '상대')}이(가) ${what} 중입니다. 선택이 끝나야 차례가 넘어옵니다.`) + dhLastSec(v),
  };
}

function dhMyChoice(v) {
  const ch = v.choice;
  const me = v.players[DAPP.seat];
  switch (ch.type) {
    case 'wild':
      return {
        tone: 'choice',
        summary: '색상 선택 카드의 색을 고르세요',
        html:
          dhP('방금 산 <b>색상 선택 카드</b>가 어떤 색 보너스가 될지 고릅니다. 이미 가진 카드가 있는 색(' + dhLabels(ch.options) + ') 중에서만 고를 수 있습니다.') +
          dhP('한 번 정하면 바뀌지 않습니다. 그 색의 보너스(비용 할인)와 "한 색 점수" 양쪽에 들어갑니다.'),
      };
    case 'royal':
      return {
        tone: 'choice',
        summary: '왕실 카드를 한 장 고르세요',
        html:
          dhP(`왕관이 ${DUEL.ROYAL_AT.join('개, ')}개에 처음 닿으면 남은 왕실 카드 중 한 장을 가져옵니다. 점수가 더해지고, 카드에 능력이 있으면 바로 씁니다.`) +
          dhP('고를 수 있는 카드: ' + ch.options.map((id) => dRoyalHtml(id)).join(' ')) +
          dhP('왕실 카드의 점수는 명성 점수에는 들어가지만, "한 색 점수"에는 들어가지 않습니다.'),
      };
    case 'steal':
      return {
        tone: 'choice',
        summary: '상대에게서 훔칠 토큰을 고르세요',
        html: dhP(`카드 능력 <b>훔치기</b>입니다. 상대가 가진 보석이나 진주 중 1개를 가져옵니다. (금은 훔칠 수 없습니다) 상대가 가진 종류만 고를 수 있습니다: ${dhLabels(ch.options)}.`),
      };
    case 'pick':
      return {
        tone: 'choice',
        summary: '판에서 가져갈 칸을 고르세요',
        html: dhP(`카드 능력 <b>보석 1개</b>입니다. 판에서 이 카드와 같은 색(${DUEL_COLOR_LABEL[ch.color]}) 토큰 1개를 가져옵니다. 점선으로 표시된 칸 중에서 고르세요. 일직선일 필요는 없습니다.`),
      };
    case 'discard':
      return {
        tone: 'choice',
        summary: `토큰 ${ch.n}개를 버리세요`,
        html:
          dhP(`토큰은 <b>턴이 끝났을 때 ${DUEL.TOKEN_MAX}개까지</b>만 들 수 있습니다. 지금 ${duelTokenTotal(me)}개라서 <b>${ch.n}개</b>를 버려야 합니다.`) +
          dhP('버린 토큰은 주머니로 돌아갑니다. 금과 진주도 버릴 수 있습니다.'),
      };
    default:
      return { tone: 'choice', summary: '선택하세요', html: dhP('화면의 안내에 따라 선택하세요.') };
  }
}

function dhOppTurn(v) {
  const opp = v.players[1 - DAPP.seat];
  return {
    tone: 'wait',
    summary: `${opp.name || '상대'}의 차례를 기다리는 중`,
    html:
      dhP(`${dEsc(opp.name || '상대')}의 차례입니다. 기다리는 동안 내 토큰·카드를 확인하거나, 카드를 눌러 값을 살펴보세요.`) +
      dhLastSec(v),
  };
}

function dhFree(v) {
  const seat = DAPP.seat;
  const me = v.players[seat];
  const total = duelTokenTotal(me);
  const sel = DAPP.sel || [];

  // 지금 살 수 있는 카드
  let buyable = 0;
  [1, 2, 3].forEach((lv) => v.pyramid[lv].forEach((id) => id !== null && duelPayment(v, seat, id) && buyable++));
  me.reserved.forEach((r) => r.id !== null && duelPayment(v, seat, r.id) && buyable++);

  const canRep = v.bagN > 0 && v.board.includes(null);
  const canRes = duelCanReserve(v, seat);
  const stuck = duelStuck(v, seat);

  // ---- 지금 하고 있는 것 ----
  let doing = '';
  if (DAPP.priv) {
    doing = dhP('<b>특권 사용 중</b>: 판에서 <b>금이 아닌</b> 토큰 1개를 고르세요. 두루마리 1장이 판 옆 더미로 돌아가고, 이 행동은 필수 행동으로 치지 않습니다.');
  } else if (sel.length) {
    const types = sel.map((p) => v.board[p]);
    const greedy = duelTakeIsGreedy(types);
    const over = total + sel.length - DUEL.TOKEN_MAX;
    const bits = [`고른 토큰 ${sel.length}개: ${dhLabels(types)} — 이어진 일직선이라 가져올 수 있습니다.`];
    if (greedy) bits.push('<span class="d-help-no">같은 색 3개(또는 진주 2개 이상)라서 상대가 특권 두루마리를 받습니다.</span>');
    if (over > 0) bits.push(`<span class="d-help-no">가져오면 토큰이 ${total + sel.length}개가 되어, 턴이 끝날 때 ${over}개를 버려야 합니다.</span>`);
    doing = dhP(bits.join('<br>'));
  }

  // ---- 지금 못 하는 것과 이유 ----
  const no = [];
  if (!buyable) no.push('<b>구매</b>: 지금 살 수 있는 카드가 없습니다. 카드를 눌러 무엇이 모자란지 확인해 보세요.');
  if (!canRes) {
    if (me.reserved.length >= DUEL.RESERVE_MAX) no.push(`<b>예약</b>: 이미 ${DUEL.RESERVE_MAX}장을 예약했습니다. 예약은 ${DUEL.RESERVE_MAX}장까지입니다.`);
    else if (!v.board.includes('gold')) no.push('<b>예약</b>: 판에 금이 없습니다. 예약하면 판의 금 1개를 받는데, 금이 모두 나가 버렸습니다. (판 채우기 뒤에 금이 다시 놓일 수 있습니다)');
    else no.push('<b>예약</b>: 예약할 카드가 없습니다.');
  }
  if (!me.scrolls) no.push('<b>특권 사용</b>: 특권 두루마리가 없습니다. 상대가 판을 채우거나 욕심을 부리면, 또는 카드 능력으로 받습니다.');
  if (!canRep) no.push(`<b>판 채우기</b>: ${v.bagN <= 0 ? '주머니에 토큰이 없습니다.' : '판에 빈 칸이 없습니다.'}`);

  const steps = dhList([
    `<b>먼저(고르기)</b>: 특권 사용${me.scrolls ? ` (두루마리 ${me.scrolls}장)` : ''}, 판 채우기 — 필수 행동 전에 몇 번이든 할 수 있습니다.`,
    '<b>필수 행동 딱 하나</b>: ① 토큰 가져오기 ② 카드 예약 ③ 카드 구매',
    `<b>그다음은 자동</b>: 토큰 ${DUEL.TOKEN_MAX}개 초과분 버리기 → 카드 능력 → 왕실 카드 → 승리 확인 → 상대 차례`,
  ]);

  const status = dhList([
    `지금 살 수 있는 카드 <b>${buyable}장</b>${buyable ? ' (테두리가 강조됩니다)' : ''}`,
    `토큰 <b>${total}/${DUEL.TOKEN_MAX}</b> · 예약 <b>${me.reserved.length}/${DUEL.RESERVE_MAX}</b> · 특권 <b>${me.scrolls}</b>장`,
  ]);

  const stuckNote = stuck && !sel.length ? dhP('<b>둘 수 있는 수가 없습니다.</b> 가져올 토큰 줄도, 예약도, 구매도, 판 채우기도 할 수 없을 때만 "넘기기"를 쓸 수 있습니다.') : '';

  return {
    tone: 'go',
    summary: DAPP.priv ? '특권: 금이 아닌 토큰 1개를 고르세요' : sel.length ? `${sel.length}개 선택 — "확정"을 누르세요` : '내 차례 — 필수 행동 1개: 가져오기 · 예약 · 구매',
    html: dhSection('내 차례', steps + doing + stuckNote) + dhSection('지금 상태', status) + (no.length ? dhSection('지금 못 하는 것', dhList(no)) : '') + dhLastSec(v),
  };
}

function dHelpModel(v) {
  if (!v) return dhIdle();
  if (v.over) return dhOver(v);
  if (v.choice) return v.choice.seat === DAPP.seat ? dhMyChoice(v) : dhOppChoice(v);
  if (v.turn !== DAPP.seat) return dhOppTurn(v);
  if (v.mainDone) {
    return {
      tone: 'wait',
      summary: '마무리하는 중입니다',
      html: dhP(`필수 행동을 마쳤습니다. 토큰 ${DUEL.TOKEN_MAX}개 초과분 → 카드 능력 → 왕실 카드 → 승리 확인이 자동으로 처리된 뒤 상대 차례가 됩니다.`),
    };
  }
  return dhFree(v);
}

// ---- 연습 과제 ----
function dhTasksHtml() {
  const d = dhDone();
  const left = D_HELP_TASKS.filter((t) => !d.has(t.id));
  const items = D_HELP_TASKS.map((t) => `<li class="${d.has(t.id) ? 'done' : ''}"><span class="d-help-chk">${d.has(t.id) ? '✔' : '○'}</span> ${t.label}</li>`).join('');
  const next = left.length ? `<p class="d-help-next"><b>다음 연습: ${left[0].label}</b><br>${left[0].how}</p>` : '<p class="d-help-next"><b>연습 과제를 모두 해 보았습니다.</b> 이제 규칙은 충분합니다.</p>';
  return dhSection(`연습 과제 ${D_HELP_TASKS.length - left.length}/${D_HELP_TASKS.length}`, `<ul class="d-help-tasks">${items}</ul>${next}<button type="button" class="d-help-link" data-help="reset">과제 처음부터</button>`);
}

// ---- 규칙 한눈에 (처음 한 번만 만들고, 펼침 상태는 그대로 둔다) ----
function dhRefHtml() {
  const R = DUEL.ROYAL_AT.join('개, ') + '개';
  const sec = (title, body, open) => `<details${open ? ' open' : ''}><summary>${title}</summary>${body}</details>`;
  return (
    '<div class="d-help-sec"><h4>규칙 한눈에</h4>' +
    sec('이기는 법', dhList([`명성 점수 <b>${DUEL.WIN_POINTS}점</b> 이상`, `왕관 <b>${DUEL.WIN_CROWNS}개</b> 이상`, `같은 색 카드로만 <b>${DUEL.WIN_COLOR}점</b> 이상`]) + dhP('셋 중 <b>하나라도</b> 먼저 채우면 그 순간 이깁니다. (왕실 카드 점수는 "한 색 점수"에 들어가지 않습니다)'), true) +
    sec('한 턴의 순서', dhList(['(고르기) 특권 사용, 판 채우기', '(필수) 토큰 가져오기 / 카드 예약 / 카드 구매 중 <b>하나</b>', `(자동) 토큰 ${DUEL.TOKEN_MAX}개 초과분 버리기, 카드 능력, 왕실 카드, 승리 확인`])) +
    sec('토큰 가져오기', dhList(['판에서 <b>이어진 일직선</b>(가로·세로·대각선)의 1~3칸을 가져옵니다. 중간에 빈 칸이 끼면 안 됩니다.', '<b>금</b>은 집을 수 없습니다. (예약할 때만 받습니다)', '<b>같은 색 3개</b>나 <b>진주 2개 이상</b>을 한꺼번에 가져오면 상대가 특권 두루마리를 받습니다.', '진주는 카드 비용에 진주가 들어 있을 때만 쓰입니다.'])) +
    sec('특권 두루마리', dhList([`두루마리는 모두 ${DUEL.SCROLLS}장입니다. 한 장 내고 판에서 <b>금이 아닌 토큰 1개</b>를 집습니다.`, '필수 행동 <b>전에만</b> 쓸 수 있고, 필수 행동으로 치지 않습니다.', '받는 때: 상대가 판을 채웠을 때, 상대가 욕심을 부렸을 때, 카드나 왕실 카드의 능력. 판 옆 더미에 없으면 상대가 가진 것을 가져옵니다.', `뒤에 두는 사람은 ${DUEL.SECOND_PLAYER_SCROLLS}장을 갖고 시작합니다.`])) +
    sec('판 채우기', dhList(['주머니의 토큰을 판의 빈 칸에 놓습니다. 필수 행동 전에 할 수 있습니다.', '<b>채우면 상대가 특권 두루마리를 받습니다.</b>', '카드 값으로 낸 토큰과 버린 토큰은 주머니로 돌아갑니다.'])) +
    sec('카드 예약', dhList([`판에 <b>금이 있을 때만</b> 합니다. 금 1개를 받습니다. 예약은 ${DUEL.RESERVE_MAX}장까지.`, '판 위의 카드 한 장(모두에게 보임) 또는 <b>덱 맨 위 카드</b>(예약한 사람만 봄)를 가져옵니다.', '예약한 카드는 나중에 내 차례에 살 수 있습니다.'])) +
    sec('카드 구매', dhList(['<b>비용의 색은 판마다, 티어마다 무작위로 섞입니다.</b> 카드에 보이는 비용이 이번 판의 실제 비용이고, 보너스 색·점수·능력과 진주 비용은 그대로입니다.', '비용에서 <b>같은 색 카드의 수만큼</b> 깎입니다. (카드 한 장 = 그 색 1개 할인, 영구)', '모자란 만큼은 <b>금</b>으로 대신 냅니다. 금 1개가 무엇이든 1개를 대신합니다.', '<b>진주 비용은 할인이 없고</b> 진주(또는 금)로만 냅니다.', '낸 토큰은 주머니로 돌아가고, 산 카드는 내 앞에 놓입니다.'])) +
    sec('카드 능력', dhList(Object.keys(D_POWER).map((k) => `<b>${D_POWER[k][0]}</b>: ${D_POWER[k][1]}`).concat(['<b>색상 선택</b>: 산 뒤 이미 가진 카드의 색 중 하나를 골라 그 색으로 씁니다.']))) +
    sec('왕관과 왕실 카드', dhList([`산 카드의 왕관(♛)이 처음 <b>${R}</b>가 될 때마다 왕실 카드를 한 장 고릅니다.`, '왕실 카드는 점수가 있고, 능력이 있는 것도 있습니다.', `왕관이 ${DUEL.WIN_CROWNS}개가 되면 즉시 승리합니다.`])) +
    sec('토큰 한도', dhList([`턴이 끝났을 때 토큰은 <b>${DUEL.TOKEN_MAX}개까지</b>입니다. 넘으면 넘는 만큼 버립니다.`])) +
    sec('둘 수 있는 수가 없을 때', dhList(['가져올 줄도, 예약도, 구매도, 판 채우기도 못 할 때만 차례를 넘길 수 있습니다.'])) +
    '<p class="d-help-fine">※ 규칙서 원문을 열어 보지 못해 일부 수치(색마다 토큰 수, 예약 장수, 토큰 한도, 후공의 시작 특권)는 기억에 의존했습니다. 실제와 다르면 알려 주세요.</p>' +
    '<button type="button" class="d-help-link" data-help="rules">자세한 규칙 창 열기</button></div>'
  );
}

// ---- 그리기 ----
function dHelpRender(v) {
  const el = document.getElementById('dHelper');
  const btn = document.getElementById('dHelpBtn');
  const on = dHelpOn();
  if (btn) {
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.textContent = on ? '도우미 켬' : '도우미 끔';
  }
  document.body.classList.toggle('d-help-on', on);
  if (!el) return;
  el.hidden = !on;
  if (!on) {
    document.querySelectorAll('.d-help-pick').forEach((x) => x.classList.remove('d-help-pick'));
    return;
  }
  const min = dHelpMin();
  document.body.classList.toggle('d-help-min', min);
  el.classList.toggle('d-help-min', min);
  const minBtn = el.querySelector('[data-help="min"]');
  if (minBtn) {
    minBtn.textContent = min ? '펼치기' : '접기';
    minBtn.setAttribute('aria-expanded', min ? 'false' : 'true');
  }

  dHelpObserve(v);
  const m = dHelpModel(v);
  el.dataset.tone = m.tone;
  const brief = document.getElementById('dHelpBrief');
  if (brief) brief.textContent = m.summary;

  if (min) return; // 접혀 있으면 한 줄만 갱신한다

  // 눌러 둔 카드가 더 이상 화면에 없으면 풀어 준다
  if (DHELP.picked !== null && !document.querySelector(`#dGame .d-card[data-card="${DHELP.picked}"]`)) DHELP.picked = null;

  const now = document.getElementById('dHelpNow');
  if (now) {
    const picked = v && DHELP.picked !== null ? dhSection('선택한 카드 <button type="button" class="d-help-link" data-help="unpick">닫기</button>', dhCardHtml(v, DHELP.picked)) : '';
    const hint = v && DHELP.picked === null ? dhP('<span class="d-label">카드를 누르면 값과 능력을 풀어서 보여 줍니다.</span>') : '';
    now.innerHTML = `<div class="d-help-now d-help-${m.tone}">${m.html}</div>${picked}${hint}${dhTasksHtml()}`;
  }
  const ref = document.getElementById('dHelpRef');
  if (ref && !DHELP.refBuilt) {
    ref.innerHTML = dhRefHtml();
    DHELP.refBuilt = true;
  }
  document.querySelectorAll('.d-help-pick').forEach((x) => x.classList.remove('d-help-pick'));
  if (DHELP.picked !== null) {
    document.querySelectorAll(`#dGame .d-card[data-card="${DHELP.picked}"]`).forEach((x) => x.classList.add('d-help-pick'));
  }
}

function dHelpRefresh() {
  dHelpRender(typeof dView === 'function' ? dView() : null);
}

function dHelpSetOn(on) {
  dhSet(DHELP.KEY, on ? 'on' : 'off');
  dHelpRefresh();
}

// ---- 이벤트 ----
document.addEventListener('click', (e) => {
  const h = e.target.closest('[data-help]');
  if (h) {
    const a = h.dataset.help;
    if (a === 'off') dHelpSetOn(false);
    else if (a === 'min') {
      dhSet(DHELP.MIN_KEY, dHelpMin() ? '0' : '1');
      dHelpRefresh();
    } else if (a === 'rules') {
      DAPP.modal = { type: 'rules' };
      dRender();
    } else if (a === 'unpick') {
      DHELP.picked = null;
      dHelpRefresh();
    } else if (a === 'reset') {
      DHELP.done = new Set();
      dhSet(DHELP.DONE_KEY, '[]');
      dHelpRefresh();
    }
    return;
  }
  // 카드를 누르면 설명을 보여 준다 (구매·예약 버튼을 누른 것은 제외)
  if (dHelpOn() && !e.target.closest('button') && !e.target.closest('#dHelper')) {
    const card = e.target.closest('#dGame .d-card[data-card]');
    if (card) {
      const id = Number(card.dataset.card);
      DHELP.picked = DHELP.picked === id ? null : id;
      // 접힌 상태에서 카드를 눌렀다면 펼쳐서 보여 준다
      if (DHELP.picked !== null && dHelpMin()) dhSet(DHELP.MIN_KEY, '0');
      dHelpRefresh();
    }
  }
});

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('dHelpBtn');
  if (btn) btn.addEventListener('click', () => dHelpSetOn(!dHelpOn()));
  window.addEventListener('resize', () => dHelpRefresh());
  dHelpRefresh();
});
