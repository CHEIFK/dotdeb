/**
 * DOT • DEB — Continental Mindustry Network Configuration
 * Centralized settings for all three Continental Mindustry servers on AWS EC2.
 *
 * Servers:
 * 1. Continental Survival      -> 16.176.55.109:6567 (mindustry-survival.service)
 * 2. Continental Tower Defence -> 16.176.55.109:6568 (mindustry-tower.service)
 * 3. Continental Attack        -> 16.176.55.109:6569 (mindustry-attack.service)
 */
const CONFIG = {
  // Continental Network Configuration
  network: {
    name: "Continental Mindustry Network",
    game: "Mindustry",
    host: "16.176.55.109",
    version: "v7 Build 146",
    region: "ap-southeast-2",
    servers: {
      survival: {
        id: "survival",
        name: "Continental Survival",
        port: 6567,
        protocol: "TCP/UDP",
        mode: "Survival",
        service: "mindustry-survival",
        defaultMap: "Glacier",
        maxPlayersDefault: 24,
        description: "Cooperative survival, mining automation, and planetary wave defense."
      },
      tower: {
        id: "tower",
        name: "Continental Tower Defence",
        port: 6568,
        protocol: "TCP/UDP",
        mode: "Tower Defence",
        service: "mindustry-tower",
        defaultMap: "Fortress",
        maxPlayersDefault: 24,
        description: "Strategic turret choke-points and energy barriers against relentless bosses."
      },
      attack: {
        id: "attack",
        name: "Continental Attack",
        port: 6569,
        protocol: "TCP/UDP",
        mode: "Attack",
        service: "mindustry-attack",
        defaultMap: "Frontline",
        maxPlayersDefault: 24,
        description: "PvP assault and tactical frontline conquest to obliterate opposing enemy cores."
      }
    }
  },

  // Legacy single-server alias pointing to primary survival server
  mindustry: {
    name: "Continental Survival",
    game: "Mindustry",
    ip: "16.176.55.109",
    port: 6567,
    protocol: "TCP/UDP",
    defaultMap: "Glacier",
    maxPlayersDefault: 24,
    version: "v7 Build 146"
  },

  // Backend Management API Configuration
  api: {
    baseUrl: (typeof window !== "undefined" && (
      window.__API_BASE_URL__ ||
      (window.location.hostname === "dotdeb.dpdns.org" ? "https://api.dotdeb.dpdns.org" : "")
    )) || "",
    endpoints: {
      status: "/api/mindustry/status",
      metrics: "/api/mindustry/metrics",
      auth: {
        login: "/api/auth/login",
        logout: "/api/auth/logout",
        session: "/api/auth/session",
        csrf: "/api/auth/csrf"
      },
      controls: {
        start: "/api/mindustry/control/start",
        stop: "/api/mindustry/control/stop",
        restart: "/api/mindustry/control/restart"
      },
      config: "/api/mindustry/config",
      players: "/api/mindustry/players",
      playerAction: "/api/mindustry/players/action",
      logs: "/api/mindustry/logs",
      console: "/api/mindustry/console"
    },
    timeoutMs: 6000,
    pollIntervalMs: 15000
  }
};

// Freeze configuration to prevent accidental modification
if (typeof Object.freeze === "function") {
  Object.freeze(CONFIG);
  Object.freeze(CONFIG.network);
  Object.freeze(CONFIG.network.servers);
  Object.freeze(CONFIG.network.servers.survival);
  Object.freeze(CONFIG.network.servers.tower);
  Object.freeze(CONFIG.network.servers.attack);
  Object.freeze(CONFIG.mindustry);
  Object.freeze(CONFIG.api);
  Object.freeze(CONFIG.api.endpoints);
  Object.freeze(CONFIG.api.endpoints.auth);
  Object.freeze(CONFIG.api.endpoints.controls);
}

if (typeof window !== "undefined") {
  window.CONFIG = CONFIG;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = CONFIG;
}
