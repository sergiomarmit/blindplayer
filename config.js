const CONFIG = {
  CLIENT_ID: '5e3887177f2b42d6afd84308b61ff6fd',

  REDIRECT_URI: (function() {
    var host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'http://' + window.location.host + '/';
    }
    return 'https://sergiomarmit.github.io/blindplayer/';
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

  // Incrementa questo numero ogni volta che aggiungi nuovi scope.
  // Se il token salvato ha una versione precedente, viene invalidato automaticamente.
  TOKEN_VERSION: 3,

  SPOTIFY_AUTH_URL: 'https://accounts.spotify.com/authorize',
  SPOTIFY_API_BASE: 'https://api.spotify.com/v1',
};
