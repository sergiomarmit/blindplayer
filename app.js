// ─── APP — Orchestrazione UI ───────────────────────────────────────

const App = (() => {

  const screens = {
    login: document.getElementById('screen-login'),
    playlists: document.getElementById('screen-playlists'),
    player: document.getElementById('screen-player'),
  };

  const ui = {
    btnLogin:      document.getElementById('btn-login'),
    btnLogout:     document.getElementById('btn-logout'),
    btnBack:       document.getElementById('btn-back'),
    btnPlay:       document.getElementById('btn-play'),
    btnNext:       document.getElementById('btn-next'),
    btnPrev:       document.getElementById('btn-prev'),
    iconPlay:      document.getElementById('icon-play'),
    iconPause:     document.getElementById('icon-pause'),
    statusDot:     document.getElementById('status-dot'),
    statusText:    document.getElementById('status-text'),
    voidCircle:    document.getElementById('void-circle'),
    voidLabel:     document.getElementById('void-label'),
    progressFill:  document.getElementById('progress-fill'),
    volumeSlider:  document.getElementById('volume-slider'),
    trackNum:      document.getElementById('track-num'),
    trackTotal:    document.getElementById('track-total'),
    playlistsGrid: document.getElementById('playlists-grid'),
    inputUri:      document.getElementById('input-playlist-uri'),
    btnLoadUri:    document.getElementById('btn-load-uri'),
    toast:         document.getElementById('toast'),
  };

  // ── Toast ─────────────────────────────────────────────────────
  let _toastTimer = null;
  function toast(msg, isError = false) {
    clearTimeout(_toastTimer);
    ui.toast.textContent = msg;
    ui.toast.className = 'toast show' + (isError ? ' error' : '');
    _toastTimer = setTimeout(() => { ui.toast.className = 'toast'; }, 4000);
  }

  // ── Screen ────────────────────────────────────────────────────
  function showScreen(name) {
    Object.entries(screens).forEach(([k, el]) => {
      el.classList.toggle('active', k === name);
    });
  }

  function setStatus(cls, label) {
    ui.statusDot.className = 'dot ' + cls;
    ui.statusText.textContent = label;
  }

  function setPlayIcon(playing) {
    ui.iconPlay.style.display  = playing ? 'none'  : 'block';
    ui.iconPause.style.display = playing ? 'block' : 'none';
    ui.voidCircle.classList.toggle('playing', playing);
    ui.voidLabel.textContent = playing ? '' : 'pausa';
  }

  function updateProgress(position, duration) {
    if (!duration) return;
    ui.progressFill.style.width = Math.min((position / duration) * 100, 100) + '%';
  }

  function updateCounter() {
    const { current, total } = Player.getTrackInfo();
    ui.trackNum.textContent   = current || '—';
    ui.trackTotal.textContent = total   || '—';
  }

  // ── Carica playlist utente ────────────────────────────────────
  async function loadUserPlaylists() {
    ui.playlistsGrid.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';
    try {
      const data = await Auth.apiGet('/me/playlists?limit=50');
      if (!data || !data.items.length) {
        ui.playlistsGrid.innerHTML = '<p style="color:var(--muted);font-size:12px;grid-column:1/-1">Nessuna playlist trovata.</p>';
        return;
      }
      ui.playlistsGrid.innerHTML = '';
      data.items.forEach(pl => {
        const card = document.createElement('div');
        card.className = 'playlist-card';
        const img = pl.images && pl.images[0] ? pl.images[0].url : '';
        card.innerHTML = `
          ${img
            ? `<img class="playlist-card-thumb" src="${img}" alt="" loading="lazy" />`
            : '<div class="playlist-card-thumb" style="background:var(--bg3);border-radius:2px;aspect-ratio:1/1;margin-bottom:10px"></div>'
          }
          <div class="playlist-card-name">${escHtml(pl.name)}</div>
          <div class="playlist-card-count">${pl.tracks.total} brani</div>
        `;
        card.addEventListener('click', () => launchPlaylist(pl.id));
        ui.playlistsGrid.appendChild(card);
      });
    } catch (e) {
      if (e.message === 'SCOPE_MISMATCH') {
        ui.playlistsGrid.innerHTML = '<p style="color:var(--accent);font-size:12px;grid-column:1/-1;cursor:pointer" id="reauth-msg">Sessione scaduta — clicca qui per ri-autenticarti</p>';
        document.getElementById('reauth-msg')?.addEventListener('click', () => Auth.login(true));
        return;
      }
      toast('Errore caricamento playlist: ' + e.message, true);
    }
  }

  // ── Lancia riproduzione ───────────────────────────────────────
  let _launching = false;
  async function launchPlaylist(input) {
    if (_launching) return;
    _launching = true;

    showScreen('player');
    setStatus('', 'connessione…');
    ui.voidLabel.textContent = 'connessione…';
    setPlayIcon(false);

    try {
      // Aspetta che il player sia pronto (init già in corso in background)
      if (!Player.isReady()) {
        ui.voidLabel.textContent = 'inizializzazione…';
        await Player.init();
      }

      ui.voidLabel.textContent = 'caricamento…';
      const total = await Player.startPlaylist(input);
      setStatus('active', 'in riproduzione');
      setPlayIcon(true);
      updateCounter();
      toast(`${total} brani in coda`);
    } catch (e) {
      if (e.message === 'SCOPE_MISMATCH') {
        toast('Sessione scaduta — ri-autenticazione in corso…', false);
        setTimeout(() => Auth.login(true), 1500);
        return;
      }
      setStatus('error', 'errore');
      ui.voidLabel.textContent = 'errore';
      toast(e.message, true);
      console.error('[BlindPlayer] launchPlaylist error:', e);
    } finally {
      _launching = false;
    }
  }

  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Player callbacks ──────────────────────────────────────────
  function setupPlayerCallbacks() {
    Player.on('onReady', () => {
      toast('Player pronto ✓');
    });

    Player.on('onStateChange', state => {
      if (!state) return;
      const playing = !state.paused;
      setPlayIcon(playing);
      setStatus(playing ? 'active' : '', playing ? 'in riproduzione' : 'in pausa');
      updateProgress(state.position, state.duration);
      updateCounter();
    });

    Player.on('onError', msg => {
      toast(msg, true);
      setStatus('error', 'errore');
      console.error('[BlindPlayer] Player error:', msg);
    });
  }

  // ── Event listeners ───────────────────────────────────────────
  function bindEvents() {
    ui.btnLogin.addEventListener('click', () => Auth.login());

    ui.btnLogout.addEventListener('click', () => {
      if (confirm('Disconnettersi?')) Auth.logout();
    });

    ui.btnBack.addEventListener('click', () => showScreen('playlists'));

    ui.btnPlay.addEventListener('click', () => Player.togglePlay());

    ui.btnNext.addEventListener('click', async () => {
      try { await Player.next(); updateCounter(); }
      catch (e) { toast(e.message, true); }
    });

    ui.btnPrev.addEventListener('click', async () => {
      try { await Player.prev(); updateCounter(); }
      catch (e) { toast(e.message, true); }
    });

    ui.volumeSlider.addEventListener('input', e => {
      Player.setVolume(parseInt(e.target.value, 10));
    });

    ui.btnLoadUri.addEventListener('click', () => {
      const val = ui.inputUri.value.trim();
      if (!val) { toast('Incolla un URL o URI Spotify', true); return; }
      // Valida prima di andare al player
      const id = Player.extractPlaylistId(val);
      if (!id) { toast('Link non valido — usa un URL o URI Spotify', true); return; }
      launchPlaylist(val);
    });

    ui.inputUri.addEventListener('keydown', e => {
      if (e.key === 'Enter') ui.btnLoadUri.click();
    });
  }

  // ── Init principale ───────────────────────────────────────────
  async function init() {
    bindEvents();
    setupPlayerCallbacks();

    const params = new URLSearchParams(window.location.search);
    const code  = params.get('code');
    const error = params.get('error');

    if (error) {
      toast('Autenticazione annullata: ' + error, true);
      showScreen('login');
      return;
    }

    if (code) {
      try {
        await Auth.exchangeCode(code);
        await afterLogin();
      } catch (e) {
        toast('Errore login: ' + e.message, true);
        console.error('[BlindPlayer] exchangeCode error:', e);
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
    // Avvia init player e caricamento playlist in parallelo
    Player.init().catch(e => {
      console.warn('[BlindPlayer] Player init warning:', e.message);
      // Non è fatale qui — verrà ritentato al momento del play
    });
    loadUserPlaylists();
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
