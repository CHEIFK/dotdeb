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
  verifySessionToken
} from "./auth.mjs";

import { pingMindustryServer } from "./mindustry-ping.mjs";

// Configured AWS resource details
const REGION = process.env.AWS_REGION || "ap-southeast-2";
const INSTANCE_ID = process.env.EC2_INSTANCE_ID || "i-02de910a9f70196b4";
const MINDUSTRY_PORT = 6567;
const DEFAULT_MAX_PLAYERS = 24;
const DEFAULT_SERVER_NAME = "Zootopia";

// Primary FIFO path configured in systemd unit, with fallback to legacy path
const FIFO_COMMAND_TEMPLATE =
  `FIFO="/run/mindustry/mindustry.fifo"; ` +
  `[ ! -p "$FIFO" ] && [ -p "/run/mindustry.stdin" ] && FIFO="/run/mindustry.stdin"; ` +
  `timeout 2 sh -c`;

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
  const origin = allowedOrigins.includes(requestOrigin)
    ? requestOrigin
    : "https://dotdeb.dpdns.org";

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type, X-CSRF-Token, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400"
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

  if (cookiesList && cookiesList.length > 0) {
    // API Gateway HTTP API v2 native cookies array
    response.cookies = cookiesList;
    // API Gateway v1 / fallback Set-Cookie header
    response.headers["Set-Cookie"] = cookiesList[0];
    response.multiValueHeaders = { "Set-Cookie": cookiesList };
  }

  return response;
}

async function getEc2InstanceInfo() {
  try {
    const cmd = new DescribeInstancesCommand({
      InstanceIds: [INSTANCE_ID]
    });
    const res = await ec2.send(cmd);
    const reservation = res.Reservations?.[0];
    const instance = reservation?.Instances?.[0];

    if (!instance) {
      return { found: false, state: "unknown", publicIp: null };
    }

    return {
      found: true,
      state: instance.State?.Name || "unknown",
      publicIp: instance.PublicIpAddress || null,
      privateIp: instance.PrivateIpAddress || null,
      launchTime: instance.LaunchTime || null
    };
  } catch (err) {
    console.error("EC2 Describe error:", err);
    return { found: false, state: "error", publicIp: null, error: err.message };
  }
}

async function executeSsmShell(script, waitMs = 1200) {
  try {
    const sendCmd = new SendCommandCommand({
      InstanceIds: [INSTANCE_ID],
      DocumentName: "AWS-RunShellScript",
      Parameters: {
        commands: [script]
      },
      TimeoutSeconds: 15
    });

    const sendRes = await ssm.send(sendCmd);
    const commandId = sendRes.Command?.CommandId;
    if (!commandId) {
      return { success: false, error: "SSM SendCommand did not return CommandId" };
    }

    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      try {
        const invRes = await ssm.send(
          new GetCommandInvocationCommand({
            CommandId: commandId,
            InstanceId: INSTANCE_ID
          })
        );
        return {
          success: true,
          status: invRes.Status,
          stdout: invRes.StandardOutputContent || "",
          stderr: invRes.StandardErrorContent || ""
        };
      } catch (pollErr) {
        return {
          success: true,
          status: "InProgress",
          stdout: "Command queued in SSM.",
          stderr: ""
        };
      }
    }

    return { success: true, status: "Dispatched", stdout: "", stderr: "" };
  } catch (err) {
    console.error("SSM Execution Error:", err);
    return { success: false, error: err.message };
  }
}

export const handler = async (event) => {
  const method = (event.requestContext?.http?.method || event.httpMethod || "GET").toUpperCase();
  const rawPath = event.rawPath || event.path || "/";
  const path = rawPath.replace(/\/+$/, "") || "/";
  const headers = event.headers || {};
  const origin = headers.origin || headers.Origin || "";
  const clientIp = event.requestContext?.http?.sourceIp || event.requestContext?.identity?.sourceIp || "unknown";
  const corsHeaders = getCorsHeaders(origin);

  // 1. Mandatory HTTPS enforcement (except local development)
  const forwardedProto = headers["x-forwarded-proto"] || headers["X-Forwarded-Proto"] || "https";
  const isLocalOrigin = origin.includes("localhost") || origin.includes("127.0.0.1");
  if (forwardedProto === "http" && !isLocalOrigin) {
    return buildResponse(403, { error: "HTTPS is required.", code: "HTTPS_REQUIRED" }, corsHeaders);
  }

  // 2. Handle CORS Preflight
  if (method === "OPTIONS") {
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: ""
    };
  }

  // 3. Parse Cookies & Session
  const cookies = parseCookies(headers.cookie || headers.Cookie);
  const sessionToken = cookies.zootopia_session || cookies.admin_session;
  const session = verifySessionToken(sessionToken);
  const cookieCsrf = cookies.csrf_token || cookies["XSRF-TOKEN"];

  // 4. Parse Body for mutating methods
  let body = {};
  if (method === "POST" && event.body) {
    try {
      body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf-8") : event.body);
    } catch {
      body = {};
    }
  }

  // Helper to verify CSRF on protected mutating endpoints
  function checkCsrfProtection() {
    const clientHeaderCsrf = headers["x-csrf-token"] || headers["X-CSRF-Token"] || headers["x-xsrf-token"];
    if (!verifyCsrfToken(clientHeaderCsrf, cookieCsrf)) {
      return false;
    }
    return true;
  }

  // ----------------------------------------------------
  // PUBLIC ENDPOINTS
  // ----------------------------------------------------

  // GET /api/mindustry/status or /api/server/status
  if (method === "GET" && (path === "/api/mindustry/status" || path === "/api/server/status")) {
    const ec2Info = await getEc2InstanceInfo();

    // If EC2 is stopped or not running, report Offline immediately
    if (!ec2Info.found || ec2Info.state !== "running") {
      return buildResponse(200, {
        online: false,
        status: "Offline",
        serverName: DEFAULT_SERVER_NAME,
        game: "Mindustry",
        ip: ec2Info.publicIp || "3.26.168.37",
        port: MINDUSTRY_PORT,
        map: null,
        wave: null,
        players: 0,
        playersOnline: 0,
        maxPlayers: DEFAULT_MAX_PLAYERS,
        checkedAt: new Date().toISOString(),
        ec2State: ec2Info.state
      }, corsHeaders);
    }

    // Ping Mindustry UDP
    const ping = await pingMindustryServer(ec2Info.publicIp, MINDUSTRY_PORT, 1500);

    return buildResponse(200, {
      online: ping.online === true,
      status: ping.online ? "Online" : "Offline",
      serverName: ping.serverName || DEFAULT_SERVER_NAME,
      game: "Mindustry",
      ip: ec2Info.publicIp,
      port: MINDUSTRY_PORT,
      map: ping.map || "Glacier",
      wave: ping.wave !== undefined ? ping.wave : 1,
      players: ping.playersOnline || 0,
      playersOnline: ping.playersOnline || 0,
      maxPlayers: ping.maxPlayers || DEFAULT_MAX_PLAYERS,
      checkedAt: new Date().toISOString(),
      ec2State: ec2Info.state
    }, corsHeaders);
  }

  // GET /api/auth/csrf
  if (method === "GET" && path === "/api/auth/csrf") {
    const csrf = generateCsrfToken();
    const csrfCookie = `csrf_token=${csrf}; Path=/; Max-Age=28800; Secure; SameSite=None`;
    return buildResponse(200, { csrfToken: csrf }, corsHeaders, [csrfCookie]);
  }

  // POST /api/auth/login
  if (method === "POST" && path === "/api/auth/login") {
    const rate = checkRateLimit(clientIp);
    if (!rate.allowed) {
      return buildResponse(429, {
        error: `Too many login attempts. Please retry in ${rate.retryAfter} seconds.`,
        code: "RATE_LIMITED",
        retryAfter: rate.retryAfter
      }, corsHeaders, [], { "Retry-After": String(rate.retryAfter) });
    }

    const { username, password } = body;
    if (!username || !password) {
      return buildResponse(400, { error: "Username and password are required.", code: "VALIDATION_ERROR" }, corsHeaders);
    }

    const isValid = verifyCredentials(username.trim(), password);
    if (!isValid) {
      recordFailedAttempt(clientIp);
      return buildResponse(401, { error: "Invalid username or password.", code: "AUTH_FAILED" }, corsHeaders);
    }

    resetAttempts(clientIp);
    const token = createSessionToken(username.trim());
    const csrfToken = generateCsrfToken();

    // Secure cross-site cookies for dotdeb frontend
    const sessionCookie = `zootopia_session=${token}; Path=/; Max-Age=28800; HttpOnly; Secure; SameSite=None`;
    const csrfCookie = `csrf_token=${csrfToken}; Path=/; Max-Age=28800; Secure; SameSite=None`;

    return buildResponse(200, {
      authenticated: true,
      user: { username: username.trim() },
      csrfToken
    }, corsHeaders, [sessionCookie, csrfCookie]);
  }

  // GET /api/auth/session
  if (method === "GET" && path === "/api/auth/session") {
    if (session) {
      const csrfToken = generateCsrfToken();
      const csrfCookie = `csrf_token=${csrfToken}; Path=/; Max-Age=28800; Secure; SameSite=None`;
      return buildResponse(200, {
        authenticated: true,
        user: { username: session.username },
        csrfToken
      }, corsHeaders, [csrfCookie]);
    }
    return buildResponse(401, {
      authenticated: false,
      reason: "NO_ACTIVE_SESSION",
      message: "No active session."
    }, corsHeaders);
  }

  // POST /api/auth/logout
  if (method === "POST" && path === "/api/auth/logout") {
    const clearSession = `zootopia_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None`;
    const clearCsrf = `csrf_token=; Path=/; Max-Age=0; Secure; SameSite=None`;
    return buildResponse(200, { ok: true, message: "Logged out successfully." }, corsHeaders, [clearSession, clearCsrf]);
  }

  // ----------------------------------------------------
  // PROTECTED ADMIN ENDPOINTS
  // ----------------------------------------------------
  const isAdminPath =
    path.startsWith("/api/admin") ||
    path.startsWith("/api/mindustry/control") ||
    path === "/api/mindustry/config" ||
    path === "/api/mindustry/players" ||
    path === "/api/mindustry/players/action" ||
    path === "/api/mindustry/logs" ||
    path === "/api/mindustry/console" ||
    path === "/api/mindustry/metrics";

  if (isAdminPath) {
    if (!session) {
      return buildResponse(401, {
        error: "Authentication required for admin management.",
        code: "UNAUTHORIZED"
      }, corsHeaders);
    }

    // CSRF verification on state-changing requests
    if (method === "POST") {
      if (!checkCsrfProtection()) {
        return buildResponse(403, {
          error: "Invalid or missing CSRF token. Request rejected.",
          code: "CSRF_ERROR"
        }, corsHeaders);
      }
    }

    // GET /api/mindustry/metrics or /api/admin/server/overview
    if (method === "GET" && (path === "/api/mindustry/metrics" || path === "/api/admin/server/overview")) {
      const ec2Info = await getEc2InstanceInfo();

      if (!ec2Info.found || ec2Info.state !== "running") {
        return buildResponse(200, {
          online: false,
          status: "Offline",
          serverName: DEFAULT_SERVER_NAME,
          ip: ec2Info.publicIp || "3.26.168.37",
          port: MINDUSTRY_PORT,
          uptime: "Instance Stopped",
          map: "Glacier",
          wave: 0,
          players: 0,
          playersOnline: 0,
          maxPlayers: DEFAULT_MAX_PLAYERS,
          cpuPercent: 0,
          ramUsedMb: 0,
          ramTotalMb: 2048,
          ec2State: ec2Info.state
        }, corsHeaders);
      }

      // Query host telemetry via SSM
      const ssmRes = await executeSsmShell(
        `uptime -p; free -m; ps aux | grep -i '[s]erver-release.jar' | wc -l; journalctl -u mindustry.service -n 15 --no-pager`,
        1200
      );

      const ping = await pingMindustryServer(ec2Info.publicIp, MINDUSTRY_PORT, 1200);

      // Parse memory usage if free -m output is available
      let ramUsedMb = 512;
      let ramTotalMb = 2048;
      if (ssmRes.stdout) {
        const memMatch = ssmRes.stdout.match(/Mem:\s+(\d+)\s+(\d+)/);
        if (memMatch) {
          ramTotalMb = parseInt(memMatch[1], 10);
          ramUsedMb = parseInt(memMatch[2], 10);
        }
      }

      const uptime = ssmRes.stdout ? ssmRes.stdout.split("\n")[0].replace(/^up /, "") : "Online";

      return buildResponse(200, {
        online: ping.online === true,
        status: ping.online ? "Online" : "Starting",
        serverName: ping.serverName || DEFAULT_SERVER_NAME,
        ip: ec2Info.publicIp,
        port: MINDUSTRY_PORT,
        uptime,
        map: ping.map || "Glacier",
        wave: ping.wave !== undefined ? ping.wave : 1,
        players: ping.playersOnline || 0,
        playersOnline: ping.playersOnline || 0,
        maxPlayers: ping.maxPlayers || DEFAULT_MAX_PLAYERS,
        cpuPercent: 5,
        ramUsedMb,
        ramTotalMb,
        ec2State: ec2Info.state
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

      const ec2Info = await getEc2InstanceInfo();

      if (action === "start") {
        if (ec2Info.state === "running") {
          return buildResponse(200, { message: "Server EC2 instance is already running.", ok: true }, corsHeaders);
        }
        await ec2.send(new StartInstancesCommand({ InstanceIds: [INSTANCE_ID] }));
        return buildResponse(200, {
          ok: true,
          message: "AWS EC2 instance start requested. Mindustry service will automatically boot.",
          action: "start"
        }, corsHeaders);
      }

      if (action === "stop") {
        if (ec2Info.state !== "running") {
          return buildResponse(200, { message: `Instance is already in ${ec2Info.state} state.`, ok: true }, corsHeaders);
        }
        // Save world cleanly to disk and wait 3000ms before stopping the EC2 instance
        await executeSsmShell(
          `${FIFO_COMMAND_TEMPLATE} "echo 'save auto_shutdown' > \\$FIFO"; sleep 2; systemctl stop mindustry.service`,
          3000
        );
        await ec2.send(new StopInstancesCommand({ InstanceIds: [INSTANCE_ID] }));
        return buildResponse(200, {
          ok: true,
          message: "Saved world state and issued EC2 Stop command.",
          action: "stop"
        }, corsHeaders);
      }

      if (action === "restart") {
        if (ec2Info.state !== "running") {
          return buildResponse(400, { error: "Cannot restart service while EC2 instance is stopped." }, corsHeaders);
        }
        const ssmRes = await executeSsmShell(`systemctl restart mindustry.service`, 1200);
        return buildResponse(200, {
          ok: true,
          message: "Issued systemctl restart mindustry.service via SSM.",
          ssmStatus: ssmRes.status
        }, corsHeaders);
      }
    }

    // POST /api/mindustry/config or /api/admin/server/config
    if (method === "POST" && (path === "/api/mindustry/config" || path === "/api/admin/server/config")) {
      const ec2Info = await getEc2InstanceInfo();
      if (ec2Info.state !== "running") {
        return buildResponse(400, { error: "EC2 instance is stopped. Start server first." }, corsHeaders);
      }

      const commands = [];
      const serverName = body.name || body.serverName;
      if (serverName) {
        const cleanName = String(serverName).replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 48);
        commands.push(`${FIFO_COMMAND_TEMPLATE} "echo 'config name ${cleanName}' > \\$FIFO"`);
      }

      const playerLimit = body.playerLimit || body.maxPlayers;
      if (playerLimit && Number.isFinite(Number(playerLimit))) {
        const limit = Math.max(1, Math.min(64, Number(playerLimit)));
        commands.push(`${FIFO_COMMAND_TEMPLATE} "echo 'config playerLimit ${limit}' > \\$FIFO"`);
      }

      const desc = body.description || body.motd;
      if (desc) {
        const cleanDesc = String(desc).replace(/[^a-zA-Z0-9 _.,!?:-]/g, "").slice(0, 140);
        commands.push(`${FIFO_COMMAND_TEMPLATE} "echo 'config desc ${cleanDesc}' > \\$FIFO"`);
      }

      const map = body.map || body.nextMap;
      if (map) {
        const cleanMap = String(map).replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 48);
        commands.push(`${FIFO_COMMAND_TEMPLATE} "echo 'nextmap ${cleanMap}' > \\$FIFO"`);
      }

      // Configure default auto-save and public visibility if requested
      if (body.autosave !== undefined || body.autoSave !== undefined) {
        commands.push(`${FIFO_COMMAND_TEMPLATE} "echo 'config autosave true' > \\$FIFO"`);
      }

      if (commands.length === 0) {
        return buildResponse(400, { error: "No valid configuration fields provided." }, corsHeaders);
      }

      await executeSsmShell(commands.join("; "), 1000);
      return buildResponse(200, { ok: true, message: "Configuration parameters applied to Mindustry." }, corsHeaders);
    }

    // GET /api/mindustry/players or /api/admin/players
    if (method === "GET" && (path === "/api/mindustry/players" || path === "/api/admin/players")) {
      const ec2Info = await getEc2InstanceInfo();
      if (ec2Info.state !== "running") {
        return buildResponse(200, { ok: true, players: [] }, corsHeaders);
      }

      const ssmRes = await executeSsmShell(
        `${FIFO_COMMAND_TEMPLATE} "echo 'players' > \\$FIFO"; sleep 0.5; journalctl -u mindustry.service -n 25 --no-pager`,
        1000
      );
      return buildResponse(200, { ok: true, raw: ssmRes.stdout || "", players: [] }, corsHeaders);
    }

    // POST Player Actions: /api/mindustry/players/action or /api/admin/players/:action
    const isPlayerActionPath =
      path === "/api/mindustry/players/action" ||
      path === "/api/admin/players/kick" ||
      path === "/api/admin/players/ban" ||
      path === "/api/admin/players/unban";

    if (method === "POST" && isPlayerActionPath) {
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

      const target = String(body.playerId || body.target || "").replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 64);
      if (!target) {
        return buildResponse(400, { error: "Valid target player ID or IP required." }, corsHeaders);
      }

      await executeSsmShell(`${FIFO_COMMAND_TEMPLATE} "echo '${action} ${target}' > \\$FIFO"`, 800);
      return buildResponse(200, { ok: true, message: `Executed ${action} on player ${target}.` }, corsHeaders);
    }

    // GET /api/mindustry/logs or /api/admin/logs
    if (method === "GET" && (path === "/api/mindustry/logs" || path === "/api/admin/logs")) {
      const ec2Info = await getEc2InstanceInfo();
      if (ec2Info.state !== "running") {
        return buildResponse(200, { ok: true, logs: ["EC2 instance is currently stopped. Logs unavailable."] }, corsHeaders);
      }

      const limit = Math.min(200, Math.max(10, Number(event.queryStringParameters?.limit || 100)));
      const ssmRes = await executeSsmShell(`journalctl -u mindustry.service -n ${limit} --no-pager`, 1500);
      const lines = (ssmRes.stdout || "").split("\n").filter(Boolean);

      return buildResponse(200, { ok: true, logs: lines }, corsHeaders);
    }

    // POST Console: /api/mindustry/console or /api/admin/console/command
    if (method === "POST" && (path === "/api/mindustry/console" || path === "/api/admin/console/command")) {
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

      const ssmRes = await executeSsmShell(
        `${FIFO_COMMAND_TEMPLATE} "echo '${cmdString}' > \\$FIFO"; sleep 0.5; journalctl -u mindustry.service -n 10 --no-pager`,
        1200
      );

      return buildResponse(200, {
        ok: true,
        command: cmdString,
        message: `Command sent to Mindustry console.`,
        output: ssmRes.stdout || "Command dispatched."
      }, corsHeaders);
    }
  }

  // Fallthrough 404
  return buildResponse(404, { error: `Endpoint not found: ${method} ${path}`, code: "NOT_FOUND" }, corsHeaders);
};
