// ============================================
// SERVER.JS - Optimized Backend
// ============================================

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  pingTimeout: 60000,
  pingInterval: 25000
});

app.use(express.static(path.join(__dirname, 'public')));

// Oyun sabitleri
const CONFIG = {
  MAP_WIDTH: 3000,
  MAP_HEIGHT: 3000,
  FOOD_COUNT: 300,
  SNAKE_SPEED: 3,
  SEGMENT_SIZE: 10,
  FOOD_SIZE: 6,
  TICK_RATE: 50, // 20 FPS server tick
  SPAWN_MARGIN: 400,
  COLLISION_THRESHOLD: 8
};

let players = {};
let foods = [];
let deadSnakeFoods = {}; // Olen yilan yemleri - zamana bagli temizleme

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
      id: 'food_' + i,
      x: randomPos(CONFIG.MAP_WIDTH),
      y: randomPos(CONFIG.MAP_HEIGHT),
      color: randomColor()
    });
  }
}

function findSafeSpawnPosition() {
  let attempts = 0;
  const maxAttempts = 50;
  
  while (attempts < maxAttempts) {
    const x = randomPos(CONFIG.MAP_WIDTH - CONFIG.SPAWN_MARGIN * 2) + CONFIG.SPAWN_MARGIN;
    const y = randomPos(CONFIG.MAP_HEIGHT - CONFIG.SPAWN_MARGIN * 2) + CONFIG.SPAWN_MARGIN;
    
    let isSafe = true;
    for (let id in players) {
      if (!players[id].snake.alive) continue;
      
      const otherHead = players[id].snake.segments[0];
      const distance = Math.hypot(x - otherHead.x, y - otherHead.y);
      
      if (distance < 300) {
        isSafe = false;
        break;
      }
    }
    
    if (isSafe) {
      return { x, y };
    }
    
    attempts++;
  }
  
  return {
    x: CONFIG.MAP_WIDTH / 2,
    y: CONFIG.MAP_HEIGHT / 2
  };
}

function createSnake(name) {
  const spawnPos = findSafeSpawnPosition();
  const angle = Math.random() * Math.PI * 2;
  
  return {
    segments: [
      { x: spawnPos.x, y: spawnPos.y },
      { x: spawnPos.x - Math.cos(angle) * CONFIG.SEGMENT_SIZE, y: spawnPos.y - Math.sin(angle) * CONFIG.SEGMENT_SIZE },
      { x: spawnPos.x - Math.cos(angle) * CONFIG.SEGMENT_SIZE * 2, y: spawnPos.y - Math.sin(angle) * CONFIG.SEGMENT_SIZE * 2 }
    ],
    direction: { x: Math.cos(angle), y: Math.sin(angle) },
    color: randomColor(),
    alive: true,
    spawnTime: Date.now()
  };
}

function checkCollision(snake, allPlayers, playerId) {
  const head = snake.segments[0];
  
  // Spawn koruması - ilk 2 saniye carpisma yok
  if (Date.now() - snake.spawnTime < 2000) {
    return false;
  }
  
  // Harita sinirlari - KESIN sinir
  if (head.x <= 50 || head.x >= CONFIG.MAP_WIDTH - 50 || 
      head.y <= 50 || head.y >= CONFIG.MAP_HEIGHT - 50) {
    return true;
  }
  
  // Sadece CANLI yilanlarla carpisma kontrol et
  for (let id in allPlayers) {
    const other = allPlayers[id];
    if (!other.snake.alive) continue; // OLEN YILANLARI ATLA
    
    // Kendi govdemizle carpismak icin en az 10 segment sonrasini kontrol et
    const startIdx = (id === playerId) ? 10 : 0;
    
    for (let i = startIdx; i < other.snake.segments.length; i++) {
      const seg = other.snake.segments[i];
      const dist = Math.hypot(head.x - seg.x, head.y - seg.y);
      if (dist < CONFIG.COLLISION_THRESHOLD) {
        return true;
      }
    }
  }
  
  return false;
}

function checkFoodCollision(snake) {
  const head = snake.segments[0];
  let eatenIndices = [];
  
  foods.forEach((food, idx) => {
    const dist = Math.hypot(head.x - food.x, head.y - food.y);
    if (dist < CONFIG.SEGMENT_SIZE + 4) {
      eatenIndices.push(idx);
    }
  });
  
  return eatenIndices;
}

function moveSnake(snake) {
  const head = snake.segments[0];
  const newHead = {
    x: head.x + snake.direction.x * CONFIG.SNAKE_SPEED,
    y: head.y + snake.direction.y * CONFIG.SNAKE_SPEED
  };
  
  snake.segments.unshift(newHead);
  snake.segments.pop();
}

function growSnake(snake, count) {
  for (let i = 0; i < count; i++) {
    const tail = snake.segments[snake.segments.length - 1];
    snake.segments.push({ ...tail });
  }
}

// Olen yilan yemlerini temizle (10 saniye sonra)
function cleanupDeadSnakeFoods() {
  const now = Date.now();
  for (let id in deadSnakeFoods) {
    if (now - deadSnakeFoods[id].timestamp > 10000) {
      delete deadSnakeFoods[id];
    }
  }
}

function gameLoop() {
  for (let id in players) {
    const player = players[id];
    if (!player.snake.alive) continue;
    
    moveSnake(player.snake);
    
    const eatenFoods = checkFoodCollision(player.snake);
    if (eatenFoods.length > 0) {
      growSnake(player.snake, eatenFoods.length);
      player.score = player.snake.segments.length;
      
      eatenFoods.forEach(idx => {
        foods[idx] = {
          id: 'food_' + Date.now() + '_' + idx,
          x: randomPos(CONFIG.MAP_WIDTH),
          y: randomPos(CONFIG.MAP_HEIGHT),
          color: randomColor()
        };
      });
    }
    
    if (checkCollision(player.snake, players, id)) {
      player.snake.alive = false;
      
      // Yilani yeme donustur - ama carpisma kontrolunden cikar
      const deathFoods = [];
      player.snake.segments.forEach((seg, idx) => {
        if (idx % 2 === 0) { // Her 2 segmentten 1 yem
          deathFoods.push({
            id: 'death_' + id + '_' + idx,
            x: seg.x,
            y: seg.y,
            color: player.snake.color
          });
        }
      });
      
      foods.push(...deathFoods);
      deadSnakeFoods[id] = { timestamp: Date.now() };
      
      io.to(id).emit('death');
      
      // Olu oyuncuyu sil
      setTimeout(() => {
        delete players[id];
      }, 100);
    }
  }
  
  cleanupDeadSnakeFoods();
  
  // Sadece canli oyunculari gonder
  const activePlayers = {};
  for (let id in players) {
    if (players[id].snake.alive) {
      activePlayers[id] = {
        name: players[id].name,
        segments: players[id].snake.segments,
        color: players[id].snake.color,
        score: players[id].score
      };
    }
  }
  
  io.emit('gameState', {
    players: activePlayers,
    foods: foods.slice(0, 500) // Performans icin max 500 yem
  });
}

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);
  
  socket.on('join', (playerName) => {
    players[socket.id] = {
      name: playerName || 'Anonymous',
      snake: createSnake(playerName),
      score: 3
    };
    
    socket.emit('init', {
      playerId: socket.id,
      mapWidth: CONFIG.MAP_WIDTH,
      mapHeight: CONFIG.MAP_HEIGHT
    });
  });
  
  socket.on('changeDirection', (direction) => {
    if (players[socket.id] && players[socket.id].snake.alive) {
      const len = Math.hypot(direction.x, direction.y);
      if (len > 0.1) { // Minimum hareket esigi
        players[socket.id].snake.direction = {
          x: direction.x / len,
          y: direction.y / len
        };
      }
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
server.listen(PORT, () => {
  console.log('Server running on port: ' + PORT);
});
