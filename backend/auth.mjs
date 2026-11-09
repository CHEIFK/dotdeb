import crypto from "node:crypto";

const SESSION_SECRET = process.env.SESSION_SECRET || "change-me-in-production-zootopia-secret-key-32b";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "chief";
// Default scrypt hash for chief / chief100 with default salt
const DEFAULT_CHIEF_HASH = "423d1916c88c4c504a354867012c11baa3f40b1701de3999003ee5253f8c2c19799a9e7a218c4ecdd0bb998b9fc0f6f6b9048b0d281ed30bb179893165edf665";
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || DEFAULT_CHIEF_HASH;
const ADMIN_SALT = process.env.ADMIN_SALT || "zootopia_salt_2026";

// Sliding window rate limiter for login attempts with memory leak protection
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_STORED_IPS = 10000; // Bound memory to prevent exhaustion

function pruneExpiredAttempts(now) {
  if (loginAttempts.size > MAX_STORED_IPS) {
    for (const [key, record] of loginAttempts.entries()) {
      if (now > record.resetAt) {
        loginAttempts.delete(key);
      }
    }
  }
}

export function hashPassword(plainPassword, salt = ADMIN_SALT) {
  return crypto.scryptSync(plainPassword, salt, 64).toString("hex");
}

export function checkRateLimit(ip) {
  if (!ip || ip === "unknown") {
    return { allowed: true };
  }

  const now = Date.now();
  pruneExpiredAttempts(now);

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

export function verifyCredentials(username, password) {
  if (typeof username !== "string" || typeof password !== "string") return false;
  if (username.trim() !== ADMIN_USERNAME) return false;

  const expectedRaw = ADMIN_PASSWORD_HASH || DEFAULT_CHIEF_HASH;

  let salt = ADMIN_SALT;
  let expectedHash = expectedRaw;
  if (expectedRaw.includes(":")) {
    const parts = expectedRaw.split(":");
    salt = parts[0];
    expectedHash = parts[1];
  }

  const inputHash = hashPassword(password, salt);
  const bufInput = Buffer.from(inputHash, "utf-8");
  const bufExpected = Buffer.from(expectedHash, "utf-8");

  // Constant-time comparison with explicit length guard to avoid RangeError
  if (bufInput.length !== bufExpected.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufInput, bufExpected);
}

export function generateCsrfToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function verifyCsrfToken(headerToken, cookieToken) {
  if (!headerToken || !cookieToken) return false;
  if (typeof headerToken !== "string" || typeof cookieToken !== "string") return false;

  const bufHeader = Buffer.from(headerToken, "utf-8");
  const bufCookie = Buffer.from(cookieToken, "utf-8");

  if (bufHeader.length !== bufCookie.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufHeader, bufCookie);
}

export function createSessionToken(username) {
  const payload = {
    username,
    exp: Date.now() + 8 * 60 * 60 * 1000 // 8 hours
  };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const hmac = crypto.createHmac("sha256", SESSION_SECRET).update(data).digest("base64url");
  return `${data}.${hmac}`;
}

export function verifySessionToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [data, signature] = parts;
  const expectedHmac = crypto.createHmac("sha256", SESSION_SECRET).update(data).digest("base64url");

  const bufSig = Buffer.from(signature);
  const bufExpected = Buffer.from(expectedHmac);

  // Guard against RangeError before timingSafeEqual
  if (bufSig.length !== bufExpected.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(bufSig, bufExpected)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf-8"));
    if (typeof payload.exp !== "number" || Date.now() > payload.exp) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
