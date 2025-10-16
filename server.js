// ============================================
// SERVER.JS - Fixed Boost + Admin Panel + AI Bots
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
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 1e6
});

app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', players: Object.keys(players).length });
});

const CONFIG = {
  MAP_WIDTH: 3000,
  MAP_HEIGHT: 3000,
  MAP_BORDER: 100,
  FOOD_COUNT: 250,
  BASE_SPEED: 4,
  MIN_SPEED: 2,
  BOOST_MULTIPLIER: 1.8,
  BOOST_DRAIN_RATE: 1, // Saniyede kac segment azalsın
  SEGMENT_SIZE: 10,
  TICK_RATE: 30, // 33 FPS server (daha az gecikme)
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
let admins = {}; // Admin yetkisi olan socketler

const ADMIN_PASSWORD = 'ZarchBabaPro31';

function randomPos(max) {
  return Math.floor(Math.random() * max);
}

function randomColor() {
  const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2'];
  return colors[Math.floor(Math.random() * colors.length)];
}

function initFoods() {
  foods = [];
  for (let i = 0; i < CONFIG.FOOD_COUNT; i++) {
    foods.push({
      x: randomPos(CONFIG.MAP_WIDTH - CONFIG.MAP_BORDER * 2) + CONFIG.MAP_BORDER,
      y: randomPos(CONFIG.MAP_HEIGHT - CONFIG.MAP_BORDER * 2) + CONFIG.MAP_BORDER,
      c: randomColor()
    });
  }
}

function findSafeSpawnPosition() {
  for (let attempts = 0; attempts < 30; attempts++) {
    const x = randomPos(CONFIG.MAP_WIDTH - CONFIG.SPAWN_MARGIN * 2) + CONFIG.SPAWN_MARGIN;
    const y = randomPos(CONFIG.MAP_HEIGHT - CONFIG.SPAWN_MARGIN * 2) + CONFIG.SPAWN_MARGIN;
    
    let isSafe = true;
    const allSnakes = { ...players, ...bots };
    for (let id in allSnakes) {
      if (!allSnakes[id].alive) continue;
      const otherHead = allSnakes[id].segments[0];
      if (Math.hypot(x - otherHead.x, y - otherHead.y) < 300) {
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
    boostStartTime: 0,
    lastBoostDrain: Date.now()
  };
}

function calculateSpeed(segmentCount, boosting) {
  const baseSpeed = CONFIG.BASE_SPEED - (segmentCount * CONFIG.SPEED_DECAY_FACTOR);
  const speed = Math.max(baseSpeed, CONFIG.MIN_SPEED);
  return boosting ? speed * CONFIG.BOOST_MULTIPLIER : speed;
}

function checkCollision(snake, allPlayers, playerId) {
  const head = snake.segments[0];
  
  if (Date.now() - snake.spawnTime < 2000) return false;
  
  if (head.x <= CONFIG.MAP_BORDER || head.x >= CONFIG.MAP_WIDTH - CONFIG.MAP_BORDER || 
      head.y <= CONFIG.MAP_BORDER || head.y >= CONFIG.MAP_HEIGHT - CONFIG.MAP_BORDER) {
    return true;
  }
  
  for (let id in allPlayers) {
    const other = allPlayers[id];
    if (!other.alive || id === playerId) continue;
    
    for (let i = 0; i < other.segments.length; i++) {
      const seg = other.segments[i];
      if (Math.hypot(head.x - seg.x, head.y - seg.y) < CONFIG.COLLISION_THRESHOLD) {
        return true;
      }
    }
  }
  
  return false;
}

function checkFoodCollision(snake) {
  const head = snake.segments[0];
  const eatenIndices = [];
  
  for (let i = 0; i < foods.length; i++) {
    const food = foods[i];
    if (Math.hypot(head.x - food.x, head.y - food.y) < CONFIG.SEGMENT_SIZE + 4) {
      eatenIndices.push(i);
    }
  }
  
  return eatenIndices;
}

function moveSnake(snake, boosting) {
  const head = snake.segments[0];
  const speed = calculateSpeed(snake.segments.length, boosting);
  
  snake.segments.unshift({
    x: head.x + snake.dx * speed,
    y: head.y + snake.dy * speed
  });
  
  // HIZLANMA KUCULMESI - Her saniye 1 segment
  if (boosting && snake.segments.length > CONFIG.MIN_SNAKE_LENGTH) {
    const now = Date.now();
    const timeSinceLastDrain = now - snake.lastBoostDrain;
    
    // Her 1000ms'de 1 segment kucul
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
  
  // Normal hareket - son segmenti sil
  snake.segments.pop();
}

function growSnake(snake, count) {
  const tail = snake.segments[snake.segments.length - 1];
  for (let i = 0; i < count; i++) {
    snake.segments.push({ x: tail.x, y: tail.y });
  }
}

function shrinkSnake(snake, count) {
  for (let i = 0; i < count; i++) {
    if (snake.segments.length > CONFIG.MIN_SNAKE_LENGTH) {
      snake.segments.pop();
    }
  }
}

function cleanupFoods() {
  if (foods.length > CONFIG.FOOD_COUNT * 2) {
    foods = foods.slice(0, CONFIG.FOOD_COUNT * 1.5);
  }
}

// AI BOT LOGIC
function createBot() {
  const botNames = ['BotAlpha', 'BotBeta', 'BotGamma', 'BotDelta', 'BotOmega', 'BotZeta', 'BotSigma'];
  const botId = 'bot_' + (botIdCounter++);
  const snake = createSnake();
  
  bots[botId] = {
    name: botNames[Math.floor(Math.random() * botNames.length)] + botIdCounter,
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
    lastTargetUpdate: Date.now()
  };
  
  return botId;
}

function updateBotAI(botId) {
  const bot = bots[botId];
  if (!bot || !bot.alive) return;
  
  const now = Date.now();
  const head = bot.segments[0];
  
  // Her 500ms'de hedef guncelle
  if (now - bot.lastTargetUpdate > 500) {
    bot.target = findBotTarget(bot);
    bot.lastTargetUpdate = now;
  }
  
  if (bot.target) {
    const dx = bot.target.x - head.x;
    const dy = bot.target.y - head.y;
    const len = Math.hypot(dx, dy);
    
    if (len > 10) {
      bot.dx = dx / len;
      bot.dy = dy / len;
    }
  }
  
  // Rastgele hizlanma (agresif davranis)
  if (bot.segments.length > 30 && Math.random() < 0.05) {
    bot.boosting = true;
    setTimeout(() => { if (bots[botId]) bots[botId].boosting = false; }, 1000);
  }
}

function findBotTarget(bot) {
  const head = bot.segments[0];
  const allSnakes = { ...players, ...bots };
  
  // 1. Yakin yem ara
  let closestFood = null;
  let closestFoodDist = Infinity;
  
  for (let food of foods) {
    const dist = Math.hypot(food.x - head.x, food.y - head.y);
    if (dist < closestFoodDist && dist < 300) {
      closestFoodDist = dist;
      closestFood = food;
    }
  }
  
  // 2. Kendinden kucuk yilan ara (saldir)
  let closestPrey = null;
  let closestPreyDist = Infinity;
  
  for (let id in allSnakes) {
    const other = allSnakes[id];
    if (id === bot.name || !other.alive) continue;
    if (other.segments.length < bot.segments.length * 0.7) {
      const otherHead = other.segments[0];
      const dist = Math.hypot(otherHead.x - head.x, otherHead.y - head.y);
      if (dist < closestPreyDist && dist < 400) {
        closestPreyDist = dist;
        closestPrey = otherHead;
      }
    }
  }
  
  // 3. Buyuk yilandan kac
  for (let id in allSnakes) {
    const other = allSnakes[id];
    if (id === bot.name || !other.alive) continue;
    if (other.segments.length > bot.segments.length * 1.3) {
      const otherHead = other.segments[0];
      const dist = Math.hypot(otherHead.x - head.x, otherHead.y - head.y);
      if (dist < 200) {
        // Kac - ters yon
        const dx = head.x - otherHead.x;
        const dy = head.y - otherHead.y;
        return { x: head.x + dx, y: head.y + dy };
      }
    }
  }
  
  // Oncelik: Av > Yem
  if (closestPrey) return closestPrey;
  if (closestFood) return closestFood;
  
  // Rastgele hareket
  const angle = Math.random() * Math.PI * 2;
  return {
    x: head.x + Math.cos(angle) * 200,
    y: head.y + Math.sin(angle) * 200
  };
}

function gameLoop() {
  const now = Date.now();
  
  if (now - lastCleanup > 5000) {
    cleanupFoods();
    lastCleanup = now;
  }
  
  const allSnakes = { ...players, ...bots };
  
  // Bot AI guncelle
  for (let botId in bots) {
    updateBotAI(botId);
  }
  
  // Tum yilanlari hareket ettir
  for (let id in allSnakes) {
    const entity = allSnakes[id];
    if (!entity.alive) continue;
    
    moveSnake(entity, entity.boosting);
    
    const eatenFoods = checkFoodCollision(entity);
    if (eatenFoods.length > 0) {
      growSnake(entity, eatenFoods.length);
      entity.score = entity.segments.length;
      
      for (let i = eatenFoods.length - 1; i >= 0; i--) {
        foods[eatenFoods[i]] = {
          x: randomPos(CONFIG.MAP_WIDTH - CONFIG.MAP_BORDER * 2) + CONFIG.MAP_BORDER,
          y: randomPos(CONFIG.MAP_HEIGHT - CONFIG.MAP_BORDER * 2) + CONFIG.MAP_BORDER,
          c: randomColor()
        };
      }
    }
    
    if (checkCollision(entity, allSnakes, id)) {
      entity.alive = false;
      
      const deathFoodCount = Math.floor(entity.segments.length * CONFIG.DEATH_FOOD_RATIO);
      const step = Math.floor(entity.segments.length / deathFoodCount);
      
      for (let i = 0; i < entity.segments.length; i += step) {
        const seg = entity.segments[i];
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
        setTimeout(() => { delete bots[id]; }, 100);
      }
    }
  }
  
  // State gonder
  const state = {
    p: {},
    f: foods.slice(0, 400)
  };
  
  for (let id in allSnakes) {
    if (allSnakes[id].alive) {
      state.p[id] = {
        n: allSnakes[id].name,
        s: allSnakes[id].segments,
        c: allSnakes[id].color,
        sc: allSnakes[id].score,
        b: allSnakes[id].boosting
      };
    }
  }
  
  io.emit('gameState', state);
}

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);
  
  socket.on('join', (playerName) => {
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
  });
  
  socket.on('changeDirection', (direction) => {
    if (players[socket.id] && players[socket.id].alive) {
      const len = Math.hypot(direction.x, direction.y);
      if (len > 0.1) {
        players[socket.id].dx = direction.x / len;
        players[socket.id].dy = direction.y / len;
      }
    }
  });
  
  socket.on('boost', (isBoosting) => {
    if (players[socket.id] && players[socket.id].alive) {
      players[socket.id].boosting = isBoosting && players[socket.id].segments.length > CONFIG.MIN_SNAKE_LENGTH;
    }
  });
  
  // ADMIN COMMANDS
  socket.on('adminLogin', (password) => {
    if (password === ADMIN_PASSWORD) {
      admins[socket.id] = true;
      socket.emit('adminAccess', true);
      console.log('Admin logged in:', socket.id);
    } else {
      socket.emit('adminAccess', false);
    }
  });
  
  socket.on('addBot', () => {
    if (!admins[socket.id]) return;
    const botId = createBot();
    console.log('Bot created:', botId);
    socket.emit('botCreated', { id: botId, name: bots[botId].name });
  });
  
  socket.on('removeBot', () => {
    if (!admins[socket.id]) return;
    const botIds = Object.keys(bots);
    if (botIds.length > 0) {
      const botId = botIds[0];
      delete bots[botId];
      console.log('Bot removed:', botId);
      socket.emit('botRemoved', botId);
    }
  });
  
  socket.on('modifyPlayer', (data) => {
    if (!admins[socket.id]) return;
    
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
      console.log('Modified player:', data.playerName, 'by', amount);
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
});
