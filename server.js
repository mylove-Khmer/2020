const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { BakongKHQR, MerchantInfo, IndividualInfo } = require('bakong-khqr');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(cors());
app.use(express.json());

// បង្កើត folder ផ្ទុក Slip បណ្ដោះអាសន្ន
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}
const upload = multer({ dest: 'uploads/' });

// បញ្ជីស្តុកអាខោន និង Order
let accountStock = [];
let orders = {};

// Telegram Bot
const BOT_TOKEN = '8917816041:AAEAxBlMIg6auHX6WrcO_HudfFLTQT7sLXQ';
const ADMIN_CHAT_ID = '5915683588';
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// --- គ្រប់គ្រងស្តុកតាម TELEGRAM BOT ---

// បន្ថែមអាខោនតាមពាក្យបញ្ជា /add
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

// ឆែកមើលចំនួនស្តុកតាមពាក្យបញ្ជា /stock
bot.onText(/\/stock/, async (msg) => {
    if (msg.chat.id.toString() !== ADMIN_CHAT_ID) return;
    await bot.sendMessage(ADMIN_CHAT_ID, `📦 ស្តុកអាខោននៅសល់សរុប៖ *${accountStock.length}* អាខោន`, { parse_mode: 'Markdown' });
});

// --- API SERVER ---

// បង្ហាញទំព័រមុខ index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// API បង្កើត KHQR ជាប្រាក់ដុល្លារ (USD)
app.post('/api/create-khqr', (req, res) => {
    try {
        const { amount, orderId } = req.body;
        const khqr = new BakongKHQR();
        const priceUSD = parseFloat(amount);
        const billNo = "INV" + String(orderId).replace(/\D/g, '').slice(-8);

        // បង្កើត Dynamic QR កំណត់តម្លៃ Amount និង Currency ជា USD
        const merchantInfo = new MerchantInfo(
            "mon_samnang@bkrt",
            "SAMNANG MON",
            "Phnom Penh",
            billNo,
            "KhmerSMM Store",
            {
                currency: "USD",
                amount: priceUSD,
                terminalLabel: "OnlineShop"
            }
        );

        const qrResponse = khqr.generateMerchant(merchantInfo);

        if (qrResponse && qrResponse.data && qrResponse.data.qr) {
            return res.json({ 
                success: true, 
                qrString: qrResponse.data.qr,
                amount: priceUSD
            });
        } else {
            res.status(400).json({ success: false, message: "មិនអាចបង្កើត QR USD បានទេ" });
        }
    } catch (error) {
        console.error("KHQR Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// API ទទួល Slip និងផ្ញើទៅ Telegram
app.post('/api/submit-order', upload.single('slip'), async (req, res) => {
    try {
        const { productName, totalAmount, orderId } = req.body;
        const slipFile = req.file;

        orders[orderId] = {
            status: 'pending',
            account: null,
            productName
        };

        const caption = `🔔 *មានការបញ្ជាទិញថ្មី!*\n\n` +
                        `🆔 *វិក្កយបត្រ:* #${orderId}\n` +
                        `📦 *ប្រភេទ:* ${productName}\n` +
                        `💰 *តម្លៃ:* $${totalAmount} USD\n` +
                        `📊 *ស្តុកនៅសល់:* ${accountStock.length}\n\n` +
                        `សូមពិនិត្យវិក្កយបត្រខាងក្រោម ដើម្បី Approve ឱ្យអាខោនធ្លាក់លើអេក្រង់ភ្ញៀវ៖`;

        if (slipFile) {
            await bot.sendPhoto(ADMIN_CHAT_ID, slipFile.path, {
                caption: caption,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅ Approve (ទម្លាក់អាខោន)', callback_data: `approve_${orderId}` },
                            { text: '❌ Reject (ច្រានចោល)', callback_data: `reject_${orderId}` }
                        ]
                    ]
                }
            });
            fs.unlinkSync(slipFile.path);
        }

        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false });
    }
});

// API ឱ្យ Frontend ឆែកស្ថានភាព Order
app.get('/api/check-order/:orderId', (req, res) => {
    const order = orders[req.params.orderId];
    if (!order) return res.status(404).json({ status: 'not_found' });
    res.json({ status: order.status, account: order.account });
});

// ចាប់សកម្មភាពប៊ូតុងលើ Telegram
bot.on('callback_query', async (query) => {
    const data = query.data;
    if (data.startsWith('approve_')) {
        const id = data.replace('approve_', '');

        if (accountStock.length > 0) {
            const deliveredAccount = accountStock.shift(); // កាត់យក ១ ពីស្តុក
            if (orders[id]) {
                orders[id].status = 'approved';
                orders[id].account = deliveredAccount;
            }
            await bot.answerCallbackQuery(query.id, { text: `Order #${id} ត្រូវបាន Approve!` });
            await bot.sendMessage(ADMIN_CHAT_ID, `✅ Order #${id} បានធ្លាក់អាខោនលើអេក្រង់ភ្ញៀវរួចរាល់!\n📦 ស្តុកនៅសល់៖ ${accountStock.length}`);
        } else {
            await bot.answerCallbackQuery(query.id, { text: `អស់ស្តុកហើយ!` });
            await bot.sendMessage(ADMIN_CHAT_ID, `⚠️ Order #${id} មិនអាច Approve បានទេ ដោយសារអស់ស្តុក! សូមផ្ញើ /add ដើម្បីបញ្ចូលបន្ថែម។`);
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
