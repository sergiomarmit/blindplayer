// ─── PLAYER — Spotify Web Playback SDK ────────────────────────────

const Player = (() => {
  let _player = null;
  let _deviceId = null;

  let _tracks = [];
  let _currentIndex = 0;
  let _progressInterval = null;
  let _initPromise = null;
  let _busy = false;
  let _trackCount = 0;

  const callbacks = {
    onReady: () => {},
    onStateChange: () => {},
    onError: () => {},
  };

  // ── Fisher-Yates shuffle ─────────────────────────────────────
  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ── Estrai playlist ID da URL o URI (robusto) ─────────────────
  function extractPlaylistId(input) {
    input = input.trim();
    // URI Spotify: spotify:playlist:ID
    const uriMatch = input.match(/spotify:playlist:([A-Za-z0-9]+)/);
    if (uriMatch) return uriMatch[1];
    // URL open.spotify.com/playlist/ID (ignora ?si= e tutto dopo)
    const urlMatch = input.match(/playlist\/([A-Za-z0-9]+)/);
    if (urlMatch) return urlMatch[1];
    // ID grezzo 22 caratteri
    if (/^[A-Za-z0-9]{22}$/.test(input)) return input;
    return null;
  }

  // ── Avvia playlist via context_uri (no lettura brani, no 403) ──────
  async function _playContext(playlistUri, shuffle) {
    const token = await Auth.getAccessToken();
    if (!token || !_deviceId) throw new Error('Player non pronto');

    // Attiva shuffle
    await fetch('https://api.spotify.com/v1/me/player/shuffle?state=' + (shuffle ? 'true' : 'false') + '&device_id=' + _deviceId, {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + token },
    });

    // Avvia la playlist come contesto
    const res = await fetch('https://api.spotify.com/v1/me/player/play?device_id=' + _deviceId, {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ context_uri: playlistUri, offset: { position: Math.floor(Math.random() * 50) } }),
    });

    if (!res.ok && res.status !== 204 && res.status !== 202) {
      const err = await res.json().catch(() => ({}));
      throw new Error('Playback: ' + (err.error?.message || 'HTTP ' + res.status));
    }
  }

  // ── Init SDK — gestisce correttamente il timing del callback globale ──
  function init() {
    // Evita init multipli
    if (_initPromise) return _initPromise;

    _initPromise = new Promise((resolve, reject) => {

      async function setupPlayer() {
        const token = await Auth.getAccessToken();
        if (!token) { reject(new Error('Token non disponibile')); return; }

        _player = new Spotify.Player({
          name: 'BLIND PLAYER',
          getOAuthToken: async cb => {
            const t = await Auth.getAccessToken();
            cb(t);
          },
          volume: 0.8,
        });

        _player.addListener('ready', ({ device_id }) => {
          _deviceId = device_id;
          callbacks.onReady(device_id);
          resolve(device_id);
        });

        _player.addListener('not_ready', ({ device_id }) => {
          console.warn('Player not ready', device_id);
          _deviceId = null;
        });

        _player.addListener('player_state_changed', state => {
          if (!state) return;
          callbacks.onStateChange(state);
          // Auto-avanza quando un brano finisce
          if (
            !state.paused &&
            state.position === 0 &&
            state.track_window.previous_tracks.length > 0
          ) {
            _handleTrackEnd();
          }
        });

        _player.addListener('initialization_error', ({ message }) => {
          callbacks.onError('Init error: ' + message);
          reject(new Error(message));
        });
        _player.addListener('authentication_error', ({ message }) => {
          callbacks.onError('Auth error: ' + message);
        });
        _player.addListener('account_error', ({ message }) => {
          callbacks.onError('Richiede Spotify Premium');
        });
        _player.addListener('playback_error', ({ message }) => {
          callbacks.onError('Playback error: ' + message);
        });

        const connected = await _player.connect();
        if (!connected) {
          reject(new Error('Connessione player fallita'));
        }
      }

      // Il callback DEVE essere impostato prima che arrivi la chiamata dall'SDK
      // Se Spotify SDK è già stato caricato chiama direttamente, altrimenti aspetta
      if (window.Spotify && window.Spotify.Player) {
        setupPlayer();
      } else {
        // Salva eventuale callback precedente (non sovrascrivere se già esiste)
        const prev = window.onSpotifyWebPlaybackSDKReady;
        window.onSpotifyWebPlaybackSDKReady = () => {
          if (prev) prev();
          setupPlayer();
        };
      }

      // Timeout di sicurezza: se SDK non risponde in 15s
      setTimeout(() => {
        if (!_deviceId) reject(new Error('Timeout: SDK Spotify non risponde'));
      }, 15000);
    });

    return _initPromise;
  }

  // ── Avvia riproduzione da playlist ────────────────────────────
  async function startPlaylist(input) {
    const id = extractPlaylistId(input);
    if (!id) throw new Error('URL, URI o ID playlist non valido');

    if (!_deviceId) await init();

    const playlistUri = 'spotify:playlist:' + id;
    await _playContext(playlistUri, true);
    _tracks = [playlistUri]; // segnaposto per getTrackInfo
    _currentIndex = 0;
    _startProgressPolling();
    return '∞'; // non conosciamo il totale senza leggere i brani
  }

  // ── Riproduci una traccia sul device corrente ─────────────────
  async function _playTrack(uri) {
    if (_busy) return;
    _busy = true;
    try {
      const token = await Auth.getAccessToken();
      if (!token) throw new Error('Token non disponibile');
      if (!_deviceId) throw new Error('Player non pronto, ricarica la pagina');

      const res = await fetch(
        `https://api.spotify.com/v1/me/player/play?device_id=${_deviceId}`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ uris: [uri] }),
        }
      );

      if (!res.ok && res.status !== 204 && res.status !== 202) {
        const err = await res.json().catch(() => ({}));
        throw new Error('Playback: ' + (err.error?.message || `HTTP ${res.status}`));
      }
    } finally {
      // Rilascia il lock dopo 1.5s per ignorare l'evento state_changed a position=0
      setTimeout(() => { _busy = false; }, 1500);
    }
  }

  // L'auto-advance è gestito da Spotify internamente con context_uri

  // ── Helpers REST per pause/resume (evita togglePlay SDK che richiede lista interna) ──
  async function _apiPut(path, body) {
    const token = await Auth.getAccessToken();
    const res = await fetch(`https://api.spotify.com/v1${path}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res;
  }

  // ── Controlli pubblici ────────────────────────────────────────
  async function togglePlay() {
    if (!_deviceId) return;
    // Leggi stato corrente dall'SDK, poi usa REST per pause/resume
    const state = _player ? await _player.getCurrentState() : null;
    const isPlaying = state ? !state.paused : false;
    if (isPlaying) {
      await fetch(`https://api.spotify.com/v1/me/player/pause?device_id=${_deviceId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${await Auth.getAccessToken()}` },
      });
    } else {
      await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${_deviceId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${await Auth.getAccessToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
    }
  }

  async function next() {
    const token = await Auth.getAccessToken();
    await fetch('https://api.spotify.com/v1/me/player/next?device_id=' + _deviceId, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
    });
  }

  async function prev() {
    const token = await Auth.getAccessToken();
    await fetch('https://api.spotify.com/v1/me/player/previous?device_id=' + _deviceId, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
    });
  }

  async function setVolume(val) {
    if (_player) await _player.setVolume(val / 100);
  }

  function getTrackInfo() {
    // Con context_uri non conosciamo il totale — mostriamo solo il progressivo
    return { current: _trackCount, total: '?' };
  }

  // ── Progress polling ──────────────────────────────────────────
  function _startProgressPolling() {
    _stopProgressPolling();
    _progressInterval = setInterval(async () => {
      if (!_player) return;
      const state = await _player.getCurrentState();
      if (state) callbacks.onStateChange(state);
    }, 500);
  }

  function _stopProgressPolling() {
    if (_progressInterval) { clearInterval(_progressInterval); _progressInterval = null; }
  }

  function on(event, cb) { callbacks[event] = cb; }
  function isReady() { return !!_deviceId; }

  return { init, startPlaylist, togglePlay, next, prev, setVolume, getTrackInfo, on, isReady, extractPlaylistId };
})();
