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

// ==================== SISTEMA DE HORA REAL + RESET DIÁRIO ====================

// Variável para controlar último reset (usa data real)
let lastResetDay = null;

// Função para pegar hora REAL do Brasil
async function getRealBrasiliaTime() {
  try {
    console.log('🌐 Buscando hora real do Brasil...');
    
    // API WorldTimeAPI - gratuita e confiável
    const response = await fetch('https://worldtimeapi.org/api/timezone/America/Sao_Paulo');
    
    if (!response.ok) throw new Error('API não respondeu');
    
    const data = await response.json();
    const realTime = new Date(data.datetime);
    
    console.log('✅ Hora real do Brasil:', realTime.toLocaleString('pt-BR'));
    console.log('📡 Fonte: WorldTimeAPI');
    
    return realTime;
    
  } catch (error) {
    console.log('❌ Erro ao buscar hora real:', error.message);
    console.log('🔄 Usando cálculo local como fallback...');
    return getBrasiliaTimeFallback();
  }
}

// Fallback: cálculo do fuso horário Brasil
function getBrasiliaTimeFallback() {
  const now = new Date();
  // Brasília é UTC-3
  const offset = -3;
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const brasiliaTime = new Date(utc + (3600000 * offset));
  
  console.log('🔄 Hora fallback (cálculo):', brasiliaTime.toLocaleString('pt-BR'));
  return brasiliaTime;
}

// Função principal - SEMPRE usa hora real
async function getCorrectedDate() {
  return await getRealBrasiliaTime();
}

// Função para resetar o banco de dados
async function resetDatabase() {
  try {
    console.log('🔄 ========== INICIANDO RESET DIÁRIO ==========');
    
    let result;
    let countBefore = 0;
    
    if (mongoose.connection.readyState === 1) {
      // Reset no MongoDB
      countBefore = await SensorData.countDocuments();
      result = await SensorData.deleteMany({});
      console.log(`🗑️  MongoDB resetado! ${result.deletedCount} registros removidos.`);
    } else {
      // Reset em memória
      countBefore = sensorDataMemory.length;
      sensorDataMemory = [];
      nextId = 1;
      result = { deletedCount: countBefore };
      console.log(`🗑️  Memória resetada! ${countBefore} registros removidos.`);
    }
    
    // Atualizar dia do último reset
    const now = await getCorrectedDate();
    lastResetDay = now.getDate();
    
    console.log(`✅ Reset concluído às ${now.toLocaleString('pt-BR')}`);
    console.log(`📅 Próximo reset: quando virar o dia (00:00 Brasil)`);
    console.log('🔄 ========== RESET CONCLUÍDO ==========');
    
    return {
      deletedCount: result.deletedCount || countBefore,
      realTime: now.toLocaleString('pt-BR'),
      nextReset: '00:00 Horário de Brasília'
    };
    
  } catch (error) {
    console.error('❌ Erro no reset automático:', error);
    throw error;
  }
}

// Verificação de reset DIÁRIO (quando muda o dia)
async function checkAndResetDaily() {
  try {
    const now = await getCorrectedDate();
    const currentDay = now.getDate();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    
    console.log('📅 VERIFICAÇÃO DE RESET DIÁRIO:');
    console.log('   Data/hora real:', now.toLocaleString('pt-BR'));
    console.log('   Dia atual:', currentDay);
    console.log('   Último reset dia:', lastResetDay);
    console.log('   Hora atual:', currentHour + ':' + currentMinute);
    
    // Se é a primeira execução, inicializar
    if (lastResetDay === null) {
      lastResetDay = currentDay;
      console.log('📅 Primeira execução - Definindo dia:', lastResetDay);
      return;
    }
    
    // Verificar se mudou o dia E é depois da meia-noite
    if (currentDay !== lastResetDay && currentHour >= 0) {
      console.log('🔄 NOVO DIA DETECTADO! Executando reset automático...');
      await resetDatabase();
    } else {
      console.log('✅ Mesmo dia - Aguardando meia-noite para reset');
    }
    
  } catch (error) {
    console.error('❌ Erro na verificação diária:', error);
  }
}

// Configurar sistema de reset DIÁRIO
function setupResetSystem() {
  console.log('⏰ ========== INICIANDO SISTEMA DE RESET DIÁRIO ==========');
  console.log('🎯 MODO: Reset ao virar o dia (00:00 Brasil)');
  console.log('🌐 FONTE: Hora real da API WorldTimeAPI');
  
  // VERIFICAÇÃO PRINCIPAL - A cada 30 minutos
  cron.schedule('*/30 * * * *', async () => {
    console.log('⏰ [CRON 30min] Verificando se mudou o dia...');
    await checkAndResetDaily();
  });
  
  // VERIFICAÇÃO EXTRA - A cada hora
  cron.schedule('0 * * * *', async () => {
    console.log('⏰ [CRON 1h] Verificação horária...');
    await checkAndResetDaily();
  });
  
  // VERIFICAÇÃO PRECISA - Às 00:05 (para garantir reset)
  cron.schedule('5 0 * * *', async () => {
    console.log('⏰ [CRON 00:05] Verificação pós-meia-noite...');
    await checkAndResetDaily();
  });
  
  console.log('✅ Sistema de reset configurado!');
  console.log('   🔄 Reset: Todo dia às 00:00 (Brasília)');
  console.log('   🔍 Verificações: 30min, 1h, 00:05');
  console.log('   🌐 Fonte hora: WorldTimeAPI + Fallback');
  console.log('⏰ ========== SISTEMA PRONTO ==========');
}

// ==================== ROTAS ATUALIZADAS ====================

// Rota para HORA REAL
app.get('/api/real-time', async (req, res) => {
  try {
    const realTime = await getCorrectedDate();
    const serverTime = new Date();
    
    res.json({
      success: true,
      realTime: {
        brasilia: realTime.toLocaleString('pt-BR'),
        iso: realTime.toISOString(),
        timezone: 'America/Sao_Paulo',
        source: 'WorldTimeAPI'
      },
      serverTime: {
        original: serverTime.toLocaleString('pt-BR'),
        iso: serverTime.toISOString(), 
        timezone: 'UTC (Render.com)'
      },
      resetInfo: {
        lastResetDay: lastResetDay,
        nextReset: '00:00 Horário de Brasília',
        system: 'Reset diário ao virar o dia'
      }
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao obter hora real'
    });
  }
});

// Rota para FORÇAR RESET MANUAL
app.post('/api/force-reset', async (req, res) => {
  try {
    console.log('🔄 ========== RESET MANUAL SOLICITADO ==========');
    
    const result = await resetDatabase();
    
    res.json({
      success: true,
      message: 'Reset manual executado com sucesso!',
      deletedCount: result.deletedCount,
      realTime: result.realTime,
      nextReset: result.nextReset,
      system: 'Reset diário baseado em hora real do Brasil'
    });
    
  } catch (error) {
    console.error('❌ Erro no reset manual:', error);
    res.status(500).json({
      success: false,
      message: 'Erro no reset manual: ' + error.message
    });
  }
});

// Rota para DEBUG
app.get('/api/debug', async (req, res) => {
  try {
    const realTime = await getCorrectedDate();
    const currentDay = realTime.getDate();
    
    res.json({
      timeSystem: {
        type: 'REAL_TIME_API',
        description: 'Hora real do Brasil via API externa',
        realTime: realTime.toLocaleString('pt-BR'),
        currentDay: currentDay,
        source: 'WorldTimeAPI'
      },
      resetSystem: {
        type: 'DAILY_RESET',
        description: 'Reset automático ao virar o dia (00:00 Brasil)',
        lastResetDay: lastResetDay,
        shouldReset: currentDay !== lastResetDay,
        nextReset: '00:00 Horário de Brasília'
      },
      database: {
        type: mongoose.connection.readyState === 1 ? 'MongoDB' : 'Memory',
        connected: mongoose.connection.readyState === 1
      }
    });
    
  } catch (error) {
    res.status(500).json({ error: 'Erro no debug' });
  }
});

// Rota de teste
app.get('/', async (req, res) => {
  const dbStatus = mongoose.connection.readyState === 1 ? 'MongoDB' : 'Memória';
  const realTime = await getCorrectedDate();
  
  res.json({ 
    message: `🚀 API do ESP32 funcionando com ${dbStatus}!`,
    database: dbStatus,
    realTime: {
      current: realTime.toLocaleString('pt-BR'),
      timezone: 'America/Sao_Paulo (Brasil)',
      source: 'WorldTimeAPI'
    },
    resetSystem: {
      type: 'Diário às 00:00',
      lastResetDay: lastResetDay,
      nextReset: '00:00 Horário de Brasília'
    },
    endpoints: {
      realTime: 'GET /api/real-time',
      postData: 'POST /api/sensor-data', 
      getData: 'GET /api/sensor-data',
      forceReset: 'POST /api/force-reset',
      debug: 'GET /api/debug'
    }
  });
});

// Rota para receber dados do ESP32 (ATUALIZADA)
app.post('/api/sensor-data', async (req, res) => {
  try {
    console.log('📥 Dados recebidos:', req.body);
    
    const { temperatura, umidadeAr, umidadeSolo, ldr, bomba } = req.body;
    
    if (temperatura === undefined || umidadeAr === undefined || 
        umidadeSolo === undefined || ldr === undefined || bomba === undefined) {
      return res.status(400).json({ 
        success: false, 
        message: 'Dados incompletos' 
      });
    }
    
    const realTime = await getCorrectedDate();
    const sensorData = {
      temperatura: parseFloat(temperatura),
      umidadeAr: parseFloat(umidadeAr),
      umidadeSolo: parseInt(umidadeSolo),
      ldr: parseInt(ldr),
      bomba: Boolean(bomba),
      timestamp: realTime // USA HORA REAL
    };

    if (mongoose.connection.readyState === 1) {
      const savedData = new SensorData(sensorData);
      await savedData.save();
      
      res.status(201).json({ 
        success: true, 
        message: 'Dados salvos no MongoDB!',
        data: savedData,
        database: 'mongodb',
        realTime: realTime.toLocaleString('pt-BR')
      });
    } else {
      sensorData.id = nextId++;
      sensorDataMemory.push(sensorData);
      
      res.status(201).json({ 
        success: true, 
        message: 'Dados salvos em memória!',
        data: sensorData,
        database: 'memory', 
        realTime: realTime.toLocaleString('pt-BR')
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

// Outras rotas (sensor-data, latest-data, stats) atualizadas similarmente...

// Iniciar servidor
const startServer = async () => {
  await connectDB();
  
  // Configurar sistema de reset
  setupResetSystem();
  
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
    console.log(`🐛 Debug: /api/debug`);
    console.log(`🕐 Hora real: /api/real-time`);
  });
};

startServer();
