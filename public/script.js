// ============================================
// SCRIPT.JS - Complete with Draggable Admin
// ============================================

const loginScreen = document.getElementById('loginScreen');
const gameScreen = document.getElementById('gameScreen');
const nameInput = document.getElementById('nameInput');
const joinButton = document.getElementById('joinButton');
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const leaderboardList = document.getElementById('leaderboardList');
const joystickContainer = document.getElementById('joystickContainer');
const joystickStick = document.getElementById('joystickStick');
const boostButton = document.getElementById('boostButton');
const adminPanel = document.getElementById('adminPanel');
const adminToggleBtn = document.getElementById('adminToggleBtn');
const adminCloseBtn = document.getElementById('adminCloseBtn');
const adminInput = document.getElementById('adminInput');
const adminLoginBtn = document.getElementById('adminLoginBtn');
const adminControls = document.getElementById('adminControls');
const adminDragHandle = document.getElementById('adminDragHandle');

let socket;
let myPlayerId = null;
let gameState = { p: {}, f: [] };
let mapWidth = 3000;
let mapHeight = 3000;
let mapBorder = 100;
let camera = { x: 0, y: 0 };
let isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
let isBoosting = false;
let isAdmin = false;
let isPanelOpen = false;

// FPS
let fps = 0;
let frameCount = 0;
let lastFpsUpdate = Date.now();

// Draggable admin panel
let isDragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;

ctx.imageSmoothingEnabled = false;

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

joinButton.addEventListener('click', () => {
  const name = nameInput.value.trim() || 'Anonymous';
  socket = io({
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionAttempts: 10,
    transports: ['websocket', 'polling'],
    upgrade: true,
    rememberUpgrade: true
  });
  
  socket.on('connect', () => {
    socket.emit('join', name);
  });
  
  socket.on('init', (data) => {
    myPlayerId = data.playerId;
    mapWidth = data.mapWidth;
    mapHeight = data.mapHeight;
    mapBorder = data.mapBorder;
    loginScreen.style.display = 'none';
    gameScreen.style.display = 'block';
    adminToggleBtn.style.display = 'flex';
    startGame();
  });
  
  socket.on('gameState', (state) => {
    gameState = state;
    updateLeaderboard();
  });
  
  socket.on('death', (finalScore) => {
    setTimeout(() => {
      alert('You died! Final Score: ' + finalScore);
      location.reload();
    }, 100);
  });
  
  socket.on('adminAccess', (granted) => {
    if (granted) {
      isAdmin = true;
      adminControls.style.display = 'block';
      adminLoginBtn.textContent = 'Admin Active';
      adminLoginBtn.disabled = true;
    } else {
      alert('Wrong password!');
    }
  });
  
  socket.on('botCreated', (data) => {
    console.log('Bot created:', data.name);
  });
  
  socket.on('botRemoved', (id) => {
    console.log('Bot removed:', id);
  });
});

// Admin Panel Toggle
adminToggleBtn.addEventListener('click', () => {
  isPanelOpen = !isPanelOpen;
  adminPanel.style.display = isPanelOpen ? 'block' : 'none';
});

adminCloseBtn.addEventListener('click', () => {
  isPanelOpen = false;
  adminPanel.style.display = 'none';
});

// Admin Panel Dragging
adminDragHandle.addEventListener('mousedown', (e) => {
  isDragging = true;
  const rect = adminPanel.getBoundingClientRect();
  dragOffsetX = e.clientX - rect.left;
  dragOffsetY = e.clientY - rect.top;
  adminPanel.style.cursor = 'grabbing';
});

document.addEventListener('mousemove', (e) => {
  if (isDragging) {
    const newX = e.clientX - dragOffsetX;
    const newY = e.clientY - dragOffsetY;
    
    // Keep within bounds
    const maxX = window.innerWidth - adminPanel.offsetWidth;
    const maxY = window.innerHeight - adminPanel.offsetHeight;
    
    adminPanel.style.left = Math.max(0, Math.min(newX, maxX)) + 'px';
    adminPanel.style.top = Math.max(0, Math.min(newY, maxY)) + 'px';
  }
});

document.addEventListener('mouseup', () => {
  if (isDragging) {
    isDragging = false;
    adminPanel.style.cursor = 'default';
  }
});

// Admin Login
adminLoginBtn.addEventListener('click', () => {
  const password = adminInput.value.trim();
  if (password && socket) {
    socket.emit('adminLogin', password);
  }
});

document.getElementById('addBotBtn').addEventListener('click', () => {
  if (isAdmin && socket) {
    socket.emit('addBot');
  }
});

document.getElementById('removeBotBtn').addEventListener('click', () => {
  if (isAdmin && socket) {
    socket.emit('removeBot');
  }
});

document.getElementById('modifyPlayerBtn').addEventListener('click', () => {
  if (isAdmin && socket) {
    const playerName = document.getElementById('targetPlayerName').value.trim();
    const amount = document.getElementById('foodAmount').value.trim();
    if (playerName && amount) {
      socket.emit('modifyPlayer', { playerName, amount });
    }
  }
});

// Input handling
let lastDirectionSend = 0;
let pendingDirection = null;
const DIRECTION_THROTTLE = 50;

canvas.addEventListener('mousemove', (e) => {
  if (!myPlayerId || isMobile || isDragging) return;
  
  const player = gameState.p[myPlayerId];
  if (!player) return;
  
  const head = player.s[0];
  const mouseX = e.clientX - canvas.width / 2 + camera.x;
  const mouseY = e.clientY - canvas.height / 2 + camera.y;
  
  const dx = mouseX - head.x;
  const dy = mouseY - head.y;
  const len = Math.hypot(dx, dy);
  
  if (len > 10) {
    pendingDirection = { x: dx / len, y: dy / len };
  }
});

function sendDirectionUpdate() {
  const now = Date.now();
  if (pendingDirection && now - lastDirectionSend > DIRECTION_THROTTLE && socket) {
    socket.emit('changeDirection', pendingDirection);
    lastDirectionSend = now;
    pendingDirection = null;
  }
}

canvas.addEventListener('mousedown', (e) => {
  if (!myPlayerId || isMobile || e.button !== 0) return;
  isBoosting = true;
  if (socket) socket.emit('boost', true);
});

canvas.addEventListener('mouseup', (e) => {
  if (!myPlayerId || isMobile || e.button !== 0) return;
  isBoosting = false;
  if (socket) socket.emit('boost', false);
});

document.addEventListener('keydown', (e) => {
  if (!myPlayerId || isMobile || e.code !== 'Space' || isBoosting) return;
  e.preventDefault();
