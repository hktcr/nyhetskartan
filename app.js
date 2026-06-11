// =============================================
// Nyhetskartan v2.0 — Application Logic
// GAIA News Intelligence Dashboard
// =============================================

const CONFIG = {
    mapStyle: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    defaultCenter: [18, 40],
    defaultZoom: 2.2,
    dataPath: 'nyheter.json',
    flyDuration: 1800,
    flyZoom: 5
};

let map, newsData = null, markers = [], activeNewsId = null, actualCoordinates = {}, activePulseFrame = null;

// ── Category Colors ──
const CATEGORY_COLORS = {
    konflikt: '#ff4757', energi: '#ff9f43', försvar: '#3742fa',
    politik: '#a55eea', diplomati: '#70a1ff', monarki: '#feca57',
    samhälle: '#2ed573', demokrati: '#1e90ff', infrastruktur: '#ff6348',
    rymd: '#7c4dff', sport: '#26de81', hälsa: '#fc5c65',
    miljö: '#20bf6b', brott: '#eb3b5a', kultur: '#f7b731',
    ekonomi: '#45aaf2', geopolitik: '#d63031', säkerhet: '#e17055',
    rättigheter: '#6c5ce7'
};

// ── Initialize ──
function init() {
    map = new maplibregl.Map({
        container: 'map',
        style: CONFIG.mapStyle,
        center: CONFIG.defaultCenter,
        zoom: CONFIG.defaultZoom,
        attributionControl: false
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.on('load', loadNewsData);
    document.getElementById('detail-close').addEventListener('click', closeDetail);
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            if (document.getElementById('article-reader').classList.contains('visible')) return; // handled by article reader
            closeDetail();
        }
    });

    // Battery status tracking for power-save mode (from consensus)
    if (navigator.getBattery) {
        navigator.getBattery().then(battery => {
            window.batteryStatus = {
                level: battery.level,
                charging: battery.charging
            };
            battery.addEventListener('levelchange', () => {
                window.batteryStatus.level = battery.level;
            });
            battery.addEventListener('chargingchange', () => {
                window.batteryStatus.charging = battery.charging;
            });
        }).catch(() => {});
    }
}

// ── Load Data ──
async function loadNewsData() {
    try {
        const resp = await fetch(CONFIG.dataPath);
        if (!resp.ok) throw new Error('Fetch failed');
        newsData = await resp.json();
        renderSidebar();
        renderMarkers();
        updateHeader();
        renderDailyBrief();
        setTimeout(() => {
            document.getElementById('loading').classList.add('hidden');
        }, 400);
    } catch (err) {
        console.error('Load error:', err);
        document.getElementById('loading').innerHTML =
            '<p style="color:var(--accent-red)">⚠️ Kunde inte ladda nyheter</p>' +
            '<p style="color:var(--text-muted);margin-top:0.5rem;font-size:0.85rem">Kör <code>/nyheter</code> för att generera data</p>';
    }
}

// ── Render Sidebar ──
function renderSidebar() {
    const list = document.getElementById('news-list');
    list.innerHTML = '';

    const sorted = [...newsData.news].sort((a, b) => b.score - a.score);
    
    // Group news
    const localNews = sorted.filter(news => news.location && news.location.precision !== 'global' && news.location.lat && news.location.lon);
    const globalNews = sorted.filter(news => !news.location || news.location.precision === 'global' || !news.location.lat || !news.location.lon);

    // Render Local News Section
    if (localNews.length > 0) {
        const header = document.createElement('div');
        header.className = 'list-section-header';
        header.textContent = '📍 Geospatiala händelser';
        list.appendChild(header);

        localNews.forEach(news => list.appendChild(createNewsCard(news)));
    }

    // Render Global News Section
    if (globalNews.length > 0) {
        const header = document.createElement('div');
        header.className = 'list-section-header';
        header.textContent = '🌎 Globala & olokaliserade händelser';
        list.appendChild(header);

        globalNews.forEach(news => list.appendChild(createNewsCard(news)));
    }

    // Filter pills
    document.querySelectorAll('.filter-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            filterNews(pill.dataset.filter);
        });
    });
}

function createNewsCard(news) {
    const card = document.createElement('div');
    card.className = 'news-card';
    card.dataset.id = news.id;

    const color = CATEGORY_COLORS[news.category] || '#8ba3c1';
    const scorePercent = (news.score / 10) * 100;
    const scoreColor = news.score >= 8 ? 'var(--accent-red)' : news.score >= 6 ? 'var(--accent-orange)' : 'var(--accent-cyan)';
    const timeStr = formatTime(news.published_at);

    const sentimentIcon = {'negative': '🔴', 'positive': '🟢', 'neutral': '⚪'}[news.sentiment] || '⚪';

    card.innerHTML = `
        <div class="news-card-top">
            <span class="tier-badge tier-${news.tier}">Tier ${news.tier}</span>
            <span class="category-tag" style="color:${color}">${news.category}</span>
            <span class="sentiment-dot" title="Sentiment: ${news.sentiment || 'neutral'}">${sentimentIcon}</span>
            ${news.multi_source_verified ? '<span class="verified-badge">✓ Verifierad</span>' : ''}
        </div>
        <h3>${news.title}</h3>
        <div class="news-card-meta">
            <span>📍 ${news.location?.city || 'Global'}</span>
            <span>${timeStr}</span>
            <span>${news.source_count} källor</span>
            <div class="score-bar"><div class="score-bar-fill" style="width:${scorePercent}%;background:${scoreColor}"></div></div>
        </div>
    `;

    card.addEventListener('click', () => selectNews(news));
    return card;
}

// ── Filter ──
function filterNews(filter) {
    document.querySelectorAll('.news-card').forEach(card => {
        const news = newsData.news.find(n => n.id === card.dataset.id);
        if (!news) return;
        if (filter === 'all') card.style.display = '';
        else if (filter === 'tier1') card.style.display = news.tier === 1 ? '' : 'none';
        else if (filter === 'tier2') card.style.display = news.tier === 2 ? '' : 'none';
        else if (filter === 'sv') card.style.display = news.location?.country === 'Sverige' ? '' : 'none';
    });
}

// ── Render Map Markers (with jitter for overlapping locations) ──
function renderMarkers() {
    const coordCounts = {};

    newsData.news.forEach(news => {
        if (!news.location?.lat || !news.location?.lon) return;

        // Jitter overlapping coordinates
        const key = `${news.location.lat.toFixed(2)}_${news.location.lon.toFixed(2)}`;
        coordCounts[key] = (coordCounts[key] || 0);
        const jitterAngle = coordCounts[key] * (2 * Math.PI / 5);
        const jitterRadius = coordCounts[key] > 0 ? 0.3 : 0;
        const lat = news.location.lat + Math.sin(jitterAngle) * jitterRadius;
        const lon = news.location.lon + Math.cos(jitterAngle) * jitterRadius;
        coordCounts[key]++;
        actualCoordinates[news.id] = [lon, lat];

        const el = document.createElement('div');
        const color = CATEGORY_COLORS[news.category] || '#ff4757';
        el.className = `news-marker ${news.tier === 1 ? 'tier-1' : ''}`;
        el.dataset.id = news.id;
        el.style.background = color;
        el.style.boxShadow = `0 0 12px ${color}55`;
        el.setAttribute('role', 'button');
        el.setAttribute('tabindex', '0');
        el.setAttribute('aria-label', `Nyhet: ${news.title}`);

        el.addEventListener('click', () => selectNews(news));
        el.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectNews(news); }
        });

        const marker = new maplibregl.Marker({ element: el })
            .setLngLat([lon, lat])
            .addTo(map);
        markers.push({ marker, id: news.id });
    });
}

// ── Bounding Box Highlight (WebGL layer) ──
function drawBBoxHighlight(bbox) {
    if (map.getLayer('bbox-highlight')) map.removeLayer('bbox-highlight');
    if (map.getLayer('bbox-outline')) map.removeLayer('bbox-outline');
    if (map.getSource('bbox')) map.getSource('bbox');

    if (!bbox || bbox.length !== 4) return;

    const [min_lon, min_lat, max_lon, max_lat] = bbox;

    map.addSource('bbox', {
        type: 'geojson',
        data: {
            type: 'Feature',
            geometry: {
                type: 'Polygon',
                coordinates: [[
                    [min_lon, min_lat],
                    [max_lon, min_lat],
                    [max_lon, max_lat],
                    [min_lon, max_lat],
                    [min_lon, min_lat]
                ]]
            }
        }
    });

    map.addLayer({
        id: 'bbox-highlight',
        type: 'fill',
        source: 'bbox',
        paint: {
            'fill-color': '#ff4757',
            'fill-opacity': 0.08
        }
    });

    map.addLayer({
        id: 'bbox-outline',
        type: 'line',
        source: 'bbox',
        paint: {
            'line-color': '#ff4757',
            'line-width': 1.5,
            'line-dasharray': [2, 2]
        }
    });
}

function clearBBoxHighlight() {
    if (map.getLayer('bbox-highlight')) map.removeLayer('bbox-highlight');
    if (map.getLayer('bbox-outline')) map.removeLayer('bbox-outline');
    if (map.getSource('bbox')) map.removeSource('bbox');
}

// ── Select News ──
function selectNews(news) {
    map.stop();

    // Deselect previous
    document.querySelectorAll('.news-card.active').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.news-marker.active-marker').forEach(m => m.classList.remove('active-marker'));

    activeNewsId = news.id;

    // Highlight card
    const card = document.querySelector(`.news-card[data-id="${news.id}"]`);
    if (card) {
        card.classList.add('active');
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Highlight marker
    const markerEl = document.querySelector(`.news-marker[data-id="${news.id}"]`);
    if (markerEl) markerEl.classList.add('active-marker');

    // Fly/Fit to location
    clearBBoxHighlight();
    if (news.location?.bbox && news.location.bbox.length === 4) {
        const [min_lon, min_lat, max_lon, max_lat] = news.location.bbox;
        map.fitBounds([[min_lon, min_lat], [max_lon, max_lat]], {
            padding: 80,
            maxZoom: 7,
            duration: CONFIG.flyDuration
        });
        drawBBoxHighlight(news.location.bbox);
    } else if (news.location?.lat && news.location?.lon) {
        map.flyTo({
            center: [news.location.lon, news.location.lat],
            zoom: CONFIG.flyZoom,
            duration: CONFIG.flyDuration,
            essential: true
        });
    }

    // Populate detail panel
    populateDetail(news);
    
    // Update relations threads
    updateRelationsLayer(news.id);
}

// ── Populate Detail Panel ──
function populateDetail(news) {
    const panel = document.getElementById('detail-panel');
    const color = CATEGORY_COLORS[news.category] || '#8ba3c1';

    document.getElementById('detail-tier').textContent = `Tier ${news.tier}`;
    document.getElementById('detail-tier').className = `tier-badge tier-${news.tier}`;
    document.getElementById('detail-category').textContent = news.category;
    document.getElementById('detail-category').style.color = color;
    document.getElementById('detail-title').textContent = news.title;
    document.getElementById('detail-location').innerHTML = `📍 ${news.location?.city || 'Global'}, ${news.location?.country || ''}`;
    document.getElementById('detail-summary').textContent = news.summary || '';
    document.getElementById('detail-gaia').textContent = news.gaia_synthesis || '';

    // Score
    const scoreEl = document.getElementById('detail-score');
    scoreEl.textContent = news.score.toFixed(1);
    scoreEl.style.color = news.score >= 8 ? 'var(--accent-red)' : news.score >= 6 ? 'var(--accent-orange)' : 'var(--accent-cyan)';

    // Scoring breakdown (W4: transparent criteria)
    const scoringEl = document.getElementById('detail-scoring');
    const srcScore = Math.min(news.source_count * 2, 5);
    const verScore = news.multi_source_verified ? 2 : 0;
    const tierScore = news.tier === 1 ? 3 : 1;
    const totalMax = 10;
    const barColor = news.score >= 8 ? 'var(--accent-red)' : news.score >= 6 ? 'var(--accent-orange)' : 'var(--accent-cyan)';

    const sentimentLabel = {'negative': '🔴 Negativ', 'positive': '🟢 Positiv', 'neutral': '⚪ Neutral'}[news.sentiment] || '⚪ Neutral';
    const sentimentColor = {'negative': 'var(--accent-red)', 'positive': 'var(--accent-green)', 'neutral': 'var(--text-muted)'}[news.sentiment] || 'var(--text-muted)';

    scoringEl.innerHTML = `
        <div class="scoring-row">
            <span class="scoring-label">Källor</span>
            <span class="scoring-value">${news.source_count}</span>
        </div>
        <div class="scoring-row">
            <span class="scoring-label">Verifierad</span>
            <span class="scoring-value" style="color:${news.multi_source_verified ? 'var(--accent-green)' : 'var(--text-muted)'}">${news.multi_source_verified ? '✓ Ja' : '✗ Nej'}</span>
        </div>
        <div class="scoring-row">
            <span class="scoring-label">Tier</span>
            <span class="scoring-value">${news.tier}</span>
        </div>
        <div class="scoring-row">
            <span class="scoring-label">Sentiment</span>
            <span class="scoring-value" style="color:${sentimentColor}">${sentimentLabel}</span>
        </div>
        <div class="scoring-bar-container">
            <span class="scoring-bar-label">Total: ${news.score.toFixed(1)}/${totalMax}</span>
            <div class="scoring-bar-track">
                <div class="scoring-bar-value" style="width:${(news.score/totalMax)*100}%;background:${barColor}"></div>
            </div>
        </div>
    `;

    // Sources
    const sourcesList = document.getElementById('detail-sources');
    sourcesList.innerHTML = '';
    (news.sources || []).forEach(src => {
        const li = document.createElement('li');
        li.className = 'source-item';
        li.innerHTML = `
            <span class="source-badge ${src.type}">${getSourceLabel(src.type)}</span>
            <span class="source-name">${src.name}</span>
            <a href="${src.url}" target="_blank" rel="noopener" class="source-link">→</a>
        `;
        sourcesList.appendChild(li);
    });

    // Show/hide "Läs artikel" button
    const articleSection = document.getElementById('detail-article-section');
    const hasArticle = news.has_article || news.article_content || (news.gaia_synthesis && news.summary);
    articleSection.style.display = hasArticle ? '' : 'none';

    // Wire the button to this specific news item
    const readBtn = document.getElementById('read-article-btn');
    readBtn.onclick = () => openArticle(news);

    panel.classList.add('visible');

    // On mobile, close sidebar when detail opens
    closeMobileSidebar();
}

function closeDetail() {
    document.getElementById('detail-panel').classList.remove('visible');
    document.querySelectorAll('.news-card.active').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.news-marker.active-marker').forEach(m => m.classList.remove('active-marker'));
    activeNewsId = null;

    clearBBoxHighlight();
    updateRelationsLayer(null);
    map.flyTo({ center: CONFIG.defaultCenter, zoom: CONFIG.defaultZoom, duration: 1200 });
}

// ── Update Header ──
function updateHeader() {
    const tier1 = newsData.news.filter(n => n.tier === 1).length;
    const total = newsData.news.length;
    document.getElementById('news-count').textContent = `${total} nyheter`;
    document.getElementById('tier1-count').textContent = `${tier1} Tier 1`;

    if (newsData.generated_at) {
        const d = new Date(newsData.generated_at);
        document.getElementById('update-time').textContent =
            d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' }) + ' ' +
            d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
    }
}

// ── Daily Brief ──
function renderDailyBrief() {
    const el = document.getElementById('daily-brief-text');
    if (newsData.meta_analysis?.gaia_daily_brief) {
        el.textContent = newsData.meta_analysis.gaia_daily_brief;
    }
}

// ── Helpers ──
function formatTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
}

function getSourceLabel(type) {
    return { agency: 'Byrå', public_service: 'PS', commercial: 'Komm.', government: 'Myn.', ngo: 'NGO', journalist: 'Jour.' }[type] || type;
}

// ── Mobile Sidebar Toggle (W5) ──
function setupMobileToggle() {
    const toggle = document.getElementById('mobile-toggle');
    const sidebar = document.querySelector('.sidebar');
    if (!toggle || !sidebar) return;

    toggle.addEventListener('click', () => {
        sidebar.classList.toggle('mobile-open');
    });

    // Close sidebar when clicking on map area (on mobile)
    document.getElementById('map')?.addEventListener('click', closeMobileSidebar);
}

function closeMobileSidebar() {
    document.querySelector('.sidebar')?.classList.remove('mobile-open');
}

// ── Article Reader ──
let currentArticleNews = null;

async function openArticle(news) {
    currentArticleNews = news;
    const reader = document.getElementById('article-reader');
    const color = CATEGORY_COLORS[news.category] || '#8ba3c1';

    // Toolbar title loading state
    document.getElementById('article-toolbar-title').textContent = "Laddar artikel...";
    document.getElementById('article-title').textContent = "Laddar...";
    document.getElementById('article-text').innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;padding:4rem 0;">
            <div class="loading-spinner"></div>
            <p style="font-family:'Inter',sans-serif;font-size:0.9rem;color:var(--text-muted);margin-top:1rem;">Hämtar fördjupad nyhetsanalys från gAIa...</p>
        </div>
    `;

    // Header meta badges
    const sentimentIcon = { negative: '🔴', positive: '🟢', neutral: '⚪' }[news.sentiment] || '⚪';
    document.getElementById('article-meta').innerHTML = `
        <span class="tier-badge tier-${news.tier}">Tier ${news.tier}</span>
        <span class="category-tag" style="color:${color}">${news.category}</span>
        <span class="sentiment-dot" title="Sentiment: ${news.sentiment || 'neutral'}">${sentimentIcon}</span>
        ${news.multi_source_verified ? '<span class="verified-badge">✓ Verifierad</span>' : ''}
    `;

    // Title
    document.getElementById('article-title').textContent = news.title;

    // Location & date
    const loc = news.location?.city || 'Global';
    const country = news.location?.country || '';
    const dateStr = news.published_at
        ? new Date(news.published_at).toLocaleDateString('sv-SE', { day: 'numeric', month: 'long', year: 'numeric' })
        : '';
    document.getElementById('article-location').innerHTML = `
        <span>📍 ${loc}${country ? ', ' + country : ''}</span>
        ${dateStr ? '<span class="separator"></span><span>' + dateStr + '</span>' : ''}
        <span class="separator"></span>
        <span>${news.source_count} käll${news.source_count === 1 ? 'a' : 'or'}</span>
    `;

    // Show reader to begin transition smoothly
    reader.classList.add('visible');
    document.querySelector('.article-body').scrollTop = 0;
    document.body.style.overflow = 'hidden';

    // Fetch full article from partitioned json
    try {
        const articleUrl = `artiklar/${news.id}.json`;
        const resp = await fetch(articleUrl);
        if (!resp.ok) throw new Error(`Status ${resp.status}`);
        const fullArticle = await resp.json();

        document.getElementById('article-toolbar-title').textContent = fullArticle.title;
        document.getElementById('article-title').textContent = fullArticle.title;
        document.getElementById('article-text').innerHTML = fullArticle.article_content;
    } catch (err) {
        console.warn('Asynkron hämtning misslyckades, faller tillbaka på lokal generering:', err);
        // Fallback to dynamic local generation if needed
        document.getElementById('article-toolbar-title').textContent = news.title;
        document.getElementById('article-title').textContent = news.title;
        document.getElementById('article-text').innerHTML = generateArticleHTML(news);
    }

    // Sources section
    const sourcesSection = document.getElementById('article-sources-section');
    if (news.sources && news.sources.length > 0) {
        sourcesSection.innerHTML = `
            <h2>Källor & vidare läsning</h2>
            <ul class="article-sources-list">
                ${news.sources.map(src => `
                    <a class="article-source-item" href="${src.url}" target="_blank" rel="noopener">
                        <span class="source-badge ${src.type}">${getSourceLabel(src.type)}</span>
                        <span class="source-name">${src.name}</span>
                        <span class="source-arrow">→</span>
                    </a>
                `).join('')}
            </ul>
        `;
    } else {
        sourcesSection.innerHTML = '';
    }

    // Restore font size
    const savedSize = localStorage.getItem('nyheter-article-font-size');
    if (savedSize) {
        document.querySelector('.article-content').style.setProperty('--article-font-size', savedSize + 'px');
    }
}

function closeArticle() {
    const reader = document.getElementById('article-reader');
    reader.classList.remove('visible');
    currentArticleNews = null;
    document.body.style.overflow = '';
}

function generateArticleHTML(news) {
    let html = '';

    // Lead paragraph from summary
    if (news.summary) {
        html += `<p>${news.summary}</p>`;
    }

    // gAIa synthesis as a rich analysis section
    if (news.gaia_synthesis) {
        html += `
            <h2>Analys</h2>
            <p>${news.gaia_synthesis}</p>
        `;
    }

    // Wrap synthesis in styled card if present
    if (news.gaia_synthesis) {
        html += `
            <div class="article-synthesis">
                <div class="article-synthesis-header">
                    <div class="icon">🤖</div>
                    <span>gAIa-reflektion</span>
                </div>
                <div class="article-synthesis-body">
                    <p>Denna händelse bör ses i ett bredare sammanhang av pågående globala förändringsprocesser.
                    ${news.category === 'försvar' ? ' Försvars- och säkerhetspolitiska spänningar ökar på flera håll i världen, och enskilda händelser får ofta oproportionerligt stor strategisk betydelse.' : ''}
                    ${news.category === 'diplomati' ? ' Diplomatiska förhandlingar präglas allt mer av oförutsägbarhet och transaktionella mönster.' : ''}
                    ${news.category === 'hälsa' ? ' Folkhälsoutmaningar kräver koordinerade internationella insatser som ofta kompliceras av geopolitiska intressen.' : ''}
                    ${news.category === 'konflikt' ? ' Konfliktsituationer tenderar att eskalera snabbt i en alltmer sammankopplad värld.' : ''}
                    Att följa denna utveckling med kritisk medvetenhet och multiperspektiv är avgörande.</p>
                </div>
            </div>
        `;
    }

    return html;
}

// ── Font Size Controls ──
const FONT_MIN = 14, FONT_MAX = 26, FONT_DEFAULT = 18;

function getArticleFontSize() {
    return parseInt(localStorage.getItem('nyheter-article-font-size') || FONT_DEFAULT);
}

function setArticleFontSize(size) {
    size = Math.max(FONT_MIN, Math.min(FONT_MAX, size));
    localStorage.setItem('nyheter-article-font-size', size);
    const content = document.querySelector('.article-content');
    if (content) content.style.setProperty('--article-font-size', size + 'px');
}

function setupArticleReader() {
    // Back button
    document.getElementById('article-back').addEventListener('click', closeArticle);

    // Font controls
    document.getElementById('font-decrease').addEventListener('click', () => setArticleFontSize(getArticleFontSize() - 2));
    document.getElementById('font-increase').addEventListener('click', () => setArticleFontSize(getArticleFontSize() + 2));
    document.getElementById('font-reset').addEventListener('click', () => setArticleFontSize(FONT_DEFAULT));

    // Keyboard navigation
    document.addEventListener('keydown', e => {
        if (!document.getElementById('article-reader').classList.contains('visible')) return;
        if (e.key === 'Escape' || e.key === 'Backspace') {
            e.preventDefault();
            closeArticle();
        }
    });
}

// =============================================
// Relation Threads Visualization Logic
// =============================================

function initRelationsLayers() {
    if (map.getSource('relations-source')) return;

    map.addSource('relations-source', {
        type: 'geojson',
        data: {
            type: 'FeatureCollection',
            features: []
        }
    });

    map.addLayer({
        id: 'relations-layer',
        type: 'line',
        source: 'relations-source',
        paint: {
            'line-color': ['get', 'color'],
            'line-width': ['get', 'width'],
            'line-opacity': 0.85
        },
        layout: {
            'line-cap': 'round',
            'line-join': 'round'
        }
    });

    map.addSource('relations-particles-source', {
        type: 'geojson',
        data: {
            type: 'FeatureCollection',
            features: []
        }
    });

    map.addLayer({
        id: 'relations-particles-layer',
        type: 'circle',
        source: 'relations-particles-source',
        paint: {
            'circle-color': ['get', 'color'],
            'circle-radius': 3.5,
            'circle-blur': 0.5,
            'circle-opacity': 0.9
        }
    });

    // Wire hover popup interaction
    initRelationsPopup();
}

function calculateBezierCurve(coordA, coordB, segments = 40) {
    const lonA = coordA[0];
    const latA = coordA[1];
    const lonB = coordB[0];
    const latB = coordB[1];

    const midLon = (lonA + lonB) / 2;
    const midLat = (latA + latB) / 2;

    const dLon = lonB - lonA;
    const dLat = latB - latA;
    
    const pLon = -dLat;
    const pLat = dLon;

    const len = Math.sqrt(pLon * pLon + pLat * pLat);
    let offsetLon = 0;
    let offsetLat = 0;
    
    if (len > 0) {
        const offsetDist = len * 0.15;
        offsetLon = (pLon / len) * offsetDist;
        offsetLat = (pLat / len) * offsetDist;
    }

    const ctrlLon = midLon + offsetLon;
    const ctrlLat = midLat + offsetLat;

    const points = [];
    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const termA = (1 - t) * (1 - t);
        const termC = 2 * (1 - t) * t;
        const termB = t * t;

        const x = termA * lonA + termC * ctrlLon + termB * lonB;
        const y = termA * latA + termC * ctrlLat + termB * latB;
        points.push([x, y]);
    }
    return points;
}

function updateRelationsLayer(activeId) {
    initRelationsLayers();

    if (!activeId || !newsData.relations) {
        if (map.getSource('relations-source')) {
            map.getSource('relations-source').setData({
                type: 'FeatureCollection',
                features: []
            });
        }
        if (map.getSource('relations-particles-source')) {
            map.getSource('relations-particles-source').setData({
                type: 'FeatureCollection',
                features: []
            });
        }
        if (activePulseFrame) {
            cancelAnimationFrame(activePulseFrame);
            activePulseFrame = null;
        }
        document.querySelectorAll('.news-marker').forEach(el => el.style.opacity = '1');
        
        const relSection = document.getElementById('detail-relations-section');
        if (relSection) relSection.style.display = 'none';
        return;
    }

    const activeNews = newsData.news.find(n => n.id === activeId);
    if (!activeNews) return;

    const activeRels = newsData.relations.filter(r => r.source === activeId || r.target === activeId);

    const relatedIds = new Set([activeId]);
    activeRels.forEach(r => {
        relatedIds.add(r.source);
        relatedIds.add(r.target);
    });

    document.querySelectorAll('.news-marker').forEach(el => {
        const mId = el.dataset.id;
        if (relatedIds.has(mId)) {
            el.style.opacity = '1';
        } else {
            el.style.opacity = '0.25';
        }
    });

    const lineFeatures = [];
    const curves = [];

    activeRels.forEach(rel => {
        const sourceCoord = actualCoordinates[rel.source];
        const targetCoord = actualCoordinates[rel.target];

        if (sourceCoord && targetCoord) {
            const curvePoints = calculateBezierCurve(sourceCoord, targetCoord);
            const rColor = getRelationColor(rel.type);
            
            curves.push({
                points: curvePoints,
                color: rColor,
                source: rel.source,
                target: rel.target
            });

            lineFeatures.push({
                type: 'Feature',
                properties: {
                    color: rColor,
                    width: rel.weight === 1.0 ? 2.5 : 1.5
                },
                geometry: {
                    type: 'LineString',
                    coordinates: curvePoints
                }
            });
        }
    });

    if (map.getSource('relations-source')) {
        map.getSource('relations-source').setData({
            type: 'FeatureCollection',
            features: lineFeatures
        });
    }

    animateParticles(curves);
    renderRelationsInDetail(activeId, activeRels);
}

function getRelationColor(type) {
    const relationColors = {
        geopolitical_link: '#3742fa',
        cause_and_effect: '#ff4757',
        follow_up: '#a55eea',
        thematic_link: '#fc5c65'
    };
    return relationColors[type] || '#8ba3c1';
}

function shouldAnimate() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return false;
    }
    if (window.batteryStatus && window.batteryStatus.level < 0.20 && !window.batteryStatus.charging) {
        return false;
    }
    return true;
}

function sinusEasing(t) {
    return (1 - Math.cos(t * Math.PI)) / 2;
}

function animateParticles(curves) {
    if (activePulseFrame) {
        cancelAnimationFrame(activePulseFrame);
        activePulseFrame = null;
    }

    if (curves.length === 0 || !shouldAnimate()) {
        if (map.getSource('relations-particles-source')) {
            map.getSource('relations-particles-source').setData({
                type: 'FeatureCollection',
                features: []
            });
        }
        return;
    }

    const duration = 2500;
    const startTime = performance.now();

    function loop(now) {
        const elapsed = now - startTime;
        const progress = (elapsed % duration) / duration;

        const particleFeatures = [];

        curves.forEach(curve => {
            const numParticles = 3;
            for (let p = 0; p < numParticles; p++) {
                const offsetProgress = (progress + p / numParticles) % 1.0;
                const easedT = sinusEasing(offsetProgress);
                const index = Math.min(
                    Math.floor(easedT * (curve.points.length - 1)),
                    curve.points.length - 1
                );
                const coord = curve.points[index];

                if (coord) {
                    particleFeatures.push({
                        type: 'Feature',
                        properties: {
                            color: curve.color
                        },
                        geometry: {
                            type: 'Point',
                            coordinates: coord
                        }
                    });
                }
            }
        });

        if (map.getSource('relations-particles-source')) {
            map.getSource('relations-particles-source').setData({
                type: 'FeatureCollection',
                features: particleFeatures
            });
        }

        activePulseFrame = requestAnimationFrame(loop);
    }

    activePulseFrame = requestAnimationFrame(loop);
}

let relationsPopup = null;

function initRelationsPopup() {
    if (relationsPopup) return;

    map.on('mouseenter', 'relations-layer', e => {
        if (!activeNewsId) return;
        map.getCanvas().style.cursor = 'pointer';

        const cursorCoord = [e.lngLat.lng, e.lngLat.lat];
        const activeRels = newsData.relations.filter(r => r.source === activeNewsId || r.target === activeNewsId);
        
        let closestRel = null;
        let minDist = Infinity;
        let midpoint = null;

        activeRels.forEach(rel => {
            const coordA = actualCoordinates[rel.source];
            const coordB = actualCoordinates[rel.target];
            if (coordA && coordB) {
                const curve = calculateBezierCurve(coordA, coordB);
                const mid = curve[Math.floor(curve.length / 2)];
                
                const dLng = mid[0] - cursorCoord[0];
                const dLat = mid[1] - cursorCoord[1];
                const dist = Math.sqrt(dLng * dLng + dLat * dLat);
                if (dist < minDist) {
                    minDist = dist;
                    closestRel = rel;
                    midpoint = mid;
                }
            }
        });

        if (closestRel && midpoint) {
            const relatedNewsId = closestRel.source === activeNewsId ? closestRel.target : closestRel.source;
            const relatedNews = newsData.news.find(n => n.id === relatedNewsId);
            const relatedTitle = relatedNews ? relatedNews.title : 'Relaterad nyhet';

            const popupContent = `
                <div class="relations-tooltip">
                    <div class="tooltip-header">🤖 gAIa-analys</div>
                    <div class="tooltip-body">${closestRel.description}</div>
                    <div class="tooltip-footer">Relaterad: <em>${relatedTitle}</em></div>
                </div>
            `;

            relationsPopup = new maplibregl.Popup({
                closeButton: false,
                closeOnClick: false,
                className: 'glassmorphic-popup'
            })
                .setLngLat(midpoint)
                .setHTML(popupContent)
                .addTo(map);
        }
    });

    map.on('mouseleave', 'relations-layer', () => {
        map.getCanvas().style.cursor = '';
        if (relationsPopup) {
            relationsPopup.remove();
            relationsPopup = null;
        }
    });
}

function renderRelationsInDetail(activeId, activeRels) {
    let relsSection = document.getElementById('detail-relations-section');
    if (!relsSection) {
        relsSection = document.createElement('div');
        relsSection.id = 'detail-relations-section';
        relsSection.className = 'detail-section';
        
        const sourcesSection = document.getElementById('detail-sources').parentElement;
        sourcesSection.parentElement.insertBefore(relsSection, sourcesSection);
    }

    if (activeRels.length === 0) {
        relsSection.style.display = 'none';
        return;
    }

    relsSection.style.display = '';
    relsSection.innerHTML = `
        <h3>🤖 gAIa-relationsanalys</h3>
        <ul class="detail-relations-list" id="detail-relations"></ul>
    `;

    const relsList = document.getElementById('detail-relations');
    activeRels.forEach(rel => {
        const relatedId = rel.source === activeId ? rel.target : rel.source;
        const relatedNews = newsData.news.find(n => n.id === relatedId);
        if (!relatedNews) return;

        const isGlobal = !relatedNews.location?.lat || !relatedNews.location?.lon || relatedNews.location.precision === 'global';
        const locLabel = isGlobal ? '🌎 Global' : `📍 ${relatedNews.location.city}`;

        const li = document.createElement('li');
        li.className = 'relation-item';
        li.innerHTML = `
            <div class="relation-item-top">
                <span class="relation-badge" style="background:${getRelationColor(rel.type)}18;color:${getRelationColor(rel.type)}">${locLabel}</span>
                <span class="relation-title-link" data-id="${relatedId}">${relatedNews.title}</span>
            </div>
            <p class="relation-desc">${rel.description}</p>
        `;

        li.querySelector('.relation-title-link').addEventListener('click', () => {
            map.stop();
            selectNews(relatedNews);
        });

        relsList.appendChild(li);
    });
}

// ── Boot ──
setupMobileToggle();
setupArticleReader();
init();
