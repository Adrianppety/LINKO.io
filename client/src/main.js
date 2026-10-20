import { io } from 'socket.io-client';
import SimplePeer from 'simple-peer';
import './style.css';

const apiUrl = (import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:3000' : window.location.origin)).replace(/\/+$/, '');
const socket = io(apiUrl, { autoConnect: true, reconnection: true });
const app = {
  roomId: null,
  nickname: '',
  localStream: null,
  peers: new Map(),
  participants: new Map(),
  remoteStreams: new Map(),
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  screenTrack: null,
  screenStream: null,
  screenReplacedCamera: false,
  youtubePlayer: null,
  youtubeApiPromise: null,
  youtubeSuppressUntil: 0,
  youtubeState: null,
  lastYoutubeSample: null,
  isInRoom: false
};

document.querySelector('#app').innerHTML = `
  <main class="shell">
    <header class="topbar">
      <a class="brand" href="/" aria-label="Linko início"><img src="/linko-wordmark.png" alt="Linko" /></a>
      <div class="topbar-tools">
        <span class="topbar-note"><i></i> Salas temporárias, sem cadastro</span>
        <label class="theme-picker" for="theme-select"><span>Tema</span><select id="theme-select" aria-label="Tema visual"><option value="elegant-light">Claro</option><option value="elegant-dark">Escuro</option><option value="gamer">Gamer</option></select></label>
      </div>
    </header>
    <section class="home card" id="home">
      <div class="home-copy">
        <span class="eyebrow">PRESENÇA, MESMO DE LONGE</span>
        <h1>Seu grupo.<br /><em>Seu espaço.</em></h1>
        <p>Converse por voz e vídeo, compartilhe sua tela e assistam juntos.</p>
      </div>
      <form class="join-form" id="join-form">
        <label for="nickname">Como podemos chamar você?</label>
        <input id="nickname" name="nickname" maxlength="20" autocomplete="nickname" placeholder="Seu nome ou apelido" required />
        <button class="button primary" id="join-button" type="submit">Criar sala <span aria-hidden="true">↗</span></button>
        <p class="form-hint" id="room-hint">Até 10 pessoas por sala. Sem conta e sem senha.</p>
        <p class="error" id="home-error" role="alert"></p>
      </form>
    </section>
    <section class="room hidden" id="room">
      <header class="room-header card">
        <div class="room-title">
          <span class="eyebrow">SALA COMPARTILHADA</span>
          <h1 id="room-name">Sua sala</h1>
        </div>
        <div class="room-actions">
          <div class="share-link"><input id="room-link" aria-label="Link da sala" readonly /><button class="button secondary" id="copy-link">Copiar link</button></div>
          <button class="button leave" id="leave-room">Sair</button>
        </div>
      </header>
      <div class="room-layout">
        <section class="stage card">
          <div class="stage-heading">
            <div><h2>Participantes <span id="participant-count">1/10</span></h2><p id="connection-label">Conectando à sala…</p></div>
            <div class="connection-dot" id="connection-dot" aria-label="Estado da conexão"></div>
          </div>
          <div class="video-grid" id="video-grid">
            <article class="video-tile self-tile" id="self-tile">
              <video id="local-video" autoplay playsinline muted></video>
              <div class="video-empty" id="local-empty"><span class="avatar">Eu</span><span>Sua câmera está desligada</span></div>
              <span class="video-name" id="local-name"></span>
            </article>
          </div>
          <div class="toolbar">
            <div class="control-group">
              <button class="button control" id="mic-button" type="button" aria-pressed="false">Ativar microfone</button>
              <select id="audio-device" aria-label="Selecionar microfone"><option value="">Microfone padrão</option></select>
            </div>
            <div class="control-group">
              <button class="button control" id="camera-button" type="button" aria-pressed="false">Ligar câmera</button>
              <select id="video-device" aria-label="Selecionar câmera"><option value="">Câmera padrão</option></select>
            </div>
            <button class="button control" id="screen-button" type="button" aria-pressed="false">Compartilhar tela</button>
          </div>
          <p class="network-warning hidden" id="network-warning">TURN não configurado: redes restritas podem impedir a conexão de áudio e vídeo.</p>
        </section>
        <aside class="youtube card">
          <div class="youtube-heading"><div><span class="eyebrow">ASSISTAM JUNTOS</span><h2>YouTube</h2></div><span class="youtube-mark">▶</span></div>
          <form class="youtube-form" id="youtube-form">
            <label for="youtube-url">Link do vídeo</label>
            <div><input id="youtube-url" type="url" placeholder="Cole um link do YouTube" /><button class="button primary" type="submit">Assistir</button></div>
          </form>
          <div class="player-frame"><div id="youtube-player"></div><p id="youtube-placeholder">Cole um link para começar um vídeo com a sala.</p></div>
          <p class="youtube-note">Reprodução e busca sincronizadas entre participantes.</p>
        </aside>
      </div>
      <div class="toast hidden" id="toast" role="status"></div>
    </section>
  </main>`;

const $ = (selector) => document.querySelector(selector);
const home = $('#home');
const room = $('#room');
const homeError = $('#home-error');
const themes = new Set(['elegant-light', 'elegant-dark', 'gamer']);
const themeSelect = $('#theme-select');
const roomFromUrl = new URLSearchParams(window.location.search).get('room') || new URLSearchParams(window.location.search).get('roomId');

let savedTheme = 'elegant-light';
try {
  const preference = localStorage.getItem('linko-theme');
  if (themes.has(preference)) savedTheme = preference;
} catch (error) {
  console.warn('Não foi possível ler a preferência de tema:', error);
}
setTheme(savedTheme);
themeSelect.addEventListener('change', () => {
  if (!themes.has(themeSelect.value)) return;
  setTheme(themeSelect.value);
  try {
    localStorage.setItem('linko-theme', themeSelect.value);
  } catch (error) {
    console.warn('Não foi possível salvar a preferência de tema:', error);
  }
});

if (roomFromUrl) {
  $('#join-button').innerHTML = 'Entrar na sala <span aria-hidden="true">↗</span>';
  $('#room-hint').textContent = 'Digite seu nome para entrar. Você não precisa criar uma conta.';
}

$('#join-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const nickname = $('#nickname').value.trim();
  if (!nickname || nickname.length > 20) {
    homeError.textContent = 'Informe um nome ou apelido de até 20 caracteres.';
    return;
  }
  const button = $('#join-button');
  button.disabled = true;
  homeError.textContent = '';
  try {
    await loadIceServers();
    const eventName = roomFromUrl ? 'join-room' : 'create-room';
    const payload = roomFromUrl ? { roomId: roomFromUrl, nickname } : { nickname };
    const result = await socket.timeout(12_000).emitWithAck(eventName, payload);
    if (!result?.ok) throw new Error(result?.message || 'Não foi possível entrar na sala.');
    await activateRoom({ ...result, nickname });
  } catch (error) {
    homeError.textContent = error.message === 'timeout' ? 'O servidor não respondeu. Tente novamente.' : error.message;
  } finally {
    button.disabled = false;
  }
});

async function activateRoom(data) {
  app.roomId = data.roomId;
  app.nickname = data.nickname;
  app.isInRoom = true;
  app.localStream = new MediaStream();
  home.classList.add('hidden');
  room.classList.remove('hidden');
  $('#room-name').textContent = `Sala ${data.roomId.slice(0, 6)}`;
  $('#room-link').value = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(data.roomId)}`;
  $('#local-name').textContent = `${app.nickname} (você)`;
  $('#local-video').srcObject = app.localStream;
  app.participants = new Map([[socket.id, app.nickname], ...(data.participants || []).map((participant) => [participant.socketId, participant.nickname])]);
  renderParticipants();
  history.replaceState({}, '', `?room=${encodeURIComponent(data.roomId)}`);
  enumerateDevices();
  if (data.youtubeState) applyYoutubeState(data.youtubeState);
  for (const participant of data.participants || []) createPeer(participant.socketId, false);
}

socket.on('connect', () => {
  setConnection(true, 'Sinalização conectada');
  if (app.isInRoom && app.roomId) rejoinRoom();
});
socket.on('disconnect', () => {
  setConnection(false, 'Reconectando…');
  closePeers();
});
socket.on('connect_error', () => setConnection(false, 'Sem conexão com o servidor'));
socket.on('user-connected', (participant) => {
  if (!app.isInRoom || !participant?.socketId) return;
  app.participants.set(participant.socketId, participant.nickname);
  renderParticipants();
  createPeer(participant.socketId, true);
});
socket.on('user-disconnected', ({ socketId }) => {
  removePeer(socketId);
  app.participants.delete(socketId);
  renderParticipants();
});
socket.on('signal', ({ from, signal }) => {
  const peer = app.peers.get(from);
  if (peer && signal) peer.signal(signal);
});
socket.on('youtube-control', (state) => applyYoutubeState(state));

function setConnection(connected, label) {
  $('#connection-label').textContent = label;
  $('#connection-dot').classList.toggle('online', connected);
}

function renderParticipants() {
  const grid = $('#video-grid');
  for (const tile of grid.querySelectorAll('.remote-tile')) {
    if (!app.participants.has(tile.dataset.socketId)) tile.remove();
  }
  for (const [socketId, nickname] of app.participants) {
    if (socketId === socket.id || grid.querySelector(`.remote-tile[data-socket-id="${CSS.escape(socketId)}"]`)) continue;
    const tile = document.createElement('article');
    tile.className = 'video-tile remote-tile';
    tile.dataset.socketId = socketId;
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    const empty = document.createElement('div');
    empty.className = 'video-empty';
    empty.innerHTML = `<span class="avatar">${escapeHtml(nickname.slice(0, 2).toUpperCase())}</span><span>Aguardando mídia…</span>`;
    const name = document.createElement('span');
    name.className = 'video-name';
    name.textContent = nickname;
    tile.append(video, empty, name);
    grid.append(tile);
  }
  $('#participant-count').textContent = `${app.participants.size}/10`;
  $('#local-empty').classList.toggle('hidden', hasActiveLocalVideo());
}

function escapeHtml(value) {
  const element = document.createElement('span');
  element.textContent = value;
  return element.innerHTML;
}

function createPeer(socketId, initiator) {
  if (app.peers.has(socketId) || !app.localStream) return;
  const peer = new SimplePeer({
    initiator,
    trickle: true,
    config: { iceServers: app.iceServers }
  });
  app.peers.set(socketId, peer);
  for (const track of app.localStream.getAudioTracks()) peer.addTrack(track, app.localStream);
  const cameraTrack = app.localStream.getVideoTracks()[0];
  if (app.screenTrack) {
    if (app.screenReplacedCamera && cameraTrack) {
      peer.addTrack(cameraTrack, app.localStream);
      peer.replaceTrack(cameraTrack, app.screenTrack, app.localStream);
    } else {
      peer.addTrack(app.screenTrack, app.screenStream);
    }
  } else if (cameraTrack) {
    peer.addTrack(cameraTrack, app.localStream);
  }
  peer.on('signal', (signal) => socket.emit('signal', { targetSocketId: socketId, signal }));
  peer.on('stream', (stream) => {
    const tile = $(`.remote-tile[data-socket-id="${CSS.escape(socketId)}"]`);
    if (!tile) return;
    let combinedStream = app.remoteStreams.get(socketId);
    if (!combinedStream) {
      combinedStream = new MediaStream();
      app.remoteStreams.set(socketId, combinedStream);
      combinedStream.addEventListener('removetrack', () => {
        const hasVideo = combinedStream.getVideoTracks().some((track) => track.readyState === 'live');
        tile.querySelector('.video-empty')?.classList.toggle('hidden', hasVideo);
      });
    }
    for (const track of stream.getTracks()) {
      if (!combinedStream.getTracks().some((current) => current.id === track.id)) combinedStream.addTrack(track);
    }
    tile.querySelector('video').srcObject = combinedStream;
    const hasVideo = combinedStream.getVideoTracks().some((track) => track.readyState === 'live');
    tile.querySelector('.video-empty').classList.toggle('hidden', hasVideo);
  });
  peer.on('connect', () => setConnection(true, 'Conectado à sala'));
  peer.on('close', () => app.peers.delete(socketId));
  peer.on('error', (error) => {
    console.warn('WebRTC peer error:', error.message);
    setConnection(false, 'Tentando restabelecer mídia…');
  });
}

function removePeer(socketId) {
  const peer = app.peers.get(socketId);
  app.peers.delete(socketId);
  if (peer && !peer.destroyed) peer.destroy();
  app.participants.delete(socketId);
  app.remoteStreams.delete(socketId);
  $(`.remote-tile[data-socket-id="${CSS.escape(socketId)}"]`)?.remove();
  $('#participant-count').textContent = `${app.participants.size}/10`;
}

function closePeers() {
  for (const peer of app.peers.values()) if (!peer.destroyed) peer.destroy();
  app.peers.clear();
}

async function rejoinRoom() {
  try {
    const result = await socket.timeout(12_000).emitWithAck('join-room', { roomId: app.roomId, nickname: app.nickname });
    if (!result?.ok) throw new Error(result?.message || 'A sala foi encerrada.');
    app.participants = new Map([[socket.id, app.nickname], ...result.participants.map((participant) => [participant.socketId, participant.nickname])]);
    renderParticipants();
    for (const participant of result.participants) createPeer(participant.socketId, false);
    setConnection(true, 'Conectado à sala');
  } catch (error) {
    showToast(error.message);
    leaveRoom(false);
  }
}

$('#copy-link').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#room-link').value);
    showToast('Link copiado. Convide até 9 pessoas.');
  } catch {
    $('#room-link').select();
    document.execCommand('copy');
    showToast('Link copiado.');
  }
});

$('#leave-room').addEventListener('click', () => leaveRoom(true));
function leaveRoom(notifyServer) {
  app.isInRoom = false;
  if (notifyServer && socket.connected) socket.emit('leave-room');
  closePeers();
  stopScreenShare();
  for (const track of app.localStream?.getTracks() || []) track.stop();
  app.localStream = null;
  app.roomId = null;
  app.participants.clear();
  app.youtubePlayer?.stopVideo();
  room.classList.add('hidden');
  home.classList.remove('hidden');
  history.replaceState({}, '', window.location.pathname);
  $('#nickname').value = '';
}

$('#mic-button').addEventListener('click', () => toggleMedia('audio'));
$('#camera-button').addEventListener('click', () => toggleMedia('video'));
$('#audio-device').addEventListener('change', (event) => switchDevice('audio', event.target.value).catch((error) => showToast(mediaError(error))));
$('#video-device').addEventListener('change', (event) => switchDevice('video', event.target.value).catch((error) => showToast(mediaError(error))));

async function toggleMedia(kind) {
  const track = app.localStream?.getTracks().find((item) => item.kind === kind);
  try {
    if (!track) await switchDevice(kind, kind === 'audio' ? $('#audio-device').value : $('#video-device').value);
    else {
      track.enabled = !track.enabled;
      updateMediaControls();
    }
  } catch (error) {
    showToast(mediaError(error));
  }
}

async function switchDevice(kind, deviceId) {
  if (!app.localStream) return;
  const constraints = kind === 'audio'
    ? { audio: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }
    : { audio: false, video: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 60 } } };
  const freshStream = await navigator.mediaDevices.getUserMedia(constraints);
  const nextTrack = freshStream.getTracks()[0];
  if (!nextTrack) return;
  if (kind === 'video') nextTrack.contentHint = 'motion';
  const previous = app.localStream.getTracks().find((track) => track.kind === kind);
  try {
    for (const peer of app.peers.values()) {
      if (kind === 'video' && app.screenTrack) {
        if (previous && app.screenReplacedCamera) {
          peer.replaceTrack(app.screenTrack, nextTrack, app.localStream);
          peer.replaceTrack(nextTrack, app.screenTrack, app.localStream);
        }
      } else if (previous) {
        peer.replaceTrack(previous, nextTrack, app.localStream);
      } else {
        peer.addTrack(nextTrack, app.localStream);
      }
    }
  } catch (error) {
    nextTrack.stop();
    throw error;
  }
  if (previous) {
    app.localStream.removeTrack(previous);
    previous.stop();
  }
  app.localStream.addTrack(nextTrack);
  freshStream.removeTrack(nextTrack);
  updateMediaControls();
  await enumerateDevices();
}

function updateMediaControls() {
  const audioTrack = app.localStream?.getAudioTracks()[0];
  const videoTrack = app.localStream?.getVideoTracks()[0];
  const audioOn = Boolean(audioTrack?.enabled);
  const videoOn = Boolean(videoTrack?.enabled);
  $('#mic-button').textContent = audioOn ? 'Desligar microfone' : audioTrack ? 'Ligar microfone' : 'Ativar microfone';
  $('#camera-button').textContent = videoOn ? 'Desligar câmera' : videoTrack ? 'Ligar câmera' : 'Ativar câmera';
  $('#mic-button').classList.toggle('selected', audioOn);
  $('#camera-button').classList.toggle('selected', videoOn);
  $('#mic-button').setAttribute('aria-pressed', String(audioOn));
  $('#camera-button').setAttribute('aria-pressed', String(videoOn));
  $('#local-empty').classList.toggle('hidden', hasActiveLocalVideo());
}

function hasActiveLocalVideo() {
  return Boolean(app.screenTrack || app.localStream?.getVideoTracks().some((track) => track.enabled));
}

function mediaError(error) {
  if (error.name === 'NotAllowedError') return 'Permissão negada. Permita o acesso ao dispositivo e tente novamente.';
  if (error.name === 'NotFoundError') return 'Não foi encontrado um dispositivo compatível.';
  if (error.name === 'NotReadableError') return 'O dispositivo já está sendo usado por outro aplicativo.';
  return 'Não foi possível acessar o dispositivo. Verifique as permissões do navegador.';
}

async function enumerateDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    fillDevices($('#audio-device'), devices.filter((device) => device.kind === 'audioinput'), 'Microfone padrão');
    fillDevices($('#video-device'), devices.filter((device) => device.kind === 'videoinput'), 'Câmera padrão');
  } catch (error) {
    console.warn('Não foi possível listar dispositivos de mídia:', error);
  }
}

function fillDevices(select, devices, label) {
  const current = select.value;
  select.replaceChildren(new Option(label, ''));
  devices.forEach((device, index) => select.add(new Option(device.label || `${label} ${index + 1}`, device.deviceId)));
  if (devices.some((device) => device.deviceId === current)) select.value = current;
}

navigator.mediaDevices?.addEventListener?.('devicechange', enumerateDevices);

$('#screen-button').addEventListener('click', async () => {
  if (app.screenTrack) {
    stopScreenShare();
    return;
  }
  if (!navigator.mediaDevices?.getDisplayMedia) {
    showToast('Compartilhamento de tela não suportado neste navegador.');
    return;
  }
  try {
    app.screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: 1920, max: 3840 }, height: { ideal: 1080, max: 2160 }, frameRate: { ideal: 30, max: 60 } },
      audio: false
    });
    app.screenTrack = app.screenStream.getVideoTracks()[0];
    app.screenTrack.contentHint = 'detail';
    const cameraTrack = app.localStream?.getVideoTracks()[0];
    app.screenReplacedCamera = Boolean(cameraTrack);
    for (const peer of app.peers.values()) {
      if (cameraTrack) peer.replaceTrack(cameraTrack, app.screenTrack, app.localStream);
      else peer.addTrack(app.screenTrack, app.screenStream);
    }
    $('#local-video').srcObject = app.screenStream;
    $('#local-empty').classList.add('hidden');
    $('#screen-button').textContent = 'Parar compartilhamento';
    $('#screen-button').classList.add('selected');
    $('#screen-button').setAttribute('aria-pressed', 'true');
    app.screenTrack.addEventListener('ended', stopScreenShare, { once: true });
  } catch (error) {
    if (app.screenTrack) stopScreenShare();
    if (error.name !== 'NotAllowedError') showToast(mediaError(error));
  }
});

function stopScreenShare() {
  if (!app.screenTrack) return;
  const screenTrack = app.screenTrack;
  const cameraTrack = app.localStream?.getVideoTracks()[0];
  for (const peer of app.peers.values()) {
    if (app.screenReplacedCamera && cameraTrack) {
      peer.replaceTrack(screenTrack, cameraTrack, app.localStream);
    } else if (app.screenStream) {
      peer.removeTrack(screenTrack, app.screenStream);
      if (cameraTrack) peer.addTrack(cameraTrack, app.localStream);
    }
  }
  screenTrack.stop();
  app.screenStream = null;
  app.screenTrack = null;
  app.screenReplacedCamera = false;
  $('#local-video').srcObject = app.localStream;
  $('#screen-button').textContent = 'Compartilhar tela';
  $('#screen-button').classList.remove('selected');
  $('#screen-button').setAttribute('aria-pressed', 'false');
  $('#local-empty').classList.toggle('hidden', hasActiveLocalVideo());
}

$('#youtube-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const videoId = extractYoutubeId($('#youtube-url').value.trim());
  if (!videoId) {
    showToast('Cole um link válido de vídeo do YouTube.');
    return;
  }
  try {
    await ensureYoutubeApi();
    app.youtubePlayer.loadVideoById(videoId);
    $('#youtube-placeholder').classList.add('hidden');
    publishYoutube('load', videoId, 0);
  } catch (error) {
    console.error('YouTube IFrame API error:', error);
    showToast('Não foi possível carregar o player oficial do YouTube.');
  }
});

function extractYoutubeId(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const id = host === 'youtu.be'
      ? url.pathname.slice(1)
      : ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)
        ? url.searchParams.get('v')
        : null;
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function ensureYoutubeApi() {
  if (app.youtubePlayer) return Promise.resolve();
  if (app.youtubeApiPromise) return app.youtubeApiPromise;
  app.youtubeApiPromise = new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('YouTube API timeout')), 15_000);
    window.onYouTubeIframeAPIReady = () => {
      app.youtubePlayer = new window.YT.Player('youtube-player', {
        width: '100%',
        height: '100%',
        playerVars: { controls: 1, rel: 0, playsinline: 1 },
        events: {
          onReady: () => {
            clearTimeout(timeout);
            resolve();
          },
          onStateChange: (event) => {
            if (Date.now() < app.youtubeSuppressUntil || !app.roomId) return;
            if (event.data === window.YT.PlayerState.PLAYING) publishYoutube('play');
            else if (event.data === window.YT.PlayerState.PAUSED) publishYoutube('pause');
            else if (event.data === window.YT.PlayerState.ENDED) publishYoutube('pause');
          },
          onError: (event) => showToast(`O YouTube não conseguiu reproduzir este vídeo (código ${event.data}).`)
        }
      });
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('YouTube API failed to load'));
    };
    document.head.append(script);
  });
  return app.youtubeApiPromise;
}

window.setInterval(() => {
  if (!app.youtubePlayer || !app.roomId || Date.now() < app.youtubeSuppressUntil) return;
  const currentTime = app.youtubePlayer.getCurrentTime?.();
  if (!Number.isFinite(currentTime)) return;
  if (app.lastYoutubeSample !== null && Math.abs(currentTime - app.lastYoutubeSample) > 2.5) {
    publishYoutube('seek', undefined, currentTime);
  }
  app.lastYoutubeSample = currentTime;
}, 1000);

function publishYoutube(action, videoId, currentTime) {
  if (!app.roomId) return;
  const player = app.youtubePlayer;
  const state = {
    action,
    videoId: videoId || app.youtubeState?.videoId || null,
    currentTime: Number.isFinite(currentTime) ? currentTime : (player?.getCurrentTime?.() || 0)
  };
  app.youtubeState = { ...state, updatedAt: Date.now() };
  socket.emit('youtube-control', state);
}

async function applyYoutubeState(state) {
  if (!state?.videoId) {
    if (state?.action === 'stop') {
      app.youtubePlayer?.stopVideo();
      $('#youtube-placeholder').classList.remove('hidden');
    }
    app.youtubeState = state;
    return;
  }
  app.youtubeState = state;
  $('#youtube-url').value = `https://youtu.be/${state.videoId}`;
  $('#youtube-placeholder').classList.add('hidden');
  try {
    await ensureYoutubeApi();
    const player = app.youtubePlayer;
    const currentId = player.getVideoData?.().video_id;
    const elapsed = state.action === 'play' ? Math.max(0, (Date.now() - state.updatedAt) / 1000) : 0;
    const desiredTime = Math.max(0, state.currentTime + elapsed);
    app.youtubeSuppressUntil = Date.now() + 2000;
    if (currentId !== state.videoId || state.action === 'load') player.loadVideoById({ videoId: state.videoId, startSeconds: desiredTime });
    else if (state.action === 'play') {
      if (Math.abs(player.getCurrentTime() - desiredTime) > 2) player.seekTo(desiredTime, true);
      player.playVideo();
    } else if (state.action === 'pause') {
      player.pauseVideo();
      if (Math.abs(player.getCurrentTime() - desiredTime) > 2) player.seekTo(desiredTime, true);
    } else if (state.action === 'seek') player.seekTo(desiredTime, true);
  } catch (error) {
    console.warn('Could not synchronize YouTube:', error);
  }
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.add('hidden'), 4000);
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeSelect.value = theme;
  document.querySelector('meta[name="theme-color"]').content = theme === 'elegant-light' ? '#fbf9f5' : '#121214';
}

async function loadIceServers() {
  try {
    const response = await fetch(`${apiUrl}/api/ice-servers`);
    if (!response.ok) throw new Error(`ICE configuration returned ${response.status}`);
    const config = await response.json();
    app.iceServers = config.iceServers;
    $('#network-warning').classList.toggle('hidden', Boolean(config.turnConfigured));
  } catch (error) {
    console.warn('Using STUN fallback:', error);
    $('#network-warning').classList.remove('hidden');
  }
}
