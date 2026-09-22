'use strict';

// ============ 중계 서버 연결 ============
// WebRTC는 브라우저끼리 "직접" 연결하는 방식이라 회사·학교 네트워크에서 자주
// 막힌다. 여기서는 공개 MQTT 브로커를 중계로 써서, 일반 웹사이트 접속과 같은
// WebSocket 연결만으로 메시지를 주고받는다.
//
// net.js는 PeerJS의 Peer / DataConnection 모양에 맞춰 쓰여 있으므로, 같은
// 모양의 껍데기를 씌워 net.js와 게임 로직을 거의 그대로 둔다.

// 한 곳이 막히거나 죽어 있을 수 있으므로 여러 곳에 "동시에" 붙는다.
// 순서대로 하나만 고르면, 내 쪽에서는 1번이 되고 상대 쪽에서는 1번이 막혀
// 2번이 되는 경우에 서로 다른 서버에 앉아 영영 못 만난다. 전부에 붙어 두고
// 전부로 보내면, 한 곳이라도 겹치면 연결된다.
const RELAY_URLS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081',
];
const RELAY_ROOT = 'splendor-lite-v1';
const RELAY_CONNECT_MS = 8000; // 브로커 한 곳당 대기 시간
const RELAY_HELLO_MS = 9000; // 방장이 응답할 때까지 기다리는 시간

function relayAvailable() {
  return typeof mqtt !== 'undefined' && !!mqtt.connect;
}

function relayRandomId() {
  return 'p' + Math.random().toString(36).slice(2, 10);
}

// ---- 연결 하나 (PeerJS의 DataConnection 자리) ----
function RelayConnection(owner, remoteId) {
  const self = this;
  this.peer = remoteId;
  this.open = false;
  this._h = { open: [], data: [], close: [], error: [] };

  this.on = (evt, fn) => {
    if (self._h[evt]) self._h[evt].push(fn);
  };
  this._fire = (evt, arg) => {
    (self._h[evt] || []).forEach((fn) => {
      try {
        fn(arg);
      } catch (e) {
        console.error('[중계] 처리 중 오류', e);
      }
    });
  };
  this.send = (msg) => {
    if (!self.open) return;
    owner._publish(remoteId, { t: 'msg', d: msg });
  };
  this.close = () => {
    if (!self.open) return;
    self.open = false;
    owner._publish(remoteId, { t: 'bye' });
    owner._drop(remoteId);
    self._fire('close');
  };
}

// ---- 참가자 하나 (PeerJS의 Peer 자리) ----
function RelayPeer(wantId) {
  const self = this;
  this.id = wantId || relayRandomId();
  // 같은 방 코드를 쓰면 id가 겹칠 수 있다. "내가 보낸 것"을 가려내려면
  // id가 아니라 이 인스턴스만의 식별자를 써야 한다. (방 코드 중복 확인이
  // 바로 이 경우다 - id가 같은 상대에게 말을 걸어야 한다)
  this._nonce = relayRandomId();
  this.destroyed = false;
  this._h = { open: [], connection: [], error: [], disconnected: [], probeAck: [] };
  this._conns = {};
  this._clients = []; // 지금 살아 있는 브로커 연결들
  this._pending = 0; // 아직 결과를 모르는 브로커 수
  this._opened = false;
  this._seen = Object.create(null); // 여러 브로커로 같은 메시지가 오므로 걸러낸다
  this._seenOrder = [];

  this.on = (evt, fn) => {
    if (self._h[evt]) self._h[evt].push(fn);
  };
  this._fire = (evt, arg) => {
    (self._h[evt] || []).forEach((fn) => {
      try {
        fn(arg);
      } catch (e) {
        console.error('[중계] 처리 중 오류', e);
      }
    });
  };

  this._publish = (targetId, payload) => {
    if (!self._clients.length) return;
    const body = JSON.stringify(
      Object.assign({ from: self.id, n: self._nonce, i: relayRandomId() }, payload)
    );
    const topic = `${RELAY_ROOT}/${targetId}`;
    self._clients.forEach((c) => {
      try {
        c.publish(topic, body, { qos: 0 });
      } catch (e) {
        /* noop */
      }
    });
  };

  // 같은 메시지가 브로커 수만큼 들어오므로 한 번만 처리한다
  this._isDuplicate = (id) => {
    if (!id) return false;
    if (self._seen[id]) return true;
    self._seen[id] = true;
    self._seenOrder.push(id);
    if (self._seenOrder.length > 500) delete self._seen[self._seenOrder.shift()];
    return false;
  };

  this._drop = (remoteId) => {
    delete self._conns[remoteId];
  };

  this._onMessage = (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch (e) {
      return;
    }
    if (!msg || typeof msg.from !== 'string' || msg.n === self._nonce) return;
    if (self._isDuplicate(msg.i)) return;
    const from = msg.from;

    // 방 코드가 이미 쓰이고 있는지 확인하는 신호
    if (msg.t === 'probe') {
      self._publish(from, { t: 'probe-ack' });
      return;
    }
    if (msg.t === 'probe-ack') {
      self._fire('probeAck');
      return;
    }

    if (msg.t === 'hi') {
      // 누가 접속해 왔다. 연결을 만들고 응답한다.
      let conn = self._conns[from];
      if (!conn) {
        conn = new RelayConnection(self, from);
        self._conns[from] = conn;
      }
      self._publish(from, { t: 'hi-ack' });
      if (!conn.open) {
        conn.open = true;
        self._fire('connection', conn);
        conn._fire('open');
      }
      return;
    }

    const conn = self._conns[from];
    if (!conn) return;

    if (msg.t === 'hi-ack') {
      if (!conn.open) {
        conn.open = true;
        clearTimeout(conn._timer);
        conn._fire('open');
      }
      return;
    }
    if (msg.t === 'msg') {
      conn._fire('data', msg.d);
      return;
    }
    if (msg.t === 'bye') {
      if (conn.open) {
        conn.open = false;
        self._drop(from);
        conn._fire('close');
      }
    }
  };

  this._connectAll = () => {
    if (self.destroyed) return;
    self._clients = [];
    self._pending = RELAY_URLS.length;
    RELAY_URLS.forEach((url) => self._connectBroker(url));
  };

  // 한 곳이라도 살아나면 열린 것으로 보고, 전부 실패했을 때만 오류를 낸다
  this._brokerSettled = (client) => {
    self._pending -= 1;
    if (client) {
      self._clients.push(client);
      if (!self._opened) {
        self._opened = true;
        self._fire('open', self.id);
      }
      return;
    }
    if (self._pending <= 0 && !self._opened) self._fire('error', { type: 'server-error' });
  };

  this._connectBroker = (url) => {
    if (self.destroyed) return;
    let settled = false;
    let client;
    try {
      client = mqtt.connect(url, {
        clientId: 'sl-' + relayRandomId(),
        connectTimeout: RELAY_CONNECT_MS,
        reconnectPeriod: 0,
        clean: true,
      });
    } catch (e) {
      self._brokerSettled(null);
      return;
    }

    const fail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        client.end(true);
      } catch (e) {
        /* noop */
      }
      self._brokerSettled(null);
    };
    const timer = setTimeout(fail, RELAY_CONNECT_MS + 1000);

    client.on('connect', () => {
      if (settled || self.destroyed) return;
      client.subscribe(`${RELAY_ROOT}/${self.id}`, { qos: 0 }, (err) => {
        if (settled) return;
        if (err) {
          fail();
          return;
        }
        settled = true;
        clearTimeout(timer);
        self._brokerSettled(client);
      });
    });
    client.on('error', fail);
    client.on('message', (topic, payload) => self._onMessage(payload));
    // 붙어 있던 연결이 끊기면 목록에서 뺀다. 전부 끊기면 net.js가 다시 붙인다.
    client.on('close', () => {
      const i = self._clients.indexOf(client);
      if (i < 0) return;
      self._clients.splice(i, 1);
      if (!self._clients.length && !self.destroyed) self._fire('disconnected');
    });
  };

  // 상대에게 접속한다
  this.connect = (targetId) => {
    const conn = new RelayConnection(self, targetId);
    self._conns[targetId] = conn;
    const hello = () => self._publish(targetId, { t: 'hi' });
    hello();
    // 브로커 연결이 늦을 수 있으니 몇 번 더 두드린다
    conn._retry = setInterval(hello, 1500);
    conn._timer = setTimeout(() => {
      clearInterval(conn._retry);
      if (!conn.open) {
        self._drop(targetId);
        self._fire('error', { type: 'peer-unavailable' });
      }
    }, RELAY_HELLO_MS);
    const origOn = conn.on;
    conn.on = (evt, fn) => {
      origOn(evt, evt === 'open' ? (a) => {
        clearInterval(conn._retry);
        fn(a);
      } : fn);
    };
    return conn;
  };

  this.reconnect = () => {
    if (self.destroyed || self._clients.length) return;
    self._connectAll();
  };

  this.destroy = () => {
    self.destroyed = true;
    Object.keys(self._conns).forEach((k) => {
      const c = self._conns[k];
      clearTimeout(c._timer);
      clearInterval(c._retry);
    });
    self._conns = {};
    self._clients.forEach((c) => {
      try {
        c.end(true);
      } catch (e) {
        /* noop */
      }
    });
    self._clients = [];
  };

  // 방 코드가 이미 쓰이고 있는지 확인한다. 쓰이고 있으면 onTaken을 부른다.
  this.probe = (onTaken, onFree) => {
    let answered = false;
    self.on('probeAck', () => {
      if (answered) return; // 여러 명이 답할 수 있다
      answered = true;
      onTaken();
    });
    self._publish(self.id, { t: 'probe' });
    // 늦게 붙는 브로커에 방장이 앉아 있을 수 있으니 넉넉히 기다린다
    setTimeout(() => {
      if (!answered) onFree();
    }, 2500);
  };

  setTimeout(() => self._connectAll(), 0);
}

window.RelayPeer = RelayPeer;
window.relayAvailable = relayAvailable;
window.RELAY_URLS = RELAY_URLS;
