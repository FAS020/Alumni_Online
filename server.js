const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const path = require('path');
const fs = require('fs');

// Serveer statische bestanden
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// NIEUW: Serveer de uploads map
const UPLOADS_DIR = path.join(__dirname, 'uploads');
app.use('/uploads', express.static(UPLOADS_DIR));

// ─────────────────────────────────────────────
// 🌍 GAME STATE (ROOMS)
// ─────────────────────────────────────────────
const rooms = {}; 
const socketRoomMap = {}; 

// Map voor opslag
const ROOMS_DIR = path.join(__dirname, 'rooms');
if (!fs.existsSync(ROOMS_DIR)) {
    fs.mkdirSync(ROOMS_DIR);
}

// NIEUW: Custom object opslag
const CUSTOM_OBJECTS_PATH = path.join(__dirname, 'custom_objects.json');
let customObjects = []; // In-memory cache

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);
if (!fs.existsSync(path.join(UPLOADS_DIR, 'objects'))) {
    fs.mkdirSync(path.join(UPLOADS_DIR, 'objects'));
}

// NIEUW: Vrienden opslag
const FRIENDS_PATH = path.join(__dirname, 'friends.json');
let friendsData = {};
if (fs.existsSync(FRIENDS_PATH)) {
    try { friendsData = JSON.parse(fs.readFileSync(FRIENDS_PATH)); } catch(e) {}
}

function saveFriends() {
    fs.writeFile(FRIENDS_PATH, JSON.stringify(friendsData, null, 2), (err) => { if(err) console.error(err); });
}

// Standaard objecten voor een nieuwe kamer
const defaultObjects = [
    { x: 5, y: 5, height: 1, width: 2, depth: 1, flipped: false, name: "Tafel", subCategory: 'objects' },
    { x: 5, y: 8, height: 1, width: 2, depth: 1, flipped: true, name: "Tafel", subCategory: 'objects' },
    { x: 10, y: 5, height: 1, width: 2, depth: 1, flipped: false, name: "Pong", subCategory: 'objects', interactionType: 'pong' },
    { x: 10, y: 10, height: 2, flipped: false, name: "Hoge Blok", subCategory: 'objects' },
    { x: 15, y: 8, height: 1, flipped: false, name: "Blok", subCategory: 'objects' },
    { x: 3, y: 18, height: 2, flipped: true, name: "Hoge Blok", subCategory: 'objects' },
    { x: 20, y: 20, height: 1, flipped: false, name: "Blok", subCategory: 'objects' },
    { x: 18, y: 3, height: 2, flipped: false, name: "Hoge Blok", subCategory: 'objects' },
    { x: 8, y: 12, height: 1, flipped: false, moveable: true, name: "Verplaatsbaar Blok", subCategory: 'moveable' },
    { x: 16, y: 5, height: 2, flipped: false, name: "Winkel", subCategory: 'shop' },
    { x: 19, y: 5, height: 2, flipped: true, name: "Winkel", subCategory: 'shop' },
    { x: 12, y: 5, height: 1, flipped: false, name: "Container", subCategory: 'containers' },
    { x: 12, y: 8, height: 2, flipped: false, name: "Grote Container", subCategory: 'containers' },
    { x: 14, y: 8, height: 1, width: 2, depth: 1, flipped: false, name: "Brede Container", subCategory: 'containers' },
    { x: 8, y: 8, height: 1, flipped: false, name: "Prullenbak", subCategory: 'trash' }
];

const defaultItems = [
    { x: 8.5, y: 8.5, vx: 0, vy: 0, mass: 1.2, z: 0, vz: 0, rotation: 0, vr: 0, type: 'block' },
    { x: 12.5, y: 15.5, vx: 0, vy: 0, mass: 1.0, z: 0, vz: 0, rotation: 0, vr: 0, type: 'block' },
    { x: 10.5, y: 10.5, vx: 0, vy: 0, mass: 0.8, canRotate: true, z: 0, vz: 0, rotation: 0, vr: 0, type: 'ball' },
    { x: 14.5, y: 12.5, vx: 0, vy: 0, mass: 0.8, canRotate: true, z: 0, vz: 0, rotation: 0, vr: 0, type: 'ball' },
    { x: 9.5, y: 9.5, vx: 0, vy: 0, mass: 0.5, z: 0, vz: 0, rotation: 0, vr: 0, type: 'currency' },
    { x: 11.5, y: 9.5, vx: 0, vy: 0, mass: 0.5, z: 0, vz: 0, rotation: 0, vr: 0, type: 'currency_big' },
    { x: 12.5, y: 9.5, vx: 0, vy: 0, mass: 0.4, z: 0, vz: 0, rotation: 0, vr: 0, canTopple: true, type: 'stick' },
    { x: 13.5, y: 9.5, vx: 0, vy: 0, mass: 0.4, z: 0, vz: 0, rotation: 0, vr: 0, canTopple: true, name: "Batje Rood", type: 'bat_red' },
    { x: 14.5, y: 9.5, vx: 0, vy: 0, mass: 0.4, z: 0, vz: 0, rotation: 0, vr: 0, canTopple: true, name: "Batje Zwart", type: 'bat_black' }
];

// Functie om een specifieke kamer op te slaan
function saveRoom(roomId) {
    if (!rooms[roomId]) return;
    
    const roomData = {
        objects: rooms[roomId].objects,
        wallObjects: rooms[roomId].wallObjects,
        items: rooms[roomId].items,
        chatHistory: rooms[roomId].chatHistory,
        mapW: rooms[roomId].mapW,
        mapH: rooms[roomId].mapH,
        tileColors: rooms[roomId].tileColors,
        wallColors: rooms[roomId].wallColors,
        maxPlayers: rooms[roomId].maxPlayers,
        ownerId: rooms[roomId].ownerId, // Sla eigenaar op
        settings: rooms[roomId].settings // Sla instellingen op
    };

    fs.writeFile(path.join(ROOMS_DIR, `${roomId}.json`), JSON.stringify(roomData, null, 2), (err) => {
        if (err) console.error(`Fout bij opslaan kamer ${roomId}:`, err);
    });
}

// NIEUW: Functies om custom objects te laden en op te slaan
function loadCustomObjectsFromServer() {
    if (fs.existsSync(CUSTOM_OBJECTS_PATH)) {
        try {
            const data = fs.readFileSync(CUSTOM_OBJECTS_PATH);
            customObjects = JSON.parse(data);
            console.log(`✅ ${customObjects.length} custom objects geladen.`);
        } catch (e) {
            console.error("Fout bij laden custom_objects.json:", e);
        }
    }
}

function saveCustomObjectsToServer() {
    fs.writeFile(CUSTOM_OBJECTS_PATH, JSON.stringify(customObjects, null, 2), (err) => {
        if (err) console.error("Fout bij opslaan custom_objects.json:", err);
    });
}

// Helper: Genereer een unieke Room ID
function generateRoomId() {
    return Math.random().toString(36).substring(2, 7).toUpperCase();
}

// Helper: Maak een nieuwe lege kamer aan
function createRoom(id, options = {}) {
    const size = options.size || 25;
    
    // Bepaal limiet op basis van grootte
    let maxPlayers = 10;
    if (size === 5) maxPlayers = 10;
    else if (size === 10) maxPlayers = 25;
    else if (size === 20) maxPlayers = 50;
    else if (size === 30) maxPlayers = 100;

    rooms[id] = {
        objects: [], // Start met een lege lijst
        wallObjects: [],
        items: [], // Start met een lege lijst
        players: {},
        chatHistory: [],
        mapW: size,
        mapH: size,
        tileColors: {},
        wallColors: {},
        maxPlayers: maxPlayers,
        ownerId: options.ownerId || null, // Eigenaar ID
        settings: { doorbell: false, alwaysOnline: options.alwaysOnline || false, allowBuilding: options.allowBuilding || false } // Standaard instellingen
    };

    // Als we testroom aanmaken (of herstellen), vul hem met defaults
    if (id === 'testroom') {
        rooms[id].objects = JSON.parse(JSON.stringify(defaultObjects));
        rooms[id].items = JSON.parse(JSON.stringify(defaultItems));
        
        // Probeer te laden van default.json als die bestaat
        const defaultPath = path.join(ROOMS_DIR, 'default.json');
        if (fs.existsSync(defaultPath)) {
            try {
                const defaultData = JSON.parse(fs.readFileSync(defaultPath, 'utf8'));
                if (defaultData.objects) rooms[id].objects = defaultData.objects;
                if (defaultData.items) rooms[id].items = defaultData.items;
                if (defaultData.wallObjects) rooms[id].wallObjects = defaultData.wallObjects;
            } catch (e) {
                console.error("Kon default.json niet laden voor testroom:", e);
            }
        }
    }

    saveRoom(id);
    return rooms[id];
}

// Helper: Laad een kamer van schijf of uit geheugen
function getRoom(id) {
    // Check in-memory: als testroom leeg is (bv. per ongeluk gewist), herstel direct
    if (id === 'testroom' && rooms[id]) {
        if (rooms[id].objects.length === 0) {
            rooms[id].objects = JSON.parse(JSON.stringify(defaultObjects));
            rooms[id].items = JSON.parse(JSON.stringify(defaultItems));
            
            const defaultPath = path.join(ROOMS_DIR, 'default.json');
            if (fs.existsSync(defaultPath)) {
                try {
                    const defaultData = JSON.parse(fs.readFileSync(defaultPath, 'utf8'));
                    if (defaultData.objects) rooms[id].objects = defaultData.objects;
                    if (defaultData.items) rooms[id].items = defaultData.items;
                    if (defaultData.wallObjects) rooms[id].wallObjects = defaultData.wallObjects;
                } catch (e) {}
            }
            saveRoom(id);
        }
        return rooms[id];
    }
    
    if (rooms[id]) return rooms[id];

    const filePath = path.join(ROOMS_DIR, `${id}.json`);
    
    // MIGRATIE/HERSTEL: Als testroom gevraagd wordt, check of deze hersteld moet worden van default.json
    // Of als het bestand corrupt/leeg is.
    if (id === 'testroom' && !fs.existsSync(filePath)) {
        console.log("Testroom bestand niet gevonden, wordt opnieuw aangemaakt.");
        
        // Check of we default.json kunnen kopiëren
        const defaultPath = path.join(ROOMS_DIR, 'default.json');
        if (fs.existsSync(defaultPath)) {
            try {
                fs.copyFileSync(defaultPath, filePath);
                // Laad hem daarna normaal in
            } catch (e) {
                return createRoom('testroom', { size: 25 });
            }
        } else {
            return createRoom('testroom', { size: 25 });
        }
    }

    if (fs.existsSync(filePath)) {
        try {
            const data = JSON.parse(fs.readFileSync(filePath));
            data.players = {}; // Reset spelers
            if (!data.mapW) data.mapW = 25;
            if (!data.mapH) data.mapH = 25;
            if (!data.tileColors) data.tileColors = {};
            if (!data.wallColors) data.wallColors = {};
            
            // Zorg dat maxPlayers bestaat (voor oude kamers)
            if (!data.maxPlayers) {
                if (data.mapW === 5) data.maxPlayers = 10;
                else if (data.mapW === 10) data.maxPlayers = 25;
                else if (data.mapW === 20) data.maxPlayers = 50;
                else if (data.mapW === 30) data.maxPlayers = 100;
                else data.maxPlayers = 10;
            }
            
            // Zorg dat settings bestaan
            if (!data.settings) data.settings = { doorbell: false, alwaysOnline: false, allowBuilding: false };
            if (data.settings.allowBuilding === undefined) data.settings.allowBuilding = false;

            // Extra check: als testroom leeg is geladen, vul hem alsnog
            if (id === 'testroom' && (!data.objects || data.objects.length === 0)) {
                data.objects = JSON.parse(JSON.stringify(defaultObjects));
                data.items = JSON.parse(JSON.stringify(defaultItems));
                
                const defaultPath = path.join(ROOMS_DIR, 'default.json');
                if (fs.existsSync(defaultPath)) {
                    try {
                        const defaultData = JSON.parse(fs.readFileSync(defaultPath, 'utf8'));
                        if (defaultData.objects) data.objects = defaultData.objects;
                        if (defaultData.items) data.items = defaultData.items;
                        if (defaultData.wallObjects) data.wallObjects = defaultData.wallObjects;
                    } catch (e) {}
                }
            }

            rooms[id] = data;
            return data;
        } catch (e) {
            console.error(`Fout bij laden kamer ${id}:`, e);
        }
    }
    return null;
}

// Helper: Check of een positie bezet is
function isPositionOccupied(room, x, y) {
    if (room.players && Object.values(room.players).some(p => Math.floor(p.x) === x && Math.floor(p.y) === y)) return true;
    if (room.objects) {
        return room.objects.some(o => {
            const w = o.flipped ? (o.depth || 1) : (o.width || 1);
            const d = o.flipped ? (o.width || 1) : (o.depth || 1);
            return x >= o.x && x < o.x + w && y >= o.y && y < o.y + d;
        });
    }
    return false;
}

// Helper: Vind dichtstbijzijnde vrije tegel
function findNearestFreeTile(room, startX, startY) {
    const mapW = room.mapW || 25;
    const mapH = room.mapH || 25;

    let x = Math.floor(startX);
    let y = Math.floor(startY);
    
    // Check of startpositie binnen de kaart valt. Zo niet, reset naar 0,0
    if (x < 0 || x >= mapW || y < 0 || y >= mapH) {
        x = 0;
        y = 0;
    }

    if (!isPositionOccupied(room, x, y)) return { x, y };

    // Zoek eerste vrije plek binnen de grenzen van de kamer
    for (let j = 0; j < mapH; j++) {
        for (let i = 0; i < mapW; i++) {
            if (!isPositionOccupied(room, i, j)) {
                return { x: i, y: j };
            }
        }
    }
    return { x: 0, y: 0 }; // Fallback
}

function getPlayerBySocketId(socketId) {
    const roomId = socketRoomMap[socketId];
    if (!roomId || !rooms[roomId]) return null;
    return rooms[roomId].players[socketId];
}

// Helper: Vote kick afronden
function finishVote(roomId) {
    const room = rooms[roomId];
    if (!room || !room.activeVote) return;
    
    const voteData = room.activeVote;
    room.activeVote = null; // Reset
    
    const yesVotes = Object.values(voteData.votes).filter(v => v).length;
    const totalVotes = Object.values(voteData.votes).length;
    
    // 10 stemmen nodig om te kicken
    if (yesVotes >= 10) {
        io.to(voteData.targetId).emit('kicked', roomId);
        io.to(roomId).emit('voteKickResult', { 
            success: true, 
            targetName: voteData.targetName 
        });
    } else {
        io.to(roomId).emit('voteKickResult', { 
            success: false, 
            targetName: voteData.targetName 
        });
    }
}


io.on('connection', (socket) => {
  console.log('Nieuwe speler verbonden:', socket.id);

  // NIEUW: Stuur de lijst met custom objects als de client erom vraagt
  socket.on('getCustomObjects', () => {
      console.log(`Versturen van ${customObjects.length} custom objects naar ${socket.id}`);
      socket.emit('customObjectList', customObjects);
  });

  // Stuur lijst met bestaande kamers naar de admin
  socket.on('getRooms', () => {
      fs.readdir(ROOMS_DIR, (err, files) => {
          if (err) {
              socket.emit('roomList', []);
              return;
          }
          
          // Bepaal welke owners online zijn
          const onlineUserIds = new Set();
          io.sockets.sockets.forEach(s => { if(s.userId) onlineUserIds.add(s.userId); });
          
          // Haal vrienden op voor friendCount
          const myFriends = friendsData[socket.userId] || [];
          const myFriendIds = new Set(myFriends.map(f => f.userId));

          const roomIds = files.filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''));
          
          const roomDataWithCount = roomIds.map(id => {
              // We moeten de kamer laden om maxPlayers te weten als hij nog niet in memory zit
              const room = rooms[id] || getRoom(id); 
              const playerCount = room && room.players ? Object.keys(room.players).length : 0;
              const hasDoorbell = room && room.settings ? room.settings.doorbell : false;
              const isAlwaysOnline = room && room.settings ? room.settings.alwaysOnline : false;
              const allowBuilding = room && room.settings ? room.settings.allowBuilding : false;
              const isOwnerOnline = id === 'testroom' || (room && room.ownerId && onlineUserIds.has(room.ownerId));
              const friendCount = room && room.players ? Object.values(room.players).filter(p => myFriendIds.has(p.userId)).length : 0;
              
              return { 
                  id: id, 
                  playerCount: playerCount, 
                  maxPlayers: room ? (room.maxPlayers || 10) : 10, 
                  hasDoorbell: hasDoorbell,
                  isAlwaysOnline: isAlwaysOnline,
                  allowBuilding: allowBuilding,
                  isOwnerOnline: isOwnerOnline,
                  friendCount: friendCount
              };
          });
          socket.emit('roomList', roomDataWithCount);
      });
  });

  socket.on('createRoom', () => {
      const newId = generateRoomId();
      createRoom(newId);
      socket.emit('roomCreated', newId);
  });

  socket.on('joinRoom', (data) => {
      const roomId = data.roomId || 'testroom';
      const userId = data.userId; // Unieke ID van de speler (persistent)
      
      socket.userId = userId; // Store on socket for easy access
      let room = getRoom(roomId);
      if (!room) {
          room = createRoom(roomId, { size: data.size, ownerId: userId, alwaysOnline: data.alwaysOnline === true, allowBuilding: data.allowBuilding === true });
      } else if (room.ownerId === userId) {
          // Update bestaande kamer als eigenaar joint met specifieke instelling (via create menu)
          if (!room.settings) room.settings = {};
          let changed = false;
          if (data.alwaysOnline !== null && data.alwaysOnline !== undefined) { room.settings.alwaysOnline = data.alwaysOnline; changed = true; }
          if (data.allowBuilding !== null && data.allowBuilding !== undefined) { room.settings.allowBuilding = data.allowBuilding; changed = true; }
          
          if (changed) saveRoom(roomId);
      }

      // Check limiet
      const currentCount = Object.keys(room.players).length;
      if (currentCount >= (room.maxPlayers || 10)) {
          socket.emit('joinError', 'Deze kamer zit vol!');
          return;
      }

      socket.join(roomId);
      socketRoomMap[socket.id] = roomId;

      let preferredX = 0;
      let preferredY = 0;
      if (data && typeof data.x === 'number' && typeof data.y === 'number') {
          preferredX = data.x;
          preferredY = data.y;
      }

      const spawn = findNearestFreeTile(room, preferredX, preferredY);

      room.players[socket.id] = {
        x: spawn.x + 0.5,
        y: spawn.y + 0.5,
        id: socket.id,
        color: '#' + Math.floor(Math.random()*16777215).toString(16),
        userId: userId, // Store persistent ID
        name: "Alumni " + socket.id.substr(0,4)
      };

      socket.emit('chatHistory', room.chatHistory);

      socket.emit('initGame', { 
          id: socket.id, 
          startX: spawn.x + 0.5, 
          startY: spawn.y + 0.5,
          objects: room.objects,        
          wallObjects: room.wallObjects, 
          items: room.items,
          mapW: room.mapW,
          mapH: room.mapH,
          tileColors: room.tileColors,
          wallColors: room.wallColors,
          isOwner: room.ownerId === userId, // Vertel client of hij eigenaar is
          roomSettings: room.settings
      });
      
      io.to(roomId).emit('updatePlayerList', room.players);
  });

  socket.on('playerMovement', (movementData) => {
    const roomId = socketRoomMap[socket.id];
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];

    if (room.players[socket.id]) {
      room.players[socket.id].x = movementData.x;
      room.players[socket.id].y = movementData.y;
      if (movementData.isSmoking !== undefined) room.players[socket.id].isSmoking = movementData.isSmoking; // NIEUW: Rookstatus opslaan
      if (movementData.smokingItemType !== undefined) room.players[socket.id].smokingItemType = movementData.smokingItemType; // NIEUW: Type sigaret opslaan
      socket.to(roomId).emit('playerMoved', room.players[socket.id]);
    }
  });

  socket.on('chatMessage', (msg) => {
    const roomId = socketRoomMap[socket.id];
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];

    const chatData = {
      user: room.players[socket.id] ? room.players[socket.id].name : "Alumni " + socket.id.substr(0,4),
      text: msg,
      id: socket.id,
      userId: room.players[socket.id] ? room.players[socket.id].userId : null, // Send persistent ID
      time: Date.now()
    };
    
    room.chatHistory.push(chatData);
    if (room.chatHistory.length > 50) room.chatHistory.shift();
    io.to(roomId).emit('chatMessage', chatData);
  });

  socket.on('placeObject', (obj) => {
      const roomId = socketRoomMap[socket.id];
      if (!roomId || !rooms[roomId]) return;
      const room = rooms[roomId];
      // NIEUW: Ken uniek ID toe
      if (!obj.id) obj.id = Date.now().toString(36) + Math.random().toString(36).substr(2);
      room.objects.push(obj);
      io.to(roomId).emit('updateObjects', room.objects); 
      saveRoom(roomId);
  });

  // NIEUW: Plaats een los item (spawn)
  socket.on('placeItem', (item) => {
      const roomId = socketRoomMap[socket.id];
      if (!roomId || !rooms[roomId]) return;
      const room = rooms[roomId];
      room.items.push(item);
      io.to(roomId).emit('updateItems', room.items);
      saveRoom(roomId);
  });

  // NIEUW: Verwijder een item op specifieke coördinaten
  socket.on('removeItem', (coords) => {
      const roomId = socketRoomMap[socket.id];
      if (!roomId || !rooms[roomId]) return;
      const room = rooms[roomId];
      const idx = room.items.findIndex(i => {
          if (Math.floor(i.x) !== coords.x || Math.floor(i.y) !== coords.y) return false;
          if (coords.type && i.type !== coords.type) return false;
          if (coords.name && i.name !== coords.name) return false;
          return true;
      });
      if (idx > -1) {
          room.items.splice(idx, 1);
          io.to(roomId).emit('updateItems', room.items);
          saveRoom(roomId);
      }
  });

  socket.on('removeObject', (coords) => {
      const roomId = socketRoomMap[socket.id];
      if (!roomId || !rooms[roomId]) return;
      const room = rooms[roomId];
      // FIX: Check ook op naam als die is meegegeven, om te voorkomen dat we de vloer verwijderen ipv een object
      const idx = room.objects.findIndex(o => {
          if (coords.id && o.id) return o.id === coords.id; // NIEUW: Zoek op ID indien beschikbaar
          if (o.x !== coords.x || o.y !== coords.y) return false;
          if (coords.name && o.name !== coords.name) return false;
          return true;
      });
      if (idx > -1) {
          room.objects.splice(idx, 1);
          io.to(roomId).emit('updateObjects', room.objects);
          saveRoom(roomId);
      }
  });

  socket.on('placeWallObject', (obj) => {
      const roomId = socketRoomMap[socket.id];
      if (!roomId || !rooms[roomId]) return;
      const room = rooms[roomId];
      // NIEUW: Ken uniek ID toe
      if (!obj.id) obj.id = Date.now().toString(36) + Math.random().toString(36).substr(2);
      room.wallObjects.push(obj);
      io.to(roomId).emit('updateWallObjects', room.wallObjects);
      saveRoom(roomId);
  });

  socket.on('removeWallObject', (data) => {
      const roomId = socketRoomMap[socket.id];
      if (!roomId || !rooms[roomId]) return;
      const room = rooms[roomId];
      
      let wallId, name, id;
      if (typeof data === 'string') {
          wallId = data; // Backwards compatibility
      } else {
          wallId = data.wallId;
          name = data.name;
          id = data.id;
      }

      const idx = room.wallObjects.findIndex(o => {
          if (id && o.id) return o.id === id; // NIEUW: Zoek op ID indien beschikbaar
          return o.wallId === wallId && (!name || o.name === name);
      });

      if (idx > -1) {
          room.wallObjects.splice(idx, 1);
          io.to(roomId).emit('updateWallObjects', room.wallObjects);
          saveRoom(roomId);
      }
  });

  socket.on('updateItems', (newItems) => {
      const roomId = socketRoomMap[socket.id];
      if (!roomId || !rooms[roomId]) return;
      const room = rooms[roomId];
      room.items.length = 0;
      newItems.forEach(i => room.items.push(i));
      socket.to(roomId).emit('updateItems', room.items);
      saveRoom(roomId);
  });

  // NIEUW: Handmatig opslaan (hoewel alles auto-saved is dit een extra trigger)
  socket.on('manualSaveRoom', (data) => {
      const roomId = socketRoomMap[socket.id];
      if (!roomId || !rooms[roomId]) return;
      const room = rooms[roomId];

      // Update de kamer staat met de data van de admin
      if (data.objects) room.objects = data.objects;
      if (data.wallObjects) room.wallObjects = data.wallObjects;
      if (data.items) room.items = data.items;
      if (data.tileColors) room.tileColors = data.tileColors;
      if (data.wallColors) room.wallColors = data.wallColors;
      
      // Sla de bijgewerkte kamer op
      saveRoom(roomId);
  });

  // NIEUW: Haal data op van mijn eigen kamer (ongeacht waar ik ben)
  socket.on('getMyRoomData', (userId) => {
      let myRoomId = null;
      let mySettings = null;
      // Zoek de kamer van deze user
      for (const [id, room] of Object.entries(rooms)) {
          if (room.ownerId === userId) {
              myRoomId = id;
              mySettings = room.settings;
              break;
          }
      }
      socket.emit('myRoomData', { roomId: myRoomId, settings: mySettings });
  });

  // NIEUW: Update kamer instellingen (bijv. deurbel)
  socket.on('updateRoomSettings', (data) => {
      // data = { roomId, settings }
      const targetRoomId = data.roomId;
      const newSettings = data.settings;

      if (!targetRoomId || !rooms[targetRoomId]) return;
      
      // Check eigenaarschap
      if (rooms[targetRoomId].ownerId !== socket.userId) return;
      
      rooms[targetRoomId].settings = { ...rooms[targetRoomId].settings, ...newSettings };
      saveRoom(targetRoomId);
      
      // Stuur update naar iedereen in de kamer (voor UI updates indien nodig)
      io.to(targetRoomId).emit('roomSettingsUpdated', rooms[targetRoomId].settings);
      socket.emit('myRoomSettingsUpdated', { roomId: targetRoomId, settings: rooms[targetRoomId].settings });
  });

  // NIEUW: Iemand belt aan
  socket.on('ringDoorbell', (roomId) => {
      const room = rooms[roomId] || getRoom(roomId);
      if (!room) return;

      // Zoek de eigenaar in de kamer (moet online zijn om open te doen)
      // We zoeken op basis van ownerId die we bij createRoom hebben opgeslagen
      // Omdat we geen echte auth hebben, moeten we even slim zijn.
      // We sturen het naar alle sockets in de kamer, de client filtert wel of hij eigenaar is.
      // Of beter: we sturen het naar de specifieke socket als we die kunnen vinden.
      
      // Voor nu: stuur naar iedereen in de kamer "Iemand belt aan", client checkt "ben ik eigenaar?"
      io.to(roomId).emit('doorbellRung', { visitorId: socket.id, visitorName: "Bezoeker" }); // Naam zou uit handshake kunnen komen
  });

  // NIEUW: Eigenaar reageert op bel
  socket.on('answerDoorbell', (data) => {
      // data = { visitorId: ..., accepted: true/false }
      io.to(data.visitorId).emit('doorbellResult', { accepted: data.accepted, roomId: socketRoomMap[socket.id] });
  });

  // NIEUW: Kick speler
  socket.on('kickPlayer', (data) => {
      const roomId = socketRoomMap[socket.id];
      if (!roomId || !rooms[roomId]) return;
      
      const room = rooms[roomId];
      const targetSocketId = data.targetId;
      const targetPlayer = room.players[targetSocketId];
      if (!targetPlayer) return;

      // Scenario 1: Privé kamer (Studio) - Alleen eigenaar mag kicken
      if (room.ownerId) {
          if (room.ownerId === socket.userId) {
              io.to(targetSocketId).emit('kicked', roomId);
          }
          return;
      }

      // Scenario 2: Publieke kamer - Start een vote kick
      if (!room.ownerId) {
          if (room.activeVote) return; // Al een vote bezig

          room.activeVote = {
              targetId: targetSocketId,
              targetName: targetPlayer.name,
              initiatorId: socket.id,
              votes: {},
              timer: setTimeout(() => finishVote(roomId), 30000) // 30 sec tijd
          };
          
          // Initiator stemt automatisch voor
          room.activeVote.votes[socket.id] = true;

          // Stuur bericht naar iedereen in de kamer
          io.to(roomId).emit('voteKickStarted', {
              targetId: targetSocketId,
              targetName: targetPlayer.name,
              initiatorName: room.players[socket.id].name,
              initiatorId: socket.id
          });

          // Stuur update over aantal stemmen (start met 1)
          io.to(roomId).emit('voteUpdate', {
              count: 1,
              needed: 10,
              targetName: targetPlayer.name
          });
      }
  });

  // NIEUW: Vriendschap verzoek
  socket.on('sendFriendRequest', (data) => {
      const senderName = rooms[socketRoomMap[socket.id]].players[socket.id].name;
      io.to(data.targetId).emit('friendRequestReceived', { 
          senderId: socket.id, 
          senderName: senderName 
      });
  });

  // NIEUW: Reageer op vriendschap
  socket.on('respondFriendRequest', (data) => {
      const responder = getPlayerBySocketId(socket.id);
      const sender = getPlayerBySocketId(data.senderId);
      
      if (data.accepted && responder && sender) {
          // Voeg toe aan vriendenlijst (wederzijds)
          if (!friendsData[responder.userId]) friendsData[responder.userId] = [];
          if (!friendsData[sender.userId]) friendsData[sender.userId] = [];

          // Check duplicaten
          if (!friendsData[responder.userId].some(f => f.userId === sender.userId)) {
              friendsData[responder.userId].push({ userId: sender.userId, name: sender.name });
          }
          if (!friendsData[sender.userId].some(f => f.userId === responder.userId)) {
              friendsData[sender.userId].push({ userId: responder.userId, name: responder.name });
          }
          saveFriends();
      }

      if (sender) {
          io.to(data.senderId).emit('friendRequestResult', {
              responderName: responder ? responder.name : "Iemand",
              accepted: data.accepted
          });
      }
  });

  // NIEUW: Vriendenlijst ophalen
  socket.on('getFriends', () => {
      if (!socket.userId) return;
      
      const myFriends = friendsData[socket.userId] || [];
      const onlineUserMap = new Map(); // userId -> roomId
      
      io.sockets.sockets.forEach(s => {
          if (s.userId) onlineUserMap.set(s.userId, socketRoomMap[s.id]);
      });

      const enrichedFriends = myFriends.map(f => ({
          ...f,
          isOnline: onlineUserMap.has(f.userId),
          roomId: onlineUserMap.get(f.userId)
      }));

      socket.emit('friendsList', enrichedFriends);
  });

  // NIEUW: Haal spelers op van een specifieke kamer
  socket.on('getRoomPlayers', (roomId) => {
      const room = rooms[roomId];
      if (room && room.players) {
          const playerList = Object.values(room.players).map(p => ({
              id: p.id,
              name: p.name,
              userId: p.userId
          }));
          socket.emit('roomPlayersList', { roomId, players: playerList, ownerId: room.ownerId });
      } else {
          socket.emit('roomPlayersList', { roomId, players: [], ownerId: null });
      }
  });

  // NIEUW: Vriend verwijderen
  socket.on('removeFriend', (friendUserId) => {
      const myUserId = socket.userId;
      if (!myUserId || !friendsData[myUserId]) return;

      friendsData[myUserId] = friendsData[myUserId].filter(f => f.userId !== friendUserId);
      // Ook verwijderen bij de ander? Meestal wel in simpele systemen.
      if (friendsData[friendUserId]) {
          friendsData[friendUserId] = friendsData[friendUserId].filter(f => f.userId !== myUserId);
      }
      saveFriends();
      socket.emit('friendsList', friendsData[myUserId]);
  });

  // NIEUW: Maak kamer leeg (Admin tool)
  socket.on('clearRoom', () => {
      const roomId = socketRoomMap[socket.id];
      if (!roomId || !rooms[roomId]) return;
      
      const room = rooms[roomId];
      room.objects = [];
      room.wallObjects = [];
      room.items = [];
      
      saveRoom(roomId);
      
      io.to(roomId).emit('updateObjects', room.objects);
      io.to(roomId).emit('updateWallObjects', room.wallObjects);
      io.to(roomId).emit('updateItems', room.items);
  });

  socket.on('updateTileColor', (data) => {
      const roomId = socketRoomMap[socket.id];
      if (!roomId || !rooms[roomId]) return;
      rooms[roomId].tileColors[data.key] = data.color;
      socket.to(roomId).emit('updateTileColor', data);
  });

  socket.on('updateWallColor', (data) => {
      const roomId = socketRoomMap[socket.id];
      if (!roomId || !rooms[roomId]) return;
      rooms[roomId].wallColors[data.id] = data.color;
      socket.to(roomId).emit('updateWallColor', data);
  });

  // NIEUW: Upload een custom object
  socket.on('uploadCustomObject', (data) => {
      if (!data || !data.imageData || !data.template) {
          return; // Ongeldige data
      }

      // Genereer een unieke bestandsnaam
      const filename = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}.png`;
      const imagePath = path.join(UPLOADS_DIR, 'objects', filename);
      const imageUrl = `/uploads/objects/${filename}`; // URL voor de client

      // Sla de afbeelding op
      fs.writeFile(imagePath, data.imageData, (err) => {
          if (err) {
              console.error("Fout bij opslaan geüploade afbeelding:", err);
              return;
          }

          let objectName = data.name || `Custom ${data.template.name}`;
          
          // Check op dubbele namen en voeg nummer toe indien nodig
          let nameCheck = objectName;
          let counter = 1;
          while (customObjects.some(o => o.name === nameCheck)) {
              nameCheck = `${objectName} (${counter})`;
              counter++;
          }
          objectName = nameCheck;

          // Maak de nieuwe objectdefinitie
          const newObject = {
              ...data.template,
              name: objectName,
              image: imageUrl, // Gebruik de server URL
              price: data.price ? parseFloat(data.price) : 0, // Sla prijs op
              adminOnly: !!data.adminOnly, // Sla adminOnly status op
              surfaceHeight: data.surfaceHeight ? parseInt(data.surfaceHeight, 10) : undefined,
              // Gebruik de meegestuurde configuratie of val terug op de template
              width: data.width ? parseInt(data.width) : (data.template.width || 1),
              depth: data.depth ? parseInt(data.depth) : (data.template.depth || 1),
              height: data.height ? parseInt(data.height) : (data.template.height || 1),
              moveable: data.moveable !== undefined ? data.moveable : (data.template.moveable || false),
              isFloor: data.isFloor !== undefined ? data.isFloor : (data.template.isFloor || false),
              isTemplate: true,
              isCustom: true
          };

          customObjects.push(newObject);
          saveCustomObjectsToServer();
          io.emit('customObjectAdded', newObject); // Stuur naar ALLE clients
      });
  });

  // NIEUW: Verwijder een custom object (Admin only)
  socket.on('deleteCustomObject', (name) => {
      const objIndex = customObjects.findIndex(o => o.name === name);
      if (objIndex === -1) return;

      const objDef = customObjects[objIndex];
      const price = objDef.price || 0;

      // Verwijder het bijbehorende bestand als het een custom object is
      if (objDef.isCustom && objDef.image) {
          const filename = path.basename(objDef.image);
          const filePath = path.join(UPLOADS_DIR, 'objects', filename);
          
          fs.unlink(filePath, (err) => {
              if (err && err.code !== 'ENOENT') {
                  console.error(`Fout bij verwijderen bestand ${filePath}:`, err);
              }
          });
      }

      // Verwijder uit de lijst en sla op
      customObjects.splice(objIndex, 1);
      saveCustomObjectsToServer();

      // Vertel iedereen dat dit object weg is (voor bouwmenu en inventaris refund)
      io.emit('customObjectDeleted', { name: name, price: price });

      // Verwijder geplaatste instanties uit ALLE kamers (ook op schijf) en refund eigenaren
      const files = fs.readdirSync(ROOMS_DIR);
      
      files.forEach(file => {
          if (!file.endsWith('.json')) return;
          const roomId = file.replace('.json', '');
          
          // Als kamer in geheugen zit, gebruik die, anders laad tijdelijk van schijf
          let room = rooms[roomId];
          let isInMemory = !!room;

          if (!room) {
              try {
                  const content = fs.readFileSync(path.join(ROOMS_DIR, file), 'utf8');
                  room = JSON.parse(content);
              } catch(e) {
                  console.error(`Fout bij lezen kamer ${file} voor opschonen:`, e);
                  return;
              }
          }

          let changed = false;

          // Filter vloer objecten
          if (room.objects) {
              const originalLen = room.objects.length;
              room.objects = room.objects.filter(o => {
                  if (o.name === name) {
                      if (o.ownerId && price > 0) {
                          io.to(o.ownerId).emit('refund', { amount: price, reason: `Geplaatst item "${name}" verwijderd door admin.` });
                      }
                      return false;
                  }
                  return true;
              });
              if (room.objects.length !== originalLen) changed = true;
          }

          // Filter muur objecten
          if (room.wallObjects) {
              const originalLen = room.wallObjects.length;
              room.wallObjects = room.wallObjects.filter(o => {
                  if (o.name === name) {
                      if (o.ownerId && price > 0) {
                          io.to(o.ownerId).emit('refund', { amount: price, reason: `Geplaatst item "${name}" verwijderd door admin.` });
                      }
                      return false;
                  }
                  return true;
              });
              if (room.wallObjects.length !== originalLen) changed = true;
          }

          if (changed) {
              if (isInMemory) {
                  saveRoom(roomId);
                  io.to(roomId).emit('updateObjects', room.objects);
                  io.to(roomId).emit('updateWallObjects', room.wallObjects);
              } else {
                  // Schrijf direct naar bestand als kamer niet geladen is
                  fs.writeFile(path.join(ROOMS_DIR, file), JSON.stringify(room, null, 2), (err) => {
                      if (err) console.error(`Fout bij opslaan opgeschoonde kamer ${file}:`, err);
                  });
              }
          }
      });
  });

  // NIEUW: Hernoem een kamer
  socket.on('renameRoom', ({ oldId, newId }) => {
      if (!oldId || !newId) return;
      if (oldId === 'testroom') {
          return socket.emit('renameError', 'De testroom kan niet worden hernoemd.');
      }

      const sanitizedNewId = newId.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      if (!sanitizedNewId) {
          return socket.emit('renameError', 'De nieuwe naam is ongeldig.');
      }
      if (sanitizedNewId === oldId) return; // Geen wijziging

      const oldPath = path.join(ROOMS_DIR, `${oldId}.json`);
      const newPath = path.join(ROOMS_DIR, `${sanitizedNewId}.json`);

      if (!fs.existsSync(oldPath)) {
          return socket.emit('renameError', 'De te hernoemen kamer bestaat niet.');
      }
      if (fs.existsSync(newPath)) {
          return socket.emit('renameError', `Een kamer met de naam "${sanitizedNewId}" bestaat al.`);
      }

      fs.rename(oldPath, newPath, (err) => {
          if (err) {
              console.error(`Fout bij hernoemen van kamer ${oldId}:`, err);
              return socket.emit('renameError', 'Er is een serverfout opgetreden bij het hernoemen.');
          }

          if (rooms[oldId]) {
              rooms[sanitizedNewId] = rooms[oldId];
              delete rooms[oldId];
          }
          io.emit('roomRenamed', { oldId, newId: sanitizedNewId });
      });
  });

  // NIEUW: Toggle Always Online status
  socket.on('toggleAlwaysOnline', (roomId) => {
      if (!roomId || !rooms[roomId]) return;
      
      if (!rooms[roomId].settings) rooms[roomId].settings = {};
      rooms[roomId].settings.alwaysOnline = !rooms[roomId].settings.alwaysOnline;
      
      saveRoom(roomId);
      io.emit('roomAlwaysOnlineToggled', roomId);
  });

  // NIEUW: Toggle Allow Building status
  socket.on('toggleAllowBuilding', (roomId) => {
      if (!roomId || !rooms[roomId]) return;
      
      if (!rooms[roomId].settings) rooms[roomId].settings = {};
      if (rooms[roomId].settings.allowBuilding === undefined) rooms[roomId].settings.allowBuilding = false;
      rooms[roomId].settings.allowBuilding = !rooms[roomId].settings.allowBuilding;
      
      saveRoom(roomId);
      io.emit('roomAllowBuildingToggled', roomId);
  });

  // NIEUW: Verwijder een kamer
  socket.on('deleteRoom', (targetRoomId) => {
      if (targetRoomId === 'testroom') return; // Beveiliging: testroom mag niet weg
      
      const filePath = path.join(ROOMS_DIR, `${targetRoomId}.json`);
      if (fs.existsSync(filePath)) {
          fs.unlink(filePath, (err) => {
              if (!err) {
                  delete rooms[targetRoomId];
                  // Stuur update naar iedereen (bijv. admin menu verversen)
                  socket.emit('roomDeleted', targetRoomId);
              }
          });
      }
  });

  socket.on('requestPong', (data) => {
      const roomId = socketRoomMap[socket.id];
      if (!roomId || !rooms[roomId]) return;
      const room = rooms[roomId];

      const tableX = data.tableX;
      const tableY = data.tableY;
      const opponent = Object.values(room.players).find(p => {
          if (p.id === socket.id) return false;
          const dist = Math.sqrt(Math.pow(p.x - tableX, 2) + Math.pow(p.y - tableY, 2));
          return dist < 4.0;
      });

      if (opponent) {
          io.to(opponent.id).emit('pongChallenge', {
              challengerId: socket.id,
              challengerName: room.players[socket.id].name
          });
          socket.emit('pongWaiting', { opponentName: opponent.name });
      } else {
          socket.emit('startPongAI');
      }
  });

  socket.on('acceptPong', (data) => {
      const roomId = socketRoomMap[socket.id];
      if (!roomId || !rooms[roomId]) return;
      const room = rooms[roomId];
      const challenger = room.players[data.challengerId];
      const acceptor = room.players[socket.id];
      
      if (challenger && acceptor) {
          io.to(challenger.id).emit('startPongPvP', { 
              opponentId: socket.id, 
              opponentName: acceptor.name,
              isHost: true
          });
          socket.emit('startPongPvP', { 
              opponentId: challenger.id, 
              opponentName: challenger.name,
              isHost: false
          });
      }
  });

  socket.on('pongPaddleMove', (data) => {
      if (data.opponentId) {
          io.to(data.opponentId).emit('opponentPaddleMove', { y: data.y });
      }
  });

  socket.on('pongBallUpdate', (data) => {
      if (data.opponentId) {
          io.to(data.opponentId).emit('pongBallUpdate', {
              x: 600 - data.x,
              y: data.y
          });
      }
  });

  socket.on('pongScoreUpdate', (data) => {
      if (data.opponentId) {
          io.to(data.opponentId).emit('pongScoreUpdate', {
              playerScore: data.aiScore,
              aiScore: data.playerScore
          });
      }
  });

  socket.on('requestPongPause', (data) => {
      const roomId = socketRoomMap[socket.id];
      if (!roomId || !rooms[roomId]) return;
      const room = rooms[roomId];
      if (data.opponentId) {
           const name = room.players[socket.id] ? room.players[socket.id].name : "Speler";
           io.to(data.opponentId).emit('pongPaused', { name: name });
           socket.emit('pongPaused', { name: "Jij" });
      }
  });

  socket.on('quitPong', (data) => {
      const roomId = socketRoomMap[socket.id];
      if (!roomId || !rooms[roomId]) return;
      const room = rooms[roomId];
      const quitter = room.players[socket.id];
      if (data.opponentId) {
          io.to(data.opponentId).emit('pongStopped', { name: quitter ? quitter.name : "Tegenstander" });
      }
  });

  // NIEUW: Stemmen op een kick
  socket.on('castKickVote', (data) => {
      const roomId = socketRoomMap[socket.id];
      if (!roomId || !rooms[roomId]) return;
      const room = rooms[roomId];
      
      if (!room.activeVote) return;
      if (socket.id === room.activeVote.targetId) return; // Target mag niet stemmen

      room.activeVote.votes[socket.id] = data.vote; // true of false
      
      // Update counter voor iedereen
      const votesCast = Object.keys(room.activeVote.votes).length;
      io.to(roomId).emit('voteUpdate', {
          count: votesCast,
          needed: 10,
          targetName: room.activeVote.targetName
      });

      // Check of iedereen heeft gestemd (behalve target)
      const playerCount = Object.keys(room.players).length;
      const eligibleVoters = playerCount - 1; 
      
      if (votesCast >= eligibleVoters) {
          clearTimeout(room.activeVote.timer);
          finishVote(roomId);
      }
  });

  socket.on('disconnect', () => {
    console.log('Speler weg:', socket.id);
    const roomId = socketRoomMap[socket.id];
    if (roomId && rooms[roomId]) {
        // Als target van vote weggaat, stop vote
        if (rooms[roomId].activeVote && rooms[roomId].activeVote.targetId === socket.id) {
            clearTimeout(rooms[roomId].activeVote.timer);
            rooms[roomId].activeVote = null;
            io.to(roomId).emit('voteKickResult', { success: false, targetName: "Speler", reason: "Target left" });
        }

        delete rooms[roomId].players[socket.id];
        io.to(roomId).emit('updatePlayerList', rooms[roomId].players);
    }
    
    // Als de eigenaar weggaat, sluit zijn kamers (kick spelers naar atrium)
    if (socket.userId) {
        Object.keys(rooms).forEach(rId => {
            if (rooms[rId].ownerId === socket.userId) {
                // Stuur iedereen in deze kamer naar huis
                io.to(rId).emit('roomClosed');
            }
        });
    }
    
    delete socketRoomMap[socket.id];
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  loadCustomObjectsFromServer(); // Laad de objecten bij het opstarten
  console.log(`🚀 Server draait op http://localhost:${PORT} (Versie: Rooms Engine)`);
});
