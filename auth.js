// ─── AUTH — OAuth 2.0 PKCE Flow ───────────────────────────────────

const Auth = (() => {
  const STORAGE_KEY = 'bp_token';
  const VERIFIER_KEY = 'bp_cv';
  const STATE_KEY = 'bp_state';

  // ── PKCE helpers ──────────────────────────────────────────────
  function randomString(len = 64) {
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('').slice(0, len);
  }

  async function sha256(plain) {
    const enc = new TextEncoder().encode(plain);
    const hash = await crypto.subtle.digest('SHA-256', enc);
    return hash;
  }

  function base64urlEncode(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  async function generateChallenge(verifier) {
    const hashed = await sha256(verifier);
    return base64urlEncode(hashed);
  }

  // ── Avvio login ───────────────────────────────────────────────
  async function login() {
    const verifier = randomString(64);
    const state = randomString(16);
    const challenge = await generateChallenge(verifier);

    sessionStorage.setItem(VERIFIER_KEY, verifier);
    sessionStorage.setItem(STATE_KEY, state);

    const params = new URLSearchParams({
      client_id: CONFIG.CLIENT_ID,
      response_type: 'code',
      redirect_uri: CONFIG.REDIRECT_URI,
      code_challenge_method: 'S256',
      code_challenge: challenge,
      state,
      scope: CONFIG.SCOPES,
      show_dialog: 'false',
    });

    window.location.href = `${CONFIG.SPOTIFY_AUTH_URL}?${params.toString()}`;
  }

  // ── Scambio code → token ──────────────────────────────────────
  async function exchangeCode(code) {
    const verifier = sessionStorage.getItem(VERIFIER_KEY);
    if (!verifier) throw new Error('Code verifier mancante');

    const body = new URLSearchParams({
      client_id: CONFIG.CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: CONFIG.REDIRECT_URI,
      code_verifier: verifier,
    });

    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error_description || 'Token exchange fallita');
    }

    const data = await res.json();
    saveToken(data);

    // Pulizia
    sessionStorage.removeItem(VERIFIER_KEY);
    sessionStorage.removeItem(STATE_KEY);

    // Rimuovi i parametri dall'URL
    window.history.replaceState({}, document.title, window.location.pathname);

    return data.access_token;
  }

  // ── Refresh token ─────────────────────────────────────────────
  async function refresh() {
    const token = loadToken();
    if (!token || !token.refresh_token) return null;

    const body = new URLSearchParams({
      client_id: CONFIG.CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token,
    });

    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) { logout(); return null; }

    const data = await res.json();
    saveToken({ ...data, refresh_token: data.refresh_token || token.refresh_token });
    return data.access_token;
  }

  // ── Storage ───────────────────────────────────────────────────
  function saveToken(data) {
    const expiry = Date.now() + data.expires_in * 1000;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...data, expiry }));
  }

  function loadToken() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch { return null; }
  }

  async function getAccessToken() {
    let token = loadToken();
    if (!token) return null;
    if (Date.now() > token.expiry - 60000) {
      const newToken = await refresh();
      return newToken;
    }
    return token.access_token;
  }

  function logout() {
    localStorage.removeItem(STORAGE_KEY);
    window.location.href = window.location.pathname;
  }

  function isLoggedIn() {
    return !!loadToken();
  }

  // ── API helper ────────────────────────────────────────────────
  async function apiGet(path) {
    const token = await getAccessToken();
    if (!token) throw new Error('Non autenticato');

    const res = await fetch(`${CONFIG.SPOTIFY_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 401) {
      const refreshed = await refresh();
      if (!refreshed) { logout(); return null; }
      return apiGet(path);
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `API error ${res.status}`);
    }

    return res.json();
  }

  return { login, exchangeCode, getAccessToken, logout, isLoggedIn, apiGet };
})();
