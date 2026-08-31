const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { BakongKHQR, khqrData, IndividualInfo } = require('bakong-khqr');
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

// API បង្កើត KHQR ជាប្រាក់ដុល្លារ USD ភ្ជាប់ Amount ស្វ័យប្រវត្តិតាមស្តង់ដារ Bakong
app.post('/api/create-khqr', (req, res) => {
    try {
        const { amount, orderId } = req.body;
        const totalAmountUSD = parseFloat(amount);

        const optionalData = {
            currency: khqrData.currency.usd, // កំណត់ឱ្យចេញលុយដុល្លារ USD
            amount: totalAmountUSD,          // ភ្ជាប់តម្លៃលុយដុល្លារដែលត្រូវបង់
            billNumber: String(orderId),
            storeLabel: "KhmerSMM Store",
            terminalLabel: "OnlineShop"
        };

        // ទម្រង់ស្តង់ដារផ្លូវការរបស់ Bakong Individual KHQR
        const individualInfo = new IndividualInfo(
            "mon_samnang@bkrt",
            khqrData.currency.usd,
            "SAMNANG MON",
            "Phnom Penh",
            optionalData
        );

        const khqr = new BakongKHQR();
        const qrResponse = khqr.generateIndividual(individualInfo);

        if (qrResponse && qrResponse.data && qrResponse.data.qr) {
            return res.json({ 
                success: true, 
                qrString: qrResponse.data.qr,
                amount: totalAmountUSD.toFixed(2)
            });
        } else {
            console.error("Bakong Error:", qrResponse);
            return res.status(400).json({ success: false, message: "មិនអាចបង្កើត QR Code បានទេ" });
        }
    } catch (error) {
        console.error("Catch Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

// API ទទួលវិក្កយបត្រ
app.post('/api/submit-order', upload.single('slip'), async (req, res) => {
    try {
        const { productName, quantity, totalAmount, orderId } = req.body;
        const slipFile = req.file;
        const qtyNumber = parseInt(quantity) || 1;

        orders[orderId] = {
            status: 'pending',
            account: null,
            productName,
            quantity: qtyNumber
        };

        const caption = `🔔 *មានការបញ្ជាទិញថ្មី!*\n\n` +
                        `🆔 *វិក្កយបត្រ:* #${orderId}\n` +
                        `📦 *ប្រភេទ:* ${productName}\n` +
                        `🔢 *ចំនួន:* ${qtyNumber} អាខោន\n` +
                        `💰 *តម្លៃសរុប:* $${totalAmount} USD\n` +
                        `📊 *ស្តុកនៅសល់:* ${accountStock.length} អាខោន\n\n` +
                        `សូមពិនិត្យវិក្កយបត្រខាងក្រោម ដើម្បី Approve ឱ្យអាខោនធ្លាក់លើអេក្រង់ភ្ញៀវ៖`;

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
                await bot.sendMessage(ADMIN_CHAT_ID, `✅ Order #${id} បានទម្លាក់ចំនួន *${neededQty}* អាខោនទៅភ្ញៀវរួចរាល់!\n📦 ស្តុកនៅសល់៖ *${accountStock.length}* អាខោន`, { parse_mode: 'Markdown' });
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
