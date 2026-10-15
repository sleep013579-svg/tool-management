// ==========================================
//          LINE Bot 多人推播與 Webhook 模組
// ==========================================
const LINE_CHANNEL_ACCESS_TOKEN = 'aVlWREci9FWVcYv1FzsOv73nYD9LlFo0LGXdaGZRP03CRXuFAt2GZmUhjz3PgMGM2APcCNWYY27ZxS44Dy6GJLcPBVQ58KEFKdI5FRC1rrU9bLqZT2BXvzGb9o0L7BQKcrhb7tZFYuOpwoCLLldc9gdB04t89/1O/w1cDnyilFU=';

// 💡 1. 將單一 ID 改成陣列 (把你要通知的所有管理員 ID 都放進來，用逗號隔開)
const LINE_TARGET_IDS = [
    'U15b897ad9424ecfacca134c08f355bb0', 
    'Ub841da64caa16c35d7b50396eab720ed', 
    // 'U第三位管理員的ID...'
]; 

// 💡 2. 發送通知函數 (改為迴圈發送給名單上的所有人)
async function sendLineMessage(message) {
    if (!LINE_CHANNEL_ACCESS_TOKEN || LINE_TARGET_IDS.length === 0) return;
    
    for (let targetId of LINE_TARGET_IDS) {
        try {
            await fetch('https://api.line.me/v2/bot/message/push', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
                },
                body: JSON.stringify({
                    to: targetId,
                    messages: [{ type: 'text', text: message }]
                })
            });
        } catch (error) {
            console.error(`❌ 發送給 ${targetId} 失敗：`, error);
        }
    }
}


const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

const app = express();
app.use(express.json());
// 💡 3. 新增 Webhook 路由：用來偷偷印出其他人的 ID
app.post('/webhook', (req, res) => {
    const events = req.body.events;
    if (events && events.length > 0) {
        events.forEach(event => {
            // 當有人傳訊息給機器人時，在終端機印出他的 ID
            if (event.type === 'message' && event.message.type === 'text') {
                console.log(`\n🕵️‍♂️ 抓到新 ID 了！\n傳訊者 ID: ${event.source.userId}\n他說了: ${event.message.text}\n`);
            }
        });
    }
    res.status(200).send('OK');
});
const port = process.env.PORT || 3000;

app.use(express.static('./')); // 讓伺服器自動讀取當前目錄下的 HTML 檔案

app.use(cors());
app.use(express.json());

const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) {
        console.error('資料庫連線失敗：', err.message);
    } else {
        console.log('成功連線到 SQLite 資料庫！');

        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS Users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE,
                password TEXT,
                role TEXT
            )`);

            // --- 建立資料表 ---
            // 1. Users 資料表
            db.run(`CREATE TABLE IF NOT EXISTS Users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    password TEXT,
    role TEXT DEFAULT 'user'
)`);

            // 2. Tools 資料表 (新增)
            db.run(`CREATE TABLE IF NOT EXISTS Tools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    status TEXT DEFAULT 'available',
    borrower TEXT DEFAULT ''
)`);


            // 3. Records 歷史紀錄與審核資料表 (新增)
db.run(`CREATE TABLE IF NOT EXISTS Records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tool_id INTEGER,
    tool_name TEXT,
    user_name TEXT,
    action TEXT,             -- 動作：'借出' 或 '歸還'
    status TEXT DEFAULT '待審核', -- 狀態：'待審核', '已核准', '已拒絕'
    request_time TEXT,       -- 申請時間
    approver TEXT DEFAULT '-', -- 審核人
    approve_time TEXT DEFAULT '-' -- 審核時間
)`);

            db.get("SELECT COUNT(*) AS count FROM Users", (err, row) => {
                if (row.count === 0) {
                    const insert = db.prepare("INSERT INTO Users (name, password, role) VALUES (?, ?, ?)");
                    insert.run("總權限(我)", "1234", "superadmin");
                    insert.run("管理員小明", "1234", "admin");
                    insert.run("員工小華", "1234", "user");
                    insert.finalize();
                }
            });
        });
    }
});
// 1. Users 資料表與自動初始化
db.run(`CREATE TABLE IF NOT EXISTS Users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    password TEXT,
    role TEXT DEFAULT 'user'
)`, (err) => {
    if (!err) {
        // 確保資料表建好後，才檢查並新增總權限帳號
        db.get("SELECT COUNT(*) AS count FROM Users", (err, row) => {
            if (row && row.count === 0) {
                db.run("INSERT INTO Users (name, password, role) VALUES ('admin', 'admin123', 'super_admin')");
                console.log("🌟 系統偵測到全新資料庫，已自動建立總權限帳號！(admin / admin123)");
            }
        });
    }
});

// --- 新增的部分：處理登入請求的 API ---
app.post('/login', (req, res) => {
    // 接收前端傳來的帳號與密碼
    const { name, password } = req.body;

    // 去資料庫尋找有沒有符合的資料
    db.get("SELECT * FROM Users WHERE name = ? AND password = ?", [name, password], (err, row) => {
        if (err) {
            return res.status(500).json({ success: false, message: '資料庫發生錯誤' });
        }

        if (row) {
            // 如果找到該名使用者，回傳成功與權限
            res.json({ success: true, message: '登入成功', role: row.role, name: row.name });
        } else {
            // 如果找不到，代表密碼輸入錯誤
            res.json({ success: false, message: '密碼錯誤' });
        }
    });
});
// ------------------------------------

// --- 新增的部分：處理註冊請求的 API ---
app.post('/register', (req, res) => {
    const { name, password } = req.body;
    const role = 'user'; // 為了安全，新註冊的人員一律預設為「一般使用者」

    if (!name || !password) {
        return res.json({ success: false, message: '名稱與密碼不能為空！' });
    }

    // 將新資料存入資料庫
    const insert = db.prepare("INSERT INTO Users (name, password, role) VALUES (?, ?, ?)");
    insert.run([name, password, role], function (err) {
        if (err) {
            // 因為我們資料庫設定 name 是 UNIQUE (唯一)，如果名稱重複會報錯
            if (err.message.includes('UNIQUE')) {
                return res.json({ success: false, message: '這個名稱已經被註冊過囉，請換一個！' });
            }
            return res.status(500).json({ success: false, message: '資料庫發生錯誤' });
        }
        res.json({ success: true, message: '註冊成功！請使用新帳號登入。' });
    });
    insert.finalize();
});
// ------------------------------------
// --- 新增的部分：取得所有使用者名稱 (供登入下拉選單使用) ---
app.get('/users', (req, res) => {
    // 從資料庫中只抓取 name 欄位
    db.all("SELECT name FROM Users", [], (err, rows) => {
        if (err) {
            return res.status(500).json({ success: false, message: '讀取名單失敗' });
        }
        res.json({ success: true, data: rows });
    });
});
// --------------------------------------------------------
// 1. 讀取記錄 API (根據權限過濾資料)
app.get('/records', (req, res) => {
    const { name, role } = req.query;
    let query = "SELECT * FROM Records ORDER BY id DESC"; // 預設：管理員/總權限看全部
    let params = [];

    // 如果是一般使用者，只能看到自己的記錄
    if (role === 'user') {
        query = "SELECT * FROM Records WHERE borrower_name = ? ORDER BY id DESC";
        params = [name];
    }

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true, data: rows });
    });
});

// ==========================================
//          工具清單與管理 API
// ==========================================

// 取得所有工具
app.get('/tools', (req, res) => {
    db.all("SELECT * FROM Tools ORDER BY status ASC, name ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: '讀取工具失敗' });
        res.json({ success: true, data: rows });
    });
});

// 管理員新增工具
app.post('/admin/add-tool', (req, res) => {
    const { name, operatorRole } = req.body;
    if (operatorRole !== 'admin' && operatorRole !== 'super_admin') return res.status(403).json({ success: false, message: '權限不足' });
    
    db.run("INSERT INTO Tools (name) VALUES (?)", [name], function(err) {
        if (err) {
            if (err.message.includes('UNIQUE')) return res.json({ success: false, message: '這個工具名稱已經存在囉！' });
            return res.status(500).json({ success: false, message: '新增失敗' });
        }
        res.json({ success: true, message: '工具新增成功！' });
    });
});

// 管理員刪除工具
app.post('/admin/delete-tool', (req, res) => {
    const { id, operatorRole } = req.body;
    if (operatorRole !== 'admin' && operatorRole !== 'super_admin') return res.status(403).json({ success: false, message: '權限不足' });
    
    db.run("DELETE FROM Tools WHERE id = ?", [id], function(err) {
        if (err) return res.status(500).json({ success: false, message: '刪除失敗' });
        res.json({ success: true, message: '工具已刪除' });
    });
});
// 管理員修改工具狀態
app.post('/admin/edit-tool-status', (req, res) => {
    const { toolId, newStatus, newBorrower, operatorRole } = req.body;
    
    // 檢查權限
    if (operatorRole !== 'admin' && operatorRole !== 'super_admin') {
        return res.status(403).json({ success: false, message: '權限不足' });
    }
    
    // 執行更新 (將狀態與借出人一起更新)
    db.run("UPDATE Tools SET status = ?, borrower = ? WHERE id = ?", [newStatus, newBorrower || '', toolId], function(err) {
        if (err) return res.status(500).json({ success: false, message: '更新失敗' });
        res.json({ success: true, message: '工具狀態已成功更新！' });
    });
});

// ==========================================
//          工具借還申請與審核 API
// ==========================================

function getNowTime() {
    return new Date().toLocaleString('zh-TW', { hour12: false });
}

// 處理借用申請 API
app.post('/borrow', (req, res) => {
    const { toolId, toolName, userName } = req.body;
    const now = new Date().toLocaleString();

    // 寫入借用紀錄
    db.run("INSERT INTO Records (tool_id, tool_name, user_name, action, status, request_time) VALUES (?, ?, ?, '借出', '待審核', ?)", 
    [toolId, toolName, userName, now], function(err) {
        if (err) return res.status(500).json({ success: false, message: '資料庫寫入失敗' });
        
        // 💡 關鍵：這裡一定要呼叫發送通知的函數！
        sendLineMessage(`\n🔔【新增借用申請】\n申請人：${userName}\n工具名稱：${toolName}\n請管理員盡速至後台審核！`);
        
        res.json({ success: true, message: '借出申請已送出，請等待管理員審核！' });
    });
});

// 處理歸還申請 API
app.post('/return', (req, res) => {
    const { toolId, toolName, userName } = req.body;
    const now = new Date().toLocaleString();

    // 寫入歸還紀錄
    db.run("INSERT INTO Records (tool_id, tool_name, user_name, action, status, request_time) VALUES (?, ?, ?, '歸還', '待審核', ?)", 
    [toolId, toolName, userName, now], function(err) {
        if (err) return res.status(500).json({ success: false, message: '資料庫寫入失敗' });
        
        // 💡 關鍵：這裡一定要呼叫發送通知的函數！
        sendLineMessage(`\n✅【新增歸還申請】\n申請人：${userName}\n工具名稱：${toolName}\n請管理員確認工具並至後台審核！`);
        
        res.json({ success: true, message: '歸還申請已送出，請交給管理員！' });
    });
});

// 管理員：取得待審核清單
app.get('/admin/pending-requests', (req, res) => {
    db.all("SELECT * FROM Records WHERE status = '待審核' ORDER BY id ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: '讀取失敗' });
        res.json({ success: true, data: rows });
    });
});

// 管理員：執行審核
app.post('/admin/approve', (req, res) => {
    const { recordId, toolId, action, isApproved, operatorName, operatorRole } = req.body;
    if (operatorRole !== 'admin' && operatorRole !== 'super_admin') return res.status(403).json({ success: false, message: '權限不足' });

    const now = getNowTime();
    const finalStatus = isApproved ? '已核准' : '已拒絕';

    db.run("UPDATE Records SET status = ?, approver = ?, approve_time = ? WHERE id = ?", [finalStatus, operatorName, now, recordId], function(err) {
        if (err) return res.status(500).json({ success: false, message: '審核更新失敗' });

        if (action === '借出') {
            if (isApproved) {
                db.get("SELECT user_name FROM Records WHERE id = ?", [recordId], (err, row) => {
                    db.run("UPDATE Tools SET status = 'borrowed', borrower = ? WHERE id = ?", [row.user_name, toolId]);
                });
            } else {
                db.run("UPDATE Tools SET status = 'available', borrower = '' WHERE id = ?", [toolId]);
            }
        } else if (action === '歸還') {
            if (isApproved) {
                db.run("UPDATE Tools SET status = 'available', borrower = '' WHERE id = ?", [toolId]);
            } else {
                db.run("UPDATE Tools SET status = 'borrowed' WHERE id = ?", [toolId]);
            }
        }
        res.json({ success: true, message: `已成功${finalStatus}！` });
    });
});

// 管理員：取得所有紀錄
app.get('/admin/all-records', (req, res) => {
    db.all("SELECT * FROM Records ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: '讀取失敗' });
        res.json({ success: true, data: rows });
    });
});

// ==========================================
//          管理員專屬 API 區塊
// ==========================================

// ==========================================
//          工具清單與借還 API 區塊
// ==========================================

// 1. 取得所有工具與借出狀態 (主畫面與選單用)
app.get('/tools', (req, res) => {
    db.all("SELECT * FROM Tools ORDER BY status ASC, name ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: '讀取工具失敗' });
        res.json({ success: true, data: rows });
    });
});

// 2. 管理員新增工具
app.post('/admin/add-tool', (req, res) => {
    const { name, operatorRole } = req.body;
    if (operatorRole !== 'admin' && operatorRole !== 'super_admin') {
        return res.status(403).json({ success: false, message: '權限不足' });
    }
    db.run("INSERT INTO Tools (name) VALUES (?)", [name], function (err) {
        if (err) {
            if (err.message.includes('UNIQUE')) return res.json({ success: false, message: '這個工具名稱已經存在囉！' });
            return res.status(500).json({ success: false, message: '新增失敗' });
        }
        res.json({ success: true, message: '工具新增成功！' });
    });
});

// 3. 管理員刪除工具
app.post('/admin/delete-tool', (req, res) => {
    const { id, operatorRole } = req.body;
    if (operatorRole !== 'admin' && operatorRole !== 'super_admin') {
        return res.status(403).json({ success: false, message: '權限不足' });
    }
    db.run("DELETE FROM Tools WHERE id = ?", [id], function (err) {
        if (err) return res.status(500).json({ success: false, message: '刪除失敗' });
        res.json({ success: true, message: '工具已刪除' });
    });
});



// 1. 取得完整人員清單 (包含 ID、密碼與權限)
app.get('/admin/users', (req, res) => {
    // 接收前端傳來的操作者權限
    const operatorRole = req.query.role;

    // 從資料庫多抓取 password 欄位
    db.all("SELECT id, name, role, password FROM Users ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: '讀取失敗' });

        // 安全機制：如果不是總權限，就將密碼隱藏為星號
        if (operatorRole !== 'super_admin') {
            rows.forEach(r => r.password = '***');
        }
        res.json({ success: true, data: rows });
    });
});

// 2. 編輯人員 (更聰明的防護邏輯)
app.post('/admin/edit-user', (req, res) => {
    const { id, name, role, operatorRole } = req.body;

    // 先查詢這個人原本的權限是什麼
    db.get("SELECT role FROM Users WHERE id = ?", [id], (err, row) => {
        if (err) return res.status(500).json({ success: false, message: '查詢失敗' });

        const originalRole = row ? row.role : 'user';

        // 邏輯判斷：如果這次的請求試圖「改變權限」，且操作者不是總權限，就擋下
        if (role !== originalRole && operatorRole !== 'super_admin') {
            return res.status(403).json({ success: false, message: '權限不足：只有【總權限者】才可以修改權限！' });
        }

        // 若檢查通過 (可能是總權限在操作，或者是管理員只改名字不改權限)，則執行更新
        db.run("UPDATE Users SET name = ?, role = ? WHERE id = ?", [name, role, id], function (err) {
            if (err) {
                if (err.message.includes('UNIQUE')) return res.json({ success: false, message: '此名稱已有人使用！' });
                return res.status(500).json({ success: false, message: '更新失敗' });
            }
            res.json({ success: true, message: '資料已更新' });
        });
    });
});

// --- 緊急救援通道：強制把某人升級為總權限 ---
app.get('/make-me-super/:name', (req, res) => {
    const targetName = req.params.name;
    db.run("UPDATE Users SET role = 'super_admin' WHERE name = ?", [targetName], function (err) {
        if (err) return res.send('發生錯誤');
        res.send(`<h1>救援成功！</h1><p>已將 <b>${targetName}</b> 的權限強制升級為總權限！請關閉此分頁，並回到系統重新登入。</p>`);
    });
});
// ----------------------------------------

// 3. 重設密碼
app.post('/admin/reset-password', (req, res) => {
    const { id, newPassword } = req.body;
    db.run("UPDATE Users SET password = ? WHERE id = ?", [newPassword, id], function (err) {
        if (err) return res.status(500).json({ success: false, message: '密碼重設失敗' });
        res.json({ success: true, message: `密碼已成功重設為：${newPassword}` });
    });
});

// 4. 刪除帳號
app.post('/admin/delete-user', (req, res) => {
    const { id } = req.body;
    db.run("DELETE FROM Users WHERE id = ?", [id], function (err) {
        if (err) return res.status(500).json({ success: false, message: '刪除失敗' });
        res.json({ success: true, message: '帳號已刪除' });
    });
});
app.listen(port, () => {
    console.log(`伺服器已經順利啟動！網址是 http://localhost:${port}`);
});