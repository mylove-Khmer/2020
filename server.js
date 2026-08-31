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
const upload = multer({ dest: 'uploads/' });

let accountStock = [];
let orders = {};
let users = {};

const BOT_TOKEN = '8917816041:AAEAxBlMIg6auHX6WrcO_HudfFLTQT7sLXQ';
const ADMIN_CHAT_ID = '5915683588';

// បើក Bot ជាមួយ Error Handler ការពារកុំឱ្យគាំង Server
const bot = new TelegramBot(BOT_TOKEN, { 
    polling: {
        autoStart: true,
        params: { timeout: 10 }
    } 
});

// ចាប់កំហុស Polling (Error 409) ការពារកុំឱ្យគាំង API
bot.on('polling_error', (error) => {
    // បង្ហាញត្រឹម log ធម្មតា មិនឱ្យប៉ះពាល់ដល់ Express Server ឡើយ
    console.log('[Bot Polling Notice]:', error.message);
});

// --- គ្រប់គ្រងស្តុកតាម TELEGRAM ---
bot.onText(/\/add([\s\S]*)/, async (msg, match) => {
    if (msg.chat.id.toString() !== ADMIN_CHAT_ID) return;

    const inputData = match[1].trim();
    if (!inputData) {
        return bot.sendMessage(ADMIN_CHAT_ID, "⚠️ សូមបញ្ចូលទិន្នន័យអាខោនតាមទម្រង់៖\n`/add UID|Pass|2FA|Mail|Pass`", { parse_mode: 'Markdown' });
    }

    const newAccounts = inputData.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    accountStock.push(...newAccounts);

    await bot.sendMessage(
        ADMIN_CHAT_ID,
        `✅ បានបញ្ចូលចំនួន *${newAccounts.length}* អាខោនជោគជ័យ!\n📦 ស្តុកសរុបបច្ចុប្បន្ន៖ *${accountStock.length}* អាខោន`,
        { parse_mode: 'Markdown' }
    );
});

bot.onText(/\/stock/, async (msg) => {
    if (msg.chat.id.toString() !== ADMIN_CHAT_ID) return;
    await bot.sendMessage(ADMIN_CHAT_ID, `📦 ស្តុកអាខោននៅសល់សរុប៖ *${accountStock.length}* អាខោន`, { parse_mode: 'Markdown' });
});

// --- API SERVER ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// API ចុះឈ្មោះ (Register)
app.post('/api/register', (req, res) => {
    try {
        const { username, password, phone } = req.body;
        if (!username || !password) {
            return res.status(400).json({ success: false, message: "សូមបំពេញព័ត៌មានឱ្យបានគ្រប់គ្រាន់!" });
        }
        if (users[username]) {
            return res.status(400).json({ success: false, message: "ឈ្មោះគណនីនេះមានរួចហើយ!" });
        }
        users[username] = { password, phone: phone || '' };
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
            return res.json({ 
                success: true, 
                qrString: qrResponse.data.qr,
                amount: parseFloat(amount).toFixed(2)
            });
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

        orders[orderId] = {
            status: 'pending',
            account: null,
            productName,
            quantity: qtyNumber,
            buyer: buyerUsername || 'អនាមិក'
        };

        const caption = `🔔 *មានការបញ្ជាទិញថ្មី!*\n\n` +
                        `👤 *អ្នកទិញ:* ${buyerUsername || 'អនាមិក'}\n` +
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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
