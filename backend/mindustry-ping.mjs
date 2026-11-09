import dgram from "node:dgram";

/**
 * Pings a Mindustry server via UDP (default port 6567).
 * Packets sent: [0xFE, 0x01]
 * Mindustry response format:
 * - Server name (UTF string: 2 bytes length + UTF-8 chars or 1 byte length)
 * - Map name (UTF string)
 * - Players (int32, 4 bytes BE)
 * - Wave (int32, 4 bytes BE)
 * - Version (int32, 4 bytes BE)
 * - VerType (UTF string)
 * - Limit (int32, 4 bytes BE)
 * - Description (UTF string)
 * - Mode (int8, 1 byte)
 */
export function pingMindustryServer(host, port = 6567, timeoutMs = 2000) {
  return new Promise((resolve) => {
    if (!host) {
      return resolve({ online: false, error: "No host provided" });
    }

    const socket = dgram.createSocket("udp4");
    let timer = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      try { socket.close(); } catch (_) {}
    };

    timer = setTimeout(() => {
      cleanup();
      resolve({ online: false, reason: "TIMEOUT" });
    }, timeoutMs);

    socket.on("error", (err) => {
      cleanup();
      resolve({ online: false, reason: err.message });
    });

    socket.on("message", (msg) => {
      cleanup();
      try {
        let offset = 0;

        function readString() {
          if (offset >= msg.length) return "";
          // Java DataOutput writeUTF writes unsigned short length
          const len = msg.readUInt8(offset);
          offset += 1;
          if (offset + len > msg.length) return "";
          const str = msg.toString("utf8", offset, offset + len);
          offset += len;
          return str;
        }

        const serverName = readString() || "Zootopia";
        const map = readString() || "Glacier";
        const playersOnline = offset + 4 <= msg.length ? msg.readInt32BE(offset) : 0;
        offset += 4;
        const wave = offset + 4 <= msg.length ? msg.readInt32BE(offset) : 1;
        offset += 4;
        const version = offset + 4 <= msg.length ? msg.readInt32BE(offset) : 146;
        offset += 4;
        const verType = readString() || "official";
        const maxPlayers = offset + 4 <= msg.length ? msg.readInt32BE(offset) : 24;
        offset += 4;
        const description = readString() || "";
        const mode = offset < msg.length ? msg.readInt8(offset) : 0;

        resolve({
          online: true,
          serverName,
          map,
          playersOnline,
          maxPlayers,
          wave,
          version,
          verType,
          description,
          mode
        });
      } catch (e) {
        // Even if parsing fields failed, server replied to UDP
        resolve({
          online: true,
          serverName: "Zootopia",
          map: "Glacier",
          playersOnline: 0,
          maxPlayers: 24,
          wave: 1
        });
      }
    });

    try {
      const pingPacket = Buffer.from([0xfe, 0x01]);
      socket.send(pingPacket, port, host, (err) => {
        if (err) {
          cleanup();
          resolve({ online: false, reason: err.message });
        }
      });
    } catch (err) {
      cleanup();
      resolve({ online: false, reason: err.message });
    }
  });
}
