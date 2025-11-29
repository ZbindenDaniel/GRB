const canvas = document.getElementById('flow-canvas');
const ctx = canvas.getContext('2d', { alpha: true });

const state = {
  particles: [],
  settings: {
    particleCount: 650,
    speed: 0.6,
    curl: 0.0025,
    trail: 0.08,
  },
  frame: 0,
};

const log = (message, extra = {}) => {
  console.info(`[flow-field] ${message}`, extra);
};

function resizeCanvas() {
  const parent = canvas.parentElement;
  canvas.width = parent.clientWidth * devicePixelRatio;
  canvas.height = parent.clientHeight * devicePixelRatio;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(devicePixelRatio, devicePixelRatio);
  ctx.lineWidth = 1;
  log('Canvas resized', { width: canvas.width, height: canvas.height });
}

function createParticles() {
  state.particles = Array.from({ length: state.settings.particleCount }, () => ({
    x: Math.random() * canvas.clientWidth,
    y: Math.random() * canvas.clientHeight,
  }));
  log('Particles seeded', { count: state.particles.length });
}

function pseudoCurlNoise(x, y, time) {
  // Smooth swirling field built from sine waves; deterministic for reproducibility.
  const scale = state.settings.curl;
  const n = Math.sin((x + time) * scale) + Math.cos((y - time) * scale * 1.3);
  const m = Math.cos((y + time) * scale * 0.9) - Math.sin((x - time) * scale * 1.1);
  return Math.atan2(n, m);
}

function step() {
  const { speed, trail } = state.settings;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  state.frame += 1;

  ctx.fillStyle = `rgba(10, 13, 18, ${trail})`;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(110, 199, 255, 0.8)';

  ctx.beginPath();
  state.particles.forEach((p) => {
    const angle = pseudoCurlNoise(p.x, p.y, state.frame);
    p.x += Math.cos(angle) * speed;
    p.y += Math.sin(angle) * speed;

    if (p.x < 0) p.x = w;
    else if (p.x > w) p.x = 0;
    if (p.y < 0) p.y = h;
    else if (p.y > h) p.y = 0;

    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 0.1, p.y + 0.1);
  });
  ctx.stroke();

  requestAnimationFrame(step);
}

function start() {
  try {
    if (!ctx) {
      throw new Error('2D context unavailable');
    }
    resizeCanvas();
    createParticles();
    ctx.fillStyle = 'rgba(10, 13, 18, 1)';
    ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    requestAnimationFrame(step);
    window.addEventListener('resize', resizeCanvas);
    log('Flow field animation started');
  } catch (error) {
    console.error('[flow-field] Failed to start animation', error);
  }
}

start();
