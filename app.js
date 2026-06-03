const App = (() => {

  const screens = {
    login:     document.getElementById('screen-login'),
    playlists: document.getElementById('screen-playlists'),
    player:    document.getElementById('screen-player'),
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

  var _toastTimer = null;
  function toast(msg, isError) {
    clearTimeout(_toastTimer);
    ui.toast.textContent = msg;
    ui.toast.className = 'toast show' + (isError ? ' error' : '');
    _toastTimer = setTimeout(function() { ui.toast.className = 'toast'; }, 4000);
  }

  function showScreen(name) {
    Object.keys(screens).forEach(function(k) {
      screens[k].classList.toggle('active', k === name);
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
    var info = Player.getTrackInfo();
    ui.trackNum.textContent   = info.current || '\u2014';
    ui.trackTotal.textContent = info.total   || '\u2014';
  }

  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  async function loadUserPlaylists() {
    ui.playlistsGrid.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';
    try {
      var data = await Auth.apiGet('/me/playlists?limit=50');
      if (!data || !data.items || !data.items.length) {
        ui.playlistsGrid.innerHTML = '<p style="color:var(--muted);font-size:12px;grid-column:1/-1">Nessuna playlist trovata.</p>';
        return;
      }
      ui.playlistsGrid.innerHTML = '';
      data.items.forEach(function(pl) {
        if (!pl || !pl.id) return;
        var card = document.createElement('div');
        card.className = 'playlist-card';
        var img   = pl.images && pl.images[0] ? pl.images[0].url : '';
        var count = (pl.tracks && pl.tracks.total != null) ? pl.tracks.total : '?';
        card.innerHTML =
          (img ? '<img class="playlist-card-thumb" src="' + img + '" alt="" loading="lazy" />'
               : '<div class="playlist-card-thumb" style="background:var(--bg3);border-radius:2px;aspect-ratio:1/1;margin-bottom:10px"></div>') +
          '<div class="playlist-card-name">' + escHtml(pl.name || 'Playlist') + '</div>' +
          '<div class="playlist-card-count">' + count + ' brani</div>';
        card.addEventListener('click', function() { launchPlaylist(pl.id); });
        ui.playlistsGrid.appendChild(card);
      });
    } catch (e) {
      console.error('[BP] loadUserPlaylists error:', e);
      ui.playlistsGrid.innerHTML = '<p style="color:var(--muted);font-size:12px;grid-column:1/-1">Errore caricamento playlist: ' + escHtml(e.message) + '</p>';
    }
  }

  var _launching = false;
  async function launchPlaylist(input) {
    if (_launching) return;
    _launching = true;
    showScreen('player');
    setStatus('', 'connessione\u2026');
    ui.voidLabel.textContent = 'connessione\u2026';
    setPlayIcon(false);
    try {
      if (!Player.isReady()) {
        ui.voidLabel.textContent = 'inizializzazione\u2026';
        await Player.init();
      }
      ui.voidLabel.textContent = 'caricamento\u2026';
      var total = await Player.startPlaylist(input);
      setStatus('active', 'in riproduzione');
      setPlayIcon(true);
      updateCounter();
      toast(total + ' brani in coda');
    } catch (e) {
      console.error('[BP] launchPlaylist error:', e);
      setStatus('error', 'errore');
      ui.voidLabel.textContent = 'errore';
      toast(e.message, true);
    } finally {
      _launching = false;
    }
  }

  function setupPlayerCallbacks() {
    Player.on('onReady', function() { toast('Player pronto \u2713'); });
    Player.on('onStateChange', function(state) {
      if (!state) return;
      var playing = !state.paused;
      setPlayIcon(playing);
      setStatus(playing ? 'active' : '', playing ? 'in riproduzione' : 'in pausa');
      updateProgress(state.position, state.duration);
      updateCounter();
    });
    Player.on('onError', function(msg) {
      toast(msg, true);
      setStatus('error', 'errore');
      console.error('[BP] Player error:', msg);
    });
  }

  function bindEvents() {
    ui.btnLogin.addEventListener('click', function() { Auth.login(false); });
    ui.btnLogout.addEventListener('click', function() {
      if (confirm('Disconnettersi?')) Auth.logout();
    });
    ui.btnBack.addEventListener('click', function() { showScreen('playlists'); });
    ui.btnPlay.addEventListener('click', function() { Player.togglePlay(); });
    ui.btnNext.addEventListener('click', async function() {
      try { await Player.next(); updateCounter(); } catch(e) { toast(e.message, true); }
    });
    ui.btnPrev.addEventListener('click', async function() {
      try { await Player.prev(); updateCounter(); } catch(e) { toast(e.message, true); }
    });
    ui.volumeSlider.addEventListener('input', function(e) {
      Player.setVolume(parseInt(e.target.value, 10));
    });
    ui.btnLoadUri.addEventListener('click', function() {
      var val = ui.inputUri.value.trim();
      if (!val) { toast('Incolla un URL o URI Spotify', true); return; }
      var id = Player.extractPlaylistId(val);
      if (!id) { toast('Link non valido \u2014 usa un URL o URI Spotify', true); return; }
      launchPlaylist(val);
    });
    ui.inputUri.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') ui.btnLoadUri.click();
    });
  }

  async function init() {
    bindEvents();
    setupPlayerCallbacks();

    var params = new URLSearchParams(window.location.search);
    var code   = params.get('code');
    var error  = params.get('error');

    if (error) {
      toast('Autenticazione annullata', true);
      showScreen('login');
      return;
    }

    if (code) {
      try {
        await Auth.exchangeCode(code);
        afterLogin();
      } catch (e) {
        toast('Errore login: ' + e.message, true);
        console.error('[BP] exchangeCode error:', e);
        showScreen('login');
      }
      return;
    }

    if (Auth.isLoggedIn()) {
      afterLogin();
    } else {
      showScreen('login');
    }
  }

  function afterLogin() {
    showScreen('playlists');
    Player.init().catch(function(e) {
      console.warn('[BP] Player init warning:', e.message);
    });
    loadUserPlaylists();
  }

  return { init: init };
})();

document.addEventListener('DOMContentLoaded', function() { App.init(); });
