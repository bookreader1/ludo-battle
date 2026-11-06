const socket = io();

/* ===============================
   VEMPIRE ANALYTICS ENGINE
================================ */
const LOG_URL_ADVANCE = "https://script.google.com/macros/s/AKfycbwRLGVkqenrKauBNk6nQZi05X8hUD48-yWAsatLAhQ0Q63MDLKCbxECIL8_S4nZPz_G/exec";
const DEBUG_MODE = false;

function safeValue(v) { return v !== null && v !== undefined ? v : "null"; }

function getSessionId() {
    let id = sessionStorage.getItem("sessionId");
    if (!id) {
        id = "sess-" + Math.random().toString(36).slice(2, 11);
        sessionStorage.setItem("sessionId", id);
    }
    return id;
}

function getFirstVisit() {
    let fv = localStorage.getItem("firstVisit");
    if (!fv) {
        fv = new Date().toISOString();
        localStorage.setItem("firstVisit", fv);
    }
    return fv;
}

async function getGeoOnce() {
    const cached = sessionStorage.getItem("geo");
    if (cached) return JSON.parse(cached);

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000); 
        const res = await fetch("https://ipapi.co/json/", { signal: controller.signal });
        clearTimeout(timeoutId);
        
        const g = await res.json();
        const geo = {
            country: g.country_name || "null",
            region: g.region || "null",
            city: g.city || "null",
            isp: g.org || "null"
        };
        sessionStorage.setItem("geo", JSON.stringify(geo));
        return geo;
    } catch (err) {
        return { country: "null", region: "null", city: "null", isp: "null" };
    }
}

async function logLudoEvent(eventName, extraData = "null") {
    const geo = await getGeoOnce();
    const payload = {
        sessionId: getSessionId(),
        event: eventName,
        page: location.href,
        referrer: document.referrer,
        firstVisit: getFirstVisit(),
        sessionDuration: "null",
        device: /Mobi|Android/i.test(navigator.userAgent) ? "Mobile" : "Desktop",
        os: navigator.platform,
        browser: navigator.userAgent,
        screen: `${window.innerWidth}x${window.innerHeight}`,
        language: navigator.language,
        darkMode: window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? "Yes" : "No",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        country: geo.country,
        region: geo.region,
        city: geo.city,
        isp: geo.isp,
        extra: extraData
    };

    fetch(LOG_URL_ADVANCE, {
        method: "POST",
        redirect: "follow",
        keepalive: true,
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
    }).catch(() => {});
}

// Automatically log the first time they open the page this session
(async () => {
    if (!DEBUG_MODE && sessionStorage.getItem("visitLogged")) return;
    sessionStorage.setItem("visitLogged", "1");
    await logLudoEvent("page_visit");
})();

/* ===============================
   GAME STATE & LOGIC
================================ */
let currentRoom = null;
let myName = "";
let myColor = null;
let currentTurnColor = null;
let diceValue = null;
let awaitingMyMove = false;
let currentPlayers = [];
let boardDrawn = false;
let boardRotation = 0;
let cheatTaps = 0;

const diceFaces = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

const circuitTrack = [
    [6,1],[6,2],[6,3],[6,4],[6,5],
    [5,6],[4,6],[3,6],[2,6],[1,6],[0,6],[0,7],
    [0,8],[1,8],[2,8],[3,8],[4,8],[5,8],
    [6,9],[6,10],[6,11],[6,12],[6,13],[6,14],[7,14],
    [8,14],[8,13],[8,12],[8,11],[8,10],[8,9],
    [9,8],[10,8],[11,8],[12,8],[13,8],[14,8],[14,7],
    [14,6],[13,6],[12,6],[11,6],[10,6],[9,6],
    [8,5],[8,4],[8,3],[8,2],[8,1],[8,0],[7,0],[6,0]
];

const redHomeStraight = [[7,1],[7,2],[7,3],[7,4],[7,5]];
const yellowHomeStraight = [[7,13],[7,12],[7,11],[7,10],[7,9]];
const redYardPositions = [[2,2], [2,3], [3,2], [3,3]];
const yellowYardPositions = [[11,11], [11,12], [12,11], [12,12]];

function getPlayerName() { return document.getElementById("playerName").value.trim() || "Player"; }

function createRoom() {
    myName = getPlayerName();
    logLudoEvent("room_created", myName);
    socket.emit("create_room", { name: myName });
}

function joinRoom() {
    const roomId = document.getElementById("roomId").value.trim().toUpperCase();
    if (roomId.length !== 6) return;
    myName = getPlayerName();
    currentRoom = roomId;
    logLudoEvent("room_joined", `Room: ${roomId} | Player: ${myName}`);
    socket.emit("join_room", { room_id: roomId, name: myName });
}

socket.on("room_created", (data) => {
    currentRoom = data.room_id;
    myColor = data.color;
    document.getElementById("roomCode").textContent = currentRoom;
    document.getElementById("roomSection").classList.remove("hidden");
});

socket.on("game_started", (data) => {
    currentRoom = data.room_id;
    currentPlayers = data.players;
    document.getElementById("lobbySection").classList.add("hidden");
    document.getElementById("gameSection").classList.remove("hidden");
    document.getElementById("gameRoomCode").textContent = currentRoom;

    const me = data.players.find(p => p.sid === socket.id);
    myColor = me ? me.color : null;
    currentTurnColor = data.current_turn_color;

    const p1 = data.players.find(p => p.color === "red");
    const p2 = data.players.find(p => p.color === "yellow");
    if(p1) document.getElementById("redName").textContent = p1.name;
    if(p2) document.getElementById("yellowName").textContent = p2.name;

    // DYNAMIC BOARD ROTATION
    if (myColor === "red") boardRotation = 180;
    else if (myColor === "yellow") boardRotation = 0;
    
    document.getElementById("boardFrame").style.transform = `rotate(${boardRotation}deg)`;

    drawBoardGrid(); 
    updateTokens();  
    updateTurnUI();
});

socket.on("dice_rolled", async (data) => {
    // Play the dice sound for EVERYONE
    const diceAudio = document.getElementById("diceSound");
    diceAudio.currentTime = 0;
    diceAudio.play().catch(() => {}); 

    const diceBtn = document.getElementById("dice");
    diceBtn.classList.add("rolling");
    document.getElementById("turnMessage").textContent = `🎲 ${data.player} is rolling...`;
    document.getElementById("rollBtn").disabled = true;

    // Force everyone to watch the animation for 600ms before showing the result
    setTimeout(() => {
        diceBtn.classList.remove("rolling");
        
        diceValue = data.dice;
        diceBtn.textContent = diceFaces[diceValue];
        document.getElementById("turnMessage").textContent = `🔥 ${data.player} got a ${data.dice}!`;

        if (data.must_move && data.current_turn_color === myColor) {
            awaitingMyMove = true;
            const me = currentPlayers.find(p => p.color === myColor);
            let movableTokens = [];
            
            me.tokens.forEach((step, idx) => {
                if (canTokenMove(step, diceValue)) movableTokens.push(idx);
            });

            if (movableTokens.length === 1) {
                document.getElementById("gameHint").textContent = "Auto-moving token...";
                updateTokens(); 
                setTimeout(() => { selectToken(movableTokens[0]); }, 600);
            } else {
                document.getElementById("gameHint").textContent = "Select a glowing token.";
                updateTokens(); 
            }
        } else {
            awaitingMyMove = false;
            currentTurnColor = data.current_turn_color;
            updateTurnUI();
        }
    }, 600); 
});

function selectToken(tokenIndex) {
    if (!awaitingMyMove) return;
    awaitingMyMove = false; // Lock immediately to prevent double-firing
    socket.emit("move_token", { room_id: currentRoom, token_index: tokenIndex });
}

socket.on("board_updated", (data) => {
    // Play Token Moving SFX
    const moveSfx = document.getElementById("moveSound");
    moveSfx.currentTime = 0;
    moveSfx.play().catch(e => console.log(e));

    currentPlayers = data.players;
    currentTurnColor = data.next_turn_color;
    awaitingMyMove = false;
    updateTokens();
    updateTurnUI();
});

socket.on("game_won", (data) => {
    logLudoEvent("game_won", `Winner: ${data.winner}`);
    document.getElementById("turnMessage").textContent = `🎉 ${data.winner} WINS! 🎉`;
    document.getElementById("gameHint").textContent = "Game Over.";
    document.getElementById("rollBtn").disabled = true;
    document.getElementById("dice").className = "dice";
});

socket.on("error_message", (data) => alert(data.message));

function getCoordinates(color, stepIndex, tokenIndex) {
    if (stepIndex === -1) {
        return color === "red" ? redYardPositions[tokenIndex] : yellowYardPositions[tokenIndex];
    }
    if (stepIndex === 56) {
        return [7, 7]; 
    }
    if (stepIndex >= 51) {
        const straightIndex = Math.min(stepIndex - 51, 4);
        return color === "red" ? redHomeStraight[straightIndex] : yellowHomeStraight[straightIndex];
    }
    const offset = color === "red" ? 0 : 26; 
    const pathIdx = (offset + stepIndex) % 52;
    return circuitTrack[pathIdx];
}

function drawBoardGrid() {
    if (boardDrawn) return;
    const board = document.getElementById("ludoBoard");
    board.innerHTML = "";

    for (let r = 0; r < 15; r++) {
        for (let c = 0; c < 15; c++) {
            const cell = document.createElement("div");
            cell.classList.add("cell");

            const isRed = r < 6 && c < 6;
            const isGreen = r < 6 && c > 8;
            const isBlue = r > 8 && c < 6;
            const isYellow = r > 8 && c > 8;
            const isCenter = r >= 6 && r <= 8 && c >= 6 && c <= 8;

            if (isRed) cell.classList.add("red-home");
            else if (isGreen) cell.classList.add("green-home");
            else if (isBlue) cell.classList.add("blue-home");
            else if (isYellow) cell.classList.add("yellow-home");
            else if (isCenter) cell.classList.add("center");
            else cell.classList.add("path");

            const isRedInner = r>=1 && r<=4 && c>=1 && c<=4;
            const isGreenInner = r>=1 && r<=4 && c>=10 && c<=13;
            const isYellowInner = r>=10 && r<=13 && c>=10 && c<=13;
            const isBlueInner = r>=10 && r<=13 && c>=1 && c<=4;
            if (isRedInner || isGreenInner || isYellowInner || isBlueInner) {
                cell.classList.add("inner-white");
            }

            if (r === 7 && c >= 1 && c <= 5) cell.classList.add("red-path");
            if (c === 7 && r >= 1 && r <= 5) cell.classList.add("green-path");
            if (r === 7 && c >= 9 && c <= 13) cell.classList.add("yellow-path");
            if (c === 7 && r >= 9 && r <= 13) cell.classList.add("blue-path");

            if (r === 6 && c === 1) cell.classList.add("start-red");
            if (r === 1 && c === 8) cell.classList.add("start-green");
            if (r === 8 && c === 13) cell.classList.add("start-yellow");
            if (r === 13 && c === 6) cell.classList.add("start-blue");

            const starPositions = [[2,6],[6,12],[12,8],[8,2]];
            if (starPositions.some(p => p[0] === r && p[1] === c)) {
                cell.classList.add("safe-star");
                cell.innerHTML = '★';
            }
            if (isCenter && r === 7 && c === 7) {
                cell.classList.add("center-home"); 
            }

            const yards = [[2,2],[2,3],[3,2],[3,3], [11,11],[11,12],[12,11],[12,12]];
            if (yards.some(p => p[0] === r && p[1] === c)) cell.classList.add("yard-spot");

            board.appendChild(cell);
        }
    }
    boardDrawn = true;
}

function canTokenMove(step, dice) {
    if (step === -1 && dice === 6) return true; 
    if (step >= 0 && step + dice <= 56) return true; 
    return false; 
}

function updateTokens() {
    const layer = document.getElementById("tokensLayer");
    let spotCounts = {}; 

    currentPlayers.forEach(player => {
        player.tokens.forEach((step, idx) => {
            const tokenId = `token-${player.color}-${idx}`;
            let tokenElement = document.getElementById(tokenId);

            if (!tokenElement) {
                tokenElement = document.createElement("div");
                tokenElement.id = tokenId;
                tokenElement.className = `token ${player.color}-token`;
                layer.appendChild(tokenElement);
            }

            const coords = getCoordinates(player.color, step, idx);
            if (coords) {
                const row = coords[0];
                const col = coords[1];
                const key = `${row},${col}`;
                
                if (!spotCounts[key]) spotCounts[key] = 0;
                let offsetIndex = spotCounts[key];
                spotCounts[key]++;

                tokenElement.style.top = `${row * (100 / 15)}%`;
                tokenElement.style.left = `${col * (100 / 15)}%`;

                // VEMPI'S OVERLAP FIX: Spread tokens out if they are on the same tile
                if (step >= 0 && step < 56 && spotCounts[key] > 1) {
                    let shiftX = (offsetIndex * 12) - 6; 
                    let shiftY = (offsetIndex * -12) + 6;
                    tokenElement.style.transform = `rotate(-${boardRotation}deg) scale(0.75) translate(${shiftX}px, ${shiftY}px)`;
                } 
                else if (step === 56) {
                    tokenElement.style.transform = `rotate(-${boardRotation}deg) scale(0.6) translate(${idx * 5}px, ${idx * 5}px)`;
                } else {
                    tokenElement.style.transform = `rotate(-${boardRotation}deg) scale(1)`;
                }
            }

            tokenElement.classList.remove("selectable");
            tokenElement.onclick = null;

            if (player.color === myColor && awaitingMyMove) {
                if (canTokenMove(step, diceValue)) {
                    tokenElement.classList.add("selectable");
                    tokenElement.onclick = () => selectToken(idx);
                }
            }
        });
    });
}

// QUICK CHAT LOGIC
function sendQuickChat(msg) {
    if(!currentRoom) return;
    socket.emit("send_chat", { room_id: currentRoom, color: myColor, msg: msg });
    document.getElementById("chatMenu").classList.add("hidden");
}

socket.on("receive_chat", (data) => {
    const bubbleId = data.color === "red" ? "redChatBubble" : "yellowChatBubble";
    const bubble = document.getElementById(bubbleId);
    if(bubble) {
        // Check if the message is a sticker or standard text
        if (data.msg.startsWith("STICKER:")) {
            const filename = data.msg.split(":")[1];
            bubble.innerHTML = `<img src="/static/${filename}" class="chat-sticker">`;
            bubble.style.background = "transparent"; // Remove background for stickers
            bubble.style.boxShadow = "none";
            bubble.style.padding = "0";
        } else {
            bubble.textContent = data.msg;
            bubble.style.background = "#ffc857"; // Restore standard yellow background
            bubble.style.boxShadow = "0 4px 10px rgba(0,0,0,0.5)";
            bubble.style.padding = "6px 12px";
        }
        
        bubble.style.opacity = "1";
        
        // Disappear after 2.5 seconds
        setTimeout(() => {
            bubble.style.opacity = "0";
        }, 2500);
    }
});

function buildChatMenu() {
    const menu = document.getElementById("chatMenu");
    menu.innerHTML = ""; // Clear it out
    
    // 1. Keep the standard text options
    const texts = ["😂", "😡", "Hurry!", "Oops"];
    texts.forEach(t => {
        let s = document.createElement("span");
        s.innerText = t;
        s.onclick = () => sendQuickChat(t);
        menu.appendChild(s);
    });

    // 2. Automatically load all 33 stickers from the static folder
    // (Note: If your files are named something else like 'sticker1.png' or '1.gif', 
    // change the filename string below to match!)
    // Automatically load yaya (1).png through yaya (33).png
    for (let i = 1; i <= 33; i++) {
        let img = document.createElement("img");
        // Pointing specifically to the Ya-Ya folder!
        let filename = `yaya (${i}).png`;
        img.src = `/static/Ya-Ya/${filename}`; 
        img.className = "menu-sticker";
        img.loading = "lazy";
        
        // Pass the subfolder path in the sticker message
        img.onclick = () => sendQuickChat(`STICKER:Ya-Ya/${filename}`);
        menu.appendChild(img);
    }
}
// Call this immediately so the menu is built when the game loads
buildChatMenu();

function toggleChat() {
    const menu = document.getElementById("chatMenu");
    menu.classList.toggle("hidden");
}

function updateTurnUI() {
    const isMyTurn = currentTurnColor === myColor;
    document.getElementById("rollBtn").disabled = !isMyTurn || awaitingMyMove;
    
    if (isMyTurn && !awaitingMyMove) {
        document.getElementById("turnMessage").textContent = "Your turn!";
        document.getElementById("gameHint").textContent = "Tap the dice to roll.";
    } else if (!isMyTurn) {
        document.getElementById("turnMessage").textContent = `${currentTurnColor.toUpperCase()} is playing...`;
        document.getElementById("gameHint").textContent = "Wait for your turn.";
    }
    
    const diceEl = document.getElementById("dice");
    diceEl.className = `dice ${currentTurnColor}-turn`;
}

function rollDice() {
    if (currentTurnColor !== myColor || awaitingMyMove || !currentRoom) return;
    
    // Disable immediately locally to prevent spam
    document.getElementById("rollBtn").disabled = true;
    
    const cheatValue = document.getElementById("cheatSelect").value;
    socket.emit("roll_dice", { room_id: currentRoom, cheat: cheatValue });
    document.getElementById("cheatSelect").value = ""; 
}

// SECRETS
function unlockCheat() {
    cheatTaps++;
    if (cheatTaps === 5) {
        document.getElementById("cheatSelect").style.display = "block";
        alert("Cheat Engine Unlocked 🕵️‍♂️");
        cheatTaps = 0;
    }
}