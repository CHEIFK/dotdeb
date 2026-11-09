#!/usr/bin/env node
import { hashPassword } from "./auth.mjs";

const password = process.argv[2];
if (!password) {
  console.log("Usage: node hash-password.mjs <your-plain-text-password>");
  process.exit(1);
}

const hash = hashPassword(password);
console.log("\nPassword hash generated successfully:");
console.log("--------------------------------------------------");
console.log(`ADMIN_PASSWORD_HASH="${hash}"`);
console.log("--------------------------------------------------");
console.log("Store this value in your Lambda environment variables or secrets manager.\n");
