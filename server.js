const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Conexão com MongoDB
const MONGODB_URI = process.env.MONGODB_URI;

const connectDB = async () => {
  try {
    if (!MONGODB_URI || MONGODB_URI.includes('sua_string_de_conexao_aqui')) {
      console.log('⚠️  String de conexão não configurada. Usando memória.');
      return;
    }
    
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Conectado ao MongoDB Atlas!');
  } catch (error) {
    console.error('❌ Erro ao conectar MongoDB:', error.message);
    console.log('💡 Continuando com armazenamento em memória...');
  }
};

// Modelo dos dados dos sensores
const sensorSchema = new mongoose.Schema({
  temperatura: { type: Number, required: true },
  umidadeAr: { type: Number, required: true },
  umidadeSolo: { type: Number, required: true },
  ldr: { type: Number, required: true },
  bomba: { type: Boolean, required: true },
  timestamp: { type: Date, default: Date.now }
});

const SensorData = mongoose.model('SensorData', sensorSchema);

// Array de fallback (se MongoDB falhar)
let sensorDataMemory = [];
let nextId = 1;

// Rota de teste
app.get('/', (req, res) => {
  const dbStatus = mongoose.connection.readyState === 1 ? 'MongoDB' : 'Memória';
  res.json({ 
    message: `🚀 API do ESP32 funcionando com ${dbStatus}!`,
    database: dbStatus,
    endpoints: {
      postData: 'POST /api/sensor-data',
      getData: 'GET /api/sensor-data',
      getLatest: 'GET /api/latest-data',
      testData: 'POST /api/test-data'
    }
  });
});

// Rota para receber dados do ESP32
app.post('/api/sensor-data', async (req, res) => {
  try {
    console.log('📥 Dados recebidos:', req.body);
    
    const { temperatura, umidadeAr, umidadeSolo, ldr, bomba } = req.body;
    
    // Validar dados
    if (temperatura === undefined || umidadeAr === undefined || 
        umidadeSolo === undefined || ldr === undefined || bomba === undefined) {
      return res.status(400).json({ 
        success: false, 
        message: 'Dados incompletos. Envie: temperatura, umidadeAr, umidadeSolo, ldr, bomba' 
      });
    }
    
    const sensorData = {
      temperatura: parseFloat(temperatura),
      umidadeAr: parseFloat(umidadeAr),
      umidadeSolo: parseInt(umidadeSolo),
      ldr: parseInt(ldr),
      bomba: Boolean(bomba),
      timestamp: new Date()
    };

    // Tentar salvar no MongoDB, se não conseguir, salva em memória
    if (mongoose.connection.readyState === 1) {
      const savedData = new SensorData(sensorData);
      await savedData.save();
      console.log('💾 Dados salvos no MongoDB!');
      
      res.status(201).json({ 
        success: true, 
        message: 'Dados salvos no MongoDB!',
        data: savedData,
        database: 'mongodb'
      });
    } else {
      // Fallback para memória
      sensorData.id = nextId++;
      sensorDataMemory.push(sensorData);
      console.log('💾 Dados salvos em memória');
      
      res.status(201).json({ 
        success: true, 
        message: 'Dados salvos em memória!',
        data: sensorData,
        database: 'memory'
      });
    }
  } catch (error) {
    console.error('❌ Erro ao salvar dados:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erro interno do servidor'
    });
  }
});

// Rota para obter todos os dados
app.get('/api/sensor-data', async (req, res) => {
  try {
    if (mongoose.connection.readyState === 1) {
      // Buscar do MongoDB
      const data = await SensorData.find().sort({ timestamp: -1 }).limit(50);
      res.json({ 
        success: true, 
        count: data.length,
        data,
        database: 'mongodb'
      });
    } else {
      // Buscar da memória
      res.json({ 
        success: true, 
        count: sensorDataMemory.length,
        data: [...sensorDataMemory].reverse(),
        database: 'memory'
      });
    }
  } catch (error) {
    console.error('❌ Erro ao buscar dados:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erro interno do servidor' 
    });
  }
});

// Rota para obter o último registro
app.get('/api/latest-data', async (req, res) => {
  try {
    if (mongoose.connection.readyState === 1) {
      const data = await SensorData.findOne().sort({ timestamp: -1 });
      res.json({ 
        success: true, 
        data,
        database: 'mongodb'
      });
    } else {
      const lastData = sensorDataMemory[sensorDataMemory.length - 1] || null;
      res.json({ 
        success: true, 
        data: lastData,
        database: 'memory'
      });
    }
  } catch (error) {
    console.error('❌ Erro ao buscar último dado:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erro interno do servidor' 
    });
  }
});

// Rota para dados de teste
app.post('/api/test-data', async (req, res) => {
  try {
    const testData = {
      temperatura: Math.random() * 15 + 20,
      umidadeAr: Math.random() * 50 + 40,
      umidadeSolo: Math.floor(Math.random() * 1023),
      ldr: Math.floor(Math.random() * 4095),
      bomba: Math.random() > 0.5,
      timestamp: new Date()
    };

    if (mongoose.connection.readyState === 1) {
      const savedData = new SensorData(testData);
      await savedData.save();
      res.json({ 
        success: true, 
        message: 'Dado de teste criado no MongoDB!',
        data: savedData,
        database: 'mongodb'
      });
    } else {
      testData.id = nextId++;
      sensorDataMemory.push(testData);
      res.json({ 
        success: true, 
        message: 'Dado de teste criado em memória!',
        data: testData,
        database: 'memory'
      });
    }
  } catch (error) {
    console.error('❌ Erro ao criar dado de teste:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erro interno do servidor' 
    });
  }
});

// Iniciar servidor
const startServer = async () => {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`🎉 Servidor rodando na porta ${PORT}`);
    console.log(`🔗 Acesse: http://localhost:${PORT}`);
  });
};

startServer();