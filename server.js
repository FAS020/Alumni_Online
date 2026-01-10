const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const https = require('https');
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
    try { friendsData = JSON.parse(fs.readFileSync(FRIENDS_PATH, 'utf8')); } catch(e) {}
}

function saveFriends() {
    fs.writeFile(FRIENDS_PATH, JSON.stringify(friendsData, null, 2), (err) => { if(err) console.error(err); });
}

// NIEUW: Spelers opslag (Inventory & Geld)
const PLAYERS_PATH = path.join(__dirname, 'players.json');
let playersData = {};
if (fs.existsSync(PLAYERS_PATH)) {
    try { playersData = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf8')); } catch(e) {}
}

function savePlayers() {
    fs.writeFile(PLAYERS_PATH, JSON.stringify(playersData, null, 2), (err) => { if(err) console.error(err); });
}

// NIEUW: Server instellingen (Persistentie voor o.a. weer sync)
const SERVER_SETTINGS_PATH = path.join(__dirname, 'server_settings.json');
let serverSettings = { realTimeSync: false }; // Default

if (fs.existsSync(SERVER_SETTINGS_PATH)) {
    try {
        serverSettings = JSON.parse(fs.readFileSync(SERVER_SETTINGS_PATH, 'utf8'));
    } catch (e) {
        console.error("Fout bij laden server settings:", e);
    }
}

function saveServerSettings() {
    fs.writeFile(SERVER_SETTINGS_PATH, JSON.stringify(serverSettings, null, 2), (err) => {
        if (err) console.error("Fout bij opslaan server settings:", err);
    });
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
        puddles: rooms[roomId].puddles,
        snow: rooms[roomId].snow,
        maxPlayers: rooms[roomId].maxPlayers,
        ownerId: rooms[roomId].ownerId, // Sla eigenaar op
        spawnPoint: rooms[roomId].spawnPoint, // NIEUW: Sla spawn op
        settings: rooms[roomId].settings // Sla instellingen op
    };

    fs.writeFile(path.join(ROOMS_DIR, `${roomId}.json`), JSON.stringify(roomData, null, 2), (err) => {
        if (err) console.error(`Fout bij opslaan kamer ${roomId}:`, err);
    });
}

// NIEUW: Throttle voor opslaan om disk I/O te sparen bij physics updates
const saveTimers = {};
function scheduleRoomSave(roomId) {
    if (saveTimers[roomId]) return; // Al gepland
    saveTimers[roomId] = setTimeout(() => {
        saveRoom(roomId);
        delete saveTimers[roomId];
    }, 1000); // Sla max 1x per seconde op
}

// NIEUW: Functies om custom objects te laden en op te slaan
function loadCustomObjectsFromServer() {
    if (fs.existsSync(CUSTOM_OBJECTS_PATH)) {
        try {
            const data = fs.readFileSync(CUSTOM_OBJECTS_PATH, 'utf8');
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

// ─────────────────────────────────────────────
// 🌦️ REAL-TIME WEATHER SYNC
// ─────────────────────────────────────────────
let realTimeInterval = null;

// Start de sync direct als deze was opgeslagen als 'aan'
if (serverSettings.realTimeSync) {
    // Korte timeout om zeker te zijn dat alles geladen is
    setTimeout(() => {
        console.log("🌦️ Live weer sync gestart (vanuit opgeslagen instelling)");
        updateRealTimeWeather();
        realTimeInterval = setInterval(updateRealTimeWeather, 600000);
    }, 1000);
}

function updateRealTimeWeather() {
    // Coördinaten van Utrecht (HKU locatie bij benadering)
    // NIEUW: We halen nu ook daily=sunrise,sunset op en gebruiken timezone=GMT voor correcte tijdvergelijking
    const url = "https://api.open-meteo.com/v1/forecast?latitude=52.0907&longitude=5.1214&current=is_day,weather_code&daily=sunrise,sunset&timezone=GMT";

    https.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
            try {
                const response = JSON.parse(data);
                if (response.current && response.daily) {
                    const isDay = response.current.is_day === 1;
                    const code = response.current.weather_code;
                    
                    let time = isDay ? 'day' : 'night';
                    let weather = 'clear';

                    // NIEUW: Check of we in de overgangsfase zitten (30 min rondom zonsopkomst/ondergang)
                    if (response.daily.sunrise && response.daily.sunset) {
                        // Voeg 'Z' toe om te forceren dat JS dit als UTC leest (API geeft GMT tijd)
                        const sunriseTime = new Date(response.daily.sunrise[0] + "Z").getTime();
                        const sunsetTime = new Date(response.daily.sunset[0] + "Z").getTime();
                        const now = Date.now();
                        const margin = 45 * 60 * 1000; // 45 minuten marge

                        if (Math.abs(now - sunriseTime) < margin) {
                            time = 'sunrise';
                        } else if (Math.abs(now - sunsetTime) < margin) {
                            time = 'sunset';
                        }
                    }

                    // WMO Weather code interpretatie
                    if (code <= 1) weather = 'clear';
                    else if (code <= 3) weather = 'mist'; // Bewolkt
                    else if (code <= 48) weather = 'mist'; // Mist
                    else if (code <= 67) weather = 'rain'; // Regen/Motregen
                    else if (code <= 77) weather = 'snow'; // Sneeuw
                    else if (code <= 82) weather = 'rain'; // Buien
                    else if (code <= 86) weather = 'snow'; // Sneeuwbuien
                    else if (code <= 99) weather = 'rain'; // Onweer

                    // Update alle kamers die 'buiten' zijn
                    Object.keys(rooms).forEach(roomId => {
                        const room = rooms[roomId];
                        if (room.settings && room.settings.isOutside) {
                            let changed = false;
                            if (room.settings.weather !== weather) {
                                room.settings.weather = weather;
                                changed = true;
                            }
                            if (room.settings.time !== time) {
                                room.settings.time = time;
                                changed = true;
                            }
                            
                            if (changed) {
                                saveRoom(roomId);
                                io.to(roomId).emit('roomSettingsUpdated', room.settings);
                            }
                        }
                    });
                }
            } catch (e) {
                console.error("Fout bij verwerken weerdata:", e);
            }
        });
    }).on('error', (e) => {
        console.error("Fout bij ophalen weer:", e);
    });
}

// Helper: Genereer een unieke Room ID
function generateRoomId() {
    return Math.random().toString(36).substring(2, 7).toUpperCase();
}

// Helper: Maak een nieuwe lege kamer aan
function createRoom(id, options = {}) {
    const size = options.size || '25'; // Kan nu een string zijn
    
    let mapW, mapH;
    if (typeof size === 'string' && size.includes('x')) {
        [mapW, mapH] = size.split('x').map(Number);
    } else {
        mapW = Number(size);
        mapH = Number(size);
    }
    
    // Bepaal limiet op basis van grootte
    const area = mapW * mapH;
    let maxPlayers = 10;
    if (area <= 25) maxPlayers = 10;       // 5x5
    else if (area <= 50) maxPlayers = 25;  // 5x10
    else if (area <= 100) maxPlayers = 25; // 10x10
    else if (area <= 400) maxPlayers = 50; // 20x20
    else if (area <= 900) maxPlayers = 100;// 30x30

    rooms[id] = {
        objects: [], // Start met een lege lijst
        wallObjects: [],
        items: [], // Start met een lege lijst
        marks: [], // NIEUW: Marker tekeningen (in-memory)
        players: {},
        chatHistory: [],
        mapW: mapW,
        mapH: mapH,
        tileColors: {},
        wallColors: {},
        puddles: {},
        snow: {},
        maxPlayers: maxPlayers,
        ownerId: options.ownerId || null, // Eigenaar ID
        spawnPoint: { x: 0, y: 0 }, // NIEUW: Default spawn
        settings: { doorbell: false, alwaysOnline: options.alwaysOnline || false, allowBuilding: options.allowBuilding || false, noSmoking: options.noSmoking || false, isOutside: options.isOutside || false, weather: options.weather || 'clear', time: options.time || 'day' } // Standaard instellingen
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
                // Zorg dat geladen items ook IDs hebben
                rooms[id].items.forEach(i => { if(!i.id) i.id = Date.now().toString(36) + Math.random().toString(36).substr(2); });
            } catch (e) {
                console.error("Kon default.json niet laden voor testroom:", e);
            }
        }
    }

    // Zorg dat alle items een ID hebben (ook defaults)
    rooms[id].items.forEach(i => { if(!i.id) i.id = Date.now().toString(36) + Math.random().toString(36).substr(2) + Math.random().toString(36).substr(2); });

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
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            data.players = {}; // Reset spelers
            data.chatHistory = []; // NIEUW: Reset chatgeschiedenis bij het laden
            if (!data.mapW) data.mapW = 25;
            if (!data.mapH) data.mapH = 25;
            if (!data.tileColors) data.tileColors = {};
            if (!data.wallColors) data.wallColors = {};
            if (!data.puddles) data.puddles = {};
            if (!data.snow) data.snow = {};
            
            if (!data.marks) data.marks = []; // Reset marks bij laden (sessie gebonden)

            // Zorg dat maxPlayers bestaat (voor oude kamers)
            if (!data.maxPlayers) {
                const area = (data.mapW || 25) * (data.mapH || 25);
                if (area <= 25) data.maxPlayers = 10;
                else if (area <= 50) data.maxPlayers = 25;
                else if (area <= 100) data.maxPlayers = 25;
                else if (area <= 400) data.maxPlayers = 50;
                else if (area <= 900) data.maxPlayers = 100;
                else data.maxPlayers = 10; // Fallback
            }
            
            // Zorg dat settings bestaan
            if (!data.settings) data.settings = { doorbell: false, alwaysOnline: false, allowBuilding: false };
            if (data.settings.allowBuilding === undefined) data.settings.allowBuilding = false;
            if (data.settings.noSmoking === undefined) data.settings.noSmoking = false;
            if (data.settings.isOutside === undefined) data.settings.isOutside = false;
            if (data.settings.weather === undefined) data.settings.weather = 'clear';
            if (data.settings.time === undefined) data.settings.time = 'day';
            if (!data.spawnPoint) data.spawnPoint = { x: 0, y: 0 }; // NIEUW: Default spawn bij laden

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
            // NIEUW: Zorg dat alle items een ID hebben na het laden
            if (rooms[id].items && Array.isArray(rooms[id].items)) {
                rooms[id].items.forEach(i => {
                    if (!i.id) i.id = Date.now().toString(36) + Math.random().toString(36).substr(2);
                });
            }
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
    
    // Clamp start positie binnen de map
    if (x < 0) x = 0; if (x >= mapW) x = mapW - 1;
    if (y < 0) y = 0; if (y >= mapH) y = mapH - 1;

    if (!isPositionOccupied(room, x, y)) return { x, y };

    // NIEUW: Zoek spiraalsgewijs naar buiten (BFS) voor de dichtstbijzijnde vrije tegel
    const visited = new Set();
    const queue = [{x, y}];
    visited.add(`${x},${y}`);

    while (queue.length > 0) {
        const current = queue.shift();
        
        const neighbors = [
            {x: current.x, y: current.y - 1},
            {x: current.x + 1, y: current.y},
            {x: current.x, y: current.y + 1},
            {x: current.x - 1, y: current.y},
            {x: current.x + 1, y: current.y - 1},
            {x: current.x + 1, y: current.y + 1},
            {x: current.x - 1, y: current.y + 1},
            {x: current.x - 1, y: current.y - 1}
        ];

        for (const n of neighbors) {
            if (n.x >= 0 && n.x < mapW && n.y >= 0 && n.y < mapH) {
                const key = `${n.x},${n.y}`;
                if (!visited.has(key)) {
                    if (!isPositionOccupied(room, n.x, n.y)) {
                        return { x: n.x, y: n.y };
                    }
                    visited.add(key);
                    queue.push(n);
                }
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

  // Stuur huidige status van real-time sync
  socket.emit('realTimeStatus', serverSettings.realTimeSync);

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
              const noSmoking = room && room.settings ? room.settings.noSmoking : false;
              const isOutside = room && room.settings ? room.settings.isOutside : false;
              const weather = room && room.settings ? room.settings.weather : 'clear';
              const time = room && room.settings ? room.settings.time : 'day';
              const isOwnerOnline = id === 'testroom' || (room && room.ownerId && onlineUserIds.has(room.ownerId));
              const friendCount = room && room.players ? Object.values(room.players).filter(p => myFriendIds.has(p.userId)).length : 0;
              
              return { 
                  id: id, 
                  playerCount: playerCount, 
                  maxPlayers: room ? (room.maxPlayers || 10) : 10, 
                  hasDoorbell: hasDoorbell,
                  isAlwaysOnline: isAlwaysOnline,
                  allowBuilding: allowBuilding,
                  noSmoking: noSmoking,
                  isOutside: isOutside,
                  weather: weather,
                  time: time,
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

      // NIEUW: Zorg dat speler data bestaat en een vaste kleur heeft
      if (!playersData[userId]) {
          playersData[userId] = { wallet: 0, inventory: [] };
      }
      if (!playersData[userId].color) {
          // Genereer een lichte/felle kleur (HSL) voor betere leesbaarheid
          const h = Math.floor(Math.random() * 360);
          const s = Math.floor(Math.random() * 30) + 70; // 70-100% Saturation (Felheid)
          const l = Math.floor(Math.random() * 25) + 55; // 55-80% Lightness (Helderheid)
          playersData[userId].color = `hsl(${h}, ${s}%, ${l}%)`;
          savePlayers();
      }

      let room = getRoom(roomId);
      if (!room) {
          room = createRoom(roomId, { size: data.size, ownerId: userId, alwaysOnline: data.alwaysOnline === true, allowBuilding: data.allowBuilding === true, noSmoking: data.noSmoking === true, isOutside: data.isOutside === true, weather: data.weather || 'clear', time: data.time || 'day' });
      } else if (room.ownerId === userId) {
          // Update bestaande kamer als eigenaar joint met specifieke instelling (via create menu)
          if (!room.settings) room.settings = {};
          let changed = false;
          if (data.alwaysOnline !== null && data.alwaysOnline !== undefined) { room.settings.alwaysOnline = data.alwaysOnline; changed = true; }
          if (data.allowBuilding !== null && data.allowBuilding !== undefined) { room.settings.allowBuilding = data.allowBuilding; changed = true; }
          if (data.noSmoking !== null && data.noSmoking !== undefined) { room.settings.noSmoking = data.noSmoking; changed = true; }
          
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

      let preferredX = room.spawnPoint ? room.spawnPoint.x : 0;
      let preferredY = room.spawnPoint ? room.spawnPoint.y : 0;
      if (data && typeof data.x === 'number' && typeof data.y === 'number') {
          preferredX = data.x;
          preferredY = data.y;
      }

      const spawn = findNearestFreeTile(room, preferredX, preferredY);

      room.players[socket.id] = {
        x: spawn.x + 0.5,
        y: spawn.y + 0.5,
        id: socket.id,
        color: playersData[userId].color, // Gebruik opgeslagen kleur
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
          marks: room.marks, // Stuur bestaande tekeningen mee
          mapW: room.mapW,
          mapH: room.mapH,
          tileColors: room.tileColors,
          wallColors: room.wallColors,
          puddles: room.puddles,
          snow: room.snow,
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

    const player = room.players[socket.id];

    const chatData = {
      user: player ? player.name : "Alumni " + socket.id.substr(0,4),
      text: msg,
      id: socket.id,
      userId: player ? player.userId : null, // Send persistent ID
      color: player ? player.color : '#ffffff', // NIEUW: Stuur kleur mee
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
      if (!item.id) item.id = Date.now().toString(36) + Math.random().toString(36).substr(2); // NIEUW: ID toewijzen
      item.lastTouchedBy = socket.id; // NIEUW: De plaatser is de eigenaar
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
          if (coords.id && i.id) return i.id === coords.id; // NIEUW: Zoek op ID indien beschikbaar
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
          const removedObj = room.objects[idx];
          room.objects.splice(idx, 1);
          
          // NIEUW: Verwijder markers die op deze muur getekend zijn
          if (removedObj.isWall && room.marks && room.marks.length > 0) {
              const initialCount = room.marks.length;
              room.marks = room.marks.filter(m => {
                  // Check of marker m op de verwijderde muur zit
                  if (removedObj.flipped) {
                      // Y-axis muur (staat op X)
                      // Check X (moet dichtbij zijn, marge 0.5)
                      if (Math.abs(m.x - removedObj.x) > 0.5) return true; // Bewaar
                      // Check Y (moet binnen de lengte van de muur vallen)
                      const w = removedObj.width || 1;
                      if (m.y < removedObj.y || m.y > removedObj.y + w) return true; // Bewaar
                      return false; // Verwijder
                  } else {
                      // X-axis muur (staat op Y)
                      if (Math.abs(m.y - removedObj.y) > 0.5) return true; // Bewaar
                      const w = removedObj.width || 1;
                      if (m.x < removedObj.x || m.x > removedObj.x + w) return true; // Bewaar
                      return false; // Verwijder
                  }
              });
              
              if (room.marks.length !== initialCount) {
                  io.to(roomId).emit('updateMarks', room.marks);
              }
          }

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

  // NIEUW: Marker tekeningen ontvangen en doorsturen
  socket.on('placeMarks', (newMarks) => {
      const roomId = socketRoomMap[socket.id];
      if (!roomId || !rooms[roomId]) return;
      
      if (!rooms[roomId].marks) rooms[roomId].marks = [];
      if (Array.isArray(newMarks)) {
          rooms[roomId].marks.push(...newMarks);
          // Beperk aantal marks om geheugen te sparen (bijv. 10.000 punten)
          if (rooms[roomId].marks.length > 10000) rooms[roomId].marks = rooms[roomId].marks.slice(-10000);
          socket.to(roomId).emit('placeMarks', newMarks);
      }
  });

  // NIEUW: Marker tekeningen verwijderen (gummen)
  socket.on('removeMarks', (data) => {
      const roomId = socketRoomMap[socket.id];
      if (!roomId || !rooms[roomId]) return;
      
      const { x, y, z, radius } = data;
      const r2 = radius * radius;
      
      if (rooms[roomId].marks) {
          const initialLength = rooms[roomId].marks.length;
          rooms[roomId].marks = rooms[roomId].marks.filter(m => {
              const dx = m.x - x;
              const dy = m.y - y;
              const dz = m.z - z;
              return (dx*dx + dy*dy + dz*dz) > r2;
          });
          
          if (rooms[roomId].marks.length !== initialLength) {
              io.to(roomId).emit('updateMarks', rooms[roomId].marks);
          }
      }
  });

  // NIEUW: Undo laatste marker actie (verwijder specifieke marks op ID)
  socket.on('undoMarks', (markIds) => {
      const roomId = socketRoomMap[socket.id];
      if (!roomId || !rooms[roomId] || !rooms[roomId].marks) return;

      const initialLength = rooms[roomId].marks.length;
      const idsToRemove = new Set(markIds);
      rooms[roomId].marks = rooms[roomId].marks.filter(m => !idsToRemove.has(m.id));

      if (rooms[roomId].marks.length !== initialLength) {
          io.to(roomId).emit('updateMarks', rooms[roomId].marks);
      }
  });

  // NIEUW: Live physics updates (beweging van items)
  socket.on('updateItemPhysics', (data) => {
      const roomId = socketRoomMap[socket.id];
      if (!roomId || !rooms[roomId]) return;
      const room = rooms[roomId];
      
      // data is een array van updates: [{id, x, y, z, vx, vy, vz, rotation, vr}, ...]
      let changed = false;
      data.forEach(update => {
          const item = room.items.find(i => i.id === update.id);
          if (item) {
              item.x = update.x;
              item.y = update.y;
              item.z = update.z;
              item.vx = update.vx;
              item.vy = update.vy;
              item.vz = update.vz;
              item.rotation = update.rotation;
              item.vr = update.vr;
              item.lastTouchedBy = update.lastTouchedBy; // NIEUW: Update eigenaar
              changed = true;
          }
      });
      
      if (changed) {
          // Stuur door naar anderen (niet naar jezelf, want jij simuleert het al)
          socket.to(roomId).emit('updateItemPhysics', data);
          scheduleRoomSave(roomId); // NIEUW: Sla de nieuwe posities op (vertraagd)
      }
  });

  // NIEUW: Update kleur van een object (zoals een custom muur)
  socket.on('updateObjectColor', (data) => {
      const roomId = socketRoomMap[socket.id];
      if (!roomId || !rooms[roomId]) return;
      const room = rooms[roomId];
      const obj = room.objects.find(o => o.id === data.id);
      if (obj) {
          obj.color = data.color;
          io.to(roomId).emit('updateObjects', room.objects);
          saveRoom(roomId);
      }
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
      // NIEUW: Safety check - zorg dat alles een ID heeft
      newItems.forEach(i => {
          if (!i.id) i.id = Date.now().toString(36) + Math.random().toString(36).substr(2);
      });
      room.items = newItems; // Directe vervanging
      // Broadcast naar IEDEREEN, inclusief de zender, voor consistentie.
      io.to(roomId).emit('updateItems', room.items);
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
      if (data.puddles) room.puddles = data.puddles;
      if (data.snow) room.snow = data.snow;
      
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

      // NIEUW: Zorg dat de room list ook een seintje krijgt voor de UI update
      if (newSettings.noSmoking !== undefined) {
          io.emit('roomNoSmokingToggled', targetRoomId);
      }
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

  // NIEUW: Speler data ophalen (Inventory & Geld)
  socket.on('getPlayerData', (userId) => {
      if (!playersData[userId]) {
          // Nieuwe speler defaults
          playersData[userId] = {
              wallet: 0,
              inventory: []
          };
          savePlayers();
      }
      socket.emit('playerData', playersData[userId]);
  });

  // NIEUW: Speler data opslaan
  socket.on('savePlayerData', (data) => {
      if (!data.userId) return;
      // Update de data op de server
      playersData[data.userId] = { wallet: data.wallet, inventory: data.inventory };
      savePlayers();
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

  // NIEUW: Sync puddles (regenplassen)
  socket.on('syncPuddles', (data) => {
      const roomId = socketRoomMap[socket.id];
      if (!roomId || !rooms[roomId]) return;
      rooms[roomId].puddles = data;
      socket.to(roomId).emit('puddlesUpdate', data);
  });

  // NIEUW: Sync snow (sneeuwlaag)
  socket.on('syncSnow', (data) => {
      const roomId = socketRoomMap[socket.id];
      if (!roomId || !rooms[roomId]) return;
      rooms[roomId].snow = data;
      socket.to(roomId).emit('snowUpdate', data);
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
              isCustom: true,
              xOffset: data.xOffset,
              yOffset: data.yOffset,
              keywords: data.keywords || []
          };

          customObjects.push(newObject);
          saveCustomObjectsToServer();
          io.emit('customObjectAdded', newObject); // Stuur naar ALLE clients
      });
  });

  // NIEUW: Update een custom object
  socket.on('updateCustomObject', (data) => {
      const objIndex = customObjects.findIndex(o => o.name === data.originalName);
      if (objIndex === -1) return;

      const obj = customObjects[objIndex];
      const oldName = obj.name;
      
      // Update eigenschappen
      obj.name = data.name || oldName;
      obj.price = data.price ? parseFloat(data.price) : 0;
      obj.adminOnly = !!data.adminOnly;
      obj.width = parseInt(data.width);
      obj.depth = parseInt(data.depth);
      obj.height = parseInt(data.height);
      obj.isFloor = !!data.isFloor;
      obj.moveable = !!data.moveable;
      obj.xOffset = parseInt(data.xOffset);
      obj.yOffset = parseInt(data.yOffset);
      obj.keywords = data.keywords || [];

      // Functie om af te ronden na eventuele image upload
      const finishUpdate = () => {
          saveCustomObjectsToServer();
          io.emit('customObjectUpdated', { originalName: oldName, object: obj });

          // Update instanties in ALLE kamers
          const files = fs.readdirSync(ROOMS_DIR);
          files.forEach(file => {
              if (!file.endsWith('.json')) return;
              const roomId = file.replace('.json', '');
              
              // Check geheugen of schijf
              let room = rooms[roomId];
              let isInMemory = !!room;
              if (!room) {
                  try { room = JSON.parse(fs.readFileSync(path.join(ROOMS_DIR, file), 'utf8')); } catch(e) { return; }
              }

              let changed = false;
              const updateInstance = (inst) => {
                  if (inst.name === oldName && inst.isCustom) {
                      inst.name = obj.name;
                      inst.price = obj.price;
                      inst.width = obj.width;
                      inst.depth = obj.depth;
                      inst.height = obj.height;
                      inst.isFloor = obj.isFloor;
                      inst.moveable = obj.moveable;
                      inst.xOffset = obj.xOffset;
                      inst.yOffset = obj.yOffset;
                      inst.image = obj.image; // Update image URL ook
                      inst.keywords = obj.keywords;
                      changed = true;
                  }
              };

              if (room.objects) room.objects.forEach(updateInstance);
              if (room.wallObjects) room.wallObjects.forEach(updateInstance);

              if (changed) {
                  if (isInMemory) {
                      saveRoom(roomId);
                      io.to(roomId).emit('updateObjects', room.objects);
                      io.to(roomId).emit('updateWallObjects', room.wallObjects);
                  } else {
                      fs.writeFile(path.join(ROOMS_DIR, file), JSON.stringify(room, null, 2), ()=>{});
                  }
              }
          });
      };

      if (data.imageData) {
           // Overschrijf bestand of maak nieuw (simpel: nieuw bestand, update ref)
           const filename = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}.png`;
           const imagePath = path.join(UPLOADS_DIR, 'objects', filename);
           const imageUrl = `/uploads/objects/${filename}`;
           
           fs.writeFile(imagePath, data.imageData, (err) => {
               if (!err) {
                   // Oude verwijderen zou netjes zijn, maar risico op broken links als cache traag is.
                   // Voor nu laten we oude staan of verwijderen we hem:
                   if (obj.image && obj.image.startsWith('/uploads/')) {
                       try { fs.unlinkSync(path.join(__dirname, obj.image)); } catch(e){}
                   }
                   obj.image = imageUrl;
                   finishUpdate();
               }
           });
      } else {
          finishUpdate();
      }
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

  // NIEUW: Resize kamer
  socket.on('resizeRoom', (data) => {
      const roomId = socketRoomMap[socket.id];
      if (!roomId || !rooms[roomId]) return;
      
      const room = rooms[roomId];
      // Alleen eigenaar mag resizen (of iedereen in testroom/publieke kamer zonder owner)
      if (room.ownerId && room.ownerId !== socket.userId) return;

      let newW = parseInt(data.width);
      let newH = parseInt(data.height);
      
      // Validatie (min 5, max 50 om server load te beperken)
      if (isNaN(newW) || newW < 5) newW = 5;
      if (isNaN(newH) || newH < 5) newH = 5;
      if (newW > 50) newW = 50;
      if (newH > 50) newH = 50;

      room.mapW = newW;
      room.mapH = newH;
      
      // Verwijder objecten die buiten de nieuwe grenzen vallen
      room.objects = room.objects.filter(o => o.x < newW && o.y < newH);
      
      // Verwijder muurobjecten die aan muren hingen die nu weg zijn
      room.wallObjects = room.wallObjects.filter(wo => {
          const parts = wo.wallId.split('_');
          const idx = parseInt(parts[1]);
          if (parts[0] === 'top') return idx < newW;
          if (parts[0] === 'left') return idx < newH;
          return true;
      });

      saveRoom(roomId);
      
      io.to(roomId).emit('roomResized', { mapW: newW, mapH: newH });
      io.to(roomId).emit('updateObjects', room.objects);
      io.to(roomId).emit('updateWallObjects', room.wallObjects);
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

  // NIEUW: Toggle No Smoking status
  socket.on('toggleNoSmoking', (roomId) => {
      if (!roomId || !rooms[roomId]) return;
      
      if (!rooms[roomId].settings) rooms[roomId].settings = {};
      if (rooms[roomId].settings.noSmoking === undefined) rooms[roomId].settings.noSmoking = false;
      rooms[roomId].settings.noSmoking = !rooms[roomId].settings.noSmoking;
      
      saveRoom(roomId);
      io.emit('roomNoSmokingToggled', roomId);
      io.to(roomId).emit('roomSettingsUpdated', rooms[roomId].settings);
  });

  // NIEUW: Toggle Outside status
  socket.on('toggleIsOutside', (roomId) => {
      if (!roomId || !rooms[roomId]) return;
      
      if (!rooms[roomId].settings) rooms[roomId].settings = {};
      if (rooms[roomId].settings.isOutside === undefined) rooms[roomId].settings.isOutside = false;
      rooms[roomId].settings.isOutside = !rooms[roomId].settings.isOutside;
      
      saveRoom(roomId);
      io.emit('roomIsOutsideToggled', roomId);
      io.to(roomId).emit('roomSettingsUpdated', rooms[roomId].settings);
  });

  // NIEUW: Zet weer type
  socket.on('setRoomWeather', (data) => {
      // data = { roomId, weather } ('clear', 'rain', 'snow')
      const roomId = data.roomId;
      if (!roomId || !rooms[roomId]) return;
      
      if (!rooms[roomId].settings) rooms[roomId].settings = {};
      rooms[roomId].settings.weather = data.weather;
      saveRoom(roomId);
      io.to(roomId).emit('roomSettingsUpdated', rooms[roomId].settings);
  });

  // NIEUW: Zet tijd (dag/nacht)
  socket.on('setRoomTime', (data) => {
      // data = { roomId, time } ('day', 'night')
      const roomId = data.roomId;
      if (!roomId || !rooms[roomId]) return;
      
      if (!rooms[roomId].settings) rooms[roomId].settings = {};
      rooms[roomId].settings.time = data.time;
      saveRoom(roomId);
      io.to(roomId).emit('roomSettingsUpdated', rooms[roomId].settings);
  });

  // NIEUW: Zet spawn punt
  socket.on('setRoomSpawn', (data) => {
      const roomId = socketRoomMap[socket.id];
      if (!roomId || !rooms[roomId]) return;
      
      // Check eigenaarschap: Alleen eigenaar mag spawn zetten (tenzij het een publieke kamer zonder owner is)
      if (rooms[roomId].ownerId && rooms[roomId].ownerId !== socket.userId) return;

      rooms[roomId].spawnPoint = { x: Math.floor(data.x), y: Math.floor(data.y) };
      saveRoom(roomId);
  });

  // NIEUW: Toggle Real-Time Sync
  socket.on('toggleRealTime', (enabled) => {
      serverSettings.realTimeSync = enabled;
      saveServerSettings(); // Sla de keuze op!
      io.emit('realTimeStatus', serverSettings.realTimeSync);
      
      if (serverSettings.realTimeSync) {
          updateRealTimeWeather(); // Direct updaten
          if (realTimeInterval) clearInterval(realTimeInterval);
          realTimeInterval = setInterval(updateRealTimeWeather, 600000); // Elke 10 minuten checken
      } else {
          if (realTimeInterval) clearInterval(realTimeInterval);
          realTimeInterval = null;
      }
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
