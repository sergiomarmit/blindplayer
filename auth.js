const Auth = (() => {
  const STORAGE_KEY = 'bp_token';
  const VERIFIER_KEY = 'bp_cv';
  const STATE_KEY    = 'bp_state';
  const TV_KEY       = 'bp_tv'; // token version

  function randomString(len) {
    len = len || 64;
    var arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    return Array.from(arr, function(b) { return b.toString(16).padStart(2,'0'); }).join('').slice(0, len);
  }

  async function sha256(plain) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(plain));
  }

  function base64urlEncode(buf) {
    return btoa(String.fromCharCode.apply(null, new Uint8Array(buf)))
      .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  }

  async function generateChallenge(verifier) {
    return base64urlEncode(await sha256(verifier));
  }

  async function login(forceDialog) {
    var verifier  = randomString(64);
    var state     = randomString(16);
    var challenge = await generateChallenge(verifier);
    sessionStorage.setItem(VERIFIER_KEY, verifier);
    sessionStorage.setItem(STATE_KEY, state);
    var params = new URLSearchParams({
      client_id:             CONFIG.CLIENT_ID,
      response_type:         'code',
      redirect_uri:          CONFIG.REDIRECT_URI,
      code_challenge_method: 'S256',
      code_challenge:        challenge,
      state:                 state,
      scope:                 CONFIG.SCOPES,
      show_dialog:           forceDialog ? 'true' : 'false',
    });
    window.location.href = CONFIG.SPOTIFY_AUTH_URL + '?' + params.toString();
  }

  async function exchangeCode(code) {
    var verifier = sessionStorage.getItem(VERIFIER_KEY);
    if (!verifier) throw new Error('Code verifier mancante');
    var res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     CONFIG.CLIENT_ID,
        grant_type:    'authorization_code',
        code:          code,
        redirect_uri:  CONFIG.REDIRECT_URI,
        code_verifier: verifier,
      }).toString(),
    });
    if (!res.ok) {
      var err = await res.json().catch(function() { return {}; });
      throw new Error(err.error_description || 'Token exchange fallita');
    }
    var data = await res.json();
    saveToken(data);
    // Salva la versione corrente degli scope
    localStorage.setItem(TV_KEY, String(CONFIG.TOKEN_VERSION));
    sessionStorage.removeItem(VERIFIER_KEY);
    sessionStorage.removeItem(STATE_KEY);
    window.history.replaceState({}, document.title, window.location.pathname);
    return data.access_token;
  }

  async function refresh() {
    var token = loadToken();
    if (!token || !token.refresh_token) return null;
    var res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     CONFIG.CLIENT_ID,
        grant_type:    'refresh_token',
        refresh_token: token.refresh_token,
      }).toString(),
    });
    if (!res.ok) { logout(); return null; }
    var data = await res.json();
    saveToken(Object.assign({}, data, { refresh_token: data.refresh_token || token.refresh_token }));
    return data.access_token;
  }

  function saveToken(data) {
    var expiry = Date.now() + data.expires_in * 1000;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.assign({}, data, { expiry: expiry })));
  }

  function loadToken() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); }
    catch (e) { return null; }
  }

  async function getAccessToken() {
    var token = loadToken();
    if (!token) return null;
    if (Date.now() > token.expiry - 60000) return await refresh();
    return token.access_token;
  }

  function logout() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(TV_KEY);
    window.location.href = window.location.pathname;
  }

  // Controlla se il token esiste ed è della versione giusta
  function isLoggedIn() {
    if (!loadToken()) return false;
    var savedVersion = parseInt(localStorage.getItem(TV_KEY) || '0', 10);
    if (savedVersion < CONFIG.TOKEN_VERSION) {
      // Token vecchio — pulisci silenziosamente, l'utente dovrà rifare il login
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(TV_KEY);
      return false;
    }
    return true;
  }

  async function apiGet(path) {
    var token = await getAccessToken();
    if (!token) throw new Error('Non autenticato');
    var res = await fetch(CONFIG.SPOTIFY_API_BASE + path, {
      headers: { Authorization: 'Bearer ' + token },
    });
    if (res.status === 401) {
      var refreshed = await refresh();
      if (!refreshed) { logout(); return null; }
      return apiGet(path);
    }
    if (!res.ok) {
      var err = await res.json().catch(function() { return {}; });
      throw new Error((err.error && err.error.message) || ('Errore API ' + res.status));
    }
    return res.json();
  }

  return { login: login, exchangeCode: exchangeCode, getAccessToken: getAccessToken, logout: logout, isLoggedIn: isLoggedIn, apiGet: apiGet };
})();
