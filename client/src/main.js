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
  diagnosticsTimer: null,
  diagnosticsUpdating: false,
  participants: new Map(),
  remoteStreams: new Map(),
  remoteAudioStreams: new Map(),
  remoteVideoTracks: new Map(),
  remoteScreenStreamIds: new Map(),
  selectedRemoteVideoTracks: new Map(),
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  iceConfigurationMessage: 'A configuração ICE ainda não foi consultada.',
  screenTrack: null,
  screenStream: null,
  screenShareTransportStream: null,
  screenSenderTracks: new Map(),
  screenQualityMode: 'auto',
  screenStatsTimer: null,
  screenStatsUpdating: false,
  screenStatsSamples: new Map(),
  screenSenderQuality: new Map(),
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
        <a class="bug-report" href="https://github.com/Adrianppety/LINKO.io/issues/new?template=bug_report.yml" target="_blank" rel="noopener noreferrer">Relatar bug</a>
        <button class="theme-trigger" id="open-theme-settings" type="button" aria-haspopup="dialog" aria-controls="theme-dialog">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.7 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.7-1l-1.7.7-1.4-2.4 1.4-1.1a7 7 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.7-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.7 1l1.7-.7 1.4 2.4-1.4 1.1a7 7 0 0 1 0 2z"/></svg>
          Tema
        </button>
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
        <button class="button primary" id="join-button" type="submit">Conectar <span aria-hidden="true">↗</span></button>
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
          <div class="share-link"><button class="button secondary" id="copy-link">Copiar link da sala</button></div>
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
          <p class="network-warning hidden" id="network-warning">A conexão direta falhou. Configure um servidor TURN para alcançar participantes em redes restritas.</p>
          <details class="diagnostics" id="connection-diagnostics">
            <summary>Diagnóstico WebRTC</summary>
            <p id="ice-configuration-status"></p>
            <ul id="peer-diagnostics"><li>Aguardando conexões com participantes.</li></ul>
          </details>
          <button class="button control retry-media hidden" id="retry-media" type="button">Tentar reconectar</button>
        </section>
        <aside class="youtube card" id="youtube-card">
          <div class="youtube-heading">
            <div><span class="eyebrow">ASSISTAM JUNTOS</span><h2>YouTube</h2></div>
            <div class="youtube-actions">
              <button class="button control youtube-stop hidden" id="youtube-stop" type="button">Tirar vídeo</button>
              <span class="youtube-mark">▶</span>
            </div>
          </div>
          <form class="youtube-form" id="youtube-form">
            <label for="youtube-url">Link do vídeo</label>
            <div><input id="youtube-url" type="url" placeholder="Cole um link do YouTube" /><button class="button primary" type="submit">Assistir</button></div>
          </form>
          <div class="player-frame"><div id="youtube-player"></div><p id="youtube-placeholder">Cole um link para começar um vídeo com a sala.</p></div>
          <p class="youtube-note">Reprodução e busca sincronizadas entre participantes.</p>
        </aside>
      </div>
      <div class="media-dock" aria-label="Controles de áudio, câmera e compartilhamento">
        <div class="toolbar">
          <div class="control-group media-control-group">
            <span class="control-label">Áudio</span>
            <button class="button control media-toggle" id="mic-button" type="button" aria-pressed="false">Ativar microfone</button>
            <select id="audio-device" aria-label="Selecionar microfone"><option value="">Microfone padrão</option></select>
          </div>
          <div class="control-group media-control-group">
            <span class="control-label">Câmera</span>
            <button class="button control media-toggle" id="camera-button" type="button" aria-pressed="false">Ligar câmera</button>
            <select id="video-device" aria-label="Selecionar câmera"><option value="">Câmera padrão</option></select>
          </div>
          <div class="screen-control-group">
            <span class="control-label">Compartilhamento de tela</span>
            <button class="button control media-toggle" id="screen-button" type="button" aria-pressed="false">Compartilhar tela</button>
            <label class="screen-quality-picker" for="screen-quality">
              <span>Qualidade</span>
              <select id="screen-quality" aria-label="Qualidade do compartilhamento de tela">
                <option value="auto">Automática</option>
                <option value="fluid">Fluida (30 FPS)</option>
                <option value="high">Alta (1080p)</option>
                <option value="max">Máxima (até 4K / 60 FPS)</option>
              </select>
            </label>
          </div>
        </div>
        <p class="screen-quality-status hidden" id="screen-quality-status" role="status"></p>
      </div>
      <div class="room-footer">
        <button class="updates-button" id="updates-button" type="button" aria-haspopup="dialog" aria-controls="updates-dialog">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v4m0 10v4M3 12h4m10 0h4M5.64 5.64l2.83 2.83m7.06 7.06 2.83 2.83m0-12.72-2.83 2.83m-7.06 7.06-2.83 2.83"/></svg>
          Novidades
        </button>
        <div class="star-cta">
        <span>Curtiu o LINKO.IO? Uma estrela no GitHub ajuda muito!</span>
        <a href="https://github.com/Adrianppety/LINKO.io" target="_blank" rel="noopener noreferrer" aria-label="Abrir repositório LINKO.IO no GitHub e deixar uma estrela">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"/></svg>
          Deixar uma estrela
        </a>
        </div>
      </div>
      <dialog class="updates-dialog" id="updates-dialog" aria-labelledby="updates-title">
        <div class="updates-content">
          <header class="updates-header">
            <div><span class="eyebrow">LINKO.IO</span><h2 id="updates-title">Novidades</h2></div>
            <button class="updates-close" id="updates-close" type="button" aria-label="Fechar novidades">×</button>
          </header>
          <section class="updates-section">
            <h3>O que já fizemos</h3>
            <div class="updates-list">
              <article class="update-item">
                <h4>Layout responsivo</h4>
                <p>Interface adaptada para celulares e telas menores, sem rolagem horizontal.</p>
              </article>
              <article class="update-item">
                <h4>Novas cores escuras</h4>
                <p>Gamer neon com preto, verde e roxo; Escuro dourado com grafite, verde e dourado. O tema escolhido fica salvo.</p>
              </article>
              <article class="update-item">
                <h4>Entrada mais direta</h4>
                <p>Botão Conectar para criar uma sala ou entrar pelo link, sem barra lateral.</p>
              </article>
              <article class="update-item">
                <h4>Tema no topo</h4>
                <p>A escolha de tema fica no canto superior direito.</p>
              </article>
              <article class="update-item">
                <h4>Controles separados</h4>
                <p>Áudio, câmera e compartilhamento ficam em grupos próprios no dock de mídia.</p>
              </article>
              <article class="update-item">
                <h4>Compartilhamento de tela</h4>
                <p>Perfis de qualidade, incluindo até 60 FPS quando o dispositivo e a rede suportam.</p>
              </article>
              <article class="update-item">
                <h4>YouTube da sala</h4>
                <p>Agora é possível tirar o vídeo para todos os participantes.</p>
              </article>
              <article class="update-item">
                <h4>Apoie o LINKO.IO</h4>
                <p>Adicionamos um convite para deixar uma estrela no GitHub.</p>
              </article>
            </div>
          </section>
          <section class="updates-section">
            <h3>Próximas melhorias</h3>
            <div class="updates-list">
              <article class="update-item">
                <h4>Estados da sala</h4>
                <p>Deixar mais claros estados como conexão e câmera desligada.</p>
              </article>
              <article class="update-item">
                <h4>Qualidade de compartilhamento</h4>
                <p>Simplificar os controles e explicar melhor os perfis disponíveis.</p>
              </article>
            </div>
          </section>
        </div>
      </dialog>
      <div class="toast hidden" id="toast" role="status"></div>
    </section>
    <dialog class="updates-dialog theme-dialog" id="theme-dialog" aria-labelledby="theme-title">
      <div class="updates-content">
        <header class="updates-header">
          <div><span class="eyebrow">PERSONALIZAÇÃO</span><h2 id="theme-title">Escolha seu tema</h2></div>
          <button class="updates-close" id="theme-close" type="button" aria-label="Fechar temas">×</button>
        </header>
        <div class="theme-options">
          <button class="theme-option" type="button" data-theme-choice="gamer">
            <span class="theme-swatch gamer-swatch" aria-hidden="true"></span>
            <span><strong>Gamer neon</strong><small>Preto, verde e roxo neon</small></span>
            <span class="theme-check" aria-hidden="true">✓</span>
          </button>
          <button class="theme-option" type="button" data-theme-choice="elegant-dark">
            <span class="theme-swatch dark-swatch" aria-hidden="true"></span>
            <span><strong>Escuro dourado</strong><small>Grafite, verde e dourado</small></span>
            <span class="theme-check" aria-hidden="true">✓</span>
          </button>
        </div>
      </div>
    </dialog>
  </main>`;

const $ = (selector) => document.querySelector(selector);
const home = $('#home');
const room = $('#room');
const homeError = $('#home-error');
const themes = new Set(['elegant-dark', 'gamer']);
const roomFromUrl = new URLSearchParams(window.location.search).get('room') || new URLSearchParams(window.location.search).get('roomId');

$('#updates-button').addEventListener('click', () => $('#updates-dialog').showModal());
$('#updates-close').addEventListener('click', () => $('#updates-dialog').close());
$('#updates-dialog').addEventListener('click', (event) => {
  if (event.target === event.currentTarget) event.currentTarget.close();
});

const themeDialog = $('#theme-dialog');
$('#open-theme-settings').addEventListener('click', () => themeDialog.showModal());
$('#theme-close').addEventListener('click', () => themeDialog.close());
themeDialog.addEventListener('click', (event) => {
  if (event.target === event.currentTarget) themeDialog.close();
});
for (const button of document.querySelectorAll('[data-theme-choice]')) {
  button.addEventListener('click', () => {
    const theme = button.dataset.themeChoice;
    if (!themes.has(theme)) return;
    setTheme(theme);
    try {
      localStorage.setItem('linko-theme', theme);
    } catch (error) {
      console.warn('Não foi possível salvar a preferência de tema:', error);
    }
    themeDialog.close();
  });
}
let savedTheme = 'gamer';
let hasSavedTheme = false;
try {
  const preference = localStorage.getItem('linko-theme');
  if (themes.has(preference)) {
    savedTheme = preference;
    hasSavedTheme = true;
  }
} catch (error) {
  console.warn('Não foi possível ler a preferência de tema:', error);
}
setTheme(savedTheme);
if (!hasSavedTheme) themeDialog.showModal();

if (roomFromUrl) {
  $('#join-button').innerHTML = 'Conectar <span aria-hidden="true">↗</span>';
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
    try {
      peer.signal(signal);
    } catch (error) {
      console.warn('WebRTC signal could not be applied:', error.code || 'invalid_signal');
    }
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
  return roomId.toUpperCase();
}

function createPeer(socketId, initiator) {
  if (app.peers.has(socketId) || !app.localStream) return;
  const peer = new SimplePeer({
    initiator,
    trickle: true,
    config: { iceServers: app.iceServers, iceTransportPolicy: 'all' }
  });
  app.peers.set(socketId, peer);
  for (const track of app.localStream.getAudioTracks()) peer.addTrack(track, app.localStream);
  const cameraTrack = app.localStream.getVideoTracks()[0];
  if (app.screenTrack) {
    peer.addTrack(app.screenTrack, app.screenShareTransportStream);
    app.screenSenderTracks.set(socketId, app.screenTrack);
    configureScreenSender(socketId, peer);
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
  attachPeerDiagnostics(peer);
  peer.on('connect', () => {
    clearTimeout(app.peerRetryTimers.get(socketId));
    app.peerRetryTimers.delete(socketId);
    app.peerRetryAttempts.delete(socketId);
    app.failedPeerIds.delete(socketId);
    const hasFailedPeers = app.failedPeerIds.size > 0;
    $('#retry-media').classList.toggle('hidden', !hasFailedPeers);
    if (!hasFailedPeers) {
      $('#network-warning').classList.toggle('hidden', app.turnConfigured);
    }
    setConnection(true, 'Conectado à sala');
    updatePeerDiagnostics();
  });
  peer.on('close', () => {
    if (app.peers.get(socketId) === peer) {
      app.peers.delete(socketId);
      app.screenSenderTracks.delete(socketId);
    }
    updatePeerDiagnostics();
  });
  peer.on('error', (error) => {
    if (app.peers.get(socketId) !== peer || !app.isInRoom) return;
    app.peers.delete(socketId);
    app.screenSenderTracks.delete(socketId);
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
    $('#network-warning').textContent = peerFailureMessage();
    $('#network-warning').classList.remove('hidden');
    $('#retry-media').classList.remove('hidden');
    updatePeerDiagnostics();
  });
  const pendingSignals = app.pendingSignals.get(socketId) || [];
  app.pendingSignals.delete(socketId);
  for (const signal of pendingSignals) peer.signal(signal);
}

const screenQualityModes = {
  auto: { frameRate: 60, contentHint: 'detail' },
  fluid: { frameRate: 30, contentHint: 'detail' },
  high: { width: 1920, height: 1080, maxWidth: 1920, maxHeight: 1080, frameRate: 30, contentHint: 'detail' },
  max: { width: 3840, height: 2160, maxWidth: 3840, maxHeight: 2160, frameRate: 60, contentHint: 'motion' }
};

function getScreenCaptureConstraints(mode) {
  const quality = screenQualityModes[mode] || screenQualityModes.auto;
  const video = {
    frameRate: { ideal: quality.frameRate, max: quality.frameRate }
  };
  if (quality.width) {
    video.width = { ideal: quality.width, max: quality.maxWidth };
    video.height = { ideal: quality.height, max: quality.maxHeight };
  }
  return {
    video,
    audio: false
  };
}

function getScreenBitrateCap(mode, settings, participantCount) {
  const width = settings.width || 1920;
  const height = settings.height || 1080;
  const frameRate = settings.frameRate || screenQualityModes[mode]?.frameRate || 30;
  const pixelCount = width * height;
  let bitrate;
  if (mode === 'fluid') bitrate = pixelCount >= 7_000_000 ? 15_000_000 : pixelCount >= 3_000_000 ? 8_000_000 : 4_500_000;
  else if (mode === 'high') bitrate = 7_500_000;
  else if (pixelCount >= 7_000_000) bitrate = frameRate > 30 ? 20_000_000 : 15_000_000;
  else if (pixelCount >= 3_000_000) bitrate = frameRate > 30 ? 15_000_000 : 10_000_000;
  else bitrate = frameRate > 30 ? 12_000_000 : 7_500_000;
  return Math.round(Math.min(bitrate, 24_000_000 / Math.max(1, participantCount)));
}

function getScreenSender(peer) {
  if (!app.screenTrack) return null;
  return peer._pc?.getSenders().find((sender) => sender.track?.id === app.screenTrack.id) || null;
}

function configureScreenSender(socketId, peer, qualityFactor = 1) {
  const sender = getScreenSender(peer);
  if (!sender?.getParameters || !sender.setParameters || !app.screenTrack) return;
  const quality = screenQualityModes[app.screenQualityMode] || screenQualityModes.auto;
  const settings = app.screenTrack.getSettings();
  const bitrate = getScreenBitrateCap(app.screenQualityMode, settings, app.peers.size);
  const parameters = sender.getParameters();
  if (!parameters.encodings?.length) return;
  parameters.encodings[0].maxBitrate = Math.round(bitrate * qualityFactor);
  parameters.encodings[0].maxFramerate = qualityFactor < 1
    ? Math.min(quality.frameRate, 24)
    : quality.frameRate;
  if ('priority' in parameters.encodings[0]) parameters.encodings[0].priority = 'high';
  if ('degradationPreference' in parameters) parameters.degradationPreference = 'maintain-resolution';
  sender.setParameters(parameters).catch((error) => {
    console.warn(`Could not tune screen sender for ${socketId}:`, error.name || 'unknown_error');
  });
}

function formatScreenCaptureSettings() {
  const settings = app.screenTrack?.getSettings();
  if (!settings) return 'Captura ativa; resolução e FPS reais indisponíveis neste navegador.';
  const resolution = settings.width && settings.height ? `${settings.width} × ${settings.height}` : 'resolução indisponível';
  const frameRate = Number.isFinite(settings.frameRate) ? `${Math.round(settings.frameRate)} FPS` : 'FPS indisponível';
  return `Captura real: ${resolution} · ${frameRate}.`;
}

async function updateScreenQualityStats() {
  if (!app.screenTrack || app.screenStatsUpdating) return;
  app.screenStatsUpdating = true;
  try {
    const reports = await Promise.all(Array.from(app.peers, async ([socketId, peer]) => {
      const sender = getScreenSender(peer);
      if (!sender?.getStats) return null;
      try {
        const [stats, peerStats] = await Promise.all([sender.getStats(), peer._pc.getStats()]);
        const items = Array.from(stats.values());
        const allItems = Array.from(peerStats.values());
        const outbound = items.find((report) => report.type === 'outbound-rtp' && (report.kind === 'video' || report.mediaType === 'video'));
        if (!outbound) return null;
        const previous = app.screenStatsSamples.get(socketId);
        app.screenStatsSamples.set(socketId, {
          bytesSent: outbound.bytesSent,
          timestamp: outbound.timestamp,
          framesDropped: outbound.framesDropped
        });
        const elapsed = previous ? (outbound.timestamp - previous.timestamp) / 1000 : 0;
        const bitrate = previous && elapsed > 0
          ? Math.max(0, (outbound.bytesSent - previous.bytesSent) * 8 / elapsed)
          : null;
        const remoteInbound = items.find((report) => report.type === 'remote-inbound-rtp' && report.localId === outbound.id);
        const candidatePair = allItems.find((report) => report.type === 'candidate-pair' && (report.selected || report.nominated && report.state === 'succeeded'));
        const packetLoss = Number.isFinite(remoteInbound?.fractionLost)
          ? Math.max(0, remoteInbound.fractionLost)
          : Number.isFinite(remoteInbound?.packetsLost) && Number.isFinite(remoteInbound?.packetsReceived)
            ? Math.max(0, remoteInbound.packetsLost / Math.max(1, remoteInbound.packetsLost + remoteInbound.packetsReceived))
            : null;
        const rtt = Number.isFinite(remoteInbound?.roundTripTime)
          ? remoteInbound.roundTripTime
          : Number.isFinite(candidatePair?.currentRoundTripTime)
            ? candidatePair.currentRoundTripTime
            : null;
        const droppedFrames = Number.isFinite(outbound.framesDropped) && Number.isFinite(previous?.framesDropped)
          ? Math.max(0, outbound.framesDropped - previous.framesDropped)
          : 0;
        const adaptation = app.screenSenderQuality.get(socketId) || {
          factor: 1,
          stableIntervals: 0,
          participantCount: app.peers.size
        };
        if (adaptation.participantCount !== app.peers.size) {
          adaptation.participantCount = app.peers.size;
          configureScreenSender(socketId, peer, adaptation.factor);
        }
        const poorConnection = (packetLoss !== null && packetLoss > 0.05)
          || (rtt !== null && rtt > 0.5)
          || droppedFrames > 8;
        if (poorConnection) {
          adaptation.factor = Math.max(0.4, adaptation.factor * 0.75);
          adaptation.stableIntervals = 0;
          configureScreenSender(socketId, peer, adaptation.factor);
        } else if (packetLoss !== null || rtt !== null) {
          adaptation.stableIntervals += 1;
          if (adaptation.stableIntervals >= 3 && adaptation.factor < 1) {
            adaptation.factor = Math.min(1, adaptation.factor + 0.15);
            adaptation.stableIntervals = 0;
            configureScreenSender(socketId, peer, adaptation.factor);
          }
        }
        app.screenSenderQuality.set(socketId, adaptation);
        return {
          bitrate,
          rtt,
          packetLoss,
          framesPerSecond: outbound.framesPerSecond,
          framesDropped: droppedFrames
        };
      } catch {
        return null;
      }
    }));
    const available = reports.filter(Boolean);
    const totalBitrate = available.reduce((total, report) => total + (report.bitrate || 0), 0);
    const measuredBitrate = available.length === 0
      ? app.peers.size
        ? 'transmissão ainda sendo medida'
        : 'aguardando participantes para medir a transmissão'
      : available.some((report) => report.bitrate !== null)
      ? `${(totalBitrate / 1_000_000).toFixed(1)} Mbps enviados`
      : 'bitrate ainda sendo medido';
    const frameRates = available.map((report) => report.framesPerSecond).filter(Number.isFinite);
    const measuredFps = frameRates.length ? ` · envio ${Math.round(Math.min(...frameRates))} FPS` : '';
    const losses = available.map((report) => report.packetLoss).filter(Number.isFinite);
    const measuredLoss = losses.length ? ` · perda ${(Math.max(...losses) * 100).toFixed(1)}%` : '';
    const rtts = available.map((report) => report.rtt).filter(Number.isFinite);
    const measuredRtt = rtts.length ? ` · RTT até ${Math.round(Math.max(...rtts) * 1000)} ms` : '';
    const droppedFrames = available.reduce((total, report) => total + (report.framesDropped || 0), 0);
    const droppedFramesLabel = available.some((report) => Number.isFinite(report.framesDropped))
      ? ` · quadros descartados ${droppedFrames}`
      : '';
    $('#screen-quality-status').textContent = `${formatScreenCaptureSettings()} ${measuredBitrate}${measuredFps}${measuredLoss}${measuredRtt}${droppedFramesLabel}`;
  } finally {
    app.screenStatsUpdating = false;
  }
}

function attachPeerDiagnostics(peer) {
  // simple-peer keeps its RTCPeerConnection on this instance for browser diagnostics.
  const peerConnection = peer._pc;
  if (!peerConnection) return;
  peerConnection.addEventListener?.('iceconnectionstatechange', updatePeerDiagnostics);
  peerConnection.addEventListener?.('connectionstatechange', updatePeerDiagnostics);
}

async function updatePeerDiagnostics() {
  const list = $('#peer-diagnostics');
  if (!list || app.diagnosticsUpdating) return;
  app.diagnosticsUpdating = true;
  try {
    const entries = await Promise.all(Array.from(app.peers, async ([socketId, peer]) => {
      const peerConnection = peer._pc;
      const nickname = app.participants.get(socketId) || 'Participante';
      if (!peerConnection) return { nickname, status: 'Diagnóstico WebRTC indisponível.' };
      const iceState = peerConnection.iceConnectionState || 'indisponível';
      const connectionState = peerConnection.connectionState || 'indisponível';
      let selectedRoute = 'Candidato selecionado ainda não disponível.';
      try {
        const stats = await peerConnection.getStats();
        const reports = Array.from(stats.values());
        const transport = reports.find((report) => report.type === 'transport' && report.selectedCandidatePairId);
        const pair = transport
          ? stats.get(transport.selectedCandidatePairId)
          : reports.find((report) => report.type === 'candidate-pair' && (
            report.selected === true || (report.nominated === true && report.state === 'succeeded')
          ));
        if (pair) {
          const localCandidate = stats.get(pair.localCandidateId);
          const remoteCandidate = stats.get(pair.remoteCandidateId);
          const candidateTypes = [localCandidate?.candidateType, remoteCandidate?.candidateType].filter(Boolean);
          selectedRoute = candidateTypes.includes('relay')
            ? 'TURN relay confirmado'
            : candidateTypes.length
              ? `Conexão direta (${candidateTypes.join(' ↔ ')})`
              : 'Par ICE selecionado; tipo de candidato indisponível.';
        }
      } catch {
        selectedRoute = 'Não foi possível ler as estatísticas ICE.';
      }
      return { nickname, status: `ICE: ${iceState} · conexão: ${connectionState} · ${selectedRoute}` };
    }));

    const fragment = document.createDocumentFragment();
    if (entries.length === 0) {
      const item = document.createElement('li');
      item.textContent = 'Aguardando conexões com participantes.';
      fragment.append(item);
    } else {
      for (const entry of entries) {
        const item = document.createElement('li');
        const name = document.createElement('strong');
        name.textContent = entry.nickname;
        const status = document.createElement('span');
        status.textContent = entry.status;
        item.append(name, status);
        fragment.append(item);
      }
    }
    list.replaceChildren(fragment);
  } finally {
    app.diagnosticsUpdating = false;
  }
}

$('#connection-diagnostics').addEventListener('toggle', (event) => {
  clearInterval(app.diagnosticsTimer);
  app.diagnosticsTimer = null;
  if (event.currentTarget.open) {
    updatePeerDiagnostics();
    app.diagnosticsTimer = window.setInterval(updatePeerDiagnostics, 3000);
  }
});

function peerFailureMessage() {
  if (app.iceConfigurationMessage.startsWith('Erro:')) {
    return `${app.iceConfigurationMessage} A conexão direta também falhou; confira a configuração TURN no Render.`;
  }
  if (!app.turnConfigured) {
    return 'Este participante não conectou. O backend não forneceu um relay TURN; algumas redes bloqueiam conexões diretas.';
  }
  return 'Este participante não conectou. O backend forneceu credenciais TURN, mas o uso de relay ainda não foi confirmado; confira o diagnóstico e a rede.';
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
  const screenStreamId = app.remoteScreenStreamIds.get(socketId);
  tile.classList.toggle('screen-tile', Boolean(screenStreamId && selectedTrack.streamId === screenStreamId));
  updateRemoteVideoState(tile);
}

function selectRemoteVideoTrack(socketId, trackId) {
  const entry = app.remoteVideoTracks.get(socketId)?.get(trackId);
  if (!entry) return;
  app.selectedRemoteVideoTracks.set(socketId, trackId);
  const tile = $(`.remote-tile[data-socket-id="${CSS.escape(socketId)}"]`);
  const screenStreamId = app.remoteScreenStreamIds.get(socketId);
  tile?.classList.toggle('screen-tile', Boolean(screenStreamId && entry.streamId === screenStreamId));
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
  app.screenSenderTracks.delete(socketId);
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
  clearInterval(app.diagnosticsTimer);
  app.diagnosticsTimer = null;
  for (const timer of app.peerRetryTimers.values()) clearTimeout(timer);
  app.peerRetryTimers.clear();
  app.peerRetryAttempts.clear();
  app.failedPeerIds.clear();
  $('#retry-media').classList.add('hidden');
  for (const peer of app.peers.values()) if (!peer.destroyed) peer.destroy();
  app.peers.clear();
  app.screenSenderTracks.clear();
  app.pendingSignals.clear();
  app.remoteStreams.clear();
  app.remoteAudioStreams.clear();
  app.remoteVideoTracks.clear();
  app.remoteScreenStreamIds.clear();
  app.selectedRemoteVideoTracks.clear();
  updatePeerDiagnostics();
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
  const roomLink = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(app.roomId)}`;
  try {
    await navigator.clipboard.writeText(roomLink);
    showToast('Link copiado. Convide até 9 pessoas.');
  } catch {
    const input = document.createElement('textarea');
    input.value = roomLink;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.append(input);
    input.select();
    const copied = document.execCommand('copy');
    input.remove();
    if (!copied) {
      showToast('Não foi possível copiar o link. Tente novamente.');
      return;
    }
    showToast('Link copiado. Convide até 9 pessoas.');
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

$('#screen-quality').addEventListener('change', (event) => {
  if (!Object.hasOwn(screenQualityModes, event.target.value)) {
    event.target.value = app.screenQualityMode;
    return;
  }
  app.screenQualityMode = event.target.value;
});

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
    const quality = screenQualityModes[app.screenQualityMode];
    app.screenStream = await navigator.mediaDevices.getDisplayMedia(getScreenCaptureConstraints(app.screenQualityMode));
    app.screenTrack = app.screenStream.getVideoTracks()[0];
    if (!app.screenTrack) throw new Error('Não foi possível iniciar a captura da tela.');
    if (!app.screenShareTransportStream) app.screenShareTransportStream = new MediaStream();
    app.screenShareTransportStream.addTrack(app.screenTrack);
    app.screenTrack.contentHint = quality.contentHint;
    await publishScreenState(app.screenShareTransportStream.id);
    for (const [socketId, peer] of app.peers) {
      if (peer.destroyed) continue;
      const previousTrack = app.screenSenderTracks.get(socketId);
      if (previousTrack) {
        peer.replaceTrack(previousTrack, app.screenTrack, app.screenShareTransportStream);
      } else {
        peer.addTrack(app.screenTrack, app.screenShareTransportStream);
      }
      app.screenSenderTracks.set(socketId, app.screenTrack);
      configureScreenSender(socketId, peer);
    }
    $('#local-video').srcObject = app.screenStream;
    $('#self-tile').classList.add('screen-tile');
    $('#screen-quality').disabled = true;
    $('#local-empty').classList.add('hidden');
    $('#screen-button').textContent = 'Parar compartilhamento';
    $('#screen-button').classList.add('selected');
    $('#screen-button').setAttribute('aria-pressed', 'true');
    $('#screen-quality-status').classList.remove('hidden');
    $('#screen-quality-status').textContent = `${formatScreenCaptureSettings()} Medindo transmissão…`;
    app.screenStatsSamples.clear();
    app.screenSenderQuality.clear();
    updateScreenQualityStats();
    app.screenStatsTimer = window.setInterval(updateScreenQualityStats, 3000);
    app.screenTrack.addEventListener('ended', stopScreenShare, { once: true });
  } catch (error) {
    if (app.screenStream) {
      for (const [socketId, peer] of app.peers) {
        if (!app.screenTrack || peer.destroyed || app.screenSenderTracks.get(socketId) !== app.screenTrack) continue;
        try {
          peer.replaceTrack(app.screenTrack, null, app.screenShareTransportStream);
        } catch (removeError) {
          console.warn('Could not roll back the shared screen from a peer:', removeError.message);
        }
      }
      app.screenShareTransportStream?.removeTrack(app.screenTrack);
      for (const track of app.screenStream.getTracks()) track.stop();
      app.screenStream = null;
      app.screenTrack = null;
      $('#screen-quality').disabled = false;
      $('#screen-quality-status').classList.add('hidden');
      $('#self-tile').classList.remove('screen-tile');
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
  clearInterval(app.screenStatsTimer);
  app.screenStatsTimer = null;
  app.screenStatsSamples.clear();
  app.screenSenderQuality.clear();
  const screenTrack = app.screenTrack;
  for (const [socketId, peer] of app.peers) {
    const senderTrack = app.screenSenderTracks.get(socketId);
    if (app.screenShareTransportStream && senderTrack) {
      try {
        peer.replaceTrack(senderTrack, null, app.screenShareTransportStream);
      } catch (error) {
        console.warn('Could not stop the shared screen for a peer:', error.message);
      }
    }
  }
  publishScreenState(null).catch((error) => console.warn('Could not clear screen share state:', error.message));
  screenTrack.stop();
  app.screenShareTransportStream?.removeTrack(screenTrack);
  app.screenStream = null;
  app.screenTrack = null;
  $('#local-video').srcObject = app.localStream;
  $('#self-tile').classList.remove('screen-tile');
  $('#screen-button').textContent = 'Compartilhar tela';
  $('#screen-button').classList.remove('selected');
  $('#screen-button').setAttribute('aria-pressed', 'false');
  $('#screen-quality').disabled = false;
  $('#screen-quality-status').classList.add('hidden');
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
    $('#youtube-stop').classList.remove('hidden');
    publishYoutube('load', videoId, 0);
  } catch (error) {
    console.error('YouTube IFrame API error:', error);
    showToast('Não foi possível carregar o player oficial do YouTube.');
  }
});

$('#youtube-stop').addEventListener('click', stopYoutube);

function stopYoutube() {
  app.youtubeSuppressUntil = Date.now() + 2000;
  app.youtubePlayer?.stopVideo();
  app.youtubeState = { action: 'stop', videoId: null, currentTime: 0, updatedAt: Date.now() };
  app.lastYoutubeSample = null;
  $('#youtube-url').value = '';
  $('#youtube-placeholder').classList.remove('hidden');
  $('#youtube-stop').classList.add('hidden');
  publishYoutube('stop', null, 0);
}

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
    videoId: action === 'stop' ? null : (videoId || app.youtubeState?.videoId || null),
    currentTime: action === 'stop' ? 0 : (Number.isFinite(currentTime) ? currentTime : (player?.getCurrentTime?.() || 0))
  };
  app.youtubeState = { ...state, updatedAt: Date.now() };
  socket.emit('youtube-control', state);
}

async function applyYoutubeState(state) {
  if (!state?.videoId) {
    if (state?.action === 'stop') {
      app.youtubeSuppressUntil = Date.now() + 2000;
      app.youtubePlayer?.stopVideo();
      app.lastYoutubeSample = null;
      $('#youtube-url').value = '';
      $('#youtube-placeholder').classList.remove('hidden');
      $('#youtube-stop').classList.add('hidden');
    }
    app.youtubeState = state;
    return;
  }
  app.youtubeState = state;
  $('#youtube-url').value = `https://youtu.be/${state.videoId}`;
  $('#youtube-placeholder').classList.add('hidden');
  $('#youtube-stop').classList.remove('hidden');
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
  for (const button of document.querySelectorAll('[data-theme-choice]')) {
    button.setAttribute('aria-pressed', String(button.dataset.themeChoice === theme));
  }
  document.querySelector('meta[name="theme-color"]').content = theme === 'gamer' ? '#09090b' : '#121214';
}

async function loadIceServers() {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${apiUrl}/api/ice-servers`, { signal: controller.signal });
    let config;
    try {
      config = await response.json();
    } catch {
      throw new Error('invalid_response');
    }
    if (!response.ok) throw new Error(config?.error || 'provider_unavailable');
    const validation = validateIceServers(config?.iceServers);
    if (!validation.valid || (config.turnConfigured === true && !validation.hasTurn)) {
      throw new Error('invalid_response');
    }
    app.iceServers = config.iceServers;
    app.turnConfigured = validation.hasTurn && config.turnConfigured === true;
    app.iceConfigurationMessage = app.turnConfigured
      ? 'TURN configurado pelo backend; o relay só será confirmado se aparecer como candidato selecionado.'
      : 'Erro: o backend respondeu sem servidores TURN; somente conexões diretas/STUN estão disponíveis.';
  } catch (error) {
    const code = error.message;
    app.iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    app.turnConfigured = false;
    app.iceConfigurationMessage = `Erro: ${iceConfigurationErrorMessage(code)}`;
    console.warn('ICE configuration unavailable; using STUN fallback:', iceConfigurationErrorMessage(code));
  } finally {
    clearTimeout(timeout);
  }

  $('#ice-configuration-status').textContent = app.iceConfigurationMessage;
  $('#network-warning').textContent = app.iceConfigurationMessage.startsWith('Erro:')
    ? `${app.iceConfigurationMessage} Algumas redes podem bloquear a chamada.`
    : app.turnConfigured
      ? ''
      : 'TURN não está configurado. Algumas redes podem bloquear conexões diretas.';
  $('#network-warning').classList.toggle('hidden', app.turnConfigured);
}

function iceConfigurationErrorMessage(code) {
  if (code === 'metered_turn_configuration_incomplete') return 'a configuração do Metered está incompleta no backend.';
  if (code === 'metered_turn_endpoint_invalid') return 'a URL do endpoint TURN do Metered está inválida.';
  if (code === 'metered_turn_https_required') return 'o endpoint TURN exige HTTPS.';
  if (code === 'metered_turn_invalid_response') return 'o Metered não retornou servidores TURN válidos.';
  if (code === 'turn_provider_unavailable') return 'não foi possível obter credenciais TURN do Metered.';
  if (code === 'invalid_response') return 'a configuração ICE recebida do backend é inválida.';
  if (code === 'AbortError') return 'o backend demorou para responder à configuração ICE.';
  return 'não foi possível consultar a configuração ICE do backend.';
}

function validateIceServers(value) {
  if (!Array.isArray(value) || value.length === 0) return { valid: false, hasTurn: false };
  let hasTurn = false;
  for (const server of value) {
    if (!server || typeof server !== 'object' || Array.isArray(server)) return { valid: false, hasTurn: false };
    const urls = typeof server.urls === 'string' ? [server.urls] : server.urls;
    if (!Array.isArray(urls) || urls.length === 0 || !urls.every((url) => typeof url === 'string')) {
      return { valid: false, hasTurn: false };
    }
    const turnUrls = urls.filter((url) => /^turns?:/i.test(url));
    if (turnUrls.length) {
      hasTurn = true;
      if (
        typeof server.username !== 'string' || !server.username ||
        typeof server.credential !== 'string' || !server.credential
      ) return { valid: false, hasTurn: false };
    }
    if (urls.some((url) => !/^(stun|stuns|turn|turns):/i.test(url))) {
      return { valid: false, hasTurn: false };
    }
  }
  return { valid: true, hasTurn };
}
