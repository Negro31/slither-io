// ============================================
// SERVER.JS - Node.js Backend (Express + Socket.io)
// ============================================

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(path.join(__dirname, 'public')));

// Oyun sabitleri
const CONFIG = {
  MAP_WIDTH: 2000,
  MAP_HEIGHT: 2000,
  FOOD_COUNT: 200,
  SNAKE_SPEED: 2.5,
  SEGMENT_SIZE: 10,
  FOOD_SIZE: 6,
  TICK_RATE: 30,
  SPAWN_MARGIN: 300 // Guvenli spawn alani
};

let players = {};
let foods = [];

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
      x: randomPos(CONFIG.MAP_WIDTH),
      y: randomPos(CONFIG.MAP_HEIGHT),
      color: randomColor()
    });
  }
}

// Guvenli spawn konumu bul
function findSafeSpawnPosition() {
  let attempts = 0;
  const maxAttempts = 50;
  
  while (attempts < maxAttempts) {
    const x = randomPos(CONFIG.MAP_WIDTH - CONFIG.SPAWN_MARGIN * 2) + CONFIG.SPAWN_MARGIN;
    const y = randomPos(CONFIG.MAP_HEIGHT - CONFIG.SPAWN_MARGIN * 2) + CONFIG.SPAWN_MARGIN;
    
    // Diger yilanlardan uzakta mi kontrol et
    let isSafe = true;
    for (let id in players) {
      if (!players[id].snake.alive) continue;
      
      const otherHead = players[id].snake.segments[0];
      const distance = Math.hypot(x - otherHead.x, y - otherHead.y);
      
      if (distance < 200) { // En az 200 piksel uzakta
        isSafe = false;
        break;
      }
    }
    
    if (isSafe) {
      return { x, y };
    }
    
    attempts++;
  }
  
  // Eger guvenli yer bulunamazsa haritanin ortasina spawn et
  return {
    x: CONFIG.MAP_WIDTH / 2,
    y: CONFIG.MAP_HEIGHT / 2
  };
}

function createSnake(name) {
  const spawnPos = findSafeSpawnPosition();
  
  return {
    segments: [
      { x: spawnPos.x, y: spawnPos.y },
      { x: spawnPos.x - CONFIG.SEGMENT_SIZE, y: spawnPos.y },
      { x: spawnPos.x - CONFIG.SEGMENT_SIZE * 2, y: spawnPos.y }
    ],
    direction: { x: 1, y: 0 },
    color: randomColor(),
    alive: true
  };
}

function checkCollision(snake, allPlayers, playerId) {
  const head = snake.segments[0];
  
  // Harita sinirlari - daha toleransli
  if (head.x < 20 || head.x > CONFIG.MAP_WIDTH - 20 || 
      head.y < 20 || head.y > CONFIG.MAP_HEIGHT - 20) {
    return true;
  }
  
  // Diger yilanlarla carpisma
  for (let id in allPlayers) {
    const other = allPlayers[id];
    if (!other.snake.alive) continue;
    
    // Kendi govdemizle carpismak icin en az 5 segment gerekli
    const startIdx = (id === playerId) ? Math.min(5, other.snake.segments.length) : 0;
    
    for (let i = startIdx; i < other.snake.segments.length; i++) {
      const seg = other.snake.segments[i];
      const dist = Math.hypot(head.x - seg.x, head.y - seg.y);
      if (dist < CONFIG.SEGMENT_SIZE - 2) { // Daha hassas carpisma
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
    if (dist < CONFIG.SEGMENT_SIZE + 2) { // Daha kolay yem yeme
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
          x: randomPos(CONFIG.MAP_WIDTH),
          y: randomPos(CONFIG.MAP_HEIGHT),
          color: randomColor()
        };
      });
    }
    
    if (checkCollision(player.snake, players, id)) {
      player.snake.alive = false;
      
      player.snake.segments.forEach(seg => {
        foods.push({
          x: seg.x,
          y: seg.y,
          color: player.snake.color
        });
      });
      
      io.to(id).emit('death');
    }
  }
  
  io.emit('gameState', {
    players: Object.keys(players).reduce((acc, id) => {
      if (players[id].snake.alive) {
        acc[id] = {
          name: players[id].name,
          segments: players[id].snake.segments,
          color: players[id].snake.color,
          score: players[id].score
        };
      }
      return acc;
    }, {}),
    foods: foods
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
    
    console.log('Player spawned:', playerName, 'at', players[socket.id].snake.segments[0]);
    
    socket.emit('init', {
      playerId: socket.id,
      mapWidth: CONFIG.MAP_WIDTH,
      mapHeight: CONFIG.MAP_HEIGHT
    });
  });
  
  socket.on('changeDirection', (direction) => {
    if (players[socket.id] && players[socket.id].snake.alive) {
      const len = Math.hypot(direction.x, direction.y);
      if (len > 0) {
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
