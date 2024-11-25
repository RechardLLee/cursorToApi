import express from 'express';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
app.use(bodyParser.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 添加静态文件服务
app.use(express.static('public'));

// 存储API密钥的文件路径
const KEYS_FILE = path.join(__dirname, 'keys.json');

// 确保keys.json文件存在
if (!fs.existsSync(KEYS_FILE)) {
    fs.writeFileSync(KEYS_FILE, JSON.stringify([]));
}

// 全局变量
let currentKeyIndex = 0;

// 读取API密钥
function readKeys() {
    try {
        const data = fs.readFileSync(KEYS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('读取密钥文件失败:', error);
        return [];
    }
}

// 保存API密钥
function saveKeys(keys) {
    try {
        fs.writeFileSync(KEYS_FILE, JSON.stringify(keys));
    } catch (error) {
        console.error('保存密钥文件失败:', error);
    }
}

// 请求计数器
let totalRequests = 0;

// Helper function to convert string to hex bytes
function stringToHex(str,model_name) {
    const bytes = Buffer.from(str, 'utf-8');
    const byteLength = bytes.length;
    
    // Calculate lengths and fields similar to Python version
    const FIXED_HEADER = 2;
    const SEPARATOR = 1;
    const FIXED_SUFFIX_LENGTH = 0xA3 + model_name.length;

    // 计算文本长度字段 (类似 Python 中的 base_length1)
    let textLengthField1, textLengthFieldSize1;
    if (byteLength < 128) {
        textLengthField1 = byteLength.toString(16).padStart(2, '0');
        textLengthFieldSize1 = 1;
    } else {
        const lowByte1 = (byteLength & 0x7F) | 0x80;
        const highByte1 = (byteLength >> 7) & 0xFF;
        textLengthField1 = lowByte1.toString(16).padStart(2, '0') + highByte1.toString(16).padStart(2, '0');
        textLengthFieldSize1 = 2;
    }

    // 计算基础长度 (类似 Python 中的 base_length)
    const baseLength = byteLength + 0x2A;
    let textLengthField, textLengthFieldSize;
    if (baseLength < 128) {
        textLengthField = baseLength.toString(16).padStart(2, '0');
        textLengthFieldSize = 1;
    } else {
        const lowByte = (baseLength & 0x7F) | 0x80;
        const highByte = (baseLength >> 7) & 0xFF;
        textLengthField = lowByte.toString(16).padStart(2, '0') + highByte.toString(16).padStart(2, '0');
        textLengthFieldSize = 2;
    }

    // 计算总消息长度
    const messageTotalLength = FIXED_HEADER + textLengthFieldSize + SEPARATOR + 
                             textLengthFieldSize1 + byteLength + FIXED_SUFFIX_LENGTH;

    const messageLengthHex = messageTotalLength.toString(16).padStart(10, '0');

    // 构造完整的十六进制字符串
    const hexString = (
        messageLengthHex +
        "12" +
        textLengthField +
        "0A" +
        textLengthField1 +
        bytes.toString('hex') +
        "10016A2432343163636435662D393162612D343131382D393239612D3936626330313631626432612" +
        "2002A132F643A2F6964656150726F2F656475626F73733A1E0A"+
        // 将模型名称长度转换为两位十六进制，并确保是大写
        Buffer.from(model_name, 'utf-8').length.toString(16).padStart(2, '0').toUpperCase() +  
        Buffer.from(model_name, 'utf-8').toString('hex').toUpperCase() +  
        "22004A" +
        "24" + "61383761396133342D323164642D343863372D623434662D616636633365636536663765" +
        "680070007A2436393337376535612D386332642D343835342D623564392D653062623232336163303061" +
        "800101B00100C00100E00100E80100"
    ).toUpperCase();
    return Buffer.from(hexString, 'hex');
}

// API路由
app.get('/api/keys', (req, res) => {
    res.json(readKeys());
});

app.post('/api/keys', (req, res) => {
    const { key } = req.body;
    const keys = readKeys();
    if (!keys.includes(key)) {
        keys.push(key);
        saveKeys(keys);
    }
    res.json({ success: true });
});

app.delete('/api/keys', (req, res) => {
    const { key } = req.body;
    const keys = readKeys();
    const newKeys = keys.filter(k => k !== key);
    saveKeys(newKeys);
    res.json({ success: true });
});

app.get('/api/status', (req, res) => {
    const keys = readKeys();
    res.json({
        status: 'running',
        currentKey: keys[currentKeyIndex] || '-',
        totalRequests
    });
});

// 修改现有的chat completions路由，添加请求计数
app.post('/v1/chat/completions', async (req, res) => {
    totalRequests++;
    try {
        const { model, messages, stream = false } = req.body;
        const keys = readKeys();
        if (keys.length === 0) {
            return res.status(400).json({ error: '未配置API密钥' });
        }

        // 确保 currentKeyIndex 不会越界
        if (currentKeyIndex >= keys.length) {
            currentKeyIndex = 0;
        }
        const authToken = keys[currentKeyIndex];
        currentKeyIndex = (currentKeyIndex + 1) % keys.length;

        if (stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
        }

        const formattedMessages = messages.map(msg => `${msg.role}:${msg.content}`).join('\n');
        const hexData = stringToHex(formattedMessages, model);

        const response = await fetch("https://api2.cursor.sh/aiserver.v1.AiService/StreamChat", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/connect+proto',
                'authorization': `Bearer ${authToken}`,
                'connect-accept-encoding': 'gzip,br',
                'connect-protocol-version': '1',
                'user-agent': 'connect-es/1.4.0',
                'x-amzn-trace-id': `Root=${uuidv4()}`,
                'x-cursor-checksum': 'zo6Qjequ9b9734d1f13c3438ba25ea31ac93d9287248b9d30434934e9fcbfa6b3b22029e/7e4af391f67188693b722eff0090e8e6608bca8fa320ef20a0ccb5d7d62dfdef',
                'x-cursor-client-version': '0.42.3',
                'x-cursor-timezone': 'Asia/Shanghai',
                'x-ghost-mode': 'false',
                'x-request-id': uuidv4(),
                'Host': 'api2.cursor.sh'
            },
            body: hexData
        });
        function extractTextFromChunk(chunk) {
            let i = 0;
            let results = [];
            
            while (i < chunk.length) {
                // Skip initial zero bytes
                while (i < chunk.length && chunk[i] === 0) {
                    i++;
                }
                
                if (i >= chunk.length) {
                    break;
                }
                
                // Skip length byte and newline
                i += 2;
                
                // Read content length
                const contentLength = chunk[i];
                i++;
                
                // Extract actual content if there's enough data
                if (i + contentLength <= chunk.length) {
                    const text = chunk.slice(i, i + contentLength).toString('utf-8');
                    if (text.length > 0) {
                        results.push(text);
                    }
                }
                
                i += contentLength;
            }
            
            return results.join(''); // Join all extracted text pieces
        }
        if (stream) {
            const responseId = `chatcmpl-${uuidv4()}`;
            
           

            // 使用类似 Python 的方式处理流
            for await (const chunk of response.body) {
                // 检查 chunk 是否以 0x00000000 开头
                if (chunk && Buffer.isBuffer(chunk) && 
                    chunk.length >= 4 && 
                    chunk[0] === 0x00 && 
                    chunk[1] === 0x00 && 
                    chunk[2] === 0x00 && 
                    chunk[3] === 0x00) {
                    try {
                        // 跳过前7个字节的头部数据
                        const text = extractTextFromChunk(chunk);
                        if (text.length > 0) {
                            // 发送内容块
                            res.write(`data: ${JSON.stringify({
                                id: responseId,
                                object: 'chat.completion.chunk',
                                created: Math.floor(Date.now() / 1000),
                                model: model,
                                choices: [{
                                    index: 0,
                                    delta: {
                                        content: text
                                    }
                                }]
                            })}\n\n`);
                        }
                    } catch (error) {
                        console.error('Chunk processing error:', error);
                        continue;
                    }
                }
            }

    

            res.write('data: [DONE]\n\n');
            return res.end();
        } else {
            const responseId = `chatcmpl-${uuidv4()}`;
            
            

            // 使用类似 Python 的方式处理流
            let text =""
            for await (const chunk of response.body) {
                // 检查 chunk 是否以 0x00000000 开头
                if (chunk && Buffer.isBuffer(chunk) && 
                    chunk.length >= 4 && 
                    chunk[0] === 0x00 && 
                    chunk[1] === 0x00 && 
                    chunk[2] === 0x00 && 
                    chunk[3] === 0x00) {
                    try {
                        // 跳过前7个字节的头部数据
                        text = text+extractTextFromChunk(chunk);
                        
                    } catch (error) {
                        console.error('Chunk processing error:', error);
                        continue;
                    }
                }
            }

            return res.json({
                id: `chatcmpl-${uuidv4()}`,
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: 'claude-3-sonnet-20241022',
                choices: [{
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: text
                    },
                    finish_reason: 'stop'
                }],
                usage: {
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    total_tokens: 0
                }
            });
        }
    } catch (error) {
        console.error('Error:', error);
        if (!res.headersSent) {
            return res.status(500).json({ error: 'Internal server error' });
        }
    }
});

// 主页路由
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
