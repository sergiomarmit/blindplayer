// ─── PLAYER — Spotify Web Playback SDK ────────────────────────────

const Player = (() => {
  let _player = null;
  let _deviceId = null;

  let _tracks = [];
  let _currentIndex = 0;
  let _progressInterval = null;
  let _initPromise = null;

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

  // ── Carica tutti i brani (senza fields filter per evitare bug paginazione) ──
  async function loadPlaylistTracks(playlistId) {
    let tracks = [];
    // NON usiamo ?fields= perché tronca il campo "next" in alcune versioni API
    let path = `/playlists/${playlistId}/tracks?limit=100`;

    while (path) {
      const data = await Auth.apiGet(path);
      if (!data || !data.items) break;

      const valid = data.items
        .filter(i => i && i.track && i.track.uri && i.track.type === 'track')
        .map(i => i.track.uri);
      tracks = tracks.concat(valid);

      if (data.next) {
        // data.next è URL completo: estrai solo path + query
        try {
          const u = new URL(data.next);
          path = u.pathname + u.search;
        } catch {
          path = null;
        }
      } else {
        path = null;
      }
    }

    return shuffle(tracks);
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

    // Assicurati che il player sia pronto
    if (!_deviceId) {
      await init();
    }

    _tracks = await loadPlaylistTracks(id);
    if (!_tracks.length) throw new Error('Playlist vuota o non accessibile');

    _currentIndex = 0;
    await _playTrack(_tracks[0]);
    _startProgressPolling();
    return _tracks.length;
  }

  // ── Riproduci una traccia sul device corrente ─────────────────
  async function _playTrack(uri) {
    const token = await Auth.getAccessToken();
    if (!token) throw new Error('Token non disponibile');
    if (!_deviceId) throw new Error('Player non pronto, ricarica la pagina');

    const res = await fetch(
      `https://api.spotify.com/v1/me/player/play?device_id=${_deviceId}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ uris: [uri] }),
      }
    );

    // 204 = OK senza body, 202 = accepted
    if (!res.ok && res.status !== 204 && res.status !== 202) {
      const err = await res.json().catch(() => ({}));
      const msg = err.error?.message || `HTTP ${res.status}`;
      throw new Error('Playback: ' + msg);
    }
  }

  function _handleTrackEnd() {
    _currentIndex = (_currentIndex + 1) % _tracks.length;
    _playTrack(_tracks[_currentIndex]).catch(e => callbacks.onError(e.message));
  }

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
    if (!_tracks.length) return;
    _currentIndex = (_currentIndex + 1) % _tracks.length;
    await _playTrack(_tracks[_currentIndex]);
  }

  async function prev() {
    if (!_tracks.length) return;
    _currentIndex = (_currentIndex - 1 + _tracks.length) % _tracks.length;
    await _playTrack(_tracks[_currentIndex]);
  }

  async function setVolume(val) {
    if (_player) await _player.setVolume(val / 100);
  }

  function getTrackInfo() {
    return { current: _currentIndex + 1, total: _tracks.length };
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
