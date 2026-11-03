import React, { useState, useRef, useEffect } from 'react';
import { 
  Sparkles, Send, Bot, User, ShieldCheck, 
  BookOpen, ChevronRight, CheckCircle, 
  Database, Cpu, MessageSquare, Phone, MapPin,
  Mic, MicOff, Volume2, Square, PhoneCall, PhoneOff
} from './Icons';

// ==============================================================================
// CONSTANTES AUDIO & DÉTECTION DE SILENCE (VAD) POUR LE MODE APPEL
// ==============================================================================
const VAD_SILENCE_THRESHOLD = 0.006;     // Seuil RMS d'énergie pour distinguer parole et silence (sensible pour mobile)
const VAD_SILENCE_DURATION_MS = 1000;    // Durée de silence requise pour finaliser la prise de parole (1.0s)
const VAD_MIN_SPEECH_DURATION_MS = 300;  // Durée minimale de parole requise pour rejeter les bruits brefs (300ms)
const VAD_MAX_RECORDING_MS = 15000;      // Durée maximale d'un enregistrement continu (15s)
const VAD_POLL_INTERVAL_MS = 50;         // Période d'échantillonnage de l'AnalyserNode (50ms)

/**
 * Détecte les types MIME audio supportés par le navigateur pour MediaRecorder.
 */
function getSupportedMimeType() {
  if (typeof MediaRecorder === 'undefined') {
    return { mimeType: '', extension: 'wav' };
  }
  const candidates = [
    { mime: 'audio/webm;codecs=opus', ext: 'webm' },
    { mime: 'audio/webm', ext: 'webm' },
    { mime: 'audio/ogg;codecs=opus', ext: 'ogg' },
    { mime: 'audio/mp4', ext: 'mp4' },
    { mime: 'audio/wav', ext: 'wav' },
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c.mime)) {
      return { mimeType: c.mime, extension: c.ext };
    }
  }
  return { mimeType: '', extension: 'wav' };
}

export default function App() {
  const [activeTab, setActiveTab] = useState('demo'); // 'presentation', 'demo', or 'call'
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: "Bonjour et bienvenue sur **BANCOBU AI**, votre conseiller bancaire intelligent officiel.\n\nJe suis à votre disposition pour vous renseigner avec précision sur nos comptes, nos cartes bancaires, nos offres d'épargne ou encore nos crédits, certifiés conformes par la documentation officielle de la BANCOBU.\n\nVous pouvez me poser votre question par écrit ou **directement à la voix en cliquant sur le micro** !",
      sources: []
    }
  ]);
  const [inputQuestion, setInputQuestion] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [autoPlayAudio, setAutoPlayAudio] = useState(true);
  const [playingIndex, setPlayingIndex] = useState(null);

  // --- États Mode Appel en Direct ---
  // callStatus : 'idle' | 'connected'
  const [callStatus, setCallStatus] = useState('idle');
  // callAgentState : 'idle' | 'requesting_permission' | 'recording' | 'transcribing' | 'thinking' | 'speaking' | 'error'
  const [callAgentState, setCallAgentState] = useState('idle');
  const [callVoice, setCallVoice] = useState('siwis');
  const [callDuration, setCallDuration] = useState(0);
  const [callUserSpoken, setCallUserSpoken] = useState('');
  const [callAgentSpoken, setCallAgentSpoken] = useState('');
  const [callHistory, setCallHistory] = useState([]);
  const [callIsMuted, setCallIsMuted] = useState(false);
  const [callAudioLevel, setCallAudioLevel] = useState(0);

  // --- Références Mode Chat Classique ---
  const messagesEndRef = useRef(null);
  const classicRecorderRef = useRef(null);
  const classicStreamRef = useRef(null);
  const classicChunksRef = useRef([]);
  const chatAudioPlayerRef = useRef(null);
  const chatAudioUrlRef = useRef(null);

  // --- Références Mode Appel en Direct ---
  const callTimerRef = useRef(null);
  const callStatusRef = useRef('idle');
  const callAgentStateRef = useRef('idle');
  const callIsMutedRef = useRef(false);
  const callAudioRef = useRef(null);
  const callAudioPlayerRef = useRef(null);
  const callAudioUrlRef = useRef(null);
  const callPlaybackTimerRef = useRef(null);
  const callStreamRef = useRef(null);
  const callAudioCtxRef = useRef(null);
  const callMediaRecorderRef = useRef(null);
  const callChunksRef = useRef([]);
  const callVadIntervalRef = useRef(null);
  const finishCallRecordingRef = useRef(null);

  const triggerCallFinish = () => {
    if (finishCallRecordingRef.current) {
      finishCallRecordingRef.current();
    }
  };

  const suggestedQuestions = [
    "Conditions compte courant ?",
    "Service BANCOBU Diaspora ?",
    "Avantages compte KIRA MAMA ?",
    "Carte Visa prépayée ?"
  ];

  const updateCallAgentState = (newState) => {
    callAgentStateRef.current = newState;
    setCallAgentState(newState);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, isTranscribing]);

  // ==============================================================================
  // 1. GESTION DU MICROPHONE CLASSIQUE (MEDIARECORDER + WHISPER.CPP LOCAL)
  // ==============================================================================

  const stopClassicRecording = () => {
    setIsRecording(false);
    if (classicRecorderRef.current && classicRecorderRef.current.state !== 'inactive') {
      try {
        classicRecorderRef.current.stop();
      } catch (e) {
        console.warn("Erreur arrêt classicRecorder:", e);
      }
    }
  };

  const startClassicRecording = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Votre navigateur ne supporte pas la capture microphone ou le contexte n'est pas sécurisé (HTTPS).");
      return;
    }

    // Arrêter l'audio en cours de lecture pour éviter tout larsen
    if (chatAudioPlayerRef.current) {
      chatAudioPlayerRef.current.pause();
      setPlayingIndex(null);
    }

    classicChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      classicStreamRef.current = stream;

      const { mimeType, extension } = getSupportedMimeType();
      const options = mimeType ? { mimeType } : undefined;
      const recorder = new MediaRecorder(stream, options);

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          classicChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        // Libération propre des pistes matérielles APRES la fin de l'enregistrement
        if (classicStreamRef.current) {
          classicStreamRef.current.getTracks().forEach(track => track.stop());
          classicStreamRef.current = null;
        }

        if (classicChunksRef.current.length > 0) {
          const actualMime = recorder.mimeType || mimeType || 'audio/webm';
          const audioBlob = new Blob(classicChunksRef.current, { type: actualMime });
          if (audioBlob.size > 200) {
            await sendAudioForTranscription(audioBlob, extension);
          } else {
            alert("Enregistrement audio trop court ou vide. Veuillez parler plus près du micro.");
          }
        }
      };

      // Timeslice 200ms pour garantir la transmission continue des paquets audio
      recorder.start(200);
      classicRecorderRef.current = recorder;
      setIsRecording(true);
    } catch (err) {
      console.warn("Erreur getUserMedia classique :", err);
      setIsRecording(false);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        alert("Accès au microphone refusé. Cliquez sur l'icône de cadenas dans la barre d'adresse pour autoriser le microphone.");
      } else {
        alert("Impossible d'activer le microphone : " + (err.message || "Erreur périphérique"));
      }
    }
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopClassicRecording();
    } else {
      startClassicRecording();
    }
  };

  // Envoi du blob audio à /api/transcribe (Whisper.cpp Small local sur Jetson Orin Nano)
  const sendAudioForTranscription = async (blob, extension = 'webm') => {
    setIsTranscribing(true);
    try {
      const formData = new FormData();
      formData.append('file', blob, `audio_input.${extension}`);

      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.detail || `Erreur serveur ${response.status}`);
      }

      const data = await response.json();
      const transcribedText = data.transcript?.trim();

      if (transcribedText) {
        setInputQuestion(transcribedText);
        handleSend(transcribedText);
      } else {
        alert("Aucune parole audible détectée par Whisper.cpp. Veuillez parler plus près du microphone.");
      }
    } catch (err) {
      console.error("Erreur transcription Whisper:", err);
      alert(`Erreur de transcription vocale : ${err.message || "Impossible de contacter le serveur Jetson"}`);
    } finally {
      setIsTranscribing(false);
    }
  };

  // Synthèse vocale Piper TTS pour un message du chat
  const playTTS = async (text, msgIndex) => {
    try {
      if (playingIndex === msgIndex) {
        if (chatAudioPlayerRef.current) {
          chatAudioPlayerRef.current.pause();
          chatAudioPlayerRef.current.currentTime = 0;
        }
        setPlayingIndex(null);
        return;
      }

      setPlayingIndex(msgIndex);
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: 'siwis' })
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => null);
        throw new Error(errJson?.detail || "Erreur de génération audio Piper");
      }

      const blob = await response.blob();
      if (chatAudioUrlRef.current) {
        URL.revokeObjectURL(chatAudioUrlRef.current);
      }
      const audioUrl = URL.createObjectURL(blob);
      chatAudioUrlRef.current = audioUrl;

      if (chatAudioPlayerRef.current) {
        chatAudioPlayerRef.current.src = audioUrl;
        chatAudioPlayerRef.current.onended = () => {
          setPlayingIndex(null);
          if (chatAudioUrlRef.current) {
            URL.revokeObjectURL(chatAudioUrlRef.current);
            chatAudioUrlRef.current = null;
          }
        };
        await chatAudioPlayerRef.current.play();
      }
    } catch (err) {
      console.error("Erreur lecture audio :", err);
      setPlayingIndex(null);
    }
  };

  // Envoi d'une question écrite ou transcrite vers /api/ask
  const handleSend = async (questionText) => {
    if (isRecording) {
      stopClassicRecording();
      return;
    }

    const query = questionText || inputQuestion;
    if (!query.trim() || isLoading) return;

    const userMessage = { role: 'user', content: query };
    setMessages((prev) => [...prev, userMessage]);
    setInputQuestion('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: query })
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        const errorDetail = data?.detail || `Erreur HTTP ${response.status}`;
        throw new Error(errorDetail);
      }

      const newMsg = {
        role: 'assistant',
        content: data.answer,
        sources: data.sources || []
      };

      setMessages((prev) => {
        const updated = [...prev, newMsg];
        if (autoPlayAudio) {
          playTTS(data.answer, updated.length - 1);
        }
        return updated;
      });

    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `⚠️ Information : ${err.message || "Impossible de joindre le serveur bancaire."}`,
          sources: [],
          error: true
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  // ==============================================================================
  // 2. GESTION DU MODE APPEL EN DIRECT (VAD + PIPER + ANTI-LARSEN + BARGE-IN)
  // ==============================================================================

  const formatCallTime = (secs) => {
    const mins = Math.floor(secs / 60);
    const remSecs = secs % 60;
    return `${mins < 10 ? '0' : ''}${mins}:${remSecs < 10 ? '0' : ''}${remSecs}`;
  };

  // Nettoyage complet des flux audio de capture
  const stopCallCapture = () => {
    finishCallRecordingRef.current = null;
    if (callVadIntervalRef.current) {
      clearInterval(callVadIntervalRef.current);
      callVadIntervalRef.current = null;
    }
    setCallAudioLevel(0);
    if (callMediaRecorderRef.current && callMediaRecorderRef.current.state !== 'inactive') {
      try { callMediaRecorderRef.current.stop(); } catch (e) {}
      callMediaRecorderRef.current = null;
    }
    if (callAudioCtxRef.current) {
      try { callAudioCtxRef.current.close(); } catch (e) {}
      callAudioCtxRef.current = null;
    }
    if (callStreamRef.current) {
      try { callStreamRef.current.getTracks().forEach(t => t.stop()); } catch (e) {}
      callStreamRef.current = null;
    }
  };

  // Coupure temporaire du micro (Anti-larsen strict pendant que la conseillère parle)
  const pauseCallMicrophone = () => {
    finishCallRecordingRef.current = null;
    if (callVadIntervalRef.current) {
      clearInterval(callVadIntervalRef.current);
      callVadIntervalRef.current = null;
    }
    setCallAudioLevel(0);
    if (callMediaRecorderRef.current && callMediaRecorderRef.current.state !== 'inactive') {
      try { callMediaRecorderRef.current.stop(); } catch (e) {}
      callMediaRecorderRef.current = null;
    }
    if (callStreamRef.current) {
      callStreamRef.current.getAudioTracks().forEach(t => { t.enabled = false; });
    }
  };

  // Nettoyage de la lecture audio synthétique
  const stopCallPlayback = () => {
    if (callPlaybackTimerRef.current) {
      clearTimeout(callPlaybackTimerRef.current);
      callPlaybackTimerRef.current = null;
    }
    const audioEl = callAudioPlayerRef.current || callAudioRef.current;
    if (audioEl) {
      try {
        audioEl.pause();
        audioEl.currentTime = 0;
      } catch (e) {}
    }
    callAudioRef.current = null;
    if (callAudioUrlRef.current) {
      try { URL.revokeObjectURL(callAudioUrlRef.current); } catch (e) {}
      callAudioUrlRef.current = null;
    }
  };

  // Démarrer l'appel vocal
  const startCall = async () => {
    if (chatAudioPlayerRef.current) {
      chatAudioPlayerRef.current.pause();
      setPlayingIndex(null);
    }
    stopCallCapture();
    stopCallPlayback();

    // 1. Demande de permission microphone sur le clic/tap utilisateur (crucial sur mobile)
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Votre navigateur ne supporte pas la capture microphone ou le contexte n'est pas sécurisé (HTTPS).");
        return;
      }
      const initialStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      // Couper immédiatement les pistes pour respecter la règle anti-larsen pendant le message d'accueil
      initialStream.getAudioTracks().forEach(t => { t.enabled = false; });
      callStreamRef.current = initialStream;
    } catch (permErr) {
      console.warn("Permission microphone refusée lors de startCall :", permErr);
      alert("Accès au microphone requis pour l'appel. Veuillez autoriser le microphone dans votre navigateur.");
      return;
    }

    // 2. Initialiser et réveiller Web Audio Context dans ce geste utilisateur
    try {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (AudioCtxClass) {
        const audioCtx = new AudioCtxClass();
        if (audioCtx.state === 'suspended') {
          await audioCtx.resume();
        }
        callAudioCtxRef.current = audioCtx;
      }
    } catch (ctxErr) {
      console.warn("Erreur réveil AudioContext:", ctxErr);
    }

    setCallStatus('connected');
    callStatusRef.current = 'connected';
    updateCallAgentState('idle');
    setCallDuration(0);
    setCallUserSpoken('');
    setCallHistory([]);
    setCallIsMuted(false);
    callIsMutedRef.current = false;

    if (callTimerRef.current) clearInterval(callTimerRef.current);
    callTimerRef.current = setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);

    const welcomeMsg = "Bonjour et bienvenue au service client de la BANCOBU ! Je suis votre conseillère bancaire virtuelle. Comment puis-je vous renseigner aujourd'hui ?";
    await speakAgentCall(welcomeMsg);
  };

  // Clôture de l'appel vocal
  const endCall = () => {
    callStatusRef.current = 'idle';
    setCallStatus('idle');
    updateCallAgentState('idle');
    setCallUserSpoken('');
    setCallAgentSpoken('');
    setCallAudioLevel(0);

    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }
    stopCallCapture();
    stopCallPlayback();
  };

  // Couper / Rétablir le microphone pendant l'appel
  const toggleCallMute = () => {
    const nextMute = !callIsMuted;
    setCallIsMuted(nextMute);
    callIsMutedRef.current = nextMute;
    if (nextMute) {
      pauseCallMicrophone();
      if (callAgentStateRef.current === 'recording') {
        updateCallAgentState('idle');
      }
    } else {
      if (callStatusRef.current === 'connected' && callAgentStateRef.current !== 'speaking') {
        startCallListening();
      }
    }
  };

  // Interruption explicite (barge-in via bouton)
  const handleCallInterrupt = () => {
    stopCallPlayback();
    if (callStatusRef.current === 'connected' && !callIsMutedRef.current) {
      startCallListening();
    } else {
      updateCallAgentState('idle');
    }
  };

  // Synthèse vocale Piper et restitution audio
  const speakAgentCall = async (text) => {
    if (callStatusRef.current !== 'connected') return;

    // RÈGLE ANTI-LARSEN STRICTE : Le micro est 100% coupé avant d'émettre le moindre son
    pauseCallMicrophone();
    stopCallPlayback();

    updateCallAgentState('speaking');
    setCallAgentSpoken(text);
    setCallHistory((prev) => [...prev, { role: 'agent', text }]);

    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: callVoice })
      });

      if (!response.ok) {
        throw new Error(`Erreur TTS ${response.status}`);
      }

      const blob = await response.blob();
      if (callStatusRef.current !== 'connected') return;

      const audioUrl = URL.createObjectURL(blob);
      callAudioUrlRef.current = audioUrl;

      // Utiliser l'élément DOM <audio> (très robuste sur mobile) ou fallback sur Audio()
      const audioEl = callAudioPlayerRef.current || new Audio();
      callAudioRef.current = audioEl;
      audioEl.src = audioUrl;

      let playbackFinished = false;
      const onPlaybackDone = () => {
        if (playbackFinished) return;
        playbackFinished = true;
        if (callPlaybackTimerRef.current) {
          clearTimeout(callPlaybackTimerRef.current);
          callPlaybackTimerRef.current = null;
        }
        stopCallPlayback();
        if (callStatusRef.current === 'connected' && !callIsMutedRef.current) {
          startCallListening();
        } else if (callStatusRef.current === 'connected') {
          updateCallAgentState('idle');
        }
      };

      audioEl.onended = onPlaybackDone;
      audioEl.onerror = (e) => {
        console.warn("Erreur lecture audio Piper:", e);
        onPlaybackDone();
      };

      // Sécurité anti-blocage mobile : calculer la durée théorique exacte (WAV 16-bit 22050Hz mono = 44100 octets/seconde)
      const estimatedSecs = Math.max(1.5, (blob.size - 44) / 44100);
      const safetyTimeoutMs = Math.round((estimatedSecs + 0.6) * 1000);
      callPlaybackTimerRef.current = setTimeout(() => {
        console.log(`Sécurité durée audio atteinte (${safetyTimeoutMs}ms), transition automatique vers l'écoute.`);
        onPlaybackDone();
      }, safetyTimeoutMs);

      await audioEl.play().catch(playErr => {
        console.warn("Erreur play() audio (autoplay mobile):", playErr);
        onPlaybackDone();
      });

    } catch (e) {
      console.warn("Erreur synthèse ou lecture vocale conseiller:", e);
      stopCallPlayback();
      setTimeout(() => {
        if (callStatusRef.current === 'connected' && !callIsMutedRef.current) {
          startCallListening();
        }
      }, 1000);
    }
  };

  // Écoute vocale mains-libres avec VAD (Voice Activity Detection)
  const startCallListening = async () => {
    if (callStatusRef.current !== 'connected' || callIsMutedRef.current) return;
    if (callAgentStateRef.current === 'recording') return;

    pauseCallMicrophone();

    updateCallAgentState('requesting_permission');
    setCallUserSpoken('');

    try {
      let stream = callStreamRef.current;
      // Si le flux est absent, inactif ou terminé, en réobtenir un (la permission a déjà été accordée au clic initial !)
      if (!stream || !stream.active || stream.getAudioTracks().length === 0 || stream.getAudioTracks()[0].readyState === 'ended') {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
        callStreamRef.current = stream;
      }

      // Activer les pistes micro
      stream.getAudioTracks().forEach(t => { t.enabled = true; });

      if (callStatusRef.current !== 'connected' || callIsMutedRef.current) {
        stream.getAudioTracks().forEach(t => { t.enabled = false; });
        return;
      }

      updateCallAgentState('recording');

      // Configuration / Réveil Web Audio API
      let audioCtx = callAudioCtxRef.current;
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (!audioCtx || audioCtx.state === 'closed') {
        audioCtx = new AudioCtxClass();
        callAudioCtxRef.current = audioCtx;
      }
      if (audioCtx.state === 'suspended') {
        try { await audioCtx.resume(); } catch (e) {}
      }

      let sourceNode = null;
      let analyserNode = null;
      try {
        sourceNode = audioCtx.createMediaStreamSource(stream);
        analyserNode = audioCtx.createAnalyser();
        analyserNode.fftSize = 512;
        analyserNode.smoothingTimeConstant = 0.2;
        sourceNode.connect(analyserNode);
      } catch (errNode) {
        console.warn("Erreur source/analyser Node:", errNode);
      }

      // Configuration du MediaRecorder
      const { mimeType, extension } = getSupportedMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      callMediaRecorderRef.current = recorder;
      callChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          callChunksRef.current.push(event.data);
        }
      };

      let processingStarted = false;

      const finishAndProcessRecording = () => {
        if (processingStarted) return;
        processingStarted = true;
        finishCallRecordingRef.current = null;
        if (callVadIntervalRef.current) {
          clearInterval(callVadIntervalRef.current);
          callVadIntervalRef.current = null;
        }
        setCallAudioLevel(0);
        if (recorder && recorder.state !== 'inactive') {
          try { recorder.stop(); } catch (e) {}
        }
      };

      finishCallRecordingRef.current = finishAndProcessRecording;

      recorder.onstop = async () => {
        if (callStatusRef.current !== 'connected') return;

        // Couper les pistes micro pour la règle anti-larsen dès l'arrêt complet
        if (callStreamRef.current) {
          callStreamRef.current.getAudioTracks().forEach(t => { t.enabled = false; });
        }

        const actualMime = recorder.mimeType || mimeType || 'audio/webm';
        const audioBlob = new Blob(callChunksRef.current, { type: actualMime });

        if (audioBlob.size > 200) {
          await handleCallAudioExchange(audioBlob, extension);
        } else {
          // Si rien d'audible n'a été enregistré, relancer l'écoute
          if (callStatusRef.current === 'connected' && !callIsMutedRef.current) {
            startCallListening();
          }
        }
      };

      recorder.start(200);

      // Boucle VAD : vérification d'activité toutes les 50 ms si analyserNode disponible
      let speechStarted = false;
      let speechStartTime = 0;
      let lastSpeechTime = 0;
      const recordingStartTime = Date.now();
      const timeData = analyserNode ? new Uint8Array(analyserNode.fftSize) : null;

      callVadIntervalRef.current = setInterval(() => {
        if (callStatusRef.current !== 'connected' || callIsMutedRef.current) {
          finishAndProcessRecording();
          return;
        }

        let isSpeaking = false;
        if (analyserNode && timeData) {
          analyserNode.getByteTimeDomainData(timeData);
          let sumSquares = 0;
          for (let i = 0; i < timeData.length; i++) {
            const norm = (timeData[i] - 128) / 128;
            sumSquares += norm * norm;
          }
          const rms = Math.sqrt(sumSquares / timeData.length);
          const level = Math.min(100, Math.round(rms * 500));
          setCallAudioLevel(level);
          isSpeaking = rms > VAD_SILENCE_THRESHOLD;
        }

        const now = Date.now();

        if (isSpeaking) {
          if (!speechStarted) {
            speechStarted = true;
            speechStartTime = now;
          }
          lastSpeechTime = now;
        }

        // Condition A : Silence détecté après une prise de parole valide
        if (speechStarted && (now - lastSpeechTime >= VAD_SILENCE_DURATION_MS)) {
          const totalSpeechDuration = lastSpeechTime - speechStartTime;
          if (totalSpeechDuration >= VAD_MIN_SPEECH_DURATION_MS) {
            finishAndProcessRecording();
            return;
          } else {
            speechStarted = false;
          }
        }

        // Condition B : Durée maximale d'enregistrement atteinte (15s)
        if (now - recordingStartTime >= VAD_MAX_RECORDING_MS) {
          finishAndProcessRecording();
          return;
        }
      }, VAD_POLL_INTERVAL_MS);

    } catch (err) {
      console.warn("Erreur accès micro en mode appel:", err);
      updateCallAgentState('error');
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        alert("Accès au microphone refusé. Veuillez autoriser le micro dans votre navigateur.");
      }
      endCall();
    }
  };

  // Traitement audio de l'échange : Whisper -> Qwen (/api/call/answer) -> Piper TTS
  const handleCallAudioExchange = async (audioBlob, extension) => {
    if (callStatusRef.current !== 'connected') return;

    updateCallAgentState('transcribing');

    try {
      // 1. Transcription Whisper.cpp CUDA locale
      const formData = new FormData();
      formData.append('file', audioBlob, `speech_call.${extension}`);

      const transRes = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
      });

      if (!transRes.ok) {
        throw new Error(`Erreur transcription ${transRes.status}`);
      }

      const transData = await transRes.json();
      const transcript = transData.transcript?.trim();

      if (!transcript) {
        // Aucune parole claire identifiée, relancer l'écoute
        if (callStatusRef.current === 'connected' && !callIsMutedRef.current) {
          startCallListening();
        }
        return;
      }

      setCallUserSpoken(transcript);
      updateCallAgentState('thinking');
      setCallHistory((prev) => [...prev, { role: 'user', text: transcript }]);

      // 2. Génération de la réponse bancaire orale synthétique
      const ansRes = await fetch('/api/call/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: transcript, voice: callVoice })
      });

      if (!ansRes.ok) {
        throw new Error(`Erreur génération réponse ${ansRes.status}`);
      }

      const ansData = await ansRes.json();
      await speakAgentCall(ansData.answer);

    } catch (e) {
      console.error("Erreur serveur échange vocal appel:", e);
      if (callStatusRef.current === 'connected') {
        await speakAgentCall("Veuillez m'excuser, une petite difficulté technique est survenue. Pourriez-vous répéter votre question s'il vous plaît ?");
      }
    }
  };

  // Nettoyage complet au démontage du composant
  useEffect(() => {
    return () => {
      endCall();
      stopClassicRecording();
      if (chatAudioPlayerRef.current) {
        chatAudioPlayerRef.current.pause();
      }
      if (chatAudioUrlRef.current) {
        URL.revokeObjectURL(chatAudioUrlRef.current);
      }
    };
  }, []);

  return (
    <div className="app-container">
      
      {/* Audio players invisibles pour la synthèse vocale */}
      <audio ref={chatAudioPlayerRef} style={{ display: 'none' }} />
      <audio ref={callAudioPlayerRef} style={{ display: 'none' }} />

      {/* 1. TOP BAR BANCOBU VERTE (#4ba452) */}
      <div style={{ backgroundColor: '#4ba452', color: '#ffffff', fontSize: '0.8rem', padding: '5px 0', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
        <div className="top-bar-inner">
          <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
              <Phone size={13} /> +257 22 26 52 00
            </span>
            <span className="top-bar-location" style={{ display: 'flex', alignItems: 'center', gap: '6px', opacity: 0.9 }}>
              <MapPin size={13} /> Bujumbura, Burundi
            </span>
          </div>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', fontWeight: 600 }}>
            {/* Toggle Voix automatique */}
            <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', background: 'rgba(0,0,0,0.18)', padding: '2px 8px', borderRadius: '12px' }}>
              <input 
                type="checkbox" 
                checked={autoPlayAudio} 
                onChange={(e) => setAutoPlayAudio(e.target.checked)} 
                style={{ cursor: 'pointer' }}
              />
              <Volume2 size={12} />
              <span style={{ fontSize: '0.72rem' }}>Voix auto</span>
            </label>
            <span className="top-bar-hub" style={{ opacity: 0.9 }}>Digital Hub</span>
          </div>
        </div>
      </div>

      {/* 2. HEADER PRINCIPAL BLANC AVEC LOGO OFFICIEL */}
      <header style={{ backgroundColor: '#ffffff', borderBottom: '1px solid #e2e8f0', boxShadow: '0 2px 10px rgba(0,0,0,0.04)', position: 'sticky', top: 0, zIndex: 50 }}>
        <div className="header-inner">
          
          {/* Logo & Titre */}
          <div className="header-brand-wrap" onClick={() => setActiveTab('demo')} style={{ cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <img 
                src="/Bancobu_Logo.png" 
                alt="Logo BANCOBU" 
                className="header-logo-img"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
              <div style={{ borderLeft: '2px solid #e2e8f0', paddingLeft: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontWeight: 800, fontSize: '1.15rem', color: '#2d3748', letterSpacing: '-0.5px' }}>BANCOBU</span>
                  <span style={{ fontSize: '0.68rem', backgroundColor: '#eef7ee', color: '#4ba452', padding: '1px 6px', borderRadius: '10px', border: '1px solid #c2e2c4', fontWeight: 700 }}>
                    IA & VOIX
                  </span>
                </div>
                <p className="header-title-sub">Banque Commerciale du Burundi</p>
              </div>
            </div>
          </div>

          {/* Onglets de navigation */}
          <nav className="header-nav">
            <button
              onClick={() => setActiveTab('demo')}
              className="nav-btn"
              style={{
                border: activeTab === 'demo' ? '2px solid #0080fe' : '1px solid #e2e8f0',
                color: activeTab === 'demo' ? '#ffffff' : '#4a5568',
                backgroundColor: activeTab === 'demo' ? '#0080fe' : '#ffffff',
                boxShadow: activeTab === 'demo' ? '0 4px 12px rgba(0, 128, 254, 0.25)' : 'none',
              }}
            >
              <Sparkles size={14} /> Conseiller Vocal
            </button>
            <button
              onClick={() => setActiveTab('call')}
              className="nav-btn"
              style={{
                border: activeTab === 'call' ? '2px solid #16a34a' : '1px solid #e2e8f0',
                color: activeTab === 'call' ? '#ffffff' : '#4a5568',
                backgroundColor: activeTab === 'call' ? '#16a34a' : '#ffffff',
                boxShadow: activeTab === 'call' ? '0 4px 12px rgba(22, 163, 74, 0.25)' : 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <PhoneCall size={14} /> Appel en Direct
              {callStatus === 'connected' && (
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#ef4444', display: 'inline-block', animation: 'pulse 1s infinite' }} />
              )}
            </button>
            <button
              onClick={() => setActiveTab('presentation')}
              className="nav-btn"
              style={{
                border: activeTab === 'presentation' ? '2px solid #4ba452' : '1px solid #e2e8f0',
                color: activeTab === 'presentation' ? '#ffffff' : '#4a5568',
                backgroundColor: activeTab === 'presentation' ? '#4ba452' : '#ffffff',
                boxShadow: activeTab === 'presentation' ? '0 4px 12px rgba(75, 164, 82, 0.25)' : 'none',
              }}
            >
              Présentation
            </button>
          </nav>
        </div>
      </header>

      {/* 3. CORPS DE PAGE */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflowY: activeTab === 'presentation' ? 'auto' : 'hidden' }}>
        {activeTab === 'presentation' ? (
          /* ================= PRESENTATION & INNOVATION ================= */
          <div style={{ maxWidth: '1140px', margin: '0 auto', padding: '30px 16px', width: '100%' }}>
            
            {/* Bannière Hero Style BANCOBU */}
            <div className="presentation-hero" style={{ backgroundColor: '#ffffff', borderRadius: '16px', padding: '40px 30px', boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: '1px solid #e2e8f0', marginBottom: '30px', textAlign: 'center' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 14px', borderRadius: '20px', backgroundColor: '#eef7ee', color: '#4ba452', border: '1px solid #c2e2c4', fontWeight: 700, fontSize: '0.82rem', marginBottom: '16px' }}>
                <Sparkles size={14} /> Innovation Bancaire : Voix & IA RAG 100% Locale
              </div>
              <h1 className="presentation-title" style={{ fontSize: '2.2rem', fontWeight: 800, color: '#1a202c', marginBottom: '14px', lineHeight: 1.25 }}>
                L'Intelligence Artificielle & la Voix au Cœur de la <br />
                <span style={{ color: '#4ba452' }}>Relation Client BANCOBU</span>
              </h1>
              <p className="presentation-desc" style={{ fontSize: '1.05rem', color: '#4a5568', maxWidth: '750px', margin: '0 auto 24px', lineHeight: 1.6 }}>
                Posez vos questions à la voix ou par écrit, et écoutez les réponses naturelles d'une conseillère virtuelle, certifiées et sourcées à partir de la documentation officielle de la BANCOBU, opérée à 100% sur NVIDIA Jetson Orin Nano.
              </p>
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <button
                  onClick={() => setActiveTab('demo')}
                  style={{
                    backgroundColor: '#4ba452',
                    color: '#ffffff',
                    border: 'none',
                    padding: '12px 24px',
                    borderRadius: '8px',
                    fontWeight: 700,
                    fontSize: '0.95rem',
                    cursor: 'pointer',
                    boxShadow: '0 6px 18px rgba(75, 164, 82, 0.35)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  <Mic size={17} />
                  Parler avec le conseiller
                </button>
              </div>
            </div>

            {/* Grille Piliers Technologiques Locaux */}
            <div style={{ marginBottom: '30px' }}>
              <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#2d3748' }}>Une Chaîne Technologique 100% Locale</h2>
                <p style={{ color: '#718096', fontSize: '0.9rem' }}>De la reconnaissance vocale Whisper CUDA à la synthèse vocale Piper sur Jetson Orin Nano</p>
              </div>

              <div className="tech-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
                <div style={{ backgroundColor: '#ffffff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '8px', backgroundColor: '#eef7ee', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '14px' }}>
                    <Mic size={20} style={{ color: '#4ba452' }} />
                  </div>
                  <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#2d3748', marginBottom: '6px' }}>1. Entrée Vocale Locale (Whisper.cpp)</h3>
                  <p style={{ fontSize: '0.85rem', color: '#718096', lineHeight: 1.5 }}>
                    Transcrit la parole instantanément avec Whisper.cpp Small accéléré par CUDA directement sur le GPU Jetson.
                  </p>
                </div>

                <div style={{ backgroundColor: '#ffffff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '8px', backgroundColor: '#ebf8ff', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '14px' }}>
                    <Database size={20} style={{ color: '#0080fe' }} />
                  </div>
                  <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#2d3748', marginBottom: '6px' }}>2. Recherche Sémantique Qdrant</h3>
                  <p style={{ fontSize: '0.85rem', color: '#718096', lineHeight: 1.5 }}>
                    Localise les extraits vérifiés dans <code>bancobu_donnees.pdf</code> avec EmbeddingGemma local en quelques millisecondes.
                  </p>
                </div>

                <div style={{ backgroundColor: '#ffffff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '8px', backgroundColor: '#fffaf0', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '14px' }}>
                    <Cpu size={20} style={{ color: '#de6906' }} />
                  </div>
                  <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#2d3748', marginBottom: '6px' }}>3. Raisonnement Qwen 2.5 3B</h3>
                  <p style={{ fontSize: '0.85rem', color: '#718096', lineHeight: 1.5 }}>
                    Rédige une réponse certifiée conforme aux documents officiels sans aucune fuite vers le cloud.
                  </p>
                </div>

                <div style={{ backgroundColor: '#ffffff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '8px', backgroundColor: '#eef7ee', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '14px' }}>
                    <Volume2 size={20} style={{ color: '#4ba452' }} />
                  </div>
                  <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#2d3748', marginBottom: '6px' }}>4. Synthèse Vocale Piper TTS</h3>
                  <p style={{ fontSize: '0.85rem', color: '#718096', lineHeight: 1.5 }}>
                    Génération audio WAV fluide avec la voix française naturelle Siwis (100% autonome et locale).
                  </p>
                </div>
              </div>
            </div>

          </div>
        ) : activeTab === 'call' ? (
          /* ================= MODE APPEL EN DIRECT BANCOBU ================= */
          <div style={{ maxWidth: '820px', margin: '0 auto', padding: '24px 16px', width: '100%', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            {/* Carte Principale Appel */}
            <div style={{ backgroundColor: '#ffffff', borderRadius: '20px', border: '1px solid #e2e8f0', boxShadow: '0 8px 30px rgba(0,0,0,0.06)', padding: '28px 20px', textAlign: 'center' }}>
              
              {/* En-tête statut de la ligne & sélection de la conseillère */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', borderBottom: '1px solid #f0f4f8', paddingBottom: '16px', marginBottom: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ 
                    width: '10px', 
                    height: '10px', 
                    borderRadius: '50%', 
                    backgroundColor: callStatus === 'connected' ? '#16a34a' : '#94a3b8',
                    display: 'inline-block',
                    boxShadow: callStatus === 'connected' ? '0 0 8px #16a34a' : 'none'
                  }} />
                  <span style={{ fontWeight: 700, fontSize: '0.9rem', color: '#1e293b' }}>
                    {callStatus === 'connected' ? `En communication • ${formatCallTime(callDuration)}` : "Standard Téléphonique BANCOBU"}
                  </span>
                </div>

                {/* Sélecteur de Voix */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>Conseillère :</span>
                  <button
                    disabled={callStatus === 'connected'}
                    onClick={() => setCallVoice('siwis')}
                    style={{
                      padding: '4px 12px',
                      borderRadius: '14px',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      border: '2px solid #4ba452',
                      backgroundColor: '#eef7ee',
                      color: '#3d8a43',
                      cursor: 'default',
                    }}
                  >
                    👩 Siwis (Conseillère BANCOBU - Voix Locale)
                  </button>
                </div>
              </div>

              {/* État 1 : Appel non démarré (Prêt) */}
              {callStatus === 'idle' && (
                <div style={{ padding: '24px 0 16px' }}>
                  <div style={{
                    width: '96px',
                    height: '96px',
                    borderRadius: '50%',
                    backgroundColor: '#eef7ee',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 20px',
                    color: '#4ba452',
                    border: '2px solid #c2e2c4',
                    boxShadow: '0 4px 16px rgba(75, 164, 82, 0.15)'
                  }}>
                    <PhoneCall size={44} />
                  </div>
                  <h2 style={{ fontSize: '1.45rem', fontWeight: 800, color: '#1e293b', marginBottom: '8px' }}>
                    Parler avec votre Conseillère BANCOBU
                  </h2>
                  <p style={{ color: '#64748b', fontSize: '0.92rem', maxWidth: '520px', margin: '0 auto 26px', lineHeight: 1.55 }}>
                    Lancez un appel en direct pour poser toutes vos questions oralement. Le système écoute et répond en continu en mains-libres, avec détection automatique de parole et synthèse locale.
                  </p>
                  <button
                    onClick={startCall}
                    style={{
                      backgroundColor: '#16a34a',
                      color: '#ffffff',
                      border: 'none',
                      padding: '14px 34px',
                      borderRadius: '30px',
                      fontSize: '1.05rem',
                      fontWeight: 700,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '10px',
                      cursor: 'pointer',
                      boxShadow: '0 8px 24px rgba(22, 163, 74, 0.35)',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <PhoneCall size={20} />
                    Démarrer l'Appel Vocal
                  </button>
                </div>
              )}

              {/* État 2 : Appel en cours (Connecté) */}
              {callStatus === 'connected' && (
                <div style={{ padding: '10px 0' }}>
                  
                  {/* Visuel dynamique d'état de l'agent */}
                  <div style={{ minHeight: '130px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '20px' }}>
                    {callAgentState === 'speaking' && (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', height: '50px' }}>
                          <span className="call-wave-bar" />
                          <span className="call-wave-bar" />
                          <span className="call-wave-bar" />
                          <span className="call-wave-bar" />
                          <span className="call-wave-bar" />
                          <span className="call-wave-bar" />
                          <span className="call-wave-bar" />
                        </div>
                        <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#16a34a' }}>
                          La conseillère vous répond oralement...
                        </span>
                        <button
                          onClick={handleCallInterrupt}
                          style={{
                            backgroundColor: '#16a34a',
                            color: '#ffffff',
                            border: 'none',
                            padding: '9px 20px',
                            borderRadius: '24px',
                            fontWeight: 700,
                            fontSize: '0.86rem',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '7px',
                            cursor: 'pointer',
                            boxShadow: '0 4px 14px rgba(22, 163, 74, 0.35)',
                            marginTop: '2px'
                          }}
                        >
                          <Mic size={16} /> Prendre la parole maintenant
                        </button>
                      </div>
                    )}

                    {callAgentState === 'recording' && (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                        <div 
                          onClick={triggerCallFinish}
                          title="Cliquez pour envoyer votre question immédiatement"
                          className="call-radar" 
                          style={{
                            width: '80px',
                            height: '80px',
                            borderRadius: '50%',
                            backgroundColor: '#eef7ee',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#16a34a',
                            border: `3px solid ${callAudioLevel > 15 ? '#16a34a' : '#86efac'}`,
                            boxShadow: `0 0 ${8 + callAudioLevel / 3}px rgba(22, 163, 74, 0.45)`,
                            cursor: 'pointer',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <Mic size={38} />
                        </div>

                        {/* Indicateur de volume et statut */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '0.92rem', fontWeight: 700, color: '#16a34a' }}>
                            {callAudioLevel > 15 ? "Voix détectée..." : "À vous la parole, je vous écoute..."}
                          </span>
                          <div style={{ width: '130px', height: '6px', backgroundColor: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                            <div style={{ width: `${Math.min(100, Math.max(6, callAudioLevel))}%`, height: '100%', backgroundColor: '#16a34a', transition: 'width 0.08s ease' }} />
                          </div>
                        </div>

                        {/* Bouton explicite d'envoi immédiat */}
                        <button
                          onClick={triggerCallFinish}
                          style={{
                            backgroundColor: '#16a34a',
                            color: '#ffffff',
                            border: 'none',
                            padding: '10px 22px',
                            borderRadius: '24px',
                            fontWeight: 700,
                            fontSize: '0.88rem',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '8px',
                            cursor: 'pointer',
                            boxShadow: '0 4px 14px rgba(22, 163, 74, 0.35)',
                            marginTop: '2px'
                          }}
                        >
                          <CheckCircle size={16} /> J'ai fini de parler (Envoyer)
                        </button>
                      </div>
                    )}

                    {callAgentState === 'transcribing' && (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' }}>
                        <div style={{
                          width: '64px',
                          height: '64px',
                          borderRadius: '50%',
                          backgroundColor: '#eff6ff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#0080fe',
                          animation: 'pulse 1s infinite'
                        }}>
                          <Mic size={30} />
                        </div>
                        <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#0080fe' }}>
                          Transcription vocale Whisper.cpp en cours...
                        </span>
                      </div>
                    )}

                    {callAgentState === 'thinking' && (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' }}>
                        <div style={{
                          width: '64px',
                          height: '64px',
                          borderRadius: '50%',
                          backgroundColor: '#fef3c7',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#d97706',
                          animation: 'pulse 1s infinite'
                        }}>
                          <Sparkles size={30} />
                        </div>
                        <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#d97706' }}>
                          Recherche dans la documentation bancaire BANCOBU...
                        </span>
                      </div>
                    )}

                    {callAgentState === 'requesting_permission' && (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' }}>
                        <div style={{
                          width: '64px',
                          height: '64px',
                          borderRadius: '50%',
                          backgroundColor: '#f1f5f9',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#64748b'
                        }}>
                          <Mic size={28} />
                        </div>
                        <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#64748b' }}>
                          Activation du microphone...
                        </span>
                      </div>
                    )}

                    {callAgentState === 'error' && (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' }}>
                        <div style={{
                          width: '64px',
                          height: '64px',
                          borderRadius: '50%',
                          backgroundColor: '#fee2e2',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#dc2626'
                        }}>
                          <MicOff size={28} />
                        </div>
                        <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#dc2626' }}>
                          Erreur de communication audio
                        </span>
                      </div>
                    )}

                    {callAgentState === 'idle' && (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                        <button
                          onClick={startCallListening}
                          style={{
                            backgroundColor: '#16a34a',
                            color: '#ffffff',
                            border: 'none',
                            padding: '12px 28px',
                            borderRadius: '28px',
                            fontWeight: 700,
                            fontSize: '0.98rem',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '10px',
                            cursor: 'pointer',
                            boxShadow: '0 4px 16px rgba(22, 163, 74, 0.35)',
                          }}
                        >
                          <Mic size={20} /> Appuyer pour parler
                        </button>
                        <span style={{ fontSize: '0.84rem', color: '#64748b' }}>
                          Ligne active • Cliquez sur le bouton ou parlez directement
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Bulle d'affichage de ce qui est dit en temps réel */}
                  <div style={{
                    minHeight: '72px',
                    backgroundColor: '#f8fafc',
                    borderRadius: '14px',
                    padding: '16px 20px',
                    border: '1px solid #e2e8f0',
                    marginBottom: '26px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    textAlign: 'center'
                  }}>
                    {callAgentState === 'recording' || callAgentState === 'transcribing' ? (
                      <p style={{ fontStyle: callUserSpoken ? 'normal' : 'italic', color: callUserSpoken ? '#1e293b' : '#94a3b8', fontSize: '0.96rem' }}>
                        {callUserSpoken ? `« ${callUserSpoken} »` : "Parlez librement, ou cliquez sur 'Envoyer' dès que vous avez fini..."}
                      </p>
                    ) : (
                      <p style={{ color: '#334155', fontSize: '0.94rem', lineHeight: 1.55 }}>
                        {callAgentSpoken ? `« ${callAgentSpoken} »` : "Connecté au standard BANCOBU."}
                      </p>
                    )}
                  </div>

                  {/* Barre de contrôle d'appel (Interrompre / Mute / Raccrocher) */}
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                    
                    {/* Bouton d'interruption explicite pendant que le conseiller parle (barge-in) */}
                    {callAgentState === 'speaking' && (
                      <button
                        onClick={handleCallInterrupt}
                        style={{
                          backgroundColor: '#f59e0b',
                          color: '#ffffff',
                          border: 'none',
                          padding: '11px 22px',
                          borderRadius: '24px',
                          fontWeight: 700,
                          fontSize: '0.9rem',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '7px',
                          cursor: 'pointer',
                          boxShadow: '0 4px 14px rgba(245, 158, 11, 0.35)',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        <Square size={14} />
                        Interrompre la réponse
                      </button>
                    )}

                    <button
                      onClick={toggleCallMute}
                      style={{
                        backgroundColor: callIsMuted ? '#fee2e2' : '#f1f5f9',
                        color: callIsMuted ? '#dc2626' : '#475569',
                        border: '1px solid #cbd5e1',
                        padding: '10px 20px',
                        borderRadius: '24px',
                        fontWeight: 600,
                        fontSize: '0.88rem',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        cursor: 'pointer'
                      }}
                    >
                      {callIsMuted ? <MicOff size={16} /> : <Mic size={16} />}
                      {callIsMuted ? "Micro Coupé" : "Couper Micro"}
                    </button>

                    <button
                      onClick={endCall}
                      style={{
                        backgroundColor: '#dc2626',
                        color: '#ffffff',
                        border: 'none',
                        padding: '12px 30px',
                        borderRadius: '24px',
                        fontWeight: 700,
                        fontSize: '0.95rem',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                        cursor: 'pointer',
                        boxShadow: '0 4px 14px rgba(220, 38, 38, 0.35)'
                      }}
                    >
                      <PhoneOff size={18} />
                      Raccrocher
                    </button>
                  </div>

                </div>
              )}

            </div>

            {/* Historique écrit de l'appel pour relecture */}
            {callHistory.length > 0 && (
              <div style={{ backgroundColor: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '18px 20px', boxShadow: '0 2px 10px rgba(0,0,0,0.03)' }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#334155', marginBottom: '12px' }}>
                  Transcription du dialogue ({callHistory.length} échanges)
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '220px', overflowY: 'auto', paddingRight: '4px' }}>
                  {callHistory.map((item, idx) => (
                    <div 
                      key={idx}
                      style={{
                        alignSelf: item.role === 'user' ? 'flex-end' : 'flex-start',
                        backgroundColor: item.role === 'user' ? '#eef7ee' : '#f8fafc',
                        border: item.role === 'user' ? '1px solid #c2e2c4' : '1px solid #e2e8f0',
                        color: '#1e293b',
                        padding: '8px 12px',
                        borderRadius: '10px',
                        fontSize: '0.85rem',
                        maxWidth: '85%'
                      }}
                    >
                      <span style={{ fontWeight: 700, fontSize: '0.75rem', color: item.role === 'user' ? '#16a34a' : '#0066cc', display: 'block', marginBottom: '2px' }}>
                        {item.role === 'user' ? 'Vous' : 'Conseillère BANCOBU (Siwis)'}
                      </span>
                      {item.text}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ textAlign: 'center', fontSize: '0.74rem', color: '#94a3b8', marginTop: '6px' }}>
              BANCOBU S.A. — Siège Social : Boulevard de la Liberté, Bujumbura • Tél: +257 22 26 52 00
            </div>

          </div>
        ) : (
          /* ================= CHATBOT BANCOBU AVEC AUDIO & MICRO ================= */
          <div className="chat-container">
            
            {/* Zone de discussion */}
            <div className="chat-messages">
              {messages.map((msg, index) => {
                const isAssistant = msg.role === 'assistant';
                const isPlaying = playingIndex === index;

                return (
                  <div 
                    key={index} 
                    className="msg-row"
                    style={{ 
                      justifyContent: isAssistant ? 'flex-start' : 'flex-end',
                    }}
                  >
                    {isAssistant && (
                      <div className="msg-avatar" style={{ width: '36px', height: '36px', borderRadius: '10px', backgroundColor: '#4ba452', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 2px 6px rgba(75, 164, 82, 0.3)' }}>
                        <Bot size={18} style={{ color: '#ffffff' }} />
                      </div>
                    )}

                    <div 
                      className={isAssistant ? "msg-content-assistant" : "msg-content-user"}
                      style={{ 
                        display: 'flex', 
                        flexDirection: 'column', 
                        gap: '5px', 
                        alignItems: isAssistant ? 'flex-start' : 'flex-end',
                        maxWidth: isAssistant ? '88%' : '78%'
                      }}
                    >
                      <div 
                        className="msg-bubble"
                        style={{
                          borderRadius: isAssistant ? '4px 16px 16px 16px' : '16px 4px 16px 16px',
                          backgroundColor: isAssistant ? (msg.error ? '#fff5f5' : '#ffffff') : '#4ba452',
                          color: isAssistant ? (msg.error ? '#c53030' : '#2d3748') : '#ffffff',
                          border: isAssistant ? (msg.error ? '1px solid #feb2b2' : '1px solid #e2e8f0') : 'none',
                        }}
                      >
                        {msg.content}

                        {/* Bouton pour écouter la réponse */}
                        {isAssistant && !msg.error && (
                          <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <button
                              onClick={() => playTTS(msg.content, index)}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '5px',
                                padding: '4px 10px',
                                borderRadius: '14px',
                                border: '1px solid #c2e2c4',
                                backgroundColor: isPlaying ? '#4ba452' : '#eef7ee',
                                color: isPlaying ? '#ffffff' : '#3d8a43',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                                transition: 'all 0.2s ease'
                              }}
                            >
                              {isPlaying ? (
                                <>
                                  <Square size={11} /> Arrêter
                                </>
                              ) : (
                                <>
                                  <Volume2 size={12} /> Écouter la voix
                                </>
                              )}
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Sources consultées */}
                      {isAssistant && msg.sources && msg.sources.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '2px' }}>
                          <span style={{ fontSize: '0.72rem', color: '#718096', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                            <BookOpen size={11} style={{ color: '#4ba452' }} /> Pages vérifiées :
                          </span>
                          {msg.sources.map((src, sIdx) => (
                            <span 
                              key={sIdx}
                              style={{
                                fontSize: '0.7rem',
                                backgroundColor: '#eef7ee',
                                border: '1px solid #c2e2c4',
                                padding: '1px 6px',
                                borderRadius: '4px',
                                color: '#3d8a43',
                                fontWeight: 600
                              }}
                            >
                              p.{src.page}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {!isAssistant && (
                      <div className="msg-avatar" style={{ width: '36px', height: '36px', borderRadius: '10px', backgroundColor: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <User size={18} style={{ color: '#4a5568' }} />
                      </div>
                    )}
                  </div>
                );
              })}

              {isTranscribing && (
                <div className="msg-row" style={{ alignItems: 'center' }}>
                  <div className="msg-avatar" style={{ width: '36px', height: '36px', borderRadius: '10px', backgroundColor: '#0080fe', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Mic size={18} style={{ color: '#ffffff' }} />
                  </div>
                  <div style={{ padding: '10px 14px', borderRadius: '4px 16px 16px 16px', backgroundColor: '#ffffff', border: '1px solid #cbd5e0', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 2px 6px rgba(0,0,0,0.04)' }}>
                    <span style={{ fontSize: '0.82rem', color: '#2d3748', fontWeight: 600 }}>Transcription vocale Whisper.cpp en cours...</span>
                    <div style={{ display: 'flex', gap: '3px' }}>
                      <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: '#0080fe', animation: 'pulse 1s infinite' }}></span>
                    </div>
                  </div>
                </div>
              )}

              {isLoading && (
                <div className="msg-row" style={{ alignItems: 'center' }}>
                  <div className="msg-avatar" style={{ width: '36px', height: '36px', borderRadius: '10px', backgroundColor: '#4ba452', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Bot size={18} style={{ color: '#ffffff' }} />
                  </div>
                  <div style={{ padding: '10px 14px', borderRadius: '4px 16px 16px 16px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 2px 6px rgba(0,0,0,0.04)' }}>
                    <span style={{ fontSize: '0.82rem', color: '#718096' }}>Recherche BANCOBU & synthèse vocale...</span>
                    <div style={{ display: 'flex', gap: '3px' }}>
                      <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: '#4ba452' }}></span>
                      <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: '#0080fe' }}></span>
                      <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: '#de6906' }}></span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Questions fréquentes suggérées */}
            {messages.length <= 2 && (
              <div>
                <p style={{ fontSize: '0.72rem', color: '#718096', marginTop: '6px', marginBottom: '4px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                  Suggestions rapides :
                </p>
                <div className="suggested-chips-container">
                  {suggestedQuestions.map((q, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSend(q)}
                      className="suggested-chip"
                    >
                      <ChevronRight size={12} style={{ color: '#4ba452' }} />
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Barre de saisie avec bouton Micro Vocal */}
            <div style={{ marginTop: '8px' }}>
              {/* Bannière active pendant l'enregistrement micro */}
              {isRecording && (
                <div style={{
                  backgroundColor: '#fee2e2',
                  border: '1.5px solid #ef4444',
                  color: '#991b1b',
                  padding: '9px 14px',
                  borderRadius: '12px',
                  marginBottom: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                  boxShadow: '0 4px 12px rgba(239, 68, 68, 0.2)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.88rem', fontWeight: 700 }}>
                    <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#ef4444', display: 'inline-block', animation: 'pulse 1s infinite' }} />
                    Micro actif : parlez maintenant...
                  </div>
                  <button
                    type="button"
                    onClick={stopClassicRecording}
                    style={{
                      backgroundColor: '#dc2626',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '20px',
                      padding: '7px 16px',
                      fontSize: '0.84rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      boxShadow: '0 2px 8px rgba(220, 38, 38, 0.4)'
                    }}
                  >
                    <CheckCircle size={15} /> Valider & Envoyer
                  </button>
                </div>
              )}

              <form 
                onSubmit={(e) => { e.preventDefault(); handleSend(); }}
                className="input-form"
                style={{
                  border: isRecording ? '2px solid #ef4444' : '2px solid #cbd5e0',
                  boxShadow: isRecording ? '0 0 14px rgba(239, 68, 68, 0.3)' : '0 3px 10px rgba(0, 0, 0, 0.05)',
                }}
              >
                {/* Bouton Micro */}
                <button
                  type="button"
                  onClick={toggleRecording}
                  className="mic-button"
                  title={isRecording ? "Arrêter l'enregistrement et envoyer" : "Parler au micro"}
                  style={{
                    backgroundColor: isRecording ? '#ef4444' : '#eef7ee',
                    color: isRecording ? '#ffffff' : '#4ba452',
                    border: 'none',
                    borderRadius: '50%',
                    width: '40px',
                    height: '40px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    marginRight: '8px',
                    flexShrink: 0,
                    animation: isRecording ? 'pulse 1.5s infinite' : 'none'
                  }}
                >
                  {isRecording ? <MicOff size={18} /> : <Mic size={18} />}
                </button>

                <input
                  type="text"
                  placeholder={
                    isRecording 
                      ? "🔴 Parlez dans votre micro... Cliquez sur Envoyer pour valider" 
                      : (isTranscribing ? "Transcription Whisper.cpp en cours sur Jetson..." : "Écrivez ou touchez le micro pour parler...")
                  }
                  value={inputQuestion}
                  onChange={(e) => setInputQuestion(e.target.value)}
                  className="input-text-field"
                  disabled={isLoading || isTranscribing}
                />

                <button
                  type="submit"
                  disabled={(!isRecording && !inputQuestion.trim()) || isLoading || isTranscribing}
                  className="send-button"
                  style={{
                    backgroundColor: isRecording ? '#dc2626' : undefined,
                    cursor: (!isRecording && !inputQuestion.trim()) || isLoading || isTranscribing ? 'not-allowed' : 'pointer',
                    opacity: (!isRecording && !inputQuestion.trim()) || isLoading || isTranscribing ? 0.6 : 1,
                  }}
                >
                  <span className="send-button-text">{isRecording ? "Envoyer l'audio" : "Envoyer"}</span>
                  {isRecording ? <CheckCircle size={14} /> : <Send size={14} />}
                </button>
              </form>

              <div className="chat-disclaimer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', fontSize: '0.72rem', color: '#718096', padding: '0 4px' }}>
                <span>BANCOBU AI • Conseillère Virtuelle Officielle</span>
                <span>Siège Social : Boulevard de la Liberté, Bujumbura • Tél: +257 22 26 52 00</span>
              </div>
            </div>

          </div>
        )}
      </main>

      {/* 4. FOOTER OFFICIEL BANCOBU (#2b2f3b) - Présentation uniquement */}
      {activeTab === 'presentation' && (
        <footer className="footer-section">
          <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <div>
              <span style={{ fontWeight: 700, color: '#ffffff' }}>BANCOBU S.A.</span> — Siège Social : Boulevard de la Liberté, Bujumbura
            </div>
            <div>
              <span>Tél: +257 22 26 52 00 | info@bancobu.com</span>
            </div>
          </div>
        </footer>
      )}

    </div>
  );
}
