(function () {
  const section = document.getElementById('asystent');
  const startBtn = document.getElementById('assist-start');
  const endBtn = document.getElementById('assist-end');
  const muteBtn = document.getElementById('assist-mute');
  const status = document.getElementById('assist-status');
  const orb = document.getElementById('assist-orb');
  const transcript = document.getElementById('assist-transcript');
  const audioEl = document.getElementById('assist-audio');
  if (!section || !startBtn) return;

  let pc = null;
  let dc = null;
  let micStream = null;
  let analyser = null;
  let rafId = null;
  let micTrack = null;
  let muted = false;

  function setStatus(text, state) {
    status.textContent = text;
    section.dataset.state = state || '';
  }

  function appendTranscript(role, text) {
    if (!text) return;
    const line = document.createElement('div');
    line.className = `t-line t-${role}`;
    line.textContent = text;
    transcript.appendChild(line);
    transcript.scrollTop = transcript.scrollHeight;
  }

  async function startCall() {
    if (pc) return;
    try {
      setStatus('Łączę…', 'connecting');
      startBtn.disabled = true;
      transcript.innerHTML = '';

      const tokenResp = await fetch('/api/realtime-token', { method: 'POST' });
      if (!tokenResp.ok) {
        const err = await tokenResp.json().catch(() => ({}));
        throw new Error(err.error || `Token error ${tokenResp.status}`);
      }
      const session = await tokenResp.json();
      const ephemeralKey = session.client_secret?.value;
      if (!ephemeralKey) throw new Error('Brak ephemeral key w odpowiedzi.');

      pc = new RTCPeerConnection();

      pc.ontrack = (e) => {
        audioEl.srcObject = e.streams[0];
        setupAudioAnalyser(e.streams[0]);
      };

      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      micTrack = micStream.getAudioTracks()[0];
      pc.addTrack(micTrack, micStream);

      dc = pc.createDataChannel('oai-events');
      dc.addEventListener('open', () => {
        setStatus('Słucham…', 'listening');
      });
      dc.addEventListener('message', (e) => {
        try {
          const ev = JSON.parse(e.data);
          handleEvent(ev);
        } catch {}
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const model = 'gpt-4o-realtime-preview-2024-12-17';
      const sdpResp = await fetch(`https://api.openai.com/v1/realtime?model=${model}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ephemeralKey}`,
          'Content-Type': 'application/sdp',
        },
        body: offer.sdp,
      });
      if (!sdpResp.ok) throw new Error(`SDP exchange ${sdpResp.status}`);
      const answer = { type: 'answer', sdp: await sdpResp.text() };
      await pc.setRemoteDescription(answer);

      endBtn.disabled = false;
      muteBtn.disabled = false;
    } catch (err) {
      console.error(err);
      setStatus('Błąd: ' + (err.message || 'spróbuj ponownie'), 'error');
      startBtn.disabled = false;
      endCall();
    }
  }

  function endCall() {
    cancelAnimationFrame(rafId);
    if (dc) { try { dc.close(); } catch {} dc = null; }
    if (pc) { try { pc.close(); } catch {} pc = null; }
    if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
    micTrack = null;
    analyser = null;
    audioEl.srcObject = null;
    orb.style.setProperty('--level', 0);
    startBtn.disabled = false;
    endBtn.disabled = true;
    muteBtn.disabled = true;
    muted = false;
    muteBtn.classList.remove('muted');
    if (section.dataset.state !== 'error') setStatus('Kliknij, by rozpocząć rozmowę', 'idle');
  }

  function toggleMute() {
    if (!micTrack) return;
    muted = !muted;
    micTrack.enabled = !muted;
    muteBtn.classList.toggle('muted', muted);
    muteBtn.querySelector('.label').textContent = muted ? 'Włącz mikrofon' : 'Wycisz';
  }

  startBtn.addEventListener('click', startCall);
  endBtn.addEventListener('click', endCall);
  muteBtn.addEventListener('click', toggleMute);

  function setupAudioAnalyser(stream) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    function tick() {
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const avg = sum / data.length / 255;
      orb.style.setProperty('--level', avg.toFixed(3));
      rafId = requestAnimationFrame(tick);
    }
    tick();
  }

  function handleEvent(ev) {
    if (ev.type === 'response.audio_transcript.delta') {
      appendDelta('ai', ev.delta);
    } else if (ev.type === 'response.audio_transcript.done') {
      finalize('ai');
    } else if (ev.type === 'conversation.item.input_audio_transcription.completed') {
      appendTranscript('user', ev.transcript);
    } else if (ev.type === 'response.created') {
      setStatus('Mówię…', 'speaking');
    } else if (ev.type === 'response.done') {
      setStatus('Słucham…', 'listening');
      finalize('ai');
    } else if (ev.type === 'input_audio_buffer.speech_started') {
      setStatus('Słyszę cię…', 'listening');
    } else if (ev.type === 'input_audio_buffer.speech_stopped') {
      setStatus('Myślę…', 'thinking');
    } else if (ev.type === 'error') {
      setStatus('Błąd: ' + (ev.error?.message || 'nieznany'), 'error');
      console.error(ev);
    }
  }

  let aiBuffer = '';
  let aiLine = null;
  function appendDelta(role, delta) {
    if (!delta) return;
    aiBuffer += delta;
    if (!aiLine) {
      aiLine = document.createElement('div');
      aiLine.className = 't-line t-ai';
      transcript.appendChild(aiLine);
    }
    aiLine.textContent = aiBuffer;
    transcript.scrollTop = transcript.scrollHeight;
  }
  function finalize(role) {
    aiBuffer = '';
    aiLine = null;
  }
})();
