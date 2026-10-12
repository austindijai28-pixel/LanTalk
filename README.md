# LAN Voice Call

React + Node.js app for discovering devices that have opened this app on the same LAN and making browser-to-browser voice calls.

## Requirements
- Node.js 20+ on the host computer
- Two or more computers on the same Wi-Fi/LAN
- Chrome or Edge recommended
- Microphone permission

## Install
Extract this folder. In the project root, run:

```bash
npm install
npm run install:all
npm run dev
```

This starts the frontend on port 5173 and the signaling backend on port 3001.

## Connect devices
1. Run the project on ONE computer on the LAN.
2. On that host, run `ipconfig` and find its IPv4 address, for example `192.168.1.10`.
3. On the host computer, open `http://localhost:5173`.
4. On the second computer, open `http://192.168.1.10:5173` (replace with the host IP).
5. If the frontend is opened from another computer, the frontend uses the same hostname for the backend by default, so it connects to `http://192.168.1.10:3001`.
6. Allow Node.js through Windows Firewall on Private networks. Permit TCP ports 5173 and 3001.
7. Enter a device name, select the other connected device, and click Call.

For remote devices to access the microphone, browsers generally require a secure context (HTTPS) except for localhost. Some browsers may allow local-network HTTP origins, but this is not guaranteed. If microphone permission is blocked when opening `http://192.168...`, use HTTPS on your LAN or run the frontend locally on each device and configure `VITE_SIGNALING_URL` to the host's backend address.

## Discovery behavior
The backend lists browser sessions currently connected to this app and reports the client IP observed by the server. It does NOT scan or list every device on the LAN; browsers and operating systems restrict broad network scanning. Each device must open the app.

## Ports and security
- TCP 5173: Vite development frontend
- TCP 3001: Node.js signaling server
- WebRTC media is sent peer-to-peer and encrypted by the browser.
- This is a LAN prototype. Signaling has no authentication; use only on a trusted network and do not expose the ports to the public internet.
