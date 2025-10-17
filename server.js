// ============================================
// SERVER.JS - Ultra Optimized + Smart AI Bots
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
  maxHttpBufferSize: 5e5, // 500KB buffer
  perMessageDeflate: false // Disable compression for speed
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
  TICK_RATE: 50, // 20 FPS server (optimized)
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
let botRespawnQueue = []; // Bot respawn queue

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
      if (!allSnakes[id].alive) continue;
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
  const head = snake.segments[0];
  
  if (Date.now() - snake.spawnTime < 2000) return false;
  
  // Harita sinirlari - daha genis guvenli bolge
  if (head.x <= CONFIG.MAP_BORDER + 10 || head.x >= CONFIG.MAP_WIDTH - CONFIG.MAP_BORDER - 10 || 
      head.y <= CONFIG.MAP_BORDER + 10 || head.y >= CONFIG.MAP_HEIGHT - CONFIG.MAP_BORDER - 10) {
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
    foods = foods.slice(0, Math.floor(CONFIG.FOOD_COUNT * 1.5));
  }
}

// ============================================
// SMART AI BOT LOGIC
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
    strategy: 'hunt', // hunt, flee, feed
    shouldRespawn: true
  };
  
  return botId;
}

function updateBotAI(botId) {
  const bot = bots[botId];
  if (!bot || !bot.alive) return;
  
  const now = Date.now();
  const head = bot.segments[0];
  const allSnakes = { ...players, ...bots };
  
  // Harita sinirlarindan uzak dur
  const borderMargin = 150;
  if (head.x < borderMargin || head.x > CONFIG.MAP_WIDTH - borderMargin ||
      head.y < borderMargin || head.y > CONFIG.MAP_HEIGHT - borderMargin) {
    // Merkeze don
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
  
  // Her 300ms'de hedef ve strateji guncelle (daha hizli reaction)
  if (now - bot.lastTargetUpdate > 300) {
    updateBotStrategy(bot, allSnakes);
    bot.lastTargetUpdate = now;
  }
  
  if (bot.target) {
    executeBotStrategy(bot, allSnakes);
  }
}

function updateBotStrategy(bot, allSnakes) {
  const head = bot.segments[0];
  
  // 1. Tehlike kontrolu - Buyuk yilanlar yakin mi?
  let dangerousSnake = null;
  let minDangerDist = Infinity;
  
  for (let id in allSnakes) {
    const other = allSnakes[id];
    if (id === bot.id || !other.alive) continue;
    
    if (other.segments.length > bot.segments.length * 1.2) {
      const otherHead = other.segments[0];
      const dist = Math.hypot(otherHead.x - head.x, otherHead.y - head.y);
      if (dist < 300 && dist < minDangerDist) {
        minDangerDist = dist;
        dangerousSnake = other;
      }
    }
  }
  
  if (dangerousSnake) {
    bot.strategy = 'flee';
    const otherHead = dangerousSnake.segments[0];
    // Kacma yonu - ters yon
    bot.target = {
      x: head.x + (head.x - otherHead.x) * 2,
      y: head.y + (head.y - otherHead.y) * 2
    };
    bot.boosting = bot.segments.length > 20; // Hizlanarak kac
    return;
  }
  
  // 2. Av kontrolu - Kucuk yilanlar yakin mi?
  let prey = null;
  let minPreyDist = Infinity;
  
  for (let id in allSnakes) {
    const other = allSnakes[id];
    if (id === bot.id || !other.alive) continue;
    
    if (other.segments.length < bot.segments.length * 0.75) {
      const otherHead = other.segments[0];
      const dist = Math.hypot(otherHead.x - head.x, otherHead.y - head.y);
      if (dist < 400 && dist < minPreyDist) {
        minPreyDist = dist;
        prey = other;
      }
    }
  }
  
  if (prey) {
    bot.strategy = 'hunt';
    bot.target = calculateEncirclementPoint(bot, prey);
    bot.boosting = bot.segments.length > 30 && minPreyDist < 200;
    return;
  }
  
  // 3. Yem yeme modu
  bot.strategy = 'feed';
  let closestFood = null;
  let minFoodDist = Infinity;
  
  for (let food of foods) {
    const dist = Math.hypot(food.x - head.x, food.y - head.y);
    if (dist < minFoodDist && dist < 400) {
      minFoodDist = dist;
      closestFood = food;
    }
  }
  
  if (closestFood) {
    bot.target = closestFood;
  } else {
    // Rastgele hareket - harita merkezine dogru
    const angle = Math.random() * Math.PI * 2;
    bot.target = {
      x: CONFIG.MAP_WIDTH / 2 + Math.cos(angle) * 300,
      y: CONFIG.MAP_HEIGHT / 2 + Math.sin(angle) * 300
    };
  }
  bot.boosting = false;
}

// Kuşatma noktasi hesapla - Avin onunu kes
function calculateEncirclementPoint(bot, prey) {
  const botHead = bot.segments[0];
  const preyHead = prey.segments[0];
  
  // Avin hareket yonunu tahmin et
  const preyDx = prey.dx || 0;
  const preyDy = prey.dy || 0;
  
  // Avin gelecekteki konumunu tahmin et (0.5 saniye sonra)
  const predictionTime = 500;
  const speed = calculateSpeed(prey.segments.length, prey.boosting);
  const predictedX = preyHead.x + preyDx * speed * predictionTime / CONFIG.TICK_RATE;
  const predictedY = preyHead.y + preyDy * speed * predictionTime / CONFIG.TICK_RATE;
  
  // Bu konumun onune gec
  return {
    x: predictedX + preyDx * 50,
    y: predictedY + preyDy * 50
  };
}

function executeBotStrategy(bot, allSnakes) {
  const head = bot.segments[0];
  
  if (!bot.target) return;
  
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
  const now = Date.now();
  
  if (now - lastCleanup > 5000) {
    cleanupFoods();
    lastCleanup = now;
  }
  
  // Bot respawn kontrolu
  if (botRespawnQueue.length > 0) {
    const toRespawn = botRespawnQueue.shift();
    if (toRespawn.shouldRespawn) {
      createBot(toRespawn.name);
    }
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
      
      // Yem yenileme - optimize
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
      
      // DAIMA %30 yem olustur
      const deathFoodCount = Math.max(3, Math.floor(entity.segments.length * CONFIG.DEATH_FOOD_RATIO));
      const step = Math.max(1, Math.floor(entity.segments.length / deathFoodCount));
      
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
        // Bot respawn queue'ya ekle
        if (bots[id].shouldRespawn) {
          setTimeout(() => {
            botRespawnQueue.push({ name: bots[id].name, shouldRespawn: true });
          }, 3000); // 3 saniye sonra respawn
        }
        delete bots[id];
      }
    }
  }
  
  // State gonder - COMPACT format
  const state = {
    p: {},
    f: foods.slice(0, 300) // Max 300 yem
  };
  
  for (let id in allSnakes) {
    if (allSnakes[id].alive) {
      // Segment optimizasyonu - her 2 segmentten 1'ini gonder (buyuk yilanlar icin)
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
  }
  
  io.volatile.emit('gameState', state); // volatile = packet loss OK
}

// ============================================
// SOCKET.IO EVENTS
// ============================================

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
    console.log('Bot created:', botId, bots[botId].name);
    socket.emit('botCreated', { id: botId, name: bots[botId].name });
  });
  
  socket.on('removeBot', () => {
    if (!admins[socket.id]) return;
    const botIds = Object.keys(bots);
    if (botIds.length > 0) {
      const botId = botIds[0];
      bots[botId].shouldRespawn = false; // Respawn engelle
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
  console.log('Admin password: ' + ADMIN_PASSWORD);
});
