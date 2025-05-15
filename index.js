const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const admin = require('firebase-admin');
const storage = require('node-persist');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Inicializar armazenamento local
storage.init({
  dir: 'storage',
  stringify: JSON.stringify,
  parse: JSON.parse,
});

const serviceAccount = require('cuzaodamimhanamorada-7a5463ddca86.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://cuzaodamimhanamorada-default-rtdb.firebaseio.com"
});

const db = admin.database();
const app = express();
app.use(express.json());
app.use(express.static('public'));

// Middleware de autenticação
const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Token não fornecido' });
    }
    const decoded = jwt.verify(token, 'seu_secret_key');
    req.userId = decoded.userId;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Token inválido' });
  }
};

// Rota de registro
app.post('/api/usuarios/registro', async (req, res) => {
  try {
    const { email, senha, nome } = req.body;
    
    // Verificar se usuário já existe
    const userRef = db.ref('usuarios').orderByChild('email').equalTo(email);
    const snapshot = await userRef.once('value');
    if (snapshot.exists()) {
      return res.status(400).json({ error: 'Email já cadastrado' });
    }

    // Criar novo usuário
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(senha, salt);
    
    const newUserRef = db.ref('usuarios').push();
    await newUserRef.set({
      id: newUserRef.key,
      email,
      senha: hash,
      nome,
      favoritos: {},
      vip: false,
      vipExpiration: null,
      beneficios: []
    });

    const token = jwt.sign({ userId: newUserRef.key }, 'seu_secret_key', { expiresIn: '24h' });
    
    res.json({ token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Rota de login
app.post('/api/usuarios/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    
    const userRef = db.ref('usuarios').orderByChild('email').equalTo(email);
    const snapshot = await userRef.once('value');
    
    if (!snapshot.exists()) {
      return res.status(400).json({ error: 'Usuário não encontrado' });
    }

    const userData = Object.values(snapshot.val())[0];
    const validPassword = await bcrypt.compare(senha, userData.senha);
    
    if (!validPassword) {
      return res.status(400).json({ error: 'Senha incorreta' });
    }

    const token = jwt.sign({ userId: userData.id }, 'seu_secret_key', { expiresIn: '24h' });
    
    res.json({ token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Rota para perfil do usuário
app.get('/api/usuarios/perfil', authMiddleware, async (req, res) => {
  try {
    const snapshot = await db.ref(`usuarios/${req.userId}`).once('value');
    const userData = snapshot.val();
    delete userData.senha;
    res.json(userData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para avaliar um dorama
app.post('/api/doramas/:id/avaliar', authMiddleware, async (req, res) => {
  try {
    const { nota, comentario } = req.body;
    const dramaId = req.params.id;
    
    if (nota < 0 || nota > 10) {
      return res.status(400).json({ error: 'Nota deve ser entre 0 e 10' });
    }

    const avaliacaoRef = db.ref(`avaliacoes/${dramaId}/${req.userId}`);
    await avaliacaoRef.set({
      nota,
      comentario,
      userId: req.userId,
      data: new Date().toISOString()
    });

    res.json({ message: 'Avaliação salva com sucesso' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para buscar avaliações de um dorama
app.get('/api/doramas/:id/avaliacoes', async (req, res) => {
  try {
    const snapshot = await db.ref(`avaliacoes/${req.params.id}`).once('value');
    const avaliacoes = snapshot.val() || {};
    res.json(Object.values(avaliacoes));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para buscar doramas por título
app.get('/api/doramas/busca', async (req, res) => {
  try {
    const query = req.query.q?.toLowerCase();
    if (!query) {
      return res.status(400).json({ error: 'Termo de busca necessário' });
    }

    const snapshot = await db.ref('dramas').once('value');
    const dramas = Object.values(snapshot.val() || {});
    
    const resultados = dramas.filter(drama => 
      drama.title.toLowerCase().includes(query)
    );

    res.json(resultados);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const TMDB_API_KEY = '9856bd9bc9ba68efde5136029fde69d5';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const cache = new Map();
const CACHE_DURATION = 3600000; // 1 hora em millisegundos

async function getTMDBEpisodes(tmdbId) {
  const cacheKey = `episodes_${tmdbId}`;
  const cached = cache.get(cacheKey);
  
  if (cached && (Date.now() - cached.timestamp < CACHE_DURATION)) {
    return cached.data;
  }
  try {
    const response = await axios.get(`${TMDB_BASE_URL}/tv/${tmdbId}/season/1`, {
      params: {
        api_key: TMDB_API_KEY,
        language: 'pt-BR'
      }
    });
    
    const episodes = response.data.episodes.map(ep => ({
      number: ep.episode_number,
      title: ep.name,
      overview: ep.overview,
      still_path: ep.still_path ? `https://image.tmdb.org/t/p/w300${ep.still_path}` : null,
      air_date: ep.air_date,
      vote_average: ep.vote_average,
      watch_link: `/assistir/episodio/${tmdbId}/${ep.episode_number}`
    }));

    cache.set(cacheKey, {
      timestamp: Date.now(),
      data: episodes
    });

    return episodes;
  } catch (err) {
    console.error(`Error getting TMDB episodes: ${err.message}`);
    return [];
  }
}

// Endpoint para listar todos os doramas em tempo real
app.get('/api/doramas', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    
    // Usar referência em tempo real
    const dramasRef = db.ref('dramas');
    dramasRef.on('value', (snapshot) => {
      const dramas = Object.values(snapshot.val() || {});
      
      const start = (page - 1) * limit;
      const sort = req.query.sort || 'rating';
      const order = req.query.order === 'asc' ? 1 : -1;
      
      dramas.sort((a, b) => {
        if (sort === 'year') {
          return (parseInt(a.year) - parseInt(b.year)) * order;
        }
        return (parseFloat(a.rating) - parseFloat(b.rating)) * order;
      });
      
      const paginatedDramas = dramas.slice(start, start + limit);
      
      res.json({
        page,
        total: dramas.length,
        total_pages: Math.ceil(dramas.length / limit),
        data: paginatedDramas
      });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para buscar um dorama específico
app.get('/api/doramas/:id', async (req, res) => {
  try {
    const snapshot = await db.ref(`dramas/drama_${req.params.id}`).once('value');
    const drama = snapshot.val();
    if (!drama) {
      return res.status(404).json({ error: 'Dorama não encontrado' });
    }
    // Salvar no cache local
    await storage.setItem(`drama_${req.params.id}`, drama);
    res.json(drama);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para buscar episódios de um dorama
app.get('/api/doramas/:id/episodios', async (req, res) => {
  try {
    if (!req.params.id || isNaN(parseInt(req.params.id))) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    const snapshot = await db.ref(`dramas/drama_${req.params.id}`).once('value');
    const drama = snapshot.val();
    
    if (!drama) {
      return res.status(404).json({ error: 'Dorama não encontrado' });
    }

    if (!drama.tmdb_id) {
      return res.status(404).json({ error: 'Dorama sem ID TMDB. Atualize o banco de dados.' });
    }
    
    const episodes = await getTMDBEpisodes(drama.tmdb_id);
    
    if (!episodes || episodes.length === 0) {
      return res.status(404).json({ error: 'Nenhum episódio encontrado' });
    }
    
    res.json(episodes);
  } catch (error) {
    console.error(`Error fetching episodes: ${error.message}`);
    res.status(500).json({ error: 'Erro ao buscar episódios' });
  }
});

async function searchTMDB(title) {
  try {
    const response = await axios.get(`${TMDB_BASE_URL}/search/tv`, {
      params: {
        api_key: TMDB_API_KEY,
        query: title,
        language: 'pt-BR'
      }
    });
    
    if (!response.data.results || response.data.results.length === 0) {
      console.log(`No TMDB results found for: ${title}`);
      return null;
    }
    
    // Filtrar resultados que correspondem melhor ao título
    const bestMatch = response.data.results.find(show => 
      show.name.toLowerCase().includes(title.toLowerCase()) ||
      (show.original_name && show.original_name.toLowerCase().includes(title.toLowerCase()))
    ) || response.data.results[0];
    
    return bestMatch;
  } catch (err) {
    console.error(`Error searching TMDB: ${err.message}`);
    return null;
  }
}

// Endpoint para atualizar o banco
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_OWNER = process.env.GITHUB_OWNER;

async function saveToGithub(data) {
  try {
    const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
    const date = new Date().toISOString().split('T')[0];
    const path = `data/doramas_${date}.json`;

    const response = await axios.put(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`,
      {
        message: `Update doramas data ${date}`,
        content: content
      },
      {
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      }
    );
    return response.data;
  } catch (error) {
    console.error('Error saving to Github:', error);

// Endpoint para listar últimos doramas
app.get('/api/doramas/ultimos', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    
    // Usar referência em tempo real ordenada por data
    const dramasRef = db.ref('dramas').orderByChild('created_at').limitToLast(limit);
    
    dramasRef.on('value', (snapshot) => {
      const dramas = [];
      snapshot.forEach((childSnapshot) => {
        dramas.push(childSnapshot.val());
      });
      
      res.json({
        total: dramas.length,
        data: dramas.reverse() // Mais recentes primeiro
      });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

    throw error;
  }
}

app.post('/api/update', async (req, res) => {
  try {
    const BASE_URL = 'https://doramogo.to/dorama';
    const MAX_PAGES = 12;
    let dramas = [];
    let dramaId = 1;
    const titlesSet = new Set();

    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = page === 1 ? `${BASE_URL}/` : `${BASE_URL}/page/${page}/`;
      const { data: html } = await axios.get(url);
      const $ = cheerio.load(html);

      for (const el of $('.items article')) {
          const title = $(el).find('h3 a').text().trim();

          if (titlesSet.has(title)) continue;
          titlesSet.add(title);
          
          const link = $(el).find('a').attr('href');
          const year = $(el).find('span').text().trim();
          const image = $(el).find('img').attr('src');
          const rating = $(el).find('.rating').text().trim();

          const tmdbData = await searchTMDB(title);
          console.log(`TMDB data for ${title}:`, tmdbData);
          const drama = {
            id: `drama_${dramaId++}`,
            title,
            link,
            year,
            image,
            rating,
            tmdb_id: tmdbData?.id || null
          };

          dramas.push(drama);
          await db.ref(`dramas/${drama.id}`).set(drama);
        }
    }

    // Salvar no Github
    // Salvar no Github
    await saveToGithub({
      updated_at: new Date().toISOString(),
      dramas: dramas
    });

    // Salvar localmente
    await storage.setItem('all_dramas', dramas);
    await storage.setItem('last_update', new Date().toISOString());
    
    res.json({ 
      message: 'Database and Github updated successfully', 
      count: dramas.length 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para ativar VIP
app.post('/api/usuarios/ativar-vip', authMiddleware, async (req, res) => {
  try {
    const userRef = db.ref(`usuarios/${req.userId}`);
    const expiration = new Date();
    expiration.setMonth(expiration.getMonth() + 1); // VIP por 1 mês
    
    await userRef.update({
      vip: true,
      vipExpiration: expiration.toISOString(),
      beneficios: [
        'Downloads ilimitados',
        'Sem anúncios',
        'Episódios antecipados',
        'Qualidade 4K'
      ]
    });
    
    res.json({ message: 'VIP ativado com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para verificar status VIP
// Endpoint para recomendações personalizadas
// Endpoints de histórico
app.post('/api/usuarios/historico', authMiddleware, async (req, res) => {
  try {
    const { dramaId, episodio, tempo } = req.body;
    await db.ref(`usuarios/${req.userId}/historico/${dramaId}`).set({
      episodio,
      tempo,
      data: new Date().toISOString()
    });
    res.json({ message: 'Histórico atualizado' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoints de tags
app.get('/api/doramas/tags', async (req, res) => {
  try {
    const snapshot = await db.ref('tags').once('value');
    res.json(snapshot.val() || {});
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoints de estatísticas
app.get('/api/usuarios/stats', authMiddleware, async (req, res) => {
  try {
    const historico = await db.ref(`usuarios/${req.userId}/historico`).once('value');
    const stats = {
      total_assistidos: Object.keys(historico.val() || {}).length,
      tempo_total: 0,
      generos_favoritos: {},
      ultima_atividade: new Date().toISOString()
    };
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/doramas/:id/stats', async (req, res) => {
  try {
    const dramaId = req.params.id;
    const views = await db.ref(`stats/dramas/${dramaId}/views`).once('value');
    const ratings = await db.ref(`avaliacoes/${dramaId}`).once('value');
    
    const stats = {
      views: views.val() || 0,
      rating_medio: 0,
      total_avaliacoes: 0
    };
    
    const avaliacoes = ratings.val() || {};
    if (Object.keys(avaliacoes).length > 0) {
      const notas = Object.values(avaliacoes).map(a => a.nota);
      stats.rating_medio = notas.reduce((a, b) => a + b) / notas.length;
      stats.total_avaliacoes = notas.length;
    }
    
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/doramas/tags/:tag', async (req, res) => {
  try {
    const tag = req.params.tag;
    const snapshot = await db.ref('dramas')
      .orderByChild(`tags/${tag}`)
      .equalTo(true)
      .once('value');
    res.json(Object.values(snapshot.val() || {}));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/usuarios/historico', authMiddleware, async (req, res) => {
  try {
    const snapshot = await db.ref(`usuarios/${req.userId}/historico`).once('value');
    res.json(snapshot.val() || {});
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/doramas/recomendados', authMiddleware, async (req, res) => {
  try {
    // Buscar histórico do usuário
    const userSnapshot = await db.ref(`usuarios/${req.userId}/historico`).once('value');
    const historico = userSnapshot.val() || {};
    
    // Buscar todos os doramas
    const dramasSnapshot = await db.ref('dramas').once('value');
    const dramas = Object.values(dramasSnapshot.val() || {});
    
    // Filtrar por gêneros mais assistidos
    const recomendados = dramas
      .filter(drama => !historico[drama.id]) // Remover já assistidos
      .sort((a, b) => b.rating - a.rating) // Ordenar por rating
      .slice(0, 10); // Limitar a 10 recomendações
    
    res.json(recomendados);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/usuarios/status-vip', authMiddleware, async (req, res) => {
  try {
    const snapshot = await db.ref(`usuarios/${req.userId}`).once('value');
    const userData = snapshot.val();
    
    res.json({
      vip: userData.vip,
      expiration: userData.vipExpiration,
      beneficios: userData.beneficios
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('API rodando em http://0.0.0.0:5000');
});
