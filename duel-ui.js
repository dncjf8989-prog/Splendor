'use strict';

// ============ 스플렌더 듀얼 화면 ============
// 규칙은 duel-engine.js 가 전부 맡는다. 여기서는 상태를 그리고, 클릭을 행동으로 바꿔
// 보낼 뿐이다. 혼자 할 때는 이 기기가 규칙을 돌리고, 온라인에서는 방장이 돌린다
// (duel-net.js 가 DAPP.sendAction 을 채워 그 길로 행동을 보낸다).

const DAPP = {
  mode: 'idle', // idle | single | online
  seat: 0, // 내 자리
  S: null, // 화면에 그릴 상태. 혼자/방장이면 전체 상태, 게스트면 요약 상태
  full: true, // S가 전체 상태인가
  sel: [], // 집으려고 고른 칸
  priv: false, // 특권으로 토큰을 집는 중
  discard: [], // 버릴 토큰으로 고른 것 (번호)
  modal: null, // { type: 'rules' | 'confirm', ... }
  closedResult: null, // 닫아 둔 결과 창의 gameId
  flash: '',
  flashTimer: null,
  aiTimer: null,
  aiDelay: 800, // AI가 한 수 두는 간격 (ms)
  sendAction: null, // 온라인: 행동을 방장에게 (방장이면 직접 처리)
  hooks: {}, // 온라인 모듈이 채우는 것: setMode, newGame, render
};

const D_POWER = {
  replay: ['한 번 더', '이 카드를 산 뒤 한 번 더 둡니다.'],
  token: ['보석 1개', '판에서 이 카드와 같은 색 보석 1개를 가져옵니다.'],
  scroll: ['특권', '특권 두루마리를 한 장 받습니다.'],
  steal: ['훔치기', '상대의 보석이나 진주 1개를 가져옵니다.'],
};

function dEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- 내 프로필 (오리지널과 같은 기기 ID와 닉네임을 쓴다) ----
const D_PROFILE_KEY = 'splendorLiteProfile';
function dProfile() {
  try {
    const p = JSON.parse(localStorage.getItem(D_PROFILE_KEY) || 'null');
    if (p && p.id) return p;
  } catch (e) {
    /* 저장이 막힌 환경 */
  }
  const fresh = { id: 'd-' + Math.random().toString(36).slice(2, 10), name: '' };
  try {
    localStorage.setItem(D_PROFILE_KEY, JSON.stringify(fresh));
  } catch (e) {
    /* noop */
  }
  return fresh;
}
function dMyName() {
  return dProfile().name || '플레이어';
}
function dSetName(name) {
  const p = dProfile();
  p.name = String(name || '').trim().slice(0, 12);
  try {
    localStorage.setItem(D_PROFILE_KEY, JSON.stringify(p));
  } catch (e) {
    /* noop */
  }
  return p.name;
}

// ---- 상태 보기 ----
function dView() {
  if (!DAPP.S) return null;
  return DAPP.full ? duelViewFor(DAPP.S, DAPP.seat) : DAPP.S;
}
function dMyTurn(v) {
  if (!v || v.over) return false;
  return v.choice ? v.choice.seat === DAPP.seat : v.turn === DAPP.seat;
}
function dFreeTurn(v) {
  // 내 차례이고 선택이 걸려 있지 않아 새 행동을 할 수 있는가
  return dMyTurn(v) && !v.choice;
}
function dFlash(msg) {
  DAPP.flash = msg;
  clearTimeout(DAPP.flashTimer);
  DAPP.flashTimer = setTimeout(() => {
    DAPP.flash = '';
    dRenderBanner();
  }, 3200);
  dRenderBanner();
}

// ---- 조각 만들기 ----
function dTok(type, n, cls) {
  return `<span class="gemdot d-sm gem-${type}${cls ? ' ' + cls : ''}" title="${DUEL_COLOR_LABEL[type] || type}">${n == null ? '' : n}</span>`;
}

function dCostHtml(cost) {
  const parts = [];
  DUEL.COLORS.forEach((c) => cost[c] && parts.push(`<span class="cost-icon gem-${c}" title="${DUEL_COLOR_LABEL[c]}">${cost[c]}</span>`));
  if (cost.pearl) parts.push(`<span class="cost-icon gem-pearl" title="진주">${cost.pearl}</span>`);
  return parts.join('');
}

// 오리지널과 같은 카드 모양(card-tile)을 쓴다. d-card, d-can 은 테스트와 도우미가 찾는 표식이다.
function dCardHtml(id, o) {
  const opt = o || {};
  const c = duelCard(id);
  const power = c.power ? `<div class="d-power" title="${dEsc(D_POWER[c.power][1])}">${D_POWER[c.power][0]}</div>` : '';
  const crowns = c.crowns ? `<span class="d-crowns" title="왕관 ${c.crowns}개">${'♛'.repeat(c.crowns)}</span>` : '';
  const wild = c.bonus === 'wild' ? '<div class="d-power">색상 선택</div>' : c.bonus === 'none' ? '<div class="d-power">황금 카드</div>' : '';
  const gemCls = c.bonus === 'none' ? 'gem-gold' : `gem-${c.bonus}`;
  const gemTitle = c.bonus === 'wild' ? '색상 선택: 산 뒤 이미 가진 카드의 색 중 하나를 고릅니다' : c.bonus === 'none' ? '황금 카드: 보너스 색이 없습니다' : DUEL_COLOR_LABEL[c.bonus] + ' 보너스';
  return `<div class="card-tile gem-border-${c.bonus} d-card${opt.can ? ' affordable d-can' : ''}" data-card="${id}">
    <div class="card-top"><span class="card-points">${c.pts || ''}</span>${crowns}<span class="card-gem ${gemCls}" title="${gemTitle}"></span></div>
    ${power}${wild}
    <div class="card-cost">${dCostHtml(c.cost)}</div>
    ${opt.buttons || ''}
  </div>`;
}

function dBackHtml(lv) {
  return `<div class="card-tile card-back d-card d-back" title="몰래 예약한 카드"><div class="d-back-text">몰래 예약<br><small>티어 ${lv}</small></div></div>`;
}

function dRoyalHtml(id) {
  const r = duelRoyal(id);
  const power = r.power ? ` · ${D_POWER[r.power][0]}` : '';
  return `<span class="d-royal" title="${r.power ? dEsc(D_POWER[r.power][1]) : ''}"><b>+${r.pts}</b>${power}</span>`;
}

function dRoyalTileHtml(id) {
  const r = duelRoyal(id);
  const power = r.power ? D_POWER[r.power][0] : '점수만';
  return `<div class="noble-tile d-royal-tile" data-royal="${id}" title="${r.power ? dEsc(D_POWER[r.power][1]) : '점수만 받습니다'}">
    <div class="noble-points">+${r.pts}</div>
    <div class="d-royal-power">${power}</div>
  </div>`;
}

// ---- 플레이어 패널 ----
// 오리지널의 플레이어 패널(player-panel)과 같은 구성. 듀얼에만 있는 것(왕관, 특권, 왕실, 승리 진행)을 덧붙인다.
function dPanelHtml(v, seat) {
  const p = v.players[seat];
  const me = seat === DAPP.seat;
  const isTurn = !v.over && (v.choice ? v.choice.seat === seat : v.turn === seat);
  const pts = duelPoints(v, seat);
  const crowns = duelCrowns(v, seat);
  const cp = duelColorPoints(v, seat);
  const bonus = duelBonus(v, seat);
  const bestCol = DUEL.COLORS.slice().sort((a, b) => cp[b] - cp[a])[0];
  const total = duelTokenTotal(p);

  const tokens = DUEL.TOKEN_TYPES.filter((t) => p.tokens[t] > 0).map((t) => dTok(t, p.tokens[t])).join('') || '<em>없음</em>';
  // 칩의 숫자는 카드 장수, 옆의 "N점"은 그 색 카드의 점수 합이다. "한 색 10점" 승리는 이 점수 합으로 센다.
  const bonuses = DUEL.COLORS.filter((c) => bonus[c] > 0).map((c) => `<span class="d-bonus${c === bestCol && cp[c] > 0 ? ' d-best' : ''}" title="${DUEL_COLOR_LABEL[c]} 카드 ${bonus[c]}장, 점수 합 ${cp[c]}점"><span class="gemdot d-sm gem-${c}">${bonus[c]}</span><span class="d-bonus-pts">${cp[c]}점</span></span>`).join('') || '<em>없음</em>';
  const scrolls = p.scrolls ? `<span class="d-scroll" title="특권 두루마리 ${p.scrolls}장">특권 ×${p.scrolls}</span>` : '<em>없음</em>';

  let reserved = '';
  const mine = me && dFreeTurn(v) && !v.mainDone;
  p.reserved.forEach((r, i) => {
    if (r.id === null || r.id === undefined) {
      reserved += dBackHtml(r.lv);
      return;
    }
    if (me) {
      const q = duelPayment(v, seat, r.id);
      const buy = `<div class="card-actions d-card-btns"><button type="button" data-act="buy" data-k="res" data-i="${i}" ${mine && q ? '' : 'disabled'}>구매</button></div>`;
      reserved += dCardHtml(r.id, { buttons: buy, can: mine && !!q });
    } else {
      reserved += dCardHtml(r.id);
    }
  });
  const royals = p.royals.length ? p.royals.map(dRoyalHtml).join(' ') : '<em>없음</em>';
  const stars = p.royals.map(() => '<span class="noble-mini">★</span>').join('');

  return `<div class="player-panel d-panel${isTurn ? ' active d-turn' : ''}" data-seat="${seat}">
    <h3>${dEsc(p.name || (me ? '나' : '상대'))}${me ? ' <span class="you-tag">나</span>' : ''} <span class="order-tag">${v.start === seat ? '선공' : '후공'}</span>${isTurn ? '<span class="turn-tag">현재 턴</span>' : ''}</h3>
    <div class="player-points">점수: ${pts}점 · 왕관 ${crowns}개 ${stars}</div>
    <div class="d-goal">승리: 점수 <b>${pts}/${DUEL.WIN_POINTS}</b> · 왕관 <b>${crowns}/${DUEL.WIN_CROWNS}</b> · 한 색 <b>${cp[bestCol]}/${DUEL.WIN_COLOR}</b>${cp[bestCol] ? ` (${DUEL_COLOR_LABEL[bestCol]} 카드 점수 합)` : ''}</div>
    <div class="player-row"><span class="row-label">보유 토큰 <span class="token-count${total >= DUEL.TOKEN_MAX ? ' token-full' : ''}">(${total}/${DUEL.TOKEN_MAX})</span></span><span class="row-items">${tokens}</span></div>
    <div class="player-row"><span class="row-label">카드 보너스</span><span class="row-items">${bonuses}</span></div>
    <div class="player-row"><span class="row-label">특권 두루마리</span><span class="row-items">${scrolls}</span></div>
    <div class="player-row"><span class="row-label">왕실 카드</span><span class="row-items">${royals}</span></div>
    <div class="player-row"><span class="row-label">예약 카드 (${p.reserved.length}/${DUEL.RESERVE_MAX})</span></div>
    <div class="reserved-cards d-reserved">${reserved}</div>
  </div>`;
}

// ---- 가운데: 왕실 카드, 피라미드, 토큰판 ----
function dRoyalsHtml(v) {
  const tiles = v.royals.map(dRoyalTileHtml).join('');
  return `${tiles || '<span class="d-label">왕실 카드를 모두 가져갔습니다</span>'}<div class="d-royal-label">남은 왕실 카드 · 왕관이 ${DUEL.ROYAL_AT.join('개, ')}개가 되면 한 장씩 받습니다</div>`;
}

// 오리지널의 티어 배치(tier-label + tier-cards)와 같다. 티어마다 카드 수만 5/4/3장이다.
function dPyramidHtml(v) {
  const free = dFreeTurn(v) && !v.mainDone;
  const canRes = free && duelCanReserve(v, DAPP.seat);
  let html = '';
  [3, 2, 1].forEach((lv) => {
    const n = v.deckN[lv];
    const deckBtn = `<button type="button" class="deck-reserve" data-act="deck" data-lv="${lv}" ${canRes && n > 0 ? '' : 'disabled'} title="덱 맨 위 카드를 보지 않고 예약합니다. 상대는 무엇인지 모릅니다.">덱에서 예약</button>`;
    let cards = '';
    v.pyramid[lv].forEach((id, i) => {
      if (id === null) {
        cards += '<div class="card-tile empty d-card d-empty"></div>';
        return;
      }
      const q = duelPayment(v, DAPP.seat, id);
      const buttons = `<div class="card-actions d-card-btns">
        <button type="button" data-act="buy" data-k="pyr" data-lv="${lv}" data-i="${i}" ${free && q ? '' : 'disabled'}>구매</button>
        <button type="button" data-act="reserve" data-lv="${lv}" data-i="${i}" ${canRes ? '' : 'disabled'}>예약</button></div>`;
      cards += dCardHtml(id, { buttons, can: free && !!q });
    });
    html += `<div class="tier" data-lv="${lv}"><div class="tier-label">티어 ${lv} <span class="deck-count">(남은 덱: ${n})</span> ${deckBtn}</div><div class="tier-cards">${cards}</div></div>`;
  });
  if (dCardsAreTemp()) {
    html += '<div class="d-note">※ 카드 구성은 임시입니다. 실제 상자의 카드와 다릅니다.</div>';
  }
  return html;
}

function dBoardHtml(v) {
  const mine = dMyTurn(v);
  const pickOpts = v.choice && v.choice.type === 'pick' && v.choice.seat === DAPP.seat ? v.choice.options : null;
  let html = '';
  v.board.forEach((t, pos) => {
    if (t === null) {
      html += '<button type="button" class="d-cell d-none" disabled aria-label="빈 칸"></button>';
      return;
    }
    const sel = DAPP.sel.includes(pos) ? ' d-sel' : '';
    const opt = pickOpts && pickOpts.includes(pos) ? ' d-opt' : '';
    const priv = DAPP.priv && t !== 'gold' ? ' d-priv' : '';
    const flash = v.last && v.last.kind === 'replenish' ? '' : '';
    html += `<button type="button" class="d-cell gem-${t}${sel}${opt}${priv}${flash}" data-act="cell" data-pos="${pos}" ${mine ? '' : 'disabled'} title="${DUEL_COLOR_LABEL[t]}">${t === 'pearl' ? '진주' : t === 'gold' ? '금' : ''}</button>`;
  });
  return html;
}

// 오리지널의 "가져올 보석: 확정/취소" 줄과 같은 모양. 고른 토큰이 칩으로 보이고 ✕로 하나씩 뺄 수 있다.
function dControlsHtml(v) {
  const me = v.players[DAPP.seat];
  const free = dFreeTurn(v) && !v.mainDone;
  const canRep = free && v.bagN > 0 && v.board.includes(null);
  const sel = DAPP.sel;
  const chips = sel.map((p) => `<button type="button" class="pending-chip gem-${v.board[p]}" data-act="unsel" data-pos="${p}">${DUEL_COLOR_LABEL[v.board[p]]} ✕</button>`).join('');
  let html = `<div class="d-pending"><span class="d-pending-label">가져올 토큰:</span><div class="d-pending-chips">${chips}</div>
    <button type="button" data-act="take" ${sel.length && free ? '' : 'disabled'}>확정</button>
    <button type="button" data-act="cancel" ${sel.length ? '' : 'disabled'}>취소</button></div>`;
  html += '<div class="d-extra">';
  html += `<button type="button" data-act="priv" class="${DAPP.priv ? 'd-on' : ''}" ${free && me.scrolls > 0 ? '' : 'disabled'} title="특권을 한 장 내고 판에서 원하는 보석이나 진주 1개를 집습니다 (금 제외)">특권 사용 (${me.scrolls})</button>`;
  html += `<button type="button" data-act="replenish" ${canRep ? '' : 'disabled'} title="주머니의 토큰으로 빈 칸을 채웁니다. 상대가 특권을 받습니다.">판 채우기</button>`;
  if (!sel.length && free && duelStuck(v, DAPP.seat)) {
    html += '<button type="button" data-act="pass" class="d-on">둘 수 있는 수가 없어 넘기기</button>';
  }
  html += '</div>';
  if (sel.length) {
    const types = sel.map((p) => v.board[p]);
    if (duelTakeIsGreedy(types)) html += '<div class="d-hint d-warn">같은 색 3개/진주 2개는 상대가 특권을 받습니다</div>';
  }
  return html;
}

// ---- 안내 줄, 기록 ----
function dBannerText(v) {
  if (v.over) {
    const w = v.players[v.over.winner];
    return `게임 종료 — ${dEsc(w.name)} 승리`;
  }
  const opp = v.players[1 - DAPP.seat];
  if (v.choice) {
    if (v.choice.seat !== DAPP.seat) return `${dEsc(opp.name)}이(가) 선택하는 중입니다.`;
    return { wild: '색상 선택 카드의 색을 고르세요.', royal: '가져올 왕실 카드를 고르세요.', steal: '상대에게서 가져올 토큰을 고르세요.', pick: '가져올 칸을 판에서 고르세요. (점선 표시)', discard: `토큰이 ${DUEL.TOKEN_MAX}개를 넘었습니다. ${v.choice.n}개를 버리세요.` }[v.choice.type] || '선택하세요.';
  }
  if (v.turn !== DAPP.seat) {
    if (v.extraTurn) return DAPP.mode === 'single' ? 'AI가 한 번 더 두는 중입니다... (추가 턴)' : `${dEsc(opp.name)}(상대방)이 한 번 더 두는 중입니다. (추가 턴)`;
    return DAPP.mode === 'single' ? 'AI가 생각하는 중입니다...' : `${dEsc(opp.name)}(상대방)의 차례를 기다리는 중입니다.`;
  }
  if (v.mainDone) return '마무리하는 중입니다.';
  if (DAPP.priv) return '특권을 쓸 칸을 고르세요. (금 제외)';
  if (v.extraTurn) return '한 번 더! 당신의 차례가 이어집니다. (추가 턴 — 필수 행동을 한 번 더 합니다)';
  return `당신의 차례입니다. (목표: 점수 ${DUEL.WIN_POINTS}점 · 왕관 ${DUEL.WIN_CROWNS}개 · 한 색 ${DUEL.WIN_COLOR}점)`;
}

// 능력(한 번 더, 빼앗기, 특권, 보석)이 일으킨 일을 "방금 일어난 일"로 바로 보여 준다.
// 다음 행동이 오면 엔진이 비우므로, 상대의 능력은 내 차례 내내 보이고 내가 두면 사라진다.
function dFxLines(v) {
  const seat = DAPP.seat;
  const opp = v.players[1 - seat];
  const oppName = DAPP.mode === 'single' ? 'AI' : dEsc(opp.name || '상대');
  const out = [];
  (Array.isArray(v.fx) ? v.fx : []).forEach((e) => {
    const mine = e.seat === seat;
    const who = mine ? '내가' : `${oppName}이(가)`;
    if (e.k === 'replay') {
      out.push(['한 번 더', mine
        ? '내가 <b>한 번 더</b> 둡니다. 상대에게 차례가 넘어가지 않고, 이어서 내가 다시 둡니다.'
        : `${oppName}이(가) <b>한 번 더</b> 둡니다. 아직 내 차례가 아닙니다. ${oppName}이(가) 한 번 더 둔 뒤에 내 차례가 옵니다.`]);
    } else if (e.k === 'steal') {
      if (!e.got) out.push(['빼앗기', '빼앗을 토큰이 없어서 아무 일도 일어나지 않았습니다. (금은 빼앗을 수 없습니다)']);
      else out.push(['빼앗기', mine ? `내가 ${oppName}의 <b>${DUEL_COLOR_LABEL[e.type]}</b> 1개를 빼앗았습니다.` : `${oppName}이(가) 내 <b>${DUEL_COLOR_LABEL[e.type]}</b> 1개를 빼앗았습니다.`]);
    } else if (e.k === 'scroll') {
      out.push(['특권', e.got ? `${who} 특권 두루마리를 1장 받았습니다.` : '받을 특권 두루마리가 없어서 받지 못했습니다.']);
    } else if (e.k === 'token') {
      out.push(['보석', e.got ? `${who} 판에서 <b>${DUEL_COLOR_LABEL[e.color]}</b> 1개를 가져왔습니다.` : `판에 ${DUEL_COLOR_LABEL[e.color]} 보석이 없어서 가져오지 못했습니다.`]);
    }
  });
  return out;
}

function dFxNextLine(v) {
  if (v.over) return '';
  const opp = v.players[1 - DAPP.seat];
  const oppName = DAPP.mode === 'single' ? 'AI' : dEsc(opp.name || '상대');
  if (v.choice) return v.choice.seat === DAPP.seat ? '지금 선택을 마쳐야 합니다.' : `${oppName}이(가) 선택하는 중입니다.`;
  const extra = v.extraTurn ? ' (추가 턴)' : '';
  return v.turn === DAPP.seat ? `지금은 <b>내 차례</b>입니다.${extra}` : `지금은 <b>${oppName} 차례</b>입니다.${extra}`;
}

function dRenderNotice(v) {
  const el = document.getElementById('dNotice');
  if (!el) return;
  const lines = v ? dFxLines(v) : [];
  if (!lines.length) {
    el.hidden = true;
    el.innerHTML = '';
    DAPP.noticeSig = null;
    return;
  }
  const next = dFxNextLine(v);
  el.innerHTML = lines.map(([tag, text]) => `<div class="d-fx-line"><span class="d-fx-tag">${tag}</span>${text}</div>`).join('') + (next ? `<div class="d-fx-next">→ ${next}</div>` : '');
  el.hidden = false;
  // 새 일이 생겼을 때만 한 번 반짝여 눈에 띄게 한다
  const sig = `${v.gameId}:${v.actionNo}:${lines.length}`;
  if (sig !== DAPP.noticeSig) {
    DAPP.noticeSig = sig;
    el.classList.remove('d-pop');
    void el.offsetWidth;
    el.classList.add('d-pop');
  }
}

function dRenderBanner() {
  const el = document.getElementById('dBanner');
  const v = dView();
  if (!el || !v) return;
  el.className = 'banner' + (v.over ? ' over' : '');
  el.innerHTML = dBannerText(v) + (DAPP.flash ? ` <span class="d-flash-msg">${dEsc(DAPP.flash)}</span>` : '');
}

function dRenderLog(v) {
  const el = document.getElementById('dLog');
  if (!el) return;
  el.innerHTML = `<div class="log-title">진행 기록</div><ul>${v.log.slice(0, 14).map((l) => `<li>${dEsc(l)}</li>`).join('')}</ul>`;
}

// ---- 창 ----
// duel-cards.js 의 DUEL_CARDS_PLACEHOLDER 가 true 인 동안만 "임시" 안내를 보인다
function dCardsAreTemp() {
  return typeof DUEL_CARDS_PLACEHOLDER !== 'undefined' && !!DUEL_CARDS_PLACEHOLDER;
}

function dRulesHtml() {
  return `<div class="d-rules">
    <h3>스플렌더 듀얼 규칙</h3>
    <p class="d-fine">이 화면의 규칙입니다. 규칙서 원문을 열어 보지 못해 <b>기억에 의존한 부분(기억 표시)</b>이 있습니다.${dCardsAreTemp() ? ' 카드 구성은 <b>임시</b>입니다.' : ''}
    실제와 다른 곳이 있으면 알려 주세요.</p>
    <h4>이기는 법 (하나라도 채우면 즉시 승리)</h4>
    <ul><li>명성 점수 <b>20점</b> 이상</li><li>왕관 <b>10개</b> 이상</li><li>같은 색 카드로만 <b>10점</b> 이상</li></ul>
    <h4>한 턴</h4>
    <ul>
      <li><b>선택 행동</b> (필수 행동 전에, 몇 번이든)
        <ul><li><b>특권 사용</b>: 두루마리 한 장을 내고 판에서 원하는 토큰 1개(금 제외)를 집습니다.</li>
        <li><b>판 채우기</b>: 주머니의 토큰으로 빈 칸을 채웁니다. 상대가 특권을 받습니다.</li></ul></li>
      <li><b>필수 행동</b> (셋 중 하나)
        <ul><li><b>토큰 집기</b>: 이어진 일직선(가로·세로·대각)의 토큰 1~3개. 금은 못 집습니다.
          같은 색 3개나 진주 2개를 집으면 <b>상대가 특권</b>을 받습니다.</li>
        <li><b>카드 예약</b>: 금 1개를 받고 카드 한 장을 예약합니다(최대 3장). 덱 맨 위는 몰래 예약합니다. <span class="d-fine">(기억)</span></li>
        <li><b>카드 구매</b>: 보너스로 깎은 값을 토큰으로 냅니다. 금은 아무 토큰이나 대신합니다. 진주는 할인이 없습니다.</li></ul></li>
      <li>끝나면 토큰은 <b>${DUEL.TOKEN_MAX}개</b>까지만 들 수 있습니다. 넘으면 버립니다. <span class="d-fine">(기억)</span></li>
    </ul>
    <h4>카드와 능력</h4>
    <ul><li>보너스 색 카드는 그 색의 값을 영구히 깎아 줍니다. 색상 선택 카드는 산 뒤 이미 가진 카드의 색 중 하나를 고릅니다.</li>
    <li>능력: <b>한 번 더</b>(바로 한 번 더 둠), <b>보석 1개</b>(판에서 같은 색), <b>특권</b>, <b>훔치기</b>(상대 보석/진주 1개).</li>
    <li>왕관이 처음 <b>3개</b>, <b>6개</b>가 되면 왕실 카드를 한 장씩 받습니다(행동이 아닙니다).</li>
    <li><b>황금 카드</b>는 보너스 색이 없어 비용을 깎아 주지 않고 점수만 줍니다.</li></ul>
    <h4>특권 두루마리</h4>
    <ul><li>모두 3개. 두 번째 플레이어가 1개를 갖고 시작합니다. <span class="d-fine">(기억)</span></li>
    <li>받을 때 판 옆에 남은 게 없으면 상대의 것을 가져옵니다.</li></ul>
    <div class="result-actions"><button type="button" data-act="close-modal">닫기</button></div>
  </div>`;
}

function dResultHtml(v) {
  const w = v.over.winner;
  const why = v.over.kind === 'points' ? `명성 ${duelPoints(v, w)}점` : v.over.kind === 'crowns' ? `왕관 ${duelCrowns(v, w)}개` : `${DUEL_COLOR_LABEL[v.over.color]} 카드로만 ${duelColorPoints(v, w)[v.over.color]}점`;
  const rows = [0, 1].map((s) => {
    const p = v.players[s];
    const best = DUEL.COLORS.reduce((m, c) => Math.max(m, duelColorPoints(v, s)[c]), 0);
    return `<tr class="${s === DAPP.seat ? 'd-rank-me' : ''}"><td>${dEsc(p.name)}${s === w ? ' (승)' : ''}</td><td><b>${duelPoints(v, s)}</b></td><td>${duelCrowns(v, s)}</td><td>${best}</td><td>${p.cards.length}</td></tr>`;
  }).join('');
  const again = DAPP.hooks.canRestart ? DAPP.hooks.canRestart() : true;
  const label = DAPP.mode === 'online' ? '재대결' : '새 게임';
  return `<h3 class="result-title">게임 종료</h3>
    <p class="result-headline">${dEsc(v.players[w].name)} 승리! (${why})</p>
    <table class="d-rank-table"><thead><tr><th>플레이어</th><th>점수</th><th>왕관</th><th>한 색 최고</th><th>카드</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="result-actions">
      ${again ? `<button class="result-primary" type="button" data-act="again">${label}</button>` : '<button class="result-primary" type="button" disabled>방장을 기다리는 중</button>'}
      <button type="button" data-act="close-result">닫기</button>
    </div>`;
}

function dChoiceHtml(v) {
  const ch = v.choice;
  if (ch.seat !== DAPP.seat) return null;
  if (ch.type === 'wild') {
    const b = duelBonus(v, DAPP.seat);
    return `<h3>색상 선택 카드의 색</h3><p>이미 가진 카드의 색 중 하나를 고르세요.</p>
      <div class="d-pick">${ch.options.map((c) => `<button type="button" data-act="c-wild" data-color="${c}">${dTok(c, b[c])}<br>${DUEL_COLOR_LABEL[c]}</button>`).join('')}</div>`;
  }
  if (ch.type === 'royal') {
    return `<h3>왕실 카드를 받습니다</h3><p>왕관이 ${duelCrowns(v, DAPP.seat)}개가 되었습니다. 한 장을 고르세요.</p>
      <div class="d-pick">${ch.options.map((id) => `<button type="button" data-act="c-royal" data-id="${id}">${dRoyalHtml(id)}</button>`).join('')}</div>`;
  }
  if (ch.type === 'steal') {
    const opp = v.players[1 - DAPP.seat];
    return `<h3>상대에게서 가져오기</h3><p>가져올 토큰을 고르세요. (금은 못 가져옵니다)</p>
      <div class="d-pick">${ch.options.map((t) => `<button type="button" data-act="c-steal" data-type="${t}">${dTok(t, opp.tokens[t])}<br>${DUEL_COLOR_LABEL[t]}</button>`).join('')}</div>`;
  }
  if (ch.type === 'discard') {
    const me = v.players[DAPP.seat];
    const pool = [];
    DUEL.TOKEN_TYPES.forEach((t) => {
      for (let i = 0; i < me.tokens[t]; i++) pool.push(t);
    });
    const chips = pool.map((t, i) => `<button type="button" class="${DAPP.discard.includes(i) ? 'd-sel-on' : ''}" data-act="c-discard-toggle" data-i="${i}">${dTok(t, '')}<br>${DUEL_COLOR_LABEL[t]}</button>`).join('');
    const ok = DAPP.discard.length === ch.n;
    return `<h3>토큰을 버리세요</h3><p>${ch.n}개를 골라 버립니다. (${DAPP.discard.length}/${ch.n})</p>
      <div class="d-pick">${chips}</div>
      <div class="result-actions"><button class="result-primary" type="button" data-act="c-discard-ok" ${ok ? '' : 'disabled'}>버리기</button></div>`;
  }
  return null; // pick은 판에서 직접 고른다
}

function dRenderModal(v) {
  const overlay = document.getElementById('modalOverlay');
  const modal = document.getElementById('modal');
  if (!overlay || !modal) return;
  let html = null;
  if (DAPP.modal && DAPP.modal.type === 'rules') html = dRulesHtml();
  else if (DAPP.modal && DAPP.modal.type === 'confirm') {
    const m = DAPP.modal;
    html = `<h3 class="confirm-title">${dEsc(m.title)}</h3><p class="confirm-body">${dEsc(m.body)}</p>
      <div class="result-actions"><button class="confirm-danger" type="button" data-act="confirm-ok">${dEsc(m.ok || '확인')}</button><button type="button" data-act="close-modal">취소</button></div>`;
  } else if (v && v.choice) html = dChoiceHtml(v);
  else if (v && v.over && DAPP.closedResult !== v.gameId) html = dResultHtml(v);
  if (html) {
    modal.innerHTML = html;
    overlay.classList.remove('hidden');
  } else {
    modal.innerHTML = '';
    overlay.classList.add('hidden');
  }
}

function dAsk(title, body, ok, cb) {
  DAPP.modal = { type: 'confirm', title, body, ok, cb };
  dRender();
}

// ---- 전체 그리기 ----
function dRenderTabs() {
  const s = document.getElementById('dModeSingle');
  const o = document.getElementById('dModeOnline');
  if (s) s.classList.toggle('active', DAPP.mode === 'single');
  if (o) o.classList.toggle('active', DAPP.mode === 'online');
  const nb = document.getElementById('dNewBtn');
  if (nb) {
    nb.textContent = DAPP.mode === 'online' ? '재대결' : '새 게임';
    nb.disabled = DAPP.mode === 'idle' || (DAPP.hooks.canRestart ? !DAPP.hooks.canRestart() : false);
  }
}

function dRender() {
  dRenderTabs();
  const v = dView();
  const start = document.getElementById('dStart');
  const game = document.getElementById('dGame');
  if (start) start.hidden = DAPP.mode !== 'idle';
  if (DAPP.hooks.renderNet) DAPP.hooks.renderNet();
  // 혼자 연습 화면에서도 게임을 고를 수 있다 (온라인은 로비 안에 있다)
  const singlePick = document.getElementById('dSinglePick');
  if (singlePick) {
    const showPick = DAPP.mode === 'single';
    singlePick.hidden = !showPick;
    if (showPick && !singlePick.innerHTML) singlePick.innerHTML = typeof gamePickHtml === 'function' ? gamePickHtml('duel', 'single', '다른 게임을 혼자 해 보려면') : '';
  }
  const logEl = document.getElementById('dLog');
  if (logEl) logEl.hidden = !v;
  if (!v) {
    if (game) game.hidden = true;
    dRenderNotice(null);
    if (DAPP.hooks.renderChat) DAPP.hooks.renderChat();
    dRenderModal(null);
    if (typeof dHelpRender === 'function') dHelpRender(null);
    return;
  }
  if (game) game.hidden = false;
  dRenderBanner();
  dRenderNotice(v);
  document.getElementById('dMe').innerHTML = dPanelHtml(v, DAPP.seat);
  document.getElementById('dOpp').innerHTML = dPanelHtml(v, 1 - DAPP.seat);
  document.getElementById('dRoyals').innerHTML = dRoyalsHtml(v);
  document.getElementById('dPyramid').innerHTML = dPyramidHtml(v);
  document.getElementById('dBoard').innerHTML = dBoardHtml(v);
  document.getElementById('dControls').innerHTML = dControlsHtml(v);
  dRenderLog(v);
  if (DAPP.hooks.renderChat) DAPP.hooks.renderChat();
  dRenderModal(v);
  if (typeof dHelpRender === 'function') dHelpRender(v);
}

// ---- 행동 보내기 ----
function dAfterChange() {
  DAPP.sel = [];
  DAPP.priv = false;
  DAPP.discard = [];
  dRender();
  dScheduleAi();
}

function dDo(action) {
  if (DAPP.sendAction) {
    DAPP.sendAction(action);
    return;
  }
  const res = duelApply(DAPP.S, DAPP.seat, action);
  if (!res.ok) {
    dFlash(res.err);
    return;
  }
  dAfterChange();
}

function dScheduleAi() {
  clearTimeout(DAPP.aiTimer);
  if (DAPP.mode !== 'single' || !DAPP.S || DAPP.S.over) return;
  const S = DAPP.S;
  const ai = 1 - DAPP.seat;
  const aiTurn = S.choice ? S.choice.seat === ai : S.turn === ai;
  if (!aiTurn) return;
  DAPP.aiTimer = setTimeout(() => {
    const a = duelAiAction(S, ai);
    if (!duelApply(S, ai, a).ok) duelAiFallback(S, ai);
    dAfterChange();
  }, DAPP.aiDelay);
}

// ---- 새 판 ----
function dStartSingle() {
  clearTimeout(DAPP.aiTimer);
  DAPP.mode = 'single';
  DAPP.seat = 0;
  DAPP.full = true;
  DAPP.sendAction = null;
  DAPP.S = duelNewGame({ names: [dMyName(), 'AI'] });
  DAPP.closedResult = null;
  dAfterChange();
}

function dSetMode(mode) {
  if (DAPP.hooks.setMode) {
    DAPP.hooks.setMode(mode);
    return;
  }
  if (mode === 'single') dStartSingle();
}

function dGameInProgress() {
  return !!(DAPP.S && !DAPP.S.over);
}

// ---- 클릭 ----
function dOnCell(pos) {
  const v = dView();
  if (!v || !dMyTurn(v)) return;
  if (v.choice) {
    if (v.choice.type === 'pick' && v.choice.options.includes(pos)) dDo({ t: 'choose', pos });
    return;
  }
  const t = v.board[pos];
  if (t === null) return;
  if (DAPP.priv) {
    if (t === 'gold') {
      dFlash('특권으로 금은 집을 수 없습니다.');
      return;
    }
    dDo({ t: 'priv', pos });
    return;
  }
  if (v.mainDone) return;
  if (t === 'gold') {
    dFlash('금은 카드를 예약할 때만 받습니다.');
    return;
  }
  if (DAPP.sel.includes(pos)) DAPP.sel = DAPP.sel.filter((p) => p !== pos);
  else {
    const next = DAPP.sel.concat(pos);
    DAPP.sel = next.length <= 3 && duelIsLine(next) ? next : [pos]; // 이어지지 않으면 새로 시작
  }
  dRender();
}

function dOnAct(el) {
  const act = el.dataset.act;
  const v = dView();
  switch (act) {
    case 'cell':
      return dOnCell(Number(el.dataset.pos));
    case 'priv':
      DAPP.priv = !DAPP.priv;
      DAPP.sel = [];
      return dRender();
    case 'replenish':
      return dAsk('토큰판을 채울까요?', '판을 채우면 상대가 특권 두루마리를 받습니다.', '채우기', () => dDo({ t: 'replenish' }));
    case 'take': {
      const pos = DAPP.sel.slice();
      return dDo({ t: 'take', pos });
    }
    case 'cancel':
      DAPP.sel = [];
      return dRender();
    case 'unsel':
      DAPP.sel = DAPP.sel.filter((p) => p !== Number(el.dataset.pos));
      return dRender();
    case 'pass':
      return dDo({ t: 'pass' });
    case 'buy': {
      const src = el.dataset.k === 'pyr' ? { k: 'pyr', lv: Number(el.dataset.lv), i: Number(el.dataset.i) } : { k: 'res', i: Number(el.dataset.i) };
      return dDo({ t: 'buy', src });
    }
    case 'reserve':
      return dDo({ t: 'reserve', src: { k: 'pyr', lv: Number(el.dataset.lv), i: Number(el.dataset.i) } });
    case 'deck':
      return dDo({ t: 'reserve', src: { k: 'deck', lv: Number(el.dataset.lv) } });
    case 'c-wild':
      return dDo({ t: 'choose', color: el.dataset.color });
    case 'c-royal':
      return dDo({ t: 'choose', id: el.dataset.id });
    case 'c-steal':
      return dDo({ t: 'choose', type: el.dataset.type });
    case 'c-discard-toggle': {
      const i = Number(el.dataset.i);
      const n = v && v.choice ? v.choice.n : 0;
      if (DAPP.discard.includes(i)) DAPP.discard = DAPP.discard.filter((x) => x !== i);
      else if (DAPP.discard.length < n) DAPP.discard = DAPP.discard.concat(i);
      return dRender();
    }
    case 'c-discard-ok': {
      const me = v.players[DAPP.seat];
      const pool = [];
      DUEL.TOKEN_TYPES.forEach((t) => {
        for (let i = 0; i < me.tokens[t]; i++) pool.push(t);
      });
      return dDo({ t: 'choose', discard: DAPP.discard.map((i) => pool[i]) });
    }
    case 'close-modal':
      DAPP.modal = null;
      return dRender();
    case 'confirm-ok': {
      const cb = DAPP.modal && DAPP.modal.cb;
      DAPP.modal = null;
      dRender();
      if (cb) cb();
      return undefined;
    }
    case 'close-result':
      DAPP.closedResult = v ? v.gameId : null;
      return dRender();
    case 'again':
      return dNewGameClick();
    default:
      return undefined;
  }
}

function dNewGameClick() {
  if (DAPP.mode === 'online' && DAPP.hooks.newGame) return DAPP.hooks.newGame();
  if (!dGameInProgress()) return dStartSingle();
  return dAsk('새 게임을 시작할까요?', '지금 판은 버려집니다.', '새로 시작', dStartSingle);
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act]');
  if (t && !t.disabled) dOnAct(t);
  const st = e.target.closest('[data-d-start]');
  if (st) dSetMode(st.dataset.dStart);
});

document.addEventListener('DOMContentLoaded', () => {
  const tempHint = document.getElementById('dTempHint');
  if (tempHint) tempHint.hidden = !dCardsAreTemp();
  const on = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
  };
  on('dModeSingle', () => dSetMode('single'));
  on('dModeOnline', () => dSetMode('online'));
  on('dNewBtn', dNewGameClick);
  on('dRuleBtn', () => {
    DAPP.modal = { type: 'rules' };
    dRender();
  });
  document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'modalOverlay' && DAPP.modal) {
      DAPP.modal = null;
      dRender();
    }
  });
  const startPick = document.getElementById('dStartPick');
  if (startPick && typeof gamePickHtml === 'function') startPick.innerHTML = gamePickHtml('duel', 'start');
  // 오리지널 쪽에서 "스플렌더 듀얼"을 골라 넘어왔으면 그 화면(혼자 연습/온라인 로비)부터 연다.
  const incoming = typeof gamePickIncomingMode === 'function' ? gamePickIncomingMode() : null;
  if (incoming) dSetMode(incoming);
  dRender();
});
