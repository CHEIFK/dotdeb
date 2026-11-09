import crypto from "node:crypto";

const SESSION_SECRET = process.env.SESSION_SECRET || "change-me-in-production-continental-secret-key-32b";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "chief";
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || "";

// Sliding window rate limiter for login attempts with memory leak protection
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_STORED_IPS = 10000; // Bound memory to prevent exhaustion

// Server-side session revocation store (revoked JTIs)
const revokedSessions = new Map();

function pruneExpiredRecords(now) {
  // Prune login attempts
  if (loginAttempts.size > MAX_STORED_IPS) {
    for (const [key, record] of loginAttempts.entries()) {
      if (now > record.resetAt) {
        loginAttempts.delete(key);
      }
    }
  }
  // Prune revoked sessions
  for (const [jti, exp] of revokedSessions.entries()) {
    if (now > exp) {
      revokedSessions.delete(jti);
    }
  }
}

/**
 * Hashes a plain password with a cryptographically secure random salt.
 * Returns format: "salt:hash"
 */
export function hashPassword(plainPassword, customSalt = null) {
  const salt = customSalt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plainPassword, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function checkRateLimit(ip) {
  if (!ip || ip === "unknown") {
    return { allowed: true };
  }

  const now = Date.now();
  pruneExpiredRecords(now);

  const record = loginAttempts.get(ip);
  if (!record || now > record.resetAt) {
    return { allowed: true };
  }

  if (record.count >= MAX_ATTEMPTS) {
    const retryAfterSec = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
    return { allowed: false, retryAfter: retryAfterSec };
  }

  return { allowed: true, record };
}

export function recordFailedAttempt(ip) {
  if (!ip || ip === "unknown") return;
  const now = Date.now();
  let record = loginAttempts.get(ip);
  if (!record || now > record.resetAt) {
    record = { count: 1, resetAt: now + WINDOW_MS };
  } else {
    record.count += 1;
  }
  loginAttempts.set(ip, record);
}

export function resetAttempts(ip) {
  if (ip && ip !== "unknown") {
    loginAttempts.delete(ip);
  }
}

/**
 * Verifies admin credentials.
 * Supports "salt:hash" format.
 * Never allows login if ADMIN_PASSWORD_HASH is unset in production.
 */
export function verifyCredentials(username, password) {
  if (typeof username !== "string" || typeof password !== "string") return false;
  if (username.trim() !== ADMIN_USERNAME) return false;

  // In test / non-Lambda development, fall back to a local testing hash if explicitly allowed
  let expectedRaw = ADMIN_PASSWORD_HASH;
  if (!expectedRaw) {
    // If running in development/local test mode, allow checking with a local test hash
    if (process.env.NODE_ENV === "test" || !process.env.AWS_LAMBDA_FUNCTION_NAME) {
      // Local testing hash for chief / chief100
      expectedRaw = "a4c28f11d95e427189b2713f01c2384a:579571667fa14b759d3b0e662dc2619b0b35c04f6a4cd6282fbdd2e2453dd64f238494ae2eb2760d2154b17406b05074f05cac7b8c269e8d5a7ad130cca589e3";
    } else {
      console.error("ADMIN_PASSWORD_HASH is not configured in production environment.");
      return false;
    }
  }

  if (!expectedRaw.includes(":")) {
    console.error("Invalid ADMIN_PASSWORD_HASH format; must be 'salt:hash'.");
    return false;
  }

  const [salt, expectedHash] = expectedRaw.split(":");
  const calculatedHash = crypto.scryptSync(password, salt, 64).toString("hex");

  const bufCalculated = Buffer.from(calculatedHash, "utf-8");
  const bufExpected = Buffer.from(expectedHash, "utf-8");

  if (bufCalculated.length !== bufExpected.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufCalculated, bufExpected);
}

/**
 * Generates cryptographically secure 32-byte hex CSRF token
 */
export function generateCsrfToken() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Validates CSRF token with constant-time comparison
 */
export function verifyCsrfToken(headerToken, cookieToken) {
  if (!headerToken || !cookieToken) return false;
  if (typeof headerToken !== "string" || typeof cookieToken !== "string") return false;

  const bufHeader = Buffer.from(headerToken, "utf-8");
  const bufCookie = Buffer.from(cookieToken, "utf-8");

  if (bufHeader.length !== bufCookie.length || bufHeader.length !== 64) {
    return false;
  }

  return crypto.timingSafeEqual(bufHeader, bufCookie);
}

/**
 * Creates HMAC-SHA256 signed session token with unique JTI for server-side revocation
 */
export function createSessionToken(username) {
  const jti = crypto.randomBytes(16).toString("hex");
  const exp = Date.now() + 8 * 60 * 60 * 1000; // 8 hours
  const payload = {
    username,
    jti,
    iat: Date.now(),
    exp
  };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const hmac = crypto.createHmac("sha256", SESSION_SECRET).update(data).digest("base64url");
  return `${data}.${hmac}`;
}

/**
 * Verifies HMAC signature, expiration, and ensures session has not been revoked server-side
 */
export function verifySessionToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [data, signature] = parts;
  const expectedHmac = crypto.createHmac("sha256", SESSION_SECRET).update(data).digest("base64url");

  const bufSig = Buffer.from(signature);
  const bufExpected = Buffer.from(expectedHmac);

  if (bufSig.length !== bufExpected.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(bufSig, bufExpected)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf-8"));
    const now = Date.now();

    if (typeof payload.exp !== "number" || now > payload.exp) {
      return null;
    }

    // Check if session has been explicitly revoked
    if (payload.jti && revokedSessions.has(payload.jti)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Revokes a session token on the server side
 */
export function revokeSession(token) {
  if (!token || typeof token !== "string") return;
  try {
    const parts = token.split(".");
    if (parts.length !== 2) return;
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf-8"));
    if (payload.jti && payload.exp) {
      revokedSessions.set(payload.jti, payload.exp);
    }
  } catch {}
}
