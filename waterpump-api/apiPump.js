const axios = require('axios');
const base64 = require('base-64');
const cron = require('node-cron');

const TTN_API_KEY = process.env.TTN_API_KEY;
const APP_ID = process.env.TTN_APP_ID;
const TTN_ENDPOINT = process.env.TTN_ENDPOINT;

let scheduleCache = [];

async function sendDownlink(device_id, mode, duration = 0) {
    const url = `${TTN_ENDPOINT}/api/v3/as/applications/${APP_ID}/devices/${device_id}/down/replace`;

    let payload = [mode];
    if (mode === 0x02) payload.push(duration);

    const frm_payload = base64.encode(String.fromCharCode(...payload));

    const body = {
        downlinks: [
            {
                f_port: 1,
                frm_payload,
                priority: "NORMAL",
                confirmed: true
            }
        ]
    };

    try {
        const res = await axios.post(url, body, {
            headers: {
                Authorization: `Bearer ${TTN_API_KEY}`,
                "Content-Type": "application/json"
            }
        });

        return {
            success: true,
            status_code: res.status,
            response: res.data,
            payload_hex: Buffer.from(payload).toString('hex'),
            payload_base64: frm_payload
        };
    } catch (error) {
        const statusCode = error.response?.status || 500;
        const message = error.response?.data?.message || error.message;

        return {
            success: false,
            status_code: statusCode,
            message,
            detail: error.response?.data,
        };
    }
}

module.exports = function apiPump(app, db, apifunc, dbpackage, listDB, io, urlNgrok) {

    async function updateScheduleCache() {
        try {
            const [rows] = await listDB.query(`SELECT * FROM pump_schedule`);
            scheduleCache = rows;
            console.log(`[scheduleCache] updated (${rows.length} records)`);
        } catch (err) {
            console.error("[scheduleCache] failed to update:", err);
        }
    }

    cron.schedule('*/10 * * * *', updateScheduleCache);
    updateScheduleCache();

    app.post("/api/pump/control", async (req, res) => {
        const { device_id, action } = req.body;
        if (!["on", "off"].includes(action)) {
            return res.status(400).json({ error: "Invalid action: must be 'on' or 'off'" });
        }
        const mode = action === "on" ? 0x01 :
                     action === "off" ? 0x03 : null;
    
        if (mode === null) {
            return res.status(400).json({ error: "Invalid action" });
        }
    
        const result = await sendDownlink(device_id, mode);
    
        if (!result.success) {
            console.warn(`[TTN ERROR] Device: ${device_id} →`, result.message);
            return res.status(400).json({
                status: "failed",
                reason: result.message,
                detail: result.detail
            });
        }
    
        await listDB.query(
            `INSERT INTO pump_log (device_id, action, source) VALUES (?, ?, ?)`,
            [device_id, action, "manual"]
        );
    
        res.json({ status: "pump_control_logged", ...result });
    });
    

    app.post("/api/pump/schedule", async (req, res) => {
        const { device_id, start_time, duration, source = "auto" } = req.body;
    
        // Validate input
        if (!device_id || !start_time || duration == null) {
            return res.status(400).json({ error: "Missing required fields (device_id, start_time, duration)" });
        }
    
        // not allow manual commands in schedule
        if (source === "manual") {
            return res.status(400).json({ error: "Manual commands are not allowed in schedule" });
        }
    
        // Validate device_id ผ่าน TTN
        const testDownlink = await sendDownlink(device_id, 0x00, 0);
        if (!testDownlink.success) {
            return res.status(400).json({
                status: "failed",
                reason: "Device not found or invalid",
                detail: testDownlink.detail
            });
        }
    
        try {
            const [existing] = await listDB.query(
                `SELECT * FROM pump_schedule WHERE device_id = ? AND start_time = ?`,
                [device_id, start_time]
            );
                if (existing.length > 0) {
                return res.status(409).json({ error: "Schedule already exists for this device and time." });
            }
            await listDB.query(
                `INSERT INTO pump_schedule (device_id, start_time, duration) VALUES (?, ?, ?)`,
                [device_id, start_time, duration]
            );
            await updateScheduleCache();
            res.json({ status: "schedule_added" });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: "insert schedule failed" });
        }
    });
    

    app.get("/api/pump/schedule", async (req, res) => {
        const { device_id } = req.query;
        try {
            const [rows] = await listDB.query(
                `SELECT * FROM pump_schedule WHERE device_id = ? ORDER BY start_time`,
                [device_id]
            );
            res.json(rows);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: "failed to fetch schedule" });
        }
    });

    app.get('/api/pump/log', async (req, res) => {
        const { device_id } = req.query;
        try {
            let sql = `SELECT * FROM pump_log`;
            let params = [];

            if (device_id) {
                sql += ` WHERE device_id = ? ORDER BY timestamp DESC`;
                params.push(device_id);
            } else {
                sql += ` ORDER BY timestamp DESC`;
            }

            const [rows] = await listDB.query(sql, params);
            res.json(rows);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'DB error' });
        }
    });

    app.delete("/api/pump/schedule/:id", async (req, res) => {
        const { id } = req.params;
        try {
            const [result] = await listDB.query(`DELETE FROM pump_schedule WHERE id = ?`, [id]);
            if (result.affectedRows === 0) {
                return res.status(404).json({ error: "Schedule not found" });
            }
            await updateScheduleCache();
            res.json({ status: "schedule_deleted" });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: "failed to delete schedule" });
        }
    });

    cron.schedule('* * * * *', async () => {
        const now = new Date();
        const currentTime = now.toTimeString().slice(0, 5);

        const dueSchedules = scheduleCache.filter(row =>
            row.start_time.slice(0, 5) === currentTime
        );

        for (const row of dueSchedules) {
            const { device_id, duration } = row;
            const mode = 0x02;

            console.log(`Trigger schedule → ${device_id} (${duration} min)`);

            const result = await sendDownlink(device_id, mode, duration);

            if (!result.success) {
                console.warn(`[SCHEDULE ERROR] Device: ${device_id} →`, result.message);
                continue; // skip logging if failed
            }

            await listDB.query(
                `INSERT INTO pump_log (device_id, action, source) VALUES (?, ?, ?)`,
                [device_id, "on", "auto"]
            );
        }

        if (dueSchedules.length > 0) {
            await updateScheduleCache();
        }
    });
};
