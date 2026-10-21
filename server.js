// ==========================================
//          LINE Bot 多人推播與 Webhook 模組
// ==========================================
const LINE_CHANNEL_ACCESS_TOKEN = 'aVlWREci9FWVcYv1FzsOv73nYD9LlFo0LGXdaGZRP03CRXuFAt2GZmUhjz3PgMGM2APcCNWYY27ZxS44Dy6GJLcPBVQ58KEFKdI5FRC1rrU9bLqZT2BXvzGb9o0L7BQKcrhb7tZFYuOpwoCLLldc9gdB04t89/1O/w1cDnyilFU=';

const LINE_TARGET_IDS = [
    'U15b897ad9424ecfacca134c08f355bb0', 
    'Ub841da64caa16c35d7b50396eab720ed'
]; 

async function sendLineMessage(message) {
    if (!LINE_CHANNEL_ACCESS_TOKEN) return;
    
    try {
        // 💡 注意：網址從 /push 變成了 /broadcast
        await fetch('https://api.line.me/v2/bot/message/broadcast', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
            },
            body: JSON.stringify({
                // 💡 廣播不需要填寫 'to: targetId'，直接放 messages 即可
                messages: [{ type: 'text', text: message }]
            })
        });
    } catch (error) {
        console.error(`❌ 廣播發送失敗：`, error);
    }
}

// ==========================================
//          Express 伺服器與套件設定
// ==========================================
const express = require('express');
const { Pool } = require('pg'); // 🌟 引入 PostgreSQL 雲端資料庫套件
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('./'));

// 新增 Webhook 路由：自動判斷是個人還是群組
app.post('/webhook', (req, res) => {
    const events = req.body.events;
    if (events && events.length > 0) {
        events.forEach(event => {
            if (event.type === 'message' && event.message.type === 'text') {
                const source = event.source;
                let targetId = source.userId; // 預設抓取個人 ID (U開頭)
                let sourceType = '個人';

                // 💡 關鍵判斷：如果訊息來自群組，就改抓群組 ID (C開頭)
                if (source.type === 'group') {
                    targetId = source.groupId;
                    sourceType = '群組';
                }

                console.log(`\n🕵️‍♂️ 抓到新 ID 了！`);
                console.log(`📍 來源：${sourceType}`);
                console.log(`🔑 專屬 ID：${targetId}`);
                console.log(`💬 訊息內容：${event.message.text}\n`);
            }
        });
    }
    res.status(200).send('OK');
});

// ==========================================
//          PostgreSQL 雲端資料庫連線與初始化
// ==========================================
const pool = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_oOyJjUgrF0c9@ep-flat-tooth-b5d0ohov-pooler.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
});

pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ 資料庫連線失敗：', err.stack);
    } else {
        console.log('✅ 成功連線到 Neon PostgreSQL 雲端資料庫！');
        release();
        initDB(); // 執行自動建表
    }
});

function initDB() {
    const createUsersTable = `
        CREATE TABLE IF NOT EXISTS Users (
            id SERIAL PRIMARY KEY,
            name TEXT UNIQUE,
            password TEXT,
            role TEXT DEFAULT 'user'
        );
    `;
    const createToolsTable = `
        CREATE TABLE IF NOT EXISTS Tools (
            id SERIAL PRIMARY KEY,
            name TEXT UNIQUE,
            status TEXT DEFAULT 'available',
            borrower TEXT DEFAULT ''
        );
    `;
    const createRecordsTable = `
        CREATE TABLE IF NOT EXISTS Records (
            id SERIAL PRIMARY KEY,
            tool_id INTEGER,
            tool_name TEXT,
            user_name TEXT,
            action TEXT,
            status TEXT DEFAULT '待審核',
            request_time TEXT,
            approver TEXT DEFAULT '-',
            approve_time TEXT DEFAULT '-'
        );
    `;

    pool.query(createUsersTable)
        .then(() => pool.query(createToolsTable))
        .then(() => pool.query(createRecordsTable))
        .then(() => {
            // 檢查是否有管理員帳號，若無則自動建立
            pool.query("SELECT COUNT(*) AS count FROM Users", (err, result) => {
                if (result && result.rows[0].count === '0') {
                    pool.query("INSERT INTO Users (name, password, role) VALUES ('admin', 'admin123', 'super_admin')");
                    console.log("🌟 系統偵測到全新資料庫，已自動建立總權限帳號！(admin / admin123)");
                }
            });
        })
        .catch(err => console.error('❌ 建表失敗：', err));
}

// ==========================================
//          登入與人員管理 API
// ==========================================
app.post('/login', (req, res) => {
    const { name, password } = req.body;
    pool.query("SELECT * FROM Users WHERE name = $1 AND password = $2", [name, password], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: '資料庫發生錯誤' });
        const row = result.rows[0];
        if (row) {
            res.json({ success: true, message: '登入成功', role: row.role, name: row.name });
        } else {
            res.json({ success: false, message: '密碼錯誤' });
        }
    });
});

app.post('/register', (req, res) => {
    const { name, password } = req.body;
    const role = 'user';
    if (!name || !password) return res.json({ success: false, message: '名稱與密碼不能為空！' });

    pool.query("INSERT INTO Users (name, password, role) VALUES ($1, $2, $3)", [name, password, role], (err) => {
        if (err) {
            if (err.code === '23505' || (err.message && err.message.includes('unique'))) {
                return res.json({ success: false, message: '這個名稱已經被註冊過囉，請換一個！' });
            }
            return res.status(500).json({ success: false, message: '資料庫發生錯誤' });
        }
        res.json({ success: true, message: '註冊成功！請使用新帳號登入。' });
    });
});

app.get('/users', (req, res) => {
    pool.query("SELECT name FROM Users", (err, result) => {
        if (err) return res.status(500).json({ success: false, message: '讀取名單失敗' });
        res.json({ success: true, data: result.rows });
    });
});

app.get('/admin/users', (req, res) => {
    const operatorRole = req.query.role;
    pool.query("SELECT id, name, role, password FROM Users ORDER BY id DESC", (err, result) => {
        if (err) return res.status(500).json({ success: false, message: '讀取失敗' });
        const rows = result.rows;
        if (operatorRole !== 'super_admin') {
            rows.forEach(r => r.password = '***');
        }
        res.json({ success: true, data: rows });
    });
});

app.post('/admin/edit-user', (req, res) => {
    const { id, name, role, operatorRole } = req.body;
    pool.query("SELECT role FROM Users WHERE id = $1", [id], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: '查詢失敗' });
        const originalRole = result.rows[0] ? result.rows[0].role : 'user';

        if (role !== originalRole && operatorRole !== 'super_admin') {
            return res.status(403).json({ success: false, message: '權限不足：只有【總權限者】才可以修改權限！' });
        }
        pool.query("UPDATE Users SET name = $1, role = $2 WHERE id = $3", [name, role, id], (err) => {
            if (err) {
                if (err.code === '23505') return res.json({ success: false, message: '此名稱已有人使用！' });
                return res.status(500).json({ success: false, message: '更新失敗' });
            }
            res.json({ success: true, message: '資料已更新' });
        });
    });
});

app.post('/admin/reset-password', (req, res) => {
    const { id, newPassword } = req.body;
    pool.query("UPDATE Users SET password = $1 WHERE id = $2", [newPassword, id], (err) => {
        if (err) return res.status(500).json({ success: false, message: '密碼重設失敗' });
        res.json({ success: true, message: `密碼已成功重設為：${newPassword}` });
    });
});

app.post('/admin/delete-user', (req, res) => {
    const { id } = req.body;
    pool.query("DELETE FROM Users WHERE id = $1", [id], (err) => {
        if (err) return res.status(500).json({ success: false, message: '刪除失敗' });
        res.json({ success: true, message: '帳號已刪除' });
    });
});

app.get('/make-me-super/:name', (req, res) => {
    const targetName = req.params.name;
    pool.query("UPDATE Users SET role = 'super_admin' WHERE name = $1", [targetName], (err) => {
        if (err) return res.send('發生錯誤');
        res.send(`<h1>救援成功！</h1><p>已將 <b>${targetName}</b> 的權限強制升級為總權限！請關閉此分頁，並回到系統重新登入。</p>`);
    });
});

// ==========================================
//          工具與紀錄管理 API
// ==========================================
app.get('/tools', (req, res) => {
    pool.query("SELECT * FROM Tools ORDER BY status ASC, name ASC", (err, result) => {
        if (err) return res.status(500).json({ success: false, message: '讀取工具失敗' });
        res.json({ success: true, data: result.rows });
    });
});

app.post('/admin/add-tool', (req, res) => {
    const { name, operatorRole } = req.body;
    if (operatorRole !== 'admin' && operatorRole !== 'super_admin') return res.status(403).json({ success: false, message: '權限不足' });
    
    pool.query("INSERT INTO Tools (name) VALUES ($1)", [name], (err) => {
        if (err) {
            if (err.code === '23505') return res.json({ success: false, message: '這個工具名稱已經存在囉！' });
            return res.status(500).json({ success: false, message: '新增失敗' });
        }
        res.json({ success: true, message: '工具新增成功！' });
    });
});

app.post('/admin/delete-tool', (req, res) => {
    const { id, operatorRole } = req.body;
    if (operatorRole !== 'admin' && operatorRole !== 'super_admin') return res.status(403).json({ success: false, message: '權限不足' });
    
    pool.query("DELETE FROM Tools WHERE id = $1", [id], (err) => {
        if (err) return res.status(500).json({ success: false, message: '刪除失敗' });
        res.json({ success: true, message: '工具已刪除' });
    });
});

app.post('/admin/edit-tool-status', (req, res) => {
    const { toolId, newStatus, newBorrower, operatorRole } = req.body;
    if (operatorRole !== 'admin' && operatorRole !== 'super_admin') return res.status(403).json({ success: false, message: '權限不足' });
    
    pool.query("UPDATE Tools SET status = $1, borrower = $2 WHERE id = $3", [newStatus, newBorrower || '', toolId], (err) => {
        if (err) return res.status(500).json({ success: false, message: '更新失敗' });
        res.json({ success: true, message: '工具狀態已成功更新！' });
    });
});

app.get('/records', (req, res) => {
    const { name, role } = req.query;
    let query = "SELECT * FROM Records ORDER BY id DESC";
    let params = [];

    if (role === 'user') {
        // 💡 修復原版的欄位名稱錯誤 (borrower_name -> user_name)
        query = "SELECT * FROM Records WHERE user_name = $1 ORDER BY id DESC";
        params = [name];
    }

    pool.query(query, params, (err, result) => {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true, data: result.rows });
    });
});

app.get('/admin/all-records', (req, res) => {
    pool.query("SELECT * FROM Records ORDER BY id DESC", (err, result) => {
        if (err) return res.status(500).json({ success: false, message: '讀取失敗' });
        res.json({ success: true, data: result.rows });
    });
});

// ==========================================
//          工具借還申請與審核 API
// ==========================================
function getNowTime() {
    return new Date().toLocaleString('zh-TW', { hour12: false });
}

app.post('/borrow', (req, res) => {
    const { toolId, toolName, userName } = req.body;
    const now = getNowTime();

    pool.query("INSERT INTO Records (tool_id, tool_name, user_name, action, status, request_time) VALUES ($1, $2, $3, '借出', '待審核', $4)", 
    [toolId, toolName, userName, now], (err) => {
        if (err) return res.status(500).json({ success: false, message: '資料庫寫入失敗' });
        
        pool.query("UPDATE Tools SET status = 'pending_borrow', borrower = $1 WHERE id = $2", [userName, toolId], (updateErr) => {
            sendLineMessage(`\n🔔【新增借用申請】\n申請人：${userName}\n工具名稱：${toolName}\n請管理員盡速至後台審核！`);
            res.json({ success: true, message: '借出申請已送出，請等待管理員審核！' });
        });
    });
});

app.post('/return', (req, res) => {
    const { toolId, toolName, userName } = req.body;
    const now = getNowTime();

    pool.query("INSERT INTO Records (tool_id, tool_name, user_name, action, status, request_time) VALUES ($1, $2, $3, '歸還', '待審核', $4)", 
    [toolId, toolName, userName, now], (err) => {
        if (err) return res.status(500).json({ success: false, message: '資料庫寫入失敗' });
        
        pool.query("UPDATE Tools SET status = 'pending_return' WHERE id = $1", [toolId], (updateErr) => {
            sendLineMessage(`\n✅【新增歸還申請】\n申請人：${userName}\n工具名稱：${toolName}\n請管理員確認工具並至後台審核！`);
            res.json({ success: true, message: '歸還申請已送出，請交給管理員！' });
        });
    });
});

app.get('/admin/pending-requests', (req, res) => {
    pool.query("SELECT * FROM Records WHERE status = '待審核' ORDER BY id ASC", (err, result) => {
        if (err) return res.status(500).json({ success: false, message: '讀取失敗' });
        res.json({ success: true, data: result.rows });
    });
});

app.post('/admin/approve', (req, res) => {
    const { recordId, toolId, action, isApproved, operatorName, operatorRole } = req.body;
    if (operatorRole !== 'admin' && operatorRole !== 'super_admin') return res.status(403).json({ success: false, message: '權限不足' });

    const now = getNowTime();
    const finalStatus = isApproved ? '已核准' : '已拒絕';

    pool.query("UPDATE Records SET status = $1, approver = $2, approve_time = $3 WHERE id = $4", [finalStatus, operatorName, now, recordId], (err) => {
        if (err) return res.status(500).json({ success: false, message: '審核更新失敗' });

        if (action === '借出') {
            if (isApproved) {
                pool.query("SELECT user_name FROM Records WHERE id = $1", [recordId], (err, result) => {
                    const borrowerName = result.rows[0] ? result.rows[0].user_name : '';
                    pool.query("UPDATE Tools SET status = 'borrowed', borrower = $1 WHERE id = $2", [borrowerName, toolId]);
                });
            } else {
                pool.query("UPDATE Tools SET status = 'available', borrower = '' WHERE id = $1", [toolId]);
            }
        } else if (action === '歸還') {
            if (isApproved) {
                pool.query("UPDATE Tools SET status = 'available', borrower = '' WHERE id = $1", [toolId]);
            } else {
                pool.query("UPDATE Tools SET status = 'borrowed' WHERE id = $1", [toolId]);
            }
        }
        res.json({ success: true, message: `已成功${finalStatus}！` });
    });
});

// ==========================================
//          伺服器啟動設定
// ==========================================
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`伺服器已經順利啟動！網址是 http://localhost:${port}`);
});