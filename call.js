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
const ui = {
  title: ['实时视频翻译', 'Live translation'],
  theySpeak: ['对方说', 'They speak'],
  myLanguage: ['我说的语言', 'My spoken language'],
  iSpeak: ['我说', 'I speak'],
  join: ['加入翻译通话', 'Join translation call'],
  permissions: ['加入时，浏览器会请求使用麦克风和摄像头。', 'Your browser will ask to use your microphone and camera.'],
  expandVideo: ['放大视频', 'Enlarge video'],
  shrinkVideo: ['缩小视频', 'Shrink video'],
  hideVideo: ['收起视频', 'Hide video'],
  showVideo: ['显示视频', 'Show video'],
  captions: ['实时翻译', 'Live captions'],
  emptyCaptions: ['接通后，双方说的话会显示在这里。', 'Both sides of the conversation will appear here.'],
  speakToStart: ['说一句话，译文就会显示在这里。', 'Start speaking to see the conversation here.'],
  follow: ['回到最新', 'Jump to latest'],
  mute: ['静音', 'Mute'],
  unmute: ['取消静音', 'Unmute'],
  cameraOff: ['关闭镜头', 'Camera off'],
  cameraOn: ['打开镜头', 'Camera on'],
  end: ['挂断', 'Hang up'],
  loading: ['正在读取邀请…', 'Loading invitation…'],
  choose: ['确认语言后加入通话', 'Confirm your spoken language to join'],
  waiting: ['等待对方接听…', 'Waiting for the host to answer…'],
  connecting: ['正在建立通话…', 'Connecting…'],
  connected: ['通话中', 'Connected'],
  reconnecting: ['正在恢复通话连接…', 'Reconnecting…'],
  interrupted: ['通话连接暂时中断', 'Connection interrupted'],
  ended: ['通话已结束', 'Call ended'],
  expired: ['邀请已失效，请让对方发送新的邀请。', 'This invitation has expired. Ask the host for a new one.'],
  used: ['邀请已使用，请让对方发送新的邀请。', 'This invitation has already been used. Ask the host for a new one.'],
  missingLink: ['请打开完整的邀请链接。', 'Open the full invitation link.'],
  browser: ['请复制邀请链接，用支持视频通话的浏览器打开。', 'Copy the invitation link and open it in a browser that supports video calls.'],
  allowMedia: ['请在浏览器的网站权限中允许麦克风和摄像头，再点加入。', 'Allow the microphone and camera in your browser’s site permissions, then try joining again.'],
  mediaUnavailable: ['无法使用麦克风或摄像头，请检查设备后重试。', 'Could not start the microphone or camera. Check your device and try again.'],
  requestFailed: ['暂时无法连接通话服务，请重试。', 'Could not reach the call service. Please try again.'],
  refreshInvite: ['暂时无法读取邀请，请刷新重试。', 'Could not load the invitation. Refresh the page to try again.'],
  meOriginal: ['我 · 原话', 'Me · Original'],
  otherTranslation: ['对方 · 译文', 'Other person · Translation'],
  original: ['原话', 'Original'],
  translation: ['译文', 'Translation'],
  recognizing: ['正在识别…', 'Recognizing speech…'],
  translating: ['正在翻译…', 'Translating…'],
  noTranslation: ['暂未获得译文', 'Translation unavailable'],
  asrReady: ['在线翻译已就绪', 'Translation ready'],
  asrConnecting: ['正在连接在线翻译…', 'Connecting translation…'],
  asrRecovering: ['正在恢复在线翻译…', 'Reconnecting translation…'],
  asrUnavailable: ['在线翻译暂不可用', 'Translation temporarily unavailable'],
};
let locale = /^zh\b/i.test(navigator.language) ? 0 : 1;
let statusKey = 'loading';
let asrStatus = '';
let latestCaption = null;
const text = key => ui[key][locale];
const label = (id, key) => {
  el(id).dataset.text = key;
  el(id).textContent = text(key);
};
const status = key => {
  statusKey = key;
  el('status').textContent = text(key);
};

function renderLocale() {
  document.documentElement.lang = locale === 0 ? 'zh-CN' : 'en';
  document.title = text('title');
  el('locale').textContent = locale === 0 ? 'English' : '简体中文';
  el('locale').setAttribute('aria-label', locale === 0 ? 'Switch to English' : '切换到简体中文');
  document.querySelectorAll('[data-text]').forEach(node => { node.textContent = text(node.dataset.text); });
  status(statusKey);
  renderAsr();
  messages.forEach(renderCaption);
  renderVideoCaption();
}

function renderAsr() {
  let key = 'asrConnecting';
  if (/双方.*已连接/.test(asrStatus)) key = 'asrReady';
  else if (/重试|重连/.test(asrStatus)) key = 'asrRecovering';
  else if (/不可用|拒绝|失败/.test(asrStatus)) key = 'asrUnavailable';
  el('asr').textContent = asrStatus ? text(key) : '';
}

el('locale').onclick = () => {
  const follow = atLatest();
  locale = 1 - locale;
  renderLocale();
  if (follow) scrollLatest();
};

function atLatest() {
  const list = el('messages');
  return list.scrollHeight - list.scrollTop - list.clientHeight < 24;
}

function scrollLatest() {
  const list = el('messages');
  list.scrollTop = list.scrollHeight;
  el('follow').hidden = true;
}

el('follow').onclick = scrollLatest;
el('messages').addEventListener('scroll', () => { if (atLatest()) el('follow').hidden = true; });

function renderCaption(entry) {
  const { frame } = entry;
  const mine = frame.speaker === 'guest';
  const progress = frame.final ? (frame.translated ? '' : 'noTranslation') :
    (frame.asr_final || frame.translated ? 'translating' : 'recognizing');
  const primary = mine ? frame.original : frame.translated;
  const secondary = mine ? frame.translated : frame.original;
  entry.label.textContent = text(mine ? 'meOriginal' : 'otherTranslation');
  entry.primary.textContent = primary || text(progress || 'recognizing');
  entry.secondary.hidden = !secondary || secondary === primary;
  entry.secondary.textContent = text(mine ? 'translation' : 'original') + ' · ' + secondary;
  entry.progress.hidden = !primary || !progress;
  entry.progress.textContent = progress ? text(progress) : '';
}

function renderVideoCaption() {
  const line = latestCaption && (latestCaption.speaker === 'guest' ? latestCaption.original : latestCaption.translated);
  const expanded = el('expandVideo').getAttribute('aria-expanded') === 'true';
  el('videoCaption').hidden = !expanded || !line;
  el('videoCaption').textContent = line || '';
}

function updateVideo(visible, expanded) {
  const follow = atLatest();
  el('video').hidden = !visible;
  el('expandVideo').hidden = !visible;
  el('expandVideo').setAttribute('aria-expanded', String(expanded));
  el('hideVideo').setAttribute('aria-expanded', String(visible));
  el('video').parentElement.classList.toggle('expanded', expanded);
  label('expandVideo', expanded ? 'shrinkVideo' : 'expandVideo');
  label('hideVideo', visible ? 'hideVideo' : 'showVideo');
  renderVideoCaption();
  if (follow) scrollLatest();
}

el('expandVideo').onclick = () => updateVideo(true, el('expandVideo').getAttribute('aria-expanded') !== 'true');
el('hideVideo').onclick = () => updateVideo(el('video').hidden, false);

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
  }).catch(() => { if (!stopped) status('interrupted'); });
  return sendQueue;
}

function sendLanguage(type, fields) {
  if (channel && channel.readyState === 'open') channel.send(JSON.stringify({ call_id: room, type, ...fields }));
}

function caption(frame) {
  const key = frame.speaker + ':' + frame.id;
  const list = el('messages');
  const follow = atLatest();
  let entry = messages.get(key);
  if (!entry) {
    const article = document.createElement('article');
    article.className = frame.speaker === 'guest' ? 'bubble mine' : 'bubble';
    entry = { article, label: document.createElement('small'), primary: document.createElement('p'),
      secondary: document.createElement('p'), progress: document.createElement('small') };
    entry.primary.className = 'primary';
    entry.secondary.className = 'secondary';
    entry.progress.className = 'progress';
    article.append(entry.label, entry.primary, entry.secondary, entry.progress);
    el('emptyCaptions').hidden = true;
    list.append(article);
    messages.set(key, entry);
    if (messages.size > 200) {
      const oldest = messages.keys().next().value;
      messages.get(oldest).article.remove();
      messages.delete(oldest);
    }
  }
  entry.frame = frame;
  renderCaption(entry);
  if (entry.article === list.lastElementChild) {
    latestCaption = frame;
    renderVideoCaption();
  }
  if (follow) scrollLatest();
  else el('follow').hidden = false;
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
      status('connected');
      label('emptyCaptions', 'speakToStart');
      asrStatus ||= '正在连接在线翻译…';
      renderAsr();
      sendLanguage('language', { language, revision });
    }
    if (peer.connectionState === 'disconnected' || peer.connectionState === 'failed') {
      status('reconnecting');
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
      if (frame.type === 'status') {
        asrStatus = frame.text;
        renderAsr();
      }
    };
  };
  status('connecting');
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

function end(key, notify = false) {
  if (stopped) return;
  stopped = true;
  if (notify && token) api('end', { payload: {}, keepalive: true }).catch(() => {});
  if (channel) channel.close();
  if (peer) peer.close();
  if (stream) stream.getTracks().forEach(track => track.stop());
  el('media').hidden = true;
  el('controls').hidden = true;
  el('emptyCaptions').hidden = true;
  asrStatus = '';
  renderAsr();
  el('join').disabled = true;
  el('language').disabled = true;
  status(key);
}

async function poll() {
  if (stopped) return;
  try {
    const data = await api('poll?after=' + cursor);
    if (stopped) return;
    if (data.state === 'ended') return end('ended');
    if (data.state === 'active' && !peer) await createPeer();
    for (const event of data.events) {
      await receive(event);
      cursor = event.seq;
    }
    failures = 0;
  } catch (error) {
    if (error.status === 410) return end(peer ? 'ended' : 'expired');
    if (error.status === 403 || ++failures >= 8) return end('interrupted', true);
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
    history.replaceState(null, '', location.pathname + location.search);
    el('local').srcObject = stream;
    el('liveLanguage').value = language;
    el('liveHostLanguage').textContent = el('hostLanguage').textContent;
    el('setup').hidden = true;
    el('media').hidden = false;
    el('captions').hidden = false;
    el('controls').hidden = false;
    document.body.classList.add('in-call');
    status('waiting');
    poll();
  } catch (error) {
    if (stream) stream.getTracks().forEach(track => track.stop());
    if (error.status === 409 || error.status === 410 || error.status === 403) end(error.status === 409 ? 'used' : 'expired');
    else {
      const permissionDenied = error.name === 'NotAllowedError' || error.name === 'SecurityError';
      status(permissionDenied ? 'allowMedia' : stream || error.status ? 'requestFailed' : 'mediaUnavailable');
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
el('end').onclick = () => end('ended', true);
window.addEventListener('pagehide', () => end('ended', true));
el('mute').onclick = () => {
  const track = stream.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  label('mute', track.enabled ? 'mute' : 'unmute');
};
el('camera').onclick = () => {
  const track = stream.getVideoTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  el('local').hidden = !track.enabled;
  label('camera', track.enabled ? 'cameraOff' : 'cameraOn');
};

async function loadInvite() {
  if (!invite) return status('missingLink');
  if (!navigator.mediaDevices || !window.RTCPeerConnection) return status('browser');
  try {
    const preview = await api('preview', { auth: inviteToken });
    el('hostLanguage').textContent = preview.language;
    for (const name of preview.languages) {
      el('language').add(new Option(name, name));
      el('liveLanguage').add(new Option(name, name));
    }
    el('language').value = preview.suggested;
    el('language').disabled = false;
    el('join').disabled = false;
    status('choose');
  } catch (error) {
    if (error.status === 403 || error.status === 410) status('expired');
    else if (error.status === 409) status('used');
    else status('refreshInvite');
  }
}
renderLocale();
loadInvite();
