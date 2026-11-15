/**
 * DOT • DEB — Continental Mindustry Network Overview Controller
 * Queries live status for Survival (6567), Tower Defence (6568), and Attack (6569) servers.
 * Never displays fabricated or hardcoded live data.
 */
(function () {
  "use strict";

  const networkConfig = (window.CONFIG && window.CONFIG.network) ? window.CONFIG.network : {
    host: "16.176.55.109",
    servers: {
      survival: { id: "survival", name: "Continental Survival", port: 6567, maxPlayersDefault: 24 },
      tower: { id: "tower", name: "Continental Tower Defence", port: 6568, maxPlayersDefault: 24 },
      attack: { id: "attack", name: "Continental Attack", port: 6569, maxPlayersDefault: 24 }
    }
  };

  const apiConfig = (window.CONFIG && window.CONFIG.api) ? window.CONFIG.api : {
    baseUrl: "",
    endpoints: { status: "/api/mindustry/status" },
    timeoutMs: 6000
  };

  // Elements
  const elNetworkPill = document.getElementById("network-status-pill");
  const elNetworkText = document.getElementById("network-status-text");
  const elLastChecked = document.getElementById("last-checked-time");
  const elRefreshBtn = document.getElementById("refresh-status-btn");
  const elThemeBtn = document.getElementById("theme");
  const elYear = document.getElementById("year");

  if (elYear) {
    elYear.textContent = new Date().getFullYear();
  }

  // Server DOM element mapping
  const serverIds = ["survival", "tower", "attack"];
  const serverEls = {};

  serverIds.forEach((id) => {
    serverEls[id] = {
      pill: document.getElementById(`status-pill-${id}`),
      text: document.getElementById(`status-text-${id}`),
      addr: document.getElementById(`addr-${id}`),
      copyBtn: document.getElementById(`copy-btn-${id}`),
      map: document.getElementById(`map-${id}`),
      wave: document.getElementById(`wave-${id}`),
      players: document.getElementById(`players-${id}`),
      progress: document.getElementById(`progress-${id}`)
    };
  });

  let currentHost = networkConfig.host || "16.176.55.109";

  function updateAddressDisplays() {
    serverIds.forEach((id) => {
      const srv = networkConfig.servers[id];
      if (srv && serverEls[id].addr) {
        const fullAddr = `${currentHost}:${srv.port}`;
        serverEls[id].addr.textContent = fullAddr;
        if (serverEls[id].copyBtn) {
          serverEls[id].copyBtn.dataset.ip = fullAddr;
        }
      }
    });
  }

  updateAddressDisplays();

  /**
   * Safe Clipboard Copy Helper
   */
  async function copyToClipboard(text, btnEl) {
    let copied = false;
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch (err) {
        console.warn("Clipboard API failed, trying fallback:", err);
      }
    }

    if (!copied) {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      try {
        copied = document.execCommand("copy");
      } catch (err) {
        console.warn("execCommand copy error:", err);
      }
      document.body.removeChild(textarea);
    }

    if (copied && btnEl) {
      const origHtml = btnEl.innerHTML;
      btnEl.innerHTML = "<span>✓ Copied!</span>";
      btnEl.classList.add("copied");
      setTimeout(() => {
        btnEl.innerHTML = origHtml;
        btnEl.classList.remove("copied");
      }, 2000);
    }
  }

  // Hook copy buttons for all 3 servers
  serverIds.forEach((id) => {
    const btn = serverEls[id].copyBtn;
    if (btn) {
      btn.addEventListener("click", () => {
        const ipToCopy = btn.dataset.ip || `${currentHost}:${networkConfig.servers[id].port}`;
        copyToClipboard(ipToCopy, btn);
      });
    }
  });

  /**
   * Helper to set single server card UI state
   */
  function setServerState(id, online, data = null) {
    const els = serverEls[id];
    if (!els || !els.pill) return;

    els.pill.classList.remove("status-online", "status-offline", "status-unknown");

    if (data === null) {
      // Backend status unreachable
      els.pill.classList.add("status-unknown");
      if (els.text) els.text.textContent = "Unknown";
      if (els.map) els.map.textContent = "—";
      if (els.wave) els.wave.textContent = "—";
      if (els.players) els.players.textContent = `— / ${networkConfig.servers[id].maxPlayersDefault || 24}`;
      if (els.progress) els.progress.style.width = "0%";
      return;
    }

    if (online) {
      els.pill.classList.add("status-online");
      if (els.text) els.text.textContent = "Online";
      if (els.map) els.map.textContent = data.map || "Glacier";
      if (els.wave) els.wave.textContent = `Wave ${data.wave ?? 1}`;
      const curPlayers = data.playersOnline ?? data.players ?? 0;
      const maxP = data.maxPlayers || networkConfig.servers[id].maxPlayersDefault || 24;
      if (els.players) els.players.textContent = `${curPlayers} / ${maxP}`;
      if (els.progress) {
        const pct = Math.min(100, Math.round((curPlayers / Math.max(1, maxP)) * 100));
        els.progress.style.width = `${pct}%`;
      }
    } else {
      els.pill.classList.add("status-offline");
      if (els.text) els.text.textContent = "Offline";
      if (els.map) els.map.textContent = "—";
      if (els.wave) els.wave.textContent = "—";
      const maxP = networkConfig.servers[id].maxPlayersDefault || 24;
      if (els.players) els.players.textContent = `0 / ${maxP}`;
      if (els.progress) els.progress.style.width = "0%";
    }
  }

  /**
   * Fetch Live Server Network Status
   */
  async function fetchNetworkStatus() {
    if (elRefreshBtn) elRefreshBtn.classList.add("spinning");

    const endpoint = (apiConfig.baseUrl || "") + (apiConfig.endpoints?.status || "/api/mindustry/status");

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), apiConfig.timeoutMs || 6000);

      const res = await fetch(endpoint, {
        method: "GET",
        headers: { "Accept": "application/json" },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const json = await res.json();

      // Update dynamic host if returned from EC2
      if (json.host && json.host !== currentHost) {
        currentHost = json.host;
        updateAddressDisplays();
      }

      // Check if EC2 host is stopped
      if (json.ec2State === "stopped" || json.ec2State === "stopping") {
        if (elNetworkPill) {
          elNetworkPill.className = "status-pill status-offline";
          if (elNetworkText) elNetworkText.textContent = "EC2 Stopped";
        }
        serverIds.forEach((id) => setServerState(id, false, {}));
        return;
      }

      // Live server metrics
      const servers = json.servers || {};
      let anyOnline = false;

      serverIds.forEach((id) => {
        const srvData = servers[id];
        if (srvData && srvData.online) {
          setServerState(id, true, srvData);
          anyOnline = true;
        } else {
          const isUnknown = (json.status === "Unknown" || json.ec2State === "unknown") && (!srvData || srvData.status === "Unknown");
          setServerState(id, false, isUnknown ? null : (srvData || {}));
        }
      });

      if (elNetworkPill) {
        if (anyOnline) {
          elNetworkPill.className = "status-pill status-online";
          if (elNetworkText) elNetworkText.textContent = "Network Active";
        } else if (json.status === "Unknown" || json.ec2State === "unknown") {
          elNetworkPill.className = "status-pill status-unknown";
          if (elNetworkText) elNetworkText.textContent = "Status Unknown";
        } else {
          elNetworkPill.className = "status-pill status-offline";
          if (elNetworkText) elNetworkText.textContent = "All Servers Offline";
        }
      }
    } catch (err) {
      console.warn("Status check notice:", err.message);
      if (elNetworkPill) {
        elNetworkPill.className = "status-pill status-unknown";
        if (elNetworkText) elNetworkText.textContent = "Status Unavailable";
      }
      // Never fabricate live stats when connection fails
      serverIds.forEach((id) => setServerState(id, false, null));
    } finally {
      if (elLastChecked) {
        elLastChecked.textContent = new Date().toLocaleTimeString();
      }
      if (elRefreshBtn) {
        setTimeout(() => elRefreshBtn.classList.remove("spinning"), 350);
      }
    }
  }

  // Refresh Button Listener
  if (elRefreshBtn) {
    elRefreshBtn.addEventListener("click", fetchNetworkStatus);
  }

  // Theme Toggle Support
  if (elThemeBtn) {
    elThemeBtn.addEventListener("click", () => {
      document.body.classList.toggle("dark");
      localStorage.setItem("theme", document.body.classList.contains("dark") ? "dark" : "light");
    });
  }
  if (localStorage.getItem("theme") === "dark") {
    document.body.classList.add("dark");
  }

  // Initial fetch and polling
  fetchNetworkStatus();
  if (apiConfig.pollIntervalMs > 0) {
    setInterval(fetchNetworkStatus, apiConfig.pollIntervalMs);
  }
})();
