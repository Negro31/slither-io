```javascript
// ============================================
// SERVER.JS - Node.js Backend (Express + Socket.io)
// ============================================
// Render deployment: Bu dosya otomatik çalışacak
// PORT environment variable Render tarafından sağlanır

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Static dosyaları sunma
app.use(express.static(path.join(__dirname, 'public')));

// Oyun sabitleri
const CONFIG = {
  MAP_WIDTH: 2000,
  MAP_HEIGHT: 2000,
  FOOD_COUNT: 200,
  SNAKE_SPEED: 2.5,
  SEGMENT_SIZE: 10,
  FOOD_SIZE: 6,
  TICK_RATE: 30 // ms
};

// Oyun durumu
let players = {}; // { socketId: { snake, name, score } }
let foods = [];

// Rastgele konum üretici
function randomPos(max) {
  return Math.floor(Math.random() * max);
}

// Rastgele renk üretici
function randomColor() {
  const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2'];
  return colors[Math.floor(Math.random() * colors.length)];
}

// Yem oluşturma
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

// Yeni yılan oluştur
function createSnake(name) {
  const startX = randomPos(CONFIG.MAP_WIDTH - 200) + 100;
  const startY = randomPos(CONFIG.MAP_HEIGHT - 200) + 100;
  
  return {
    segments: [
      { x: startX, y: startY },
      { x: startX - CONFIG.SEGMENT_SIZE, y: startY },
      { x: startX - CONFIG.SEGMENT_SIZE * 2, y: startY }
    ],
    direction: { x: 1, y: 0 },
    color: randomColor(),
    alive: true
  };
}

// Çarpışma kontrolü
function checkCollision(snake, allPlayers, playerId) {
  const head = snake.segments[0];
  
  // Harita sınırları
  if (head.x < 0 || head.x > CONFIG.MAP_WIDTH || head.y < 0 || head.y > CONFIG.MAP_HEIGHT) {
    return true;
  }
  
  // Diğer yılanlarla çarpışma
  for (let id in allPlayers) {
    const other = allPlayers[id];
    if (!other.snake.alive) continue;
    
    // Başka yılanın gövdesi (kendi başımızla çarpışmayı kontrol etme)
    const startIdx = (id === playerId) ? 1 : 0;
    for (let i = startIdx; i < other.snake.segments.length; i++) {
      const seg = other.snake.segments[i];
      const dist = Math.hypot(head.x - seg.x, head.y - seg.y);
      if (dist < CONFIG.SEGMENT_SIZE) {
        return true;
      }
    }
  }
  
  return false;
}

// Yem yeme kontrolü
function checkFoodCollision(snake) {
  const head = snake.segments[0];
  let eatenIndices = [];
  
  foods.forEach((food, idx) => {
    const dist = Math.hypot(head.x - food.x, head.y - food.y);
    if (dist < CONFIG.SEGMENT_SIZE) {
      eatenIndices.push(idx);
    }
  });
  
  return eatenIndices;
}

// Yılan hareket
function moveSnake(snake) {
  const head = snake.segments[0];
  const newHead = {
    x: head.x + snake.direction.x * CONFIG.SNAKE_SPEED,
    y: head.y + snake.direction.y * CONFIG.SNAKE_SPEED
  };
  
  snake.segments.unshift(newHead);
  snake.segments.pop();
}

// Yılan uzatma
function growSnake(snake, count) {
  for (let i = 0; i < count; i++) {
    const tail = snake.segments[snake.segments.length - 1];
    snake.segments.push({ ...tail });
  }
}

// Oyun döngüsü
function gameLoop() {
  for (let id in players) {
    const player = players[id];
    if (!player.snake.alive) continue;
    
    // Hareket
    moveSnake(player.snake);
    
    // Yem kontrolü
    const eatenFoods = checkFoodCollision(player.snake);
    if (eatenFoods.length > 0) {
      growSnake(player.snake, eatenFoods.length);
      player.score = player.snake.segments.length;
      
      // Yenilen yemleri yeniden oluştur
      eatenFoods.forEach(idx => {
        foods[idx] = {
          x: randomPos(CONFIG.MAP_WIDTH),
          y: randomPos(CONFIG.MAP_HEIGHT),
          color: randomColor()
        };
      });
    }
    
    // Çarpışma kontrolü
    if (checkCollision(player.snake, players, id)) {
      player.snake.alive = false;
      
      // Yılanı yeme dönüştür
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
  
  // State'i tüm oyunculara gönder
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

// Socket.io bağlantıları
io.on('connection', (socket) => {
  console.log('Oyuncu bağlandı:', socket.id);
  
  socket.on('join', (playerName) => {
    players[socket.id] = {
      name: playerName || 'Anonim',
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
      // Normalize direction
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
    console.log('Oyuncu ayrıldı:', socket.id);
    delete players[socket.id];
  });
});

// Başlangıç
initFoods();
setInterval(gameLoop, CONFIG.TICK_RATE);

// Server başlatma
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server çalışıyor: http://localhost:${PORT}`);
});
```
