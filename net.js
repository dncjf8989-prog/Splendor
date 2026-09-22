'use strict';

// ============ 온라인 대전 (PeerJS / WebRTC, 로그인·서버 저장소 불필요) ============
// game.js가 정의하는 전역 G, render(), log(), newGame(), GEMS 등을 그대로 사용한다.
//
// 구조: 호스트가 허브 역할을 하는 스타 토폴로지.
//   게스트 ── 호스트 ── 게스트
//              └─ 게스트
// 게스트끼리는 직접 연결하지 않고, 호스트가 받은 상태를 나머지에게 중계한다.
// 덕분에 2~4인을 같은 방식으로 다룰 수 있다.
const PEER_ID_PREFIX = 'splendor-lite-';

// STUN만으로는 일부 회사/학교/모바일 네트워크(대칭형 NAT)에서 상대와 직접
// 연결이 열리지 않는다. TURN 서버를 하나 더 두면 그런 경우 이 서버를 거쳐
// 중계된다. openrelay.metered.ca는 데모/소규모 프로젝트용 무료 공개 TURN
// 서버다(대역폭 제한이 있고 예고 없이 바뀔 수 있다). 턴제 게임이라 중계로
// 인한 지연은 체감되지 않는다.
const ICE_CONFIG = {
  // PeerJS 기본값을 통째로 덮어쓰므로 원래 있던 항목도 같이 적어준다.
  sdpSemantics: 'unified-plan',
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  ],
};

const NET = {
  mode: 'single', // 'single' | 'online'
  role: null, // 'host' | 'guest'
  roomCode: null,
  roomSize: 2, // 방 정원 (호스트가 방을 만들 때 정한다)
  seat: null, // 내 자리 번호 (호스트는 0)
  peer: null,
  links: [], // 호스트: 게스트별 연결 목록 / 게스트: 호스트 연결 하나
  status: 'idle', // idle | creating | waiting | connecting | active | error
  errorMsg: '',
  opponents: [], // 상대 프로필 목록 - 상대전적 집계에 쓴다
  lobby: [], // 로비에 표시할 참가자 이름
  timer: null, // 연결 대기 시간 제한
  peerOpened: false, // 신호 서버까지는 닿았는지 (실패 원인 구분용)
};
// game.js는 window.NET으로 존재 여부를 확인하므로 전역 객체에 명시적으로 노출한다.
// (top-level const는 window의 프로퍼티가 되지 않는다.)
window.NET = NET;

// PeerJS는 연결이 끝내 열리지 않아도 오류를 주지 않는 경우가 있다.
// 회사·학교망처럼 WebRTC가 막힌 곳에서 흔하다. 그대로 두면 "연결하는 중..."에서
// 영영 멈추므로 직접 시간을 잰다.
const NET_TIMEOUT_MS = 15000;

function netClearTimer() {
  if (NET.timer) clearTimeout(NET.timer);
  NET.timer = null;
}

function netFailAfterTimeout(getMsg) {
  netClearTimer();
  NET.timer = setTimeout(() => {
    if (NET.status !== 'connecting' && NET.status !== 'creating') return;
    netCleanupPeer();
    NET.status = 'error';
    NET.errorMsg = getMsg();
    renderNetPanel();
  }, NET_TIMEOUT_MS);
}

// ============ 연결 진단 ============
// 연결이 안 될 때 어디서 막히는지 확인한다. 브라우저마다 네트워크가 다르므로
// 직접 돌려보는 수밖에 없다. 두 가지를 본다.
//   1) ICE 후보 수집 - STUN(공인 주소 확인)과 TURN(중계)이 실제로 되는지
//   2) 신호 서버 - 방 코드를 주고받는 서버에 닿는지
const DIAG = { running: false, lines: [], done: false };
window.DIAG = DIAG;

function diagLog(text, ok) {
  DIAG.lines.push({ text, ok });
  renderNetPanel();
}

// ICE 후보를 모아 어떤 종류가 잡히는지 본다.
// host = 내 컴퓨터 주소, srflx = STUN 성공, relay = TURN 성공
function diagGatherIce() {
  return new Promise((resolve) => {
    if (typeof RTCPeerConnection === 'undefined') {
      resolve({ error: '이 브라우저는 WebRTC를 지원하지 않습니다.' });
      return;
    }
    let pc;
    try {
      pc = new RTCPeerConnection(ICE_CONFIG);
    } catch (e) {
      resolve({ error: 'WebRTC를 시작하지 못했습니다.' });
      return;
    }
    const types = new Set();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        pc.close();
      } catch (e) {
        /* noop */
      }
      resolve({ types });
    };
    const timer = setTimeout(finish, 10000);
    pc.onicecandidate = (e) => {
      if (!e.candidate) {
        finish();
        return;
      }
      const c = e.candidate;
      const type = c.type || (String(c.candidate).match(/ typ (\w+)/) || [])[1];
      if (type) types.add(type);
      // 중계까지 확인됐으면 더 기다릴 필요 없다
      if (types.has('relay') && types.has('srflx')) finish();
    };
    try {
      pc.createDataChannel('diag');
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .catch(() => finish());
    } catch (e) {
      finish();
    }
  });
}

// TURN만 쓰도록 강제해 두 연결을 서로 붙여본다. 성공하면 TURN 서버와
// 자격 증명이 실제로 동작한다는 뜻이다. 후보만 모아보는 것보다 확실하다.
function diagTurnLoopback() {
  return new Promise((resolve) => {
    if (typeof RTCPeerConnection === 'undefined') {
      resolve({ ok: false, reason: 'WebRTC 미지원' });
      return;
    }
    const cfg = Object.assign({}, ICE_CONFIG, { iceTransportPolicy: 'relay' });
    let a;
    let b;
    let settled = false;
    const finish = (ok, reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (a) a.close();
        if (b) b.close();
      } catch (e) {
        /* noop */
      }
      resolve({ ok, reason });
    };
    const timer = setTimeout(() => finish(false, '시간 초과'), 15000);
    try {
      a = new RTCPeerConnection(cfg);
      b = new RTCPeerConnection(cfg);
    } catch (e) {
      finish(false, '시작 실패');
      return;
    }
    a.onicecandidate = (e) => {
      if (e.candidate && b) b.addIceCandidate(e.candidate).catch(() => {});
    };
    b.onicecandidate = (e) => {
      if (e.candidate && a) a.addIceCandidate(e.candidate).catch(() => {});
    };
    const ch = a.createDataChannel('turntest');
    ch.onopen = () => finish(true);
    b.ondatachannel = (e) => {
      e.channel.onopen = () => finish(true);
    };
    a.createOffer()
      .then((offer) => a.setLocalDescription(offer).then(() => b.setRemoteDescription(offer)))
      .then(() => b.createAnswer())
      .then((answer) => b.setLocalDescription(answer).then(() => a.setRemoteDescription(answer)))
      .catch(() => finish(false, '협상 실패'));
  });
}

// 신호 서버에 닿는지 (방 코드를 주고받는 서버)
function diagSignaling() {
  return new Promise((resolve) => {
    if (!netAvailable()) {
      resolve({ ok: false, reason: '온라인 대전용 스크립트를 불러오지 못했습니다.' });
      return;
    }
    let settled = false;
    let peer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (peer) peer.destroy();
      } catch (e) {
        /* noop */
      }
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, reason: '10초 안에 응답이 없습니다.' }), 10000);
    try {
      peer = new Peer(undefined, { config: ICE_CONFIG });
    } catch (e) {
      finish({ ok: false, reason: '연결을 시작하지 못했습니다.' });
      return;
    }
    peer.on('open', () => finish({ ok: true }));
    peer.on('error', (err) => finish({ ok: false, reason: (err && err.type) || '알 수 없는 오류' }));
  });
}

async function netRunDiagnostics() {
  if (DIAG.running) return;
  DIAG.running = true;
  DIAG.done = false;
  DIAG.lines = [];
  NET.status = 'diag';
  renderNetPanel();

  diagLog('내 네트워크에서 쓸 수 있는 연결 방법을 찾는 중...', null);
  const ice = await diagGatherIce();
  DIAG.lines.pop();
  if (ice.error) {
    diagLog(ice.error, false);
  } else {
    const t = ice.types;
    diagLog(t.has('host') ? '내 컴퓨터 주소 확인 - 정상' : '내 컴퓨터 주소를 찾지 못했습니다', t.has('host'));
    diagLog(
      t.has('srflx') ? 'STUN(공인 주소 확인) - 정상' : 'STUN 차단됨 - 방화벽이 막고 있습니다',
      t.has('srflx')
    );
    diagLog(
      t.has('relay') ? 'TURN(중계 서버) - 정상. 직접 연결이 막혀도 우회됩니다' : 'TURN(중계 서버) 사용 불가',
      t.has('relay')
    );
  }

  diagLog('중계 서버로 실제 연결이 되는지 시험하는 중... (최대 15초)', null);
  const relay = await diagTurnLoopback();
  DIAG.lines.pop();
  diagLog(
    relay.ok ? '중계(TURN) 실제 연결 - 성공' : `중계(TURN) 실제 연결 실패 (${relay.reason})`,
    relay.ok
  );

  diagLog('방 코드 서버에 닿는지 확인하는 중...', null);
  const sig = await diagSignaling();
  DIAG.lines.pop();
  diagLog(sig.ok ? '방 코드 서버 - 정상' : `방 코드 서버에 닿지 못했습니다 (${sig.reason})`, sig.ok);

  // 종합 판단
  const has = (k) => ice.types && ice.types.has(k);
  let verdict;
  if (!sig.ok) {
    verdict = '방 코드 서버에 닿지 못합니다. 이 네트워크에서는 온라인 대전을 쓸 수 없습니다. 다른 네트워크(휴대폰 테더링 등)에서 시도해 보세요.';
  } else if (relay.ok) {
    verdict = '중계 서버로 실제 연결까지 성공했습니다. 이 기기 쪽은 문제가 없습니다. 그래도 대전이 안 되면 상대방 네트워크 문제일 수 있으니 상대방도 이 진단을 돌려보게 해주세요.';
  } else if (has('relay')) {
    verdict = '중계 서버 주소는 받았지만 실제 연결에는 실패했습니다. 중계 서버가 혼잡하거나 방화벽이 막고 있을 수 있습니다. 잠시 뒤 다시 시도하거나 다른 네트워크에서 시도해 보세요.';
  } else if (has('srflx')) {
    verdict = '중계 서버를 못 씁니다. 상대와 직접 연결이 되는 환경이면 대전이 되지만, 한쪽이라도 회사·학교망이면 실패합니다.';
  } else {
    verdict = 'STUN도 TURN도 막혀 있습니다. 이 네트워크(회사·학교망일 가능성이 높습니다)에서는 온라인 대전이 불가능합니다. 휴대폰 테더링 등 다른 네트워크에서 시도해 보세요.';
  }
  DIAG.verdict = verdict;
  DIAG.done = true;
  DIAG.running = false;
  renderNetPanel();
}

// PeerJS는 방 코드 서버와의 연결이 한동안 조용하면 끊는다. 방장이 방을
// 만들어두고 기다리는 사이에 이게 끊기면, 그 뒤에 들어오는 참가 요청이
// 방장에게 도달하지 않아 게스트 쪽이 그대로 멈춘다. 끊기면 바로 다시 붙인다.
function netKeepAlive(peer) {
  peer.on('disconnected', () => {
    if (peer.destroyed) return;
    try {
      peer.reconnect();
    } catch (e) {
      /* noop */
    }
  });
}

function netAvailable() {
  return typeof Peer !== 'undefined';
}

function netRandomRoomCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 혼동되는 0/O/1/I/L 제외
  let s = '';
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// ============ 상태 직렬화 ============
function netSerializeState() {
  return {
    gameId: G.gameId,
    playerCount: G.playerCount,
    winPoints: G.winPoints,
    bank: G.bank,
    tiers: G.tiers.map((t) => ({ deck: t.deck, faceUp: t.faceUp })),
    nobles: G.nobles,
    players: G.players,
    startIndex: G.startIndex,
    currentIndex: G.currentIndex,
    logs: G.logs.slice(0, 20),
    gameOver: G.gameOver,
    winnerText: G.winnerText,
  };
}

function netApplyRemoteState(state) {
  G = {
    gameId: state.gameId,
    playerCount: state.playerCount,
    winPoints: state.winPoints,
    bank: state.bank,
    tiers: state.tiers,
    nobles: state.nobles,
    players: state.players,
    startIndex: state.startIndex || 0,
    currentIndex: state.currentIndex,
    pending: [],
    discardState: null,
    nobleChoice: null,
    logs: state.logs || [],
    gameOver: !!state.gameOver,
    winnerText: state.winnerText || '',
  };
  render();
}

// ============ 프로필 ============
// 내 프로필(기기 ID + 닉네임)을 알려야 상대전적을 집계할 수 있다.
function netMyProfile() {
  if (typeof statsProfile !== 'function') return { id: 'unknown', name: '플레이어' };
  const p = statsProfile();
  return { id: p.id, name: statsMyDisplayName() };
}

// 상대가 보낸 프로필은 신뢰할 수 없으므로 형태와 길이를 다듬어 받는다.
function netSanitizeProfile(profile) {
  if (!profile || typeof profile !== 'object') return null;
  const id = typeof profile.id === 'string' ? profile.id.slice(0, 40) : '';
  const name = typeof profile.name === 'string' ? profile.name.replace(/\s+/g, ' ').trim().slice(0, 12) : '';
  if (!id) return null;
  return { id, name: name || '상대' };
}

// 자리 번호가 붙은 전체 참가자 프로필 (호스트가 만들어 게스트에게 내려준다)
function netProfileList() {
  const list = [Object.assign({ seat: 0 }, netMyProfile())];
  NET.links.forEach((link) => {
    if (link.profile) list.push(Object.assign({ seat: link.seat }, link.profile));
  });
  return list;
}

function netSetOpponentsFrom(profiles) {
  NET.opponents = (profiles || [])
    .filter((p) => p && p.seat !== NET.seat)
    .map((p) => netSanitizeProfile(p))
    .filter(Boolean);
}

// ============ 송신 ============
function netSendTo(conn, msg) {
  if (!conn || !conn.open) return;
  try {
    conn.send(msg);
  } catch (e) {
    console.error('[온라인 대전] 전송 실패', e);
  }
}

// 호스트가 모든 게스트에게 (except를 주면 그 연결만 건너뛴다)
function netBroadcast(msg, except) {
  NET.links.forEach((link) => {
    if (link.conn !== except) netSendTo(link.conn, msg);
  });
}

function netSendToHost(msg) {
  const link = NET.links[0];
  if (link) netSendTo(link.conn, msg);
}

// 채팅도 상태와 같은 경로로 오간다. 방장이면 전원에게, 게스트면 방장에게.
function netSendChat(entry) {
  const msg = { type: 'chat', seat: entry.seat, name: entry.name, text: entry.text };
  if (NET.role === 'host') netBroadcast(msg);
  else netSendToHost(msg);
}

NET.commit = function commit() {
  if (NET.mode !== 'online' || NET.status !== 'active') return;
  const msg = { type: 'state', state: netSerializeState() };
  if (NET.role === 'host') netBroadcast(msg);
  else netSendToHost(msg);
};

NET.requestNewGame = function requestNewGame() {
  if (NET.role !== 'host') {
    log('방장만 새 게임을 시작할 수 있습니다.');
    render();
    return;
  }
  netHostStartGame();
};

// ============ 호스트 ============
function netCreateRoom() {
  if (!netAvailable()) {
    NET.status = 'error';
    NET.errorMsg = '이 브라우저에서는 온라인 대전을 사용할 수 없습니다.';
    renderNetPanel();
    return;
  }
  NET.status = 'creating';
  renderNetPanel();

  const code = netRandomRoomCode();
  NET.mode = 'online';
  NET.role = 'host';
  NET.roomCode = code;
  NET.roomSize = RULES[selectedPlayerCount] ? selectedPlayerCount : 2;
  NET.seat = 0;
  NET.links = [];
  NET.opponents = [];

  const peer = new Peer(PEER_ID_PREFIX + code, { config: ICE_CONFIG });
  NET.peer = peer;
  netKeepAlive(peer);

  netFailAfterTimeout(() => '방을 여는 데 실패했습니다. 네트워크 상태를 확인하고 다시 시도해 주세요.');

  peer.on('open', () => {
    netClearTimer();
    NET.status = 'waiting';
    netUpdateLobby();
  });

  peer.on('connection', (conn) => {
    conn.on('open', () => {
      // 이미 시작했거나 정원이 찼으면 받지 않는다.
      if (NET.status === 'active' || NET.links.length >= NET.roomSize - 1) {
        netSendTo(conn, { type: 'full' });
        setTimeout(() => {
          try {
            conn.close();
          } catch (e) {
            /* noop */
          }
        }, 200);
        return;
      }
      const seat = NET.links.length + 1;
      NET.links.push({ conn, seat, profile: null });
      netSendTo(conn, { type: 'welcome', seat, roomSize: NET.roomSize });
      netUpdateLobby();
    });
    conn.on('data', (msg) => netHostHandle(conn, msg));
    conn.on('close', () => netHostLinkGone(conn));
    conn.on('error', () => netHostLinkGone(conn));
  });

  peer.on('error', (err) => {
    netClearTimer();
    if (err && err.type === 'unavailable-id') {
      peer.destroy();
      netCreateRoom(); // 코드 충돌 시 재시도
      return;
    }
    NET.status = 'error';
    NET.errorMsg = '방을 여는 중 오류가 발생했습니다.';
    renderNetPanel();
  });
}

function netHostHandle(conn, msg) {
  if (!msg || !msg.type) return;
  const link = NET.links.find((l) => l.conn === conn);

  if (msg.type === 'hello') {
    if (link) link.profile = netSanitizeProfile(msg.profile);
    netUpdateLobby();
    // 정원이 다 찼고 모두 프로필을 보냈으면 시작한다.
    if (NET.status === 'waiting' && NET.links.length === NET.roomSize - 1 && NET.links.every((l) => l.profile)) {
      netHostStartGame();
    }
    return;
  }

  if (msg.type === 'state') {
    // 게스트가 자기 턴을 마쳤다. 내 화면에 반영하고 나머지 게스트에게 중계한다.
    netApplyRemoteState(msg.state);
    netBroadcast({ type: 'state', state: msg.state }, conn);
    return;
  }

  if (msg.type === 'chat') {
    if (!link) return;
    // 도배 방지: 같은 사람이 너무 빠르게 보내면 흘려보낸다.
    const now = Date.now();
    if (link.lastChatAt && now - link.lastChatAt < 400) return;
    link.lastChatAt = now;
    // 보낸 사람은 연결 정보로 덮어쓴다. 게스트가 남의 이름을 사칭할 수 없다.
    const entry = {
      seat: link.seat,
      name: link.profile ? link.profile.name : '상대',
      text: msg.text,
    };
    const shown = chatReceive(entry);
    if (shown) netBroadcast({ type: 'chat', seat: shown.seat, name: shown.name, text: shown.text }, conn);
    return;
  }

  if (msg.type === 'left') {
    netHostLinkGone(conn, true);
  }
}

function netHostStartGame() {
  // 선공은 매 판 무작위로 정한다. 방장이 뽑아서 상태에 담아 전원에게 알리므로
  // 모두가 같은 선공을 본다 (재대결 때도 다시 뽑는다).
  newGame(NET.roomSize, Math.floor(Math.random() * NET.roomSize));
  NET.links.forEach((link) => {
    if (link.profile && G.players[link.seat]) G.players[link.seat].name = link.profile.name;
  });
  logFirstPlayer();
  NET.status = 'active';
  chatSystem('대전이 시작되었습니다.');
  const profiles = netProfileList();
  netSetOpponentsFrom(profiles);
  render();
  NET.links.forEach((link) => {
    netSendTo(link.conn, { type: 'init', seat: link.seat, state: netSerializeState(), profiles });
  });
  renderNetPanel();
}

// left: 상대가 스스로 나갔는지(true) 아니면 그냥 연결이 끊겼는지(false).
// 회선 장애면 양쪽 다 "상대가 사라졌다"로 보이므로 둘 다 부전승을 먹는다.
// 그래서 스스로 나갔다고 알려온 경우에만 승으로 친다.
function netHostLinkGone(conn, left) {
  const idx = NET.links.findIndex((l) => l.conn === conn);
  if (idx < 0) return;
  const gone = NET.links[idx];
  NET.links.splice(idx, 1);

  if (NET.status === 'active') {
    const who = gone.profile ? gone.profile.name : '참가자';
    // 진행 중에 한 명이라도 빠지면 판을 이어갈 수 없다.
    if (left) statsRecordWalkover(); // 연결을 정리하기 전에 기록한다
    netBroadcast({ type: 'peerLeft', name: gone.profile ? gone.profile.name : '상대', left: !!left });
    chatSystem(left ? `${who}님이 대전에서 나갔습니다.` : `${who}님의 연결이 끊어졌습니다.`);
    NET.status = 'error';
    NET.errorMsg = left
      ? `${who}님이 나가서 게임을 종료합니다. 부전승으로 기록했습니다.`
      : `${who}님의 연결이 끊어져 게임을 종료합니다.`;
    netCleanupPeer(true); // 남은 게스트들에게 알림이 닿을 때까지 기다렸다 끊는다
    renderNetPanel();
    return;
  }

  // 로비에서 나간 경우에는 자리를 다시 매겨 계속 기다린다.
  NET.links.forEach((l, i) => {
    l.seat = i + 1;
    netSendTo(l.conn, { type: 'welcome', seat: l.seat, roomSize: NET.roomSize });
  });
  netUpdateLobby();
}

// ============ 게스트 ============
function netJoinRoom(rawCode) {
  const code = (rawCode || '').trim().toUpperCase();
  if (!netAvailable()) {
    NET.status = 'error';
    NET.errorMsg = '이 브라우저에서는 온라인 대전을 사용할 수 없습니다.';
    renderNetPanel();
    return;
  }
  if (!code) {
    NET.status = 'error';
    NET.errorMsg = '방 코드를 입력해 주세요.';
    renderNetPanel();
    return;
  }
  NET.mode = 'online';
  NET.role = 'guest';
  NET.roomCode = code;
  NET.status = 'connecting';
  NET.links = [];
  NET.opponents = [];
  renderNetPanel();

  NET.peerOpened = false;
  const peer = new Peer(undefined, { config: ICE_CONFIG });
  NET.peer = peer;
  netKeepAlive(peer);

  // 신호 서버까지 닿았는지에 따라 안내를 달리 준다.
  netFailAfterTimeout(() =>
    NET.peerOpened
      ? '방장과 직접 연결하지 못했습니다. 회사나 학교 네트워크에서는 막히는 경우가 있습니다. 휴대폰 테더링 같은 다른 네트워크에서 시도해 보세요.'
      : '연결 서버에 닿지 못했습니다. 네트워크 상태를 확인하고 다시 시도해 주세요.');

  peer.on('open', () => {
    NET.peerOpened = true;
    const conn = peer.connect(PEER_ID_PREFIX + code, { reliable: true });
    NET.links = [{ conn, seat: null, profile: null }];
    conn.on('open', () => {
      netClearTimer();
      netSendTo(conn, { type: 'hello', profile: netMyProfile() });
    });
    conn.on('data', netGuestHandle);
    conn.on('close', netGuestHostGone);
    conn.on('error', netGuestHostGone);
  });

  peer.on('error', (err) => {
    netClearTimer();
    if (err && err.type === 'peer-unavailable') {
      NET.status = 'error';
      NET.errorMsg = '존재하지 않는 방 코드입니다.';
    } else {
      NET.status = 'error';
      NET.errorMsg = '연결 중 오류가 발생했습니다.';
    }
    renderNetPanel();
  });
}

function netGuestHandle(msg) {
  if (!msg || !msg.type) return;

  if (msg.type === 'welcome') {
    NET.seat = msg.seat;
    NET.roomSize = msg.roomSize;
    NET.status = 'waiting';
    renderNetPanel();
    return;
  }

  if (msg.type === 'lobby') {
    NET.lobby = Array.isArray(msg.names) ? msg.names.slice(0, 4).map((n) => String(n).slice(0, 12)) : [];
    NET.roomSize = msg.roomSize || NET.roomSize;
    renderNetPanel();
    return;
  }

  if (msg.type === 'init') {
    NET.seat = msg.seat;
    NET.status = 'active';
    chatSystem('대전이 시작되었습니다.');
    netSetOpponentsFrom(msg.profiles);
    netApplyRemoteState(msg.state);
    renderNetPanel();
    return;
  }

  if (msg.type === 'state') {
    netApplyRemoteState(msg.state);
    return;
  }

  if (msg.type === 'chat') {
    chatReceive(msg);
    return;
  }

  if (msg.type === 'full') {
    NET.status = 'error';
    NET.errorMsg = '방이 가득 찼습니다.';
    netCleanupPeer();
    renderNetPanel();
    return;
  }

  if (msg.type === 'peerLeft') {
    const who = msg.name || '참가자';
    const left = !!msg.left;
    if (left) statsRecordWalkover(); // 연결을 정리하기 전에 기록한다
    chatSystem(left ? `${who}님이 대전에서 나갔습니다.` : `${who}님의 연결이 끊어졌습니다.`);
    NET.status = 'error';
    NET.errorMsg = left
      ? `${who}님이 나가서 게임을 종료합니다. 부전승으로 기록했습니다.`
      : `${who}님의 연결이 끊어져 게임을 종료합니다.`;
    netCleanupPeer();
    renderNetPanel();
  }
}

function netGuestHostGone() {
  if (NET.mode !== 'online' || NET.status === 'error' || NET.status === 'idle') return;
  chatSystem('방장과의 연결이 끊어졌습니다.');
  NET.status = 'error';
  NET.errorMsg = '방장과의 연결이 끊어졌습니다.';
  netCleanupPeer();
  renderNetPanel();
}

// ============ 로비 ============
function netUpdateLobby() {
  if (NET.role !== 'host') return;
  const names = [netMyProfile().name].concat(NET.links.map((l) => (l.profile ? l.profile.name : '접속 중...')));
  NET.lobby = names;
  netBroadcast({ type: 'lobby', names, roomSize: NET.roomSize });
  renderNetPanel();
}

// ============ 정리 ============
// delayClose를 주면 연결을 바로 닫지 않고 잠시 뒤에 닫는다.
// "나갑니다"를 보내자마자 닫으면 그 메시지가 전송되기 전에 끊겨서,
// 상대가 자발적 퇴장인지 회선 장애인지 구분하지 못한다.
function netCleanupPeer(delayClose) {
  netClearTimer();
  const conns = NET.links.map((link) => link.conn);
  const peer = NET.peer;
  const closeAll = () => {
    conns.forEach((conn) => {
      try {
        conn.close();
      } catch (e) {
        /* noop */
      }
    });
    if (peer) {
      try {
        peer.destroy();
      } catch (e) {
        /* noop */
      }
    }
  };
  if (delayClose) setTimeout(closeAll, 400);
  else closeAll();
  NET.links = [];
  NET.peer = null;
  NET.role = null;
  NET.roomCode = null;
  NET.seat = null;
  NET.opponents = [];
  NET.lobby = [];
}

// 대전 중에 나가면 그 판은 패배로 남는다. 나가기 전에 한 번 묻는다.
// 로비에서 나가거나 판이 이미 끝났으면 그냥 나간다.
function netLeavingCostsGame() {
  return NET.mode === 'online' && NET.status === 'active' && G && !G.gameOver;
}

function netLeaveRequested() {
  if (!netLeavingCostsGame()) {
    netLeaveRoom();
    return;
  }
  askConfirm({
    title: '대전에서 나가시겠습니까?',
    body: '진행 중인 판은 패배로 기록됩니다.',
    okLabel: '나가기 (패배 처리)',
    onOk: () => {
      statsRecordForfeit();
      netLeaveRoom();
    },
  });
}

function netLeaveRoom() {
  if (NET.role === 'host') netBroadcast({ type: 'peerLeft', name: netMyProfile().name, left: true });
  else netSendToHost({ type: 'left' });
  netCleanupPeer(true); // 나간다는 알림이 나갈 때까지 기다렸다 끊는다
  NET.status = 'idle';
  NET.errorMsg = '';
  chatClear();
  renderNetPanel();
}

function netRetry() {
  netCleanupPeer();
  NET.status = 'idle';
  NET.errorMsg = '';
  chatClear();
  renderNetPanel();
}

function netSwitchMode(mode) {
  if (mode === NET.mode) return;
  // 대전 중에 싱글로 넘어가는 것도 나가는 것과 같다. 똑같이 묻는다.
  if (mode === 'single' && netLeavingCostsGame()) {
    askConfirm({
      title: '싱글 플레이로 넘어가시겠습니까?',
      body: '진행 중인 대전은 패배로 기록됩니다.',
      okLabel: '넘어가기 (패배 처리)',
      onOk: () => {
        statsRecordForfeit();
        netApplyMode(mode);
      },
    });
    return;
  }
  netApplyMode(mode);
}

function netApplyMode(mode) {
  if (window.AI) clearTimeout(AI.timer);
  if (mode === 'single') {
    if (NET.mode === 'online') netLeaveRoom();
    NET.mode = 'single';
    newGame();
  } else {
    NET.mode = 'online';
    NET.status = 'idle';
    newGame(selectedPlayerCount);
  }
  renderNetPanel();
  updateModeTabs();
}

// ============ 렌더링 ============
function updateModeTabs() {
  const singleBtn = document.getElementById('modeSingleBtn');
  const onlineBtn = document.getElementById('modeOnlineBtn');
  if (!singleBtn || !onlineBtn) return;
  singleBtn.classList.toggle('active', NET.mode === 'single');
  onlineBtn.classList.toggle('active', NET.mode === 'online');
  const gameArea = document.getElementById('gameArea');
  const netPanel = document.getElementById('netPanel');
  const bottomRow = document.getElementById('bottomRow');
  const log = document.getElementById('log');
  if (NET.mode === 'single') {
    gameArea.hidden = false;
    netPanel.hidden = true;
    if (bottomRow) bottomRow.hidden = false;
    if (log) log.hidden = false;
  } else {
    netPanel.hidden = false;
    const inGame = NET.status === 'active';
    gameArea.hidden = !inGame;
    // 대기방에서도 채팅은 써야 하므로 아래 줄은 로비부터 띄운다.
    if (bottomRow) bottomRow.hidden = !(inGame || NET.status === 'waiting');
    // 진행 기록은 판이 있을 때만 의미가 있다.
    if (log) log.hidden = !inGame;
  }
  updateCountPicker();
  updateNewGameButton();
}

// 인원은 싱글 플레이에서, 그리고 온라인에서는 방을 만들기 전에만 고를 수 있다.
function updateCountPicker() {
  const picker = document.getElementById('countPicker');
  if (!picker) return;
  const locked = NET.mode === 'online' && NET.status !== 'idle';
  picker.classList.toggle('locked', locked);
  picker.title = locked ? '방을 만든 뒤에는 인원을 바꿀 수 없습니다' : '';
  const shown = NET.mode === 'online' ? NET.roomSize : currentPlayerCount();
  picker.querySelectorAll('[data-count]').forEach((btn) => {
    btn.disabled = locked;
    btn.classList.toggle('active', Number(btn.dataset.count) === shown);
  });
}

function updateNewGameButton() {
  const btn = document.getElementById('newGameBtn');
  if (!btn) return;
  if (NET.mode === 'online') {
    btn.textContent = '재대결';
    btn.disabled = !(NET.status === 'active' && NET.role === 'host');
  } else {
    btn.textContent = '새 게임';
    btn.disabled = false;
  }
}

function renderNetPanel() {
  renderNetPanelBody();
  renderChat();
}

function renderNetPanelBody() {
  const el = document.getElementById('netPanel');
  if (!el) return;
  updateModeTabs();
  if (NET.mode !== 'online') {
    el.innerHTML = '';
    return;
  }

  if (!netAvailable()) {
    el.innerHTML = `<div class="net-box net-warn">
      이 화면에서는 온라인 대전을 사용할 수 없습니다. (온라인 대전용 스크립트를 불러오지 못했습니다)
      <br><button data-net-act="toSingle">싱글 플레이로 돌아가기</button>
    </div>`;
    return;
  }

  if (NET.status === 'idle') {
    el.innerHTML = `<div class="net-box">
      <div class="net-row">
        <button data-net-act="create">${selectedPlayerCount}인 방 만들기</button>
        <span class="net-or">또는</span>
        <input id="joinCodeInput" maxlength="4" placeholder="방 코드 4자리" autocomplete="off">
        <button data-net-act="join">참가하기</button>
      </div>
      <div class="net-sub">방 인원은 위의 "인원"에서 고른 뒤 방을 만들어 주세요.</div>
      <div class="net-sub"><button class="net-link" data-net-act="diag">연결이 안 되나요? 진단하기</button></div>
    </div>`;
    return;
  }

  if (NET.status === 'creating' || NET.status === 'connecting') {
    el.innerHTML = `<div class="net-box">
      <div>${NET.status === 'creating' ? '방을 만드는 중...' : '연결하는 중...'}</div>
      <div class="net-sub">잠시만 기다려 주세요. 오래 걸리면 취소하고 다시 시도해 보세요.</div>
      <button data-net-act="cancel">취소</button>
    </div>`;
    return;
  }

  if (NET.status === 'error') {
    el.innerHTML = `<div class="net-box net-warn">
      ${escapeHtml(NET.errorMsg)}
      <br><button data-net-act="retry">다시 시도</button>
      <button data-net-act="diag">진단하기</button>
    </div>`;
    return;
  }

  if (NET.status === 'diag') {
    const rows = DIAG.lines
      .map((l) => {
        const mark = l.ok === null ? '·' : l.ok ? '✓' : '✗';
        const cls = l.ok === null ? 'diag-wait' : l.ok ? 'diag-ok' : 'diag-bad';
        return `<li class="${cls}"><span class="diag-mark">${mark}</span>${escapeHtml(l.text)}</li>`;
      })
      .join('');
    el.innerHTML = `<div class="net-box">
      <div class="diag-title">연결 진단</div>
      <ul class="diag-list">${rows}</ul>
      ${DIAG.done ? `<div class="diag-verdict">${escapeHtml(DIAG.verdict || '')}</div>` : ''}
      ${DIAG.done ? '<button data-net-act="retry">돌아가기</button>' : ''}
    </div>`;
    return;
  }

  if (NET.status === 'waiting') {
    const joined = NET.lobby.length || 1;
    const roster = NET.lobby.length
      ? `<div class="lobby-list">${NET.lobby.map((n) => `<span class="lobby-chip">${escapeHtml(n)}</span>`).join('')}</div>`
      : '';
    if (NET.role === 'host') {
      el.innerHTML = `<div class="net-box">
        <div class="room-code-label">방 코드</div>
        <div class="room-code">${NET.roomCode}</div>
        ${roster}
        <div class="net-sub">${joined} / ${NET.roomSize}명 참가 · 이 코드를 상대에게 알려주세요.</div>
        <button data-net-act="leave">방 나가기</button>
      </div>`;
    } else {
      el.innerHTML = `<div class="net-box">
        <div class="room-code-label">방 코드 ${NET.roomCode}</div>
        ${roster}
        <div class="net-sub">${joined} / ${NET.roomSize}명 참가 · 방장이 시작하기를 기다리는 중...</div>
        <button data-net-act="leave">방 나가기</button>
      </div>`;
    }
    return;
  }

  if (NET.status === 'active') {
    const roleLabel = NET.role === 'host' ? '방장' : '참가자';
    el.innerHTML = `<div class="net-strip">
      온라인 ${NET.roomSize}인 대전 · 방 코드 <strong>${NET.roomCode}</strong> · 나: 플레이어 ${NET.seat + 1} (${roleLabel})
      <button class="net-leave" data-net-act="leave">나가기</button>
    </div>`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('modeSingleBtn').addEventListener('click', () => netSwitchMode('single'));
  document.getElementById('modeOnlineBtn').addEventListener('click', () => netSwitchMode('online'));

  document.getElementById('countPicker').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-count]');
    if (!btn || btn.disabled) return;
    selectedPlayerCount = Number(btn.dataset.count);
    if (NET.mode === 'online') {
      NET.roomSize = selectedPlayerCount;
      renderNetPanel();
    } else {
      newGame(selectedPlayerCount);
    }
    updateModeTabs();
  });

  document.getElementById('netPanel').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-net-act]');
    if (!btn) return;
    const act = btn.dataset.netAct;
    if (act === 'create') netCreateRoom();
    if (act === 'join') {
      const input = document.getElementById('joinCodeInput');
      netJoinRoom(input ? input.value : '');
    }
    if (act === 'leave') netLeaveRequested();
    if (act === 'retry') netRetry();
    if (act === 'cancel') netRetry();
    if (act === 'diag') netRunDiagnostics();
    if (act === 'toSingle') netSwitchMode('single');
  });

  document.getElementById('netPanel').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target && e.target.id === 'joinCodeInput') {
      netJoinRoom(e.target.value);
    }
  });

  updateModeTabs();
});
