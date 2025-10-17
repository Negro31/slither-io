// ============================================
// SERVER.JS - Crash Fix + Advanced Slither.io AI
// ============================================

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  pingTimeout: 60000,
  pingInterval: 25000,
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 5e5,
  perMessageDeflate: false
});

app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  next();
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', players: Object.keys(players).length, bots: Object.keys(bots).length });
});

const CONFIG = {
  MAP_WIDTH: 3000,
  MAP_HEIGHT: 3000,
  MAP_BORDER: 100,
  FOOD_COUNT: 200,
  BASE_SPEED: 4,
  MIN_SPEED: 2,
  BOOST_MULTIPLIER: 1.8,
  BOOST_DRAIN_RATE: 1,
  SEGMENT_SIZE: 10,
  TICK_RATE: 50,
  SPAWN_MARGIN: 400,
  COLLISION_THRESHOLD: 8,
  MIN_SNAKE_LENGTH: 10,
  DEATH_FOOD_RATIO: 0.3,
  SPEED_DECAY_FACTOR: 0.002
};

let players = {};
let bots = {};
let foods = [];
let lastCleanup = Date.now();
let botIdCounter = 0;
let admins = {};
let botRespawnQueue = [];

const ADMIN_PASSWORD = 'ZarchBabaPro31';

function randomPos(min, max) {
  return Math.floor(Math.random() * (max - min)) + min;
}

function randomColor() {
  const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2'];
  return colors[Math.floor(Math.random() * colors.length)];
}

function initFoods() {
  foods = [];
  const min = CONFIG.MAP_BORDER;
  const max = CONFIG.MAP_WIDTH - CONFIG.MAP_BORDER;
  for (let i = 0; i < CONFIG.FOOD_COUNT; i++) {
    foods.push({
      x: randomPos(min, max),
      y: randomPos(min, max),
      c: randomColor()
    });
  }
}

function findSafeSpawnPosition() {
  const min = CONFIG.SPAWN_MARGIN;
  const max = CONFIG.MAP_WIDTH - CONFIG.SPAWN_MARGIN;
  
  for (let attempts = 0; attempts < 20; attempts++) {
    const x = randomPos(min, max);
    const y = randomPos(min, max);
    
    let isSafe = true;
    const allSnakes = { ...players, ...bots };
    for (let id in allSnakes) {
      if (!allSnakes[id] || !allSnakes[id].alive) continue;
      const otherHead = allSnakes[id].segments[0];
      if (Math.hypot(x - otherHead.x, y - otherHead.y) < 250) {
        isSafe = false;
        break;
      }
    }
    
    if (isSafe) return { x, y };
  }
  
  return { x: CONFIG.MAP_WIDTH / 2, y: CONFIG.MAP_HEIGHT / 2 };
}

function createSnake() {
  const spawnPos = findSafeSpawnPosition();
  const angle = Math.random() * Math.PI * 2;
  const segments = [];
  
  for (let i = 0; i < 15; i++) {
    segments.push({
      x: spawnPos.x - Math.cos(angle) * CONFIG.SEGMENT_SIZE * i,
      y: spawnPos.y - Math.sin(angle) * CONFIG.SEGMENT_SIZE * i
    });
  }
  
  return {
    segments: segments,
    dx: Math.cos(angle),
    dy: Math.sin(angle),
    color: randomColor(),
    alive: true,
    spawnTime: Date.now(),
    boosting: false,
    lastBoostDrain: Date.now()
  };
}

function calculateSpeed(segmentCount, boosting) {
  const baseSpeed = CONFIG.BASE_SPEED - (segmentCount * CONFIG.SPEED_DECAY_FACTOR);
  const speed = Math.max(baseSpeed, CONFIG.MIN_SPEED);
  return boosting ? speed * CONFIG.BOOST_MULTIPLIER : speed;
}

function checkCollision(snake, allPlayers, playerId) {
  if (!snake || !snake.segments || snake.segments.length === 0) return true;
  
  const head = snake.segments[0];
  if (!head) return true;
  
  if (Date.now() - snake.spawnTime < 2000) return false;
  
  if (head.x <= CONFIG.MAP_BORDER + 10 || head.x >= CONFIG.MAP_WIDTH - CONFIG.MAP_BORDER - 10 || 
      head.y <= CONFIG.MAP_BORDER + 10 || head.y >= CONFIG.MAP_HEIGHT - CONFIG.MAP_BORDER - 10) {
    return true;
  }
  
  for (let id in allPlayers) {
    const other = allPlayers[id];
    if (!other || !other.alive || id === playerId || !other.segments) continue;
    
    for (let i = 0; i < other.segments.length; i++) {
      const seg = other.segments[i];
      if (!seg) continue;
      if (Math.hypot(head.x - seg.x, head.y - seg.y) < CONFIG.COLLISION_THRESHOLD) {
        return true;
      }
    }
  }
  
  return false;
}

function checkFoodCollision(snake) {
  if (!snake || !snake.segments || snake.segments.length === 0) return [];
  
  const head = snake.segments[0];
  if (!head) return [];
  
  const eatenIndices = [];
  
  for (let i = 0; i < foods.length; i++) {
    const food = foods[i];
    if (!food) continue;
    if (Math.hypot(head.x - food.x, head.y - food.y) < CONFIG.SEGMENT_SIZE + 4) {
      eatenIndices.push(i);
    }
  }
  
  return eatenIndices;
}

function moveSnake(snake, boosting) {
  if (!snake || !snake.segments || snake.segments.length === 0) return;
  
  const head = snake.segments[0];
  if (!head) return;
  
  const speed = calculateSpeed(snake.segments.length, boosting);
  
  snake.segments.unshift({
    x: head.x + snake.dx * speed,
    y: head.y + snake.dy * speed
  });
  
  if (boosting && snake.segments.length > CONFIG.MIN_SNAKE_LENGTH) {
    const now = Date.now();
    const timeSinceLastDrain = now - snake.lastBoostDrain;
    
    if (timeSinceLastDrain >= 1000) {
      const segmentsToDrain = Math.floor(timeSinceLastDrain / 1000);
      for (let i = 0; i < segmentsToDrain; i++) {
        if (snake.segments.length > CONFIG.MIN_SNAKE_LENGTH) {
          snake.segments.pop();
        }
      }
      snake.lastBoostDrain = now;
    }
  } else {
    snake.lastBoostDrain = Date.now();
  }
  
  snake.segments.pop();
}

function growSnake(snake, count) {
  if (!snake || !snake.segments || snake.segments.length === 0) return;
  
  const tail = snake.segments[snake.segments.length - 1];
  if (!tail) return;
  
  for (let i = 0; i < count; i++) {
    snake.segments.push({ x: tail.x, y: tail.y });
  }
}

function shrinkSnake(snake, count) {
  if (!snake || !snake.segments) return;
  
  for (let i = 0; i < count; i++) {
    if (snake.segments.length > CONFIG.MIN_SNAKE_LENGTH) {
      snake.segments.pop();
    }
  }
}

function cleanupFoods() {
  if (foods.length > CONFIG.FOOD_COUNT * 2) {
    foods = foods.slice(0, Math.floor(CONFIG.FOOD_COUNT * 1.5));
  }
}

// ============================================
// ADVANCED SLITHER.IO AI (Based on competitive bots)
// ============================================

function createBot(name) {
  const botNames = ['AlphaBot', 'BetaBot', 'GammaBot', 'DeltaBot', 'OmegaBot', 'SigmaBot', 'ThetaBot'];
  const botId = 'bot_' + (botIdCounter++);
  const snake = createSnake();
  const botName = name || (botNames[Math.floor(Math.random() * botNames.length)] + botIdCounter);
  
  bots[botId] = {
    id: botId,
    name: botName,
    segments: snake.segments,
    dx: snake.dx,
    dy: snake.dy,
    color: snake.color,
    alive: snake.alive,
    spawnTime: snake.spawnTime,
    score: 15,
    boosting: false,
    lastBoostDrain: Date.now(),
    target: null,
    lastTargetUpdate: Date.now(),
    strategy: 'feed',
    circleAngle: 0,
    shouldRespawn: true,
    pathMemory: [],
    dangerZones: []
  };
  
  return botId;
}

function updateBotAI(botId) {
  const bot = bots[botId];
  if (!bot || !bot.alive || !bot.segments || bot.segments.length === 0) return;
  
  const now = Date.now();
  const head = bot.segments[0];
  if (!head) return;
  
  const allSnakes = { ...players, ...bots };
  
  // Border avoidance - PRIORITY 1
  const borderMargin = 150;
  if (head.x < borderMargin || head.x > CONFIG.MAP_WIDTH - borderMargin ||
      head.y < borderMargin || head.y > CONFIG.MAP_HEIGHT - borderMargin) {
    const centerX = CONFIG.MAP_WIDTH / 2;
    const centerY = CONFIG.MAP_HEIGHT / 2;
    const dx = centerX - head.x;
    const dy = centerY - head.y;
    const len = Math.hypot(dx, dy);
    if (len > 0) {
      bot.dx = dx / len;
      bot.dy = dy / len;
    }
    bot.boosting = false;
    return;
  }
  
  // Update strategy every 200ms
  if (now - bot.lastTargetUpdate > 200) {
    updateAdvancedBotStrategy(bot, allSnakes);
    bot.lastTargetUpdate = now;
  }
  
  if (bot.target) {
    executeBotStrategy(bot, allSnakes);
  }
}

function updateAdvancedBotStrategy(bot, allSnakes) {
  const head = bot.segments[0];
  if (!head) return;
  
  // 1. COLLISION AVOIDANCE - Immediate danger detection
  const immediateThreats = detectImmediateThreats(bot, allSnakes);
  if (immediateThreats.length > 0) {
    bot.strategy = 'evade';
    bot.target = calculateEvasionPath(bot, immediateThreats);
    bot.boosting = bot.segments.length > 20;
    return;
  }
  
  // 2. OPPORTUNITY DETECTION - Vulnerable targets
  const vulnerableTarget = findVulnerableTarget(bot, allSnakes);
  if (vulnerableTarget) {
    bot.strategy = 'kill';
    bot.target = calculateKillPath(bot, vulnerableTarget);
    bot.boosting = shouldBoostForKill(bot, vulnerableTarget);
    return;
  }
  
  // 3. DEFENSIVE PLAY - Larger snakes nearby
  const dangerousSnakes = findDangerousSnakes(bot, allSnakes);
  if (dangerousSnakes.length > 0) {
    bot.strategy = 'defensive';
    bot.target = calculateDefensivePath(bot, dangerousSnakes);
    bot.boosting = false;
    return;
  }
  
  // 4. AGGRESSIVE HUNT - Medium targets
  const huntTarget = findHuntTarget(bot, allSnakes);
  if (huntTarget) {
    bot.strategy = 'hunt';
    bot.target = calculateEncirclementPath(bot, huntTarget);
    bot.boosting = bot.segments.length > 30;
    return;
  }
  
  // 5. FARMING - Collect food efficiently
  bot.strategy = 'farm';
  bot.target = findOptimalFoodCluster(bot);
  bot.boosting = false;
}

// Detect immediate collision threats (within 100px)
function detectImmediateThreats(bot, allSnakes) {
  const head = bot.segments[0];
  const threats = [];
  
  for (let id in allSnakes) {
    const other = allSnakes[id];
    if (!other || id === bot.id || !other.alive || !other.segments) continue;
    
    // Check all segments within danger zone
    for (let i = 0; i < other.segments.length; i++) {
      const seg = other.segments[i];
      if (!seg) continue;
      
      const dist = Math.hypot(seg.x - head.x, seg.y - head.y);
      if (dist < 100) {
        threats.push({ x: seg.x, y: seg.y, dist: dist, snake: other });
      }
    }
  }
  
  return threats;
}

// Calculate safe evasion path using potential field algorithm
function calculateEvasionPath(bot, threats) {
  const head = bot.segments[0];
  let escapeX = 0;
  let escapeY = 0;
  
  // Repulsion from threats
  threats.forEach(threat => {
    const dx = head.x - threat.x;
    const dy = head.y - threat.y;
    const dist = Math.max(threat.dist, 1);
    const force = 1000 / (dist * dist);
    escapeX += dx * force;
    escapeY += dy * force;
  });
  
  // Normalize
  const len = Math.hypot(escapeX, escapeY);
  if (len > 0) {
    return {
      x: head.x + (escapeX / len) * 200,
      y: head.y + (escapeY / len) * 200
    };
  }
  
  return { x: CONFIG.MAP_WIDTH / 2, y: CONFIG.MAP_HEIGHT / 2 };
}

// Find vulnerable targets (boosting or crossing path)
function findVulnerableTarget(bot, allSnakes) {
  const head = bot.segments[0];
  
  for (let id in allSnakes) {
    const other = allSnakes[id];
    if (!other || id === bot.id || !other.alive || !other.segments) continue;
    
    const otherHead = other.segments[0];
    if (!otherHead) continue;
    
    const dist = Math.hypot(otherHead.x - head.x, otherHead.y - head.y);
    
    // Target if boosting (vulnerable) or smaller and close
    if ((other.boosting || other.segments.length < bot.segments.length * 0.6) && dist < 300) {
      return other;
    }
  }
  
  return null;
}

// Calculate kill path - cut them off
function calculateKillPath(bot, target) {
  const botHead = bot.segments[0];
  const targetHead = target.segments[0];
  if (!targetHead) return botHead;
  
  // Predict target movement
  const predX = targetHead.x + target.dx * 100;
  const predY = targetHead.y + target.dy * 100;
  
  // Position in front of them
  return {
    x: predX + target.dx * 50,
    y: predY + target.dy * 50
  };
}

function shouldBoostForKill(bot, target) {
  if (!target || !target.segments) return false;
  const botHead = bot.segments[0];
  const targetHead = target.segments[0];
  if (!targetHead) return false;
  
  const dist = Math.hypot(targetHead.x - botHead.x, targetHead.y - botHead.y);
  return bot.segments.length > 25 && dist < 150;
}

// Find dangerous snakes (larger than 1.3x)
function findDangerousSnakes(bot, allSnakes) {
  const head = bot.segments[0];
  const dangerous = [];
  
  for (let id in allSnakes) {
    const other = allSnakes[id];
    if (!other || id === bot.id || !other.alive || !other.segments) continue;
    
    if (other.segments.length > bot.segments.length * 1.3) {
      const otherHead = other.segments[0];
      if (!otherHead) continue;
      
      const dist = Math.hypot(otherHead.x - head.x, otherHead.y - head.y);
      if (dist < 400) {
        dangerous.push(other);
      }
    }
  }
  
  return dangerous;
}

// Defensive positioning - stay away but collect food
function calculateDefensivePath(bot, dangerousSnakes) {
  const head = bot.segments[0];
  let safeX = 0;
  let safeY = 0;
  
  dangerousSnakes.forEach(threat => {
    const tHead = threat.segments[0];
    if (!tHead) return;
    
    const dx = head.x - tHead.x;
    const dy = head.y - tHead.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 0) {
      safeX += dx / dist;
      safeY += dy / dist;
    }
  });
  
  const len = Math.hypot(safeX, safeY);
  if (len > 0) {
    return {
      x: head.x + (safeX / len) * 150,
      y: head.y + (safeY / len) * 150
    };
  }
  
  return { x: CONFIG.MAP_WIDTH / 2, y: CONFIG.MAP_HEIGHT / 2 };
}

// Hunt target - similar size
function findHuntTarget(bot, allSnakes) {
  const head = bot.segments[0];
  let bestTarget = null;
  let bestScore = -Infinity;
  
  for (let id in allSnakes) {
    const other = allSnakes[id];
    if (!other || id === bot.id || !other.alive || !other.segments) continue;
    
    const sizeRatio = other.segments.length / bot.segments.length;
    if (sizeRatio < 0.5 || sizeRatio > 0.9) continue;
    
    const otherHead = other.segments[0];
    if (!otherHead) continue;
    
    const dist = Math.hypot(otherHead.x - head.x, otherHead.y - head.y);
    if (dist > 500) continue;
    
    const score = (1 / dist) * (1 - sizeRatio);
    if (score > bestScore) {
      bestScore = score;
      bestTarget = other;
    }
  }
  
  return bestTarget;
}

// Encirclement - circle around target
function calculateEncirclementPath(bot, prey) {
  const botHead = bot.segments[0];
  const preyHead = prey.segments[0];
  if (!preyHead) return botHead;
  
  bot.circleAngle += 0.2;
  const radius = 80;
  
  return {
    x: preyHead.x + Math.cos(bot.circleAngle) * radius,
    y: preyHead.y + Math.sin(bot.circleAngle) * radius
  };
}

// Find dense food clusters
function findOptimalFoodCluster(bot) {
  const head = bot.segments[0];
  let bestCluster = null;
  let bestDensity = 0;
  
  const searchRadius = 200;
  const gridSize = 100;
  
  for (let gx = 0; gx < CONFIG.MAP_WIDTH; gx += gridSize) {
    for (let gy = 0; gy < CONFIG.MAP_HEIGHT; gy += gridSize) {
      let density = 0;
      
      for (let food of foods) {
        if (!food) continue;
        const dist = Math.hypot(food.x - gx, food.y - gy);
        if (dist < searchRadius) {
          density++;
        }
      }
      
      if (density > bestDensity) {
        bestDensity = density;
        bestCluster = { x: gx, y: gy };
      }
    }
  }
  
  return bestCluster || head;
}

function executeBotStrategy(bot, allSnakes) {
  const head = bot.segments[0];
  if (!head || !bot.target) return;
  
  const dx = bot.target.x - head.x;
  const dy = bot.target.y - head.y;
  const len = Math.hypot(dx, dy);
  
  if (len > 5) {
    bot.dx = dx / len;
    bot.dy = dy / len;
  }
}

// ============================================
// GAME LOOP
// ============================================

function gameLoop() {
  try {
    const now = Date.now();
    
    if (now - lastCleanup > 5000) {
      cleanupFoods();
      lastCleanup = now;
    }
    
    if (botRespawnQueue.length > 0) {
      const toRespawn = botRespawnQueue.shift();
      if (toRespawn && toRespawn.shouldRespawn) {
        createBot(toRespawn.name);
      }
    }
    
    const allSnakes = { ...players, ...bots };
    
    for (let botId in bots) {
      try {
        updateBotAI(botId);
      } catch (err) {
        console.error('Bot AI error:', err);
      }
    }
    
    for (let id in allSnakes) {
      try {
        const entity = allSnakes[id];
        if (!entity || !entity.alive) continue;
        
        moveSnake(entity, entity.boosting);
        
        const eatenFoods = checkFoodCollision(entity);
        if (eatenFoods.length > 0) {
          growSnake(entity, eatenFoods.length);
          entity.score = entity.segments.length;
          
          for (let i = eatenFoods.length - 1; i >= 0; i--) {
            const min = CONFIG.MAP_BORDER;
            const max = CONFIG.MAP_WIDTH - CONFIG.MAP_BORDER;
            foods[eatenFoods[i]] = {
              x: randomPos(min, max),
              y: randomPos(min, max),
              c: randomColor()
            };
          }
        }
        
        if (checkCollision(entity, allSnakes, id)) {
          entity.alive = false;
          
          const deathFoodCount = Math.max(3, Math.floor(entity.segments.length * CONFIG.DEATH_FOOD_RATIO));
          const step = Math.max(1, Math.floor(entity.segments.length / deathFoodCount));
          
          for (let i = 0; i < entity.segments.length; i += step) {
            const seg = entity.segments[i];
            if (!seg) continue;
            if (seg.x > CONFIG.MAP_BORDER && seg.x < CONFIG.MAP_WIDTH - CONFIG.MAP_BORDER &&
                seg.y > CONFIG.MAP_BORDER && seg.y < CONFIG.MAP_HEIGHT - CONFIG.MAP_BORDER) {
              foods.push({
                x: seg.x,
                y: seg.y,
                c: entity.color
              });
            }
          }
          
          if (players[id]) {
            io.to(id).emit('death', entity.score);
            setTimeout(() => { delete players[id]; }, 100);
          } else if (bots[id]) {
            if (bots[id].shouldRespawn) {
              setTimeout(() => {
                botRespawnQueue.push({ name: bots[id].name, shouldRespawn: true });
              }, 3000);
            }
            delete bots[id];
          }
        }
      } catch (err) {
        console.error('Entity loop error:', err);
      }
    }
    
    const state = {
      p: {},
      f: foods.slice(0, 300)
    };
    
    for (let id in allSnakes) {
      try {
        if (allSnakes[id] && allSnakes[id].alive && allSnakes[id].segments) {
          const segments = allSnakes[id].segments;
          const optimizedSegments = segments.length > 50 
            ? segments.filter((_, i) => i % 2 === 0) 
            : segments;
          
          state.p[id] = {
            n: allSnakes[id].name,
            s: optimizedSegments,
            c: allSnakes[id].color,
            sc: allSnakes[id].score,
            b: allSnakes[id].boosting
          };
        }
      } catch (err) {
        console.error('State generation error:', err);
      }
    }
    
    io.volatile.emit('gameState', state);
    
  } catch (err) {
    console.error('Game loop error:', err);
  }
}

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);
  
  socket.on('join', (playerName) => {
    try {
      const snake = createSnake();
      players[socket.id] = {
        name: playerName || 'Anonymous',
        segments: snake.segments,
        dx: snake.dx,
        dy: snake.dy,
        color: snake.color,
        alive: snake.alive,
        spawnTime: snake.spawnTime,
        score: 15,
        boosting: false,
        lastBoostDrain: Date.now()
      };
      
      socket.emit('init', {
        playerId: socket.id,
        mapWidth: CONFIG.MAP_WIDTH,
        mapHeight: CONFIG.MAP_HEIGHT,
        mapBorder: CONFIG.MAP_BORDER
      });
    } catch (err) {
      console.error('Join error:', err);
    }
  });
  
  socket.on('changeDirection', (direction) => {
    try {
      if (players[socket.id] && players[socket.id].alive) {
        const len = Math.hypot(direction.x, direction.y);
        if (len > 0.1) {
          players[socket.id].dx = direction.x / len;
          players[socket.id].dy = direction.y / len;
        }
      }
    } catch (err) {
      console.error('Direction error:', err);
    }
  });
  
  socket.on('boost', (isBoosting) => {
    try {
      if (players[socket.id] && players[socket.id].alive) {
        players[socket.id].boosting = isBoosting && players[socket.id].segments.length > CONFIG.MIN_SNAKE_LENGTH;
      }
    } catch (err) {
      console.error('Boost error:', err);
    }
  });
  
  socket.on('adminLogin', (password) => {
    if (password === ADMIN_PASSWORD) {
      admins[socket.id] = true;
      socket.emit('adminAccess', true);
    } else {
      socket.emit('adminAccess', false);
    }
  });
  
  socket.on('addBot', () => {
    if (!admins[socket.id]) return;
    try {
      const botId = createBot();
      socket.emit('botCreated', { id: botId, name: bots[botId].name });
    } catch (err) {
      console.error('Add bot error:', err);
    }
  });
  
  socket.on('removeBot', () => {
    if (!admins[socket.id]) return;
    try {
      const botIds = Object.keys(bots);
      if (botIds.length > 0) {
        const botId = botIds[0];
        bots[botId].shouldRespawn = false;
        delete bots[botId];
        socket.emit('botRemoved', botId);
      }
    } catch (err) {
      console.error('Remove bot error:', err);
    }
  });
  
  socket.on('modifyPlayer', (data) => {
    if (!admins[socket.id]) return;
    try {
      const allSnakes = { ...players, ...bots };
      let targetId = null;
      
      for (let id in allSnakes) {
        if (allSnakes[id].name === data.playerName) {
          targetId = id;
          break;
        }
      }
      
      if (targetId && allSnakes[targetId].alive) {
        const amount = parseInt(data.amount);
        if (amount > 0) {
          growSnake(allSnakes[targetId], amount);
        } else {
          shrinkSnake(allSnakes[targetId], Math.abs(amount));
        }
        allSnakes[targetId].score = allSnakes[targetId].segments.length;
      }
    } catch (err) {
      console.error('Modify player error:', err);
    }
  });
  
  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    delete players[socket.id];
    delete admins[socket.id];
  });
});

initFoods();
setInterval(gameLoop, CONFIG.TICK_RATE);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('Server running on port: ' + PORT);
  console.log('Admin password: ' + ADMIN_PASSWORD);
});
