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

const BOT_TOKEN = '8917816041:AAEAxBlMIg6auHX6WrcO_HudfFLTQT7sLXQ';
const ADMIN_CHAT_ID = '5915683588';
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

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

// គណនា CRC16 CCITT សម្រាប់ Tag 63 របស់ស្តង់ដារ EMVCo KHQR
function calculateCRC16(str) {
    let crc = 0xFFFF;
    for (let i = 0; i < str.length; i++) {
        let c = str.charCodeAt(i);
        crc ^= c << 8;
        for (let j = 0; j < 8; j++) {
            if ((crc & 0x8000) !== 0) {
                crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
            } else {
                crc = (crc << 1) & 0xFFFF;
            }
        }
    }
    let hex = (crc & 0xFFFF).toString(16).toUpperCase();
    return hex.padStart(4, '0');
}

// API បង្កើត KHQR ភ្ជាប់តម្លៃ Amount (USD)
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
            let rawQR = qrResponse.data.qr;
            
            // កាត់ CRC ចាស់ចោល (Tag 6304XXXX នៅ ៨ តួចុងក្រោយ)
            const crcIndex = rawQR.indexOf('6304');
            let baseQR = crcIndex !== -1 ? rawQR.substring(0, crcIndex) : rawQR;

            // កំណត់ទម្រង់តម្លៃជាទសភាគ ២ ខ្ទង់
            const amountStr = parseFloat(amount).toFixed(2);
            const amountTag = "54" + String(amountStr.length).padStart(2, '0') + amountStr;
            const currencyTag = "5303840"; // 840 ជារូបិយប័ណ្ណ USD

            // បង្កប់ Tag 53 និង Tag 54 ចូលក្នុង KHQR Payload
            let payloadWithoutCRC = baseQR + currencyTag + amountTag + "6304";
            let newCRC = calculateCRC16(payloadWithoutCRC);
            let finalQR = payloadWithoutCRC + newCRC;

            return res.json({ 
                success: true, 
                qrString: finalQR,
                amount: amountStr
            });
        } else {
            return res.status(400).json({ success: false, message: "មិនអាចបង្កើត QR Code បានទេ" });
        }
    } catch (error) {
        console.error("KHQR Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

// API ទទួល Slip និង Order
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

app.get('/api/check-order/:orderId', (req, res) => {
    const order = orders[req.params.orderId];
    if (!order) return res.status(404).json({ status: 'not_found' });
    res.json({ status: order.status, account: order.account });
});

bot.on('callback_query', async (query) => {
    const data = query.data;
    if (data.startsWith('approve_')) {
        const id = data.replace('approve_', '');

        if (accountStock.length > 0) {
            const deliveredAccount = accountStock.shift();
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
