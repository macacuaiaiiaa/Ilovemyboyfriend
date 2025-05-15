const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const admin = require('firebase-admin');

const serviceAccount = require('./google-services (1).json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://cuzaodamimhanamorada-default-rtdb.firebaseio.com"
});

const db = admin.database();
const app = express();
app.use(express.json());

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
    return response.data.episodes.map(ep => ({
      number: ep.episode_number,
      title: ep.name
    }));
  } catch (err) {
    console.error(`Error getting TMDB episodes: ${err.message}`);
    return [];
  }
}

// Endpoint para listar todos os doramas
app.get('/api/doramas', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const snapshot = await db.ref('dramas').once('value');
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
app.post('/api/update', async (req, res) => {
  try {
    const BASE_URL = 'https://doramogo.to/dorama';
    const MAX_PAGES = 5;
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

    res.json({ message: 'Database updated successfully', count: dramas.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('API rodando em http://0.0.0.0:5000');
});