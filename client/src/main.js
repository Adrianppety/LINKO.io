import { io } from 'socket.io-client';
import SimplePeer from 'simple-peer';
import './style.css';

const apiUrl = (import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:3000' : window.location.origin)).replace(/\/+$/, '');
const socket = io(apiUrl, { autoConnect: true, reconnection: true });
const app = {
  roomId: null,
  nickname: '',
  localStream: null,
  featuredSocketId: null,
  peers: new Map(),
  peerRetryAttempts: new Map(),
  peerRetryTimers: new Map(),
  failedPeerIds: new Set(),
  pendingSignals: new Map(),
  participants: new Map(),
  remoteStreams: new Map(),
  remoteAudioStreams: new Map(),
  remoteVideoTracks: new Map(),
  remoteScreenStreamIds: new Map(),
  selectedRemoteVideoTracks: new Map(),
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  screenTrack: null,
  screenStream: null,
  turnConfigured: false,
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
              <div class="tile-actions">
                <button class="focus-toggle" type="button" aria-label="Destacar sua tela" aria-pressed="false">Destacar</button>
                <button class="fullscreen-toggle" type="button" aria-label="Tela cheia sua tela" title="Tela cheia">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3"/></svg>
                </button>
              </div>
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
          <p class="network-warning hidden" id="network-warning">A conexão direta falhou. Configure um servidor TURN para alcançar participantes em redes restritas.</p>
          <button class="button control retry-media hidden" id="retry-media" type="button">Tentar reconectar</button>
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
    const timedOut = error.message === 'timeout' || error.message.includes('timed out');
    homeError.textContent = timedOut
      ? 'O servidor demorou para responder. Verifique o serviço de salas e a configuração CORS no Render.'
      : error.message;
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
  $('#room-name').innerHTML = `Sala <span class="room-code">${formatRoomCode(data.roomId)}</span>`;
  $('#room-link').value = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(data.roomId)}`;
  $('#local-name').textContent = `${app.nickname} (você)`;
  $('#local-video').srcObject = app.localStream;
  app.participants = new Map([[socket.id, app.nickname], ...(data.participants || []).map((participant) => [participant.socketId, participant.nickname])]);
  for (const participant of data.participants || []) {
    if (participant.screenStreamId) app.remoteScreenStreamIds.set(participant.socketId, participant.screenStreamId);
  }
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
  if (participant.screenStreamId) app.remoteScreenStreamIds.set(participant.socketId, participant.screenStreamId);
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
  if (!app.isInRoom || !from || !signal) return;
  if (peer) {
    peer.signal(signal);
    return;
  }
  const pending = app.pendingSignals.get(from) || [];
  if (pending.length >= 32) {
    console.warn(`Dropping excess WebRTC signals from ${from}`);
    return;
  }
  pending.push(signal);
  app.pendingSignals.set(from, pending);
});
socket.on('youtube-control', (state) => applyYoutubeState(state));
socket.on('participant-media-state', ({ socketId, screenStreamId }) => {
  if (!app.isInRoom || !app.participants.has(socketId)) return;
  if (socketId === socket.id) return;
  if (screenStreamId) app.remoteScreenStreamIds.set(socketId, screenStreamId);
  else app.remoteScreenStreamIds.delete(socketId);
  const screenTrack = screenStreamId
    ? Array.from(app.remoteVideoTracks.get(socketId)?.values() || [])
      .find(({ streamId }) => streamId === screenStreamId)?.track
    : null;
  updateRemoteVideoTile(socketId, screenTrack?.id);
});

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
    video.muted = true;
    video.addEventListener('loadeddata', () => updateRemoteVideoState(tile));
    video.addEventListener('playing', () => updateRemoteVideoState(tile));
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.hidden = true;
    const sourceSelect = document.createElement('select');
    sourceSelect.className = 'video-source-select';
    sourceSelect.hidden = true;
    sourceSelect.setAttribute('aria-label', `Selecionar vídeo de ${nickname}`);
    const empty = document.createElement('div');
    empty.className = 'video-empty';
    empty.innerHTML = `<span class="avatar">${escapeHtml(nickname.slice(0, 2).toUpperCase())}</span><span>Aguardando mídia…</span>`;
    const focusToggle = document.createElement('button');
    focusToggle.className = 'focus-toggle';
    focusToggle.type = 'button';
    focusToggle.textContent = 'Destacar';
    focusToggle.setAttribute('aria-label', `Destacar ${nickname}`);
    focusToggle.setAttribute('aria-pressed', 'false');
    const fullscreenToggle = document.createElement('button');
    fullscreenToggle.className = 'fullscreen-toggle';
    fullscreenToggle.type = 'button';
    fullscreenToggle.setAttribute('aria-label', `Tela cheia ${nickname}`);
    fullscreenToggle.title = 'Tela cheia';
    fullscreenToggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3"/></svg>';
    const name = document.createElement('span');
    name.className = 'video-name';
    name.textContent = nickname;
    const tileActions = document.createElement('div');
    tileActions.className = 'tile-actions';
    tileActions.append(sourceSelect, focusToggle, fullscreenToggle);
    tile.append(video, audio, empty, tileActions, name);
    grid.append(tile);
  }
  updateFeaturedTiles();
  $('#participant-count').textContent = `${app.participants.size}/10`;
  $('#local-empty').classList.toggle('hidden', hasActiveLocalVideo());
}

$('#video-grid').addEventListener('click', (event) => {
  const fullscreenButton = event.target.closest('.fullscreen-toggle');
  if (fullscreenButton) {
    toggleTileFullscreen(fullscreenButton.closest('.video-tile'));
    return;
  }
  const button = event.target.closest('.focus-toggle');
  if (!button) return;
  const tile = button.closest('.video-tile');
  const socketId = tile.id === 'self-tile' ? 'self' : tile.dataset.socketId;
  setFeaturedTile(app.featuredSocketId === socketId ? null : socketId);
});

$('#video-grid').addEventListener('change', (event) => {
  if (event.target.matches('.video-source-select')) {
    const tile = event.target.closest('.remote-tile');
    if (tile) selectRemoteVideoTrack(tile.dataset.socketId, event.target.value);
  }
});

$('#video-grid').addEventListener('dblclick', (event) => {
  if (event.target.closest('button')) return;
  const tile = event.target.closest('.video-tile');
  if (tile) toggleTileFullscreen(tile);
});

async function toggleTileFullscreen(tile) {
  try {
    if (document.fullscreenElement === tile) await document.exitFullscreen();
    else if (tile.requestFullscreen) await tile.requestFullscreen();
    else throw new Error('Este navegador não oferece tela cheia para este vídeo.');
  } catch (error) {
    showToast(error.message || 'Não foi possível abrir a tela cheia.');
  }
}

document.addEventListener('fullscreenchange', () => {
  for (const tile of $('#video-grid').querySelectorAll('.video-tile')) {
    const button = tile.querySelector('.fullscreen-toggle');
    const isFullscreen = document.fullscreenElement === tile;
    const participant = tile.querySelector('.video-name')?.textContent || 'esta tela';
    button.setAttribute('aria-label', `${isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'} ${participant}`);
    button.title = isFullscreen ? 'Sair da tela cheia' : 'Tela cheia';
  }
});

function setFeaturedTile(socketId) {
  app.featuredSocketId = socketId;
  updateFeaturedTiles();
}

function updateFeaturedTiles() {
  for (const tile of $('#video-grid').querySelectorAll('.video-tile')) {
    const socketId = tile.id === 'self-tile' ? 'self' : tile.dataset.socketId;
    const isFeatured = socketId === app.featuredSocketId;
    tile.classList.toggle('featured', isFeatured);
    const button = tile.querySelector('.focus-toggle');
    button.setAttribute('aria-pressed', String(isFeatured));
    button.textContent = isFeatured ? 'Remover destaque' : 'Destacar';
    button.setAttribute('aria-label', isFeatured ? `Remover destaque de ${tile.querySelector('.video-name')?.textContent || 'sua tela'}` : `Destacar ${tile.querySelector('.video-name')?.textContent || 'sua tela'}`);
  }
}

function escapeHtml(value) {
  const element = document.createElement('span');
  element.textContent = value;
  return element.innerHTML;
}

function formatRoomCode(roomId) {
  return roomId.match(/.{1,4}/g).join(' · ').toUpperCase();
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
    peer.addTrack(app.screenTrack, app.screenStream);
  }
  if (cameraTrack) peer.addTrack(cameraTrack, app.localStream);
  peer.on('signal', (signal) => {
    socket.timeout(8000).emit('signal', { targetSocketId: socketId, signal }, (error, response) => {
      if (error || !response?.ok) {
        console.warn(`WebRTC signaling failed for ${socketId}:`, error?.message || response?.message);
        if (app.isInRoom && app.peers.get(socketId) === peer) showToast('Não foi possível negociar o vídeo com um participante. Tente compartilhar a tela novamente.');
      }
    });
  });
  peer.on('track', (track, stream) => attachRemoteTrack(socketId, track, stream));
  peer.on('connect', () => {
    clearTimeout(app.peerRetryTimers.get(socketId));
    app.peerRetryTimers.delete(socketId);
    app.peerRetryAttempts.delete(socketId);
    app.failedPeerIds.delete(socketId);
    const hasFailedPeers = app.failedPeerIds.size > 0;
    $('#retry-media').classList.toggle('hidden', !hasFailedPeers);
    if (!hasFailedPeers) {
      $('#network-warning').textContent = 'TURN não configurado: redes restritas podem impedir a conexão de áudio e vídeo.';
      $('#network-warning').classList.toggle('hidden', app.turnConfigured);
    }
    setConnection(true, 'Conectado à sala');
  });
  peer.on('close', () => {
    if (app.peers.get(socketId) === peer) app.peers.delete(socketId);
  });
  peer.on('error', (error) => {
    if (app.peers.get(socketId) !== peer || !app.isInRoom) return;
    app.peers.delete(socketId);
    const attempt = (app.peerRetryAttempts.get(socketId) || 0) + 1;
    app.peerRetryAttempts.set(socketId, attempt);
    console.debug(`WebRTC peer ${error.code || 'error'}; reconnect attempt ${attempt}/3`);
    if (attempt <= 3) {
      setConnection(false, `Reconectando mídia (${attempt}/3)…`);
      const delay = attempt * 1500;
      const timer = setTimeout(() => {
        app.peerRetryTimers.delete(socketId);
        if (!app.isInRoom || !app.participants.has(socketId) || app.peers.has(socketId)) return;
        createPeer(socketId, socket.id.localeCompare(socketId) < 0);
      }, delay);
      app.peerRetryTimers.set(socketId, timer);
      return;
    }
    app.failedPeerIds.add(socketId);
    setConnection(false, 'Sem conexão de vídeo — confira a rede');
    $('#network-warning').textContent = 'Não foi possível conectar este participante. A rede pode exigir TURN; configure TURN_URLS e TURN_SHARED_SECRET no servidor.';
    $('#network-warning').classList.remove('hidden');
    $('#retry-media').classList.remove('hidden');
  });
  const pendingSignals = app.pendingSignals.get(socketId) || [];
  app.pendingSignals.delete(socketId);
  for (const signal of pendingSignals) peer.signal(signal);
}

function attachRemoteTrack(socketId, track, stream) {
  const tile = $(`.remote-tile[data-socket-id="${CSS.escape(socketId)}"]`);
  if (!tile) return;
  let combinedStream = app.remoteStreams.get(socketId);
  if (!combinedStream) {
    combinedStream = new MediaStream();
    app.remoteStreams.set(socketId, combinedStream);
  }
  if (!combinedStream.getTracks().some((current) => current.id === track.id)) {
    combinedStream.addTrack(track);
    if (track.kind === 'audio') {
      let audioStream = app.remoteAudioStreams.get(socketId);
      if (!audioStream) {
        audioStream = new MediaStream();
        app.remoteAudioStreams.set(socketId, audioStream);
      }
      audioStream.addTrack(track);
      const audio = tile.querySelector('audio');
      audio.srcObject = audioStream;
      playRemoteAudio(audio);
    } else {
      let videoTracks = app.remoteVideoTracks.get(socketId);
      if (!videoTracks) {
        videoTracks = new Map();
        app.remoteVideoTracks.set(socketId, videoTracks);
      }
      videoTracks.set(track.id, { track, streamId: stream?.id || null });
      const screenStreamId = app.remoteScreenStreamIds.get(socketId);
      updateRemoteVideoTile(socketId, stream?.id === screenStreamId ? track.id : undefined);
    }
    track.addEventListener('ended', () => {
      if (combinedStream.getTracks().some((current) => current.id === track.id)) combinedStream.removeTrack(track);
      const audioStream = app.remoteAudioStreams.get(socketId);
      if (audioStream?.getTracks().some((current) => current.id === track.id)) audioStream.removeTrack(track);
      app.remoteVideoTracks.get(socketId)?.delete(track.id);
      if (app.selectedRemoteVideoTracks.get(socketId) === track.id) app.selectedRemoteVideoTracks.delete(socketId);
      updateRemoteVideoTile(socketId);
      updateRemoteVideoState(tile);
    }, { once: true });
  }
  if (track.kind === 'audio') updateRemoteVideoState(tile);
}

function updateRemoteVideoTile(socketId, preferredTrackId) {
  const tile = $(`.remote-tile[data-socket-id="${CSS.escape(socketId)}"]`);
  if (!tile) return;
  const tracks = Array.from(app.remoteVideoTracks.get(socketId)?.values() || [])
    .filter(({ track }) => track.readyState === 'live');
  const select = tile.querySelector('.video-source-select');
  const previousSelection = app.selectedRemoteVideoTracks.get(socketId);
  const selectedTrack = tracks.find(({ track }) => track.id === preferredTrackId)
    || tracks.find(({ track }) => track.id === previousSelection)
    || tracks.find(({ streamId }) => streamId === app.remoteScreenStreamIds.get(socketId))
    || tracks[0];
  select.replaceChildren();
  let cameraIndex = 0;
  tracks.forEach(({ track, streamId }) => {
    const isScreen = streamId && streamId === app.remoteScreenStreamIds.get(socketId);
    const label = isScreen ? 'Tela compartilhada' : tracks.length > 1 ? `Câmera ${++cameraIndex}` : 'Câmera';
    select.add(new Option(label, track.id));
  });
  select.hidden = tracks.length < 2;
  if (!selectedTrack) {
    app.selectedRemoteVideoTracks.delete(socketId);
    tile.querySelector('video').srcObject = null;
    return;
  }
  app.selectedRemoteVideoTracks.set(socketId, selectedTrack.track.id);
  select.value = selectedTrack.track.id;
  const video = tile.querySelector('video');
  if (video.srcObject?.getVideoTracks()[0]?.id !== selectedTrack.track.id) {
    video.srcObject = new MediaStream([selectedTrack.track]);
    video.play().catch((error) => console.warn('Remote video playback was blocked:', error.message));
  }
  updateRemoteVideoState(tile);
}

function selectRemoteVideoTrack(socketId, trackId) {
  const entry = app.remoteVideoTracks.get(socketId)?.get(trackId);
  if (!entry) return;
  app.selectedRemoteVideoTracks.set(socketId, trackId);
  const tile = $(`.remote-tile[data-socket-id="${CSS.escape(socketId)}"]`);
  const video = tile?.querySelector('video');
  if (!video) return;
  video.srcObject = new MediaStream([entry.track]);
  video.play().catch((error) => console.warn('Remote video playback was blocked:', error.message));
  updateRemoteVideoState(tile);
}

function playRemoteAudio(audio) {
  audio.play().catch((error) => {
    if (error.name === 'NotAllowedError') {
      audio.dataset.playBlocked = 'true';
      return;
    }
    console.warn('Remote audio playback failed:', error.message);
  });
}

document.addEventListener('pointerdown', () => {
  for (const audio of document.querySelectorAll('.remote-tile audio[data-play-blocked="true"]')) {
    delete audio.dataset.playBlocked;
    playRemoteAudio(audio);
  }
});

function updateRemoteVideoState(tile) {
  const video = tile.querySelector('video');
  const hasLiveVideoTrack = video?.srcObject?.getVideoTracks().some((track) => track.readyState === 'live');
  const hasVideo = hasLiveVideoTrack && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0;
  tile.querySelector('.video-empty')?.classList.toggle('hidden', Boolean(hasVideo));
}

function removePeer(socketId) {
  clearTimeout(app.peerRetryTimers.get(socketId));
  app.peerRetryTimers.delete(socketId);
  app.peerRetryAttempts.delete(socketId);
  app.failedPeerIds.delete(socketId);
  const hasFailedPeers = app.failedPeerIds.size > 0;
  $('#retry-media').classList.toggle('hidden', !hasFailedPeers);
  if (!hasFailedPeers) {
    $('#network-warning').textContent = 'TURN não configurado: redes restritas podem impedir a conexão de áudio e vídeo.';
    $('#network-warning').classList.toggle('hidden', app.turnConfigured);
  }
  const peer = app.peers.get(socketId);
  app.peers.delete(socketId);
  app.pendingSignals.delete(socketId);
  if (peer && !peer.destroyed) peer.destroy();
  app.participants.delete(socketId);
  if (app.featuredSocketId === socketId) setFeaturedTile(null);
  app.remoteStreams.delete(socketId);
  app.remoteAudioStreams.delete(socketId);
  app.remoteVideoTracks.delete(socketId);
  app.remoteScreenStreamIds.delete(socketId);
  app.selectedRemoteVideoTracks.delete(socketId);
  $(`.remote-tile[data-socket-id="${CSS.escape(socketId)}"]`)?.remove();
  $('#participant-count').textContent = `${app.participants.size}/10`;
}

function closePeers() {
  for (const timer of app.peerRetryTimers.values()) clearTimeout(timer);
  app.peerRetryTimers.clear();
  app.peerRetryAttempts.clear();
  app.failedPeerIds.clear();
  $('#retry-media').classList.add('hidden');
  for (const peer of app.peers.values()) if (!peer.destroyed) peer.destroy();
  app.peers.clear();
  app.pendingSignals.clear();
  app.remoteStreams.clear();
  app.remoteAudioStreams.clear();
  app.remoteVideoTracks.clear();
  app.remoteScreenStreamIds.clear();
  app.selectedRemoteVideoTracks.clear();
  for (const tile of document.querySelectorAll('.remote-tile')) {
    tile.querySelector('video').srcObject = null;
    tile.querySelector('audio').srcObject = null;
    tile.querySelector('.video-empty').classList.remove('hidden');
  }
}

$('#retry-media').addEventListener('click', () => {
  const failedSocketIds = Array.from(app.failedPeerIds);
  app.failedPeerIds.clear();
  $('#retry-media').classList.add('hidden');
  for (const socketId of failedSocketIds) {
    if (!app.participants.has(socketId)) continue;
    app.peerRetryAttempts.delete(socketId);
    createPeer(socketId, socket.id.localeCompare(socketId) < 0);
  }
  if (failedSocketIds.length) setConnection(false, 'Tentando reconectar mídia…');
});

async function rejoinRoom() {
  try {
    const result = await socket.timeout(12_000).emitWithAck('join-room', { roomId: app.roomId, nickname: app.nickname });
    if (!result?.ok) throw new Error(result?.message || 'A sala foi encerrada.');
    app.participants = new Map([[socket.id, app.nickname], ...result.participants.map((participant) => [participant.socketId, participant.nickname])]);
    app.remoteScreenStreamIds.clear();
    for (const participant of result.participants) {
      if (participant.screenStreamId) app.remoteScreenStreamIds.set(participant.socketId, participant.screenStreamId);
    }
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
  app.featuredSocketId = null;
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
      if (previous) {
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
    if (!app.screenTrack) throw new Error('Não foi possível iniciar a captura da tela.');
    app.screenTrack.contentHint = 'detail';
    await publishScreenState(app.screenStream.id);
    for (const peer of app.peers.values()) {
      if (peer.destroyed) continue;
      peer.addTrack(app.screenTrack, app.screenStream);
    }
    $('#local-video').srcObject = app.screenStream;
    $('#local-empty').classList.add('hidden');
    $('#screen-button').textContent = 'Parar compartilhamento';
    $('#screen-button').classList.add('selected');
    $('#screen-button').setAttribute('aria-pressed', 'true');
    app.screenTrack.addEventListener('ended', stopScreenShare, { once: true });
  } catch (error) {
    if (app.screenStream) {
      for (const peer of app.peers.values()) {
        if (!app.screenTrack || peer.destroyed) continue;
        try {
          peer.removeTrack(app.screenTrack, app.screenStream);
        } catch (removeError) {
          console.warn('Could not roll back the shared screen from a peer:', removeError.message);
        }
      }
      for (const track of app.screenStream.getTracks()) track.stop();
      app.screenStream = null;
      app.screenTrack = null;
      publishScreenState(null).catch((stateError) => console.warn('Could not clear screen share state:', stateError.message));
    }
    if (error.name !== 'NotAllowedError') {
      showToast(error.name === 'Error' ? error.message : mediaError(error));
    }
  }
});

async function publishScreenState(screenStreamId) {
  if (!socket.connected) throw new Error('A conexão com a sala foi interrompida.');
  const result = await socket.timeout(8000).emitWithAck('participant-media-state', { screenStreamId });
  if (!result?.ok) throw new Error(result?.message || 'Não foi possível atualizar o estado da tela compartilhada.');
}

function stopScreenShare() {
  if (!app.screenTrack) return;
  const screenTrack = app.screenTrack;
  for (const peer of app.peers.values()) {
    if (app.screenStream) {
      try {
        peer.removeTrack(screenTrack, app.screenStream);
      } catch (error) {
        console.warn('Could not remove the shared screen from a peer:', error.message);
      }
    }
  }
  publishScreenState(null).catch((error) => console.warn('Could not clear screen share state:', error.message));
  screenTrack.stop();
  app.screenStream = null;
  app.screenTrack = null;
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
    app.turnConfigured = Boolean(config.turnConfigured);
    $('#network-warning').classList.toggle('hidden', Boolean(config.turnConfigured));
  } catch (error) {
    console.warn('Using STUN fallback:', error);
    $('#network-warning').textContent = 'Não foi possível consultar o servidor de mídia. Confira ALLOWED_ORIGINS e o status do backend.';
    $('#network-warning').classList.remove('hidden');
  }
}
