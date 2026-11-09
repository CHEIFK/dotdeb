import crypto from "node:crypto";

const SESSION_SECRET = process.env.SESSION_SECRET || "change-me-in-production-zootopia-secret-key-32b";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
// Example default hash for setup (admin / Zootopia2026!) or configured in env
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || "";
const ADMIN_SALT = process.env.ADMIN_SALT || "zootopia_salt_2026";

// In-memory sliding window rate limiter for login attempts
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export function hashPassword(plainPassword, salt = ADMIN_SALT) {
  return crypto.scryptSync(plainPassword, salt, 64).toString("hex");
}

export function checkRateLimit(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip) || { count: 0, resetAt: now + WINDOW_MS };
  
  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + WINDOW_MS;
  }
  
  if (record.count >= MAX_ATTEMPTS) {
    const retryAfterSec = Math.ceil((record.resetAt - now) / 1000);
    return { allowed: false, retryAfter: retryAfterSec };
  }
  
  return { allowed: true, record };
}

export function recordFailedAttempt(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip) || { count: 0, resetAt: now + WINDOW_MS };
  record.count += 1;
  loginAttempts.set(ip, record);
}

export function resetAttempts(ip) {
  loginAttempts.delete(ip);
}

export function verifyCredentials(username, password) {
  if (username !== ADMIN_USERNAME) return false;
  
  // If no ADMIN_PASSWORD_HASH is provided, fallback to temporary setup password check
  // or return false if in strict production
  const expectedHash = ADMIN_PASSWORD_HASH || hashPassword("Zootopia2026!");
  const inputHash = hashPassword(password);
  
  return crypto.timingSafeEqual(
    Buffer.from(inputHash, "utf-8"),
    Buffer.from(expectedHash, "utf-8")
  );
}

export function generateCsrfToken() {
  return crypto.randomBytes(32).toString("hex");
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
  
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedHmac))) {
    return null;
  }
  
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf-8"));
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
