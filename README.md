# Peer to Peer Share — Nebula

> **Zero-Knowledge, End-to-End Encrypted P2P File Transfer Portal**
> Direct browser-to-browser file transmission — the server never touches your data.

---

## Features

| Feature | Description |
|---|---|
| **Zero-Knowledge Encryption** | Files are encrypted with **AES-GCM 256-bit** inside the browser before any data leaves. The decryption key lives only in the URL hash — the server is completely blind. |
| **Orbital Portal UI** | Cosmic glassmorphism design with animated orbital ring dropzone and neon gradients. |
| **6-Step WebRTC Wizard** | Real-time connection checklist walks through every phase: Signaling → Handshake → Encryption Tunnel → Transfer → Verification. |
| **Live Telemetry Dashboard** | Real-time transfer speed, estimated time remaining, and elapsed time counters. |
| **Dynamic File Type Icons** | Auto-detects file type (image, video, audio, code, archive, document) and renders the correct glowing SVG icon. |
| **QR Code Sharing** | Sender can reveal a scannable QR code so mobile receivers can join instantly. |
| **Completion Chime** | Synthesized harmonic audio chime (C5 → E5 → G5 → C6) plays via the **Web Audio API** when a transfer succeeds — zero external audio files. |
| **Transmission Logs** | `localStorage`-backed history panel on the home page shows the last 5 transfers. |
| **SHA-256 Integrity Check** | A cryptographic hash of the entire file is generated before sending and verified on receipt to guarantee zero data corruption. |
| **Smart Socket Routing** | Automatically targets `localhost:5000` during development and falls back to the production Render server when deployed. |

---

## Project Structure

```
peer-to-peer-share/
├── client/                     # React + Vite frontend
│   ├── public/
│   │   └── favicon.svg
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Home.jsx        # Landing page — orbital dropzone + history log
│   │   │   └── Room.jsx        # Transfer room — telemetry dashboard + wizard
│   │   ├── utils/
│   │   │   └── crypto.js       # AES-GCM encryption + SHA-256 integrity helpers
│   │   ├── App.jsx             # React Router setup (/ and /room/:roomId)
│   │   ├── main.jsx            # React DOM entry point
│   │   └── index.css           # Cosmic design system (variables, animations, glass)
│   ├── index.html              # App shell — loads Google Fonts
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   └── package.json
│
└── server/                     # Node.js signaling server
    ├── index.js                # Express + Socket.io WebRTC signaling bridge
    └── package.json
```

---

## Local Development

You need **two terminals** — one for the server, one for the client.

### Terminal 1 — Start the Signaling Server

```bash
cd server
npm install
node index.js
# → Signaling Server running on port 5000
```

### Terminal 2 — Start the Client

```bash
cd client
npm install
npm run dev
# → http://localhost:5173/
```

> The client automatically detects `localhost` and connects to `http://localhost:5000` for signaling. No extra config needed.

---

## How to Transfer a File

1. **Sender** opens the app, drops a file (≤ 50 MB) into the portal.
2. Click **"GENERATE QUANTUM LINK"** — a unique room URL with an embedded secret key is created.
3. **Share the link** (copy to clipboard or scan the QR code) with the receiver.
4. **Receiver** opens the link — WebRTC handshake completes automatically.
5. File is **encrypted**, streamed peer-to-peer, **verified**, and **auto-downloaded**.
6. A harmonic chime plays on both sides when complete. ✅

> The `#secretKey` portion of the URL is a hash fragment. It is **never sent to the server** by the browser — only the two peers share this key.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 19, Vite 8, Tailwind CSS v4 |
| **Routing** | React Router DOM v7 |
| **Styling** | Vanilla CSS custom properties + Tailwind utilities |
| **Fonts** | Google Fonts — Outfit, Space Grotesk |
| **Real-time Signaling** | Socket.io v4 (client + server) |
| **P2P Transport** | WebRTC Data Channels |
| **Encryption** | Web Crypto API — AES-GCM 256-bit |
| **Integrity** | Web Crypto API — SHA-256 |
| **Audio** | Web Audio API (synthesized, no external files) |
| **Backend** | Node.js, Express v5 |
| **Storage** | None — all state is in-memory or client-side |

---

## Deployment

### Server → Render
- Root directory: `server`
- Build command: `npm install`
- Start command: `node index.js`

### Client → Vercel
- Root directory: `client`
- Framework preset: **Vite**
- Before deploying, update the production socket URL in [`src/pages/Room.jsx`](./client/src/pages/Room.jsx):
  ```js
  // Line 7-9 in Room.jsx
  const SOCKET_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:5000'
    : 'https://YOUR-RENDER-APP.onrender.com';   // ← update this
  ```

---

## Security Model

```
Sender Browser                 Signaling Server              Receiver Browser
──────────────                 ────────────────              ────────────────
Generate secretKey  ────────────────────────────────────────►  (URL hash only)
Encrypt file        (server never sees key or file data)        Decrypt file
       │                                                              ▲
       └── WebRTC Data Channel (direct P2P, encrypted) ─────────────►┘
```

The signaling server only relays WebRTC offer/answer/ICE messages to bootstrap the peer connection. Once connected, all data flows **directly** between browsers.

---

## License

MIT
