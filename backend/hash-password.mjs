#!/usr/bin/env node
import readline from "node:readline";
import { hashPassword } from "./auth.mjs";

function outputHash(plain) {
  const hash = hashPassword(plain);
  console.log("\nPassword hash generated successfully:");
  console.log("--------------------------------------------------");
  console.log(`ADMIN_PASSWORD_HASH="${hash}"`);
  console.log("--------------------------------------------------");
  console.log("Store this value in your Lambda environment variables or template parameters.\n");
}

const argPassword = process.argv[2];
if (argPassword) {
  outputHash(argPassword);
} else {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question("Enter plain text admin password to hash: ", (answer) => {
    rl.close();
    if (!answer) {
      console.error("Password cannot be empty.");
      process.exit(1);
    }
    outputHash(answer);
  });
}
