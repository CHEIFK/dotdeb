import {
  EC2Client,
  DescribeInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand
} from "@aws-sdk/client-ec2";

import {
  SSMClient,
  SendCommandCommand,
  GetCommandInvocationCommand
} from "@aws-sdk/client-ssm";

import {
  checkRateLimit,
  recordFailedAttempt,
  resetAttempts,
  verifyCredentials,
  generateCsrfToken,
  verifyCsrfToken,
  createSessionToken,
  verifySessionToken,
  revokeSession
} from "./auth.mjs";

import { pingMindustryServer } from "./mindustry-ping.mjs";

// Configured AWS resource details
const REGION = process.env.AWS_REGION || "ap-southeast-2";
const INSTANCE_ID = process.env.EC2_INSTANCE_ID || "i-02de910a9f70196b4";
const DEFAULT_HOST = "16.176.55.109";

// Continental Mindustry Network Servers Configuration
const CONTINENTAL_SERVERS = {
  survival: {
    id: "survival",
    name: "Continental Survival",
    port: 6567,
    service: "mindustry-survival",
    defaultMaxPlayers: 24,
    mode: "Survival",
    description: "Cooperative survival, mining automation, and planetary wave defense."
  },
  tower: {
    id: "tower",
    name: "Continental Tower Defence",
    port: 6568,
    service: "mindustry-tower",
    defaultMaxPlayers: 24,
    mode: "Tower Defence",
    description: "Strategic turret choke-points and energy barriers against relentless bosses."
  },
  attack: {
    id: "attack",
    name: "Continental Attack",
    port: 6569,
    service: "mindustry-attack",
    defaultMaxPlayers: 24,
    mode: "Attack",
    description: "PvP assault and tactical frontline conquest to obliterate opposing enemy cores."
  }
};

const VALID_SERVER_IDS = new Set(["survival", "tower", "attack"]);

function resolveServer(serverId) {
  if (!serverId || typeof serverId !== "string") return CONTINENTAL_SERVERS.survival;
  const clean = serverId.trim().toLowerCase();
  return CONTINENTAL_SERVERS[clean] || null;
}

function getFifoCommandTemplate(serverId) {
  const srv = resolveServer(serverId);
  if (!srv) throw new Error(`Invalid server identifier: ${serverId}`);
  const service = srv.service;
  return (
    `FIFO="/run/mindustry/${srv.id}.fifo"; ` +
    `[ ! -p "$FIFO" ] && [ -p "/run/${service}/stdin" ] && FIFO="/run/${service}/stdin"; ` +
    `[ ! -p "$FIFO" ] && [ -p "/run/mindustry/${service}.fifo" ] && FIFO="/run/mindustry/${service}.fifo"; ` +
    `[ ! -p "$FIFO" ] && [ -p "/run/${service}.stdin" ] && FIFO="/run/${service}.stdin"; ` +
    `timeout 2 sh -c`
  );
}

const ec2 = new EC2Client({ region: REGION });
const ssm = new SSMClient({ region: REGION });

// Allowlisted Mindustry console commands (strict server-side security)
const ALLOWED_CONSOLE_COMMANDS = new Set([
  "status", "players", "maps", "save", "nextmap",
  "gameover", "say", "bans", "version", "gc",
  "help", "pause", "resume", "waves", "reloadmaps",
  "host", "mods", "rules"
]);

function getCorsHeaders(requestOrigin) {
  const allowedOrigins = [
    "https://dotdeb.dpdns.org",
    "http://localhost:8080",
    "http://127.0.0.1:8080"
  ];
  let origin = "https://dotdeb.dpdns.org";
  if (requestOrigin) {
    if (allowedOrigins.includes(requestOrigin) || requestOrigin.endsWith(".app.github.dev")) {
      origin = requestOrigin;
    }
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type, X-CSRF-Token, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx > -1) {
      const key = pair.slice(0, idx).trim();
      const val = pair.slice(idx + 1).trim();
      cookies[key] = decodeURIComponent(val);
    }
  });
  return cookies;
}

function buildResponse(statusCode, body, corsHeaders, cookiesList = [], extraHeaders = {}) {
  const response = {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
      ...extraHeaders
    },
    body: JSON.stringify(body)
  };

  if (cookiesList.length > 0) {
    response.cookies = cookiesList;
    response.headers["Set-Cookie"] = cookiesList[0];
  }

  return response;
}

/**
 * Retrieves EC2 instance state and public IP address
 */
async function getEc2InstanceInfo() {
  try {
    const cmd = new DescribeInstancesCommand({ InstanceIds: [INSTANCE_ID] });
    const res = await ec2.send(cmd);
    const reservation = res.Reservations?.[0];
    const instance = reservation?.Instances?.[0];

    if (!instance) {
      return { found: false, state: "unknown", publicIp: DEFAULT_HOST };
    }

    const state = instance.State?.Name || "unknown";
    const publicIp = instance.PublicIpAddress || DEFAULT_HOST;

    return {
      found: true,
      instanceId: instance.InstanceId,
      state,
      publicIp,
      instanceType: instance.InstanceType || "t3.small",
      launchTime: instance.LaunchTime
    };
  } catch (err) {
    console.error("EC2 DescribeInstances error:", err.message);
    return { found: false, state: "unknown", publicIp: DEFAULT_HOST, error: err.message };
  }
}

/**
 * Executes a shell command via AWS Systems Manager Run Command
 */
async function executeSsmShell(commandString, waitTimeoutMs = 1500) {
  try {
    const sendCmd = new SendCommandCommand({
      InstanceIds: [INSTANCE_ID],
      DocumentName: "AWS-RunShellScript",
      Parameters: {
        commands: [commandString]
      },
      TimeoutSeconds: 15
    });

    const sendRes = await ssm.send(sendCmd);
    const commandId = sendRes.Command?.CommandId;

    if (!commandId) {
      return { ok: false, error: "Failed to initiate SSM Command" };
    }

    await new Promise((r) => setTimeout(r, waitTimeoutMs));

    const invCmd = new GetCommandInvocationCommand({
      CommandId: commandId,
      InstanceId: INSTANCE_ID
    });

    const invRes = await ssm.send(invCmd);
    return {
      ok: invRes.Status === "Success",
      status: invRes.Status,
      stdout: invRes.StandardOutputContent || "",
      stderr: invRes.StandardErrorContent || "",
      exitCode: invRes.ResponseCode
    };
  } catch (err) {
    console.warn("SSM execution warning:", err.message);
    return { ok: false, error: err.message };
  }
}

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin || "";
  const corsHeaders = getCorsHeaders(origin);
  const method = (event.requestContext?.http?.method || event.httpMethod || "GET").toUpperCase();

  const rawPath = event.rawPath || event.path || "/";
  const path = rawPath.replace(/\/+$/, "") || "/";

  // Enforce HTTPS
  const proto = event.headers?.["x-forwarded-proto"] || "https";
  if (proto !== "https" && !origin.includes("localhost") && !origin.includes("127.0.0.1")) {
    return buildResponse(403, { error: "HTTPS is required.", code: "HTTPS_REQUIRED" }, corsHeaders);
  }

  // Handle CORS preflight
  if (method === "OPTIONS") {
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: ""
    };
  }

  const cookies = parseCookies(event.headers?.cookie || event.headers?.Cookie || "");
  const sessionToken = cookies.continental_session || cookies.zootopia_session || cookies.admin_session;
  const clientIp =
    event.requestContext?.http?.sourceIp ||
    event.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ||
    "unknown";

  let body = {};
  if (method === "POST" && event.body) {
    try {
      const rawBody = event.isBase64Encoded
        ? Buffer.from(event.body, "base64").toString("utf-8")
        : event.body;
      body = JSON.parse(rawBody);
    } catch {
      return buildResponse(400, { error: "Malformed JSON body.", code: "BAD_JSON" }, corsHeaders);
    }
  }

  const query = event.queryStringParameters || {};

  // ----------------------------------------------------
  // PUBLIC ENDPOINTS
  // ----------------------------------------------------

  // GET /api/mindustry/status or /api/server/status
  if (method === "GET" && (path === "/api/mindustry/status" || path === "/api/server/status")) {
    const ec2Info = await getEc2InstanceInfo();
    const host = ec2Info.publicIp || DEFAULT_HOST;
    const requestedServer = query.server ? resolveServer(query.server) : null;

    // If EC2 is stopped or not running, report all three servers as Offline immediately
    if (!ec2Info.found || ec2Info.state !== "running") {
      const offlineServers = {};
      for (const [key, srv] of Object.entries(CONTINENTAL_SERVERS)) {
        offlineServers[key] = {
          id: srv.id,
          name: srv.name,
          game: "Mindustry",
          ip: host,
          port: srv.port,
          mode: srv.mode,
          online: false,
          status: "Offline",
          map: null,
          wave: null,
          players: 0,
          playersOnline: 0,
          maxPlayers: srv.defaultMaxPlayers
        };
      }

      const responsePayload = {
        online: false,
        status: "Offline",
        ec2State: ec2Info.state,
        host,
        network: "Continental Mindustry Network",
        checkedAt: new Date().toISOString(),
        servers: offlineServers
      };

      if (requestedServer && offlineServers[requestedServer.id]) {
        Object.assign(responsePayload, offlineServers[requestedServer.id]);
      }

      return buildResponse(200, responsePayload, corsHeaders);
    }

    // Ping all 3 servers via UDP concurrently
    const [pingSurvival, pingTower, pingAttack] = await Promise.all([
      pingMindustryServer(host, CONTINENTAL_SERVERS.survival.port, 1500, CONTINENTAL_SERVERS.survival.name),
      pingMindustryServer(host, CONTINENTAL_SERVERS.tower.port, 1500, CONTINENTAL_SERVERS.tower.name),
      pingMindustryServer(host, CONTINENTAL_SERVERS.attack.port, 1500, CONTINENTAL_SERVERS.attack.name)
    ]);

    const liveServers = {
      survival: {
        id: "survival",
        name: pingSurvival.serverName || CONTINENTAL_SERVERS.survival.name,
        game: "Mindustry",
        ip: host,
        port: CONTINENTAL_SERVERS.survival.port,
        mode: CONTINENTAL_SERVERS.survival.mode,
        online: pingSurvival.online === true,
        status: pingSurvival.online ? "Online" : "Offline",
        map: pingSurvival.map || "Glacier",
        wave: pingSurvival.wave ?? 1,
        players: pingSurvival.playersOnline || 0,
        playersOnline: pingSurvival.playersOnline || 0,
        maxPlayers: pingSurvival.maxPlayers || CONTINENTAL_SERVERS.survival.defaultMaxPlayers
      },
      tower: {
        id: "tower",
        name: pingTower.serverName || CONTINENTAL_SERVERS.tower.name,
        game: "Mindustry",
        ip: host,
        port: CONTINENTAL_SERVERS.tower.port,
        mode: CONTINENTAL_SERVERS.tower.mode,
        online: pingTower.online === true,
        status: pingTower.online ? "Online" : "Offline",
        map: pingTower.map || "Fortress",
        wave: pingTower.wave ?? 1,
        players: pingTower.playersOnline || 0,
        playersOnline: pingTower.playersOnline || 0,
        maxPlayers: pingTower.maxPlayers || CONTINENTAL_SERVERS.tower.defaultMaxPlayers
      },
      attack: {
        id: "attack",
        name: pingAttack.serverName || CONTINENTAL_SERVERS.attack.name,
        game: "Mindustry",
        ip: host,
        port: CONTINENTAL_SERVERS.attack.port,
        mode: CONTINENTAL_SERVERS.attack.mode,
        online: pingAttack.online === true,
        status: pingAttack.online ? "Online" : "Offline",
        map: pingAttack.map || "Frontline",
        wave: pingAttack.wave ?? 1,
        players: pingAttack.playersOnline || 0,
        playersOnline: pingAttack.playersOnline || 0,
        maxPlayers: pingAttack.maxPlayers || CONTINENTAL_SERVERS.attack.defaultMaxPlayers
      }
    };

    const anyOnline = Object.values(liveServers).some((s) => s.online);

    const responsePayload = {
      online: anyOnline,
      status: anyOnline ? "Online" : "Offline",
      ec2State: ec2Info.state,
      host,
      network: "Continental Mindustry Network",
      checkedAt: new Date().toISOString(),
      servers: liveServers
    };

    if (requestedServer && liveServers[requestedServer.id]) {
      Object.assign(responsePayload, liveServers[requestedServer.id]);
    }

    return buildResponse(200, responsePayload, corsHeaders);
  }

  // ----------------------------------------------------
  // AUTHENTICATION ENDPOINTS
  // ----------------------------------------------------

  // GET /api/auth/csrf
  if (method === "GET" && path === "/api/auth/csrf") {
    const csrf = generateCsrfToken();
    const csrfCookie = `csrf_token=${csrf}; Path=/; Max-Age=3600; HttpOnly; Secure; SameSite=None`;
    return buildResponse(200, { csrfToken: csrf }, corsHeaders, [csrfCookie]);
  }

  // POST /api/auth/login
  if (method === "POST" && path === "/api/auth/login") {
    const rateCheck = checkRateLimit(clientIp);
    if (!rateCheck.allowed) {
      return buildResponse(429, {
        error: `Too many failed login attempts. Try again in ${rateCheck.retryAfter} seconds.`,
        code: "RATE_LIMITED",
        retryAfter: rateCheck.retryAfter
      }, corsHeaders);
    }

    const { username, password } = body;
    if (!username || !password) {
      return buildResponse(400, { error: "Username and password are required.", code: "VALIDATION_ERROR" }, corsHeaders);
    }

    // CSRF Check for login
    const headerCsrf = event.headers?.["x-csrf-token"] || event.headers?.["X-CSRF-Token"];
    if (headerCsrf && cookies.csrf_token) {
      if (!verifyCsrfToken(headerCsrf, cookies.csrf_token)) {
        return buildResponse(403, { error: "Invalid CSRF token.", code: "CSRF_FAILED" }, corsHeaders);
      }
    }

    const isValid = verifyCredentials(username, password);
    if (!isValid) {
      recordFailedAttempt(clientIp);
      return buildResponse(401, { error: "Invalid username or password.", code: "AUTH_FAILED" }, corsHeaders);
    }

    resetAttempts(clientIp);

    const token = createSessionToken(username);
    const newCsrf = generateCsrfToken();

    const sessionCookie = `continental_session=${token}; Path=/; Max-Age=28800; HttpOnly; Secure; SameSite=None`;
    const csrfCookie = `csrf_token=${newCsrf}; Path=/; Max-Age=28800; HttpOnly; Secure; SameSite=None`;

    return buildResponse(200, {
      ok: true,
      user: username,
      csrfToken: newCsrf,
      message: "Authentication successful."
    }, corsHeaders, [sessionCookie, csrfCookie]);
  }

  // GET /api/auth/session
  if (method === "GET" && path === "/api/auth/session") {
    const payload = verifySessionToken(sessionToken);
    if (payload) {
      return buildResponse(200, {
        authenticated: true,
        user: payload.username,
        exp: payload.exp
      }, corsHeaders);
    }
    return buildResponse(401, {
      authenticated: false,
      error: "Session expired or invalid.",
      code: "UNAUTHORIZED"
    }, corsHeaders);
  }

  // POST /api/auth/logout
  if (method === "POST" && path === "/api/auth/logout") {
    if (sessionToken) {
      revokeSession(sessionToken);
    }
    const clearSession = `continental_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None`;
    const clearCsrf = `csrf_token=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None`;
    return buildResponse(200, { ok: true, message: "Logged out successfully." }, corsHeaders, [clearSession, clearCsrf]);
  }

  // ----------------------------------------------------
  // PROTECTED ADMIN ENDPOINTS
  // ----------------------------------------------------

  const isProtectedPath =
    path.startsWith("/api/admin") ||
    path.startsWith("/api/mindustry/control") ||
    path === "/api/mindustry/config" ||
    path === "/api/mindustry/players" ||
    path === "/api/mindustry/players/action" ||
    path === "/api/mindustry/logs" ||
    path === "/api/mindustry/console" ||
    path === "/api/mindustry/metrics";

  if (isProtectedPath) {
    const session = verifySessionToken(sessionToken);
    if (!session) {
      return buildResponse(401, {
        error: "Administrative authentication required.",
        code: "UNAUTHORIZED"
      }, corsHeaders);
    }

    // Require valid CSRF token for all state-changing admin actions
    if (method === "POST") {
      const headerCsrf = event.headers?.["x-csrf-token"] || event.headers?.["X-CSRF-Token"];
      if (!verifyCsrfToken(headerCsrf, cookies.csrf_token)) {
        return buildResponse(403, {
          error: "CSRF token missing or invalid.",
          code: "CSRF_FAILED"
        }, corsHeaders);
      }
    }

    // GET /api/mindustry/metrics or /api/admin/server/overview
    if (method === "GET" && (path === "/api/mindustry/metrics" || path === "/api/admin/server/overview")) {
      const ec2Info = await getEc2InstanceInfo();
      const host = ec2Info.publicIp || DEFAULT_HOST;
      const targetServer = resolveServer(query.server) || CONTINENTAL_SERVERS.survival;

      if (!ec2Info.found || ec2Info.state !== "running") {
        return buildResponse(200, {
          ok: true,
          ec2: {
            state: ec2Info.state,
            instanceId: INSTANCE_ID,
            publicIp: host,
            region: REGION
          },
          targetServer: targetServer.id,
          mindustry: {
            id: targetServer.id,
            name: targetServer.name,
            service: targetServer.service,
            online: false,
            port: targetServer.port,
            status: "Offline"
          },
          metrics: {
            uptime: "EC2 Stopped",
            cpu: "0%",
            ram: "0 MB / 0 MB",
            services: {
              "mindustry-survival": "inactive",
              "mindustry-tower": "inactive",
              "mindustry-attack": "inactive"
            }
          }
        }, corsHeaders);
      }

      // Ping target server and collect host telemetry via SSM
      const [pingTarget, ssmRes] = await Promise.all([
        pingMindustryServer(host, targetServer.port, 1500, targetServer.name),
        executeSsmShell(
          `uptime -p; free -m; systemctl is-active mindustry-survival mindustry-tower mindustry-attack; journalctl -u ${targetServer.service} -n 15 --no-pager`,
          1200
        )
      ]);

      const stdout = ssmRes.stdout || "";
      const lines = stdout.split("\n");
      const uptimeStr = lines[0] || "Running";
      const ramLine = lines.find((l) => l.startsWith("Mem:"));

      let ramUsage = "—";
      if (ramLine) {
        const parts = ramLine.split(/\s+/);
        if (parts.length >= 3) {
          ramUsage = `${parts[2]} MB / ${parts[1]} MB`;
        }
      }

      return buildResponse(200, {
        ok: true,
        ec2: {
          state: ec2Info.state,
          instanceId: INSTANCE_ID,
          publicIp: host,
          region: REGION
        },
        targetServer: targetServer.id,
        mindustry: {
          id: targetServer.id,
          name: pingTarget.serverName || targetServer.name,
          service: targetServer.service,
          online: pingTarget.online === true,
          port: targetServer.port,
          status: pingTarget.online ? "Online" : "Offline",
          map: pingTarget.map || "Glacier",
          wave: pingTarget.wave ?? 1,
          players: pingTarget.playersOnline || 0,
          maxPlayers: pingTarget.maxPlayers || targetServer.defaultMaxPlayers,
          version: pingTarget.version || 146
        },
        metrics: {
          uptime: uptimeStr,
          ram: ramUsage,
          ssmStatus: ssmRes.status
        }
      }, corsHeaders);
    }

    // POST Server Power Control: /api/mindustry/control/:action or /api/admin/server/control
    const isControlPath =
      path.startsWith("/api/mindustry/control/") ||
      path === "/api/admin/server/control";

    if (method === "POST" && isControlPath) {
      let action = body.action;
      if (path.startsWith("/api/mindustry/control/")) {
        action = path.split("/").pop();
      }

      if (!["start", "stop", "restart"].includes(action)) {
        return buildResponse(400, { error: "Action must be start, stop, or restart." }, corsHeaders);
      }

      const targetId = body.server || body.serverId;
      const ec2Info = await getEc2InstanceInfo();

      // EC2 Host Power Controls
      if (targetId === "ec2" || (!targetId && action === "start")) {
        if (action === "start") {
          if (ec2Info.state === "running") {
            return buildResponse(200, { message: "EC2 instance is already running.", ok: true }, corsHeaders);
          }
          await ec2.send(new StartInstancesCommand({ InstanceIds: [INSTANCE_ID] }));
          return buildResponse(200, {
            ok: true,
            message: "AWS EC2 instance start requested. All Continental servers will boot automatically.",
            action: "start",
            target: "ec2"
          }, corsHeaders);
        }

        if (action === "stop") {
          if (ec2Info.state !== "running") {
            return buildResponse(200, { message: `Instance is already in ${ec2Info.state} state.`, ok: true }, corsHeaders);
          }
          // Gracefully save worlds for all 3 servers before stopping EC2
          await executeSsmShell(
            `${getFifoCommandTemplate("survival")} "echo 'save auto_shutdown' > \\$FIFO"; ` +
            `${getFifoCommandTemplate("tower")} "echo 'save auto_shutdown' > \\$FIFO"; ` +
            `${getFifoCommandTemplate("attack")} "echo 'save auto_shutdown' > \\$FIFO"; ` +
            `sleep 2; systemctl stop mindustry-survival mindustry-tower mindustry-attack`,
            3000
          );
          await ec2.send(new StopInstancesCommand({ InstanceIds: [INSTANCE_ID] }));
          return buildResponse(200, {
            ok: true,
            message: "Saved all worlds and issued EC2 Stop command.",
            action: "stop",
            target: "ec2"
          }, corsHeaders);
        }
      }

      // Individual Server Service Control (Survival, Tower, or Attack)
      const targetServer = resolveServer(targetId);
      if (!targetServer) {
        return buildResponse(400, {
          error: "Invalid or missing server parameter. Must be 'survival', 'tower', or 'attack'.",
          code: "INVALID_SERVER"
        }, corsHeaders);
      }

      if (ec2Info.state !== "running") {
        return buildResponse(400, {
          error: `Cannot control service ${targetServer.service} while EC2 is stopped. Start EC2 host first.`,
          code: "EC2_STOPPED"
        }, corsHeaders);
      }

      if (action === "start") {
        const ssmRes = await executeSsmShell(`systemctl start ${targetServer.service}`, 1500);
        return buildResponse(200, {
          ok: true,
          message: `Issued systemctl start ${targetServer.service}.`,
          server: targetServer.id,
          ssmStatus: ssmRes.status
        }, corsHeaders);
      }

      if (action === "stop") {
        const fifo = getFifoCommandTemplate(targetServer.id);
        const ssmRes = await executeSsmShell(
          `${fifo} "echo 'save auto_stop' > \\$FIFO"; sleep 1; systemctl stop ${targetServer.service}`,
          2000
        );
        return buildResponse(200, {
          ok: true,
          message: `Saved world and stopped ${targetServer.name} (${targetServer.service}).`,
          server: targetServer.id,
          ssmStatus: ssmRes.status
        }, corsHeaders);
      }

      if (action === "restart") {
        const fifo = getFifoCommandTemplate(targetServer.id);
        const ssmRes = await executeSsmShell(
          `${fifo} "echo 'save auto_restart' > \\$FIFO"; sleep 1; systemctl restart ${targetServer.service}`,
          2000
        );
        return buildResponse(200, {
          ok: true,
          message: `Issued systemctl restart ${targetServer.service}.`,
          server: targetServer.id,
          ssmStatus: ssmRes.status
        }, corsHeaders);
      }
    }

    // POST /api/mindustry/config or /api/admin/server/config
    if (method === "POST" && (path === "/api/mindustry/config" || path === "/api/admin/server/config")) {
      const targetServer = resolveServer(body.server || body.serverId);
      if (!targetServer) {
        return buildResponse(400, { error: "Valid target server (survival, tower, attack) required." }, corsHeaders);
      }

      const ec2Info = await getEc2InstanceInfo();
      if (ec2Info.state !== "running") {
        return buildResponse(400, { error: "EC2 instance is stopped. Start server first." }, corsHeaders);
      }

      const fifo = getFifoCommandTemplate(targetServer.id);
      const commands = [];
      const serverName = body.name || body.serverName;
      if (serverName) {
        const cleanName = String(serverName).replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 48);
        commands.push(`${fifo} "echo 'config name ${cleanName}' > \\$FIFO"`);
      }

      const playerLimit = body.playerLimit || body.maxPlayers;
      if (playerLimit && Number.isFinite(Number(playerLimit))) {
        const limit = Math.max(1, Math.min(64, Number(playerLimit)));
        commands.push(`${fifo} "echo 'config playerLimit ${limit}' > \\$FIFO"`);
      }

      const motd = body.motd || body.message;
      if (motd) {
        const cleanMotd = String(motd).replace(/[^a-zA-Z0-9 _.,!?:-]/g, "").slice(0, 100);
        commands.push(`${fifo} "echo 'config desc ${cleanMotd}' > \\$FIFO"`);
      }

      const map = body.map;
      if (map) {
        const cleanMap = String(map).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32);
        commands.push(`${fifo} "echo 'host ${cleanMap}' > \\$FIFO"`);
      }

      if (commands.length === 0) {
        return buildResponse(400, { error: "No valid configuration fields provided." }, corsHeaders);
      }

      await executeSsmShell(commands.join("; "), 1200);
      return buildResponse(200, {
        ok: true,
        server: targetServer.id,
        message: `Configuration parameters applied to ${targetServer.name}.`
      }, corsHeaders);
    }

    // GET /api/mindustry/players or /api/admin/players
    if (method === "GET" && (path === "/api/mindustry/players" || path === "/api/admin/players")) {
      const targetServer = resolveServer(query.server);
      if (!targetServer) {
        return buildResponse(400, { error: "Valid server parameter required." }, corsHeaders);
      }

      const ec2Info = await getEc2InstanceInfo();
      if (ec2Info.state !== "running") {
        return buildResponse(200, { ok: true, server: targetServer.id, players: [] }, corsHeaders);
      }

      const fifo = getFifoCommandTemplate(targetServer.id);
      const ssmRes = await executeSsmShell(
        `${fifo} "echo 'players' > \\$FIFO"; sleep 0.5; journalctl -u ${targetServer.service} -n 25 --no-pager`,
        1200
      );

      return buildResponse(200, {
        ok: true,
        server: targetServer.id,
        raw: ssmRes.stdout || "",
        players: []
      }, corsHeaders);
    }

    // POST Player Actions: /api/mindustry/players/action or /api/admin/players/action
    const isPlayerActionPath =
      path === "/api/mindustry/players/action" ||
      path === "/api/admin/players/action" ||
      path === "/api/admin/players/kick" ||
      path === "/api/admin/players/ban" ||
      path === "/api/admin/players/unban";

    if (method === "POST" && isPlayerActionPath) {
      const targetServer = resolveServer(body.server || body.serverId);
      if (!targetServer) {
        return buildResponse(400, { error: "Valid target server required." }, corsHeaders);
      }

      const ec2Info = await getEc2InstanceInfo();
      if (ec2Info.state !== "running") {
        return buildResponse(400, { error: "EC2 instance is stopped." }, corsHeaders);
      }

      let action = body.action;
      if (!action && path.startsWith("/api/admin/players/")) {
        action = path.split("/").pop(); // kick, ban, unban
      }

      if (!["kick", "ban", "unban"].includes(action)) {
        return buildResponse(400, { error: "Action must be kick, ban, or unban." }, corsHeaders);
      }

      const target = String(body.target || body.playerId || "").trim();
      if (!target || !/^[a-zA-Z0-9.:_-]{1,64}$/.test(target)) {
        return buildResponse(400, { error: "Valid target player ID or IP required." }, corsHeaders);
      }

      const fifo = getFifoCommandTemplate(targetServer.id);
      await executeSsmShell(`${fifo} "echo '${action} ${target}' > \\$FIFO"`, 1000);

      return buildResponse(200, {
        ok: true,
        server: targetServer.id,
        message: `Executed ${action} on player ${target} for ${targetServer.name}.`
      }, corsHeaders);
    }

    // GET /api/mindustry/logs or /api/admin/logs
    if (method === "GET" && (path === "/api/mindustry/logs" || path === "/api/admin/logs")) {
      const targetServer = resolveServer(query.server) || CONTINENTAL_SERVERS.survival;
      const ec2Info = await getEc2InstanceInfo();

      if (ec2Info.state !== "running") {
        return buildResponse(200, {
          ok: true,
          server: targetServer.id,
          logs: [`EC2 instance is currently stopped. Logs unavailable for ${targetServer.service}.`]
        }, corsHeaders);
      }

      const limit = Math.min(100, Math.max(10, parseInt(query.lines, 10) || 50));
      const ssmRes = await executeSsmShell(`journalctl -u ${targetServer.service} -n ${limit} --no-pager`, 1500);
      const lines = (ssmRes.stdout || "").split("\n").filter(Boolean);

      return buildResponse(200, {
        ok: true,
        server: targetServer.id,
        service: targetServer.service,
        logs: lines
      }, corsHeaders);
    }

    // POST Console: /api/mindustry/console or /api/admin/console/command
    if (method === "POST" && (path === "/api/mindustry/console" || path === "/api/admin/console/command")) {
      const targetServer = resolveServer(body.server || body.serverId);
      if (!targetServer) {
        return buildResponse(400, { error: "Target server (survival, tower, attack) is required." }, corsHeaders);
      }

      const ec2Info = await getEc2InstanceInfo();
      if (ec2Info.state !== "running") {
        return buildResponse(400, { error: "EC2 instance is stopped. Start server first." }, corsHeaders);
      }

      let command = body.command;
      let argument = body.argument;

      if (!argument && typeof command === "string") {
        const parts = command.trim().split(/\s+/);
        command = parts[0];
        argument = parts.slice(1).join(" ");
      }

      if (!command || !ALLOWED_CONSOLE_COMMANDS.has(command.toLowerCase())) {
        return buildResponse(400, {
          error: `Disallowed command "${command}". Allowed: ${Array.from(ALLOWED_CONSOLE_COMMANDS).join(", ")}`
        }, corsHeaders);
      }

      let cmdString = command.toLowerCase();
      if (argument) {
        // Strict allowlist: strip double quotes, backslashes, redirects, and shell metacharacters
        const cleanArg = String(argument).replace(/[^a-zA-Z0-9 _.,!?:-]/g, "").slice(0, 140);
        cmdString += ` ${cleanArg}`;
      }

      const fifo = getFifoCommandTemplate(targetServer.id);
      const ssmRes = await executeSsmShell(
        `${fifo} "echo '${cmdString}' > \\$FIFO"; sleep 0.5; journalctl -u ${targetServer.service} -n 10 --no-pager`,
        1200
      );

      return buildResponse(200, {
        ok: true,
        server: targetServer.id,
        command: cmdString,
        output: ssmRes.stdout || "Command delivered to stdin FIFO."
      }, corsHeaders);
    }
  }

  return buildResponse(404, { error: `Endpoint not found: ${method} ${path}`, code: "NOT_FOUND" }, corsHeaders);
}
