// ─── PLAYER — Spotify Web Playback SDK ────────────────────────────

const Player = (() => {
  let _player = null;
  let _deviceId = null;
  let _state = null;

  let _tracks = [];        // array shuffled dei brani
  let _currentIndex = 0;
  let _playlistUri = null;
  let _progressInterval = null;

  // Callbacks esposti all'app
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

  // ── Carica tutti i brani di una playlist ─────────────────────
  async function loadPlaylistTracks(playlistId) {
    let tracks = [];
    let url = `/playlists/${playlistId}/tracks?limit=100&fields=next,items(track(uri,id))`;

    while (url) {
      const data = await Auth.apiGet(url);
      if (!data) break;
      const valid = data.items
        .filter(i => i.track && i.track.uri && !i.track.uri.includes('local'))
        .map(i => i.track.uri);
      tracks = tracks.concat(valid);
      // next è un URL completo, estraiamo solo il path+query
      if (data.next) {
        url = data.next.replace(CONFIG.SPOTIFY_API_BASE, '');
      } else {
        url = null;
      }
    }

    return shuffle(tracks);
  }

  // ── Estrai playlist ID da URL o URI ──────────────────────────
  function extractPlaylistId(input) {
    input = input.trim();
    // URI: spotify:playlist:xxxxx
    const uriMatch = input.match(/spotify:playlist:([A-Za-z0-9]+)/);
    if (uriMatch) return uriMatch[1];
    // URL: open.spotify.com/playlist/xxxxx
    const urlMatch = input.match(/playlist\/([A-Za-z0-9]+)/);
    if (urlMatch) return urlMatch[1];
    // ID diretto
    if (/^[A-Za-z0-9]{22}$/.test(input)) return input;
    return null;
  }

  // ── Inizializza SDK ───────────────────────────────────────────
  async function init() {
    return new Promise((resolve, reject) => {
      window.onSpotifyWebPlaybackSDKReady = async () => {
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

        _player.addListener('not_ready', () => {
          callbacks.onError('Dispositivo non disponibile');
        });

        _player.addListener('player_state_changed', state => {
          _state = state;
          callbacks.onStateChange(state);
          if (state && !state.paused && state.position === 0 && state.track_window.previous_tracks.length > 0) {
            // Traccia terminata, passa alla prossima
            _handleTrackEnd();
          }
        });

        _player.addListener('initialization_error', e => callbacks.onError(e.message));
        _player.addListener('authentication_error', e => {
          callbacks.onError('Errore autenticazione: ' + e.message);
          Auth.logout();
        });
        _player.addListener('account_error', () => {
          callbacks.onError('Richiede Spotify Premium');
        });
        _player.addListener('playback_error', e => callbacks.onError(e.message));

        await _player.connect();
      };

      // Se SDK già caricato
      if (window.Spotify) {
        window.onSpotifyWebPlaybackSDKReady();
      }
    });
  }

  // ── Avvia playlist ────────────────────────────────────────────
  async function startPlaylist(input) {
    const id = extractPlaylistId(input);
    if (!id) throw new Error('URL o URI playlist non valido');

    _playlistUri = input;
    _tracks = await loadPlaylistTracks(id);
    if (!_tracks.length) throw new Error('Playlist vuota o non accessibile');

    _currentIndex = 0;
    await _playTrack(_tracks[0]);
    _startProgressPolling();
    return _tracks.length;
  }

  // ── Riproduci traccia specifica ───────────────────────────────
  async function _playTrack(uri) {
    const token = await Auth.getAccessToken();
    if (!token || !_deviceId) throw new Error('Player non pronto');

    const res = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${_deviceId}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ uris: [uri] }),
    });

    if (!res.ok && res.status !== 204) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Playback error ${res.status}`);
    }
  }

  function _handleTrackEnd() {
    _currentIndex = (_currentIndex + 1) % _tracks.length;
    _playTrack(_tracks[_currentIndex]);
  }

  // ── Controlli pubblici ────────────────────────────────────────
  async function togglePlay() {
    if (!_player) return;
    await _player.togglePlay();
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
    return {
      current: _currentIndex + 1,
      total: _tracks.length,
    };
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
    if (_progressInterval) clearInterval(_progressInterval);
  }

  function on(event, cb) {
    callbacks[event] = cb;
  }

  function isReady() {
    return !!_deviceId;
  }

  return {
    init,
    startPlaylist,
    togglePlay,
    next,
    prev,
    setVolume,
    getTrackInfo,
    on,
    isReady,
    extractPlaylistId,
  };
})();
