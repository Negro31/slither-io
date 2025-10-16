// ============================================
// SERVER.JS - Fully Optimized & Fixed
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
  maxHttpBufferSize: 1e6 // 1MB buffer
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
  BASE_SPEED: 4, // Kucuk yilan hizi
  MIN_SPEED: 2, // Maksimum buyuklukta hiz
  BOOST_MULTIPLIER: 1.8, // Hizlanma carpani
  BOOST_SHRINK_RATE: 1, // Her tick'te kac segment kuculsun (hizlanirken)
  SEGMENT_SIZE: 10,
  TICK_RATE: 40, // 25 FPS server (daha optimize)
  SPAWN_MARGIN: 400,
  COLLISION_THRESHOLD: 8,
  MIN_SNAKE_LENGTH: 10,
  DEATH_FOOD_RATIO: 0.3, // Olumde %30 yem
  SPEED_DECAY_FACTOR: 0.002 // Buyukluge gore yavaslama
};

let players = {};
let foods = [];
let lastCleanup = Date.now();

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
    for (let id in players) {
      if (!players[id].alive) continue;
      const otherHead = players[id].segments[0];
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
    boosting: false
  };
}

// Dinamik hiz hesaplama
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
  
  // Yeni bas ekle
  snake.segments.unshift({
    x: head.x + snake.dx * speed,
    y: head.y + snake.dy * speed
  });
  
  // Hizlanma: Extra segment sil
  if (boosting && snake.segments.length > CONFIG.MIN_SNAKE_LENGTH) {
    for (let i = 0; i < CONFIG.BOOST_SHRINK_RATE; i++) {
      snake.segments.pop();
    }
  }
  
  // Normal: Son segmenti sil (sabit uzunluk)
  snake.segments.pop();
}

function growSnake(snake, count) {
  const tail = snake.segments[snake.segments.length - 1];
  for (let i = 0; i < count; i++) {
    snake.segments.push({ x: tail.x, y: tail.y });
  }
}

// Performans optimizasyonu: Fazla yemleri temizle
function cleanupFoods() {
  if (foods.length > CONFIG.FOOD_COUNT * 2) {
    foods = foods.slice(0, CONFIG.FOOD_COUNT * 1.5);
  }
}

function gameLoop() {
  const now = Date.now();
  
  // Her 5 saniyede bir temizlik
  if (now - lastCleanup > 5000) {
    cleanupFoods();
    lastCleanup = now;
  }
  
  for (let id in players) {
    const player = players[id];
    if (!player.alive) continue;
    
    moveSnake(player, player.boosting);
    
    const eatenFoods = checkFoodCollision(player);
    if (eatenFoods.length > 0) {
      growSnake(player, eatenFoods.length);
      player.score = player.segments.length;
      
      // Yenilen yemleri yeniden olustur
      for (let i = eatenFoods.length - 1; i >= 0; i--) {
        foods[eatenFoods[i]] = {
          x: randomPos(CONFIG.MAP_WIDTH - CONFIG.MAP_BORDER * 2) + CONFIG.MAP_BORDER,
          y: randomPos(CONFIG.MAP_HEIGHT - CONFIG.MAP_BORDER * 2) + CONFIG.MAP_BORDER,
          c: randomColor()
        };
      }
    }
    
    if (checkCollision(player, players, id)) {
      player.alive = false;
      
      // SADECE %30 YEM OLUSTUR
      const deathFoodCount = Math.floor(player.segments.length * CONFIG.DEATH_FOOD_RATIO);
      const step = Math.floor(player.segments.length / deathFoodCount);
      
      for (let i = 0; i < player.segments.length; i += step) {
        const seg = player.segments[i];
        if (seg.x > CONFIG.MAP_BORDER && seg.x < CONFIG.MAP_WIDTH - CONFIG.MAP_BORDER &&
            seg.y > CONFIG.MAP_BORDER && seg.y < CONFIG.MAP_HEIGHT - CONFIG.MAP_BORDER) {
          foods.push({
            x: seg.x,
            y: seg.y,
            c: player.color
          });
        }
      }
      
      io.to(id).emit('death', player.score);
      
      setTimeout(() => {
        delete players[id];
      }, 100);
    }
  }
  
  // Optimize edilmis state gonderimi
  const state = {
    p: {}, // players
    f: foods.slice(0, 400) // Max 400 yem gonder
  };
  
  for (let id in players) {
    if (players[id].alive) {
      state.p[id] = {
        n: players[id].name,
        s: players[id].segments,
        c: players[id].color,
        sc: players[id].score,
        b: players[id].boosting
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
      boosting: false
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
  
  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    delete players[socket.id];
  });
});

initFoods();
setInterval(gameLoop, CONFIG.TICK_RATE);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('Server running on port: ' + PORT);
});
