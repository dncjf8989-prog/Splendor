'use strict';

// ============ 게임 고르기 (스플렌더 오리지널 / 스플렌더 듀얼) ============
// 시작 화면, 싱글 화면, 온라인 로비 세 곳에서 같은 모양으로 쓴다.
// 현재 게임은 눌리지 않는 칸, 다른 게임은 그 게임의 같은 화면으로 가는 링크다.
//   where = 'start'  : 그 게임의 시작 화면
//           'single' : 그 게임의 싱글(혼자 연습) 화면
//           'online' : 그 게임의 온라인 대전 로비

const GAMEPICK = {
  original: { name: '스플렌더 오리지널', size: '2~4인', page: 'index.html' },
  duel: { name: '스플렌더 듀얼', size: '2인', page: 'duel.html' },
};

function gamePickHref(game, where) {
  const q = where === 'single' || where === 'online' ? '?mode=' + where : '';
  return GAMEPICK[game].page + q;
}

function gamePickHtml(current, where, hint) {
  const label = '게임 고르기' + (hint ? ' (' + hint + ')' : '');
  const opts = ['original', 'duel']
    .map((g) => {
      const o = GAMEPICK[g];
      const inner = `${o.name} <small>${o.size}</small>`;
      return g === current
        ? `<span class="game-opt active" aria-current="true">${inner}</span>`
        : `<a class="game-opt" href="${gamePickHref(g, where)}">${inner}</a>`;
    })
    .join('');
  return `<div class="game-pick">
    <div class="game-pick-label">${label}</div>
    <div class="game-switch" role="group" aria-label="게임 선택">${opts}</div>
  </div>`;
}

// 주소의 ?mode=single|online 을 읽는다. 다른 게임의 같은 화면에서 넘어왔을 때 쓴다.
function gamePickIncomingMode() {
  try {
    const m = new URLSearchParams(location.search).get('mode');
    return m === 'single' || m === 'online' ? m : null;
  } catch (e) {
    return null;
  }
}
