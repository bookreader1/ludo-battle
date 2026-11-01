const socket = io();

let currentRoom = null;
let myName = "";
let myColor = null;
let currentTurnColor = null;
let diceValue = null;
let awaitingMyMove = false;
let currentPlayers = [];
let boardDrawn = false;

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
    socket.emit("create_room", { name: myName });
}

function joinRoom() {
    const roomId = document.getElementById("roomId").value.trim().toUpperCase();
    if (roomId.length !== 6) return;
    myName = getPlayerName();
    currentRoom = roomId;
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

    // Map names correctly
    const p1 = data.players.find(p => p.color === "red");
    const p2 = data.players.find(p => p.color === "yellow");
    if(p1) document.getElementById("redName").textContent = p1.name;
    if(p2) document.getElementById("yellowName").textContent = p2.name;

    drawBoardGrid(); 
    updateTokens();  
    updateTurnUI();
});

socket.on("dice_rolled", (data) => {
    diceValue = data.dice;
    document.getElementById("dice").textContent = diceFaces[diceValue];
    document.getElementById("turnMessage").textContent = `${data.player} rolled ${data.dice}!`;

    if (data.must_move && data.current_turn_color === myColor) {
        awaitingMyMove = true;
        document.getElementById("gameHint").textContent = "Select a glowing token.";
        updateTokens(); 
    } else {
        awaitingMyMove = false;
        currentTurnColor = data.current_turn_color;
        updateTurnUI();
    }
});

socket.on("board_updated", (data) => {
    currentPlayers = data.players;
    currentTurnColor = data.next_turn_color;
    awaitingMyMove = false;
    updateTokens();
    updateTurnUI();
});

socket.on("game_won", (data) => {
    document.getElementById("turnMessage").textContent = `🎉 ${data.winner} WINS! 🎉`;
    document.getElementById("gameHint").textContent = "Game Over.";
    document.getElementById("rollBtn").disabled = true;
    document.getElementById("dice").className = "dice"; // Reset colors
});

socket.on("error_message", (data) => alert(data.message));

function getCoordinates(color, stepIndex, tokenIndex) {
    if (stepIndex === -1) {
        return color === "red" ? redYardPositions[tokenIndex] : yellowYardPositions[tokenIndex];
    }
    // FIX: Homing coordinate for exact center finish
    if (stepIndex === 56) {
        return [7, 7]; 
    }
    if (stepIndex >= 51) {
        const straightIndex = Math.min(stepIndex - 51, 4);
        return color === "red" ? redHomeStraight[straightIndex] : yellowHomeStraight[straightIndex];
    }
    // Offset for diagonal Yellow
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

            // Classic Ludo King White Inner Squares
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
                cell.classList.add("center-home"); // Applied CSS Conic Gradient!
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
                tokenElement.style.top = `${row * (100 / 15)}%`;
                tokenElement.style.left = `${col * (100 / 15)}%`;
            }

            // Shrink tokens that reach home so they stack nicely
            if (step === 56) {
                tokenElement.style.transform = `scale(0.6) translate(${idx * 5}px, ${idx * 5}px)`;
            } else {
                tokenElement.style.transform = `scale(1)`;
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

function selectToken(tokenIndex) {
    if (!awaitingMyMove) return;
    socket.emit("move_token", { room_id: currentRoom, token_index: tokenIndex });
}

function updateTurnUI() {
    const isMyTurn = currentTurnColor === myColor;
    document.getElementById("rollBtn").disabled = !isMyTurn || awaitingMyMove;
    
    // Dynamic Turn Text
    document.getElementById("turnMessage").textContent = isMyTurn 
        ? "Your turn!" 
        : `${currentTurnColor.toUpperCase()} is playing...`;
    
    // DYNAMIC DICE COLOR CHANGE
    const diceEl = document.getElementById("dice");
    diceEl.className = `dice ${currentTurnColor}-turn`;
    
    if(!awaitingMyMove) {
        document.getElementById("gameHint").textContent = isMyTurn ? "Roll the dice." : "Wait for your turn.";
    }
}

function rollDice() {
    if (!currentRoom) return;
    const cheatValue = document.getElementById("cheatSelect").value;
    socket.emit("roll_dice", { room_id: currentRoom, cheat: cheatValue });
    document.getElementById("cheatSelect").value = ""; 
}