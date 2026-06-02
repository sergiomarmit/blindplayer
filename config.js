// ─── CONFIGURAZIONE SPOTIFY ───────────────────────────────────────
// Modifica REDIRECT_URI dopo il deploy su GitHub Pages

const CONFIG = {
  CLIENT_ID: '5e3887177f2b42d6afd84308b61ff6fd',

  // In sviluppo locale usa localhost, dopo il deploy usa l'URL di GitHub Pages
  REDIRECT_URI: (() => {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return `http://${window.location.host}/`;
    }
    // GitHub Pages URL: https://sergiomarmit.github.io/blindplayer/
    return `https://sergiomarmit.github.io/blindplayer/`;
  })(),

  SCOPES: [
    'streaming',
    'user-read-email',
    'user-read-private',
    'user-read-playback-state',
    'user-modify-playback-state',
    'playlist-read-private',
    'playlist-read-collaborative',
  ].join(' '),

  SPOTIFY_AUTH_URL: 'https://accounts.spotify.com/authorize',
  SPOTIFY_API_BASE: 'https://api.spotify.com/v1',
};
