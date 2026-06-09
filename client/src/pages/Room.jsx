import { useEffect, useState, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import io from 'socket.io-client';
import { generateChunkHash, encryptData, decryptData } from '../utils/crypto';

// Dynamically target local development socket or production Render socket
const SOCKET_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:5000'
  : 'https://peer-to-peer-share.onrender.com';

const socket = io(SOCKET_URL);

export default function Room() {
  const { roomId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [status, setStatus] = useState('Awaiting connection details...');
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(null);
  const [showQR, setShowQR] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [copied, setCopied] = useState(false);
  
  const secretKey = window.location.hash.substring(1);

  const isSender = !!location.state?.file;
  const file = location.state?.file;

  const peerConnectionRef = useRef(null);
  const dataChannelRef = useRef(null);
  const receivedBuffersRef = useRef([]);
  const receivedSizeRef = useRef(0);
  const fileMetaRef = useRef(null);
  const startTimeRef = useRef(null);
  const transferFailedRef = useRef(false);

  // Audio Synthesizer: Play futuristic success chime
  const playSuccessChime = () => {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const now = ctx.currentTime;
      
      const playNote = (freq, start, duration) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, start);
        
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.12, start + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + duration);
      };
      
      playNote(523.25, now, 0.4);        // C5
      playNote(659.25, now + 0.08, 0.4);  // E5
      playNote(783.99, now + 0.16, 0.4);  // G5
      playNote(1046.50, now + 0.24, 0.6); // C6
    } catch (e) {
      console.warn("Audio Context blocked or unsupported:", e);
    }
  };

  // Audio Synthesizer: Play warning beep
  const playErrorBeep = () => {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(150, now);
      
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.15, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.4);
    } catch (e) {
      console.warn("Audio Context error:", e);
    }
  };

  // Local storage logging utility
  const saveToHistory = (fileName, fileSize, roomLink, role) => {
    const currentHistory = JSON.parse(localStorage.getItem('nebula_transfer_history') || '[]');
    if (currentHistory.some(h => h.link === roomLink)) return;
    const newRecord = {
      id: Math.random().toString(36).substring(2, 9),
      name: fileName,
      size: fileSize,
      link: roomLink,
      role: role,
      timestamp: Date.now()
    };
    const updated = [newRecord, ...currentHistory].slice(0, 5);
    localStorage.setItem('nebula_transfer_history', JSON.stringify(updated));
  };

  // Clock elapsed transmission duration
  useEffect(() => {
    let interval;
    const activeStates = ['Encrypting', 'Receiving', 'Connected securely'];
    const isTransferActive = activeStates.some(s => status.includes(s));
    
    if (isTransferActive && progress < 100) {
      interval = setInterval(() => {
        setElapsedTime(prev => prev + 1);
      }, 1000);
    }
    
    return () => clearInterval(interval);
  }, [status, progress]);

  // Main WebRTC / signaling bridge setup
  useEffect(() => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    peerConnectionRef.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', { target: roomId, candidate: event.candidate });
      }
    };

    if (isSender) {
      socket.emit('create-room', roomId);
      setStatus('Waiting for receiver node to bind...');

      const dc = pc.createDataChannel('fileTransfer');
      dataChannelRef.current = dc;
      setupDataChannel(dc);

      socket.on('receiver-joined', async () => {
        setStatus('Receiver joined! Exchanging session descriptors...');
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('offer', { target: roomId, offer });
      });

      socket.on('answer', async (payload) => {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.answer));
      });
    } else {
      socket.emit('join-room', roomId);

      pc.ondatachannel = (event) => {
        dataChannelRef.current = event.channel;
        setupDataChannel(event.channel);
      };

      socket.on('offer', async (payload) => {
        setStatus('Offer descriptor received. Bypassing signaling...');
        await pc.setRemoteDescription(new RTCSessionDescription(payload.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('answer', { target: roomId, answer });
      });
    }

    socket.on('ice-candidate', async (payload) => {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
      } catch (e) {
        console.error("ICE candidate binding failure:", e);
      }
    });

    socket.on('peer-disconnected', () => {
      setStatus('Node link lost. Transmission aborted.');
      playErrorBeep();
      setSpeed(null);
    });

    return () => {
      pc.close();
      socket.off();
    };
  }, [roomId, isSender]);

  const setupDataChannel = (dc) => {
    dc.binaryType = 'arraybuffer';
    
    dc.onopen = () => {
      setStatus('Connected securely! Encrypting data tunnel...');
      if (isSender) startSendingFile(dc);
    };

    dc.onmessage = async (e) => {
      if (typeof e.data === 'string') {
        const msg = JSON.parse(e.data);
        if (msg.type === 'metadata') {
          fileMetaRef.current = msg;
          setStatus(`Receiving (Encrypted): ${msg.name}`);
          startTimeRef.current = Date.now(); 
        } else if (msg.type === 'eof') {
          if (!transferFailedRef.current) finalizeDownload();
        }
      } else {
        try {
          const decryptedChunk = await decryptData(e.data, secretKey);
          receivedBuffersRef.current.push(decryptedChunk);
          receivedSizeRef.current += decryptedChunk.byteLength;
          
          const percent = Math.round((receivedSizeRef.current / fileMetaRef.current.size) * 100);
          setProgress(percent);

          const elapsedSeconds = Math.max((Date.now() - startTimeRef.current) / 1000, 0.001);
          const currentSpeedMBps = (receivedSizeRef.current / (1024 * 1024)) / elapsedSeconds;
          setSpeed(currentSpeedMBps.toFixed(2));
        } catch (err) {
          transferFailedRef.current = true;
          setStatus('Decryption Error! Security hash mismatch.');
          playErrorBeep();
          console.error(err);
        }
      }
    };
  };

  const startSendingFile = async (dc) => {
    setStatus('Encrypting local buffers...');
    const arrayBuffer = await file.arrayBuffer();
    const fileHash = await generateChunkHash(arrayBuffer);

    dc.send(JSON.stringify({ 
      type: 'metadata', 
      name: file.name, 
      size: file.size, 
      hash: fileHash 
    }));

    // Keep encrypted WebRTC messages comfortably below common browser limits.
    const chunkSize = 16 * 1024;
    let offset = 0;
    dc.bufferedAmountLowThreshold = 512 * 1024;
    startTimeRef.current = Date.now(); 

    const sendChunk = async () => {
      while (offset < file.size) {
        if (dc.bufferedAmount > dc.bufferedAmountLowThreshold) {
          dc.onbufferedamountlow = () => {
            dc.onbufferedamountlow = null;
            sendChunk();
          };
          return;
        }
        
        const chunk = arrayBuffer.slice(offset, offset + chunkSize);
        const encryptedChunk = await encryptData(chunk, secretKey);
        
        dc.send(encryptedChunk);
        offset += chunk.byteLength;
        
        setProgress(Math.round((offset / file.size) * 100));

        const elapsedSeconds = Math.max((Date.now() - startTimeRef.current) / 1000, 0.001);
        const currentSpeedMBps = (offset / (1024 * 1024)) / elapsedSeconds;
        setSpeed(currentSpeedMBps.toFixed(2));
      }
      
      dc.send(JSON.stringify({ type: 'eof' }));
      playSuccessChime();
      setStatus('Transfer Complete! Safe & Verified.');
    };

    sendChunk();
  };

  const finalizeDownload = async () => {
    setStatus('Verifying cryptographic SHA-256 integrity...');
    if (receivedSizeRef.current !== fileMetaRef.current.size) {
      playErrorBeep();
      setStatus(`Error: Incomplete transfer (${receivedSizeRef.current}/${fileMetaRef.current.size} bytes).`);
      return;
    }

    const blob = new Blob(receivedBuffersRef.current);
    const arrayBuffer = await blob.arrayBuffer();
    const finalHash = await generateChunkHash(arrayBuffer);
    
    if (finalHash === fileMetaRef.current.hash) {
      playSuccessChime();
      setStatus('Verified intact! Triggering local buffer save...');
      
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileMetaRef.current.name;
      a.click();
      URL.revokeObjectURL(url);
      
      // Save details to Local Storage Logs
      saveToHistory(
        fileMetaRef.current.name, 
        fileMetaRef.current.size, 
        window.location.pathname + window.location.hash, 
        'receiver'
      );

      setStatus('Transmission success! Verified & Saved.');
    } else {
      playErrorBeep();
      setStatus('Error: Cryptographic checksum mismatch! Data corrupt.');
    }
  };

  const getFileIcon = (fileName) => {
    if (!fileName) return null;
    const ext = fileName.split('.').pop().toLowerCase();
    
    if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp'].includes(ext)) {
      return (
        <svg className="w-12 h-12 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      );
    }
    if (['js', 'jsx', 'ts', 'tsx', 'html', 'css', 'py', 'java', 'cpp', 'c', 'h', 'cs', 'go', 'rs', 'php', 'json', 'sh', 'bat'].includes(ext)) {
      return (
        <svg className="w-12 h-12 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
        </svg>
      );
    }
    if (['mp4', 'mkv', 'avi', 'mov', 'webm', 'wmv'].includes(ext)) {
      return (
        <svg className="w-12 h-12 text-pink-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      );
    }
    if (['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(ext)) {
      return (
        <svg className="w-12 h-12 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
        </svg>
      );
    }
    if (['zip', 'rar', 'tar', 'gz', '7z', 'bz2', 'xz'].includes(ext)) {
      return (
        <svg className="w-12 h-12 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
        </svg>
      );
    }
    if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'md'].includes(ext)) {
      return (
        <svg className="w-12 h-12 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
      );
    }
    return (
      <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
    );
  };

  const getETA = () => {
    if (!speed || isNaN(parseFloat(speed)) || parseFloat(speed) <= 0) return 'Calculating...';
    const total = isSender ? (file ? file.size : 0) : (fileMetaRef.current ? fileMetaRef.current.size : 0);
    const completedBytes = isSender ? (progress / 100) * total : receivedSizeRef.current;
    const remainingBytes = total - completedBytes;
    
    if (remainingBytes <= 0) return '0s';
    
    const remainingSeconds = remainingBytes / (parseFloat(speed) * 1024 * 1024);
    if (remainingSeconds < 60) {
      return `${Math.ceil(remainingSeconds)}s`;
    }
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = Math.ceil(remainingSeconds % 60);
    return `${minutes}m ${seconds}s`;
  };

  const formatElapsed = (sec) => {
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${s}s`;
  };

  const formatSize = (bytes) => {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    return `${(kb / 1024).toFixed(2)} MB`;
  };

  const getWizardSteps = () => {
    const isConnected = socket.connected;
    
    const step1 = {
      label: "Orbital Signaling Link",
      status: isConnected ? "complete" : "active"
    };
    
    let step2Status = "pending";
    if (status.includes("Waiting for receiver")) {
      step2Status = "active";
    } else if (status.includes("Receiver joined") || status.includes("Connected") || status.includes("Encrypting") || status.includes("Receiving") || progress > 0) {
      step2Status = "complete";
    }
    const step2 = {
      label: isSender ? "Awaiting Receiver Node" : "Connecting to Sender Node",
      status: step2Status
    };
    
    let step3Status = "pending";
    if (status.includes("descriptor") || status.includes("session")) {
      step3Status = "active";
    } else if (status.includes("Connected") || status.includes("Encrypting") || status.includes("Receiving") || progress > 0) {
      step3Status = "complete";
    }
    const step3 = {
      label: "WebRTC Peer Bridge Handshake",
      status: step3Status
    };

    let step4Status = "pending";
    if (status.includes("Connected securely")) {
      step4Status = "active";
    } else if (status.includes("Encrypting") || status.includes("Receiving") || progress > 0) {
      step4Status = "complete";
    }
    const step4 = {
      label: "Zero-Knowledge Encryption Tunnel",
      status: step4Status
    };

    let step5Status = "pending";
    if (status.includes("Encrypting") || status.includes("Receiving")) {
      step5Status = "active";
    } else if (status.includes("Complete") || status.includes("Verifying") || status.includes("Verified") || status.includes("Success")) {
      step5Status = "complete";
    }
    const step5 = {
      label: isSender ? "Data Stream Encrypted Upload" : "Data Stream Decrypted Download",
      status: step5Status
    };

    let step6Status = "pending";
    if (status.includes("Verifying")) {
      step6Status = "active";
    } else if (status.includes("Success") || status.includes("Verified")) {
      step6Status = "complete";
    } else if (status.includes("checksum mismatch") || status.includes("Integrity compiling mismatched")) {
      step6Status = "failed";
    }
    const step6 = {
      label: "SHA-256 Checksum Verification",
      status: step6Status
    };

    return [step1, step2, step3, step4, step5, step6];
  };

  const shareableLink = `${window.location.origin}/room/${roomId}${window.location.hash}`;

  const currentFileName = isSender ? (file ? file.name : '') : (fileMetaRef.current ? fileMetaRef.current.name : '');
  const currentFileSize = isSender ? (file ? file.size : 0) : (fileMetaRef.current ? fileMetaRef.current.size : 0);

  const steps = getWizardSteps();

  // Pulse Connection Signal Wave Colors
  const getSignalColor = () => {
    if (status.includes("aborted") || status.includes("failed") || status.includes("Error")) return "bg-red-500 shadow-red-500/20";
    if (status.includes("Complete") || status.includes("success") || status.includes("Verified")) return "bg-emerald-500 shadow-emerald-500/20";
    if (status.includes("Encrypting") || status.includes("Receiving") || status.includes("Connected")) return "bg-cyan-400 shadow-cyan-400/20 animate-pulse";
    return "bg-amber-400 shadow-amber-400/20 animate-pulse";
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6 relative">
      {/* Space-themed decorative lights */}
      <div className="absolute top-10 left-10 w-80 h-80 bg-purple-900/10 rounded-full filter blur-3xl pointer-events-none"></div>
      <div className="absolute bottom-10 right-10 w-80 h-80 bg-cyan-900/10 rounded-full filter blur-3xl pointer-events-none"></div>

      <div className="max-w-2xl w-full z-10 space-y-6">
        
        {/* Navigation back option */}
        <button 
          onClick={() => navigate('/')}
          className="text-gray-500 hover:text-cyan-400 text-xs font-mono tracking-widest uppercase flex items-center gap-2 transition-colors cursor-pointer"
        >
          ← [Abort Mission / Return to Base]
        </button>

        <div className="glass-panel p-6 md:p-8 rounded-3xl border border-gray-800 shadow-2xl space-y-6">
          
          {/* Dashboard Header */}
          <div className="flex flex-col md:flex-row items-center md:items-start justify-between border-b border-gray-800 pb-5 gap-4">
            <div className="text-center md:text-left">
              <h2 className="text-2xl font-bold tracking-tight text-white orbitron">
                SECURE TELEMETRY ROOM
              </h2>
              <div className="text-[10px] text-cyan-400 font-mono tracking-widest mt-1 uppercase flex items-center justify-center md:justify-start gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                ZERO-KNOWLEDGE TUNNELING ACTIVE
              </div>
            </div>
            <div className={`px-4 py-1.5 rounded-full text-xs font-mono font-bold tracking-widest border border-white/5 ${getSignalColor()} bg-opacity-10 text-white flex items-center gap-2`}>
              <span className={`w-2 h-2 rounded-full ${getSignalColor()}`}></span>
              STATUS: {status.includes("Waiting") ? "AWAITING PEER" : status.includes("Encrypting") || status.includes("Receiving") ? "TRANSCEIVING" : "STANDBY"}
            </div>
          </div>

          {/* Secure Link Copier & QR Code for Sender */}
          {isSender && (
            <div className="p-5 bg-black/30 rounded-2xl border border-gray-800/80">
              <p className="text-[11px] text-gray-400 mb-3 font-mono tracking-wide">
                Secure decryption hash generated in URL hash portion. The signaling server NEVER sees this key. Share link privately:
              </p>
              <div className="flex items-center gap-2 mb-4">
                <input 
                  type="text" 
                  readOnly 
                  value={shareableLink} 
                  className="w-full bg-black/60 text-cyan-400 p-2.5 rounded-lg text-xs outline-none font-mono text-ellipsis overflow-hidden border border-gray-800 focus:border-cyan-500/30"
                />
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(shareableLink);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="bg-neon-gradient hover:bg-neon-gradient-hover text-white px-5 py-2.5 rounded-lg text-xs font-bold font-mono tracking-wider transition-all shrink-0 cursor-pointer"
                >
                  {copied ? "COPIED" : "COPY"}
                </button>
              </div>
              
              <div className="text-center">
                <button 
                  onClick={() => setShowQR(!showQR)}
                  className="text-[10px] text-neon-purple font-mono uppercase hover:text-neon-cyan transition-colors cursor-pointer"
                >
                  {showQR ? "[- Close QR HUD]" : "[+ Display Scanner QR Code]"}
                </button>
                
                {showQR && (
                  <div className="mt-4 flex flex-col items-center justify-center p-4 bg-white/5 border border-white/10 rounded-2xl animate-[float_4s_infinite_ease-in-out]">
                    <img 
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(shareableLink)}`} 
                      alt="P2P Receiver QR Code" 
                      className="w-36 h-36 border-4 border-cyan-950/80 rounded-lg shadow-lg shadow-cyan-500/10"
                    />
                    <span className="text-[9px] text-gray-500 font-mono mt-2.5 tracking-wider uppercase">Scan to initialize mobile download</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Current File Telemetry */}
          {currentFileName && (
            <div className="glass-card p-5 rounded-2xl flex items-center gap-4">
              <div className="p-3 bg-black/40 rounded-xl border border-gray-800 shrink-0">
                {getFileIcon(currentFileName)}
              </div>
              <div className="min-w-0 flex-1 text-left">
                <div className="text-gray-400 text-[10px] font-mono tracking-widest">ACTIVE PAYLOAD</div>
                <div className="text-gray-100 font-medium text-sm truncate">{currentFileName}</div>
                <div className="text-gray-500 text-xs font-mono mt-0.5">SIZE: {formatSize(currentFileSize)}</div>
              </div>
            </div>
          )}

          {/* Progress & Speed Metrics */}
          <div className="space-y-3 p-5 bg-black/20 rounded-2xl border border-gray-800/40">
            <div className="flex justify-between items-center text-xs font-mono">
              <span className="text-gray-400 uppercase tracking-widest font-bold">Bridge Telemetry</span>
              <span className="text-neon-cyan font-bold">{progress}% Complete</span>
            </div>

            {/* Glowing progress rail */}
            <div className="w-full bg-gray-900 rounded-full h-3.5 overflow-hidden border border-gray-800">
              <div 
                className="bg-neon-gradient h-3.5 transition-all duration-300 relative rounded-full"
                style={{ width: `${progress}%` }}
              >
                <div className="absolute right-0 top-0 bottom-0 w-2 bg-white/50 blur-[2px] animate-pulse"></div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center text-xs font-mono pt-2 border-t border-gray-800/40">
              <div className="flex flex-col items-center">
                <span className="text-gray-500 text-[9px] uppercase tracking-wider">Speed</span>
                <span className="text-gray-300 font-medium mt-0.5">{speed ? `${speed} MB/s` : '0.00 MB/s'}</span>
              </div>
              <div className="flex flex-col items-center border-x border-gray-800/60">
                <span className="text-gray-500 text-[9px] uppercase tracking-wider">ETA</span>
                <span className="text-gray-300 font-medium mt-0.5">{getETA()}</span>
              </div>
              <div className="flex flex-col items-center">
                <span className="text-gray-500 text-[9px] uppercase tracking-wider">Time</span>
                <span className="text-gray-300 font-medium mt-0.5">{formatElapsed(elapsedTime)}</span>
              </div>
            </div>
          </div>

          {/* Connection Step Checklist Wizard */}
          <div className="space-y-4 pt-4 border-t border-gray-800">
            <h3 className="text-xs font-mono font-bold tracking-widest text-neon-purple text-left uppercase">
              🛸 CONNECTION TELEMETRY WIZARD
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-left font-mono text-[11px]">
              {steps.map((step, idx) => (
                <div 
                  key={idx}
                  className={`flex items-center gap-3.5 p-2.5 rounded-lg border transition-all ${
                    step.status === 'complete' 
                      ? 'bg-emerald-950/10 border-emerald-900/20 text-emerald-400/90' 
                      : step.status === 'active'
                      ? 'bg-cyan-950/20 border-cyan-800/30 text-cyan-200 animate-pulse'
                      : step.status === 'failed'
                      ? 'bg-red-950/10 border-red-900/20 text-red-400'
                      : 'bg-black/10 border-gray-900 text-gray-500'
                  }`}
                >
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 flex items-center justify-center ${
                    step.status === 'complete'
                      ? 'bg-emerald-500 shadow-md shadow-emerald-500/20'
                      : step.status === 'active'
                      ? 'bg-cyan-400 animate-ping'
                      : step.status === 'failed'
                      ? 'bg-red-500'
                      : 'bg-gray-800'
                  }`}>
                    {step.status === 'complete' && (
                      <span className="text-[7px] text-black font-bold">✓</span>
                    )}
                  </span>
                  <span className="truncate">{step.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Status logs text */}
          <div className="pt-2">
            <div className="bg-black/60 border border-gray-800 p-3 rounded-xl font-mono text-[10px] text-gray-400 uppercase text-center tracking-wider">
              {status}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
