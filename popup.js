/**
 * TEC Concursos - Popup Script
 */

const STORAGE_KEY = 'tec_priorizador_data';

document.addEventListener('DOMContentLoaded', async () => {
  const result = await chrome.storage.local.get([STORAGE_KEY]);
  const state = result[STORAGE_KEY] || {
    concursos: {},
    concursoAtivo: null
  };

  const selectConcurso = document.getElementById('popup-select-concurso');
  const totalPontosEl = document.getElementById('popup-total-pontos');
  const coberturaPercEl = document.getElementById('popup-cobertura-perc');
  const pontosRestantesEl = document.getElementById('popup-pontos-restantes');
  const progressFillEl = document.getElementById('popup-progress-fill');
  const listEl = document.getElementById('popup-prioridades-list');

  const concursosKeys = Object.keys(state.concursos || {});
  if (concursosKeys.length === 0) {
    listEl.innerHTML = '<div style="font-size: 12px; color: #64748b; padding: 12px; text-align: center;">Nenhum concurso configurado. Clique em "Configurar Edital".</div>';
    return;
  }

  // Popula seletor de concurso
  concursosKeys.forEach(key => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = state.concursos[key].nome;
    if (key === state.concursoAtivo) opt.selected = true;
    selectConcurso.appendChild(opt);
  });

  function renderizarDashboard(concursoKey) {
    const concurso = state.concursos[concursoKey];
    if (!concurso) return;

    let totalPontosProva = 0;
    let pontosConquistados = 0;
    const subpastas = [];

    (concurso.grupos || []).forEach(grp => {
      const ptsGrupo = (Number(grp.questoesProva) || 0) * (Number(grp.peso) || 1);
      totalPontosProva += ptsGrupo;

      (grp.subpastas || []).forEach(sub => {
        const prog = (concurso.subpastasProgresso && concurso.subpastasProgresso[sub]) || 0;
        const fator = Math.max(0.15, 1 - (prog / 100) * 0.85);
        const score = Math.round(ptsGrupo * fator * 10) / 10;
        
        // Pondera pontos conquistados nesta subpasta
        pontosConquistados += (ptsGrupo / Math.max(1, grp.subpastas.length)) * (prog / 100);

        subpastas.push({
          nome: sub,
          grupo: grp.nome,
          peso: grp.peso,
          questoes: grp.questoesProva,
          pontos: ptsGrupo,
          progresso: prog,
          score
        });
      });
    });

    // Atualiza cards de resumo
    const coberturaPerc = totalPontosProva > 0 ? Math.round((pontosConquistados / totalPontosProva) * 100) : 0;
    const ptsRestantes = Math.max(0, Math.round(totalPontosProva - pontosConquistados));

    totalPontosEl.textContent = totalPontosProva;
    coberturaPercEl.textContent = `${coberturaPerc}%`;
    pontosRestantesEl.textContent = `${ptsRestantes} pts`;
    progressFillEl.style.width = `${coberturaPerc}%`;

    // Ordena do maior score (mais crítico) para o menor
    subpastas.sort((a, b) => b.score - a.score);

    if (subpastas.length === 0) {
      listEl.innerHTML = '<div style="font-size: 12px; color: #64748b; padding: 12px; text-align: center;">Nenhuma matéria vinculada aos grupos do edital.</div>';
      return;
    }

    // Renderiza até os top 5 mais urgentes
    listEl.innerHTML = subpastas.slice(0, 5).map(item => {
      let badgeClass = 'popup-badge-media';
      let badgeLabel = 'P3 Média';

      if (item.progresso >= 95) {
        badgeClass = 'popup-badge-baixa';
        badgeLabel = 'Concluído';
      } else if (item.score >= 80) {
        badgeClass = 'popup-badge-critica';
        badgeLabel = '🔴 P1 Crítica';
      } else if (item.score >= 40) {
        badgeClass = 'popup-badge-alta';
        badgeLabel = '🟠 P2 Alta';
      }

      return `
        <div class="popup-list-item">
          <div class="popup-item-left">
            <div class="popup-item-name" title="${item.nome}">📁 ${item.nome}</div>
            <div class="popup-item-sub">
              <span>${item.pontos} pts na prova (${item.peso}x)</span>
              <span>•</span>
              <span style="font-weight: 600;">${item.progresso}% resolvido</span>
            </div>
          </div>
          <span class="popup-item-badge ${badgeClass}">${badgeLabel}</span>
        </div>
      `;
    }).join('');
  }

  // Render inicial
  renderizarDashboard(state.concursoAtivo || concursosKeys[0]);

  // Troca de concurso
  selectConcurso.addEventListener('change', (e) => {
    state.concursoAtivo = e.target.value;
    chrome.storage.local.set({ [STORAGE_KEY]: state });
    renderizarDashboard(e.target.value);
  });

  // Botão Abrir TEC Concursos
  document.getElementById('popup-open-tec-btn').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://www.tecconcursos.com.br/questoes/pastas' });
  });

  // Botão Configurar Edital
  document.getElementById('popup-open-config-btn').addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (activeTab && activeTab.url && activeTab.url.includes('tecconcursos.com.br')) {
        // Envia mensagem para o content script abrir o modal
        chrome.scripting?.executeScript({
          target: { tabId: activeTab.id },
          func: () => {
            const btn = document.getElementById('tec-prio-launcher');
            if (btn) btn.click();
          }
        });
        window.close();
      } else {
        chrome.tabs.create({ url: 'https://www.tecconcursos.com.br/questoes/pastas' });
      }
    });
  });
});
