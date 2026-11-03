import React, { useState, useRef, useEffect } from 'react';
import { 
  Sparkles, Send, Bot, User, ShieldCheck, 
  BookOpen, ChevronRight, CheckCircle, 
  Database, Cpu, MessageSquare, Phone, MapPin,
  Mic, MicOff, Volume2, Square, PhoneCall, PhoneOff
} from './Icons';

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
  const [callStatus, setCallStatus] = useState('idle'); // 'idle' | 'connected'
  const [callAgentState, setCallAgentState] = useState('idle'); // 'speaking' | 'listening' | 'thinking'
  const [callVoice, setCallVoice] = useState('fr-FR-DeniseNeural'); // 'fr-FR-DeniseNeural' ou 'fr-FR-HenriNeural'
  const [callDuration, setCallDuration] = useState(0);
  const [callUserSpoken, setCallUserSpoken] = useState('');
  const [callAgentSpoken, setCallAgentSpoken] = useState('');
  const [callHistory, setCallHistory] = useState([]);
  const [callIsMuted, setCallIsMuted] = useState(false);

  const callTimerRef = useRef(null);
  const callAudioRef = useRef(null);
  const callStatusRef = useRef('idle');
  const callRecognitionRef = useRef(null);
  const callIsMutedRef = useRef(false);
  const isSubmittingRef = useRef(false);
  const lastSpokenRef = useRef('');
  const silenceTimerRef = useRef(null);

  const messagesEndRef = useRef(null);
  const recognitionRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioPlayerRef = useRef(null);

  const suggestedQuestions = [
    "Conditions compte courant ?",
    "Service BANCOBU Diaspora ?",
    "Avantages compte KIRA MAMA ?",
    "Carte Visa prépayée ?"
  ];

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, isTranscribing]);

  // Initialisation du module Speech-To-Text Web Speech API (fallback navigateur)
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      try {
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'fr-FR';

        recognition.onresult = (event) => {
          const transcript = event.results[0][0].transcript;
          if (transcript) {
            setInputQuestion(transcript);
            handleSend(transcript);
          }
        };

        recognition.onerror = (event) => {
          console.warn("SpeechRecognition avertissement:", event.error);
          setIsRecording(false);
          // Si l'API vocale Google renvoie une erreur réseau ou de service, bascule fluide sur MediaRecorder + Gemini
          if (event.error === 'network' || event.error === 'service-not-allowed') {
            console.log("Bascule automatique vers la capture audio directe...");
            startMediaRecording().catch(console.error);
          }
        };

        recognition.onend = () => {
          setIsRecording(false);
        };

        recognitionRef.current = recognition;
      } catch (e) {
        console.warn("SpeechRecognition init error:", e);
      }
    }
  }, []);

  // Déclencher ou arrêter l'enregistrement audio
  const toggleRecording = async () => {
    if (isRecording) {
      stopRecording();
      return;
    }

    // 1. Priorité à la reconnaissance native ultra-rapide (détection automatique de fin de parole)
    if (recognitionRef.current) {
      try {
        recognitionRef.current.start();
        setIsRecording(true);
        return;
      } catch (e) {
        console.warn("SpeechRecognition start échec, bascule MediaRecorder:", e);
      }
    }

    // 2. Alternative MediaRecorder (capture et transcription serveur)
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      await startMediaRecording();
      return;
    }

    alert("Veuillez autoriser l'accès au microphone dans votre navigateur.");
  };

  const startMediaRecording = async () => {
    audioChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      let mimeType = '';
      if (typeof MediaRecorder !== 'undefined') {
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
          mimeType = 'audio/webm;codecs=opus';
        } else if (MediaRecorder.isTypeSupported('audio/webm')) {
          mimeType = 'audio/webm';
        } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
          mimeType = 'audio/mp4';
        }
      }

      const options = mimeType ? { mimeType } : undefined;
      const recorder = new MediaRecorder(stream, options);

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        if (audioChunksRef.current.length > 0) {
          const actualMime = recorder.mimeType || 'audio/webm';
          const audioBlob = new Blob(audioChunksRef.current, { type: actualMime });
          await sendAudioForTranscription(audioBlob);
        }
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      return;
    } catch (err) {
      console.warn("Échec getUserMedia :", err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        alert("Vous avez refusé l'accès au microphone. Cliquez sur l'icône de cadenas/paramètres dans la barre d'adresse pour autoriser le micro.");
      } else {
        alert("Impossible de démarrer l'enregistrement : " + (err.message || "Erreur microphone"));
      }
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch (e) {
        console.warn(e);
      }
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {
        console.warn(e);
      }
    }
    setIsRecording(false);
  };

  // Envoi du blob audio au serveur FastAPI pour transcription Gemini
  const sendAudioForTranscription = async (blob) => {
    setIsTranscribing(true);
    try {
      const formData = new FormData();
      formData.append('file', blob, 'audio_prompt.webm');

      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Erreur serveur lors de la transcription");
      }

      const data = await response.json();
      const transcribedText = data.transcript?.trim();

      if (transcribedText) {
        setInputQuestion(transcribedText);
        handleSend(transcribedText);
      } else {
        alert("Aucune parole audible détectée. Veuillez parler plus près du micro.");
      }
    } catch (err) {
      console.error("Erreur transcription vocale:", err);
      alert("Erreur lors de la transcription vocale. Vous pouvez également poser votre question par écrit.");
    } finally {
      setIsTranscribing(false);
    }
  };

  // Jouer la synthèse vocale d'un message
  const playTTS = async (text, msgIndex) => {
    try {
      if (playingIndex === msgIndex) {
        audioPlayerRef.current?.pause();
        setPlayingIndex(null);
        return;
      }

      setPlayingIndex(msgIndex);
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });

      if (!response.ok) throw new Error("Erreur génération audio");

      const blob = await response.blob();
      const audioUrl = URL.createObjectURL(blob);

      if (audioPlayerRef.current) {
        audioPlayerRef.current.src = audioUrl;
        audioPlayerRef.current.play();
        audioPlayerRef.current.onended = () => {
          setPlayingIndex(null);
        };
      }
    } catch (err) {
      console.error("Erreur lecture audio :", err);
      setPlayingIndex(null);
    }
  };

  const handleSend = async (questionText) => {
    const query = questionText || inputQuestion;
    if (!query.trim() || isLoading) return;

    if (isRecording) {
      stopRecording();
    }

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

  // --- Gestionnaires Mode Appel en Direct ---
  const formatCallTime = (secs) => {
    const mins = Math.floor(secs / 60);
    const remSecs = secs % 60;
    return `${mins < 10 ? '0' : ''}${mins}:${remSecs < 10 ? '0' : ''}${remSecs}`;
  };

  const startCall = async () => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      setPlayingIndex(null);
    }
    setCallStatus('connected');
    callStatusRef.current = 'connected';
    setCallDuration(0);
    setCallUserSpoken('');
    setCallHistory([]);
    setCallIsMuted(false);
    callIsMutedRef.current = false;
    isSubmittingRef.current = false;
    lastSpokenRef.current = '';

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (callTimerRef.current) clearInterval(callTimerRef.current);
    callTimerRef.current = setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);

    const welcomeMsg = "Bonjour et bienvenue au service client de la BANCOBU ! Je suis votre conseiller bancaire virtuel. Comment puis-je vous renseigner aujourd'hui ?";
    await speakAgentCall(welcomeMsg);
  };

  const speakAgentCall = async (text) => {
    if (callStatusRef.current !== 'connected') return;
    setCallAgentState('speaking');
    setCallAgentSpoken(text);
    setCallHistory((prev) => [...prev, { role: 'agent', text }]);

    try {
      if (callRecognitionRef.current) {
        try { callRecognitionRef.current.abort(); } catch (e) {}
      }
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: callVoice })
      });
      if (!response.ok) throw new Error("Erreur TTS");
      const blob = await response.blob();
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      callAudioRef.current = audio;

      audio.onended = () => {
        if (callStatusRef.current === 'connected' && !callIsMutedRef.current) {
          startCallListening();
        } else if (callStatusRef.current === 'connected') {
          setCallAgentState('idle');
        }
      };
      await audio.play();
    } catch (e) {
      console.warn("Erreur lecture voix conseiller:", e);
      setTimeout(() => {
        if (callStatusRef.current === 'connected' && !callIsMutedRef.current) {
          startCallListening();
        }
      }, 1500);
    }
  };

  const submitCallSpoken = (text) => {
    const clean = (text || '').trim();
    if (!clean || isSubmittingRef.current || callStatusRef.current !== 'connected') return;
    isSubmittingRef.current = true;
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (callRecognitionRef.current) {
      try { callRecognitionRef.current.abort(); } catch (e) {}
    }
    handleCallExchange(clean);
  };

  const startCallListening = () => {
    if (callStatusRef.current !== 'connected' || callIsMutedRef.current) return;
    setCallAgentState('listening');
    setCallUserSpoken('');
    isSubmittingRef.current = false;
    lastSpokenRef.current = '';
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      try {
        if (callRecognitionRef.current) {
          try { callRecognitionRef.current.abort(); } catch (e) {}
        }
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = 'fr-FR';

        recognition.onresult = (event) => {
          let interimTranscript = '';
          let finalTranscript = '';
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              finalTranscript += event.results[i][0].transcript;
            } else {
              interimTranscript += event.results[i][0].transcript;
            }
          }
          const spoken = (finalTranscript || interimTranscript).trim();
          if (spoken) {
            lastSpokenRef.current = spoken;
            setCallUserSpoken(spoken);
          }

          if (finalTranscript.trim()) {
            submitCallSpoken(finalTranscript.trim());
          } else if (spoken.length > 2) {
            // Détection automatique du silence naturel (850ms) pour une réactivité instantanée
            if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = setTimeout(() => {
              if (lastSpokenRef.current && !isSubmittingRef.current) {
                submitCallSpoken(lastSpokenRef.current);
              }
            }, 850);
          }
        };

        recognition.onerror = (e) => {
          console.warn("Call speech error:", e.error);
          if (isSubmittingRef.current) return;
          if (lastSpokenRef.current && lastSpokenRef.current.trim().length > 2) {
            submitCallSpoken(lastSpokenRef.current.trim());
            return;
          }
          if (callStatusRef.current === 'connected' && !callIsMutedRef.current) {
            setTimeout(() => {
              if (callStatusRef.current === 'connected' && !callIsMutedRef.current && !isSubmittingRef.current) {
                startCallListening();
              }
            }, 600);
          }
        };

        recognition.onend = () => {
          if (isSubmittingRef.current) return;
          if (lastSpokenRef.current && lastSpokenRef.current.trim().length > 2) {
            submitCallSpoken(lastSpokenRef.current.trim());
            return;
          }
          if (callStatusRef.current === 'connected' && !callIsMutedRef.current && callAgentState === 'listening') {
            setTimeout(() => {
              if (callStatusRef.current === 'connected' && !callIsMutedRef.current && !isSubmittingRef.current) {
                startCallListening();
              }
            }, 300);
          }
        };

        callRecognitionRef.current = recognition;
        recognition.start();
      } catch (err) {
        console.error("SpeechRecognition error:", err);
      }
    }
  };

  const handleCallExchange = async (question) => {
    if (!question || callStatusRef.current !== 'connected') return;
    setCallAgentState('thinking');
    
    // Contexte conversationnel : on enregistre immédiatement la question dans l'historique
    const currentHistory = [...callHistory, { role: 'user', text: question }];
    setCallHistory(currentHistory);

    try {
      const res = await fetch('/api/call/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          question, 
          history: callHistory.slice(-6), 
          voice: callVoice 
        })
      });
      if (!res.ok) throw new Error("Erreur de réponse");
      const data = await res.json();
      await speakAgentCall(data.answer);
    } catch (e) {
      console.error("Erreur serveur appel:", e);
      await speakAgentCall("Veuillez m'excuser, une petite interruption est survenue. Pourriez-vous répéter votre question s'il vous plaît ?");
    }
  };

  const endCall = () => {
    callStatusRef.current = 'idle';
    setCallStatus('idle');
    setCallAgentState('idle');
    setCallUserSpoken('');
    setCallAgentSpoken('');
    isSubmittingRef.current = false;
    lastSpokenRef.current = '';

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }
    if (callAudioRef.current) {
      callAudioRef.current.pause();
      callAudioRef.current = null;
    }
    if (callRecognitionRef.current) {
      try { callRecognitionRef.current.abort(); } catch (e) {}
    }
  };

  const toggleCallMute = () => {
    const nextMute = !callIsMuted;
    setCallIsMuted(nextMute);
    callIsMutedRef.current = nextMute;
    if (nextMute) {
      if (callRecognitionRef.current) {
        try { callRecognitionRef.current.abort(); } catch (e) {}
      }
      setCallAgentState('idle');
    } else {
      if (callStatusRef.current === 'connected') {
        startCallListening();
      }
    }
  };

  return (
    <div className="app-container">
      
      {/* Audio player invisible */}
      <audio ref={audioPlayerRef} style={{ display: 'none' }} />

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
                <Sparkles size={14} /> Innovation Bancaire : Voix & IA RAG
              </div>
              <h1 className="presentation-title" style={{ fontSize: '2.2rem', fontWeight: 800, color: '#1a202c', marginBottom: '14px', lineHeight: 1.25 }}>
                L'Intelligence Artificielle & la Voix au Cœur de la <br />
                <span style={{ color: '#4ba452' }}>Relation Client BANCOBU</span>
              </h1>
              <p className="presentation-desc" style={{ fontSize: '1.05rem', color: '#4a5568', maxWidth: '750px', margin: '0 auto 24px', lineHeight: 1.6 }}>
                Posez vos questions à la voix ou par écrit, et écoutez les réponses naturelles d'un conseiller virtuel, certifiées et sourcées à partir de la documentation officielle de la BANCOBU.
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

            {/* Grille Piliers Technologiques */}
            <div style={{ marginBottom: '30px' }}>
              <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#2d3748' }}>Une Chaîne Technologique Complète</h2>
                <p style={{ color: '#718096', fontSize: '0.9rem' }}>De la reconnaissance vocale à la synthèse audio haute fidélité</p>
              </div>

              <div className="tech-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
                <div style={{ backgroundColor: '#ffffff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '8px', backgroundColor: '#eef7ee', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '14px' }}>
                    <Mic size={20} style={{ color: '#4ba452' }} />
                  </div>
                  <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#2d3748', marginBottom: '6px' }}>1. Entrée Vocale Omnicanale</h3>
                  <p style={{ fontSize: '0.85rem', color: '#718096', lineHeight: 1.5 }}>
                    Transcrit la parole instantanément depuis PC, tablette ou smartphone.
                  </p>
                </div>

                <div style={{ backgroundColor: '#ffffff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '8px', backgroundColor: '#ebf8ff', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '14px' }}>
                    <Database size={20} style={{ color: '#0080fe' }} />
                  </div>
                  <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#2d3748', marginBottom: '6px' }}>2. Recherche Sémantique Qdrant</h3>
                  <p style={{ fontSize: '0.85rem', color: '#718096', lineHeight: 1.5 }}>
                    Localise les articles exacts dans <code>bancobu_donnees.pdf</code> en quelques millisecondes.
                  </p>
                </div>

                <div style={{ backgroundColor: '#ffffff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '8px', backgroundColor: '#fffaf0', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '14px' }}>
                    <Cpu size={20} style={{ color: '#de6906' }} />
                  </div>
                  <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#2d3748', marginBottom: '6px' }}>3. Raisonnement Gemini</h3>
                  <p style={{ fontSize: '0.85rem', color: '#718096', lineHeight: 1.5 }}>
                    Rédige une réponse claire, polie et certifiée respectant les directives bancaires.
                  </p>
                </div>

                <div style={{ backgroundColor: '#ffffff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '8px', backgroundColor: '#eef7ee', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '14px' }}>
                    <Volume2 size={20} style={{ color: '#4ba452' }} />
                  </div>
                  <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#2d3748', marginBottom: '6px' }}>4. Voix Neuronale Naturelle</h3>
                  <p style={{ fontSize: '0.85rem', color: '#718096', lineHeight: 1.5 }}>
                    Génération audio MP3 fluide avec voix de conseiller francophone naturelle (Edge-TTS).
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
              
              {/* En-tête statut de la ligne & sélection du conseiller */}
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
                  <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>Conseiller :</span>
                  <button
                    disabled={callStatus === 'connected'}
                    onClick={() => setCallVoice('fr-FR-DeniseNeural')}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '14px',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      border: callVoice === 'fr-FR-DeniseNeural' ? '2px solid #4ba452' : '1px solid #cbd5e1',
                      backgroundColor: callVoice === 'fr-FR-DeniseNeural' ? '#eef7ee' : '#ffffff',
                      color: callVoice === 'fr-FR-DeniseNeural' ? '#3d8a43' : '#64748b',
                      cursor: callStatus === 'connected' ? 'default' : 'pointer',
                    }}
                  >
                    👩 Denise
                  </button>
                  <button
                    disabled={callStatus === 'connected'}
                    onClick={() => setCallVoice('fr-FR-HenriNeural')}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '14px',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      border: callVoice === 'fr-FR-HenriNeural' ? '2px solid #0080fe' : '1px solid #cbd5e1',
                      backgroundColor: callVoice === 'fr-FR-HenriNeural' ? '#eff6ff' : '#ffffff',
                      color: callVoice === 'fr-FR-HenriNeural' ? '#0066cc' : '#64748b',
                      cursor: callStatus === 'connected' ? 'default' : 'pointer',
                    }}
                  >
                    👨 Henri
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
                    Parler avec votre Conseiller BANCOBU
                  </h2>
                  <p style={{ color: '#64748b', fontSize: '0.92rem', maxWidth: '520px', margin: '0 auto 26px', lineHeight: 1.55 }}>
                    Lancez un appel en direct pour poser toutes vos questions oralement. Le système écoute et répond en continu en mains-libres, sans avoir besoin d'appuyer sur aucun bouton.
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
                  
                  {/* Visuel dynamique au centre */}
                  <div style={{ minHeight: '130px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '20px' }}>
                    {callAgentState === 'speaking' && (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' }}>
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
                          Le conseiller vous répond oralement...
                        </span>
                      </div>
                    )}

                    {callAgentState === 'listening' && (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' }}>
                        <div className="call-radar" style={{
                          width: '74px',
                          height: '74px',
                          borderRadius: '50%',
                          backgroundColor: '#eef7ee',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#16a34a',
                          border: '2px solid #86efac'
                        }}>
                          <Mic size={34} />
                        </div>
                        <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#16a34a' }}>
                          À vous la parole, le conseiller vous écoute...
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

                    {callAgentState === 'idle' && (
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
                          <PhoneCall size={28} />
                        </div>
                        <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#64748b' }}>
                          Ligne active
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
                    {callAgentState === 'listening' ? (
                      <p style={{ fontStyle: callUserSpoken ? 'normal' : 'italic', color: callUserSpoken ? '#1e293b' : '#94a3b8', fontSize: '0.96rem' }}>
                        {callUserSpoken ? `« ${callUserSpoken} »` : "Parlez dans votre microphone..."}
                      </p>
                    ) : (
                      <p style={{ color: '#334155', fontSize: '0.94rem', lineHeight: 1.55 }}>
                        {callAgentSpoken ? `« ${callAgentSpoken} »` : "Connecté au standard BANCOBU."}
                      </p>
                    )}
                  </div>

                  {/* Barre de contrôle d'appel (Raccrocher / Mute) */}
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '16px' }}>
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
                        {item.role === 'user' ? 'Vous' : `Conseiller BANCOBU (${callVoice.includes('Denise') ? 'Denise' : 'Henri'})`}
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
                    <span style={{ fontSize: '0.82rem', color: '#2d3748', fontWeight: 600 }}>Transcription vocale en cours...</span>
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
                  title={isRecording ? "Arrêter l'enregistrement (cliquez pour terminer)" : "Parler au micro"}
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
                      ? "🔴 Enregistrement en cours... Cliquez à nouveau pour envoyer" 
                      : (isTranscribing ? "Transcription vocale..." : "Écrivez ou touchez le micro pour parler...")
                  }
                  value={inputQuestion}
                  onChange={(e) => setInputQuestion(e.target.value)}
                  className="input-text-field"
                  disabled={isLoading || isTranscribing}
                />

                <button
                  type="submit"
                  disabled={!inputQuestion.trim() || isLoading || isTranscribing}
                  className="send-button"
                  style={{
                    cursor: !inputQuestion.trim() || isLoading || isTranscribing ? 'not-allowed' : 'pointer',
                    opacity: !inputQuestion.trim() || isLoading || isTranscribing ? 0.6 : 1,
                  }}
                >
                  <span className="send-button-text">Envoyer</span>
                  <Send size={14} />
                </button>
              </form>

              <div className="chat-disclaimer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', fontSize: '0.72rem', color: '#718096', padding: '0 4px' }}>
                <span>BANCOBU AI • Conseiller Virtuel Officiel</span>
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
