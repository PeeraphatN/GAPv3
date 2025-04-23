from flask import Flask, request, jsonify
from datetime import datetime
import requests
import base64
import time
import threading

app = Flask(__name__)

# === CONFIG ===
API_KEY = "NNSXS.N2H34P6BHQV56AQWERJWIIU3E5UNAD5DHA3KTPI.XKVILFQK5HSSYDRW7PJWPF2BHN57B52H24LXEYZZKGISIVKSOVOQ"
APP_ID = "test2-app"
TTN_ENDPOINT = "https://mootunlesyslab.as1.cloud.thethings.industries"

# === Function to build and send downlink ===
def send_ttn_downlink(device_id: str, mode: int, duration: int = 0):
    url = f"{TTN_ENDPOINT}/api/v3/as/applications/{APP_ID}/devices/{device_id}/down/replace"
    
    payload = bytearray([mode])
    if mode == 0x02:
        payload.append(duration)

    payload_b64 = base64.b64encode(payload).decode()

    body = {
        "downlinks": [
            {
                "f_port": 1,
                "frm_payload": payload_b64,
                "priority": "NORMAL"
            }
        ]
    }

    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    }

    try:
        res = requests.post(url, headers=headers, json=body)
        return {
            "status_code": res.status_code,
            "response": res.text,
            "payload_hex": payload.hex(),
            "payload_base64": payload_b64
        }
    except Exception as e:
        return {"error": str(e)}

# === Downlink API ===
@app.route("/downlink", methods=["POST"])
def downlink():
    try:
        data = request.json
        device_id = data["id"]
        command = data["command"].upper()
        duration = int(data["duration"])

        # Determine mode
        if command == "ON" and duration == 0:
            mode = 0x01  # Manual ON
        elif command == "ON" and duration > 0:
            mode = 0x02  # Auto ON
        elif command == "OFF":
            mode = 0x03  # OFF
        else:
            return jsonify({"error": "Invalid command or duration"}), 400

        result = send_ttn_downlink(device_id, mode, duration)
        return jsonify({
            "device_id": device_id,
            "mode": mode,
            "duration": duration,
            **result
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500
    
@app.route("/uplink", methods=["POST"])
def uplink():
    response = jsonify({"status": "received"})
    threading.Thread(target=handle_downlink, args=(request.json,)).start()
    return response, 200

def handle_downlink(data):
    t0 = time.time()
    print("[DOWNLINK] Start:", t0)

    device_id = data.get("end_device_ids", {}).get("device_id", "unknown")

    result = send_ttn_downlink(device_id, 0x01, 0)
    print("[DOWNLINK] Result:", result)

    t1 = time.time()
    print("[DOWNLINK] Sent:", t1, "| Duration:", t1 - t0, "s")

# === Start Flask app ===
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)