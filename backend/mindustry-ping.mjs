import dgram from "node:dgram";

/**
 * Pings a Mindustry server via UDP.
 * Query packet sent: [0xFE, 0x01] (-2, 1)
 *
 * Arc / Mindustry binary response format:
 * 1. Host / Server name: String (1-byte length prefix + UTF-8)
 * 2. Map name: String
 * 3. Player count: Int32BE (4 bytes)
 * 4. Wave number: Int32BE (4 bytes)
 * 5. Game build version: Int32BE (4 bytes)
 * 6. Version type: String (e.g. "official", "custom")
 * 7. Gamemode: UInt8 (1 byte: 0=survival, 1=sandbox, 2=attack, 3=pvp, 4=editor)
 * 8. Player limit: Int32BE (4 bytes)
 * 9. Description: String
 * 10. Mode name: String (optional trailing string)
 */
export function pingMindustryServer(host, port = 6567, timeoutMs = 2000, fallbackName = "Continental Mindustry") {
  return new Promise((resolve) => {
    if (!host) {
      return resolve({ online: false, error: "No host provided" });
    }

    const socket = dgram.createSocket("udp4");
    let timer = null;
    let resolved = false;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      try {
        socket.close();
      } catch (_) {}
    };

    const safeResolve = (data) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(data);
    };

    timer = setTimeout(() => {
      safeResolve({ online: false, reason: "TIMEOUT" });
    }, timeoutMs);

    socket.on("error", (err) => {
      safeResolve({ online: false, reason: err.message });
    });

    socket.on("message", (msg) => {
      try {
        let offset = 0;

        function readString() {
          if (offset >= msg.length) return "";
          const len = msg.readUInt8(offset);
          offset += 1;
          if (offset + len > msg.length) return "";
          const str = msg.toString("utf8", offset, offset + len);
          offset += len;
          return str;
        }

        function readInt32() {
          if (offset + 4 > msg.length) return 0;
          const val = msg.readInt32BE(offset);
          offset += 4;
          return val;
        }

        const serverName = readString() || fallbackName;
        const map = readString() || "Glacier";
        const playersOnline = readInt32();
        const wave = readInt32();
        const version = readInt32() || 146;
        const verType = readString() || "official";

        // Gamemode is a 1-byte unsigned integer preceding playerLimit
        const gamemode = offset < msg.length ? msg.readUInt8(offset++) : 0;
        const maxPlayers = readInt32() || 24;
        const description = readString() || "";
        const modeName = offset < msg.length ? readString() : "";

        safeResolve({
          online: true,
          serverName,
          map,
          players: playersOnline,
          playersOnline,
          maxPlayers,
          wave,
          version,
          verType,
          gamemode,
          description,
          modeName
        });
      } catch (e) {
        // Fallback with defaults if parsing failed on valid UDP reply
        safeResolve({
          online: true,
          serverName: fallbackName,
          map: "Glacier",
          players: 0,
          playersOnline: 0,
          maxPlayers: 24,
          wave: 1,
          gamemode: 0
        });
      }
    });

    try {
      // Mindustry UDP ping payload: [0xFE, 0x01]
      const pingPacket = Buffer.from([0xfe, 0x01]);
      socket.send(pingPacket, port, host, (err) => {
        if (err) {
          safeResolve({ online: false, reason: err.message });
        }
      });
    } catch (err) {
      safeResolve({ online: false, reason: err.message });
    }
  });
}
