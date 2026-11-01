from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room
import random
import string

app = Flask(__name__)
app.config["SECRET_KEY"] = "change-this-before-deployment"
socketio = SocketIO(app, cors_allowed_origins="*")

rooms = {}

def generate_room_id():
    while True:
        room_id = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
        if room_id not in rooms:
            return room_id

@app.route("/")
def index():
    return render_template("index.html")

@socketio.on("create_room")
def create_room(data):
    name = (data.get("name") or "Player 1").strip()[:20] or "Player 1"
    room_id = generate_room_id()
    rooms[room_id] = {
        "owner": request.sid,
        "players": [{"sid": request.sid, "name": name, "color": "red", "tokens": [-1, -1, -1, -1]}],
        "turn": 0, "dice": None, "awaiting_move": False, "status": "waiting"
    }
    join_room(room_id)
    emit("room_created", {"room_id": room_id, "color": "red"})

@socketio.on("join_room")
def handle_join(data):
    room_id = data.get("room_id", "").strip().upper()
    name = (data.get("name") or "Player 2").strip()[:20] or "Player 2"
    room = rooms.get(room_id)

    if not room or room["status"] != "waiting" or len(room["players"]) >= 2:
        emit("error_message", {"message": "Room not found or full"})
        return

    # Player 2 is assigned Yellow for the perfect diagonal layout
    room["players"].append({"sid": request.sid, "name": name, "color": "yellow", "tokens": [-1, -1, -1, -1]})
    room["status"] = "playing"
    join_room(room_id)

    socketio.emit("game_started", {
        "room_id": room_id, "players": room["players"],
        "current_turn_color": room["players"][room["turn"]]["color"],
        "current_turn_name": room["players"][room["turn"]]["name"]
    }, to=room_id)

@socketio.on("roll_dice")
def roll_dice(data):
    room_id = data.get("room_id")
    room = rooms.get(room_id)
    if not room or room["status"] != "playing" or room.get("awaiting_move"): return
    current_player = room["players"][room["turn"]]
    if current_player["sid"] != request.sid: return

    # Hidden Cheat Engine Logic
    cheat = data.get("cheat")
    if cheat and str(cheat) in ["1", "2", "3", "4", "5", "6"]:
        dice = int(cheat)
    else:
        dice = random.randint(1, 6)
        
    room["dice"] = dice

    can_move = False
    for step in current_player["tokens"]:
        if step == -1 and dice == 6: can_move = True; break
        elif 0 <= step < 56 and (step + dice) <= 56: can_move = True; break

    if can_move:
        room["awaiting_move"] = True
        socketio.emit("dice_rolled", {
            "dice": dice, "player": current_player["name"],
            "player_color": current_player["color"], "must_move": True,
            "current_turn_color": current_player["color"]
        }, to=room_id)
    else:
        room["turn"] = (room["turn"] + 1) % len(room["players"])
        next_player = room["players"][room["turn"]]
        socketio.emit("dice_rolled", {
            "dice": dice, "player": current_player["name"],
            "player_color": current_player["color"], "must_move": False,
            "current_turn_color": next_player["color"]
        }, to=room_id)

@socketio.on("move_token")
def handle_move_token(data):
    room_id = data.get("room_id")
    token_idx = data.get("token_index")
    room = rooms.get(room_id)
    if not room or room["status"] != "playing" or not room.get("awaiting_move"): return
    current_player = room["players"][room["turn"]]
    if current_player["sid"] != request.sid: return

    dice = room["dice"]
    step = current_player["tokens"][token_idx]

    if step == -1:
        if dice == 6: current_player["tokens"][token_idx] = 0
        else: return
    elif 0 <= step < 56:
        if step + dice <= 56: current_player["tokens"][token_idx] += dice
        else: return
    else: return

    room["awaiting_move"] = False
    new_step = current_player["tokens"][token_idx]
    captured_someone = False

    if 0 <= new_step < 51:
        # Capture logic with Yellow diagonal offset (26 tiles away)
        my_offset = 0 if current_player["color"] == "red" else 26
        my_abs_pos = (my_offset + new_step) % 52
        safe_spots = [0, 8, 13, 21, 26, 34, 39, 47]
        
        if my_abs_pos not in safe_spots:
            for p in room["players"]:
                if p["sid"] != current_player["sid"]:
                    enemy_offset = 0 if p["color"] == "red" else 26
                    for i, e_step in enumerate(p["tokens"]):
                        if 0 <= e_step < 51:
                            enemy_abs_pos = (enemy_offset + e_step) % 52
                            if enemy_abs_pos == my_abs_pos:
                                p["tokens"][i] = -1 
                                captured_someone = True

    if all(s == 56 for s in current_player["tokens"]):
        room["status"] = "finished"
        socketio.emit("game_won", {"winner": current_player["name"]}, to=room_id)
        return

    if dice != 6 and not captured_someone:
        room["turn"] = (room["turn"] + 1) % len(room["players"])

    next_player = room["players"][room["turn"]]
    socketio.emit("board_updated", {
        "players": room["players"],
        "next_turn_color": next_player["color"],
        "next_turn_name": next_player["name"]
    }, to=room_id)

@socketio.on("disconnect")
def handle_disconnect():
    for room_id, room in list(rooms.items()):
        if any(p["sid"] == request.sid for p in room["players"]):
            del rooms[room_id]
            socketio.emit("opponent_disconnected", {"message": "Player disconnected"}, to=room_id)

if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)