/**
 * DOT • DEB — Continental Mindustry Network Admin API Client
 *
 * Multi-Server Support & Security:
 * 1. Targets Continental Survival, Tower Defence, or Attack independently.
 * 2. Every management action (start, stop, restart, config, kick, ban, console) passes
 *    the selected server parameter so actions never affect other servers.
 * 3. Sessions rely on secure HttpOnly, SameSite cookies with server-side revocation on logout.
 * 4. CSRF protection validates X-CSRF-Token on all modifying requests.
 * 5. Strict command allowlist and shell metacharacter blocking.
 */
(function (global) {
  "use strict";

  // Strict list of safe Mindustry server console commands
  const ALLOWED_COMMANDS = new Set([
    "help",
    "status",
    "say",
    "pause",
    "resume",
    "waves",
    "nextmap",
    "reloadmaps",
    "gameover",
    "host",
    "maps",
    "mods",
    "version",
    "rules",
    "players",
    "bans",
    "save"
  ]);

  // Forbidden shell/injection patterns
  const SHELL_METACHARS = /[;&|`$><\\!]/;

  let cachedCsrfToken = null;

  const AdminAPI = {
    /**
     * Resolves the full URL for an endpoint
     */
    _url(path) {
      const base = (window.CONFIG && window.CONFIG.api && window.CONFIG.api.baseUrl) || "";
      return base + path;
    },

    _getCookie(name) {
      if (typeof document === "undefined") return null;
      const matches = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/([\.$?*|{}\(\)\[\]\\\/\+^])/g, "\\$1") + "=([^;]*)"));
      return matches ? decodeURIComponent(matches[1]) : null;
    },

    /**
     * Retrieve fresh CSRF token from backend
     */
    async getCsrfToken(forceRefresh = false) {
      if (cachedCsrfToken && !forceRefresh) {
        return cachedCsrfToken;
      }
      try {
        const endpoints = (window.CONFIG && window.CONFIG.api && window.CONFIG.api.endpoints) || {};
        const csrfUrl = (endpoints.auth && endpoints.auth.csrf) || "/api/auth/csrf";
        const res = await fetch(this._url(csrfUrl), {
          method: "GET",
          credentials: "include",
          headers: { "Accept": "application/json" }
        });
        if (res.ok) {
          const data = await res.json();
          if (data && data.csrfToken) {
            cachedCsrfToken = data.csrfToken;
            return cachedCsrfToken;
          }
        }
      } catch (err) {
        console.warn("CSRF token fetch note:", err.message);
      }
      return null;
    },

    /**
     * Core Fetch wrapper with timeout, credentials, CSRF, and error handling
     */
    async _request(endpoint, options = {}) {
      const timeoutMs = (window.CONFIG && window.CONFIG.api && window.CONFIG.api.timeoutMs) || 6000;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const defaultHeaders = {
        "Accept": "application/json"
      };

      const method = (options.method || "GET").toUpperCase();

      if (options.body && typeof options.body === "object") {
        defaultHeaders["Content-Type"] = "application/json";
        options.body = JSON.stringify(options.body);
      }

      // Check for CSRF token for state-changing requests
      if (["POST", "PUT", "DELETE"].includes(method)) {
        let csrfToken = cachedCsrfToken || this._getCookie("csrf_token") || this._getCookie("XSRF-TOKEN");
        if (!csrfToken) {
          csrfToken = await this.getCsrfToken();
        }
        if (csrfToken) {
          defaultHeaders["X-CSRF-Token"] = csrfToken;
        }
      }

      const fetchOptions = {
        ...options,
        method,
        headers: { ...defaultHeaders, ...(options.headers || {}) },
        credentials: "include",
        signal: controller.signal
      };

      try {
        const response = await fetch(this._url(endpoint), fetchOptions);
        clearTimeout(timer);

        const contentType = response.headers.get("content-type") || "";
        const isJson = contentType.includes("application/json");
        const data = isJson ? await response.json() : await response.text();

        if (!response.ok) {
          const errMsg = (data && data.message) || (data && data.error) || `Server returned HTTP ${response.status}`;
          return {
            ok: false,
            status: response.status,
            error: errMsg,
            data
          };
        }

        return {
          ok: true,
          status: response.status,
          data
        };
      } catch (err) {
        clearTimeout(timer);
        const isTimeout = err.name === "AbortError";
        return {
          ok: false,
          status: 0,
          error: isTimeout
            ? "Request timed out. The backend server did not respond in time."
            : "Network error: Secure backend is currently unreachable. Ensure your API service is running with valid HTTPS certificates.",
          isNetworkError: true
        };
      }
    },

    /**
     * Authenticate Administrator
     * POST /api/auth/login
     */
    async login(username, password) {
      if (!username || !password) {
        return { ok: false, error: "Please enter both username and password." };
      }

      await this.getCsrfToken(true);

      const endpoints = (window.CONFIG && window.CONFIG.api && window.CONFIG.api.endpoints) || {};
      const loginUrl = (endpoints.auth && endpoints.auth.login) || "/api/auth/login";

      const res = await this._request(loginUrl, {
        method: "POST",
        body: { username, password }
      });

      if (res.ok && res.data && res.data.csrfToken) {
        cachedCsrfToken = res.data.csrfToken;
      }

      return res;
    },

    /**
     * Terminate Session
     * POST /api/auth/logout
     */
    async logout() {
      const endpoints = (window.CONFIG && window.CONFIG.api && window.CONFIG.api.endpoints) || {};
      const logoutUrl = (endpoints.auth && endpoints.auth.logout) || "/api/auth/logout";

      const res = await this._request(logoutUrl, {
        method: "POST"
      });

      cachedCsrfToken = null;
      return res;
    },

    /**
     * Check Session Validity
     * GET /api/auth/session
     */
    async checkSession() {
      const endpoints = (window.CONFIG && window.CONFIG.api && window.CONFIG.api.endpoints) || {};
      const sessionUrl = (endpoints.auth && endpoints.auth.session) || "/api/auth/session";

      return await this._request(sessionUrl, {
        method: "GET"
      });
    },

    /**
     * Get Server Status & Metrics
     */
    async getStatus(serverId = "survival") {
      const endpoints = (window.CONFIG && window.CONFIG.api && window.CONFIG.api.endpoints) || {};
      return await this._request(`${endpoints.status || "/api/mindustry/status"}?server=${encodeURIComponent(serverId)}`, { method: "GET" });
    },

    async getMetrics(serverId = "survival") {
      const endpoints = (window.CONFIG && window.CONFIG.api && window.CONFIG.api.endpoints) || {};
      return await this._request(`${endpoints.metrics || "/api/mindustry/metrics"}?server=${encodeURIComponent(serverId)}`, { method: "GET" });
    },

    /**
     * Server Power Controls (Start / Stop / Restart for target server or EC2 host)
     */
    async controlServer(action, serverId = "survival") {
      const validActions = ["start", "stop", "restart"];
      if (!validActions.includes(action)) {
        return { ok: false, error: `Invalid control action: ${action}` };
      }

      const endpoints = (window.CONFIG && window.CONFIG.api && window.CONFIG.api.endpoints) || {};
      const targetUrl = (endpoints.controls && endpoints.controls[action]) || `/api/mindustry/control/${action}`;

      return await this._request(targetUrl, {
        method: "POST",
        body: { action, server: serverId, timestamp: Date.now() }
      });
    },

    /**
     * Update Server Configuration for target server
     */
    async updateConfig(configData, serverId = "survival") {
      const endpoints = (window.CONFIG && window.CONFIG.api && window.CONFIG.api.endpoints) || {};
      return await this._request(endpoints.config || "/api/mindustry/config", {
        method: "POST",
        body: { ...configData, server: serverId }
      });
    },

    /**
     * Player Management for target server
     */
    async getPlayers(serverId = "survival") {
      const endpoints = (window.CONFIG && window.CONFIG.api && window.CONFIG.api.endpoints) || {};
      return await this._request(`${endpoints.players || "/api/mindustry/players"}?server=${encodeURIComponent(serverId)}`, { method: "GET" });
    },

    async playerAction(action, playerId, reason = "", serverId = "survival") {
      const validActions = ["kick", "ban", "unban"];
      if (!validActions.includes(action)) {
        return { ok: false, error: `Invalid player action: ${action}` };
      }

      const endpoints = (window.CONFIG && window.CONFIG.api && window.CONFIG.api.endpoints) || {};
      return await this._request(endpoints.playerAction || "/api/mindustry/players/action", {
        method: "POST",
        body: { action, target: playerId, reason, server: serverId }
      });
    },

    /**
     * Server Console & Logs for target server
     */
    async getLogs(serverId = "survival", lines = 50) {
      const endpoints = (window.CONFIG && window.CONFIG.api && window.CONFIG.api.endpoints) || {};
      return await this._request(`${endpoints.logs || "/api/mindustry/logs"}?server=${encodeURIComponent(serverId)}&lines=${encodeURIComponent(lines)}`, { method: "GET" });
    },

    /**
     * Execute Allowlisted Mindustry Console Command on target server
     * Strictly blocks shell injections or unapproved commands
     */
    async sendConsoleCommand(rawInput, serverId = "survival") {
      const trimmed = (rawInput || "").trim();
      if (!trimmed) {
        return { ok: false, error: "Command cannot be empty." };
      }

      // Check for dangerous shell characters
      if (SHELL_METACHARS.test(trimmed)) {
        return {
          ok: false,
          error: "Security violation: Shell metacharacters (; & | ` $ > < \\ !) are strictly disallowed."
        };
      }

      // Extract command root
      const parts = trimmed.split(/\s+/);
      const rootCommand = parts[0].toLowerCase();

      if (!ALLOWED_COMMANDS.has(rootCommand)) {
        return {
          ok: false,
          error: `Disallowed command "${rootCommand}". Permitted commands: ${Array.from(ALLOWED_COMMANDS).join(", ")}`
        };
      }

      const endpoints = (window.CONFIG && window.CONFIG.api && window.CONFIG.api.endpoints) || {};
      return await this._request(endpoints.console || "/api/mindustry/console", {
        method: "POST",
        body: { command: trimmed, server: serverId }
      });
    }
  };

  global.AdminAPI = AdminAPI;
})(typeof window !== "undefined" ? window : globalThis);
