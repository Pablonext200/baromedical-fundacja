(function () {
  const section = document.getElementById('kalendarz');
  if (!section) return;
  const daysEl = document.getElementById('cal-days');
  const slotsEl = document.getElementById('cal-slots');
  const slotsHead = document.getElementById('cal-slots-head');
  const formEl = document.getElementById('cal-form');
  const slotLabelEl = document.getElementById('cal-chosen-slot');
  if (!daysEl || !slotsEl || !formEl) return;

  const DAY_NAMES = ['Nd', 'Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob'];
  const DAY_NAMES_LONG = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
  const MON_SHORT = ['stycz', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
  const MON_LONG = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];

  // Generate next 14 working days (Mon–Fri)
  const days = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  while (days.length < 14) {
    cursor.setDate(cursor.getDate() + 1);
    const dow = cursor.getDay();
    if (dow === 0 || dow === 6) continue;
    days.push(new Date(cursor));
  }

  // Slot times: 09:00–16:30 every 30 min, lunch break 12:30
  const SLOT_TIMES = [
    [9, 0], [9, 30], [10, 0], [10, 30], [11, 0], [11, 30], [12, 0],
    [13, 0], [13, 30], [14, 0], [14, 30], [15, 0], [15, 30], [16, 0], [16, 30],
  ];

  let chosenDate = days[0];
  let chosenSlot = null;

  function pad2(n) { return String(n).padStart(2, '0'); }

  function renderDays() {
    daysEl.innerHTML = '';
    days.forEach((d, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cal-day';
      btn.setAttribute('role', 'tab');
      if (idx === 0) btn.classList.add('active');
      btn.innerHTML =
        '<span class="cal-dow">' + DAY_NAMES[d.getDay()] + '</span>' +
        '<span class="cal-num">' + d.getDate() + '</span>' +
        '<span class="cal-mon">' + MON_SHORT[d.getMonth()] + '</span>';
      btn.addEventListener('click', () => {
        Array.from(daysEl.children).forEach((c) => c.classList.remove('active'));
        btn.classList.add('active');
        chosenDate = d;
        renderSlots();
      });
      daysEl.appendChild(btn);
    });
  }

  function renderSlots() {
    slotsEl.innerHTML = '';
    chosenSlot = null;
    formEl.hidden = true;

    const dateLabel = DAY_NAMES_LONG[chosenDate.getDay()] + ', ' +
      chosenDate.getDate() + ' ' + MON_LONG[chosenDate.getMonth()];
    slotsHead.textContent = 'Dostępne godziny — ' + dateLabel;

    SLOT_TIMES.forEach(([h, m]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cal-slot';
      btn.setAttribute('role', 'option');
      btn.textContent = pad2(h) + ':' + pad2(m);
      btn.addEventListener('click', () => {
        Array.from(slotsEl.children).forEach((c) => c.classList.remove('chosen'));
        btn.classList.add('chosen');
        chosenSlot = formatSlot(chosenDate, h, m);
        slotLabelEl.textContent = chosenSlot;
        formEl.hidden = false;
        setTimeout(() => formEl.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
      });
      slotsEl.appendChild(btn);
    });
  }

  function formatSlot(date, h, m) {
    return date.getDate() + ' ' + MON_LONG[date.getMonth()] + ' (' +
      DAY_NAMES_LONG[date.getDay()] + ') · ' + pad2(h) + ':' + pad2(m);
  }

  renderDays();
  renderSlots();

  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!chosenSlot) return;
    const fd = new FormData(formEl);
    const data = Object.fromEntries(fd.entries());
    data.termin = chosenSlot;

    const submitBtn = formEl.querySelector('button[type="submit"]');
    const submitLabel = submitBtn.querySelector('span');
    const originalLabel = submitLabel.textContent;
    submitBtn.disabled = true;
    submitLabel.textContent = 'Wysyłam…';
    removeBanner();

    try {
      const r = await fetch('/api/booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const result = await r.json();
      showBanner(result, data);
      if (result.ok && !result.waSent && result.waLink) {
        try { window.open(result.waLink, '_blank', 'noopener'); } catch {}
      }
      if (result.ok) {
        formEl.reset();
        formEl.hidden = true;
        Array.from(slotsEl.children).forEach((c) => c.classList.remove('chosen'));
      }
    } catch (err) {
      showBanner({ ok: false, error: String(err) }, data);
    } finally {
      submitBtn.disabled = false;
      submitLabel.textContent = originalLabel;
    }
  });

  function removeBanner() {
    const old = document.getElementById('cal-banner');
    if (old) old.remove();
  }

  function showBanner(result, data) {
    removeBanner();
    const el = document.createElement('div');
    el.id = 'cal-banner';
    el.className = 'cal-banner';
    if (result.ok) {
      el.dataset.state = 'ok';
      const auto = result.waSent
        ? 'Zgłoszenie wysłane automatycznie do rejestracji.'
        : 'Otwarto WhatsApp z gotową wiadomością — kliknij <strong>Wyślij</strong>, by potwierdzić.';
      const reopen = (!result.waSent && result.waLink)
        ? ' <a href="' + result.waLink + '" target="_blank" rel="noopener">Otwórz ponownie ↗</a>'
        : '';
      el.innerHTML = '<strong>Termin zarezerwowany.</strong> ' + escapeHtml(data.termin) +
        '<br/><span style="color:var(--ink-soft)">' + auto + reopen + '</span>';
    } else {
      el.dataset.state = 'err';
      el.innerHTML = '<strong>Nie udało się wysłać zgłoszenia.</strong><br/>' +
        '<span style="color:var(--ink-soft)">Proszę zadzwonić: <a href="tel:+48666688227">+48 666 688 227</a></span>';
    }
    formEl.parentElement.insertBefore(el, formEl);
    setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
})();
