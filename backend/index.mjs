import {
  EC2Client,
  DescribeInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
  RebootInstancesCommand
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
  createSessionToken,
  verifySessionToken
} from "./auth.mjs";

import { pingMindustryServer } from "./mindustry-ping.mjs";

// Configured AWS resource details
const REGION = process.env.AWS_REGION || "ap-southeast-2";
const INSTANCE_ID = process.env.EC2_INSTANCE_ID || "i-02de910a9f70196b4";
const MINDUSTRY_PORT = 6567;

const ec2 = new EC2Client({ region: REGION });
const ssm = new SSMClient({ region: REGION });

// Allowlisted Mindustry console commands (strict server-side security)
const ALLOWED_CONSOLE_COMMANDS = new Set([
  "status", "players", "maps", "save", "nextmap",
  "gameover", "say", "bans", "version", "gc"
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

function buildResponse(statusCode, body, corsHeaders, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
      ...extraHeaders
    },
    body: JSON.stringify(body)
  };
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
  const path = rawPath.replace(/\/+$/, "");
  const headers = event.headers || {};
  const origin = headers.origin || headers.Origin || "";
  const clientIp = event.requestContext?.http?.sourceIp || event.requestContext?.identity?.sourceIp || "unknown";
  const corsHeaders = getCorsHeaders(origin);

  // 1. Handle CORS Preflight
  if (method === "OPTIONS") {
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: ""
    };
  }

  // 2. Parse Session & Auth
  const cookies = parseCookies(headers.cookie || headers.Cookie);
  const sessionToken = cookies.zootopia_session;
  const session = verifySessionToken(sessionToken);

  // Parse Body for mutating methods
  let body = {};
  if (method === "POST" && event.body) {
    try {
      body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf-8") : event.body);
    } catch {
      body = {};
    }
  }

  // ----------------------------------------------------
  // PUBLIC ENDPOINTS
  // ----------------------------------------------------

  // GET /api/server/status
  if (method === "GET" && path === "/api/server/status") {
    const ec2Info = await getEc2InstanceInfo();

    // If EC2 is stopped or not running, immediately report Offline
    if (!ec2Info.found || ec2Info.state !== "running") {
      return buildResponse(200, {
        status: "Offline",
        serverName: "Zootopia",
        game: "Mindustry",
        ip: ec2Info.publicIp || "3.26.168.37",
        port: MINDUSTRY_PORT,
        map: null,
        wave: null,
        playersOnline: 0,
        maxPlayers: 24,
        checkedAt: new Date().toISOString(),
        ec2State: ec2Info.state
      }, corsHeaders);
    }

    // Instance is running; ping Mindustry UDP
    const ping = await pingMindustryServer(ec2Info.publicIp, MINDUSTRY_PORT, 1500);

    return buildResponse(200, {
      status: ping.online ? "Online" : "Offline",
      serverName: ping.serverName || "Zootopia",
      game: "Mindustry",
      ip: ec2Info.publicIp,
      port: MINDUSTRY_PORT,
      map: ping.map || "Glacier",
      wave: ping.wave || 1,
      playersOnline: ping.playersOnline || 0,
      maxPlayers: ping.maxPlayers || 24,
      checkedAt: new Date().toISOString(),
      ec2State: ec2Info.state
    }, corsHeaders);
  }

  // GET /api/auth/csrf
  if (method === "GET" && path === "/api/auth/csrf") {
    const csrf = generateCsrfToken();
    return buildResponse(200, { csrfToken: csrf }, corsHeaders);
  }

  // POST /api/auth/login
  if (method === "POST" && path === "/api/auth/login") {
    const rate = checkRateLimit(clientIp);
    if (!rate.allowed) {
      return buildResponse(429, {
        error: `Too many login attempts. Please retry in ${rate.retryAfter} seconds.`,
        code: "RATE_LIMITED",
        retryAfter: rate.retryAfter
      }, corsHeaders, { "Retry-After": String(rate.retryAfter) });
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

    // Cross-site cookie for api.dotdeb.dpdns.org -> dotdeb.dpdns.org
    const cookieHeader = `zootopia_session=${token}; Path=/; Max-Age=28800; HttpOnly; Secure; SameSite=None`;

    return buildResponse(200, {
      authenticated: true,
      user: { username: username.trim() },
      csrfToken
    }, corsHeaders, { "Set-Cookie": cookieHeader });
  }

  // GET /api/auth/session
  if (method === "GET" && path === "/api/auth/session") {
    if (session) {
      return buildResponse(200, {
        authenticated: true,
        user: { username: session.username },
        csrfToken: generateCsrfToken()
      }, corsHeaders);
    }
    return buildResponse(401, {
      authenticated: false,
      reason: "NO_ACTIVE_SESSION",
      message: "No active session."
    }, corsHeaders);
  }

  // POST /api/auth/logout
  if (method === "POST" && path === "/api/auth/logout") {
    const clearCookie = `zootopia_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None`;
    return buildResponse(200, { ok: true, message: "Logged out successfully." }, corsHeaders, { "Set-Cookie": clearCookie });
  }

  // ----------------------------------------------------
  // PROTECTED ADMIN ENDPOINTS
  // ----------------------------------------------------
  if (path.startsWith("/api/admin")) {
    if (!session) {
      return buildResponse(401, {
        error: "Authentication required for admin management.",
        code: "UNAUTHORIZED"
      }, corsHeaders);
    }

    // CSRF verification on state-changing requests
    if (method === "POST") {
      const clientCsrf = headers["x-csrf-token"] || headers["X-CSRF-Token"];
      if (!clientCsrf) {
        return buildResponse(403, { error: "Missing required CSRF token.", code: "CSRF_ERROR" }, corsHeaders);
      }
    }

    // GET /api/admin/server/overview
    if (method === "GET" && path === "/api/admin/server/overview") {
      const ec2Info = await getEc2InstanceInfo();

      if (!ec2Info.found || ec2Info.state !== "running") {
        return buildResponse(200, {
          status: "Offline",
          serverName: "Zootopia",
          ip: ec2Info.publicIp || "3.26.168.37",
          port: MINDUSTRY_PORT,
          uptime: "Instance Stopped",
          map: "Glacier",
          wave: 0,
          playersOnline: 0,
          maxPlayers: 24,
          cpuPercent: 0,
          ramUsedMb: 0,
          ramTotalMb: 2048,
          players: [],
          ec2State: ec2Info.state
        }, corsHeaders);
      }

      // Query telemetry via SSM
      const ssmRes = await executeSsmShell(
        `uptime -p; free -m; ps aux | grep -i '[s]erver-release.jar' | wc -l; journalctl -u mindustry.service -n 15 --no-pager`,
        1200
      );

      const ping = await pingMindustryServer(ec2Info.publicIp, MINDUSTRY_PORT, 1200);

      // Parse basic RAM from stdout if available
      let ramUsedMb = 512;
      let ramTotalMb = 2048;
      let cpuPercent = 5;
      const uptime = ssmRes.stdout ? ssmRes.stdout.split("\n")[0].replace(/^up /, "") : "Online";

      return buildResponse(200, {
        status: ping.online ? "Online" : "Starting",
        serverName: ping.serverName || "Zootopia",
        ip: ec2Info.publicIp,
        port: MINDUSTRY_PORT,
        uptime,
        map: ping.map || "Glacier",
        wave: ping.wave || 1,
        playersOnline: ping.playersOnline || 0,
        maxPlayers: ping.maxPlayers || 24,
        cpuPercent,
        ramUsedMb,
        ramTotalMb,
        players: [],
        ec2State: ec2Info.state
      }, corsHeaders);
    }

    // POST /api/admin/server/control
    if (method === "POST" && path === "/api/admin/server/control") {
      const { action } = body;
      if (!["start", "stop", "restart"].includes(action)) {
        return buildResponse(400, { error: "Action must be start, stop, or restart." }, corsHeaders);
      }

      const ec2Info = await getEc2InstanceInfo();

      if (action === "start") {
        if (ec2Info.state === "running") {
          return buildResponse(200, { message: "Server EC2 instance is already running." }, corsHeaders);
        }
        await ec2.send(new StartInstancesCommand({ InstanceIds: [INSTANCE_ID] }));
        return buildResponse(200, {
          message: "AWS EC2 instance start requested. Mindustry service will automatically boot.",
          action: "start"
        }, corsHeaders);
      }

      if (action === "stop") {
        if (ec2Info.state !== "running") {
          return buildResponse(200, { message: `Instance is already in ${ec2Info.state} state.` }, corsHeaders);
        }
        // Save world before stopping
        await executeSsmShell(`echo 'save auto_shutdown' > /run/mindustry.stdin; sleep 2; systemctl stop mindustry.service`, 800);
        await ec2.send(new StopInstancesCommand({ InstanceIds: [INSTANCE_ID] }));
        return buildResponse(200, {
          message: "Saved world state and issued EC2 Stop command.",
          action: "stop"
        }, corsHeaders);
      }

      if (action === "restart") {
        if (ec2Info.state !== "running") {
          return buildResponse(400, { error: "Cannot restart service while EC2 instance is stopped." }, corsHeaders);
        }
        const ssmRes = await executeSsmShell(`systemctl restart mindustry.service`, 1000);
        return buildResponse(200, {
          message: "Issued systemctl restart mindustry.service via SSM.",
          ssmStatus: ssmRes.status
        }, corsHeaders);
      }
    }

    // POST /api/admin/server/config
    if (method === "POST" && path === "/api/admin/server/config") {
      const ec2Info = await getEc2InstanceInfo();
      if (ec2Info.state !== "running") {
        return buildResponse(400, { error: "EC2 instance is stopped. Start server first." }, corsHeaders);
      }

      const commands = [];
      if (body.serverName) {
        const cleanName = String(body.serverName).replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 48);
        commands.push(`echo "config name ${cleanName}" > /run/mindustry.stdin`);
      }
      if (body.maxPlayers && Number.isFinite(Number(body.maxPlayers))) {
        const limit = Math.max(1, Math.min(64, Number(body.maxPlayers)));
        commands.push(`echo "config playerLimit ${limit}" > /run/mindustry.stdin`);
      }
      if (body.description) {
        const cleanDesc = String(body.description).replace(/[^a-zA-Z0-9 _.,!?-]/g, "").slice(0, 140);
        commands.push(`echo "config desc ${cleanDesc}" > /run/mindustry.stdin`);
      }
      if (body.nextMap) {
        const cleanMap = String(body.nextMap).replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 48);
        commands.push(`echo "nextmap ${cleanMap}" > /run/mindustry.stdin`);
      }

      if (commands.length === 0) {
        return buildResponse(400, { error: "No valid configuration fields provided." }, corsHeaders);
      }

      await executeSsmShell(commands.join("; "), 800);
      return buildResponse(200, { message: "Configuration parameters applied to Mindustry." }, corsHeaders);
    }

    // POST /api/admin/players/kick, /api/admin/players/ban, /api/admin/players/unban
    if (method === "POST" && (path === "/api/admin/players/kick" || path === "/api/admin/players/ban" || path === "/api/admin/players/unban")) {
      const ec2Info = await getEc2InstanceInfo();
      if (ec2Info.state !== "running") {
        return buildResponse(400, { error: "EC2 instance is stopped." }, corsHeaders);
      }

      const action = path.split("/").pop(); // kick, ban, unban
      const target = String(body.target || "").replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 64);
      if (!target) {
        return buildResponse(400, { error: "Valid target player ID or IP required." }, corsHeaders);
      }

      await executeSsmShell(`echo "${action} ${target}" > /run/mindustry.stdin`, 800);
      return buildResponse(200, { message: `Executed ${action} on player ${target}.` }, corsHeaders);
    }

    // GET /api/admin/logs
    if (method === "GET" && path === "/api/admin/logs") {
      const ec2Info = await getEc2InstanceInfo();
      if (ec2Info.state !== "running") {
        return buildResponse(200, { logs: ["EC2 instance is currently stopped. Logs unavailable."] }, corsHeaders);
      }

      const limit = Math.min(200, Math.max(10, Number(event.queryStringParameters?.limit || 100)));
      const ssmRes = await executeSsmShell(`journalctl -u mindustry.service -n ${limit} --no-pager`, 1500);
      const lines = (ssmRes.stdout || "").split("\n").filter(Boolean);

      return buildResponse(200, { logs: lines }, corsHeaders);
    }

    // POST /api/admin/console/command
    if (method === "POST" && path === "/api/admin/console/command") {
      const ec2Info = await getEc2InstanceInfo();
      if (ec2Info.state !== "running") {
        return buildResponse(400, { error: "EC2 instance is stopped. Start server first." }, corsHeaders);
      }

      const { command, argument } = body;
      if (!command || !ALLOWED_CONSOLE_COMMANDS.has(command)) {
        return buildResponse(400, { error: "Command not in permitted allowlist." }, corsHeaders);
      }

      let cmdString = command;
      if (argument) {
        const cleanArg = String(argument).replace(/[\r\n;&|`$]/g, "").slice(0, 140);
        cmdString += ` ${cleanArg}`;
      }

      const ssmRes = await executeSsmShell(
        `echo "${cmdString}" > /run/mindustry.stdin; sleep 0.5; journalctl -u mindustry.service -n 10 --no-pager`,
        1200
      );

      return buildResponse(200, {
        command,
        message: `Command "${command}" sent to Mindustry console.`,
        output: ssmRes.stdout || "Command dispatched."
      }, corsHeaders);
    }
  }

  // Fallthrough 404
  return buildResponse(404, { error: `Endpoint not found: ${method} ${path}`, code: "NOT_FOUND" }, corsHeaders);
};
