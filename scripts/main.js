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
  foodSpawnAccumulator: 0,
  settings: {
    boidCount: 420,
    trail: 0.08,
    speedMultiplier: 1,
    foodCount: 22,
    foodSpawnPerMinute: 120,
    foodRespawnDelaySeconds: 1.8,
    foodDecayRate: 0.002,
    foodReward: 1.2,
    foodDepletionOnEat: 0.5,
    foodConsumptionPerSecond: 0.2,
    initialEnergy: 1.0,
    minNeighborsForSafety: 2,
    lonelyDeathChance: 0.008,
    mutationRate: 0.26,
    mutationScale: 0.18,
    aggressionThreshold: 0.18,
    aggressionEnergyBonus: 0.4,
    peacefulFoodForReproduction: 2,
    aggressiveFoodForReproduction: 3,
    peacefulReproductionCost: 0.55,
    reproductionEnergyReserve: 0.2,
    reproductionCooldownSeconds: 3,
  },
  frame: 0,
  lastFrameTimestamp: null,
};

const log = (message, extra = {}) => {
  console.info(`[boids] ${message}`, extra);
};

const PEACEFUL_AGGRESSIVE_SEPARATION_BOOST = 2.2;
const AGGRESSION_ATTACK_RECOVERY_DURATION = 1.8;
const AGGRESSION_ATTACK_SPEED_BREAK = 0.22;

function foodNeedMultiplier(boid) {
  try {
    const speedNormalized = normalized(
      boid.genome.maxSpeed,
      genomeRanges.maxSpeed.min,
      genomeRanges.maxSpeed.max,
    );
    const perceptionNormalized = normalized(
      boid.genome.perception,
      genomeRanges.perception.min,
      genomeRanges.perception.max,
    );
    return 1 + (speedNormalized + perceptionNormalized) * 0.5;
  } catch (error) {
    console.error('[boids] Failed to derive food need multiplier', error);
    return 1;
  }
}

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

function deriveAggression(genome) {
  const separationScore = normalized(
    genome.separationWeight,
    genomeRanges.separationWeight.min,
    genomeRanges.separationWeight.max,
  );
  const alignmentPenalty = 1 - normalized(
    genome.alignmentWeight,
    genomeRanges.alignmentWeight.min,
    genomeRanges.alignmentWeight.max,
  );
  const aggression = separationScore * alignmentPenalty;
  return Math.min(1, Math.max(0, aggression));
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
    foodCollected: 0,
    lastNeighborCount: 0,
    lastReproductionFrame: -Infinity,
    attackRecoveryTimer: 0,
    genome,
    color: deriveBoidColor(genome),
    aggression: deriveAggression(genome),
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
  const { aggressionThreshold } = state.settings;

  let total = 0;
  let steerSeparation = { x: 0, y: 0 };
  let steerAlignment = { x: 0, y: 0 };
  let steerCohesion = { x: 0, y: 0 };

  const isBoidPeaceful = boid.aggression <= aggressionThreshold;

  state.boids.forEach((other, i) => {
    if (i === index) return;
    const dx = other.x - boid.x;
    const dy = other.y - boid.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 0 && dist < perception) {
      const invDist = 1 / dist;
      const isOtherAggressive = other.aggression > aggressionThreshold;
      const separationScale = isBoidPeaceful && isOtherAggressive ? PEACEFUL_AGGRESSIVE_SEPARATION_BOOST : 1;

      steerSeparation.x -= dx * invDist * separationScale;
      steerSeparation.y -= dy * invDist * separationScale;

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

function countNeighbors(targetIndex) {
  const target = state.boids[targetIndex];
  if (!target) return 0;

  try {
    let total = 0;
    const { perception } = target.genome;

    state.boids.forEach((other, index) => {
      if (index === targetIndex) return;
      const dx = other.x - target.x;
      const dy = other.y - target.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0 && dist < perception) {
        total += 1;
      }
    });

    return total;
  } catch (error) {
    console.error('[boids] Failed to count neighbors', error);
    return 0;
  }
}

function drawBoid(boid) {
  const size = 6;
  const angle = Math.atan2(boid.vy, boid.vx);
  const isPeaceful = boid.aggression <= state.settings.aggressionThreshold;

  try {
    ctx.save();
    ctx.translate(boid.x, boid.y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.strokeStyle = boid.color;

    if (isPeaceful) {
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.moveTo(size, 0);
      ctx.quadraticCurveTo(-size * 0.2, size * 0.6, -size * 0.8, size * 0.4);
      ctx.quadraticCurveTo(-size, 0, -size * 0.8, -size * 0.4);
      ctx.quadraticCurveTo(-size * 0.2, -size * 0.6, size, 0);
    } else {
      ctx.moveTo(size, 0);
      ctx.lineTo(-size * 0.8, size * 0.6);
      ctx.lineTo(-size * 0.8, -size * 0.6);
      ctx.closePath();
    }

    ctx.stroke();
  } catch (error) {
    console.error('[boids] Failed to draw boid', error);
  } finally {
    ctx.restore();
  }
}

function createFood(position) {
  const fallbackPosition = position ?? null;
  const location = fallbackPosition ?? {
    x: Math.random() * canvas.clientWidth,
    y: Math.random() * canvas.clientHeight,
  };
  return {
    ...location,
    value: 1,
    respawnTimer: 0,
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

  try {
    state.foods = state.foods.map((food) => {
      if (food.value <= 0) return food;

      const nextValue = Math.max(0, food.value - foodDecayRate);
      if (nextValue <= 0) {
        log('Food fully depleted, scheduling respawn', { previousValue: food.value.toFixed(3) });
        return scheduleFoodRespawn(food, 'decay');
      }
      return { ...food, value: nextValue };
    });
  } catch (error) {
    console.error('[boids] Failed to decay food', error);
  }
}

function drawFood(food) {
  if (food.value <= 0) return;
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

    const { genome, foodCollected } = state.bestPerformer;
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
        <span class="best__score-label">Top forager</span>
        <span class="best__score">${foodCollected.toFixed(2)}</span>
      </div>
      <div class="best__grid">${rows}</div>
    `;
  } catch (error) {
    console.error('[boids] Failed to render best performer', error);
  }
}

function trackBestPerformer(boid) {
  if (!state.bestPerformer || boid.foodCollected > state.bestPerformer.foodCollected) {
    state.bestPerformer = {
      vx: boid.vx,
      vy: boid.vy,
      score: boid.score,
      foodCollected: boid.foodCollected,
      genome: boid.genome,
    };
    log('Best forager updated', {
      foodCollected: boid.foodCollected.toFixed(2),
      genome: boid.genome,
    });
    updateBestPerformerPanel();
  }
}

function tryConsumeFood(boid) {
  const { foodReward, foodDepletionOnEat } = state.settings;
  const { foodPerception } = boid.genome;
  let reward = 0;
  let consumed = 0;
  const eatRadius = Math.max(6, Math.min(16, foodPerception * 0.12));
  state.foods = state.foods.map((food) => {
    const dx = food.x - boid.x;
    const dy = food.y - boid.y;
    const dist = Math.hypot(dx, dy);
    if (dist < eatRadius && food.value > 0.05) {
      const bite = Math.min(food.value, foodDepletionOnEat);
      reward += bite * foodReward;
      consumed += bite;
      const remaining = food.value - bite;
      if (remaining <= 0.02) {
        return scheduleFoodRespawn(food, 'consumed');
      }
      return { ...food, value: remaining };
    }
    return food;
  });

  if (reward > 0) {
    boid.energy += reward;
    boid.score += reward;
    boid.foodCollected += consumed;
    trackBestPerformer(boid);
  }
}

function scheduleFoodRespawn(food, reason) {
  try {
    const { foodRespawnDelaySeconds } = state.settings;
    const delay = Math.max(0, foodRespawnDelaySeconds);
    log('Food slot scheduled for respawn', { reason, delay });
    return { ...food, value: 0, respawnTimer: delay };
  } catch (error) {
    console.error('[boids] Failed to schedule food respawn', error);
    return { ...food, value: 0, respawnTimer: 0.5 };
  }
}

function tickFoodRespawn(deltaSeconds) {
  try {
    state.foods = state.foods.map((food) => {
      if (food.value > 0) return food;

      const currentTimer = Number.isFinite(food.respawnTimer)
        ? food.respawnTimer
        : state.settings.foodRespawnDelaySeconds;

      if (!Number.isFinite(currentTimer)) {
        log('Food respawn timer invalid, resetting to default', {
          receivedTimer: food.respawnTimer,
          fallback: state.settings.foodRespawnDelaySeconds,
        });
      }

      const nextTimer = Math.max(0, currentTimer - deltaSeconds);
      if (nextTimer > 0) {
        return { ...food, respawnTimer: nextTimer };
      }

      const respawned = createFood();
      log('Food respawned', { frame: state.frame });
      return respawned;
    });
  } catch (error) {
    console.error('[boids] Failed to process food respawn timers', error);
  }
}

function tickFoodSpawn(deltaSeconds) {
  try {
    const activeFoodCount = state.foods.reduce((count, food) => (food.value > 0 ? count + 1 : count), 0);
    const spawnPerMinute = Math.max(0, state.settings.foodSpawnPerMinute);
    const spawnPerSecond = spawnPerMinute / 60;
    const safeDelta = Math.max(0, deltaSeconds);
    state.foodSpawnAccumulator += spawnPerSecond * safeDelta;

    const maxFood = Math.max(state.settings.foodCount, Math.ceil(spawnPerMinute * 2));
    if (activeFoodCount >= maxFood) {
      state.foodSpawnAccumulator = 0;
      return;
    }

    const toSpawn = Math.min(Math.floor(state.foodSpawnAccumulator), maxFood - activeFoodCount);
    if (toSpawn <= 0) return;

    state.foodSpawnAccumulator -= toSpawn;
    const additions = Array.from({ length: toSpawn }, () => createFood());
    state.foods.push(...additions);
    log('Continuous food spawn', { added: toSpawn, total: state.foods.length, spawnPerMinute });
  } catch (error) {
    console.error('[boids] Failed continuous food spawning', error);
  }
}

function getAvailableFoodStats() {
  try {
    return state.foods.reduce(
      (acc, food) => {
        if (food.value > 0) {
          acc.count += 1;
          acc.totalValue += food.value;
        }
        return acc;
      },
      { count: 0, totalValue: 0 },
    );
  } catch (error) {
    console.error('[boids] Failed to derive food stats', error);
    return { count: 0, totalValue: 0 };
  }
}

function tryAggressiveAttack(boid, index, eliminated) {
  const { aggressionThreshold, foodReward, aggressionEnergyBonus } = state.settings;
  if (boid.aggression <= aggressionThreshold) return;

  try {
    const attackRadius = Math.max(10, boid.genome.perception * 0.22);
    let targetIndex = -1;
    let closestDistance = Number.POSITIVE_INFINITY;
    let targetNeighborCount = 0;

    for (let i = index + 1; i < state.boids.length; i += 1) {
      if (i === index || eliminated.has(i)) continue;
      const target = state.boids[i];
      const dx = target.x - boid.x;
      const dy = target.y - boid.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= 0 || dist >= attackRadius || dist >= closestDistance) continue;

      const neighborCount = countNeighbors(i);
      if (neighborCount < state.settings.minNeighborsForSafety) {
        closestDistance = dist;
        targetIndex = i;
        targetNeighborCount = neighborCount;
      }
    }

    if (targetIndex === -1) return;

    const target = state.boids[targetIndex];
    eliminated.add(targetIndex);
    const bite = foodReward * boid.aggression + aggressionEnergyBonus;
    boid.energy += bite;
    boid.score += bite;
    boid.attackRecoveryTimer = Math.max(
      boid.attackRecoveryTimer ?? 0,
      AGGRESSION_ATTACK_RECOVERY_DURATION,
    );
    trackBestPerformer(boid);
    log('Aggressive attack executed', {
      attacker: index,
      target: targetIndex,
      aggression: boid.aggression.toFixed(2),
      targetNeighbors: targetNeighborCount,
      speedBreak: AGGRESSION_ATTACK_SPEED_BREAK,
    });
  } catch (error) {
    console.error('[boids] Failed aggression handling', error);
  }
}

function tryFoodBasedReproduction(boid, nextBoids) {
  const {
    aggressionThreshold,
    peacefulFoodForReproduction,
    aggressiveFoodForReproduction,
    peacefulReproductionCost,
    reproductionEnergyReserve,
    reproductionCooldownSeconds,
    foodReward,
  } = state.settings;

  try {
    const baseRequirement =
      boid.aggression > aggressionThreshold ? aggressiveFoodForReproduction : peacefulFoodForReproduction;
    const multiplier = foodNeedMultiplier(boid);
    const requiredFood = baseRequirement * multiplier;
    const energyCost = Math.max(peacefulReproductionCost * multiplier, requiredFood * foodReward);
    const hasCollectedEnoughFood = boid.foodCollected >= requiredFood;
    const hasEnergyForOffspring = boid.energy - energyCost >= reproductionEnergyReserve;
    const { count: availableFoodCount, totalValue: availableFoodValue } = getAvailableFoodStats();
    const enoughFoodInWorld = availableFoodCount > 0 && availableFoodValue >= requiredFood * 0.5;
    const framesSinceLastReproduction = state.frame - boid.lastReproductionFrame;
    const cooldownFrames = Math.ceil(reproductionCooldownSeconds * 60);

    if (framesSinceLastReproduction < cooldownFrames) return;

    if (!hasCollectedEnoughFood || !hasEnergyForOffspring || !enoughFoodInWorld) {
      if (!enoughFoodInWorld) {
        log('Reproduction blocked by food scarcity', {
          availableFoodCount,
          availableFoodValue: availableFoodValue.toFixed(2),
          requiredFood: requiredFood.toFixed(2),
        });
      } else if (hasCollectedEnoughFood && !hasEnergyForOffspring) {
        log('Reproduction blocked by low energy reserve', {
          currentEnergy: boid.energy.toFixed(2),
          energyCost: energyCost.toFixed(2),
          reserveRequired: reproductionEnergyReserve.toFixed(2),
        });
      }
      return;
    }

    const offspring = createBoid({
      x: boid.x + (Math.random() - 0.5) * 8,
      y: boid.y + (Math.random() - 0.5) * 8,
      genome: mutateGenome(boid.genome),
    });

    boid.energy -= energyCost;
    boid.foodCollected -= requiredFood;
    boid.lastReproductionFrame = state.frame;
    nextBoids.push(offspring);
    log('Food-based reproduction triggered', {
      frame: state.frame,
      parentEnergy: boid.energy.toFixed(2),
      parentFoodCollected: boid.foodCollected.toFixed(2),
      baseFoodRequired: baseRequirement.toFixed(2),
      foodNeedMultiplier: multiplier.toFixed(2),
      requiredFood: requiredFood.toFixed(2),
      energyCost: energyCost.toFixed(2),
      framesSinceLastReproduction,
      cooldownFrames,
      enoughFoodInWorld,
      offspringAggression: offspring.aggression.toFixed(2),
    });
  } catch (error) {
    console.error('[boids] Failed food-based reproduction', error);
  }
}

function shouldBoidDie(boid, deltaSeconds) {
  const { minNeighborsForSafety, lonelyDeathChance, foodConsumptionPerSecond } = state.settings;
  const consumptionMultiplier = foodNeedMultiplier(boid);
  const effectiveDeltaSeconds = Math.max(deltaSeconds, 0.016);
  const consumption = foodConsumptionPerSecond * consumptionMultiplier;
  boid.energy -= consumption * effectiveDeltaSeconds;
  if (boid.energy <= 0) {
    return { dead: true, reason: 'starvation', consumptionMultiplier };
  }

  if (boid.lastNeighborCount < minNeighborsForSafety) {
    const roll = Math.random();
    if (roll < lonelyDeathChance) {
      return { dead: true, reason: 'lonely death', consumptionMultiplier };
    }
  }
  return { dead: false, reason: null, consumptionMultiplier };
}

function step(timestamp) {
  try {
    const { trail, speedMultiplier } = state.settings;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    state.frame += 1;

    const deltaSeconds = (() => {
      if (state.lastFrameTimestamp === null) {
        state.lastFrameTimestamp = timestamp ?? performance.now();
        return 0;
      }
      const currentTimestamp = timestamp ?? performance.now();
      const delta = Math.max(0, (currentTimestamp - state.lastFrameTimestamp) / 1000);
      state.lastFrameTimestamp = currentTimestamp;
      return delta;
    })();

    ctx.fillStyle = `rgba(10, 13, 18, ${trail})`;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(110, 199, 255, 0.86)';

    decayFood();
    tickFoodRespawn(deltaSeconds);
    tickFoodSpawn(deltaSeconds);
    state.foods.forEach((food) => drawFood(food));

    const nextBoids = [];

    const eliminated = new Set();

    for (let index = 0; index < state.boids.length; index += 1) {
      if (eliminated.has(index)) {
        continue;
      }
      const boid = state.boids[index];
      boid.attackRecoveryTimer = Math.max(0, (boid.attackRecoveryTimer ?? 0) - deltaSeconds);
      const { x, y } = boid;
      const { x: ax, y: ay, neighborCount } = steerBoid(boid, index);
      const { x: foodAx, y: foodAy } = steerToFood(boid);

      boid.lastNeighborCount = neighborCount;
      boid.vx += ax + foodAx;
      boid.vy += ay + foodAy;

      const attackRecoveryScale = boid.attackRecoveryTimer > 0 ? 1 - AGGRESSION_ATTACK_SPEED_BREAK : 1;
      const maxSpeed = boid.genome.maxSpeed * speedMultiplier * attackRecoveryScale;
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
      tryFoodBasedReproduction(boid, nextBoids);
      tryAggressiveAttack(boid, index, eliminated);

      const { dead, reason, consumptionMultiplier } = shouldBoidDie(boid, deltaSeconds);
      if (dead) {
        log('Boid removed', {
          frame: state.frame,
          score: boid.score.toFixed(2),
          reason,
          foodNeedMultiplier: consumptionMultiplier.toFixed(2),
        });
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
    const controls = [
      {
        key: 'boidCount',
        label: 'Boid count',
        min: 60,
        max: 780,
        step: 10,
        format: (value) => value.toFixed(0),
        normalize: (value) => Math.round(value),
        onChange: (value) => adjustBoidCount(Math.round(value)),
      },
      {
        key: 'speedMultiplier',
        label: 'Simulation speed',
        min: 0.4,
        max: 2.4,
        step: 0.05,
        suffix: '×',
        format: (value) => value.toFixed(2),
      },
      {
        key: 'foodCount',
        label: 'Food count',
        min: 6,
        max: 160,
        step: 2,
        format: (value) => value.toFixed(0),
        normalize: (value) => Math.round(value),
        onChange: (value) => adjustFoodCount(Math.round(value)),
      },
      {
        key: 'foodSpawnPerMinute',
        label: 'Food spawn rate',
        min: 0,
        max: 600,
        step: 5,
        suffix: '/min',
        format: (value) => value.toFixed(0),
      },
      {
        key: 'peacefulFoodForReproduction',
        label: 'Peaceful food to reproduce',
        min: 0.5,
        max: 6,
        step: 0.1,
        format: (value) => value.toFixed(2),
      },
      {
        key: 'aggressiveFoodForReproduction',
        label: 'Aggressive food to reproduce',
        min: 0.5,
        max: 6,
        step: 0.1,
        format: (value) => value.toFixed(2),
      },
      {
        key: 'peacefulReproductionCost',
        label: 'Reproduction energy cost',
        min: 0.1,
        max: 2,
        step: 0.05,
        format: (value) => value.toFixed(2),
      },
      {
        key: 'reproductionEnergyReserve',
        label: 'Energy reserve to reproduce',
        min: 0,
        max: 2,
        step: 0.05,
        format: (value) => value.toFixed(2),
      },
      {
        key: 'initialEnergy',
        label: 'Initial energy',
        min: 0.1,
        max: 5,
        step: 0.1,
        format: (value) => value.toFixed(2),
      },
      {
        key: 'foodConsumptionPerSecond',
        label: 'Energy burn per second',
        min: 0.05,
        max: 0.8,
        step: 0.01,
        format: (value) => value.toFixed(3),
      },
    ];

    const buildInput = ({ key, label, min, max, step, suffix, format }) => `
      <div class="control">
        <div class="control__header">
          <label for="${key}">${label}</label>
          <span class="control__value" data-output="${key}">${format(state.settings[key])}${suffix ?? ''}</span>
        </div>
        <input
          class="control__input"
          id="${key}"
          type="number"
          min="${min}"
          max="${max}"
          step="${step}"
          value="${state.settings[key]}"
          data-control="${key}"
        />
      </div>
    `;

    container.innerHTML = `
      ${controls.map((control) => buildInput(control)).join('')}
      <p>
        Parameters evolve automatically—watch colors shift as separation (red), cohesion (green), alignment (blue), and
        reproduction pressure adapt.
      </p>
    `;

    controls.forEach((control) => {
      const input = container.querySelector(`[data-control="${control.key}"]`);
      const output = container.querySelector(`[data-output="${control.key}"]`);
      const formatValue = control.format ?? ((value) => value);
      input?.addEventListener('input', (event) => {
        try {
          const value = Number.parseFloat(event.target.value);
          if (!Number.isFinite(value)) return;
          const clamped = Math.min(Math.max(value, control.min), control.max);
          const normalized = control.normalize ? control.normalize(clamped) : clamped;
          state.settings[control.key] = normalized;
          if (output) {
            output.textContent = `${formatValue(normalized)}${control.suffix ?? ''}`;
          }
          if (control.onChange) {
            control.onChange(normalized);
          }
          log('Control updated', { key: control.key, value: normalized });
        } catch (error) {
          console.error('[boids] Control update failed', error);
        }
      });
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
    log('Peaceful-aggressive separation boost active', {
      multiplier: PEACEFUL_AGGRESSIVE_SEPARATION_BOOST,
    });
    log('Aggression recovery speed break configured', {
      durationSeconds: AGGRESSION_ATTACK_RECOVERY_DURATION,
      speedMultiplier: 1 - AGGRESSION_ATTACK_SPEED_BREAK,
    });
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
