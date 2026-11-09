/**
 * DOT • DEB — Continental Mindustry Network Admin Dashboard Logic
 * Provides independent management for Survival (6567), Tower Defence (6568),
 * and Attack (6569) servers, plus EC2 host controls.
 */
(function () {
  "use strict";

  // Server Definitions
  const SERVERS_META = {
    survival: {
      id: "survival",
      name: "Continental Survival",
      port: 6567,
      service: "mindustry-survival.service",
      defaultMap: "Glacier"
    },
    tower: {
      id: "tower",
      name: "Continental Tower Defence",
      port: 6568,
      service: "mindustry-tower.service",
      defaultMap: "Fortress"
    },
    attack: {
      id: "attack",
      name: "Continental Attack",
      port: 6569,
      service: "mindustry-attack.service",
      defaultMap: "Frontline"
    },
    ec2: {
      id: "ec2",
      name: "Host Machine (AWS EC2)",
      port: "Host",
      service: "EC2 Instance",
      defaultMap: "All"
    }
  };

  let currentTargetServer = "survival";

  // Elements
  const tabButtons = document.querySelectorAll(".tab-btn");
  const tabPanels = document.querySelectorAll(".tab-panel");
  const signOutBtn = document.getElementById("btn-signout");
  const themeBtn = document.getElementById("theme");
  const toastEl = document.getElementById("admin-toast");

  // Server Selector Elements
  const serverPickButtons = document.querySelectorAll(".server-pick-btn");
  const targetServerNameEl = document.getElementById("target-server-name");
  const targetServerServiceEl = document.getElementById("target-server-service");
  const targetServerPortEl = document.getElementById("target-server-port");

  // Dynamic Section Titles
  const controlsTitleEl = document.getElementById("controls-section-title");
  const controlsTargetNameEl = document.getElementById("controls-target-name");
  const controlsEyebrowEl = document.getElementById("controls-section-eyebrow");
  const configTitleEl = document.getElementById("config-section-title");
  const configTargetNameEl = document.getElementById("config-target-name");
  const configEyebrowEl = document.getElementById("config-section-eyebrow");
  const playersTitleEl = document.getElementById("players-section-title");
  const playersEyebrowEl = document.getElementById("players-section-eyebrow");
  const consoleTitleEl = document.getElementById("console-section-title");
  const consoleEyebrowEl = document.getElementById("console-section-eyebrow");

  // Overview Elements
  const statusPill = document.getElementById("dash-status-pill");
  const statusText = document.getElementById("dash-status-text");
  const serviceSub = document.getElementById("dash-service-sub");
  const uptimeVal = document.getElementById("dash-uptime");
  const mapVal = document.getElementById("dash-map");
  const waveVal = document.getElementById("dash-wave");
  const playersVal = document.getElementById("dash-players");
  const ramVal = document.getElementById("dash-ram");
  const hostIpDisplay = document.getElementById("host-ip-display");
  const refreshDashBtn = document.getElementById("dash-refresh-btn");
  const backendNotice = document.getElementById("backend-notice");

  // Control Elements
  const btnStart = document.getElementById("ctrl-start");
  const btnStop = document.getElementById("ctrl-stop");
  const btnRestart = document.getElementById("ctrl-restart");
  const btnEc2Start = document.getElementById("ctrl-ec2-start");
  const btnEc2Stop = document.getElementById("ctrl-ec2-stop");

  // Modal Elements
  const modalOverlay = document.getElementById("confirm-modal");
  const modalTitle = document.getElementById("modal-title");
  const modalDesc = document.getElementById("modal-desc");
  const modalConfirmBtn = document.getElementById("modal-btn-confirm");
  const modalCancelBtn = document.getElementById("modal-btn-cancel");
  let pendingActionCallback = null;

  // Config Form Elements
  const configForm = document.getElementById("server-config-form");
  const inputServerName = document.getElementById("cfg-server-name");
  const inputPlayerLimit = document.getElementById("cfg-player-limit");
  const inputMotd = document.getElementById("cfg-motd");
  const inputMap = document.getElementById("cfg-map");

  // Player Elements
  const playerTableBody = document.getElementById("players-table-body");
  const btnUnban = document.getElementById("btn-unban-action");
  const inputUnbanId = document.getElementById("unban-player-id");

  // Console Elements
  const consoleOutput = document.getElementById("console-output");
  const consoleInput = document.getElementById("console-input");
  const consoleForm = document.getElementById("console-form");
  const autoScrollToggle = document.getElementById("console-autoscroll");
  const clearConsoleBtn = document.getElementById("console-clear-btn");
  const refreshLogsBtn = document.getElementById("console-refresh-logs-btn");
  const commandChips = document.querySelectorAll(".chip-btn");

  /**
   * Toast notification helper
   */
  function showToast(message, duration = 3000) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add("show");
    setTimeout(() => {
      toastEl.classList.remove("show");
    }, duration);
  }

  /**
   * Confirmation Modal Helper
   */
  function askConfirmation(title, message, confirmLabel, confirmClass, onConfirm) {
    if (!modalOverlay) return;
    modalTitle.textContent = title;
    modalDesc.textContent = message;
    modalConfirmBtn.textContent = confirmLabel || "Confirm";
    modalConfirmBtn.className = `btn-ctrl ${confirmClass || ""}`;
    pendingActionCallback = onConfirm;
    modalOverlay.classList.add("open");
  }

  function closeModal() {
    if (!modalOverlay) return;
    modalOverlay.classList.remove("open");
    pendingActionCallback = null;
  }

  if (modalCancelBtn) modalCancelBtn.addEventListener("click", closeModal);
  if (modalOverlay) {
    modalOverlay.addEventListener("click", (e) => {
      if (e.target === modalOverlay) closeModal();
    });
  }
  if (modalConfirmBtn) {
    modalConfirmBtn.addEventListener("click", () => {
      if (typeof pendingActionCallback === "function") {
        pendingActionCallback();
      }
      closeModal();
    });
  }

  /**
   * Server Switcher
   */
  window.switchTargetServer = function (serverId) {
    if (!SERVERS_META[serverId]) return;
    currentTargetServer = serverId;
    const meta = SERVERS_META[serverId];

    // Update active button state
    serverPickButtons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.server === serverId);
    });

    // Update indicator
    if (targetServerNameEl) targetServerNameEl.textContent = meta.name;
    if (targetServerServiceEl) targetServerServiceEl.textContent = meta.service;
    if (targetServerPortEl) {
      targetServerPortEl.textContent = meta.port === "Host" ? "EC2 Host" : `Port ${meta.port}`;
    }

    // Update section titles
    if (controlsTitleEl) controlsTitleEl.textContent = `Service Controls — ${meta.name}`;
    if (controlsTargetNameEl) controlsTargetNameEl.textContent = meta.name;
    if (controlsEyebrowEl) controlsEyebrowEl.textContent = `TARGET: ${meta.service.toUpperCase()}`;

    if (configTitleEl) configTitleEl.textContent = `Configuration — ${meta.name}`;
    if (configTargetNameEl) configTargetNameEl.textContent = meta.name;
    if (configEyebrowEl) configEyebrowEl.textContent = `TARGET: ${meta.service.toUpperCase()}`;

    if (playersTitleEl) playersTitleEl.textContent = `Player Supervision — ${meta.name}`;
    if (playersEyebrowEl) playersEyebrowEl.textContent = `PORT ${meta.port}`;

    if (consoleTitleEl) consoleTitleEl.textContent = `Console & Journald Stream — ${meta.name}`;
    if (consoleEyebrowEl) consoleEyebrowEl.textContent = `TARGET: ${meta.service.toUpperCase()}`;

    // Update config inputs default
    if (inputServerName) inputServerName.value = meta.name;
    if (inputMap) inputMap.value = meta.defaultMap;

    appendConsole(`[System] Switched target to ${meta.name} (${meta.service}).`);

    // Fetch fresh overview data for selected server
    fetchOverview();
  };

  serverPickButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      window.switchTargetServer(btn.dataset.server);
    });
  });

  /**
   * Tabs Navigation
   */
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetTab = btn.getAttribute("data-tab");
      tabButtons.forEach((b) => b.classList.remove("active"));
      tabPanels.forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      const targetPanel = document.getElementById(`panel-${targetTab}`);
      if (targetPanel) targetPanel.classList.add("active");

      // Auto fetch relevant data on tab change
      if (targetTab === "players") fetchPlayers();
      if (targetTab === "console") fetchLogs();
    });
  });

  /**
   * Console Output Helper
   */
  function appendConsole(line) {
    if (!consoleOutput) return;
    const timeStr = new Date().toLocaleTimeString();
    consoleOutput.textContent += `\n[${timeStr}] ${line}`;
    if (autoScrollToggle && autoScrollToggle.checked) {
      consoleOutput.scrollTop = consoleOutput.scrollHeight;
    }
  }

  /**
   * Fetch Overview & All-Servers Telemetry
   */
  async function fetchOverview() {
    if (refreshDashBtn) refreshDashBtn.classList.add("spinning");

    try {
      // Fetch both targeted metrics and overall network status
      const [metricsRes, statusRes] = await Promise.all([
        window.AdminAPI.getMetrics(currentTargetServer),
        window.AdminAPI.getStatus(currentTargetServer)
      ]);

      if (!metricsRes.ok) {
        if (metricsRes.status === 401) {
          window.location.replace("login.html");
          return;
        }
        if (backendNotice) {
          backendNotice.textContent = `Backend notice: ${metricsRes.error}`;
          backendNotice.style.display = "block";
        }
        return;
      }

      if (backendNotice) backendNotice.style.display = "none";
      const data = metricsRes.data || {};
      const mindustry = data.mindustry || {};
      const metrics = data.metrics || {};
      const ec2 = data.ec2 || {};

      if (hostIpDisplay && ec2.publicIp) {
        hostIpDisplay.textContent = ec2.publicIp;
      }

      // Update Selected Server Cards
      if (statusPill && statusText) {
        statusPill.className = "status-pill";
        if (ec2.state === "stopped") {
          statusPill.classList.add("status-offline");
          statusText.textContent = "EC2 Stopped";
        } else if (mindustry.online) {
          statusPill.classList.add("status-online");
          statusText.textContent = "Online";
        } else {
          statusPill.classList.add("status-offline");
          statusText.textContent = "Offline";
        }
      }

      if (serviceSub) {
        serviceSub.textContent = SERVERS_META[currentTargetServer]?.service || "daemon";
      }

      if (uptimeVal) uptimeVal.textContent = metrics.uptime || "—";
      if (mapVal) mapVal.textContent = mindustry.map || "—";
      if (waveVal) waveVal.textContent = mindustry.wave !== undefined ? `Wave ${mindustry.wave}` : "—";
      if (playersVal) {
        playersVal.textContent = `${mindustry.players || 0} / ${mindustry.maxPlayers || 24}`;
      }
      if (ramVal) ramVal.textContent = metrics.ram || "—";

      // Update All-Servers Overview Table
      const allServers = (statusRes.ok && statusRes.data && statusRes.data.servers) ? statusRes.data.servers : {};
      ["survival", "tower", "attack"].forEach((id) => {
        const srv = allServers[id];
        const statusEl = document.getElementById(`ov-status-${id}`);
        const mapEl = document.getElementById(`ov-map-${id}`);
        const waveEl = document.getElementById(`ov-wave-${id}`);
        const playersEl = document.getElementById(`ov-players-${id}`);

        if (statusEl) {
          if (srv && srv.online) {
            statusEl.textContent = "Online";
            statusEl.className = "badge status-online";
          } else {
            statusEl.textContent = ec2.state === "stopped" ? "EC2 Stopped" : "Offline";
            statusEl.className = "badge status-offline";
          }
        }
        if (mapEl) mapEl.textContent = srv?.map || "—";
        if (waveEl) waveEl.textContent = srv?.wave !== undefined ? `${srv.wave}` : "—";
        if (playersEl) playersEl.textContent = `${srv?.players || 0} / ${srv?.maxPlayers || 24}`;
      });

    } catch (err) {
      console.warn("Overview sync note:", err.message);
    } finally {
      if (refreshDashBtn) {
        setTimeout(() => refreshDashBtn.classList.remove("spinning"), 350);
      }
    }
  }

  // Refresh Overview Button
  if (refreshDashBtn) {
    refreshDashBtn.addEventListener("click", fetchOverview);
  }

  /**
   * Service Controls (Targeted to Selected Server)
   */
  if (btnStart) {
    btnStart.addEventListener("click", () => {
      const srvName = SERVERS_META[currentTargetServer]?.name || currentTargetServer;
      askConfirmation(
        `Start ${srvName}?`,
        `Are you sure you want to start the ${srvName} systemd service? (Other servers will remain untouched).`,
        "Start Service",
        "btn-start",
        async () => {
          btnStart.disabled = true;
          const res = await window.AdminAPI.controlServer("start", currentTargetServer);
          btnStart.disabled = false;
          if (res.ok) {
            showToast(`Started ${srvName}`);
            appendConsole(`[Control] Started ${srvName} (${SERVERS_META[currentTargetServer]?.service}).`);
            fetchOverview();
          } else {
            showToast(`Error: ${res.error}`);
            appendConsole(`[Error] Failed to start ${srvName}: ${res.error}`);
          }
        }
      );
    });
  }

  if (btnRestart) {
    btnRestart.addEventListener("click", () => {
      const srvName = SERVERS_META[currentTargetServer]?.name || currentTargetServer;
      askConfirmation(
        `Restart ${srvName}?`,
        `Are you sure you want to save the world and restart ${srvName}? Active players on this server will temporarily reconnect.`,
        "Restart Service",
        "btn-restart",
        async () => {
          btnRestart.disabled = true;
          const res = await window.AdminAPI.controlServer("restart", currentTargetServer);
          btnRestart.disabled = false;
          if (res.ok) {
            showToast(`Restarted ${srvName}`);
            appendConsole(`[Control] Restarted ${srvName}.`);
            fetchOverview();
          } else {
            showToast(`Error: ${res.error}`);
            appendConsole(`[Error] Failed to restart ${srvName}: ${res.error}`);
          }
        }
      );
    });
  }

  if (btnStop) {
    btnStop.addEventListener("click", () => {
      const srvName = SERVERS_META[currentTargetServer]?.name || currentTargetServer;
      askConfirmation(
        `Stop ${srvName}?`,
        `Are you sure you want to stop ${srvName}? Progress will be saved cleanly. Other servers will continue running.`,
        "Stop Service",
        "btn-stop",
        async () => {
          btnStop.disabled = true;
          const res = await window.AdminAPI.controlServer("stop", currentTargetServer);
          btnStop.disabled = false;
          if (res.ok) {
            showToast(`Stopped ${srvName}`);
            appendConsole(`[Control] Stopped ${srvName}.`);
            fetchOverview();
          } else {
            showToast(`Error: ${res.error}`);
            appendConsole(`[Error] Failed to stop ${srvName}: ${res.error}`);
          }
        }
      );
    });
  }

  // EC2 Machine Controls
  if (btnEc2Start) {
    btnEc2Start.addEventListener("click", () => {
      askConfirmation(
        "Power On EC2 Host?",
        "This will call ec2:StartInstances on instance i-02de910a9f70196b4. All three Mindustry servers will boot automatically.",
        "Power On EC2",
        "btn-start",
        async () => {
          btnEc2Start.disabled = true;
          const res = await window.AdminAPI.controlServer("start", "ec2");
          btnEc2Start.disabled = false;
          if (res.ok) {
            showToast("EC2 Start command issued successfully.");
            appendConsole("[EC2] StartInstances issued. Instance booting...");
            fetchOverview();
          } else {
            showToast(`Error: ${res.error}`);
            appendConsole(`[Error] EC2 Start failed: ${res.error}`);
          }
        }
      );
    });
  }

  if (btnEc2Stop) {
    btnEc2Stop.addEventListener("click", () => {
      askConfirmation(
        "Power Off EC2 Host?",
        "This will save all 3 active Mindustry worlds (Survival, Tower, Attack) and stop the EC2 instance.",
        "Power Off EC2",
        "btn-stop",
        async () => {
          btnEc2Stop.disabled = true;
          const res = await window.AdminAPI.controlServer("stop", "ec2");
          btnEc2Stop.disabled = false;
          if (res.ok) {
            showToast("Saved all worlds and powered off EC2.");
            appendConsole("[EC2] Saved all worlds and issued StopInstances.");
            fetchOverview();
          } else {
            showToast(`Error: ${res.error}`);
            appendConsole(`[Error] EC2 Stop failed: ${res.error}`);
          }
        }
      );
    });
  }

  /**
   * Configuration Form
   */
  if (configForm) {
    configForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const srvName = SERVERS_META[currentTargetServer]?.name || currentTargetServer;
      const payload = {
        name: inputServerName ? inputServerName.value.trim() : "",
        playerLimit: inputPlayerLimit ? parseInt(inputPlayerLimit.value, 10) : 24,
        motd: inputMotd ? inputMotd.value.trim() : "",
        map: inputMap ? inputMap.value.trim() : ""
      };

      const btn = document.getElementById("btn-save-cfg");
      if (btn) btn.disabled = true;

      const res = await window.AdminAPI.updateConfig(payload, currentTargetServer);
      if (btn) btn.disabled = false;

      if (res.ok) {
        showToast(`Configuration updated for ${srvName}`);
        appendConsole(`[Config] Updated configuration for ${srvName}.`);
        fetchOverview();
      } else {
        showToast(`Config error: ${res.error}`);
        appendConsole(`[Error] Failed to update config: ${res.error}`);
      }
    });
  }

  /**
   * Player Supervision
   */
  async function fetchPlayers() {
    if (!playerTableBody) return;
    const srvName = SERVERS_META[currentTargetServer]?.name || currentTargetServer;
    playerTableBody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--muted);">Fetching players for ${srvName}...</td></tr>`;

    const res = await window.AdminAPI.getPlayers(currentTargetServer);
    if (!res.ok) {
      playerTableBody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#ef4444;padding:24px;">${res.error}</td></tr>`;
      return;
    }

    const players = (res.data && res.data.players) || [];
    if (players.length === 0) {
      playerTableBody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--muted);">No players currently connected to ${srvName}.</td></tr>`;
      return;
    }

    playerTableBody.innerHTML = players.map((p) => `
      <tr>
        <td><strong>${escapeHtml(p.name)}</strong></td>
        <td><code>${escapeHtml(p.id || p.ip || "—")}</code></td>
        <td><span class="badge status-online">Connected</span></td>
        <td>
          <button type="button" class="btn-ctrl" onclick="window.kickPlayer('${escapeHtml(p.id || p.name)}')">Kick</button>
          <button type="button" class="btn-ctrl btn-stop" style="margin-left:6px;" onclick="window.banPlayer('${escapeHtml(p.id || p.name)}')">Ban</button>
        </td>
      </tr>
    `).join("");
  }

  window.kickPlayer = function (target) {
    const srvName = SERVERS_META[currentTargetServer]?.name || currentTargetServer;
    askConfirmation(
      `Kick Player?`,
      `Are you sure you want to disconnect ${target} from ${srvName}?`,
      "Kick Player",
      "btn-restart",
      async () => {
        const res = await window.AdminAPI.playerAction("kick", target, "Kicked by admin", currentTargetServer);
        if (res.ok) {
          showToast(`Kicked player from ${srvName}`);
          appendConsole(`[Player] Kicked ${target} from ${srvName}.`);
          fetchPlayers();
        } else {
          showToast(`Error: ${res.error}`);
        }
      }
    );
  };

  window.banPlayer = function (target) {
    const srvName = SERVERS_META[currentTargetServer]?.name || currentTargetServer;
    askConfirmation(
      `Ban Player?`,
      `Are you sure you want to permanently blacklist ${target} from ${srvName}?`,
      "Ban Player",
      "btn-stop",
      async () => {
        const res = await window.AdminAPI.playerAction("ban", target, "Banned by admin", currentTargetServer);
        if (res.ok) {
          showToast(`Banned player on ${srvName}`);
          appendConsole(`[Player] Banned ${target} on ${srvName}.`);
          fetchPlayers();
        } else {
          showToast(`Error: ${res.error}`);
        }
      }
    );
  };

  if (btnUnban && inputUnbanId) {
    btnUnban.addEventListener("click", async () => {
      const target = inputUnbanId.value.trim();
      if (!target) {
        showToast("Enter a player ID or IP to unban.");
        return;
      }
      const srvName = SERVERS_META[currentTargetServer]?.name || currentTargetServer;
      const res = await window.AdminAPI.playerAction("unban", target, "", currentTargetServer);
      if (res.ok) {
        showToast(`Unbanned ${target} on ${srvName}`);
        inputUnbanId.value = "";
        appendConsole(`[Player] Unbanned ${target} on ${srvName}.`);
      } else {
        showToast(`Error: ${res.error}`);
      }
    });
  }

  /**
   * Console & Journald Logs
   */
  async function fetchLogs() {
    const srvName = SERVERS_META[currentTargetServer]?.name || currentTargetServer;
    appendConsole(`[Journald] Fetching latest log lines for ${srvName}...`);
    const res = await window.AdminAPI.getLogs(currentTargetServer, 40);
    if (res.ok && res.data && res.data.logs) {
      const logLines = res.data.logs;
      logLines.forEach((line) => appendConsole(line));
    } else {
      appendConsole(`[Error] Could not fetch logs: ${res.error}`);
    }
  }

  if (refreshLogsBtn) {
    refreshLogsBtn.addEventListener("click", fetchLogs);
  }

  if (clearConsoleBtn && consoleOutput) {
    clearConsoleBtn.addEventListener("click", () => {
      consoleOutput.textContent = `[System] Console cleared for ${SERVERS_META[currentTargetServer]?.name}.`;
    });
  }

  commandChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      const cmd = chip.getAttribute("data-cmd");
      if (consoleInput) {
        consoleInput.value = cmd;
        consoleInput.focus();
      }
    });
  });

  if (consoleForm && consoleInput) {
    consoleForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const rawCmd = consoleInput.value.trim();
      if (!rawCmd) return;

      const srvName = SERVERS_META[currentTargetServer]?.name || currentTargetServer;
      appendConsole(`> ${rawCmd} (target: ${srvName})`);
      consoleInput.value = "";

      const res = await window.AdminAPI.sendConsoleCommand(rawCmd, currentTargetServer);
      if (res.ok) {
        const out = res.data?.output || "Command delivered to stdin FIFO.";
        appendConsole(out);
      } else {
        appendConsole(`[Error] ${res.error}`);
      }
    });
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /**
   * Sign Out
   */
  if (signOutBtn) {
    signOutBtn.addEventListener("click", async () => {
      signOutBtn.disabled = true;
      signOutBtn.textContent = "Signing out...";
      try {
        await window.AdminAPI.logout();
      } catch {}
      window.location.replace("login.html");
    });
  }

  // Theme Toggle Support
  if (themeBtn) {
    themeBtn.addEventListener("click", () => {
      document.body.classList.toggle("dark");
      localStorage.setItem("theme", document.body.classList.contains("dark") ? "dark" : "light");
    });
  }
  if (localStorage.getItem("theme") === "dark") {
    document.body.classList.add("dark");
  }

  // Pre-check session validity
  window.AdminAPI.checkSession().then((res) => {
    if (!res.ok || !res.data || !res.data.authenticated) {
      window.location.replace("login.html");
    } else {
      fetchOverview();
    }
  }).catch(() => {
    window.location.replace("login.html");
  });

  // Auto-refresh overview every 15s
  setInterval(fetchOverview, 15000);
})();
