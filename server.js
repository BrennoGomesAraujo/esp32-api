const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cron = require('node-cron');
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
      console.log('⚠️ String de conexão não configurada. Usando memória.');
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

// Variável para controlar último reset
let lastResetDay = null;

// Função para obter data real do Brasil via API
async function getBrazilianDate() {
  try {
    console.log('🌐 Buscando hora real do Brasil...');
    
    // Tentativa 1: WorldTimeAPI
    const response = await fetch('http://worldtimeapi.org/api/timezone/America/Sao_Paulo');
    
    if (response.ok) {
      const data = await response.json();
      const brazilTime = new Date(data.datetime);
      console.log('✅ Hora real obtida:', brazilTime.toLocaleString('pt-BR'));
      return brazilTime;
    }
    
    throw new Error('WorldTimeAPI não respondeu');
    
  } catch (error) {
    console.log('❌ Erro ao buscar hora real:', error.message);
    console.log('🔄 Usando cálculo local como fallback...');
    
    // Fallback: cálculo local com offset Brasil
    const localTime = new Date();
    const utc = localTime.getTime() + (localTime.getTimezoneOffset() * 60000);
    const brasilOffset = -3 * 60 * 60 * 1000; // UTC-3
    const brazilTime = new Date(utc + brasilOffset);
    
    console.log('🔄 Hora fallback (cálculo):', brazilTime.toLocaleString('pt-BR'));
    return brazilTime;
  }
}

// Função para resetar o banco de dados
async function resetDatabase() {
  try {
    console.log('🔄 Iniciando reset automático do banco de dados...');
    let result;
    
    if (mongoose.connection.readyState === 1) {
      // Reset no MongoDB
      result = await SensorData.deleteMany({});
      console.log(`🗑️ Banco de dados MongoDB resetado! ${result.deletedCount} registros removidos.`);
    } else {
      // Reset em memória
      const count = sensorDataMemory.length;
      sensorDataMemory = [];
      nextId = 1;
      result = { deletedCount: count };
      console.log(`🗑️ Dados em memória resetados! ${count} registros removidos.`);
    }

    // Atualizar data do último reset
    const currentTime = await getBrazilianDate();
    lastResetDay = currentTime.getDate();
    
    console.log(`✅ Reset automático concluído em: ${currentTime.toLocaleString('pt-BR')}`);
    return result;
  } catch (error) {
    console.error('❌ Erro no reset automático:', error);
    throw error;
  }
}

// Verificar e executar reset diário automaticamente
async function checkAndResetDaily() {
  try {
    const currentTime = await getBrazilianDate();
    const currentDay = currentTime.getDate();
    const currentHour = currentTime.getHours();
    const currentMinute = currentTime.getMinutes();
    
    console.log('📅 VERIFICAÇÃO DE RESET DIÁRIO:');
    console.log(`   Data/hora real: ${currentTime.toLocaleString('pt-BR')}`);
    console.log(`   Dia atual: ${currentDay}`);
    console.log(`   Último reset dia: ${lastResetDay}`);
    console.log(`   Hora atual: ${currentHour}:${currentMinute}`);
    
    // Primeira execução
    if (lastResetDay === null) {
      console.log('📅 Primeira execução - Definindo dia:', currentDay);
      lastResetDay = currentDay;
      return;
    }
    
    // Verificar se mudou o dia E é meia-noite (00:00 até 00:59)
    if (currentDay !== lastResetDay && currentHour === 0) {
      console.log('🎯 Condição de reset atendida! Executando reset...');
      await resetDatabase();
    } else {
      console.log('⏳ Aguardando próximo reset (00:00 Brasil)...');
    }
  } catch (error) {
    console.error('❌ Erro na verificação de reset:', error);
  }
}

// Sistema de reset com API de tempo real
function setupRealTimeResetSystem() {
  console.log('⏰ ========== INICIANDO SISTEMA DE RESET DIÁRIO ==========');
  console.log('🎯 MODO: Reset ao virar o dia (00:00 Brasil)');
  console.log('🌐 FONTE: Hora real da API WorldTimeAPI');
  
  // Verificação a cada 30 minutos
  cron.schedule('*/30 * * * *', async () => {
    console.log('⏰ Verificação periódica (30min)...');
    await checkAndResetDaily();
  });
  
  // Verificação extra a cada hora
  cron.schedule('0 * * * *', async () => {
    console.log('⏰ Verificação horária...');
    await checkAndResetDaily();
  });
  
  // Verificação extra às 00:05 (para garantir o reset)
  cron.schedule('5 0 * * *', async () => {
    console.log('⏰ Verificação extra às 00:05...');
    await checkAndResetDaily();
  });
  
  console.log('✅ Sistema de reset configurado!');
  console.log('   🔄 Reset: Todo dia às 00:00 (Brasília)');
  console.log('   🔍 Verificações: 30min, 1h, 00:05');
  console.log('   🌐 Fonte hora: WorldTimeAPI + Fallback');
  console.log('⏰ ========== SISTEMA PRONTO ==========');
}

// Rota de teste
app.get('/', (req, res) => {
  const dbStatus = mongoose.connection.readyState === 1 ? 'MongoDB' : 'Memória';
  res.json({
    message: `🚀 API do ESP32 funcionando com ${dbStatus}!`,
    database: dbStatus,
    ultimoReset: lastResetDay !== null ? `Dia ${lastResetDay}` : 'Nunca',
    proximoReset: 'Todo dia às 00:00 (Horário Brasil)',
    timezone: 'America/Sao_Paulo',
    endpoints: {
      postData: 'POST /api/sensor-data',
      getData: 'GET /api/sensor-data',
      getLatest: 'GET /api/latest-data',
      testData: 'POST /api/test-data',
      stats: 'GET /api/stats',
      resetInfo: 'GET /api/reset-info'
    }
  });
});

// Rota para receber dados do ESP32
app.post('/api/sensor-data', async (req, res) => {
  try {
    console.log('📥 Dados recebidos:', req.body);
    const { temperatura, umidadeAr, umidadeSolo, ldr, bomba } = req.body;

    // Validar dados obrigatórios
    if (temperatura === undefined || umidadeAr === undefined || umidadeSolo === undefined || ldr === undefined || bomba === undefined) {
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
      console.log('💾 Dados salvos em memória!');
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
      const data = await SensorData.find().sort({ timestamp: -1 }).limit(100);
      res.json({
        success: true,
        count: data.length,
        data,
        database: 'mongodb',
        ultimoReset: lastResetDay !== null ? `Dia ${lastResetDay}` : 'Nunca'
      });
    } else {
      // Buscar da memória
      res.json({
        success: true,
        count: sensorDataMemory.length,
        data: [...sensorDataMemory].reverse(),
        database: 'memory',
        ultimoReset: lastResetDay !== null ? `Dia ${lastResetDay}` : 'Nunca'
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
        database: 'mongodb',
        ultimoReset: lastResetDay !== null ? `Dia ${lastResetDay}` : 'Nunca'
      });
    } else {
      const lastData = sensorDataMemory[sensorDataMemory.length - 1] || null;
      res.json({
        success: true,
        data: lastData,
        database: 'memory',
        ultimoReset: lastResetDay !== null ? `Dia ${lastResetDay}` : 'Nunca'
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

// Rota para estatísticas
app.get('/api/stats', async (req, res) => {
  try {
    let stats;
    if (mongoose.connection.readyState === 1) {
      const count = await SensorData.countDocuments();
      const firstRecord = await SensorData.findOne().sort({ timestamp: 1 });
      const lastRecord = await SensorData.findOne().sort({ timestamp: -1 });
      stats = {
        totalRecords: count,
        firstRecord: firstRecord ? firstRecord.timestamp : null,
        lastRecord: lastRecord ? lastRecord.timestamp : null,
        database: 'mongodb'
      };
    } else {
      stats = {
        totalRecords: sensorDataMemory.length,
        firstRecord: sensorDataMemory[0] ? sensorDataMemory[0].timestamp : null,
        lastRecord: sensorDataMemory[sensorDataMemory.length - 1] ? sensorDataMemory[sensorDataMemory.length - 1].timestamp : null,
        database: 'memory'
      };
    }
    res.json({
      success: true,
      stats,
      ultimoReset: lastResetDay !== null ? `Dia ${lastResetDay}` : 'Nunca',
      proximoReset: 'Todo dia às 00:00 (Horário Brasil)',
      timezone: 'America/Sao_Paulo'
    });
  } catch (error) {
    console.error('❌ Erro ao buscar estatísticas:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao buscar estatísticas'
    });
  }
});

// Nova rota para informações do reset
app.get('/api/reset-info', async (req, res) => {
  try {
    const currentTime = await getBrazilianDate();
    res.json({
      success: true,
      sistemaReset: {
        ultimoReset: lastResetDay !== null ? `Dia ${lastResetDay}` : 'Nunca',
        proximoReset: '00:00 Horário de Brasília',
        horaAtual: currentTime.toLocaleString('pt-BR'),
        timezone: 'America/Sao_Paulo',
        fonte: 'WorldTimeAPI + Fallback'
      },
      database: mongoose.connection.readyState === 1 ? 'MongoDB' : 'Memória'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Erro ao buscar informações do reset'
    });
  }
});

// Rota para forçar reset (apenas para teste)
app.post('/api/force-reset', async (req, res) => {
  try {
    await resetDatabase();
    res.json({
      success: true,
      message: 'Reset forçado executado com sucesso!'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Erro ao forçar reset'
    });
  }
});

// Iniciar servidor
const startServer = async () => {
  await connectDB();
  
  // Configurar sistema de reset com API de tempo real
  setupRealTimeResetSystem();
  
  // Verificação inicial
  setTimeout(async () => {
    console.log('🚀 Verificação inicial do sistema...');
    await checkAndResetDaily();
  }, 5000);

  app.listen(PORT, () => {
    console.log(`🎉 Servidor rodando na porta ${PORT}`);
    console.log(`🔗 Acesse: http://localhost:${PORT}`);
    console.log(`🔄 Sistema: Reset diário às 00:00 Brasil`);
    console.log(`🌐 Fonte hora: WorldTimeAPI`);
    console.log(`🐛 Debug: /api/reset-info`);
  });
};

startServer();
