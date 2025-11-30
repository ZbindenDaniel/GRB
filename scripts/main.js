const canvas = document.getElementById('flow-canvas');
const ctx = canvas.getContext('2d', { alpha: true });

const genomeRanges = {
  perception: { min: 28, max: 140 },
  separationWeight: { min: 0.6, max: 2.5 },
  alignmentWeight: { min: 0.5, max: 2.2 },
  cohesionWeight: { min: 0.5, max: 2.2 },
  foodPerception: { min: 16, max: 180 },
  maxSpeed: { min: 0.8, max: 3.6 },
  maxForce: { min: 0.01, max: 0.08 },
};

const state = {
  boids: [],
  foods: [],
  bestPerformer: null,
  pendingFoodSpawns: [],
  settings: {
    boidCount: 420,
    trail: 0.08,
    speedMultiplier: 1,
    foodCount: 36,
    foodDecayRate: 0.002,
    foodReward: 1.2,
    foodDepletionOnEat: 0.5,
    starvationRate: 0.003,
    initialEnergy: 1.0,
    minNeighborsForSafety: 2,
    lonelyDeathChance: 0.008,
    mutationRate: 0.26,
    mutationScale: 0.18,
  },
  frame: 0,
};

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

function normalized(value, min, max) {
  return (value - min) / (max - min);
}

function randomGenome() {
  const genome = Object.fromEntries(
    Object.entries(genomeRanges).map(([key, range]) => [key, range.min + Math.random() * (range.max - range.min)]),
  );
  return applyFoodCohesionTradeoff(genome);
}

function applyFoodCohesionTradeoff(genome) {
  const normalizedFoodPerception = normalized(
    genome.foodPerception,
    genomeRanges.foodPerception.min,
    genomeRanges.foodPerception.max,
  );
  const complementaryCohesion =
    genomeRanges.cohesionWeight.min +
    (1 - normalizedFoodPerception) * (genomeRanges.cohesionWeight.max - genomeRanges.cohesionWeight.min);
  const adjustedCohesion = (genome.cohesionWeight + complementaryCohesion) / 2;
  return { ...genome, cohesionWeight: adjustedCohesion };
}

function mutateGenome(baseGenome) {
  const { mutationRate, mutationScale } = state.settings;
  const mutated = Object.fromEntries(
    Object.entries(genomeRanges).map(([key, range]) => {
      const original = baseGenome[key];
      const shouldMutate = Math.random() < mutationRate;
      const magnitude = shouldMutate ? 1 + (Math.random() * 2 - 1) * mutationScale : 1;
      const mutatedValue = original * magnitude;
      const clamped = Math.min(range.max, Math.max(range.min, mutatedValue));
      return [key, clamped];
    }),
  );

  return applyFoodCohesionTradeoff(mutated);
}

function deriveBoidColor(genome) {
  const r = Math.floor(normalized(genome.separationWeight, genomeRanges.separationWeight.min, genomeRanges.separationWeight.max) * 255);
  const g = Math.floor(normalized(genome.cohesionWeight, genomeRanges.cohesionWeight.min, genomeRanges.cohesionWeight.max) * 255);
  const b = Math.floor(normalized(genome.alignmentWeight, genomeRanges.alignmentWeight.min, genomeRanges.alignmentWeight.max) * 255);
  return `rgba(${r}, ${g}, ${b}, 0.9)`;
}

function queueFoodSpawn(position) {
  if (!position) return;
  state.pendingFoodSpawns.push(position);
  log('Food spawn queued from death', position);
}

function spawnDeathFood(position) {
  try {
    queueFoodSpawn(position);
    const nextFood = createFood();

    if (state.foods.length === 0) {
      state.foods.push(nextFood);
      return;
    }

    if (state.foods.length >= state.settings.foodCount) {
      let weakestIndex = 0;
      for (let i = 1; i < state.foods.length; i += 1) {
        if (state.foods[i].value < state.foods[weakestIndex].value) {
          weakestIndex = i;
        }
      }
      state.foods[weakestIndex] = nextFood;
    } else {
      state.foods.push(nextFood);
    }
  } catch (error) {
    console.error('[boids] Failed to spawn death food', error);
  }
}

function createBoid(base = {}) {
  const { initialEnergy } = state.settings;
  const genome = base.genome ?? randomGenome();
  const nextVx = base.vx ?? (Math.random() - 0.5) * genome.maxSpeed;
  const nextVy = base.vy ?? (Math.random() - 0.5) * genome.maxSpeed;
  const limited = limitVector(nextVx, nextVy, genome.maxSpeed);
  return {
    x: base.x ?? Math.random() * canvas.clientWidth,
    y: base.y ?? Math.random() * canvas.clientHeight,
    vx: limited.x,
    vy: limited.y,
    energy: initialEnergy,
    score: 0,
    lastNeighborCount: 0,
    genome,
    color: deriveBoidColor(genome),
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

function steerToFood(boid) {
  const { foodPerception, maxForce } = boid.genome;
  let target = null;
  let bestValue = 0;

  try {
    for (let i = 0; i < state.foods.length; i += 1) {
      const food = state.foods[i];
      const dx = food.x - boid.x;
      const dy = food.y - boid.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0 && dist <= foodPerception && food.value > bestValue) {
        target = { dx, dy, dist };
        bestValue = food.value;
      }
    }

    if (!target) return { x: 0, y: 0 };

    const desiredX = target.dx / target.dist;
    const desiredY = target.dy / target.dist;
    return limitVector(desiredX, desiredY, maxForce);
  } catch (error) {
    console.error('[boids] Failed to steer toward food', error);
    return { x: 0, y: 0 };
  }
}

function steerBoid(boid, index) {
  const { perception, separationWeight, alignmentWeight, cohesionWeight, maxForce } = boid.genome;
  const { maxSpeed } = boid.genome;

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

function drawBoid(boid) {
  const size = 6;
  const angle = Math.atan2(boid.vy, boid.vx);
  ctx.save();
  ctx.translate(boid.x, boid.y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.strokeStyle = boid.color;
  ctx.moveTo(size, 0);
  ctx.lineTo(-size * 0.8, size * 0.6);
  ctx.lineTo(-size * 0.8, -size * 0.6);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function createFood(position) {
  const fallbackPosition = position ?? state.pendingFoodSpawns.shift();
  const location = fallbackPosition ?? {
    x: Math.random() * canvas.clientWidth,
    y: Math.random() * canvas.clientHeight,
  };
  return {
    ...location,
    value: 1,
  };
}

function seedFood() {
  state.foods = Array.from({ length: state.settings.foodCount }, () => createFood());
  log('Food seeded', { count: state.foods.length });
}

function adjustFoodCount(nextCount) {
  const current = state.foods.length;
  if (nextCount === current) return;

  try {
    if (nextCount > current) {
      const additions = Array.from({ length: nextCount - current }, () => createFood());
      state.foods.push(...additions);
    } else {
      state.foods.length = nextCount;
    }
    log('Food count adjusted', { count: state.foods.length });
  } catch (error) {
    console.error('[boids] Failed to adjust food count', error);
  }
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
  const radius = 3 + food.value * 2;
  ctx.save();
  ctx.beginPath();
  ctx.fillStyle = `rgba(120, 255, 140, ${0.2 + food.value * 0.6})`;
  ctx.strokeStyle = 'rgba(70, 140, 90, 0.7)';
  ctx.arc(food.x, food.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function updateBestPerformerPanel() {
  const container = document.querySelector('[data-best-performer]');
  if (!container) return;

  try {
    if (!state.bestPerformer) {
      container.innerHTML = '<p class="best__empty">No top genome yet—let them evolve.</p>';
      return;
    }

    const { genome, score } = state.bestPerformer;
    const rows = Object.entries(genome)
      .map(
        ([key, value]) => `
          <div class="best__row">
            <span class="best__label">${key}</span>
            <span class="best__value">${value.toFixed(2)}</span>
          </div>`,
      )
      .join('');

    container.innerHTML = `
      <div class="best__summary">
        <span class="best__score-label">Top score</span>
        <span class="best__score">${score.toFixed(2)}</span>
      </div>
      <div class="best__grid">${rows}</div>
    `;
  } catch (error) {
    console.error('[boids] Failed to render best performer', error);
  }
}

function trackBestPerformer(boid) {
  if (!state.bestPerformer || boid.score > state.bestPerformer.score) {
    state.bestPerformer = { vx: boid.vx, vy: boid.vy, score: boid.score, genome: boid.genome };
    log('Best performer updated', { score: boid.score.toFixed(2), genome: boid.genome });
    updateBestPerformerPanel();
  }
}

function tryConsumeFood(boid) {
  const { foodReward, foodDepletionOnEat } = state.settings;
  const { foodPerception } = boid.genome;
  let reward = 0;
  const eatRadius = Math.max(6, Math.min(16, foodPerception * 0.12));
  state.foods = state.foods.map((food) => {
    const dx = food.x - boid.x;
    const dy = food.y - boid.y;
    const dist = Math.hypot(dx, dy);
    if (dist < eatRadius && food.value > 0.05) {
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
  const baseGenome = state.bestPerformer?.genome ?? randomGenome();
  const genome = mutateGenome(baseGenome);
  const velocityJitter = (Math.random() - 0.5) * 0.5;
  const boid = createBoid({
    vx: (state.bestPerformer?.vx ?? (Math.random() - 0.5) * genome.maxSpeed) + velocityJitter,
    vy: (state.bestPerformer?.vy ?? (Math.random() - 0.5) * genome.maxSpeed) - velocityJitter,
    genome,
  });
  log('Boid spawned from best performer', { genome });
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
    const { trail, speedMultiplier } = state.settings;
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
      const { x: foodAx, y: foodAy } = steerToFood(boid);

      boid.lastNeighborCount = neighborCount;
      boid.vx += ax + foodAx;
      boid.vy += ay + foodAy;

      const limited = limitVector(boid.vx, boid.vy, boid.genome.maxSpeed * speedMultiplier);
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
        spawnDeathFood({ x, y });
        log('Boid removed', { frame: state.frame, score: boid.score.toFixed(2) });
        nextBoids.push(spawnFromBest());
        continue;
      }

      drawBoid(boid);
      nextBoids.push(boid);
    }

    state.boids = nextBoids;
  } catch (error) {
    console.error('[boids] Animation step failed', error);
  }

  requestAnimationFrame(step);
}

function renderControls() {
  const container = document.querySelector('[data-control-panel]');
  if (!container) return;

  try {
    container.innerHTML = `
      <div class="slider">
        <div class="slider__header">
          <label for="boid-count">Boid count</label>
          <span class="slider__value" data-output="boidCount">${state.settings.boidCount}</span>
        </div>
        <input id="boid-count" type="range" min="60" max="780" step="10" value="${state.settings.boidCount}" data-control="boidCount" />
      </div>
      <div class="slider">
        <div class="slider__header">
          <label for="speed-scale">Simulation speed</label>
          <span class="slider__value" data-output="speedMultiplier">${state.settings.speedMultiplier.toFixed(2)}×</span>
        </div>
        <input id="speed-scale" type="range" min="0.4" max="2.4" step="0.05" value="${state.settings.speedMultiplier}" data-control="speedMultiplier" />
      </div>
      <div class="slider">
        <div class="slider__header">
          <label for="food-count">Food count</label>
          <span class="slider__value" data-output="foodCount">${state.settings.foodCount}</span>
        </div>
        <input id="food-count" type="range" min="6" max="120" step="2" value="${state.settings.foodCount}" data-control="foodCount" />
      </div>
      <p>Parameters evolve automatically—watch colors shift as separation (red), cohesion (green), and alignment (blue) adapt.</p>
    `;

    const boidInput = container.querySelector('[data-control="boidCount"]');
    const speedInput = container.querySelector('[data-control="speedMultiplier"]');
    const foodInput = container.querySelector('[data-control="foodCount"]');
    const boidOutput = container.querySelector('[data-output="boidCount"]');
    const speedOutput = container.querySelector('[data-output="speedMultiplier"]');
    const foodOutput = container.querySelector('[data-output="foodCount"]');

    boidInput?.addEventListener('input', (event) => {
      const value = Number.parseInt(event.target.value, 10);
      if (Number.isNaN(value)) return;
      state.settings.boidCount = value;
      boidOutput.textContent = value;
      adjustBoidCount(value);
      log('Boid count changed', { value });
    });

    speedInput?.addEventListener('input', (event) => {
      const value = Number.parseFloat(event.target.value);
      if (Number.isNaN(value)) return;
      state.settings.speedMultiplier = value;
      speedOutput.textContent = `${value.toFixed(2)}×`;
      log('Speed multiplier changed', { value });
    });

    foodInput?.addEventListener('input', (event) => {
      const value = Number.parseInt(event.target.value, 10);
      if (Number.isNaN(value)) return;
      state.settings.foodCount = value;
      foodOutput.textContent = value;
      adjustFoodCount(value);
      log('Food count changed', { value });
    });

    log('Control panel rendered');
  } catch (error) {
    console.error('[boids] Failed to render controls', error);
  }
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
    updateBestPerformerPanel();
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
