'use strict';

// ============ 스플렌더 듀얼 온라인 대전 ============
// 오리지널과 같은 중계(relay.js)를 쓰지만 방식은 다르다.
//   - 규칙은 방장만 돌린다. 게스트는 "이런 행동을 하겠다"만 보내고, 방장이 판정해서
//     바뀐 모습을 돌려준다. 그래서 게스트가 규칙을 어길 수 없고, 상대가 몰래 예약한
//     카드는 처음부터 게스트에게 보내지 않는다.
//   - 메시지가 한 번 사라져도 멈추지 않는다. 방장이 2.5초마다 "지금 몇 번째 상태"를
//     알리고, 어긋나면 게스트가 다시 받아 간다. 게스트가 보낸 행동도 응답이 없으면
//     같은 번호로 다시 보낸다 (방장은 번호로 중복을 거른다).
//   - 방은 2인 전용이다. 관전은 아직 없다.

const D_PEER_PREFIX = 'splendor-duel-'; // 오리지널 방 코드와 섞이지 않게 접두사를 다르게
const D_NET_TIMEOUT_MS = 20000;
const D_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 헷갈리는 0/O/1/I/L 제외

const DNET = {
  role: null, // 'host' | 'guest'
  status: 'idle', // idle | creating | connecting | waiting | active | error
  errorMsg: '',
  code: '',
  peer: null,
  link: null, // 방장: { conn, profile } / 게스트: { conn }
  pending: [], // 방장: 아직 hello를 안 보낸 연결
  profiles: null, // [방장, 게스트] 자리 순서
  timer: null,
  hbMs: 2500, // 0이면 끈다 (시험용)
  hbTimer: null,
  hbCount: 0,
  behind: 0,
  lastResyncHb: -9,
  resyncing: false,
  aidSeq: 0, // 게스트: 보낸 행동 번호
  lastAid: -1, // 방장: 처리한 마지막 행동 번호
  pendingAct: null, // 게스트: 아직 결과를 못 받은 행동 { aid, action, sentRev, stale }
  recorded: null, // 기록을 남긴 판
  chat: [],
  draftCode: '',
  draftNick: null,
};
window.DNET = DNET;

function dnAvailable() {
  return typeof relayAvailable === 'function' && relayAvailable();
}

function dnRandomCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += D_CODE_CHARS[Math.floor(Math.random() * D_CODE_CHARS.length)];
  return s;
}

function dnSend(conn, msg) {
  if (!conn || !conn.open) return;
  try {
    conn.send(msg);
  } catch (e) {
    console.error('[듀얼 온라인] 전송 실패', e);
  }
}

// 남이 보낸 프로필은 믿지 않고 모양과 길이를 다듬는다
function dnSanitizeProfile(p) {
  if (!p || typeof p !== 'object') return null;
  const id = typeof p.id === 'string' ? p.id.slice(0, 40) : '';
  const name = typeof p.name === 'string' ? p.name.replace(/\s+/g, ' ').trim().slice(0, 12) : '';
  if (!id) return null;
  return { id, name: name || '플레이어' };
}

function dnMyProfile() {
  return { id: dProfile().id, name: dMyName() };
}

function dnClearTimer() {
  if (DNET.timer) clearTimeout(DNET.timer);
  DNET.timer = null;
}

function dnFailAfterTimeout(msgFn) {
  dnClearTimer();
  DNET.timer = setTimeout(() => {
    if (DNET.status === 'creating' || DNET.status === 'connecting') {
      DNET.status = 'error';
      DNET.errorMsg = msgFn();
      dnCleanup();
      dRender();
    }
  }, D_NET_TIMEOUT_MS);
}

function dnKeepAlive(peer) {
  peer.on('disconnected', () => {
    if (peer.destroyed) return;
    try {
      peer.reconnect();
    } catch (e) {
      /* noop */
    }
  });
}

// ---- 채팅 ----
function dnChatClean(text) {
  return String(text == null ? '' : text)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}
function dnChatTime(at) {
  const d = new Date(at || Date.now());
  const pad = (n) => (n < 10 ? '0' + n : String(n));
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function dnChatPush(entry) {
  entry.at = Date.now();
  DNET.chat.push(entry);
  if (DNET.chat.length > 60) DNET.chat.splice(0, DNET.chat.length - 60);
  dnRenderChat();
}
function dnChatSystem(text) {
  dnChatPush({ system: true, text: dnChatClean(text) });
}
function dnChatUsable() {
  return DAPP.mode === 'online' && (DNET.status === 'waiting' || DNET.status === 'active');
}
function dnRenderChat() {
  const panel = document.getElementById('dChatPanel');
  const list = document.getElementById('dChatLog');
  if (!panel || !list) return;
  const show = DAPP.mode === 'online' && DNET.status !== 'idle' && DNET.status !== 'error';
  panel.hidden = !show;
  if (!show) return;
  list.innerHTML = DNET.chat
    .map((m) => {
      if (m.system) return `<li class="chat-system">${dEsc(m.text)}</li>`;
      return `<li class="chat-line${m.mine ? ' chat-mine' : ''}"><span class="chat-name">${dEsc(m.name)}</span>${dEsc(m.text)}<span class="chat-time">${dnChatTime(m.at)}</span></li>`;
    })
    .join('');
  list.scrollTop = list.scrollHeight;
  const input = document.getElementById('dChatInput');
  const btn = document.getElementById('dChatSend');
  const ok = dnChatUsable();
  if (input) input.disabled = !ok;
  if (btn) btn.disabled = !ok;
}
function dnChatSend(raw) {
  if (!dnChatUsable()) return;
  const text = dnChatClean(raw);
  if (!text) return;
  dnChatPush({ name: dMyName(), text, mine: true });
  dnSend(DNET.link && DNET.link.conn, { type: 'chat', name: dMyName(), text });
}
function dnChatReceive(msg) {
  const text = dnChatClean(msg && msg.text);
  if (!text) return;
  dnChatPush({ name: dnChatClean(msg.name).slice(0, 12) || '상대', text });
}

// ---- 정리 ----
function dnStopHeartbeat() {
  if (DNET.hbTimer) clearTimeout(DNET.hbTimer);
  DNET.hbTimer = null;
}

function dnCleanup() {
  dnClearTimer();
  dnStopHeartbeat();
  const conn = DNET.link && DNET.link.conn;
  const peer = DNET.peer;
  try {
    if (conn) conn.close();
  } catch (e) {
    /* noop */
  }
  try {
    if (peer) peer.destroy();
  } catch (e) {
    /* noop */
  }
  DNET.peer = null;
  DNET.link = null;
  DNET.pending = [];
  DNET.role = null;
  DNET.pendingAct = null;
  DNET.resyncing = false;
  DAPP.sendAction = null;
}

function dnResetToLobby() {
  DNET.status = 'idle';
  DNET.errorMsg = '';
  DNET.code = '';
  DNET.profiles = null;
  DNET.chat = [];
  DNET.recorded = null;
  DAPP.S = null;
  DAPP.full = true;
  DAPP.closedResult = null;
}

// ---- 판 기록 ----
function dnGameLive() {
  return !!(DAPP.S && !DAPP.S.over && DNET.status === 'active');
}

function dnRecordIfOver() {
  const S = DAPP.S;
  if (!S || !S.over || DNET.recorded === S.gameId || !DNET.profiles) return;
  DNET.recorded = S.gameId;
  dSaveGame(S.gameId, dGameRecord(S, DNET.profiles));
}

// 내가 나가거나(leaver = 내 자리) 상대가 나갔을 때(leaver = 상대 자리) 그 판을 남긴다
function dnRecordAbandoned(leaverSeat, keepalive) {
  const S = DAPP.S;
  if (!S || S.over || DNET.recorded === S.gameId || !DNET.profiles) return;
  DNET.recorded = S.gameId;
  dSaveGame(S.gameId, dGameRecordAbandoned(S, DNET.profiles, leaverSeat), keepalive);
}

// ---- 방장 ----
function dnCreateRoom() {
  if (!dnAvailable()) {
    DNET.status = 'error';
    DNET.errorMsg = '이 브라우저에서는 온라인 대전을 사용할 수 없습니다.';
    dRender();
    return;
  }
  DNET.status = 'creating';
  DNET.role = 'host';
  DNET.code = dnRandomCode();
  DNET.link = null;
  DNET.pending = [];
  DNET.chat = [];
  DAPP.mode = 'online';
  DAPP.seat = 0;
  dRender();

  const peer = new RelayPeer(D_PEER_PREFIX + DNET.code);
  DNET.peer = peer;
  dnKeepAlive(peer);
  dnFailAfterTimeout(() => '방을 여는 데 실패했습니다. 네트워크 상태를 확인하고 다시 시도해 주세요.');

  peer.on('open', () => {
    // 같은 방 코드를 쓰는 방이 이미 있는지 확인한 뒤에 연다
    peer.probe(
      () => {
        peer.destroy();
        dnCreateRoom(); // 코드가 겹쳤다. 다른 코드로 다시
      },
      () => {
        dnClearTimer();
        DNET.status = 'waiting';
        dnChatSystem('방을 열었습니다. 방 코드를 상대에게 알려 주세요.');
        dRender();
      }
    );
  });
  peer.on('connection', (conn) => {
    conn.on('open', () => DNET.pending.push(conn));
    conn.on('data', (msg) => dnHostHandle(conn, msg));
    conn.on('close', () => dnHostLinkGone(conn, false));
    conn.on('error', () => dnHostLinkGone(conn, false));
  });
  peer.on('error', () => {
    dnClearTimer();
    DNET.status = 'error';
    DNET.errorMsg = '중계 서버에 연결하지 못했습니다. 네트워크 상태를 확인하고 다시 시도해 주세요.';
    dRender();
  });
}

function dnHostHandle(conn, msg) {
  if (!msg || !msg.type) return;
  const isGuest = !!(DNET.link && DNET.link.conn === conn);

  if (msg.type === 'hello') {
    const profile = dnSanitizeProfile(msg.profile);
    if (!profile) return;
    const pi = DNET.pending.indexOf(conn);
    if (pi >= 0) {
      DNET.pending.splice(pi, 1);
      if (DNET.link || DNET.status !== 'waiting') {
        dnSend(conn, { type: 'full' });
        setTimeout(() => {
          try {
            conn.close();
          } catch (e) {
            /* noop */
          }
        }, 200);
        return;
      }
      DNET.link = { conn, profile };
      dnSend(conn, { type: 'welcome', seat: 1, host: dMyName() });
      dnChatSystem(`${profile.name}님이 들어왔습니다. 시작하기를 눌러 주세요.`);
      dRender();
    } else if (isGuest) {
      DNET.link.profile = profile;
      dRender();
    }
    return;
  }
  if (!isGuest) return;

  if (msg.type === 'act') {
    if (DNET.status !== 'active' || !DAPP.S || !Number.isInteger(msg.aid)) return;
    if (msg.aid <= DNET.lastAid) {
      dnPushState(); // 이미 처리한 행동이 다시 왔다. 결과만 다시 알려 준다
      return;
    }
    DNET.lastAid = msg.aid;
    const res = duelApply(DAPP.S, 1, msg.action);
    if (!res.ok) {
      dnSend(conn, { type: 'reject', aid: msg.aid, err: res.err, rev: DAPP.S.rev });
      return;
    }
    dAfterChange();
    dnPushState();
    dnRecordIfOver();
    return;
  }
  if (msg.type === 'resync') {
    if (DNET.status === 'active' && DAPP.S) {
      if (msg.gameId === DAPP.S.gameId) dnPushState();
      else dnSendInit(); // 시작 알림이 안 닿았다
    }
    return;
  }
  if (msg.type === 'chat') {
    dnChatReceive(msg);
    return;
  }
  if (msg.type === 'left') {
    dnHostLinkGone(conn, true);
  }
}

function dnPushState() {
  if (!DNET.link || !DAPP.S) return;
  dnSend(DNET.link.conn, { type: 'state', view: duelViewFor(DAPP.S, 1) });
}

function dnSendInit() {
  if (!DNET.link || !DAPP.S) return;
  dnSend(DNET.link.conn, { type: 'init', seat: 1, view: duelViewFor(DAPP.S, 1), profiles: DNET.profiles });
}

function dnHostLinkGone(conn, left) {
  const pi = DNET.pending.indexOf(conn);
  if (pi >= 0) {
    DNET.pending.splice(pi, 1);
    return;
  }
  if (!DNET.link || DNET.link.conn !== conn) return;
  const who = (DNET.link.profile && DNET.link.profile.name) || '상대';

  if (DNET.status === 'waiting') {
    // 시작 전에 나갔다. 자리를 비우고 다시 기다린다
    DNET.link = null;
    dnChatSystem(`${who}님이 나갔습니다.`);
    dRender();
    return;
  }
  if (DNET.status !== 'active') return;

  const live = dnGameLive();
  if (left && live) dnRecordAbandoned(1, false); // 상대가 스스로 나갔다 -> 부전승
  dnChatSystem(left ? `${who}님이 대전에서 나갔습니다.` : `${who}님의 연결이 끊어졌습니다.`);
  DNET.status = 'error';
  DNET.errorMsg = left
    ? live
      ? `${who}님이 나가서 대전이 끝났습니다. 부전승으로 기록했습니다.`
      : `${who}님이 나갔습니다.`
    : `${who}님의 연결이 끊어져 대전이 끝났습니다.`;
  dnCleanup();
  dRender();
}

function dnHostStart() {
  if (DNET.role !== 'host' || !DNET.link || !DNET.link.profile) return;
  DNET.profiles = [dnMyProfile(), DNET.link.profile];
  DAPP.S = duelNewGame({ names: [DNET.profiles[0].name, DNET.profiles[1].name] });
  DAPP.mode = 'online';
  DAPP.seat = 0;
  DAPP.full = true;
  DAPP.sendAction = dnHostSend;
  DAPP.closedResult = null;
  DNET.status = 'active';
  DNET.recorded = null;
  DNET.lastAid = -1;
  dnChatSystem('대전이 시작되었습니다.');
  dnSendInit();
  dnStartHeartbeat();
  dAfterChange();
}

// 방장이 직접 두는 행동
function dnHostSend(action) {
  const res = duelApply(DAPP.S, 0, action);
  if (!res.ok) {
    dFlash(res.err);
    return;
  }
  dAfterChange();
  dnPushState();
  dnRecordIfOver();
}

// ---- 방장의 점검 신호 ----
function dnHeartbeatTick() {
  DNET.hbTimer = null;
  if (DNET.role !== 'host' || DNET.status !== 'active') return;
  if (DAPP.S && DNET.link) dnSend(DNET.link.conn, { type: 'hb', gameId: DAPP.S.gameId, rev: DAPP.S.rev });
  if (DNET.hbMs > 0) DNET.hbTimer = setTimeout(dnHeartbeatTick, DNET.hbMs);
}
function dnStartHeartbeat() {
  dnStopHeartbeat();
  if (DNET.hbMs > 0) DNET.hbTimer = setTimeout(dnHeartbeatTick, DNET.hbMs);
}

// ---- 게스트 ----
function dnJoinRoom(rawCode) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!dnAvailable()) {
    DNET.status = 'error';
    DNET.errorMsg = '이 브라우저에서는 온라인 대전을 사용할 수 없습니다.';
    dRender();
    return;
  }
  if (!code) {
    DNET.status = 'error';
    DNET.errorMsg = '방 코드를 입력해 주세요.';
    dRender();
    return;
  }
  DNET.role = 'guest';
  DNET.code = code;
  DNET.status = 'connecting';
  DNET.chat = [];
  DNET.link = null;
  DAPP.mode = 'online';
  DAPP.seat = 1;
  dRender();

  let opened = false;
  const peer = new RelayPeer();
  DNET.peer = peer;
  dnKeepAlive(peer);
  dnFailAfterTimeout(() => (opened ? '방장이 응답하지 않습니다. 방 코드가 맞는지, 방장이 방을 열어둔 상태인지 확인해 주세요.' : '중계 서버에 닿지 못했습니다. 네트워크 상태를 확인하고 다시 시도해 주세요.'));

  peer.on('open', () => {
    opened = true;
    const conn = peer.connect(D_PEER_PREFIX + code, { reliable: true });
    DNET.link = { conn };
    conn.on('open', () => {
      dnClearTimer();
      dnSend(conn, { type: 'hello', profile: dnMyProfile() });
    });
    conn.on('data', dnGuestHandle);
    conn.on('close', dnGuestHostGone);
    conn.on('error', dnGuestHostGone);
  });
  peer.on('error', (err) => {
    dnClearTimer();
    DNET.status = 'error';
    DNET.errorMsg = err && err.type === 'peer-unavailable'
      ? '방장이 응답하지 않습니다. 방 코드가 맞는지, 방장이 방을 열어둔 상태인지 확인해 주세요.'
      : '중계 서버에 연결하지 못했습니다. 네트워크 상태를 확인하고 다시 시도해 주세요.';
    dnCleanup();
    dRender();
  });
}

function dnValidView(v) {
  return !!(v && typeof v === 'object' && Array.isArray(v.players) && v.players.length === 2 && Array.isArray(v.board) && v.pyramid && v.deckN && typeof v.gameId === 'string');
}

function dnGuestHandle(msg) {
  if (!msg || !msg.type) return;

  if (msg.type === 'welcome') {
    DNET.status = 'waiting';
    dnChatSystem(`${dnChatClean(msg.host) || '방장'}님의 방에 들어왔습니다. 방장이 시작하기를 기다려 주세요.`);
    dRender();
    return;
  }
  if (msg.type === 'full') {
    DNET.status = 'error';
    DNET.errorMsg = '이미 두 명이 들어와 있는 방입니다.';
    dnCleanup();
    dRender();
    return;
  }
  if (msg.type === 'init') {
    if (!dnValidView(msg.view) || !Array.isArray(msg.profiles) || msg.profiles.length !== 2) return;
    const ps = msg.profiles.map(dnSanitizeProfile);
    if (!ps[0] || !ps[1]) return;
    DNET.profiles = ps;
    DNET.status = 'active';
    DNET.resyncing = false;
    DNET.pendingAct = null;
    DNET.recorded = null;
    DNET.behind = 0;
    DAPP.mode = 'online';
    DAPP.seat = 1;
    DAPP.full = false;
    DAPP.S = msg.view;
    DAPP.sendAction = dnGuestSend;
    DAPP.closedResult = null;
    dnChatSystem('대전이 시작되었습니다.');
    dAfterChange();
    return;
  }
  if (msg.type === 'state') {
    dnGuestState(msg.view);
    return;
  }
  if (msg.type === 'reject') {
    if (DNET.pendingAct && DNET.pendingAct.aid === msg.aid) DNET.pendingAct = null;
    dFlash(dnChatClean(msg.err) || '그 행동은 할 수 없습니다.');
    dRender();
    return;
  }
  if (msg.type === 'hb') {
    dnGuestHeartbeat(msg);
    return;
  }
  if (msg.type === 'chat') {
    dnChatReceive(msg);
    return;
  }
  if (msg.type === 'hostRestart') {
    // 방장이 두던 판을 접고 다시 시작했다. 내 쪽에서는 부전승으로 남긴다
    if (dnGameLive()) dnRecordAbandoned(0, false);
    dnChatSystem(`${(DNET.profiles && DNET.profiles[0].name) || '방장'}님이 판을 다시 시작했습니다.`);
    return;
  }
  if (msg.type === 'peerLeft') {
    const live = dnGameLive();
    if (msg.left && live) dnRecordAbandoned(0, false);
    DNET.status = 'error';
    DNET.errorMsg = msg.left ? (live ? '방장이 나가서 대전이 끝났습니다. 부전승으로 기록했습니다.' : '방장이 나갔습니다.') : '방장과의 연결이 끊어졌습니다.';
    dnChatSystem(DNET.errorMsg);
    dnCleanup();
    dRender();
  }
}

function dnGuestState(view) {
  if (!dnValidView(view)) return;
  const cur = DAPP.S;
  // 다른 길로 돌아 늦게 온 옛 상태가 새 상태를 덮어쓰면 한 수가 되돌아간다
  if (cur && cur.gameId === view.gameId && Number.isInteger(view.rev) && Number.isInteger(cur.rev) && view.rev < cur.rev) return;
  DAPP.S = view;
  DAPP.full = false;
  if (DNET.pendingAct && view.rev > DNET.pendingAct.sentRev) DNET.pendingAct = null;
  if (DNET.resyncing) {
    DNET.resyncing = false;
    dnChatSystem('다시 맞췄습니다.');
  }
  dAfterChange();
  dnRecordIfOver();
}

function dnGuestSend(action) {
  if (DNET.status !== 'active' || !DNET.link) return;
  if (DNET.pendingAct) {
    dFlash('방장이 처리하는 중입니다. 잠시만요.');
    return;
  }
  DNET.aidSeq += 1;
  DNET.pendingAct = { aid: DNET.aidSeq, action, sentRev: DAPP.S ? DAPP.S.rev : 0, stale: 0 };
  dnSend(DNET.link.conn, { type: 'act', aid: DNET.aidSeq, action });
}

// 방장의 점검 신호를 받았다. 내 것과 어긋나면 맞춘다.
// 마침 오가는 중인 메시지와 엇갈릴 수 있으므로 연달아 두 번 어긋나 보일 때만 움직인다.
function dnGuestHeartbeat(msg) {
  if (DNET.status === 'error' || DNET.status === 'idle' || typeof msg.gameId !== 'string') return;
  DNET.hbCount += 1;
  const S = DAPP.S;
  const same = !!(S && S.gameId === msg.gameId) && DNET.status === 'active';
  if (!same) {
    dnRequestResync(); // 시작 알림이 안 닿았거나 새 판을 놓쳤다
    return;
  }
  if (!Number.isInteger(msg.rev)) return;

  if (msg.rev > S.rev) {
    DNET.behind += 1;
    if (DNET.behind >= 2) dnRequestResync();
  } else {
    DNET.behind = 0;
  }

  // 내가 보낸 행동의 결과가 안 온다: 방장이 못 받았을 수 있으니 같은 번호로 다시 보낸다
  const p = DNET.pendingAct;
  if (p) {
    if (msg.rev <= p.sentRev) {
      p.stale += 1;
      if (p.stale >= 2) {
        p.stale = 0;
        dnSend(DNET.link && DNET.link.conn, { type: 'act', aid: p.aid, action: p.action });
      }
    }
  }
}

function dnRequestResync() {
  if (DNET.hbCount - DNET.lastResyncHb < 2) return;
  DNET.lastResyncHb = DNET.hbCount;
  DNET.behind = 0;
  if (!DNET.resyncing) {
    DNET.resyncing = true;
    dnChatSystem('방장과 화면이 어긋나 다시 맞추는 중입니다...');
  }
  dnSend(DNET.link && DNET.link.conn, { type: 'resync', gameId: DAPP.S ? DAPP.S.gameId : null });
}

function dnGuestHostGone() {
  if (DNET.status === 'error' || DNET.status === 'idle') return;
  dnChatSystem('방장과의 연결이 끊어졌습니다.');
  DNET.status = 'error';
  DNET.errorMsg = '방장과의 연결이 끊어졌습니다.';
  dnCleanup();
  dRender();
}

// ---- 나가기 / 다시 시작 ----
function dnLeaveRoom(silent) {
  const conn = DNET.link && DNET.link.conn;
  const msg = DNET.role === 'host' ? { type: 'peerLeft', left: true, name: dMyName() } : { type: 'left' };
  if (conn && !silent) dnSend(conn, msg);
  // 나간다는 알림이 나갈 시간을 준 뒤에 끊는다
  const peer = DNET.peer;
  const keep = conn;
  DNET.link = null;
  DNET.peer = null;
  setTimeout(() => {
    try {
      if (keep) keep.close();
    } catch (e) {
      /* noop */
    }
    try {
      if (peer) peer.destroy();
    } catch (e) {
      /* noop */
    }
  }, 400);
  dnCleanup();
  dnResetToLobby();
  dRender();
}

function dnLeaveRequested() {
  if (!dnGameLive()) {
    dnLeaveRoom();
    return;
  }
  dAsk('대전에서 나가시겠습니까?', '진행 중인 판은 패배로 기록됩니다. 창을 그냥 닫아도 마찬가지입니다.', '나가기 (패배 처리)', () => {
    dnRecordAbandoned(DAPP.seat, false);
    dnLeaveRoom();
  });
}

function dnNewGame() {
  if (DNET.role !== 'host' || DNET.status !== 'active') return undefined;
  if (!DNET.link) return undefined;
  if (!dnGameLive()) {
    dnHostStart();
    return undefined;
  }
  return dAsk('지금 다시 시작하시겠습니까?', '진행 중인 판은 패배로 기록됩니다. 나가기와 같습니다.', '다시 시작 (패배 처리)', () => {
    dnSend(DNET.link.conn, { type: 'hostRestart', name: dMyName() });
    dnRecordAbandoned(0, false);
    dnHostStart();
  });
}

// 탭을 닫거나 새로고침하면 나간 것으로 본다. 그냥 끊기게 두면 상대 쪽에서는 회선
// 장애와 구분이 안 되어 아무도 기록되지 않고, 지고 있을 때 창을 닫는 길이 열린다.
function dnPageHide(persisted) {
  if (persisted) return; // 모바일에서 앱을 잠깐 전환하는 것은 나간 게 아니다
  if (DAPP.mode !== 'online' || !dnGameLive()) return;
  dnRecordAbandoned(DAPP.seat, true);
  const conn = DNET.link && DNET.link.conn;
  dnSend(conn, DNET.role === 'host' ? { type: 'peerLeft', left: true, name: dMyName() } : { type: 'left' });
}

// ---- 방 화면 ----
function dnRenderNet() {
  const el = document.getElementById('dNetPanel');
  if (!el) return;
  const online = DAPP.mode === 'online';
  el.hidden = !online;
  dnRenderChat();
  if (!online) {
    el.innerHTML = '';
    return;
  }
  const nick = DNET.draftNick != null ? DNET.draftNick : dProfile().name;
  const st = DNET.status;

  if (st === 'idle') {
    el.innerHTML = `<div class="net-box">
      <div class="net-row"><label for="dnNick">내 닉네임</label>
        <input id="dnNick" maxlength="12" placeholder="플레이어" value="${dEsc(nick)}" autocomplete="off"></div>
      <div class="net-row">
        <button type="button" data-dn="create">방 만들기</button>
        <span class="net-or">또는</span>
        <input id="dnCode" maxlength="4" placeholder="방 코드 4자리" autocomplete="off" value="${dEsc(DNET.draftCode)}">
        <button type="button" data-dn="join">참가하기</button>
      </div>
      <div class="net-sub">스플렌더 듀얼은 2인 전용입니다. 방을 만든 사람이 방장이고, 상대가 들어오면 시작하기를 누릅니다.</div>
    </div>`;
    return;
  }
  if (st === 'creating' || st === 'connecting') {
    el.innerHTML = `<div class="net-box"><div>${st === 'creating' ? '방을 만드는 중...' : '연결하는 중...'}</div>
      <div class="net-sub">잠시만 기다려 주세요. 오래 걸리면 취소하고 다시 시도해 보세요.</div>
      <button type="button" data-dn="cancel">취소</button></div>`;
    return;
  }
  if (st === 'error') {
    el.innerHTML = `<div class="net-box net-warn">${dEsc(DNET.errorMsg)}<br><button type="button" data-dn="retry">처음으로</button></div>`;
    return;
  }
  if (st === 'waiting') {
    if (DNET.role === 'host') {
      const joined = DNET.link && DNET.link.profile ? DNET.link.profile.name : '';
      el.innerHTML = `<div class="net-box">
        <div class="room-code-label">방 코드</div><div class="room-code">${dEsc(DNET.code)}</div>
        <div class="lobby-list"><span class="lobby-chip">${dEsc(dMyName())} (방장)</span>${joined ? `<span class="lobby-chip">${dEsc(joined)}</span>` : ''}</div>
        <div class="net-sub">${joined ? '상대가 들어왔습니다. 준비되면 시작하세요.' : '상대가 들어오기를 기다리는 중입니다. 위의 방 코드를 알려 주세요.'}</div>
        <button type="button" class="net-start" data-dn="start" ${joined ? '' : 'disabled'}>시작하기</button>
        <button type="button" class="net-leave" data-dn="leave">방 닫기</button>
      </div>`;
    } else {
      el.innerHTML = `<div class="net-box"><div class="room-code-label">방 코드 ${dEsc(DNET.code)}</div>
        <div class="net-sub">방장이 시작하기를 누르기를 기다리는 중입니다.</div>
        <button type="button" class="net-leave" data-dn="leave">나가기</button></div>`;
    }
    return;
  }
  // active
  const opp = DNET.profiles ? DNET.profiles[1 - DAPP.seat] : null;
  el.innerHTML = `<div class="net-strip">
    <span>온라인 · 방 코드 <b>${dEsc(DNET.code)}</b> · 나: ${dEsc(dMyName())} (${DNET.role === 'host' ? '방장' : '참가자'}) · 상대: ${dEsc(opp ? opp.name : '')}</span>
    <button type="button" class="net-leave" data-dn="leave">나가기</button></div>`;
}

function dnSetMode(mode) {
  if (mode === 'online') {
    if (DAPP.mode === 'online') return;
    const go = () => {
      clearTimeout(DAPP.aiTimer);
      DAPP.mode = 'online';
      DAPP.sendAction = null;
      dnResetToLobby();
      dRender();
    };
    if (DAPP.mode === 'single' && dGameInProgress()) dAsk('온라인 대전으로 넘어갈까요?', '진행 중인 연습 판은 버려집니다.', '넘어가기', go);
    else go();
    return;
  }
  // single
  if (DAPP.mode === 'single') return;
  const toSingle = () => {
    dnCleanup();
    dnResetToLobby();
    dStartSingle();
  };
  if (DAPP.mode === 'online' && dnGameLive()) {
    dAsk('연습으로 넘어갈까요?', '진행 중인 온라인 대전은 패배로 기록됩니다.', '넘어가기 (패배 처리)', () => {
      dnRecordAbandoned(DAPP.seat, false);
      const conn = DNET.link && DNET.link.conn;
      dnSend(conn, DNET.role === 'host' ? { type: 'peerLeft', left: true, name: dMyName() } : { type: 'left' });
      setTimeout(toSingle, 0);
    });
    return;
  }
  if (DAPP.mode === 'online' && DNET.link) dnSend(DNET.link.conn, DNET.role === 'host' ? { type: 'peerLeft', left: true, name: dMyName() } : { type: 'left' });
  toSingle();
}

function dnOnClick(act) {
  switch (act) {
    case 'create':
      return dnCreateRoom();
    case 'join': {
      const input = document.getElementById('dnCode');
      DNET.draftCode = input ? input.value : DNET.draftCode;
      return dnJoinRoom(DNET.draftCode);
    }
    case 'start':
      return dnHostStart();
    case 'cancel':
    case 'retry':
      dnCleanup();
      dnResetToLobby();
      return dRender();
    case 'leave':
      return dnLeaveRequested();
    default:
      return undefined;
  }
}

DAPP.hooks.setMode = dnSetMode;
DAPP.hooks.newGame = () => (DAPP.mode === 'online' ? dnNewGame() : undefined);
DAPP.hooks.canRestart = () => (DAPP.mode === 'online' ? DNET.role === 'host' && DNET.status === 'active' : true);
DAPP.hooks.renderNet = dnRenderNet;
DAPP.hooks.renderChat = dnRenderChat;

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-dn]');
  if (t && !t.disabled) dnOnClick(t.dataset.dn);
});

document.addEventListener('input', (e) => {
  if (e.target && e.target.id === 'dnCode') DNET.draftCode = e.target.value;
  if (e.target && e.target.id === 'dnNick') {
    DNET.draftNick = e.target.value;
    dSetName(e.target.value);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !e.target) return;
  if (e.target.id === 'dnCode') {
    e.preventDefault();
    dnOnClick('join');
  }
  if (e.target.id === 'dChatInput') {
    e.preventDefault();
    dnChatSend(e.target.value);
    e.target.value = '';
  }
});

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('dChatSend');
  if (btn) {
    btn.addEventListener('click', () => {
      const input = document.getElementById('dChatInput');
      if (!input) return;
      dnChatSend(input.value);
      input.value = '';
      input.focus();
    });
  }
});

window.addEventListener('pagehide', (e) => dnPageHide(e.persisted));
