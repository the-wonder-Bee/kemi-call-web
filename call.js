const el = id => document.getElementById(id);
const apiOrigin = document.querySelector('meta[name="kemi-call-api"]')?.content.trim() || location.origin;
const invite = /^#([\w-]{32})\.([\w-]{32})$/.exec(location.hash);
const room = invite && invite[1];
let inviteToken = invite && invite[2];
let token, stream, peer, channel, language, negotiation;
let stopped = false;
let cursor = 0;
let revision = 1;
let failures = 0;
let pendingIce = [];
let sendQueue = Promise.resolve();
const messages = new Map();
const status = message => { el('status').textContent = message; };

async function api(action, { auth = token, payload, keepalive = false } = {}) {
  const controller = keepalive ? null : new AbortController();
  const timeout = controller ? setTimeout(() => controller.abort(), 6000) : null;
  try {
    const response = await fetch(new URL('/rooms/' + room + '/' + action, apiOrigin), {
      method: payload === undefined ? 'GET' : 'POST',
      headers: { Authorization: 'Bearer ' + auth, 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: controller ? controller.signal : undefined,
      keepalive,
    });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.message), { status: response.status });
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function signal(type, payload) {
  const eventId = Array.from(crypto.getRandomValues(new Uint8Array(16)),
    byte => byte.toString(16).padStart(2, '0')).join('');
  const event = { type, payload, event_id: eventId };
  sendQueue = sendQueue.then(async () => {
    for (let attempt = 0; attempt < 3 && !stopped; attempt++) {
      try { await api('signal', { payload: event }); return; }
      catch (error) { if (attempt === 2) throw error; }
    }
  }).catch(() => { if (!stopped) status('信令发送失败 / Connection interrupted'); });
  return sendQueue;
}

function sendLanguage(type, fields) {
  if (channel && channel.readyState === 'open') channel.send(JSON.stringify({ call_id: room, type, ...fields }));
}

function caption(frame) {
  const key = frame.speaker + ':' + frame.id;
  const list = el('messages');
  const follow = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  let entry = messages.get(key);
  if (!entry) {
    const article = document.createElement('article');
    article.className = frame.speaker === 'guest' ? 'bubble mine' : 'bubble';
    const label = document.createElement('small');
    label.textContent = frame.speaker === 'guest' ? '我 / Me' : '对方 / Other';
    entry = { article, original: document.createElement('p'), translated: document.createElement('p') };
    article.append(label, entry.original, entry.translated);
    list.append(article);
    messages.set(key, entry);
    if (messages.size > 200) {
      const oldest = messages.keys().next().value;
      messages.get(oldest).article.remove();
      messages.delete(oldest);
    }
  }
  entry.original.textContent = frame.original;
  entry.translated.textContent = frame.translated === frame.original ? '' : frame.translated;
  if (follow) list.scrollTop = list.scrollHeight;
}

async function createPeer() {
  const { data } = await api('ice');
  if (stopped) return;
  peer = new RTCPeerConnection({ iceServers: data.ice_servers });
  stream.getTracks().forEach(track => peer.addTrack(track, stream));
  const remote = new MediaStream();
  el('remote').srcObject = remote;
  peer.ontrack = event => remote.addTrack(event.track);
  peer.onicecandidate = ({ candidate }) => {
    if (!negotiation || !candidate) return;
    signal('webrtc.ice', { negotiation_id: negotiation, candidate: candidate.candidate,
      sdp_mid: candidate.sdpMid, sdp_mline_index: candidate.sdpMLineIndex });
  };
  peer.onconnectionstatechange = () => {
    if (stopped) return;
    if (peer.connectionState === 'connected') {
      status('视频通话中 / Connected');
      sendLanguage('language', { language, revision });
    }
    if (peer.connectionState === 'disconnected' || peer.connectionState === 'failed') {
      status('正在恢复连接 / Reconnecting…');
      if (peer.connectionState === 'failed') signal('webrtc.restart.request', { negotiation_id: negotiation });
    }
  };
  peer.ondatachannel = ({ channel: incoming }) => {
    if (incoming.label !== 'call-language-v1') { incoming.close(); return; }
    channel = incoming;
    incoming.onopen = () => {
      el('liveLanguage').disabled = false;
      sendLanguage('language', { language, revision });
    };
    incoming.onmessage = ({ data: raw }) => {
      let frame;
      try { frame = JSON.parse(raw); } catch { return; }
      if (frame.call_id !== room) return;
      if (frame.type === 'language') {
        el('liveHostLanguage').textContent = frame.language;
        sendLanguage('ack', { revision: frame.revision });
        sendLanguage('language', { language, revision });
      }
      if (frame.type === 'ack' && frame.revision === revision) el('liveLanguage').disabled = false;
      if (frame.type === 'caption') caption(frame);
      if (frame.type === 'status') el('asr').textContent = frame.text;
    };
  };
  el('captions').hidden = false;
  status('正在建立通话 / Connecting…');
}

async function receive(event) {
  const data = event.payload;
  if (event.type === 'webrtc.offer') {
    negotiation = data.negotiation_id;
    await peer.setRemoteDescription({ type: 'offer', sdp: data.sdp });
    for (const candidate of pendingIce) {
      if (candidate.negotiation_id === negotiation) await addIce(candidate);
    }
    pendingIce = [];
    await peer.setLocalDescription(await peer.createAnswer());
    await signal('webrtc.answer', { negotiation_id: negotiation, sdp: peer.localDescription.sdp });
  }
  if (event.type === 'webrtc.ice' && data.candidate) {
    if (negotiation === data.negotiation_id) await addIce(data);
    else pendingIce.push(data);
  }
}
async function addIce(data) {
  await peer.addIceCandidate({ candidate: data.candidate, sdpMid: data.sdp_mid || null,
    sdpMLineIndex: data.sdp_mline_index });
}

function end(message, notify = false) {
  if (stopped) return;
  stopped = true;
  if (notify && token) api('end', { payload: {}, keepalive: true }).catch(() => {});
  if (channel) channel.close();
  if (peer) peer.close();
  if (stream) stream.getTracks().forEach(track => track.stop());
  el('media').hidden = true;
  el('join').disabled = true;
  el('language').disabled = true;
  status(message);
}

async function poll() {
  if (stopped) return;
  try {
    const data = await api('poll?after=' + cursor);
    if (stopped) return;
    if (data.state === 'ended') return end('通话已结束 / Call ended');
    if (data.state === 'active' && !peer) await createPeer();
    for (const event of data.events) {
      await receive(event);
      cursor = event.seq;
    }
    failures = 0;
  } catch (error) {
    if (error.status === 403 || error.status === 410 || ++failures >= 8) {
      return end('邀请已失效或连接已断开 / Invitation expired or connection lost', true);
    }
  }
  setTimeout(poll, 400);
}

async function join() {
  el('join').disabled = true;
  el('language').disabled = true;
  language = el('language').value;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: 'user' } });
    if (stopped) { stream.getTracks().forEach(track => track.stop()); return; }
    const result = await api('join', { auth: inviteToken, payload: { language } });
    token = result.token;
    inviteToken = undefined;
    history.replaceState(null, '', '/');
    el('local').srcObject = stream;
    el('liveLanguage').value = language;
    el('liveHostLanguage').textContent = el('hostLanguage').textContent;
    el('setup').hidden = true;
    el('media').hidden = false;
    status('等待对方接通 / Waiting for the host');
    poll();
  } catch (error) {
    if (stream) stream.getTracks().forEach(track => track.stop());
    const message = error.status ? error.message : '请允许摄像头和麦克风权限 / Enable camera and microphone access';
    if (error.status === 409 || error.status === 410) end(message);
    else {
      status(message);
      el('join').disabled = false;
      el('language').disabled = false;
    }
  }
}
el('join').onclick = join;
el('liveLanguage').onchange = () => {
  language = el('liveLanguage').value;
  revision++;
  el('liveLanguage').disabled = true;
  sendLanguage('language', { language, revision });
};
el('end').onclick = () => end('通话已结束 / Call ended', true);
window.addEventListener('pagehide', () => end('通话已结束 / Call ended', true));
el('mute').onclick = () => {
  const track = stream.getAudioTracks()[0];
  track.enabled = !track.enabled;
  el('mute').textContent = track.enabled ? '静音 / Mute' : '取消静音 / Unmute';
};
el('camera').onclick = () => {
  const track = stream.getVideoTracks()[0];
  track.enabled = !track.enabled;
  el('camera').textContent = track.enabled ? '关闭镜头 / Camera off' : '打开镜头 / Camera on';
};

async function loadInvite() {
  try {
    if (!invite) throw new Error('请打开完整的邀请链接 / Open the full invitation link');
    if (!navigator.mediaDevices || !window.RTCPeerConnection) {
      throw new Error('请用支持视频通话的浏览器打开 / Open in a browser with video call support');
    }
    const preview = await api('preview', { auth: inviteToken });
    el('hostLanguage').textContent = preview.language;
    for (const name of preview.languages) {
      el('language').add(new Option(name, name));
      el('liveLanguage').add(new Option(name, name));
    }
    el('language').value = preview.suggested;
    el('language').disabled = false;
    el('join').disabled = false;
    status('确认语言后加入通话 / Choose your language to join');
  } catch (error) {
    status(error.message);
  }
}
loadInvite();
