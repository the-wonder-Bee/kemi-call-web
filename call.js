const el = id => document.getElementById(id);
const apiOrigin = document.querySelector('meta[name="kemi-call-api"]')?.content.trim() || location.origin;
const invite = /^#([\w-]{32})\.([\w-]{32})$/.exec(location.hash);
const restored = invite ? null : readGuestSession();
const room = invite?.[1] || restored?.room;
let inviteToken = invite && invite[2];
let token, stream, peer, channel, language, negotiation, videoSender;
let stopped = false;
let cursor = 0;
let revision = 1;
let pollTimer, polling = false, pollErrorSince;
let audioSender, microphoneRecovery = false, micEnabled = true, refreshMicrophone = false;
let cameraEnabled = false, cameraBusy = false, onlyTranslation = false, speechHealth = null;
let cameraUnavailable = false;
const guestSession = restored ? crypto.randomUUID() : null;
let rejoinSent = false;
let lastIceRestart = 0;
let pendingIce = [];
let sendQueue = Promise.resolve();
const messages = new Map();
const localized = {};
const ui = {
  title: ['实时视频翻译', 'Live translation'],
  theySpeak: ['对方说', 'They speak'],
  myLanguage: ['我说的语言', 'My spoken language'],
  iSpeak: ['我说', 'I speak'],
  join: ['加入翻译通话', 'Join translation call'],
  permissions: ['你的语音会发送给在线识别和翻译服务，用于生成字幕。摄像头可选。', 'Your speech is sent to online recognition and translation services to generate captions. The camera is optional.'],
  guestName: ['你的名字（选填）', 'Your name (optional)'],
  joinCamera: ['加入时打开摄像头', 'Turn on camera when joining'],
  cameraUnavailable: ['无法打开摄像头，仍可用语音翻译。', 'Camera unavailable. Speech translation still works.'],
  rejoin: ['返回通话', 'Rejoin call'],
  subtitleInterrupted: ['字幕连接已断开，请返回通话重连。', 'Captions disconnected. Rejoin to reconnect.'],
  captionOptions: ['字幕设置', 'Caption options'],
  onlyTranslation: ['仅看译文', 'Translations only'],
  largeCaptions: ['大字字幕', 'Larger captions'],
  saveCaptions: ['保存字幕', 'Save transcript'],
  interfaceLanguage: ['界面语言', 'Interface language'],
  myInput: ['我', 'Me'],
  peerInput: ['对方', 'Other person'],
  waitingSpeech: ['等待说话', 'Waiting for speech'],
  noAudio: ['未收到音频，请检查麦克风', 'No audio input. Check the microphone.'],
  noVoice: ['暂未检测到说话声', 'No speech detected yet'],
  noSpeechResult: ['有声音但未识别，请检查所选语言', 'Sound detected but no words recognized. Check the selected language.'],
  translationDelay: ['已收到原话，译文暂未返回', 'Speech recognized. Translation has not arrived.'],
  micMuted: ['已静音', 'Muted'],
  syncingLanguage: ['正在同步语言…', 'Syncing language…'],
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
  allowMedia: ['请在浏览器的网站权限中允许麦克风，再试一次。', 'Allow the microphone in your browser’s site permissions, then try again.'],
  mediaUnavailable: ['无法使用麦克风，请检查设备后重试。', 'Could not start the microphone. Check your device and try again.'],
  recoverMic: ['恢复麦克风', 'Restore microphone'],
  requestFailed: ['暂时无法连接通话服务，请重试。', 'Could not reach the call service. Please try again.'],
  refreshInvite: ['暂时无法读取邀请，请刷新重试。', 'Could not load the invitation. Refresh the page to try again.'],
  meOriginal: ['我 · 原话', 'Me · Original'],
  otherTranslation: ['对方 · 译文', 'Other person · Translation'],
  original: ['原话', 'Original'],
  translation: ['译文', 'Translation'],
  recognizing: ['正在识别…', 'Recognizing speech…'],
  translating: ['正在翻译…', 'Translating…'],
  noTranslation: ['暂未获得译文', 'Translation unavailable'],
  sentenceInterrupted: ['本句翻译中断，请重复确认', 'This sentence was interrupted. Please repeat or confirm it.'],
  asrReady: ['在线翻译已就绪', 'Translation ready'],
  asrConnecting: ['正在连接在线翻译…', 'Connecting translation…'],
  asrRecovering: ['正在恢复在线翻译…', 'Reconnecting translation…'],
  asrUnavailable: ['在线翻译暂不可用', 'Translation temporarily unavailable'],
};
const interfaceLanguages = {
  'zh-CN': '简体中文', 'zh-TW': '繁體中文', en: 'English', ja: '日本語',
  ko: '한국어', fr: 'Français', de: 'Deutsch', es: 'Español',
};
// Keep interface language independent from the language being spoken.
const additionalLocales = ['zh-TW', 'ja', 'ko', 'fr', 'de', 'es'];
const translations = {
  title: ['即時視訊翻譯','リアルタイム翻訳','실시간 영상 통역','Traduction en direct','Live-Übersetzung','Traducción en directo'],
  theySpeak: ['對方說','相手の言語','상대 언어','Langue de l’autre','Sprache der anderen Person','Idioma de la otra persona'],
  myLanguage: ['我說的語言','話す言語','내가 말하는 언어','Ma langue parlée','Meine gesprochene Sprache','Mi idioma hablado'],
  iSpeak: ['我說','自分','내 언어','Je parle','Ich spreche','Hablo'],
  join: ['加入翻譯通話','翻訳通話に参加','통역 통화 참여','Rejoindre l’appel','Anruf beitreten','Unirse a la llamada'],
  permissions: ['語音會傳送至線上辨識及翻譯服務以產生字幕。可不開啟相機。','字幕生成のため音声をオンラインの認識・翻訳サービスへ送信します。カメラは任意です。','자막을 만들기 위해 음성을 온라인 인식 및 번역 서비스로 전송합니다. 카메라는 선택 사항입니다.','Votre voix est envoyée aux services de reconnaissance et de traduction en ligne pour générer les sous-titres. La caméra est facultative.','Ihre Sprache wird zur Erstellung der Untertitel an Online-Dienste für Erkennung und Übersetzung gesendet. Die Kamera ist optional.','Tu voz se envía a servicios en línea de reconocimiento y traducción para generar subtítulos. La cámara es opcional.'],
  guestName: ['你的名字（選填）','名前（任意）','이름(선택)','Votre nom (facultatif)','Ihr Name (optional)','Tu nombre (opcional)'],
  joinCamera: ['加入時開啟相機','参加時にカメラをオン','참여할 때 카메라 켜기','Activer la caméra en rejoignant','Kamera beim Beitritt einschalten','Encender la cámara al unirse'],
  cameraUnavailable: ['無法開啟相機，仍可使用語音翻譯。','カメラを使えません。音声翻訳は利用できます。','카메라를 사용할 수 없지만 음성 통역은 가능합니다.','Caméra indisponible. La traduction vocale reste disponible.','Kamera nicht verfügbar. Sprachübersetzung bleibt verfügbar.','Cámara no disponible. Puedes seguir usando la traducción de voz.'],
  rejoin: ['返回通話','通話に再参加','통화 다시 참여','Rejoindre à nouveau','Erneut beitreten','Volver a la llamada'],
  subtitleInterrupted: ['字幕已中斷，請返回通話重新連線。','字幕が切断されました。通話に再参加してください。','자막 연결이 끊겼습니다. 통화에 다시 참여하세요.','Sous-titres déconnectés. Rejoignez à nouveau l’appel.','Untertitelverbindung unterbrochen. Treten Sie erneut bei.','Se desconectaron los subtítulos. Vuelve a unirte a la llamada.'],
  captionOptions: ['字幕設定','字幕設定','자막 설정','Options des sous-titres','Untertiteleinstellungen','Opciones de subtítulos'],
  onlyTranslation: ['只看譯文','訳文のみ','번역만 보기','Traductions seules','Nur Übersetzungen','Solo traducciones'],
  largeCaptions: ['放大字幕','字幕を拡大','큰 자막','Sous-titres agrandis','Größere Untertitel','Subtítulos más grandes'],
  saveCaptions: ['儲存字幕','字幕を保存','자막 저장','Enregistrer les sous-titres','Untertitel speichern','Guardar subtítulos'],
  interfaceLanguage: ['介面語言','表示言語','화면 언어','Langue de l’interface','Anzeigesprache','Idioma de la interfaz'],
  myInput: ['我','自分','나','Moi','Ich','Yo'],
  peerInput: ['對方','相手','상대','L’autre personne','Andere Person','Otra persona'],
  waitingSpeech: ['等待說話','発話を待っています','말하기 대기 중','En attente de parole','Warte auf Sprache','Esperando voz'],
  noAudio: ['未收到音訊，請檢查麥克風','音声が届いていません。マイクを確認してください。','음성이 없습니다. 마이크를 확인하세요.','Aucun son reçu. Vérifiez le microphone.','Kein Ton empfangen. Prüfen Sie das Mikrofon.','No se recibe audio. Comprueba el micrófono.'],
  noVoice: ['暫未偵測到說話聲','まだ発話を検出していません','아직 음성이 감지되지 않았습니다','Aucune parole détectée pour le moment','Noch keine Sprache erkannt','Aún no se detecta voz'],
  noSpeechResult: ['偵測到聲音，請確認選擇的語言','音は届いています。話す言語の設定を確認してください。','소리는 감지됩니다. 선택한 언어를 확인하세요.','Son détecté, parole non reconnue. Vérifiez la langue choisie.','Ton erkannt, keine Sprache erkannt. Prüfen Sie die Sprachauswahl.','Se detecta sonido, pero no palabras. Comprueba el idioma elegido.'],
  translationDelay: ['已辨識原話，譯文尚未傳回','音声認識済み。翻訳はまだ届いていません。','음성을 인식했으나 번역이 아직 없습니다.','Parole reconnue. Traduction en attente.','Sprache erkannt. Übersetzung steht noch aus.','Voz reconocida. La traducción aún no ha llegado.'],
  micMuted: ['已靜音','ミュート中','음소거됨','Micro coupé','Stummgeschaltet','Silenciado'],
  syncingLanguage: ['正在同步語言…','言語を同期中…','언어 동기화 중…','Synchronisation de la langue…','Sprache wird synchronisiert…','Sincronizando idioma…'],
  expandVideo: ['放大視訊','映像を拡大','영상 확대','Agrandir la vidéo','Video vergrößern','Ampliar vídeo'],
  shrinkVideo: ['縮小視訊','映像を縮小','영상 축소','Réduire la vidéo','Video verkleinern','Reducir vídeo'],
  hideVideo: ['收起視訊','映像を隠す','영상 숨기기','Masquer la vidéo','Video ausblenden','Ocultar vídeo'],
  showVideo: ['顯示視訊','映像を表示','영상 표시','Afficher la vidéo','Video einblenden','Mostrar vídeo'],
  captions: ['即時翻譯','リアルタイム字幕','실시간 자막','Sous-titres en direct','Live-Untertitel','Subtítulos en directo'],
  emptyCaptions: ['接通後會在這裡顯示雙方對話。','通話がつながると両者の発言がここに表示されます。','연결되면 두 사람의 대화가 여기에 표시됩니다.','La conversation s’affichera ici après la connexion.','Nach dem Verbindungsaufbau erscheint das Gespräch hier.','La conversación aparecerá aquí al conectarse.'],
  speakToStart: ['開始說話即可看到翻譯。','話し始めると字幕が表示されます。','말을 시작하면 자막이 표시됩니다.','Parlez pour afficher les sous-titres.','Sprechen Sie, um Untertitel anzuzeigen.','Habla para ver los subtítulos.'],
  follow: ['回到最新','最新の字幕へ','최신 자막으로','Derniers sous-titres','Zu den neuesten Untertiteln','Ir al último subtítulo'],
  mute: ['靜音','ミュート','음소거','Couper le micro','Mikrofon stummschalten','Silenciar'],
  unmute: ['取消靜音','ミュート解除','음소거 해제','Rétablir le micro','Mikrofon einschalten','Activar micrófono'],
  cameraOff: ['關閉相機','カメラをオフ','카메라 끄기','Désactiver la caméra','Kamera ausschalten','Apagar cámara'],
  cameraOn: ['開啟相機','カメラをオン','카메라 켜기','Activer la caméra','Kamera einschalten','Encender cámara'],
  end: ['掛斷','通話を終了','통화 종료','Raccrocher','Auflegen','Colgar'],
  loading: ['正在讀取邀請…','招待を読み込み中…','초대 불러오는 중…','Chargement de l’invitation…','Einladung wird geladen…','Cargando invitación…'],
  choose: ['確認語言後加入通話','話す言語を確認して参加してください','말할 언어를 확인하고 참여하세요','Confirmez votre langue pour rejoindre','Bestätigen Sie Ihre Sprache, um beizutreten','Confirma tu idioma para unirte'],
  waiting: ['等待對方接聽…','相手の応答を待っています…','상대방 응답 대기 중…','En attente de réponse…','Warte auf Antwort…','Esperando respuesta…'],
  connecting: ['正在建立通話…','接続中…','연결 중…','Connexion…','Verbindung wird hergestellt…','Conectando…'],
  connected: ['通話中','通話中','통화 중','Appel en cours','Verbunden','En llamada'],
  reconnecting: ['正在重新連線…','再接続中…','다시 연결 중…','Reconnexion…','Erneute Verbindung…','Reconectando…'],
  interrupted: ['通話暫時中斷','通話が中断されました','통화가 일시 중단되었습니다','Appel interrompu','Anruf unterbrochen','Llamada interrumpida'],
  ended: ['通話已結束','通話が終了しました','통화가 종료되었습니다','Appel terminé','Anruf beendet','Llamada finalizada'],
  expired: ['邀請已過期，請索取新邀請。','招待の期限が切れました。新しい招待を依頼してください。','초대가 만료되었습니다. 새 초대를 요청하세요.','Invitation expirée. Demandez une nouvelle invitation.','Einladung abgelaufen. Bitten Sie um eine neue Einladung.','La invitación ha caducado. Pide una nueva.'],
  used: ['邀請已使用，請索取新邀請。','この招待は使用済みです。新しい招待を依頼してください。','이미 사용된 초대입니다. 새 초대를 요청하세요.','Invitation déjà utilisée. Demandez une nouvelle invitation.','Einladung bereits verwendet. Bitten Sie um eine neue.','La invitación ya se usó. Pide una nueva.'],
  missingLink: ['請開啟完整的邀請連結。','完全な招待リンクを開いてください。','전체 초대 링크를 열어 주세요.','Ouvrez le lien d’invitation complet.','Öffnen Sie den vollständigen Einladungslink.','Abre el enlace de invitación completo.'],
  browser: ['請用支援視訊通話的瀏覽器開啟邀請。','ビデオ通話に対応したブラウザーで招待を開いてください。','영상 통화를 지원하는 브라우저에서 초대를 여세요.','Ouvrez l’invitation dans un navigateur compatible avec les appels vidéo.','Öffnen Sie die Einladung in einem Browser mit Unterstützung für Videoanrufe.','Abre la invitación en un navegador compatible con videollamadas.'],
  allowMedia: ['請允許網站使用麥克風，再試一次。','サイトのマイクの使用を許可して、もう一度試してください。','사이트에 마이크 권한을 허용한 후 다시 시도하세요.','Autorisez le microphone pour ce site, puis réessayez.','Erlauben Sie dieser Website den Mikrofonzugriff und versuchen Sie es erneut.','Permite el acceso al micrófono para este sitio y vuelve a intentarlo.'],
  mediaUnavailable: ['無法使用麥克風，請檢查後重試。','マイクを使えません。確認してからやり直してください。','마이크를 사용할 수 없습니다. 확인 후 다시 시도하세요.','Microphone indisponible. Vérifiez-le et réessayez.','Mikrofon nicht verfügbar. Prüfen Sie es und versuchen Sie es erneut.','Micrófono no disponible. Compruébalo y vuelve a intentarlo.'],
  recoverMic: ['恢復麥克風','マイクを復旧','마이크 복구','Réactiver le microphone','Mikrofon wiederherstellen','Restaurar micrófono'],
  requestFailed: ['無法連線，請重試。','接続できません。もう一度試してください。','연결할 수 없습니다. 다시 시도하세요.','Connexion impossible. Réessayez.','Verbindung fehlgeschlagen. Versuchen Sie es erneut.','No se pudo conectar. Vuelve a intentarlo.'],
  refreshInvite: ['無法讀取邀請，請重新整理。','招待を読み込めません。ページを更新してください。','초대를 불러올 수 없습니다. 새로고침하세요.','Impossible de charger l’invitation. Actualisez la page.','Einladung konnte nicht geladen werden. Laden Sie die Seite neu.','No se pudo cargar la invitación. Recarga la página.'],
  meOriginal: ['我 · 原話','自分 · 原文','나 · 원문','Moi · Original','Ich · Original','Yo · Original'],
  otherTranslation: ['對方 · 譯文','相手 · 訳文','상대 · 번역','L’autre · Traduction','Andere Person · Übersetzung','Otra persona · Traducción'],
  original: ['原話','原文','원문','Original','Original','Original'],
  translation: ['譯文','訳文','번역','Traduction','Übersetzung','Traducción'],
  recognizing: ['正在辨識…','音声認識中…','음성 인식 중…','Reconnaissance…','Spracherkennung…','Reconociendo…'],
  translating: ['正在翻譯…','翻訳中…','번역 중…','Traduction…','Übersetzung läuft…','Traduciendo…'],
  noTranslation: ['目前沒有譯文','訳文がありません','번역문이 없습니다','Traduction indisponible','Keine Übersetzung verfügbar','Traducción no disponible'],
  sentenceInterrupted: ['本句翻譯中斷，請重複確認','この文の翻訳が中断されました。もう一度確認してください。','이 문장의 번역이 중단되었습니다. 다시 확인해 주세요.','Cette phrase a été interrompue. Répétez-la ou confirmez-la.','Dieser Satz wurde unterbrochen. Bitte wiederholen oder bestätigen.','Esta frase se interrumpió. Repítela o confírmala.'],
  asrReady: ['線上翻譯已就緒','オンライン翻訳の準備完了','온라인 번역 준비 완료','Traduction prête','Übersetzung bereit','Traducción lista'],
  asrConnecting: ['正在連線線上翻譯…','翻訳サービスに接続中…','온라인 번역 연결 중…','Connexion à la traduction…','Übersetzungsdienst wird verbunden…','Conectando con la traducción…'],
  asrRecovering: ['正在恢復翻譯…','翻訳サービスに再接続中…','온라인 번역 다시 연결 중…','Reconnexion à la traduction…','Erneute Verbindung zur Übersetzung…','Reconectando con la traducción…'],
  asrUnavailable: ['線上翻譯暫不可用','翻訳サービスを一時的に利用できません','온라인 번역을 일시적으로 사용할 수 없습니다','Traduction temporairement indisponible','Übersetzung vorübergehend nicht verfügbar','Traducción temporalmente no disponible'],
};
for (const [index, id] of additionalLocales.entries()) {
  localized[id] = Object.fromEntries(Object.entries(translations).map(([key, values]) => [key, values[index]]));
}
const browserLanguage = navigator.language.toLowerCase();
let locale = browserLanguage.startsWith('zh') ?
  (/hant|tw|hk|mo/.test(browserLanguage) ? 'zh-TW' : 'zh-CN') : browserLanguage.split('-')[0];
if (!(locale in interfaceLanguages)) locale = 'en';
for (const [id, name] of Object.entries(interfaceLanguages)) el('locale').add(new Option(name, id));
let statusKey = 'loading';
let asrStatus = '';
let latestCaption = null;
const text = key => localized[locale]?.[key] || ui[key][locale === 'zh-CN' || locale === 'zh-TW' ? 0 : 1];
const label = (id, key) => {
  const element = el(id);
  if ('iconLabel' in element.dataset) {
    element.dataset.iconLabel = key;
    element.setAttribute('aria-label', text(key));
    element.title = text(key);
  } else {
    element.dataset.text = key;
    element.textContent = text(key);
  }
};
const status = key => {
  statusKey = key;
  el('status').textContent = text(key);
};

function renderLocale() {
  document.documentElement.lang = locale;
  document.title = text('title');
  el('locale').value = locale;
  el('locale').setAttribute('aria-label', text('interfaceLanguage'));
  document.querySelectorAll('[data-text]').forEach(node => { node.textContent = text(node.dataset.text); });
  document.querySelectorAll('[data-icon-label]').forEach(node => label(node.id, node.dataset.iconLabel));
  status(statusKey);
  renderAsr();
  messages.forEach(renderCaption);
  renderVideoCaption();
}

function renderAsr() {
  if (speechHealth) {
    const statusKeys = {
      CONNECTING: 'asrConnecting', LISTENING: 'waitingSpeech', RECOGNIZING: 'recognizing',
      TRANSLATING: 'translating', NO_AUDIO: 'noAudio', NO_VOICE: 'noVoice', NO_RESULT: 'noSpeechResult',
      TRANSLATION_DELAY: 'translationDelay', UNAVAILABLE: 'asrUnavailable', MUTED: 'micMuted',
    };
    const mine = text(statusKeys[micEnabled ? speechHealth.guest : 'MUTED'] || 'asrConnecting');
    const other = text(statusKeys[speechHealth.host] || 'asrConnecting');
    const summary = text('myInput') + ' · ' + mine + ' / ' + text('peerInput') + ' · ' + other;
    if (el('asr').textContent !== summary) el('asr').textContent = summary;
    return;
  }
  let key = 'asrConnecting';
  if (/双方.*已连接/.test(asrStatus)) key = 'asrReady';
  else if (/重试|重连/.test(asrStatus)) key = 'asrRecovering';
  else if (/不可用|拒绝|失败/.test(asrStatus)) key = 'asrUnavailable';
  el('asr').textContent = asrStatus ? text(key) : '';
}

el('locale').onchange = () => {
  const follow = atLatest();
  locale = el('locale').value;
  renderLocale();
  if (follow) scrollLatest();
};

function atLatest() {
  const list = el('messages');
  return list.scrollHeight - list.scrollTop - list.clientHeight < 24;
}

let followCaptions = true;
let manualScrollUntil = 0;
function scrollLatest() {
  const list = el('messages');
  followCaptions = true;
  list.scrollTop = list.scrollHeight;
  el('follow').hidden = true;
}

el('follow').onclick = scrollLatest;
for (const event of ['wheel', 'touchmove', 'pointerdown', 'keydown']) {
  el('messages').addEventListener(event, () => { manualScrollUntil = Date.now() + 1200; }, { passive: true });
}
el('messages').addEventListener('scroll', () => {
  if (atLatest()) {
    followCaptions = true;
    el('follow').hidden = true;
  } else if (Date.now() < manualScrollUntil) followCaptions = false;
});

function renderCaption(entry) {
  const { frame } = entry;
  const mine = frame.speaker === 'guest';
  const progress = frame.interrupted ? 'sentenceInterrupted' : frame.final ? (frame.translated ? '' : 'noTranslation') :
    (frame.asr_final || frame.translated ? 'translating' : 'recognizing');
  const primary = mine && !onlyTranslation ? frame.original : frame.interrupted ? '' : frame.translated;
  const secondary = mine ? frame.translated : frame.original;
  const spokenLanguage = frame.source_language ? ' · ' + frame.source_language : '';
  entry.label.textContent = text(mine ? (onlyTranslation ? 'myInput' : 'meOriginal') : 'otherTranslation') + spokenLanguage;
  entry.primary.textContent = primary || text(progress || 'recognizing');
  entry.secondary.hidden = onlyTranslation || !secondary || secondary === primary;
  entry.secondary.textContent = text(mine ? 'translation' : 'original') + ' · ' + secondary;
  entry.progress.hidden = !primary || !progress;
  entry.progress.textContent = progress ? text(progress) : '';
  entry.article.classList.toggle('provisional', !frame.final);
  entry.article.title = [frame.source_language, frame.target_language].filter(Boolean).join(' → ');
}

el('captionOptions').onclick = () => {
  el('captionSettings').hidden = !el('captionSettings').hidden;
  el('captionOptions').setAttribute('aria-expanded', String(!el('captionSettings').hidden));
};
el('onlyTranslation').onchange = () => {
  const follow = atLatest();
  onlyTranslation = el('onlyTranslation').checked;
  document.body.classList.toggle('translations-only', onlyTranslation);
  messages.forEach(renderCaption);
  renderVideoCaption();
  if (follow) scrollLatest();
};
el('largeCaptions').onchange = () => {
  const follow = atLatest();
  el('captions').classList.toggle('large-captions', el('largeCaptions').checked);
  if (follow) scrollLatest();
};

function renderVideoCaption() {
  const line = latestCaption && (latestCaption.speaker === 'guest' && !onlyTranslation ? latestCaption.original : latestCaption.translated);
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
  setIcon('expandVideo', expanded ? 'shrink' : 'expand');
  setIcon('hideVideo', visible ? 'hide' : 'window');
  renderVideoCaption();
  if (follow) scrollLatest();
}

function setIcon(id, icon) {
  el(id).querySelector('use').setAttribute('href', '#icon-' + icon);
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
      try { await api('signal', { payload: event }); return true; }
      catch (error) { if (attempt === 2) throw error; }
    }
    return false;
  }).catch(() => { if (!stopped) status('interrupted'); return false; });
  return sendQueue;
}

function sendLanguage(type, fields) {
  if (channel && channel.readyState === 'open') channel.send(JSON.stringify({ call_id: room, type, ...fields }));
}

function caption(frame) {
  const key = frame.speaker + ':' + frame.id;
  const list = el('messages');
  const follow = followCaptions;
  let entry = messages.get(key);
  if (entry?.frame?.final && !frame.final) return;
  const newSentence = !entry;
  const finalized = frame.final && !entry?.frame?.final;
  if (!entry) {
    const article = document.createElement('article');
    article.className = frame.speaker === 'guest' ? 'bubble mine' : 'bubble';
    entry = { article, label: document.createElement('small'), primary: document.createElement('p'),
      secondary: document.createElement('p'), progress: document.createElement('small') };
    entry.primary.className = 'primary';
    entry.secondary.className = 'secondary';
    entry.progress.className = 'progress';
    entry.label.hidden = latestCaption?.speaker === frame.speaker &&
      latestCaption.source_language === frame.source_language && latestCaption.target_language === frame.target_language;
    article.append(entry.label, entry.primary, entry.secondary, entry.progress);
    el('emptyCaptions').hidden = true;
    list.append(article);
    messages.set(key, entry);
    if (messages.size > 1000) {
      const oldest = messages.keys().next().value;
      messages.get(oldest).article.remove();
      messages.delete(oldest);
    }
  }
  entry.frame = frame;
  renderCaption(entry);
  if (frame.final && frame.translated) sendLanguage('caption_ack', { id: frame.id });
  if (entry.article === list.lastElementChild) {
    latestCaption = frame;
    renderVideoCaption();
  }
  if (follow && (newSentence || finalized)) scrollLatest();
  else if (!follow && (newSentence || finalized)) el('follow').hidden = false;
}

async function createPeer() {
  const { data } = await api('ice');
  if (stopped) return;
  peer = new RTCPeerConnection({ iceServers: data.ice_servers });
  audioSender = peer.addTrack(stream.getAudioTracks()[0], stream);
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
      lastIceRestart = 0;
      status('connected');
      el('rejoin').hidden = true;
      label('emptyCaptions', 'speakToStart');
      asrStatus ||= '正在连接在线翻译…';
      renderAsr();
      sendLanguage('language', { language, revision });
    }
    if (peer.connectionState === 'disconnected' || peer.connectionState === 'failed') {
      status('reconnecting');
      if (peer.connectionState === 'failed') requestIceRestart();
    }
  };
  peer.ondatachannel = ({ channel: incoming }) => {
    if (incoming.label !== 'call-language-v1') { incoming.close(); return; }
    channel = incoming;
    incoming.onopen = () => {
      el('rejoin').hidden = true;
      el('liveLanguage').disabled = false;
      sendLanguage('language', { language, revision });
      sendLanguage('media_state', { microphone: micEnabled, camera: cameraEnabled });
    };
    incoming.onclose = () => {
      if (stopped || channel !== incoming) return;
      speechHealth = null;
      asrStatus = '';
      renderAsr();
      status('subtitleInterrupted');
      el('rejoin').hidden = false;
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
      if (frame.type === 'ack' && frame.revision === revision) {
        el('liveLanguage').disabled = false;
        if (statusKey === 'syncingLanguage') status('connected');
      }
      if (frame.type === 'caption') caption(frame);
      if (frame.type === 'status') {
        asrStatus = frame.text;
        renderAsr();
      }
      if (frame.type === 'speech_health') {
        speechHealth = frame;
        renderAsr();
      }
    };
  };
  status('connecting');
}

function requestIceRestart() {
  if (document.hidden || !negotiation || Date.now() - lastIceRestart < 5000) return;
  lastIceRestart = Date.now();
  signal('webrtc.restart.request', { negotiation_id: negotiation });
}

function readGuestSession() {
  const id = history.state?.kemiRoom;
  if (typeof id !== 'string' || !/^[\w-]{32}$/.test(id)) return null;
  try {
    const saved = JSON.parse(sessionStorage.getItem('kemi-call:' + id));
    return saved?.room === id && /^[\w-]{32}$/.test(saved.token) ? saved : null;
  } catch { return null; }
}

function persistGuestSession() {
  if (!room || !token) return false;
  try {
    sessionStorage.setItem('kemi-call:' + room, JSON.stringify({
      room, token, language, revision, micEnabled, cameraEnabled,
      hostLanguage: el('liveHostLanguage').textContent,
      languages: [...el('liveLanguage').options].map(option => option.value),
    }));
    return true;
  } catch { return false; }
}

function forgetGuestSession() {
  try { sessionStorage.removeItem('kemi-call:' + room); } catch { /* storage can be blocked */ }
}

function observeMicrophone(track) {
  track?.addEventListener('ended', () => {
    if (track !== stream?.getAudioTracks()[0] || stopped) return;
    refreshMicrophone = true;
    restoreMicrophone();
  });
}

async function restoreMicrophone() {
  if (stopped || document.hidden || microphoneRecovery || !stream || !micEnabled) return;
  microphoneRecovery = true;
  el('recoverMic').hidden = true;
  let replacement;
  try {
    const fresh = await navigator.mediaDevices.getUserMedia({ audio: true });
    replacement = fresh.getAudioTracks()[0];
    if (!replacement) throw new Error('No microphone track');
    if (stopped || document.hidden) return;
    replacement.enabled = micEnabled;
    const previous = stream.getAudioTracks()[0];
    if (audioSender) await audioSender.replaceTrack(replacement);
    if (stopped) return;
    replacement.enabled = micEnabled;
    if (previous) {
      stream.removeTrack(previous);
      previous.stop();
    }
    stream.addTrack(replacement);
    observeMicrophone(replacement);
    replacement = null;
    refreshMicrophone = false;
  } catch {
    if (!stopped && !document.hidden && micEnabled) el('recoverMic').hidden = false;
  } finally {
    replacement?.stop();
    microphoneRecovery = false;
  }
}

function resumeCall() {
  if (!token || stopped || document.hidden) return;
  pollErrorSince = undefined;
  schedulePoll(0);
  if (peer && ['disconnected', 'failed'].includes(peer.connectionState)) requestIceRestart();
  for (const id of ['remote', 'local']) {
    const video = el(id);
    if (video.srcObject && video.paused) video.play().catch(() => {});
  }
  sendLanguage('language', { language, revision });
  if (refreshMicrophone) restoreMicrophone();
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    refreshMicrophone = true;
    clearTimeout(pollTimer);
  } else resumeCall();
});
window.addEventListener('pageshow', event => {
  if (event.persisted) resumeCall();
});

async function receive(event) {
  const data = event.payload;
  if (event.type === 'webrtc.offer') {
    if (guestSession && !negotiation && data.guest_session !== guestSession) return;
    negotiation = data.negotiation_id;
    await peer.setRemoteDescription({ type: 'offer', sdp: data.sdp });
    // Reserve send capability on the video section actually offered by the translator.
    const video = peer.getTransceivers().find(section => section.mid !== null && section.receiver.track.kind === 'video');
    if (video && video.sender !== videoSender) {
      video.direction = 'sendrecv';
      videoSender = video.sender;
      videoSender.setStreams?.(stream);
      await videoSender.replaceTrack(stream.getVideoTracks()[0] || null);
    }
    for (const candidate of pendingIce) {
      if (candidate.negotiation_id === negotiation) await addIce(candidate);
    }
    pendingIce = [];
    await peer.setLocalDescription(await peer.createAnswer());
    await signal('webrtc.answer', { negotiation_id: negotiation, sdp: peer.localDescription.sdp });
  }
  if (event.type === 'webrtc.ice' && data.candidate) {
    if (negotiation === data.negotiation_id) await addIce(data);
    else {
      if (pendingIce.length === 128) pendingIce.shift();
      pendingIce.push(data);
    }
  }
}
async function addIce(data) {
  await peer.addIceCandidate({ candidate: data.candidate, sdpMid: data.sdp_mid || null,
    sdpMLineIndex: data.sdp_mline_index });
}

function end(key, notify = false) {
  if (stopped) return;
  stopped = true;
  clearTimeout(pollTimer);
  forgetGuestSession();
  if (notify && token) api('end', { payload: {}, keepalive: true }).catch(() => {});
  if (channel) channel.close();
  if (peer) peer.close();
  if (stream) stream.getTracks().forEach(track => track.stop());
  el('media').hidden = true;
  el('controls').hidden = true;
  el('recoverMic').hidden = true;
  el('rejoin').hidden = true;
  prepareTranscriptDownload();
  el('emptyCaptions').hidden = true;
  asrStatus = '';
  speechHealth = null;
  renderAsr();
  el('join').disabled = true;
  el('language').disabled = true;
  status(key);
}

function schedulePoll(delay = 400) {
  clearTimeout(pollTimer);
  if (!stopped && !document.hidden) pollTimer = setTimeout(poll, delay);
}

async function poll() {
  if (stopped || polling || document.hidden) return;
  polling = true;
  try {
    const data = await api('poll?after=' + cursor);
    if (stopped || document.hidden) return;
    if (data.state === 'ended') return end('ended');
    if (data.state === 'active' && !peer) await createPeer();
    if (data.state === 'active' && guestSession && !rejoinSent) {
      rejoinSent = await signal('webrtc.restart.request', { guest_session: guestSession });
    }
    for (const event of data.events) {
      await receive(event);
      cursor = event.seq;
    }
    if (pollErrorSince && peer?.connectionState === 'connected') status('connected');
    pollErrorSince = undefined;
    if (peer && ['disconnected', 'failed'].includes(peer.connectionState)) requestIceRestart();
  } catch (error) {
    if (stopped || document.hidden) return;
    if (error.status === 410) return end(peer ? 'ended' : 'expired');
    if (error.status === 403) return end('interrupted');
    pollErrorSince ??= Date.now();
    status('reconnecting');
    if (Date.now() - pollErrorSince >= 30_000) {
      status('interrupted');
      el('rejoin').hidden = false;
    }
  } finally {
    polling = false;
    schedulePoll();
  }
}

async function captureGuest(wantsCamera) {
  const microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
  if (!wantsCamera) return microphone;
  try {
    const camera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
    camera.getVideoTracks().forEach(track => microphone.addTrack(track));
  } catch {
    cameraUnavailable = true;
  }
  return microphone;
}

function showCall(hostLanguage) {
  cameraEnabled = stream.getVideoTracks().some(track => track.readyState === 'live');
  const microphone = stream.getAudioTracks()[0];
  microphone.enabled = micEnabled;
  observeMicrophone(microphone);
  el('local').srcObject = stream;
  el('liveLanguage').value = language;
  el('liveHostLanguage').textContent = hostLanguage;
  el('setup').hidden = true;
  el('media').hidden = false;
  el('captions').hidden = false;
  el('controls').hidden = false;
  el('rejoin').hidden = true;
  document.body.classList.add('in-call');
  renderMediaControls();
  persistGuestSession();
  status(cameraUnavailable ? 'cameraUnavailable' : 'waiting');
  poll();
}

async function join() {
  el('join').disabled = true;
  el('language').disabled = true;
  language = el('language').value;
  try {
    cameraUnavailable = false;
    stream = await captureGuest(el('joinCamera').checked);
    if (stopped) { stream.getTracks().forEach(track => track.stop()); return; }
    const result = await api('join', { auth: inviteToken, payload: { language, name: el('guestName').value.trim() } });
    token = result.token;
    inviteToken = undefined;
    history.replaceState({ kemiRoom: room }, '', location.pathname + location.search);
    showCall(el('hostLanguage').textContent);
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

let restoringSession = false;
async function rejoin() {
  if (!restored || restoringSession || stopped) return;
  restoringSession = true;
  el('rejoin').hidden = true;
  el('setup').hidden = true;
  status('reconnecting');
  try {
    const snapshot = await api('poll?after=0', { auth: restored.token });
    if (snapshot.state === 'ended') return end('ended');
    cameraUnavailable = false;
    stream = await captureGuest(restored.cameraEnabled);
    token = restored.token;
    language = restored.language;
    revision = Number.isSafeInteger(restored.revision) ? restored.revision : 1;
    micEnabled = restored.micEnabled !== false;
    const available = snapshot.languages || restored.languages;
    for (const name of available) el('liveLanguage').add(new Option(name, name));
    showCall(snapshot.language || restored.hostLanguage);
  } catch (error) {
    if (error.status === 403 || error.status === 410) return end('ended');
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') status('allowMedia');
    else status('requestFailed');
    el('rejoin').hidden = false;
  } finally {
    restoringSession = false;
  }
}
el('join').onclick = join;
el('liveLanguage').onchange = () => {
  language = el('liveLanguage').value;
  revision++;
  el('liveLanguage').disabled = true;
  status('syncingLanguage');
  persistGuestSession();
  sendLanguage('language', { language, revision });
};
el('end').onclick = () => end('ended', true);
window.addEventListener('pagehide', event => {
  if (event.persisted) refreshMicrophone = true;
  else if (token && !stopped && !persistGuestSession()) end('ended', true);
});
el('recoverMic').onclick = restoreMicrophone;
el('rejoin').onclick = () => stream && token ? location.reload() : rejoin();
function renderMediaControls() {
  el('mute').setAttribute('aria-pressed', String(!micEnabled));
  el('mute').classList.toggle('is-off', !micEnabled);
  setIcon('mute', micEnabled ? 'mic' : 'mic-off');
  label('mute', micEnabled ? 'mute' : 'unmute');
  el('camera').setAttribute('aria-pressed', String(cameraEnabled));
  el('camera').classList.toggle('is-off', !cameraEnabled);
  setIcon('camera', cameraEnabled ? 'video' : 'video-off');
  label('camera', cameraEnabled ? 'cameraOff' : 'cameraOn');
  el('local').hidden = !cameraEnabled;
  sendLanguage('media_state', { microphone: micEnabled, camera: cameraEnabled });
}
el('mute').onclick = () => {
  const track = stream.getAudioTracks()[0];
  micEnabled = !micEnabled;
  if (track) track.enabled = micEnabled;
  renderMediaControls();
  renderAsr();
  persistGuestSession();
  if (!micEnabled) el('recoverMic').hidden = true;
  else if (refreshMicrophone || track?.readyState !== 'live' || track?.muted) restoreMicrophone();
};
el('camera').onclick = async () => {
  if (cameraBusy || stopped) return;
  cameraBusy = true;
  el('camera').disabled = true;
  let fresh;
  try {
    if (cameraEnabled) {
      const old = stream.getVideoTracks()[0];
      if (videoSender) await videoSender.replaceTrack(null);
      if (old) { old.stop(); stream.removeTrack(old); }
      cameraEnabled = false;
    } else {
      const camera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      fresh = camera.getVideoTracks()[0];
      if (stopped) return;
      if (videoSender) await videoSender.replaceTrack(fresh);
      if (stopped) return;
      stream.addTrack(fresh);
      cameraEnabled = true;
      fresh = null;
      if (statusKey === 'cameraUnavailable') status(peer?.connectionState === 'connected' ? 'connected' : 'waiting');
    }
  } catch { status('cameraUnavailable'); }
  finally {
    fresh?.stop();
    cameraBusy = false;
    el('camera').disabled = false;
    renderMediaControls();
    if (!stopped) persistGuestSession();
  }
};

function prepareTranscriptDownload() {
  const lines = [...messages.values()].filter(({ frame }) => frame.final || frame.interrupted).map(({ frame }) =>
    text(frame.speaker === 'guest' ? 'myInput' : 'peerInput') + '\n' +
      text('original') + ' · ' + frame.original + '\n' + text('translation') + ' · ' +
      (frame.interrupted ? text('sentenceInterrupted') : frame.translated));
  if (!lines.length) return;
  const download = el('saveCaptions');
  download.href = URL.createObjectURL(new Blob([lines.join('\n\n')], { type: 'text/plain;charset=utf-8' }));
  download.hidden = false;
}

async function loadInvite() {
  if (!navigator.mediaDevices || !window.RTCPeerConnection) return status('browser');
  if (restored) return rejoin();
  if (!invite) return status('missingLink');
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
