// ─── APP — Orchestrazione UI ───────────────────────────────────────

const App = (() => {

  // ── DOM refs ──────────────────────────────────────────────────
  const screens = {
    login: document.getElementById('screen-login'),
    playlists: document.getElementById('screen-playlists'),
    player: document.getElementById('screen-player'),
  };

  const ui = {
    btnLogin: document.getElementById('btn-login'),
    btnLogout: document.getElementById('btn-logout'),
    btnBack: document.getElementById('btn-back'),
    btnPlay: document.getElementById('btn-play'),
    btnNext: document.getElementById('btn-next'),
    btnPrev: document.getElementById('btn-prev'),
    iconPlay: document.getElementById('icon-play'),
    iconPause: document.getElementById('icon-pause'),
    statusDot: document.getElementById('status-dot'),
    statusText: document.getElementById('status-text'),
    voidCircle: document.getElementById('void-circle'),
    voidLabel: document.getElementById('void-label'),
    progressFill: document.getElementById('progress-fill'),
    progressTrack: document.getElementById('progress-track'),
    volumeSlider: document.getElementById('volume-slider'),
    trackNum: document.getElementById('track-num'),
    trackTotal: document.getElementById('track-total'),
    playlistsGrid: document.getElementById('playlists-grid'),
    inputUri: document.getElementById('input-playlist-uri'),
    btnLoadUri: document.getElementById('btn-load-uri'),
    toast: document.getElementById('toast'),
  };

  // ── Toast ─────────────────────────────────────────────────────
  let _toastTimer = null;
  function toast(msg, isError = false) {
    clearTimeout(_toastTimer);
    ui.toast.textContent = msg;
    ui.toast.className = 'toast show' + (isError ? ' error' : '');
    _toastTimer = setTimeout(() => { ui.toast.className = 'toast'; }, 3000);
  }

  // ── Screen transitions ────────────────────────────────────────
  function showScreen(name) {
    Object.entries(screens).forEach(([k, el]) => {
      el.classList.toggle('active', k === name);
    });
  }

  // ── Stato player ──────────────────────────────────────────────
  function setPlayerStatus(status, label) {
    ui.statusDot.className = 'dot ' + status;
    ui.statusText.textContent = label;
  }

  function setPlayIcon(isPlaying) {
    ui.iconPlay.style.display = isPlaying ? 'none' : 'block';
    ui.iconPause.style.display = isPlaying ? 'block' : 'none';
    ui.voidCircle.classList.toggle('playing', isPlaying);
    ui.voidLabel.textContent = isPlaying ? '' : 'pausa';
  }

  function updateProgress(position, duration) {
    if (!duration) return;
    const pct = Math.min((position / duration) * 100, 100);
    ui.progressFill.style.width = pct + '%';
  }

  function updateCounter() {
    const info = Player.getTrackInfo();
    ui.trackNum.textContent = info.current;
    ui.trackTotal.textContent = info.total;
  }

  // ── Carica playlist dell'utente ───────────────────────────────
  async function loadUserPlaylists() {
    ui.playlistsGrid.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';
    try {
      const data = await Auth.apiGet('/me/playlists?limit=50');
      if (!data || !data.items.length) {
        ui.playlistsGrid.innerHTML = '<p style="color:var(--muted);font-size:12px;">Nessuna playlist trovata.</p>';
        return;
      }

      ui.playlistsGrid.innerHTML = '';
      data.items.forEach(pl => {
        const card = document.createElement('div');
        card.className = 'playlist-card';
        card.dataset.uri = pl.uri;

        const img = pl.images && pl.images[0] ? pl.images[0].url : '';
        card.innerHTML = `
          ${img ? `<img class="playlist-card-thumb" src="${img}" alt="" loading="lazy" />` : '<div class="playlist-card-thumb" style="background:var(--bg3);border-radius:2px;aspect-ratio:1"></div>'}
          <div class="playlist-card-name">${escapeHtml(pl.name)}</div>
          <div class="playlist-card-count">${pl.tracks.total} brani</div>
        `;

        card.addEventListener('click', () => launchPlaylist(pl.id));
        ui.playlistsGrid.appendChild(card);
      });
    } catch (e) {
      toast('Errore caricamento playlist', true);
    }
  }

  // ── Avvia una playlist ────────────────────────────────────────
  async function launchPlaylist(idOrInput) {
    if (!Player.isReady()) {
      toast('Player non ancora pronto, attendi…', true);
      return;
    }

    setPlayerStatus('', '…');
    showScreen('player');
    ui.voidLabel.textContent = 'caricamento…';

    try {
      const total = await Player.startPlaylist(idOrInput);
      setPlayerStatus('active', 'in riproduzione');
      setPlayIcon(true);
      updateCounter();
      toast(`${total} brani in coda`);
    } catch (e) {
      setPlayerStatus('error', 'errore');
      ui.voidLabel.textContent = 'errore';
      toast(e.message, true);
    }
  }

  // ── Escape HTML ───────────────────────────────────────────────
  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Player callbacks ──────────────────────────────────────────
  function setupPlayerCallbacks() {
    Player.on('onReady', () => {
      toast('Player pronto');
    });

    Player.on('onStateChange', state => {
      if (!state) return;
      const isPlaying = !state.paused;
      setPlayIcon(isPlaying);
      setPlayerStatus(isPlaying ? 'active' : '', isPlaying ? 'in riproduzione' : 'in pausa');
      updateProgress(state.position, state.duration);
      updateCounter();
    });

    Player.on('onError', msg => {
      toast(msg, true);
      setPlayerStatus('error', 'errore');
    });
  }

  // ── Event listeners ───────────────────────────────────────────
  function bindEvents() {
    ui.btnLogin.addEventListener('click', () => Auth.login());

    ui.btnLogout.addEventListener('click', () => {
      if (confirm('Disconnettersi da Spotify?')) Auth.logout();
    });

    ui.btnBack.addEventListener('click', () => {
      showScreen('playlists');
    });

    ui.btnPlay.addEventListener('click', () => Player.togglePlay());
    ui.btnNext.addEventListener('click', () => { Player.next(); updateCounter(); });
    ui.btnPrev.addEventListener('click', () => { Player.prev(); updateCounter(); });

    ui.volumeSlider.addEventListener('input', e => {
      Player.setVolume(parseInt(e.target.value));
    });

    ui.btnLoadUri.addEventListener('click', () => {
      const val = ui.inputUri.value.trim();
      if (!val) { toast('Incolla un URL o URI Spotify', true); return; }
      launchPlaylist(val);
    });

    ui.inputUri.addEventListener('keydown', e => {
      if (e.key === 'Enter') ui.btnLoadUri.click();
    });

    // Click sulla progress bar per seek
    ui.progressTrack.addEventListener('click', async e => {
      const rect = ui.progressTrack.getBoundingClientRect();
      const pct = (e.clientX - rect.left) / rect.width;
      // Non esponiamo seek per non rivelare la posizione, ma il click rimbalza
      // (design intenzionale: non puoi fare seek perché rovineresti il "blind" experience)
    });
  }

  // ── Init ──────────────────────────────────────────────────────
  async function init() {
    bindEvents();
    setupPlayerCallbacks();

    // Gestione callback OAuth
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const error = params.get('error');

    if (error) {
      toast('Autenticazione annullata', true);
      showScreen('login');
      return;
    }

    if (code) {
      try {
        await Auth.exchangeCode(code);
        await afterLogin();
      } catch (e) {
        toast('Errore login: ' + e.message, true);
        showScreen('login');
      }
      return;
    }

    if (Auth.isLoggedIn()) {
      await afterLogin();
    } else {
      showScreen('login');
    }
  }

  async function afterLogin() {
    showScreen('playlists');
    loadUserPlaylists();
    // Inizializza player in background
    try {
      await Player.init();
    } catch (e) {
      toast('Impossibile inizializzare il player', true);
    }
  }

  return { init };
})();

// ── Avvio ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.init());
