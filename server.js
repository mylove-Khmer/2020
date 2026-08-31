const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { BakongKHQR, IndividualInfo } = require('bakong-khqr');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(cors());
app.use(express.json());

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}
const mediaDir = path.join(__dirname, 'public_media');
if (!fs.existsSync(mediaDir)) {
    fs.mkdirSync(mediaDir);
}
app.use('/media', express.static(mediaDir));

const upload = multer({ dest: 'uploads/' });
const chatUpload = multer({ dest: 'public_media/' });

let accountStock = [];
let orders = {};
let users = {}; // { username: { password, email, phone, createdAt } }
let chatMessages = {}; 
let userChatMapping = {}; 

const BOT_TOKEN = '8917816041:AAEAxBlMIg6auHX6WrcO_HudfFLTQT7sLXQ';
const ADMIN_CHAT_ID = '5915683588';

const bot = new TelegramBot(BOT_TOKEN, { 
    polling: {
        autoStart: true,
        params: { timeout: 10 }
    } 
});

bot.on('polling_error', (error) => {
    console.log('[Bot Notice]:', error.message);
});

// --- TELEGRAM COMMANDS ---
bot.onText(/\/add([\s\S]*)/, async (msg, match) => {
    if (msg.chat.id.toString() !== ADMIN_CHAT_ID) return;
    const inputData = match[1].trim();
    if (!inputData) {
        return bot.sendMessage(ADMIN_CHAT_ID, "⚠️ សូមបញ្ចូលទិន្នន័យអាខោនតាមទម្រង់៖\n`/add UID|Pass|2FA|Mail|Pass`", { parse_mode: 'Markdown' });
    }
    const newAccounts = inputData.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    accountStock.push(...newAccounts);
    await bot.sendMessage(ADMIN_CHAT_ID, `✅ បានបញ្ចូលចំនួន *${newAccounts.length}* អាខោនជោគជ័យ!\n📦 ស្តុកសរុបបច្ចុប្បន្ន៖ *${accountStock.length}* អាខោន`, { parse_mode: 'Markdown' });
});

bot.onText(/\/stock/, async (msg) => {
    if (msg.chat.id.toString() !== ADMIN_CHAT_ID) return;
    await bot.sendMessage(ADMIN_CHAT_ID, `📦 ស្តុកអាខោននៅសល់សរុប៖ *${accountStock.length}* អាខោន`, { parse_mode: 'Markdown' });
});

// Command សម្រាប់ Admin មើលចំនួន និងបញ្ជីអ្នកចុះឈ្មោះទាំងអស់
bot.onText(/\/users/, async (msg) => {
    if (msg.chat.id.toString() !== ADMIN_CHAT_ID) return;
    
    const userList = Object.keys(users);
    const totalCount = userList.length;

    if (totalCount === 0) {
        return bot.sendMessage(ADMIN_CHAT_ID, "📊 មិនទាន់មានអ្នកចុះឈ្មោះគណនីនៅឡើយទេ។");
    }

    let report = `👥 *ស្ថិតិអ្នកចុះឈ្មោះចូលប្រើប្រាស់*\n`;
    report += `📈 *សរុបទាំងអស់:* \`${totalCount}\` នាក់\n\n`;

    userList.forEach((u, index) => {
        const item = users[u];
        report += `*${index + 1}. គណនី:* \`${u}\`\n`;
        report += `   📧 Email: \`${item.email || 'មិនមាន'}\`\n`;
        report += `   📱 Phone: \`${item.phone || 'មិនមាន'}\`\n`;
        report += `   🕒 កាលបរិច្ឆេទ: ${item.createdAt || 'N/A'}\n\n`;
    });

    await bot.sendMessage(ADMIN_CHAT_ID, report, { parse_mode: 'Markdown' });
});

// --- ADMIN REPLY TO CUSTOMER VIA TELEGRAM ---
bot.on('message', async (msg) => {
    if (msg.chat.id.toString() !== ADMIN_CHAT_ID) return;
    if (!msg.reply_to_message) return;

    const replyTargetId = msg.reply_to_message.message_id;
    const customerUser = userChatMapping[replyTargetId];
    if (!customerUser) return;

    if (!chatMessages[customerUser]) chatMessages[customerUser] = [];

    const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (msg.text) {
        chatMessages[customerUser].push({
            sender: 'admin',
            type: 'text',
            content: msg.text,
            time: timeNow
        });
    } else if (msg.voice || msg.audio) {
        const fileId = msg.voice ? msg.voice.file_id : msg.audio.file_id;
        const link = await bot.getFileLink(fileId);
        chatMessages[customerUser].push({
            sender: 'admin',
            type: 'audio',
            content: link,
            time: timeNow
        });
    } else if (msg.photo) {
        const fileId = msg.photo[msg.photo.length - 1].file_id;
        const link = await bot.getFileLink(fileId);
        chatMessages[customerUser].push({
            sender: 'admin',
            type: 'image',
            content: link,
            time: timeNow
        });
    } else if (msg.video) {
        const fileId = msg.video.file_id;
        const link = await bot.getFileLink(fileId);
        chatMessages[customerUser].push({
            sender: 'admin',
            type: 'video',
            content: link,
            time: timeNow
        });
    }
});

// --- API SERVER ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// API ចុះឈ្មោះ (Register) រួមមាន Username, Password, Email, Phone
app.post('/api/register', async (req, res) => {
    try {
        const { username, password, email, phone } = req.body;
        if (!username || !password || !email || !phone) {
            return res.status(400).json({ success: false, message: "សូមបំពេញព័ត៌មាន (ឈ្មោះ, អ៊ីមែល, លេខទូរស័ព្ទ, លេខសម្ងាត់) ឱ្យបានគ្រប់គ្រាន់!" });
        }
        if (users[username]) {
            return res.status(400).json({ success: false, message: "ឈ្មោះគណនីនេះមានរួចហើយ!" });
        }

        const dateStr = new Date().toLocaleString('en-US', { timeZone: 'Asia/Phnom_Penh' });
        users[username] = { 
            password, 
            email: email.trim(), 
            phone: phone.trim(),
            createdAt: dateStr
        };

        // ផ្ញើសារប្រាប់ Admin លើ Telegram ភ្លាមៗរាល់ពេលមានអ្នកចុះឈ្មោះថ្មី
        const totalNow = Object.keys(users).length;
        bot.sendMessage(
            ADMIN_CHAT_ID,
            `🎉 *មានសមាជិកថ្មីទើបនឹងចុះឈ្មោះ!*\n\n` +
            `👤 *Username:* \`${username}\`\n` +
            `📧 *Email:* \`${email}\`\n` +
            `📱 *Phone:* \`${phone}\`\n` +
            `👥 *សមាជិកសរុបបច្ចុប្បន្ន:* \`${totalNow}\` នាក់`,
            { parse_mode: 'Markdown' }
        ).catch(() => {});

        return res.json({ success: true, message: "ចុះឈ្មោះជោគជ័យ!" });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Server Error" });
    }
});

// API ចូលប្រើ (Login)
app.post('/api/login', (req, res) => {
    try {
        const { username, password } = req.body;
        const user = users[username];
        if (!user || user.password !== password) {
            return res.status(400).json({ success: false, message: "ឈ្មោះគណនី ឬលេខសម្ងាត់មិនត្រឹមត្រូវ!" });
        }
        return res.json({ success: true, username: username });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Server Error" });
    }
});

// API សម្រាប់ទាញយកស្ថិតិអ្នកចុះឈ្មោះទៅបង្ហាញលើ Admin Web
app.get('/api/admin/users', (req, res) => {
    const list = Object.keys(users).map(u => ({
        username: u,
        email: users[u].email,
        phone: users[u].phone,
        createdAt: users[u].createdAt
    }));
    res.json({ success: true, total: list.length, users: list });
});

// API បង្កើត KHQR
app.post('/api/create-khqr', (req, res) => {
    try {
        const { amount } = req.body;
        const khqr = new BakongKHQR();
        const individualInfo = new IndividualInfo(
            "mon_samnang@bkrt",
            "SAMNANG MON",
            "Phnom Penh"
        );
        const qrResponse = khqr.generateIndividual(individualInfo);
        if (qrResponse && qrResponse.data && qrResponse.data.qr) {
            return res.json({ success: true, qrString: qrResponse.data.qr, amount: parseFloat(amount).toFixed(2) });
        } else {
            return res.status(400).json({ success: false, message: "មិនអាចបង្កើត QR Code បានទេ" });
        }
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

// API ទទួល Slip និង Order
app.post('/api/submit-order', upload.single('slip'), async (req, res) => {
    try {
        const { productName, quantity, totalAmount, orderId, buyerUsername } = req.body;
        const slipFile = req.file;
        const qtyNumber = parseInt(quantity) || 1;

        const buyerInfo = users[buyerUsername] || {};

        orders[orderId] = { 
            status: 'pending', 
            account: null, 
            productName, 
            quantity: qtyNumber, 
            buyer: buyerUsername || 'អនាមិក' 
        };

        const caption = `🔔 *មានការបញ្ជាទិញថ្មី!*\n\n` +
                        `👤 *អ្នកទិញ:* \`${buyerUsername || 'អនាមិក'}\`\n` +
                        `📱 *លេខទូរស័ព្ទ:* \`${buyerInfo.phone || 'N/A'}\`\n` +
                        `📧 *Email:* \`${buyerInfo.email || 'N/A'}\`\n` +
                        `🆔 *វិក្កយបត្រ:* #${orderId}\n` +
                        `📦 *ប្រភេទ:* ${productName}\n` +
                        `🔢 *ចំនួន:* ${qtyNumber} អាខោន\n` +
                        `💰 *តម្លៃសរុប:* $${totalAmount} USD\n` +
                        `📊 *ស្តុកនៅសល់:* ${accountStock.length} អាខោន\n\n` +
                        `សូមពិនិត្យវិក្កយបត្រខាងក្រោម ដើម្បី Approve៖`;

        if (slipFile) {
            await bot.sendPhoto(ADMIN_CHAT_ID, slipFile.path, {
                caption: caption,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: `✅ Approve (ទម្លាក់ ${qtyNumber} អាខោន)`, callback_data: `approve_${orderId}` },
                            { text: '❌ Reject (ច្រានចោល)', callback_data: `reject_${orderId}` }
                        ]
                    ]
                }
            });
            fs.unlinkSync(slipFile.path);
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

app.get('/api/check-order/:orderId', (req, res) => {
    const order = orders[req.params.orderId];
    if (!order) return res.status(404).json({ status: 'not_found' });
    res.json({ status: order.status, account: order.account });
});

bot.on('callback_query', async (query) => {
    const data = query.data;
    if (data.startsWith('approve_')) {
        const id = data.replace('approve_', '');
        const order = orders[id];
        if (order) {
            const neededQty = order.quantity || 1;
            if (accountStock.length >= neededQty) {
                const deliveredAccounts = accountStock.splice(0, neededQty);
                order.status = 'approved';
                order.account = deliveredAccounts.join('\n');
                await bot.answerCallbackQuery(query.id, { text: `Order #${id} ត្រូវបាន Approve!` });
                await bot.sendMessage(ADMIN_CHAT_ID, `✅ Order #${id} (របស់អ្នកទិញ: ${order.buyer}) បានទម្លាក់ចំនួន *${neededQty}* អាខោនរួចរាល់!\n📦 ស្តុកនៅសល់៖ *${accountStock.length}* អាខោន`, { parse_mode: 'Markdown' });
            } else {
                await bot.answerCallbackQuery(query.id, { text: `មិនគ្រប់ស្តុកទេ!` });
                await bot.sendMessage(ADMIN_CHAT_ID, `⚠️ Order #${id} ត្រូវការ *${neededQty}* អាខោន តែស្តុកនៅសល់ត្រឹម *${accountStock.length}* អាខោនប៉ុណ្ណោះ! សូមផ្ញើ /add បន្ថែម។`, { parse_mode: 'Markdown' });
            }
        }
    } else if (data.startsWith('reject_')) {
        const id = data.replace('reject_', '');
        if (orders[id]) orders[id].status = 'rejected';
        await bot.answerCallbackQuery(query.id, { text: `Order #${id} ត្រូវបានច្រានចោល!` });
        await bot.sendMessage(ADMIN_CHAT_ID, `❌ Order #${id} ត្រូវបានបដិសេធ។`);
    }
});

// --- CHAT SYSTEM APIS ---
app.get('/api/chat/messages/:username', (req, res) => {
    const { username } = req.params;
    res.json({ success: true, messages: chatMessages[username] || [] });
});

app.post('/api/chat/send', chatUpload.single('file'), async (req, res) => {
    try {
        const { username, text, type } = req.body;
        const file = req.file;

        if (!username) return res.status(400).json({ success: false });
        if (!chatMessages[username]) chatMessages[username] = [];

        let mediaUrl = '';
        let telegramSentMsg = null;
        const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        if (file) {
            let ext = path.extname(file.originalname) || '';
            if (type === 'audio' && !ext) ext = '.webm';
            if (type === 'video' && !ext) ext = '.mp4';
            if (type === 'image' && !ext) ext = '.jpg';
            
            const newFilename = file.filename + ext;
            const newPath = path.join(mediaDir, newFilename);
            fs.renameSync(file.path, newPath);

            mediaUrl = `/media/${newFilename}`;

            if (type === 'audio') {
                telegramSentMsg = await bot.sendVoice(ADMIN_CHAT_ID, newPath, {
                    caption: `🎙 *សំឡេងពីភ្ញៀវ:* \`${username}\`\n(ចុច Reply លើសារនេះដើម្បីឆ្លើយតប)`,
                    parse_mode: 'Markdown'
                });
            } else if (type === 'video') {
                telegramSentMsg = await bot.sendVideo(ADMIN_CHAT_ID, newPath, {
                    caption: `🎬 *វីដេអូពីភ្ញៀវ:* \`${username}\`\n(ចុច Reply លើសារនេះដើម្បីឆ្លើយតប)`,
                    parse_mode: 'Markdown'
                });
            } else if (type === 'image') {
                telegramSentMsg = await bot.sendPhoto(ADMIN_CHAT_ID, newPath, {
                    caption: `🖼 *រូបភាពពីភ្ញៀវ:* \`${username}\`\n(ចុច Reply លើសារនេះដើម្បីឆ្លើយតប)`,
                    parse_mode: 'Markdown'
                });
            }
        } else if (text) {
            telegramSentMsg = await bot.sendMessage(ADMIN_CHAT_ID, `💬 *សារពីភ្ញៀវ:* \`${username}\`\n\n"${text}"\n\n*(ចុច Reply លើសារនេះដើម្បីឆ្លើយតប)*`, { parse_mode: 'Markdown' });
        }

        if (telegramSentMsg) {
            userChatMapping[telegramSentMsg.message_id] = username;
        }

        chatMessages[username].push({
            sender: 'user',
            type: type || 'text',
            content: mediaUrl || text,
            time: timeNow
        });

        res.json({ success: true });
    } catch (err) {
        console.error("Chat Send Error:", err);
        res.status(500).json({ success: false });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
