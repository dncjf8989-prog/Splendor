'use strict';

// ============ 방 그대로 게임 바꾸기 (스플렌더 오리지널 <-> 스플렌더 듀얼) ============
// 두 게임은 다른 페이지(index.html, duel.html)이고 중계 서버의 방 이름도 다르다 (splendor-lite-코드 / splendor-duel-코드).
// 그래서 방장이 대기방에서 게임을 바꾸면
//   1) 들어와 있던 사람들에게 { type: 'hop', game } 을 보내고,
//   2) 방장은 같은 방 코드로 다른 게임 페이지에서 방을 다시 열고 (?hop=host&room=코드),
//   3) 손님들은 같은 코드로 그 방에 자동으로 다시 들어온다 (?hop=guest&room=코드).
// 방 코드는 그대로고 이름과 전적(프로필)은 두 게임이 같이 쓰므로 그대로 따라온다.
// 바꿀 수 있는 때는 판이 없는 대기방과, 판이 끝난 방이다. 두고 있는 판은 바꿀 수 없다.

const ROOMHOP_CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;
const ROOMHOP_RETRY_MS = 1500; // 방장이 새 페이지에서 방을 열 때까지 손님이 다시 두드리는 간격
const ROOMHOP_GIVEUP_MS = 45000; // 이 시간이 지나도 방이 안 열리면 포기하고 오류를 보여 준다
const ROOMHOP_SEND_MS = 350; // 손님들에게 알림이 나갈 시간을 준 뒤 방장이 떠난다

function roomHopHref(game, role, code) {
  return GAMEPICK[game].page + '?mode=online&hop=' + role + '&room=' + encodeURIComponent(code);
}

function roomHopGo(game, role, code) {
  if (!GAMEPICK[game] || !ROOMHOP_CODE_RE.test(code)) return false;
  location.href = roomHopHref(game, role, code);
  return true;
}

// 주소에 실려 온 방 이동 정보를 읽고, 새로고침해도 다시 실행되지 않도록 주소에서 지운다.
function roomHopIncoming() {
  try {
    const q = new URLSearchParams(location.search);
    const role = q.get('hop');
    const code = String(q.get('room') || '').toUpperCase();
    if ((role !== 'host' && role !== 'guest') || !ROOMHOP_CODE_RE.test(code)) return null;
    if (window.history && history.replaceState) history.replaceState(null, '', location.pathname + '?mode=online');
    return { role, code, at: Date.now() };
  } catch (e) {
    return null;
  }
}

// 손님이 방장보다 먼저 도착해도 되도록, 정해진 시간 동안은 실패해도 다시 시도한다.
function roomHopCanRetry(hop) {
  return !!(hop && hop.role === 'guest' && Date.now() - hop.at < ROOMHOP_GIVEUP_MS);
}

// 방에서 게임을 고르는 곳 (대기방, 판이 끝난 방).
//   current : 지금 이 방의 게임 ('original' | 'duel')
//   host    : 내가 방장인가. 방장만 누를 수 있다.
//   blocked : 바꿀 수 없는 까닭 (빈 문자열이면 바꿀 수 있다)
//   act     : 눌렀을 때 쓸 표식을 만드는 함수 (게임 이름 -> 속성 문자열). 게임마다 이벤트 연결 방식이 다르다.
function roomHopPickHtml(current, host, blocked, attr) {
  const opts = ['original', 'duel']
    .map((g) => {
      const o = GAMEPICK[g];
      const inner = `${o.name} <small>${o.size}</small>`;
      if (g === current) return `<span class="game-opt active" aria-current="true">${inner}</span>`;
      if (host && !blocked) return `<button type="button" class="game-opt" ${attr(g)}>${inner}</button>`;
      return `<span class="game-opt disabled" aria-disabled="true">${inner}</span>`;
    })
    .join('');
  let note;
  if (!host) note = '게임은 방장이 고릅니다.';
  else if (blocked) note = blocked;
  else note = '게임을 바꿔도 방 코드는 그대로이고, 들어와 있는 사람도 같이 넘어갑니다.';
  return `<div class="game-pick room-hop">
    <div class="game-pick-label">이 방에서 할 게임</div>
    <div class="game-switch" role="group" aria-label="이 방의 게임">${opts}</div>
    <div class="net-sub">${note}</div>
  </div>`;
}
