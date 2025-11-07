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

// ==================== SISTEMA DE DATA CORRIGIDA ====================

// Variáveis para controle do reset (IGNORAM data do servidor)
let lastResetTimestamp = Date.now();
let lastResetDate = new Date().toDateString();
const umDiaEmMs = 24 * 60 * 60 * 1000; // 24 horas em milissegundos

// DATA REAL: 06 de Novembro de 2025
const DATA_REAL = {
  dia: 6,
  mes: 10, // Novembro é 10 (0-based)
  ano: 2025
};

// Função para obter data CORRIGIDA
function getCorrectedDate() {
  const serverDate = new Date();
  const correctedDate = new Date(serverDate);
  
  // CORREÇÃO: Se o servidor está mostrando data futura, ajustar para data real
  if (serverDate.getDate() > DATA_REAL.dia || 
      serverDate.getMonth() > DATA_REAL.mes || 
      serverDate.getFullYear() > DATA_REAL.ano) {
    
    correctedDate.setDate(DATA_REAL.dia);
    correctedDate.setMonth(DATA_REAL.mes);
    correctedDate.setFullYear(DATA_REAL.ano);
    correctedDate.setHours(serverDate.getHours());
    correctedDate.setMinutes(serverDate.getMinutes());
    correctedDate.setSeconds(serverDate.getSeconds());
    
    console.log('⚠️  CORREÇÃO DE DATA APLICADA:');
    console.log('   Servidor:', serverDate.toLocaleString('pt-BR'));
    console.log('   Corrigida:', correctedDate.toLocaleString('pt-BR'));
  }
  
  return correctedDate;
}

// Função para resetar o banco de dados
async function resetDatabase() {
  try {
    console.log('🔄 ========== INICIANDO RESET ==========');
    
    let result;
    let countBefore = 0;
    
    if (mongoose.connection.readyState === 1) {
      // Reset no MongoDB
      countBefore = await SensorData.countDocuments();
      result = await SensorData.deleteMany({});
      console.log(`🗑️  MongoDB resetado! ${result.deletedCount}/${countBefore} registros removidos.`);
    } else {
      // Reset em memória
      countBefore = sensorDataMemory.length;
      sensorDataMemory = [];
      nextId = 1;
      result = { deletedCount: countBefore };
      console.log(`🗑️  Memória resetada! ${countBefore} registros removidos.`);
    }
    
    // Atualizar controle de tempo (IMPORTANTE: IGNORA data do servidor)
    lastResetTimestamp = Date.now();
    lastResetDate = getCorrectedDate().toDateString();
    
    const proximoReset = new Date(lastResetTimestamp + umDiaEmMs);
    console.log(`✅ Reset concluído!`);
    console.log(`📅 Data real: ${getCorrectedDate().toLocaleString('pt-BR')}`);
    console.log(`⏰ Próximo reset: ${proximoReset.toLocaleString('pt-BR')}`);
    console.log('🔄 ========== RESET CONCLUÍDO ==========');
    
    return {
      deletedCount: result.deletedCount || countBefore,
      countBefore: countBefore,
      nextReset: proximoReset.toISOString(),
      realDate: getCorrectedDate().toLocaleString('pt-BR')
    };
    
  } catch (error) {
    console.error('❌ Erro no reset automático:', error);
    throw error;
  }
}

// Verificação baseada em TIMESTAMP (24 horas exatas)
async function checkAndResetDaily() {
  const agora = Date.now();
  const tempoDesdeReset = agora - lastResetTimestamp;
  const horasDesdeReset = tempoDesdeReset / (1000 * 60 * 60);
  
  console.log('⏰ VERIFICAÇÃO DE RESET POR TIMESTAMP:');
  console.log('   Data real:', getCorrectedDate().toLocaleString('pt-BR'));
  console.log('   Último reset:', new Date(lastResetTimestamp).toLocaleString('pt-BR'));
  console.log('   Horas desde último reset:', horasDesdeReset.toFixed(2) + 'h');
  
  if (tempoDesdeReset >= umDiaEmMs) {
    console.log('🔄 24 horas completas! Executando reset automático...');
    await resetDatabase();
  } else {
    const horasRestantes = (umDiaEmMs - tempoDesdeReset) / (1000 * 60 * 60);
    const minutosRestantes = ((umDiaEmMs - tempoDesdeReset) / (1000 * 60)) % 60;
    
    console.log(`✅ Aguardando: ${Math.floor(horasRestantes)}h ${Math.floor(minutosRestantes)}m para próximo reset`);
    console.log(`📅 Próximo reset: ${new Date(lastResetTimestamp + umDiaEmMs).toLocaleString('pt-BR')}`);
  }
}

// Configurar sistema robusto de reset
function setupResetSystem() {
  console.log('⏰ ========== INICIANDO SISTEMA DE RESET ==========');
  console.log('🎯 MODO: Timestamp (24 horas exatas)');
  console.log('🔧 CONFIG: Ignora data do servidor');
  console.log('📅 DATA REAL: 06/11/2025');
  
  // VERIFICAÇÃO PRINCIPAL - A cada hora
  cron.schedule('0 * * * *', async () => {
    console.log('⏰ [CRON 1h] Verificação de reset...');
    await checkAndResetDaily();
  });
  
  // VERIFICAÇÃO SECUNDÁRIA - A cada 6 horas
  cron.schedule('0 */6 * * *', async () => {
    console.log('⏰ [CRON 6h] Verificação detalhada...');
    await checkAndResetDaily();
  });
  
  console.log('✅ Sistema de reset configurado!');
  console.log('   🔄 Reset: A cada 24 horas (timestamp)');
  console.log('   🔍 Verificações: 1h, 6h');
  console.log('   🛡️  Tolerante: Ignora data do servidor');
  console.log('   📅 Data corrigida: 06/11/2025');
  console.log('⏰ ========== SISTEMA PRONTO ==========');
}

// ==================== NOVAS ROTAS COM DATA CORRIGIDA ====================

// Rota para DATA REAL CORRIGIDA
app.get('/api/real-time', (req, res) => {
  const serverDate = new Date();
  const correctedDate = getCorrectedDate();
  
  res.json({
    serverTime: {
      original: serverDate.toLocaleString('pt-BR'),
      iso: serverDate.toISOString(),
      problem: 'Servidor está +1 dia adiantado'
    },
    correctedTime: {
      real: correctedDate.toLocaleString('pt-BR'),
      iso: correctedDate.toISOString(),
      dateString: correctedDate.toDateString(),
      note: 'Data corrigida para 06/11/2025'
    },
    correctionInfo: {
      realDate: '06/11/2025',
      serverDate: serverDate.toLocaleDateString('pt-BR'),
      difference: '+1 dia (servidor adiantado)',
      action: 'Sistema aplica correção automática'
    }
  });
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
      countBefore: result.countBefore,
      nextReset: result.nextReset,
      realDate: result.realDate,
      lastResetTimestamp: lastResetTimestamp,
      lastResetHuman: new Date(lastResetTimestamp).toLocaleString('pt-BR'),
      system: 'Reset por timestamp (24 horas)',
      dateSystem: 'Data corrigida para 06/11/2025'
    });
    
  } catch (error) {
    console.error('❌ Erro no reset manual:', error);
    res.status(500).json({
      success: false,
      message: 'Erro no reset manual: ' + error.message
    });
  }
});

// Rota para DEBUG - Informações do sistema
app.get('/api/debug', (req, res) => {
  const agora = Date.now();
  const horasDesdeReset = (agora - lastResetTimestamp) / (1000 * 60 * 60);
  const horasRestantes = (umDiaEmMs - (agora - lastResetTimestamp)) / (1000 * 60 * 60);
  const correctedDate = getCorrectedDate();
  
  res.json({
    dateSystem: {
      type: 'CORRECTED_DATE',
      description: 'Data corrigida manualmente para 06/11/2025',
      realDate: {
        corrected: correctedDate.toLocaleString('pt-BR'),
        dateString: correctedDate.toDateString(),
        iso: correctedDate.toISOString()
      },
      serverDate: {
        original: new Date().toLocaleString('pt-BR'),
        problem: '+1 dia adiantado',
        iso: new Date().toISOString()
      }
    },
    resetSystem: {
      type: 'TIMESTAMP_24H',
      description: 'Reset a cada 24 horas (ignora data servidor)',
      lastReset: {
        timestamp: lastResetTimestamp,
        human: new Date(lastResetTimestamp).toLocaleString('pt-BR'),
        dateString: lastResetDate
      },
      nextReset: {
        timestamp: lastResetTimestamp + umDiaEmMs,
        human: new Date(lastResetTimestamp + umDiaEmMs).toLocaleString('pt-BR'),
        hoursRemaining: horasRestantes.toFixed(2)
      },
      progress: {
        hoursSinceReset: horasDesdeReset.toFixed(2),
        percentComplete: ((horasDesdeReset / 24) * 100).toFixed(1)
      }
    },
    database: {
      type: mongoose.connection.readyState === 1 ? 'MongoDB' : 'Memory',
      connected: mongoose.connection.readyState === 1
    }
  });
});

// Rota de teste
app.get('/', (req, res) => {
  const dbStatus = mongoose.connection.readyState === 1 ? 'MongoDB' : 'Memória';
  const horasDesdeReset = (Date.now() - lastResetTimestamp) / (1000 * 60 * 60);
  const proximoReset = new Date(lastResetTimestamp + umDiaEmMs);
  const correctedDate = getCorrectedDate();
  
  res.json({ 
    message: `🚀 API do ESP32 funcionando com ${dbStatus}!`,
    database: dbStatus,
    realTime: {
      date: correctedDate.toLocaleString('pt-BR'),
      note: 'Data corrigida - Servidor está +1 dia'
    },
    resetSystem: {
      type: 'Timestamp (24 horas)',
      lastReset: new Date(lastResetTimestamp).toLocaleString('pt-BR'),
      hoursSinceReset: horasDesdeReset.toFixed(2),
      nextReset: proximoReset.toLocaleString('pt-BR'),
      note: 'Sistema ignora data do servidor'
    },
    endpoints: {
      postData: 'POST /api/sensor-data',
      getData: 'GET /api/sensor-data',
      getLatest: 'GET /api/latest-data',
      testData: 'POST /api/test-data',
      stats: 'GET /api/stats',
      forceReset: 'POST /api/force-reset',
      debug: 'GET /api/debug',
      realTime: 'GET /api/real-time',
      resetStatus: 'GET /api/reset-status'
    }
  });
});

// ==================== ROTAS EXISTENTES (ATUALIZADAS) ====================

// Rota para receber dados do ESP32
app.post('/api/sensor-data', async (req, res) => {
  try {
    console.log('📥 Dados recebidos:', req.body);
    
    const { temperatura, umidadeAr, umidadeSolo, ldr, bomba } = req.body;
    
    // Validar dados obrigatórios
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
      timestamp: getCorrectedDate() // Usa data corrigida
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
        database: 'mongodb',
        realDate: getCorrectedDate().toLocaleString('pt-BR')
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
        database: 'memory',
        realDate: getCorrectedDate().toLocaleString('pt-BR')
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
      const data = await SensorData.find().sort({ timestamp: -1 }).limit(100);
      res.json({ 
        success: true, 
        count: data.length,
        data,
        database: 'mongodb',
        lastReset: new Date(lastResetTimestamp).toLocaleString('pt-BR'),
        realDate: getCorrectedDate().toLocaleString('pt-BR')
      });
    } else {
      res.json({ 
        success: true, 
        count: sensorDataMemory.length,
        data: [...sensorDataMemory].reverse(),
        database: 'memory',
        lastReset: new Date(lastResetTimestamp).toLocaleString('pt-BR'),
        realDate: getCorrectedDate().toLocaleString('pt-BR')
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
        lastReset: new Date(lastResetTimestamp).toLocaleString('pt-BR'),
        realDate: getCorrectedDate().toLocaleString('pt-BR')
      });
    } else {
      const lastData = sensorDataMemory[sensorDataMemory.length - 1] || null;
      res.json({ 
        success: true, 
        data: lastData,
        database: 'memory',
        lastReset: new Date(lastResetTimestamp).toLocaleString('pt-BR'),
        realDate: getCorrectedDate().toLocaleString('pt-BR')
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
      timestamp: getCorrectedDate() // Usa data corrigida
    };

    if (mongoose.connection.readyState === 1) {
      const savedData = new SensorData(testData);
      await savedData.save();
      res.json({ 
        success: true, 
        message: 'Dado de teste criado no MongoDB!',
        data: savedData,
        database: 'mongodb',
        realDate: getCorrectedDate().toLocaleString('pt-BR')
      });
    } else {
      testData.id = nextId++;
      sensorDataMemory.push(testData);
      res.json({ 
        success: true, 
        message: 'Dado de teste criado em memória!',
        data: testData,
        database: 'memory',
        realDate: getCorrectedDate().toLocaleString('pt-BR')
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
      resetInfo: {
        lastReset: new Date(lastResetTimestamp).toLocaleString('pt-BR'),
        hoursSinceReset: ((Date.now() - lastResetTimestamp) / (1000 * 60 * 60)).toFixed(2),
        nextReset: new Date(lastResetTimestamp + umDiaEmMs).toLocaleString('pt-BR'),
        system: 'Timestamp (24 horas)'
      },
      realTime: {
        date: getCorrectedDate().toLocaleString('pt-BR'),
        note: 'Data corrigida para 06/11/2025'
      }
    });
    
  } catch (error) {
    console.error('❌ Erro ao buscar estatísticas:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao buscar estatísticas'
    });
  }
});

// Rota para verificar status do reset
app.get('/api/reset-status', (req, res) => {
  const horasDesdeReset = (Date.now() - lastResetTimestamp) / (1000 * 60 * 60);
  const horasRestantes = (umDiaEmMs - (Date.now() - lastResetTimestamp)) / (1000 * 60 * 60);
  
  res.json({
    success: true,
    system: 'Reset por timestamp (24 horas)',
    lastReset: new Date(lastResetTimestamp).toLocaleString('pt-BR'),
    hoursSinceReset: horasDesdeReset.toFixed(2),
    hoursUntilNextReset: horasRestantes.toFixed(2),
    nextReset: new Date(lastResetTimestamp + umDiaEmMs).toLocaleString('pt-BR'),
    realTime: {
      date: getCorrectedDate().toLocaleString('pt-BR'),
      note: 'Data corrigida para 06/11/2025'
    },
    note: 'Sistema ignora data do servidor - Reset a cada 24 horas exatas'
  });
});

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
    const correctedDate = getCorrectedDate();
    console.log(`🎉 Servidor rodando na porta ${PORT}`);
    console.log(`🔗 Acesse: http://localhost:${PORT}`);
    console.log(`🔄 Sistema: Reset por timestamp (24 horas)`);
    console.log(`🛡️  Tolerante: Ignora data do servidor`);
    console.log(`📅 Data real: ${correctedDate.toLocaleString('pt-BR')}`);
    console.log(`⚠️  Servidor: +1 dia adiantado (corrigido automaticamente)`);
    console.log(`🐛 Debug: /api/debug`);
    console.log(`🔄 Reset manual: POST /api/force-reset`);
    console.log(`🕐 Data real: GET /api/real-time`);
  });
};

startServer();
