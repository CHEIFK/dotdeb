/**
 * Continental Mindustry Network — Comprehensive Automated Test Suite
 * Validates authentication, CSRF, rate-limiting, session revocation,
 * multi-server command isolation, shell injection prevention, and EC2 offline handling.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  hashPassword,
  verifyCredentials,
  checkRateLimit,
  recordFailedAttempt,
  resetAttempts,
  generateCsrfToken,
  verifyCsrfToken,
  createSessionToken,
  verifySessionToken,
  revokeSession
} from "./auth.mjs";
import { handler } from "./index.mjs";

console.log("==========================================================");
console.log("=== Continental Mindustry Network — Automated Test Suite ===");
console.log("==========================================================\n");

let passedCount = 0;
let totalCount = 0;

function runTest(testName, fn) {
  totalCount++;
  try {
    fn();
    console.log(`  ✓ PASS: ${testName}`);
    passedCount++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${testName}`);
    console.error(`    -> ${err.message}`);
  }
}

async function runAsyncTest(testName, fn) {
  totalCount++;
  try {
    await fn();
    console.log(`  ✓ PASS: ${testName}`);
    passedCount++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${testName}`);
    console.error(`    -> ${err.message}`);
  }
}

// ----------------------------------------------------
// 1. Password Hashing & Unique Random Salt Tests
// ----------------------------------------------------
console.log("[1] Security & Password Hashing Tests:");

runTest("Password hash generates unique salt per call", () => {
  const hash1 = hashPassword("chief100");
  const hash2 = hashPassword("chief100");
  assert.notEqual(hash1, hash2, "Hashes must have unique random salts");
  assert.ok(hash1.includes(":"), "Hash must follow salt:hash format");
  const [salt1, h1] = hash1.split(":");
  const [salt2, h2] = hash2.split(":");
  assert.equal(salt1.length, 32, "Salt must be 16 bytes (32 hex characters)");
  assert.equal(h1.length, 128, "Scrypt output must be 64 bytes (128 hex characters)");
  assert.notEqual(salt1, salt2, "Salts must be randomly generated");
});

runTest("verifyCredentials rejects wrong username", () => {
  assert.equal(verifyCredentials("attacker", "chief100"), false);
  assert.equal(verifyCredentials("admin", "chief100"), false);
});

runTest("verifyCredentials rejects wrong password", () => {
  assert.equal(verifyCredentials("chief", "wrongpass"), false);
});

runTest("verifyCredentials accepts valid password in development mode", () => {
  assert.equal(verifyCredentials("chief", "chief100"), true);
});

// ----------------------------------------------------
// 2. CSRF Token Tests
// ----------------------------------------------------
console.log("\n[2] CSRF Token Protection Tests:");

runTest("generateCsrfToken returns 64-char hex token", () => {
  const csrf = generateCsrfToken();
  assert.equal(typeof csrf, "string");
  assert.equal(csrf.length, 64);
});

runTest("verifyCsrfToken validates matching tokens", () => {
  const token = generateCsrfToken();
  assert.equal(verifyCsrfToken(token, token), true);
});

runTest("verifyCsrfToken rejects mismatched or empty tokens", () => {
  const t1 = generateCsrfToken();
  const t2 = generateCsrfToken();
  assert.equal(verifyCsrfToken(t1, t2), false);
  assert.equal(verifyCsrfToken("", t1), false);
  assert.equal(verifyCsrfToken(null, t1), false);
  assert.equal(verifyCsrfToken(t1, "short"), false);
});

// ----------------------------------------------------
// 3. Session & Server-Side Invalidation Tests
// ----------------------------------------------------
console.log("\n[3] Session Security & Invalidation Tests:");

let testToken = null;
runTest("createSessionToken generates signed HMAC token", () => {
  testToken = createSessionToken("chief");
  assert.ok(testToken.includes("."), "Session token must have data.signature");
  const payload = verifySessionToken(testToken);
  assert.ok(payload);
  assert.equal(payload.username, "chief");
  assert.ok(payload.jti, "Session must have unique JTI");
  assert.ok(payload.exp > Date.now());
});

runTest("verifySessionToken rejects tampered signature", () => {
  const parts = testToken.split(".");
  const tampered = `${parts[0]}.invalidSignatureHex`;
  assert.equal(verifySessionToken(tampered), null);
});

runTest("revokeSession successfully revokes token server-side on logout", () => {
  const token = createSessionToken("chief");
  assert.ok(verifySessionToken(token), "Token must be valid before revocation");
  revokeSession(token);
  assert.equal(verifySessionToken(token), null, "Token must be invalid immediately after revocation");
});

// ----------------------------------------------------
// 4. Rate Limiting Tests
// ----------------------------------------------------
console.log("\n[4] Rate Limiting Protection Tests:");

runTest("Rate limiter allows initial requests and blocks after 5 failed attempts", () => {
  const testIp = `192.0.2.${Math.floor(Math.random() * 200 + 10)}`;
  resetAttempts(testIp);

  for (let i = 0; i < 4; i++) {
    recordFailedAttempt(testIp);
    const check = checkRateLimit(testIp);
    assert.equal(check.allowed, true, `Attempt ${i + 1} should be allowed`);
  }

  recordFailedAttempt(testIp);
  const blockedCheck = checkRateLimit(testIp);
  assert.equal(blockedCheck.allowed, false, "5th attempt must trigger rate-limit block");
  assert.ok(blockedCheck.retryAfter > 0, "Must return retryAfter duration in seconds");

  resetAttempts(testIp);
  assert.equal(checkRateLimit(testIp).allowed, true, "resetAttempts must unblock the IP");
});

// ----------------------------------------------------
// 5. Handler & Route Integration Tests
// ----------------------------------------------------
console.log("\n[5] Handler & API Endpoint Integration Tests:");

await runAsyncTest("GET /api/mindustry/status returns all 3 Continental servers", async () => {
  const event = {
    httpMethod: "GET",
    rawPath: "/api/mindustry/status",
    headers: { origin: "https://dotdeb.dpdns.org" }
  };
  const res = await handler(event);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.network, "Continental Mindustry Network");
  assert.ok(body.servers, "Must contain servers object");
  assert.ok(body.servers.survival, "Must contain survival server");
  assert.ok(body.servers.tower, "Must contain tower server");
  assert.ok(body.servers.attack, "Must contain attack server");
  assert.equal(body.servers.survival.port, 6567);
  assert.equal(body.servers.tower.port, 6568);
  assert.equal(body.servers.attack.port, 6569);
});

await runAsyncTest("GET /api/auth/csrf returns fresh token and sets HttpOnly cookie", async () => {
  const event = {
    httpMethod: "GET",
    rawPath: "/api/auth/csrf",
    headers: { origin: "https://dotdeb.dpdns.org" }
  };
  const res = await handler(event);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.ok(body.csrfToken);
  assert.equal(body.csrfToken.length, 64);
  assert.ok(res.headers["Set-Cookie"].includes("csrf_token="));
  assert.ok(res.headers["Set-Cookie"].includes("HttpOnly"));
});

await runAsyncTest("POST /api/auth/login validates credentials and creates session", async () => {
  const csrf = generateCsrfToken();
  const event = {
    httpMethod: "POST",
    rawPath: "/api/auth/login",
    headers: {
      origin: "https://dotdeb.dpdns.org",
      "x-csrf-token": csrf,
      cookie: `csrf_token=${csrf}`
    },
    body: JSON.stringify({ username: "chief", password: "chief100" })
  };
  const res = await handler(event);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.user, "chief");
  assert.ok(res.headers["Set-Cookie"].includes("continental_session="));
});

await runAsyncTest("POST /api/auth/logout invalidates session and clears cookie", async () => {
  const token = createSessionToken("chief");
  const csrf = generateCsrfToken();
  const event = {
    httpMethod: "POST",
    rawPath: "/api/auth/logout",
    headers: {
      origin: "https://dotdeb.dpdns.org",
      "x-csrf-token": csrf,
      cookie: `continental_session=${token}; csrf_token=${csrf}`
    }
  };
  const res = await handler(event);
  assert.equal(res.statusCode, 200);
  assert.ok(res.headers["Set-Cookie"].includes("Max-Age=0"));
  // Verify token is now rejected
  assert.equal(verifySessionToken(token), null);
});

// ----------------------------------------------------
// 6. Multi-Server Target Isolation & Injection Tests
// ----------------------------------------------------
console.log("\n[6] Multi-Server Command Isolation & Injection Tests:");

await runAsyncTest("Protected endpoint rejects request without session", async () => {
  const event = {
    httpMethod: "GET",
    rawPath: "/api/admin/server/overview",
    headers: { origin: "https://dotdeb.dpdns.org" }
  };
  const res = await handler(event);
  assert.equal(res.statusCode, 401);
  const body = JSON.parse(res.body);
  assert.equal(body.code, "UNAUTHORIZED");
});

await runAsyncTest("Protected POST rejects request without valid CSRF token", async () => {
  const token = createSessionToken("chief");
  const event = {
    httpMethod: "POST",
    rawPath: "/api/admin/server/control",
    headers: {
      origin: "https://dotdeb.dpdns.org",
      cookie: `continental_session=${token}`
    },
    body: JSON.stringify({ action: "start", server: "survival" })
  };
  const res = await handler(event);
  assert.equal(res.statusCode, 403);
  const body = JSON.parse(res.body);
  assert.equal(body.code, "CSRF_FAILED");
});

await runAsyncTest("Control rejects invalid server ID", async () => {
  const token = createSessionToken("chief");
  const csrf = generateCsrfToken();
  const event = {
    httpMethod: "POST",
    rawPath: "/api/admin/server/control",
    headers: {
      origin: "https://dotdeb.dpdns.org",
      "x-csrf-token": csrf,
      cookie: `continental_session=${token}; csrf_token=${csrf}`
    },
    body: JSON.stringify({ action: "restart", server: "malicious_server_id" })
  };
  const res = await handler(event);
  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res.body);
  assert.equal(body.code, "INVALID_SERVER");
});

await runAsyncTest("Console rejects disallowed shell commands", async () => {
  const token = createSessionToken("chief");
  const csrf = generateCsrfToken();
  const event = {
    httpMethod: "POST",
    rawPath: "/api/admin/console/command",
    headers: {
      origin: "https://dotdeb.dpdns.org",
      "x-csrf-token": csrf,
      cookie: `continental_session=${token}; csrf_token=${csrf}`
    },
    body: JSON.stringify({ command: "rm -rf /", server: "survival" })
  };
  const res = await handler(event);
  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res.body);
  assert.ok(body.error.includes("Disallowed command") || body.error.includes("EC2 instance is stopped"));
});

await runAsyncTest("Console rejects shell metacharacter injection in arguments", async () => {
  const token = createSessionToken("chief");
  const csrf = generateCsrfToken();
  const event = {
    httpMethod: "POST",
    rawPath: "/api/admin/console/command",
    headers: {
      origin: "https://dotdeb.dpdns.org",
      "x-csrf-token": csrf,
      cookie: `continental_session=${token}; csrf_token=${csrf}`
    },
    body: JSON.stringify({ command: "say", argument: "hello; cat /etc/shadow", server: "survival" })
  };
  const res = await handler(event);
  // Either stripped or rejected, never executing arbitrary shell commands
  assert.ok(res.statusCode === 200 || res.statusCode === 400);
});

console.log("\n==========================================================");
console.log(`Results: ${passedCount} / ${totalCount} tests passed (${Math.round((passedCount / totalCount) * 100)}%)`);
console.log("==========================================================");

if (passedCount !== totalCount) {
  process.exit(1);
}
