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
  let ringCtx = null;
  let ringInterval = null;

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
      startRingTone();

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
        stopRingTone();
        connectChime();
        setStatus('Słucham…', 'listening');
        sendGreeting();
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
      stopRingTone();
      setStatus('Błąd: ' + (err.message || 'spróbuj ponownie'), 'error');
      startBtn.disabled = false;
      endCall();
    }
  }

  function endCall() {
    stopRingTone();
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
      // Tool call may arrive inside response.output items
      const out = ev.response && ev.response.output;
      if (Array.isArray(out)) {
        out.forEach((item) => {
          if (item.type === 'function_call') handleToolCall(item);
        });
      }
    } else if (ev.type === 'input_audio_buffer.speech_started') {
      setStatus('Słyszę cię…', 'listening');
    } else if (ev.type === 'input_audio_buffer.speech_stopped') {
      setStatus('Myślę…', 'thinking');
    } else if (ev.type === 'error') {
      setStatus('Błąd: ' + (ev.error?.message || 'nieznany'), 'error');
      console.error(ev);
    }
  }

  async function handleToolCall(item) {
    if (item.name !== 'zapisz_pacjenta_na_konsultacje') return;
    let args = {};
    try { args = JSON.parse(item.arguments || '{}'); } catch {}

    showBookingBanner({ state: 'sending', data: args });

    let result = { ok: false };
    try {
      const r = await fetch('/api/booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
      result = await r.json();
    } catch (e) {
      result = { ok: false, error: String(e) };
    }

    if (result.ok && !result.waSent && result.waLink) {
      try { window.open(result.waLink, '_blank', 'noopener'); } catch {}
    }

    showBookingBanner({
      state: result.ok ? 'sent' : 'error',
      data: args,
      waSent: !!result.waSent,
      waLink: result.waLink,
    });

    // Send result back to model
    try {
      dc.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: item.call_id,
          output: JSON.stringify({
            ok: !!result.ok,
            wyslano_whatsapp: !!result.waSent,
            link_zapasowy: result.waLink || null,
            blad: result.error || null,
          }),
        },
      }));
      dc.send(JSON.stringify({ type: 'response.create' }));
    } catch (e) {
      console.error('tool result send', e);
    }
  }

  function showBookingBanner({ state, data, waSent, waLink }) {
    let el = document.getElementById('assist-booking');
    if (!el) {
      el = document.createElement('div');
      el.id = 'assist-booking';
      el.className = 'assist-booking';
      transcript.parentElement.insertBefore(el, transcript);
    }
    const close = '<button class="assist-booking-x" aria-label="Zamknij" onclick="this.parentElement.remove()">×</button>';
    if (state === 'sending') {
      el.dataset.state = 'sending';
      el.innerHTML = `<div class="assist-booking-row"><span class="dot"></span><strong>Wysyłam zgłoszenie…</strong> <span class="muted">${data.imie || ''} ${data.nazwisko || ''}</span></div>${close}`;
    } else if (state === 'sent') {
      el.dataset.state = 'sent';
      const auto = waSent
        ? '<span class="muted">WhatsApp wysłany automatycznie do rejestracji.</span>'
        : `<span class="muted">Otwarto WhatsApp z gotową wiadomością — kliknij <strong>Wyślij</strong>.</span>${waLink ? ` <a href="${waLink}" target="_blank" rel="noopener">Otwórz ponownie ↗</a>` : ''}`;
      el.innerHTML = `<div class="assist-booking-row"><span class="dot ok"></span><strong>Zgłoszenie zapisane</strong></div><div class="assist-booking-meta">${data.imie} ${data.nazwisko} · ${data.telefon}${data.email ? ' · ' + data.email : ''}</div><div class="assist-booking-meta">${auto}</div>${close}`;
    } else {
      el.dataset.state = 'error';
      el.innerHTML = `<div class="assist-booking-row"><span class="dot err"></span><strong>Nie udało się wysłać</strong></div><div class="assist-booking-meta">Proszę zadzwonić: <a href="tel:+48666688227">+48 666 688 227</a></div>${close}`;
    }
  }

  function startRingTone() {
    if (ringCtx || ringInterval) return;
    try {
      ringCtx = new (window.AudioContext || window.webkitAudioContext)();
      const playRing = () => {
        if (!ringCtx) return;
        const t0 = ringCtx.currentTime;
        [440, 480].forEach((freq) => {
          const osc = ringCtx.createOscillator();
          const g = ringCtx.createGain();
          osc.type = 'sine';
          osc.frequency.value = freq;
          g.gain.setValueAtTime(0, t0);
          g.gain.linearRampToValueAtTime(0.10, t0 + 0.04);
          g.gain.linearRampToValueAtTime(0.10, t0 + 0.42);
          g.gain.linearRampToValueAtTime(0, t0 + 0.5);
          osc.connect(g); g.connect(ringCtx.destination);
          osc.start(t0);
          osc.stop(t0 + 0.55);
        });
      };
      playRing();
      ringInterval = setInterval(playRing, 1500);
    } catch (e) {
      console.warn('ring tone failed', e);
    }
  }

  function stopRingTone() {
    if (ringInterval) { clearInterval(ringInterval); ringInterval = null; }
    if (ringCtx) { try { ringCtx.close(); } catch {} ringCtx = null; }
  }

  function connectChime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const t0 = ctx.currentTime;
      // Pleasant 3-note ascending arpeggio (C5, E5, G5)
      [523.25, 659.25, 783.99].forEach((freq, i) => {
        const start = t0 + i * 0.09;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0, start);
        g.gain.linearRampToValueAtTime(0.16, start + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, start + 0.45);
        osc.connect(g); g.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.5);
      });
      setTimeout(() => { try { ctx.close(); } catch {} }, 900);
    } catch (e) {
      console.warn('chime failed', e);
    }
  }

  function sendGreeting() {
    setTimeout(() => {
      if (!dc || dc.readyState !== 'open') return;
      try {
        dc.send(JSON.stringify({
          type: 'response.create',
          response: {
            modalities: ['audio', 'text'],
            instructions: 'Przywitaj użytkownika TERAZ — krótko (2-3 zdania), ciepło i naturalnie. Powiedz: "Cześć, jestem Tlenia, doradczyni Fundacji Baromedical." Następnie jednym płynnym zdaniem wymień, w czym możesz pomóc — np. wskazania do tlenoterapii hiperbarycznej, jak działa terapia, kliniki w Polsce, umówienie konsultacji. Zakończ otwartym pytaniem, np. "O czym chciałbyś porozmawiać?" lub "W czym mogę dziś pomóc?". Mów płynnie, jak człowiek — bez wyliczania listy z numerami.'
          }
        }));
      } catch (e) { console.error('greeting send', e); }
    }, 280);
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
