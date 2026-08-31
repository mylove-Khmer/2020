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

// រៀបចំ Folder សម្រាប់ផ្ទុក Slip បណ្ដោះអាសន្ន
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}
const upload = multer({ dest: 'uploads/' });

// កំណត់ Telegram Bot របស់អ្នក
const BOT_TOKEN = '8917816041:AAEAxBlMIg6auHX6WrcO_HudfFLTQT7sLXQ';
const ADMIN_CHAT_ID = '5915683588';
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ១. API បង្កើត KHQR តាមតម្លៃទំនិញ
app.post('/api/create-khqr', (req, res) => {
    try {
        const { amount, orderId } = req.body;

        const optionalData = {
            currency: "USD",
            amount: parseFloat(amount),
            billNumber: `INV-${orderId}`,
            storeLabel: "KhmerSMM Store",
            terminalLabel: "OnlineShop"
        };

        const individualInfo = new IndividualInfo(
            "mon_samnang@bkrt",
            "SAMNANG MON",
            "Phnom Penh",
            optionalData
        );

        const khqr = new BakongKHQR();
        const qrResponse = khqr.generateIndividual(individualInfo);

        res.json({ success: true, qrString: qrResponse.data.qr });
    } catch (error) {
        console.error("KHQR Error:", error);
        res.status(500).json({ success: false, message: "មិនអាចបង្កើត KHQR បានទេ" });
    }
});

// ២. API ទទួល Order និង Slip ផ្ញើទៅ Telegram
app.post('/api/submit-order', upload.single('slip'), async (req, res) => {
    try {
        const { productName, quantity, totalAmount, contact, orderId } = req.body;
        const slipFile = req.file;

        const caption = `🔔 *មានការបញ្ជាទិញថ្មី!*\n\n` +
                        `🆔 *លេខវិក្កយបត្រ:* #INV-${orderId}\n` +
                        `📦 *ប្រភេទអាខោន:* ${productName}\n` +
                        `🔢 *ចំនួន:* ${quantity}\n` +
                        `💰 *តម្លៃសរុប:* $${totalAmount}\n` +
                        `👤 *Telegram/Contact:* ${contact}\n\n` +
                        `សូមពិនិត្យផ្ទៀងផ្ទាត់វិក្កយបត្រខាងក្រោម៖`;

        if (slipFile) {
            await bot.sendPhoto(ADMIN_CHAT_ID, slipFile.path, {
                caption: caption,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅ Approve (បញ្ជាក់)', callback_data: `approve_${orderId}` },
                            { text: '❌ Reject (បដិសេធ)', callback_data: `reject_${orderId}` }
                        ]
                    ]
                }
            });

            // លុបរូបភាពចោលវិញក្រោយពេល Bot បញ្ជូនរួច
            fs.unlinkSync(slipFile.path);
        }

        res.json({ success: true, message: "ការបញ្ជាទិញត្រូវបានបញ្ជូនជោគជ័យ! សូមរង់ចាំការពិនិត្យ។" });
    } catch (error) {
        console.error("Order Error:", error);
        res.status(500).json({ success: false, message: "មានបញ្ហាក្នុងការបញ្ជូនទិន្នន័យ" });
    }
});

// ៣. Callback ចាប់សកម្មភាពប៊ូតុង Approve / Reject លើ Telegram
bot.on('callback_query', async (query) => {
    const data = query.data;
    if (data.startsWith('approve_')) {
        const id = data.split('_')[1];
        await bot.answerCallbackQuery(query.id, { text: `Order #INV-${id} ត្រូវបាន Approve!` });
        await bot.sendMessage(ADMIN_CHAT_ID, `✅ Order #INV-${id} បានអនុម័តជោគជ័យ។`);
    } else if (data.startsWith('reject_')) {
        const id = data.split('_')[1];
        await bot.answerCallbackQuery(query.id, { text: `Order #INV-${id} ត្រូវបានបដិសេធ!` });
        await bot.sendMessage(ADMIN_CHAT_ID, `❌ Order #INV-${id} ត្រូវបានច្រានចោល។`);
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend server is running on port ${PORT}`));
