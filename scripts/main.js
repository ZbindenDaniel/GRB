const canvas = document.getElementById('flow-canvas');
const ctx = canvas.getContext('2d', { alpha: true });

const state = {
  boids: [],
  foods: [],
  bestPerformer: null,
  settings: {
    boidCount: 420,
    maxSpeed: 2.4,
    maxForce: 0.04,
    perception: 72,
    separationWeight: 1.4,
    alignmentWeight: 1.0,
    cohesionWeight: 0.8,
    trail: 0.08,
    foodCount: 36,
    foodDecayRate: 0.002,
    foodReward: 1.2,
    foodDepletionOnEat: 0.5,
    starvationRate: 0.003,
    initialEnergy: 1.0,
    minNeighborsForSafety: 2,
    lonelyDeathChance: 0.008,
  },
  frame: 0,
};

const controlDefinitions = [
  { key: 'boidCount', label: 'Boid count', min: 150, max: 900, step: 10, format: (v) => Math.round(v) },
  { key: 'maxSpeed', label: 'Max speed', min: 0.6, max: 4, step: 0.1, format: (v) => v.toFixed(1) },
  { key: 'maxForce', label: 'Steering force', min: 0.005, max: 0.12, step: 0.005, format: (v) => v.toFixed(3) },
  { key: 'perception', label: 'Perception radius', min: 24, max: 140, step: 2, format: (v) => Math.round(v) },
  { key: 'separationWeight', label: 'Separation', min: 0.5, max: 2.5, step: 0.1, format: (v) => v.toFixed(1) },
  { key: 'alignmentWeight', label: 'Alignment', min: 0.4, max: 2.2, step: 0.1, format: (v) => v.toFixed(1) },
  { key: 'cohesionWeight', label: 'Cohesion', min: 0.4, max: 2.2, step: 0.1, format: (v) => v.toFixed(1) },
];

const log = (message, extra = {}) => {
  console.info(`[boids] ${message}`, extra);
};

function resizeCanvas() {
  const parent = canvas.parentElement;
  canvas.width = parent.clientWidth * devicePixelRatio;
  canvas.height = parent.clientHeight * devicePixelRatio;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(devicePixelRatio, devicePixelRatio);
  ctx.lineWidth = 1.2;
  log('Canvas resized', { width: canvas.width, height: canvas.height });
}

function createBoid(base = {}) {
  const { maxSpeed, initialEnergy } = state.settings;
  const nextVx = base.vx ?? (Math.random() - 0.5) * maxSpeed;
  const nextVy = base.vy ?? (Math.random() - 0.5) * maxSpeed;
  const limited = limitVector(nextVx, nextVy, maxSpeed);
  return {
    x: Math.random() * canvas.clientWidth,
    y: Math.random() * canvas.clientHeight,
    vx: limited.x,
    vy: limited.y,
    energy: initialEnergy,
    score: 0,
    lastNeighborCount: 0,
  };
}

function seedBoids() {
  state.boids = Array.from({ length: state.settings.boidCount }, () => createBoid());
  log('Boids seeded', { count: state.boids.length });
}

function adjustBoidCount(nextCount) {
  const current = state.boids.length;
  if (nextCount === current) return;

  if (nextCount > current) {
    const toAdd = nextCount - current;
    const additions = Array.from({ length: toAdd }, () => createBoid());
    state.boids.push(...additions);
  } else {
    state.boids.length = nextCount;
  }
  log('Boid count adjusted', { count: state.boids.length });
}

function limitVector(x, y, max) {
  const mag = Math.hypot(x, y);
  if (mag > max) {
    const scale = max / mag;
    return { x: x * scale, y: y * scale };
  }
  return { x, y };
}

function steerBoid(boid, index) {
  const {
    perception,
    separationWeight,
    alignmentWeight,
    cohesionWeight,
    maxSpeed,
    maxForce,
  } = state.settings;

  let total = 0;
  let steerSeparation = { x: 0, y: 0 };
  let steerAlignment = { x: 0, y: 0 };
  let steerCohesion = { x: 0, y: 0 };

  state.boids.forEach((other, i) => {
    if (i === index) return;
    const dx = other.x - boid.x;
    const dy = other.y - boid.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 0 && dist < perception) {
      const invDist = 1 / dist;
      steerSeparation.x -= dx * invDist;
      steerSeparation.y -= dy * invDist;

      steerAlignment.x += other.vx;
      steerAlignment.y += other.vy;

      steerCohesion.x += other.x;
      steerCohesion.y += other.y;
      total += 1;
    }
  });

  if (total > 0) {
    steerSeparation = limitVector(steerSeparation.x / total, steerSeparation.y / total, maxForce);

    steerAlignment = limitVector(
      steerAlignment.x / total - boid.vx,
      steerAlignment.y / total - boid.vy,
      maxForce,
    );

    steerCohesion = limitVector(
      steerCohesion.x / total - boid.x,
      steerCohesion.y / total - boid.y,
      maxForce,
    );
  }

  const ax =
    steerSeparation.x * separationWeight +
    steerAlignment.x * alignmentWeight +
    steerCohesion.x * cohesionWeight;
  const ay =
    steerSeparation.y * separationWeight +
    steerAlignment.y * alignmentWeight +
    steerCohesion.y * cohesionWeight;

  const limited = limitVector(ax, ay, maxForce);
  return { ...limited, neighborCount: total };
}

function drawBoid(x, y, angle) {
  const size = 6;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(-size * 0.8, size * 0.6);
  ctx.lineTo(-size * 0.8, -size * 0.6);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function createFood() {
  return {
    x: Math.random() * canvas.clientWidth,
    y: Math.random() * canvas.clientHeight,
    value: 1,
  };
}

function seedFood() {
  state.foods = Array.from({ length: state.settings.foodCount }, () => createFood());
  log('Food seeded', { count: state.foods.length });
}

function decayFood() {
  const { foodDecayRate } = state.settings;
  state.foods = state.foods.map((food) => {
    const nextValue = Math.max(0, food.value - foodDecayRate);
    if (nextValue === 0) {
      return createFood();
    }
    return { ...food, value: nextValue };
  });
}

function drawFood(food) {
  const radius = 5 + food.value * 4;
  ctx.save();
  ctx.beginPath();
  ctx.fillStyle = `rgba(120, 255, 140, ${0.2 + food.value * 0.6})`;
  ctx.strokeStyle = 'rgba(70, 140, 90, 0.7)';
  ctx.arc(food.x, food.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function trackBestPerformer(boid) {
  if (!state.bestPerformer || boid.score > state.bestPerformer.score) {
    state.bestPerformer = { vx: boid.vx, vy: boid.vy, score: boid.score };
    log('Best performer updated', { score: boid.score.toFixed(2) });
  }
}

function tryConsumeFood(boid) {
  const { foodReward, foodDepletionOnEat } = state.settings;
  let reward = 0;
  state.foods = state.foods.map((food) => {
    const dx = food.x - boid.x;
    const dy = food.y - boid.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 14 && food.value > 0.05) {
      const bite = Math.min(food.value, foodDepletionOnEat);
      reward += bite * foodReward;
      const remaining = food.value - bite;
      if (remaining <= 0.02) {
        return createFood();
      }
      return { ...food, value: remaining };
    }
    return food;
  });

  if (reward > 0) {
    boid.energy += reward;
    boid.score += reward;
    trackBestPerformer(boid);
  }
}

function spawnFromBest() {
  const base = state.bestPerformer || { vx: (Math.random() - 0.5) * state.settings.maxSpeed, vy: (Math.random() - 0.5) * state.settings.maxSpeed };
  const jitter = (Math.random() - 0.5) * 0.5;
  const boid = createBoid({ vx: base.vx + jitter, vy: base.vy - jitter });
  log('Boid spawned from best performer');
  return boid;
}

function shouldBoidDie(boid) {
  const { minNeighborsForSafety, lonelyDeathChance, starvationRate } = state.settings;
  boid.energy -= starvationRate;
  if (boid.energy <= 0) {
    return true;
  }

  if (boid.lastNeighborCount < minNeighborsForSafety) {
    const roll = Math.random();
    if (roll < lonelyDeathChance) {
      return true;
    }
  }
  return false;
}

function step() {
  try {
    const { maxSpeed, trail } = state.settings;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    state.frame += 1;

    ctx.fillStyle = `rgba(10, 13, 18, ${trail})`;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(110, 199, 255, 0.86)';

    decayFood();
    state.foods.forEach((food) => drawFood(food));

    const nextBoids = [];

    for (let index = 0; index < state.boids.length; index += 1) {
      const boid = state.boids[index];
      const { x, y } = boid;
      const { x: ax, y: ay, neighborCount } = steerBoid(boid, index);

      boid.lastNeighborCount = neighborCount;
      boid.vx += ax;
      boid.vy += ay;

      const limited = limitVector(boid.vx, boid.vy, maxSpeed);
      boid.vx = limited.x;
      boid.vy = limited.y;

      boid.x += boid.vx;
      boid.y += boid.vy;

      if (boid.x < 0) boid.x = w;
      else if (boid.x > w) boid.x = 0;
      if (boid.y < 0) boid.y = h;
      else if (boid.y > h) boid.y = 0;

      tryConsumeFood(boid);

      if (shouldBoidDie(boid)) {
        log('Boid removed', { frame: state.frame, score: boid.score.toFixed(2) });
        nextBoids.push(spawnFromBest());
        continue;
      }

      const angle = Math.atan2(boid.vy, boid.vx);
      drawBoid(boid.x, boid.y, angle);
      nextBoids.push(boid);
    }

    state.boids = nextBoids;
  } catch (error) {
    console.error('[boids] Animation step failed', error);
  }

  requestAnimationFrame(step);
}

function handleControlChange(event) {
  const { name, value } = event.target;
  const parsed = parseFloat(value);
  if (Number.isNaN(parsed)) return;

  state.settings[name] = parsed;
  if (name === 'boidCount') {
    adjustBoidCount(Math.round(parsed));
  }

  const display = document.querySelector(`[data-display="${name}"]`);
  const definition = controlDefinitions.find((c) => c.key === name);
  if (display && definition) {
    display.textContent = definition.format(parsed);
  }
  log('Control updated', { [name]: parsed });
}

function renderControls() {
  const container = document.querySelector('[data-control-panel]');
  if (!container) return;

  const fragment = document.createDocumentFragment();
  controlDefinitions.forEach((control) => {
    const wrapper = document.createElement('label');
    wrapper.className = 'slider';
    wrapper.innerHTML = `
      <div class="slider__header">
        <span>${control.label}</span>
        <span class="slider__value" data-display="${control.key}">${control.format(
      state.settings[control.key],
    )}</span>
      </div>
      <input
        type="range"
        name="${control.key}"
        min="${control.min}"
        max="${control.max}"
        step="${control.step}"
        value="${state.settings[control.key]}"
        aria-label="${control.label}"
      />
    `;
    const input = wrapper.querySelector('input');
    input.addEventListener('input', handleControlChange);
    fragment.appendChild(wrapper);
  });

  container.innerHTML = '';
  container.appendChild(fragment);
  log('Controls rendered');
}

function start() {
  try {
    if (!ctx) {
      throw new Error('2D context unavailable');
    }
    resizeCanvas();
    seedBoids();
    seedFood();
    renderControls();
    ctx.fillStyle = 'rgba(10, 13, 18, 1)';
    ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    requestAnimationFrame(step);
    window.addEventListener('resize', resizeCanvas);
    log('Boid simulation started');
  } catch (error) {
    console.error('[boids] Failed to start simulation', error);
  }
}

start();
