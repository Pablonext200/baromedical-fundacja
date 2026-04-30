document.getElementById('year').textContent = new Date().getFullYear();

/* Wrap each word in hero-title for staggered reveal */
(function splitTitle() {
  const title = document.querySelector('.hero-title');
  if (!title) return;
  const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
  const replacements = [];
  let node;
  while ((node = walker.nextNode())) {
    if (!node.nodeValue.trim()) continue;
    const frag = document.createDocumentFragment();
    node.nodeValue.split(/(\s+)/).forEach((part) => {
      if (!part.trim()) {
        frag.appendChild(document.createTextNode(part));
      } else {
        const span = document.createElement('span');
        span.className = 'word';
        span.textContent = part;
        frag.appendChild(span);
      }
    });
    replacements.push([node, frag]);
  }
  replacements.forEach(([n, f]) => n.parentNode.replaceChild(f, n));
})();

/* Cursor spotlight */
(function spotlight() {
  const el = document.querySelector('.spotlight');
  if (!el || matchMedia('(hover: none)').matches) return;
  let tx = window.innerWidth / 2, ty = window.innerHeight / 2;
  let cx = tx, cy = ty;
  window.addEventListener('pointermove', (e) => { tx = e.clientX; ty = e.clientY; });
  function tick() {
    cx += (tx - cx) * 0.12;
    cy += (ty - cy) * 0.12;
    el.style.setProperty('--mx', cx + 'px');
    el.style.setProperty('--my', cy + 'px');
    requestAnimationFrame(tick);
  }
  tick();
})();

/* Card spotlight (per-card hover gradient) */
document.querySelectorAll('.card').forEach((card) => {
  card.addEventListener('pointermove', (e) => {
    const r = card.getBoundingClientRect();
    card.style.setProperty('--cx', ((e.clientX - r.left) / r.width * 100) + '%');
    card.style.setProperty('--cy', ((e.clientY - r.top) / r.height * 100) + '%');
  });
});

/* Magnetic buttons */
document.querySelectorAll('.btn').forEach((btn) => {
  if (matchMedia('(hover: none)').matches) return;
  btn.addEventListener('pointermove', (e) => {
    const r = btn.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) * 0.18;
    const dy = (e.clientY - (r.top + r.height / 2)) * 0.18;
    btn.style.transform = `translate(${dx}px, ${dy}px)`;
  });
  btn.addEventListener('pointerleave', () => {
    btn.style.transform = '';
  });
});

/* Scroll progress bar */
(function progress() {
  const bar = document.querySelector('.scroll-bar');
  if (!bar) return;
  function update() {
    const h = document.documentElement;
    const max = h.scrollHeight - h.clientHeight;
    const p = max > 0 ? h.scrollTop / max : 0;
    bar.style.setProperty('--p', p);
  }
  document.addEventListener('scroll', update, { passive: true });
  update();
})();

/* HUD active section */
(function hud() {
  const links = document.querySelectorAll('.hud a');
  if (!links.length) return;
  const map = new Map();
  links.forEach((a) => {
    const id = a.getAttribute('href').slice(1);
    const target = document.getElementById(id);
    if (target) map.set(target, a);
  });
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        links.forEach((l) => l.classList.remove('active'));
        const a = map.get(e.target);
        if (a) a.classList.add('active');
      }
    });
  }, { threshold: 0.4 });
  map.forEach((_, t) => io.observe(t));
})();

/* Reveal on scroll */
const reveal = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (e.isIntersecting) {
      e.target.classList.add('in');
      reveal.unobserve(e.target);
    }
  });
}, { threshold: 0.12 });

document.querySelectorAll('.section h2, .section .lead, .section p:not(.section-tag), .card, .quote-card, .stat, .section-tag, .marquee')
  .forEach((el) => { el.classList.add('reveal'); reveal.observe(el); });

/* Hero parallax (orbs follow scroll) */
(function parallax() {
  const orbs = document.querySelectorAll('.orb');
  if (!orbs.length) return;
  document.addEventListener('scroll', () => {
    const y = window.scrollY;
    orbs.forEach((o, i) => {
      o.style.translate = `0 ${y * (0.15 + i * 0.05)}px`;
    });
  }, { passive: true });
})();

/* Animated counters */
(function counters() {
  const els = document.querySelectorAll('[data-counter]');
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const el = e.target;
      const target = parseFloat(el.dataset.counter);
      const suffix = el.dataset.suffix || '';
      const dur = 1400;
      const start = performance.now();
      function step(now) {
        const t = Math.min(1, (now - start) / dur);
        const eased = 1 - Math.pow(1 - t, 3);
        const val = target * eased;
        el.textContent = (Number.isInteger(target) ? Math.round(val) : val.toFixed(1)) + suffix;
        if (t < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
      io.unobserve(el);
    });
  }, { threshold: 0.4 });
  els.forEach((el) => io.observe(el));
})();
