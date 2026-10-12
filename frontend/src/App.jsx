import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import {
  AudioLines, Phone, PhoneOff, Mic, MicOff, RefreshCw, Wifi,
  Monitor, Signal, ShieldCheck, CircleHelp
} from "lucide-react";

const SIGNALING_URL = window.location.origin;

const RTC_CONFIG = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

export default function App() {
  const [identity, setIdentity] = useState(null);
  const [peers, setPeers] = useState([]);
  const [selectedPeer, setSelectedPeer] = useState(null);
  const [status, setStatus] = useState("Discovering devices");
  const [callState, setCallState] = useState("idle");
  const [muted, setMuted] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [connectedSeconds, setConnectedSeconds] = useState(0);
  const socketRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const pendingCandidatesRef = useRef([]);
  const selectedPeerRef = useRef(null);
  const callStateRef = useRef("idle");

  useEffect(() => { selectedPeerRef.current = selectedPeer; }, [selectedPeer]);
  useEffect(() => { callStateRef.current = callState; }, [callState]);

  const sendSignal = useCallback((targetId, payload) => {
    socketRef.current?.emit("call-signal", { targetId, payload });
  }, []);

  const cleanupCall = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.ontrack = null;
      pcRef.current.onicecandidate = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    pendingCandidatesRef.current = [];
    setMuted(false);
    setCallState("idle");
    setConnectedSeconds(0);
  }, []);

  const createPeerConnection = useCallback((peerId) => {
    if (pcRef.current) return pcRef.current;
    const pc = new RTCPeerConnection(RTC_CONFIG);
    pcRef.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate) sendSignal(peerId, { type: "ice-candidate", candidate: event.candidate });
    };
    pc.ontrack = (event) => {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = event.streams[0];
        remoteAudioRef.current.play().catch(() => {
          setError("Remote audio is ready. Click the audio player area if your browser blocks autoplay.");
        });
      }
      setCallState("connected");
      setStatus("Voice connected");
      setError("");
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        setCallState("connected");
        setStatus("Voice connected");
      } else if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
        if (pc.connectionState === "failed") {
          setError("Connection failed. Check both devices are on the same LAN and firewall permits the app.");
          cleanupCall();
        }
      }
    };
    return pc;
  }, [cleanupCall, sendSignal]);

  const getMicrophone = useCallback(async () => {
    if (localStreamRef.current) return localStreamRef.current;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone access requires localhost or HTTPS. Open the app on the computer hosting the page, or use HTTPS.");
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false
    });
    localStreamRef.current = stream;
    return stream;
  }, []);

  useEffect(() => {
    const socket = io(SIGNALING_URL, { transports: ["websocket", "polling"] });
    socketRef.current = socket;
    socket.on("connect", () => setStatus("Connected to signaling server"));
    socket.on("connect_error", () => setStatus("Backend unavailable"));
    socket.on("identity", (data) => {
      setIdentity(data);
      setDisplayName((old) => old || data.name || "My device");
    });
    socket.on("peers", (list) => {
      const filtered = list.filter((peer) => peer.id !== socket.id);
      setPeers(filtered);
      const current = selectedPeerRef.current;
      if (current) {
        const latest = filtered.find((peer) => peer.id === current.id);
        if (latest) setSelectedPeer(latest);
      }
    });
    socket.on("call-signal", async ({ fromId, fromName, payload }) => {
      try {
        if (!payload || !fromId) return;
        if (payload.type === "offer") {
          if (callStateRef.current !== "idle") {
            sendSignal(fromId, { type: "busy" });
            return;
          }
          const peer = { id: fromId, name: fromName, host: "", ips: [] };
          setSelectedPeer(peer);
          setCallState("incoming");
          setStatus(`Incoming call from ${fromName}`);
          // Offer is saved until user accepts.
          window.__pendingOffer = { fromId, payload };
        } else if (payload.type === "answer" && pcRef.current) {
          await pcRef.current.setRemoteDescription(payload.answer);
          for (const candidate of pendingCandidatesRef.current) {
            await pcRef.current.addIceCandidate(candidate);
          }
          pendingCandidatesRef.current = [];
          setCallState("connecting");
        } else if (payload.type === "ice-candidate" && payload.candidate) {
          if (pcRef.current?.remoteDescription) {
            await pcRef.current.addIceCandidate(payload.candidate);
          } else {
            pendingCandidatesRef.current.push(payload.candidate);
          }
        } else if (payload.type === "hangup") {
          cleanupCall();
          setStatus("Call ended by the other device");
        } else if (payload.type === "busy") {
          cleanupCall();
          setError("The other device is already on a call.");
          setStatus("Call not connected");
        } else if (payload.type === "reject") {
          cleanupCall();
          setStatus("Call declined");
        }
      } catch (e) {
        setError(e.message || "Call signaling error");
      }
    });
    return () => {
      socket.disconnect();
      cleanupCall();
    };
  }, [cleanupCall, sendSignal]);

  useEffect(() => {
    if (callState !== "connected") return;
    const timer = setInterval(() => setConnectedSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [callState]);

  const startCall = async (peer) => {
    if (!peer) return;
    setError("");
    setSelectedPeer(peer);
    try {
      setCallState("calling");
      setStatus(`Calling ${peer.name}…`);
      const stream = await getMicrophone();
      const pc = createPeerConnection(peer.id);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendSignal(peer.id, { type: "offer", offer: pc.localDescription });
    } catch (e) {
      cleanupCall();
      setError(e.message || "Could not start call");
      setStatus("Call could not start");
    }
  };

  const acceptCall = async () => {
    const pending = window.__pendingOffer;
    if (!pending) return;
    try {
      setError("");
      const stream = await getMicrophone();
      const pc = createPeerConnection(pending.fromId);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      await pc.setRemoteDescription(pending.payload.offer);
      for (const candidate of pendingCandidatesRef.current) {
        await pc.addIceCandidate(candidate);
      }
      pendingCandidatesRef.current = [];
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignal(pending.fromId, { type: "answer", answer: pc.localDescription });
      window.__pendingOffer = null;
      setCallState("connecting");
      setStatus("Connecting voice…");
    } catch (e) {
      setError(e.message || "Could not accept call");
      cleanupCall();
    }
  };

  const rejectCall = () => {
    const pending = window.__pendingOffer;
    if (pending) sendSignal(pending.fromId, { type: "reject" });
    window.__pendingOffer = null;
    cleanupCall();
    setStatus("Call declined");
  };

  const hangup = () => {
    if (selectedPeerRef.current) sendSignal(selectedPeerRef.current.id, { type: "hangup" });
    window.__pendingOffer = null;
    cleanupCall();
    setStatus("Call ended");
  };

  const toggleMute = () => {
    const next = !muted;
    localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !next; });
    setMuted(next);
  };

  const refreshPeers = async () => {
    try {
      const response = await fetch(`${SIGNALING_URL}/api/status`);
      if (!response.ok) throw new Error("Could not refresh device list");
      const data = await response.json();
      setIdentity((old) => old || data);
      setPeers(data.peers || []);
      setStatus("Device list refreshed");
    } catch (e) {
      setError(e.message);
    }
  };

  const formatDuration = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark"><AudioLines size={22} /></div>
        <div className="brand-copy"><div className="brand-name">LAN<span>VOICE</span></div><div className="brand-caption">PRIVATE NETWORK CALLING</div></div>
        <div className="top-status"><span className="live-dot" /> {status}</div>
      </header>

      <section className="hero">
        <div className="eyebrow"><Wifi size={14} /> LOCAL NETWORK · PEER TO PEER</div>
        <h1>Talk to devices<br /><span>around you.</span></h1>
        <p>Discover app-enabled devices on your local network and start a real-time voice call.</p>
      </section>

      <section className="dashboard">
        <div className="left-column">
          <div className="panel my-device">
            <div className="panel-heading"><span>THIS DEVICE</span><span className="small-pill"><span className="live-dot" /> ONLINE</span></div>
            <div className="device-row">
              <div className="device-icon"><Monitor size={25} /></div>
              <div className="device-details">
                <input aria-label="Device display name" value={displayName} onChange={(e) => {
                  setDisplayName(e.target.value);
                  socketRef.current?.emit("register-name", e.target.value);
                }} maxLength={40} />
                <div className="device-ip">{identity?.ips?.map((x) => x.address).join(" · ") || "Finding local IP…"}</div>
              </div>
              <Signal className="signal-icon" size={19} />
            </div>
            <div className="panel-foot"><ShieldCheck size={15} /> Audio is sent directly between browsers using WebRTC.</div>
          </div>

          <div className="panel devices-panel">
            <div className="panel-heading">
              <span>AVAILABLE DEVICES</span>
              <button className="icon-button" onClick={refreshPeers} title="Refresh devices"><RefreshCw size={16} /></button>
            </div>
            <div className="device-count">{peers.length} <span>{peers.length === 1 ? "device" : "devices"} discovered</span></div>
            {peers.length === 0 ? (
              <div className="empty-state">
                <div className="radar"><span /><span /><Wifi size={23} /></div>
                <div className="empty-title">Listening for devices</div>
                <p>Open this app on another computer connected to the same Wi-Fi or LAN.</p>
              </div>
            ) : (
              <div className="peer-list">
                {peers.map((peer) => (
                  <button key={peer.id} className={`peer-card ${selectedPeer?.id === peer.id ? "selected" : ""}`} onClick={() => setSelectedPeer(peer)}>
                    <div className="peer-avatar"><Monitor size={20} /></div>
                    <div className="peer-info"><div className="peer-name">{peer.name}</div><div className="peer-ip">{(peer.ips || [peer.host]).join(" · ")}</div></div>
                    <span className="peer-online"><span className="live-dot" /> Online</span>
                  </button>
                ))}
              </div>
            )}
            <button className="refresh-link" onClick={refreshPeers}><RefreshCw size={14} /> Refresh device list</button>
          </div>
        </div>

        <div className="right-column">
          <div className={`call-panel ${callState !== "idle" ? "in-call" : ""}`}>
            <div className="call-panel-top"><span>VOICE CONSOLE</span><span className={`call-state-tag ${callState}`}>{callState === "connected" ? "CONNECTED" : callState === "incoming" ? "INCOMING" : callState === "idle" ? "READY" : callState.toUpperCase()}</span></div>
            <div className={`call-orb ${callState === "connected" ? "active" : ""} ${callState === "incoming" ? "ringing" : ""}`}>
              <div className="orb-ring ring-one" /><div className="orb-ring ring-two" /><div className="orb-core"><AudioLines size={39} /></div>
            </div>
            <div className="call-title">{callState === "connected" ? "You're connected" : callState === "incoming" ? "Incoming call" : callState === "calling" ? "Calling device…" : callState === "connecting" ? "Connecting audio…" : "Ready to connect"}</div>
            <div className="call-subtitle">{callState === "connected" ? `${selectedPeer?.name || "Device"} · ${formatDuration(connectedSeconds)}` : callState === "incoming" ? `${selectedPeer?.name || "A device"} is calling you` : selectedPeer ? `Selected: ${selectedPeer.name}` : "Select a device from the list to begin"}</div>

            {callState === "incoming" ? (
              <div className="call-actions">
                <button className="action-button accept" onClick={acceptCall}><Phone size={18} /> Accept</button>
                <button className="action-button end" onClick={rejectCall}><PhoneOff size={18} /> Decline</button>
              </div>
            ) : callState !== "idle" ? (
              <div className="call-actions">
                {callState === "connected" && <button className={`action-button ${muted ? "muted" : "secondary"}`} onClick={toggleMute}>{muted ? <MicOff size={18} /> : <Mic size={18} />}{muted ? "Unmute" : "Mute"}</button>}
                <button className="action-button end" onClick={hangup}><PhoneOff size={18} /> End call</button>
              </div>
            ) : (
              <button className="action-button call-primary" disabled={!selectedPeer || !peers.some((p) => p.id === selectedPeer.id)} onClick={() => startCall(selectedPeer)}><Phone size={18} /> Call selected device</button>
            )}
            <audio ref={remoteAudioRef} autoPlay />
            {error && <div className="error-message"><CircleHelp size={15} /> {error}</div>}
            <div className="call-security"><ShieldCheck size={15} /> WebRTC encrypted audio transport</div>
          </div>

          <div className="info-card"><div className="info-icon"><CircleHelp size={18} /></div><div><div className="info-title">Can't see another device?</div><p>Run the backend on both computers, allow Node.js through your private-network firewall, and ensure UDP port 41234 and TCP port 3001 are permitted.</p></div></div>
        </div>
      </section>
      <footer><span>LANVOICE / BROWSER-BASED VOICE</span><span>DISCOVERY IS LIMITED TO DEVICES RUNNING THIS APP</span></footer>
    </main>
  );
}
