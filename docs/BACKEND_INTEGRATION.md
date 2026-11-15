# Continental Mindustry Network — Backend Integration & Architecture Guide

This document outlines the architecture, security configurations, systemd setups, and API implementation for the **Continental Mindustry Network** (three independent Mindustry servers on AWS EC2) connected to the **DOT • DEB** static frontend on DigitalPlanet.

---

## 1. Network & Server Topology

All three servers run on a single AWS EC2 instance:

| Server Name | Port | Systemd Service | Game Mode | Default Map | Stdin FIFO Pipe |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Continental Survival** | `6567` (TCP & UDP) | `mindustry-survival` | Survival / Co-op | Glacier | `/run/mindustry/survival.fifo` |
| **Continental Tower Defence** | `6568` (TCP & UDP) | `mindustry-tower` | Tower Defence | Fortress | `/run/mindustry/tower.fifo` |
| **Continental Attack** | `6569` (TCP & UDP) | `mindustry-attack` | Attack / PvP | Frontline | `/run/mindustry/attack.fifo` |

- **Host Machine**: Ubuntu 26.04 LTS on AWS EC2 (`t3.small`)
- **Instance ID**: `i-02de910a9f70196b4`
- **Public IP**: `16.176.55.109`
- **Region**: `ap-southeast-2` (Sydney)
- **Runtime**: OpenJDK 21

```
┌─────────────────────────────────────────┐           HTTPS (TLS 1.3)           ┌──────────────────────────────────────┐
│       DigitalPlanet (Static Host)       │ ─────────────────────────────────>  │              Cloudflare              │
│        https://dotdeb.dpdns.org/        │   - HttpOnly SameSite Cookies       │         api.dotdeb.dpdns.org         │
│                                         │   - CORS restricted to dotdeb       │         (Proxy / CNAME / TLS)        │
│  - index.html (Continental Card)        │   - CSRF & Rate-limiting            └──────────────────┬───────────────────┘
│  - zootopia.html (3-Server Overview)    │                                                        │
│  - admin/login.html (Admin Portal)      │                                                        ▼
│  - admin/dashboard.html (Dashboard)     │                                     ┌──────────────────────────────────────┐
│  - config.js (Network Config)           │                                     │        AWS API Gateway (HTTP)        │
└─────────────────────────────────────────┘                                     └──────────────────┬───────────────────┘
                                                                                                   │
                                                                                                   ▼
                                                                                ┌──────────────────────────────────────┐
                                                                                │        AWS Lambda (Node.js 20)       │
                                                                                │  • Scrypt auth with unique salt      │
                                                                                │  • JTI session server-side revoke    │
                                                                                │  • CSRF token verification           │
                                                                                │  • 15-min IP rate limiting           │
                                                                                └──────────────┬───────────────────────┘
                                                                                               │
                                                                                    AWS Systems Manager (SSM)
                                                                                    Run Command (AWS-RunShellScript)
                                                                                               │
                                                                                               ▼
                                                                                ┌──────────────────────────────────────┐
                                                                                │         AWS EC2 Ubuntu Host          │
                                                                                │            16.176.55.109             │
                                                                                │  ┌────────────────────────────────┐  │
                                                                                │  │ mindustry-survival (Port 6567) │  │
                                                                                │  ├────────────────────────────────┤  │
                                                                                │  │ mindustry-tower    (Port 6568) │  │
                                                                                │  ├────────────────────────────────┤  │
                                                                                │  │ mindustry-attack   (Port 6569) │  │
                                                                                │  └────────────────────────────────┘  │
                                                                                └──────────────────────────────────────┘
```

---

## 2. Setting Up the Three Systemd Services on Ubuntu EC2

Each Mindustry server runs under an unprivileged user (`ubuntu`) with its own working directory and FIFO pipe for standard input:

### A. Directory Structure
```bash
sudo mkdir -p /home/ubuntu/mindustry/survival
sudo mkdir -p /home/ubuntu/mindustry/tower
sudo mkdir -p /home/ubuntu/mindustry/attack
sudo mkdir -p /run/mindustry
sudo chown -R ubuntu:ubuntu /home/ubuntu/mindustry /run/mindustry
```

### B. Create Service Files

#### 1. Survival (`/etc/systemd/system/mindustry-survival.service`):
```ini
[Unit]
Description=Continental Mindustry Survival Server
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/mindustry/survival
ExecStartPre=/bin/sh -c 'mkfifo /run/mindustry/survival.fifo 2>/dev/null || true'
ExecStart=/usr/bin/java -jar /home/ubuntu/mindustry/server-release.jar
Restart=on-failure
RestartSec=10
StandardInput=fifo:/run/mindustry/survival.fifo
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

#### 2. Tower Defence (`/etc/systemd/system/mindustry-tower.service`):
```ini
[Unit]
Description=Continental Mindustry Tower Defence Server
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/mindustry/tower
ExecStartPre=/bin/sh -c 'mkfifo /run/mindustry/tower.fifo 2>/dev/null || true'
ExecStart=/usr/bin/java -jar /home/ubuntu/mindustry/server-release.jar host Fortress tower
Restart=on-failure
RestartSec=10
StandardInput=fifo:/run/mindustry/tower.fifo
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

#### 3. Attack (`/etc/systemd/system/mindustry-attack.service`):
```ini
[Unit]
Description=Continental Mindustry Attack Server
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/mindustry/attack
ExecStartPre=/bin/sh -c 'mkfifo /run/mindustry/attack.fifo 2>/dev/null || true'
ExecStart=/usr/bin/java -jar /home/ubuntu/mindustry/server-release.jar host Frontline attack
Restart=on-failure
RestartSec=10
StandardInput=fifo:/run/mindustry/attack.fifo
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

### C. Enable Services
```bash
sudo systemctl daemon-reload
sudo systemctl enable mindustry-survival mindustry-tower mindustry-attack
```

---

## 3. Security Architecture & Audit Report

### A. Authentication & Password Security
- Passwords are encrypted using **scrypt** with a cryptographically secure 16-byte random salt: `salt:hash`.
- Verification uses `crypto.timingSafeEqual` with strict length guards to eliminate timing side-channel attacks.
- Plaintext passwords or default hashes are **never** committed to source code or templates.
- Utility: `node backend/hash-password.mjs "<password>"` outputs the `salt:hash` to set in environment variables.

### B. Session Management & Server-Side Invalidation
- Sessions are issued as HMAC-SHA256 signed tokens containing a unique `jti` (JWT ID), creation timestamp, and expiration.
- Upon logout, the `jti` is registered in a server-side revocation store so that the token is immediately invalidated even if the client retains the cookie.
- Cookies are flagged: `HttpOnly; Secure; SameSite=None; Path=/; Max-Age=28800`.

### C. CSRF Protection
- Cryptographically secure 32-byte CSRF token generated via `crypto.randomBytes(32)`.
- Validated on every state-changing HTTP request (`POST`, `PUT`, `DELETE`).
- Timing-safe constant-time string comparison.

### D. Rate Limiting
- In-memory sliding window rate limiter: maximum 5 failed attempts per 15-minute window per IP.
- Pruned automatically to prevent memory exhaustion attacks.
- Returns `HTTP 429` with `Retry-After` header when triggered.

### E. Shell Injection Prevention
- The `server` parameter is strictly validated against `["survival", "tower", "attack", "ec2"]`. Any other input is rejected immediately with HTTP 400.
- Mindustry console commands are restricted to an allowlist: `status`, `players`, `maps`, `save`, `nextmap`, `gameover`, `say`, `bans`, `version`, `gc`, `help`, `pause`, `resume`, `waves`, `reloadmaps`, `host`, `mods`, `rules`.
- All arguments are sanitized to remove shell metacharacters: `;`, `&`, `|`, `` ` ``, `$`, `>`, `<`, `\`, `!`, `"`, `'`, newlines.

---

## 4. EC2 Safety & Command Isolation

1. **When EC2 is Stopped**:
   - `GET /api/mindustry/status` reports `ec2State: "stopped"` and all three servers as `Offline`. No UDP pings or SSM calls are initiated.
   - Any service-level control command returns `HTTP 400` with:
     `"Cannot control service while EC2 is stopped. Start EC2 host first."`
   - Power On (`POST /api/mindustry/control/start` with `server: "ec2"`) calls `ec2:StartInstances`.

2. **Command Isolation**:
   - Every service control, config update, log request, or console command specifies the target server: `survival`, `tower`, or `attack`.
   - The backend targets exclusively `/run/mindustry/${targetId}.fifo` and `systemctl [action] mindustry-${targetId}.service`.
   - Managing or restarting one server never interrupts or affects the other two.
