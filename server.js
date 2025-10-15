// ============================================
// SERVER.JS - Boost Bug Fixed
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
  transports: ['websocket', 'polling']
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
  FOOD_COUNT: 300,
  SNAKE_SPEED: 3,
  BOOST_SPEED: 6,
  BOOST_DRAIN_RATE: 0.5, // Her tick'te kac segment kuculsun
  SEGMENT_SIZE: 10,
  FOOD_SIZE: 6,
  TICK_RATE: 50,
  SPAWN_MARGIN: 400,
  COLLISION_THRESHOLD: 8,
  MIN_SNAKE_LENGTH: 10
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
      id: 'food_' + i,
      x: randomPos(CONFIG.MAP_WIDTH - CONFIG.MAP_BORDER * 2) + CONFIG.MAP_BORDER,
      y: randomPos(CONFIG.MAP_HEIGHT - CONFIG.MAP_BORDER * 2) + CONFIG.MAP_BORDER,
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
  
  const segments = [];
  for (let i = 0; i < 15; i++) {
    segments.push({
      x: spawnPos.x - Math.cos(angle) * CONFIG.SEGMENT_SIZE * i,
      y: spawnPos.y - Math.sin(angle) * CONFIG.SEGMENT_SIZE * i
    });
  }
  
  return {
    segments: segments,
    direction: { x: Math.cos(angle), y: Math.sin(angle) },
    color: randomColor(),
    alive: true,
    spawnTime: Date.now(),
    boosting: false,
    boostDrainAccumulator: 0 // Kesirli kuculmeler icin
  };
}

function checkCollision(snake, allPlayers, playerId) {
  const head = snake.segments[0];
  
  if (Date.now() - snake.spawnTime < 2000) {
    return false;
  }
  
  if (head.x <= CONFIG.MAP_BORDER || head.x >= CONFIG.MAP_WIDTH - CONFIG.MAP_BORDER || 
      head.y <= CONFIG.MAP_BORDER || head.y >= CONFIG.MAP_HEIGHT - CONFIG.MAP_BORDER) {
    return true;
  }
  
  for (let id in allPlayers) {
    const other = allPlayers[id];
    if (!other.snake.alive) continue;
    if (id === playerId) continue;
    
    for (let i = 0; i < other.snake.segments.length; i++) {
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

// DUZELTILMIS HAREKET FONKSIYONU
function moveSnake(snake, boosting) {
  const head = snake.segments[0];
  const speed = boosting ? CONFIG.BOOST_SPEED : CONFIG.SNAKE_SPEED;
  
  const newHead = {
    x: head.x + snake.direction.x * speed,
    y: head.y + snake.direction.y * speed
  };
  
  snake.segments.unshift(newHead);
  
  // HIZLANMA DURUMUNDA KUCUL
  if (boosting && snake.segments.length > CONFIG.MIN_SNAKE_LENGTH) {
    // Accumulator ile kesirli kuculmeler
    snake.boostDrainAccumulator += CONFIG.BOOST_DRAIN_RATE;
    
    // Tam sayi kadar segment sil
    const segmentsToRemove = Math.floor(snake.boostDrainAccumulator);
    
    for (let i = 0; i < segmentsToRemove; i++) {
      if (snake.segments.length > CONFIG.MIN_SNAKE_LENGTH) {
        snake.segments.pop();
      }
    }
    
    // Kesirli kismi sakla
    snake.boostDrainAccumulator -= segmentsToRemove;
    
  } else {
    // NORMAL HAREKET - sadece 1 segment sil
    snake.segments.pop();
    snake.boostDrainAccumulator = 0; // Reset accumulator
  }
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
    
    // Hareket - boosting durumunu gonder
    moveSnake(player.snake, player.boosting);
    
    const eatenFoods = checkFoodCollision(player.snake);
    if (eatenFoods.length > 0) {
      growSnake(player.snake, eatenFoods.length);
      player.score = player.snake.segments.length;
      
      eatenFoods.forEach(idx => {
        foods[idx] = {
          id: 'food_' + Date.now() + '_' + idx,
          x: randomPos(CONFIG.MAP_WIDTH - CONFIG.MAP_BORDER * 2) + CONFIG.MAP_BORDER,
          y: randomPos(CONFIG.MAP_HEIGHT - CONFIG.MAP_BORDER * 2) + CONFIG.MAP_BORDER,
          color: randomColor()
        };
      });
    }
    
    if (checkCollision(player.snake, players, id)) {
      player.snake.alive = false;
      
      const deathFoods = [];
      player.snake.segments.forEach((seg, idx) => {
        if (idx % 2 === 0 && 
            seg.x > CONFIG.MAP_BORDER && seg.x < CONFIG.MAP_WIDTH - CONFIG.MAP_BORDER &&
            seg.y > CONFIG.MAP_BORDER && seg.y < CONFIG.MAP_HEIGHT - CONFIG.MAP_BORDER) {
          deathFoods.push({
            id: 'death_' + id + '_' + idx,
            x: seg.x,
            y: seg.y,
            color: player.snake.color
          });
        }
      });
      
      foods.push(...deathFoods);
      
      io.to(id).emit('death', player.score);
      
      setTimeout(() => {
        delete players[id];
      }, 100);
    }
  }
  
  const activePlayers = {};
  for (let id in players) {
    if (players[id].snake.alive) {
      activePlayers[id] = {
        name: players[id].name,
        segments: players[id].snake.segments,
        color: players[id].snake.color,
        score: players[id].score,
        boosting: players[id].boosting
      };
    }
  }
  
  io.emit('gameState', {
    players: activePlayers,
    foods: foods.slice(0, 600)
  });
}

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);
  
  socket.on('join', (playerName) => {
    players[socket.id] = {
      name: playerName || 'Anonymous',
      snake: createSnake(playerName),
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
    if (players[socket.id] && players[socket.id].snake.alive) {
      const len = Math.hypot(direction.x, direction.y);
      if (len > 0.1) {
        players[socket.id].snake.direction = {
          x: direction.x / len,
          y: direction.y / len
        };
      }
    }
  });
  
  socket.on('boost', (isBoosting) => {
    if (players[socket.id] && players[socket.id].snake.alive) {
      if (players[socket.id].snake.segments.length > CONFIG.MIN_SNAKE_LENGTH) {
        players[socket.id].boosting = isBoosting;
      } else {
        players[socket.id].boosting = false;
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
server.listen(PORT, '0.0.0.0', () => {
  console.log('Server running on port: ' + PORT);
  console.log('Server accessible from all networks');
});
