/**
 * TEC Concursos - Priorizador Inteligente de Estudos
 * Content Script (Versão Aprimorada com Drag & Drop, Badges em Subpastas e Análise Automática de Índices)
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'tec_priorizador_data';

  // Estado padrão
  const DEFAULT_STATE = {
    concursos: {
      'CGU': {
        id: 'cgu',
        nome: 'CGU',
        pastaId: null,
        subpastasDisponiveis: [
          'Administração Pública e Fundamentos de Políticas Públicas',
          'ENGENHARIA, ARQUITETURA E GOVERNANÇA DE DADOS',
          'ESTADO, DEMOCRACIA, DIREITOS E CIÊNCIA POLÍTICA',
          'ESTATÍSTICA, PROGRAMAÇÃO E ANÁLISE DE DADOS',
          'ÉTICA PÚBLICA E RESPONSABILIDADE PROFISSIONAL',
          'FUNDAMENTOS DE AUDITORIA GOVERNAMENTAL E ATUAÇÃO INTEGRADA DA CGU',
          'FUNDAMENTOS DE EVIDÊNCIAS, DADOS E INTELIGÊNCIA ARTIFICIAL',
          'IA e Aprendizado de Máquina - CEBRASPE',
          'OPERAÇÃO, GOVERNANÇA E GESTÃO DE SOLUÇÕES DE DADOS E IA',
          'Sociedade Brasileira, Desigualdades e Desenvolvimento'
        ],
        grupos: [
          {
            id: 'grp_especificos',
            nome: 'Conhecimentos Específicos',
            questoesProva: 70,
            peso: 2.0,
            subpastas: [
              'Administração Pública e Fundamentos de Políticas Públicas',
              'ENGENHARIA, ARQUITETURA E GOVERNANÇA DE DADOS',
              'FUNDAMENTOS DE AUDITORIA GOVERNAMENTAL E ATUAÇÃO INTEGRADA DA CGU'
            ]
          },
          {
            id: 'grp_basicos',
            nome: 'Conhecimentos Básicos',
            questoesProva: 40,
            peso: 1.0,
            subpastas: [
              'ESTADO, DEMOCRACIA, DIREITOS E CIÊNCIA POLÍTICA',
              'ÉTICA PÚBLICA E RESPONSABILIDADE PROFISSIONAL',
              'Sociedade Brasileira, Desigualdades e Desenvolvimento'
            ]
          }
        ],
        subpastasProgresso: {},
        cadernosAnalise: {}
      }
    },
    concursoAtivo: 'CGU'
  };

  let appState = null;
  let observer = null;
  let lastUrl = location.href;
  let isAnalyzing = false;
  let ordemCriticidadeAtiva = false;
  let subpastasOrdemOriginal = [];

  // -------------------------------------------------------------
  // Inicialização e Armazenamento
  // -------------------------------------------------------------
  async function carregarEstado() {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        if (result && result[STORAGE_KEY]) {
          appState = result[STORAGE_KEY];
        } else {
          appState = JSON.parse(JSON.stringify(DEFAULT_STATE));
          salvarEstado();
        }
        resolve(appState);
      });
    });
  }

  function salvarEstado() {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEY]: appState }, () => {
        resolve();
      });
    });
  }

  function normalizarTexto(txt) {
    if (!txt) return '';
    return txt.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  }

  // -------------------------------------------------------------
  // Detecção de Contexto & Extração de Subpastas do DOM
  // -------------------------------------------------------------
  function extrairContextoAtual() {
    const contexto = {
      concurso: null,
      subpasta: null,
      caderno: null,
      abaAtiva: null,
      url: location.href
    };

    // 1. Breadcrumb
    const breadcrumbLinks = document.querySelectorAll('.breadcrumb a, .breadcrumb li, [class*="breadcrumb"] a, [class*="breadcrumb"] span, ol.breadcrumb li');
    if (breadcrumbLinks.length > 0) {
      const parts = Array.from(breadcrumbLinks)
        .map(el => el.textContent.trim())
        .filter(t => t && !/^(estudo|minhas pastas|home|início|voltar)$/i.test(t));

      if (parts.length >= 1) contexto.concurso = parts[0];
      if (parts.length >= 2) contexto.subpasta = parts[1];
      if (parts.length >= 3) contexto.caderno = parts[2];
    }

    // 2. Título da pasta no topo (ex.: "CGU 102 cadernos")
    if (!contexto.concurso) {
      const topTitle = document.querySelector('h1, h2, h3, .titulo-pasta, .nome-pasta');
      if (topTitle) {
        const text = topTitle.textContent.trim();
        if (text && !text.includes('Minhas pastas') && text.length < 50) {
          contexto.concurso = text.split('\n')[0].replace(/\d+\s*cadernos.*/i, '').trim();
        }
      }
    }

    // Detecta aba ativa
    const activeTab = document.querySelector('.nav-tabs li.active a, .tabs li.active a, [role="tab"][aria-selected="true"], ul.nav-tabs li.active');
    if (activeTab) {
      contexto.abaAtiva = activeTab.textContent.trim();
    }

    return contexto;
  }

  function obterConcursoAtivo() {
    if (!appState || !appState.concursos) return null;
    const ctx = extrairContextoAtual();
    if (ctx.concurso && appState.concursos[ctx.concurso]) {
      return appState.concursos[ctx.concurso];
    }
    return appState.concursos[appState.concursoAtivo] || Object.values(appState.concursos)[0];
  }

  function encontrarGrupoDaSubpasta(concurso, nomeSubpasta) {
    if (!concurso || !concurso.grupos || !nomeSubpasta) return null;
    const nomeNorm = normalizarTexto(nomeSubpasta);
    const palavrasAlvo = nomeNorm.split(/[^a-z0-9]+/).filter(w => w.length > 2);

    for (const grp of concurso.grupos) {
      for (const sub of (grp.subpastas || [])) {
        const subNorm = normalizarTexto(sub);
        if (subNorm === nomeNorm || nomeNorm.includes(subNorm) || subNorm.includes(nomeNorm)) {
          return grp;
        }

        // Fuzzy matching por palavras comuns relevantes
        const palavrasSub = subNorm.split(/[^a-z0-9]+/).filter(w => w.length > 2);
        if (palavrasSub.length > 0 && palavrasAlvo.length > 0) {
          const comuns = palavrasAlvo.filter(p => palavrasSub.includes(p));
          if (comuns.length >= Math.min(2, palavrasSub.length)) {
            return grp;
          }
        }
      }
    }
    return null;
  }

  // -------------------------------------------------------------
  // Cálculos de Prioridade
  // -------------------------------------------------------------
  function calcularPrioridade(concurso, nomeSubpasta, percResolvido = 0) {
    const grupo = encontrarGrupoDaSubpasta(concurso, nomeSubpasta);
    
    const peso = grupo ? Number(grupo.peso || 1) : 1;
    const questoesProva = grupo ? Number(grupo.questoesProva || 10) : 10;
    const totalPontosGrupo = questoesProva * peso;

    let totalPontosProva = 0;
    (concurso?.grupos || []).forEach(g => {
      totalPontosProva += (Number(g.questoesProva || 0) * Number(g.peso || 1));
    });
    if (totalPontosProva === 0) totalPontosProva = 100;

    const relevanciaProvaPerc = (totalPontosGrupo / totalPontosProva) * 100;
    const fatorUrgencia = Math.max(0.15, 1 - (percResolvido / 100) * 0.85);
    const score = Math.round(totalPontosGrupo * fatorUrgencia * 10) / 10;

    let nivel = 'baixa';
    let label = 'Baixa';
    let classe = 'tec-prio-badge-baixa';
    let icone = '🟢';

    if (percResolvido >= 95) {
      nivel = 'concluido';
      label = 'Concluído';
      classe = 'tec-prio-badge-concluido';
      icone = '✅';
    } else if (score >= 80 || (relevanciaProvaPerc >= 40 && percResolvido < 60)) {
      nivel = 'critica';
      label = 'P1: Crítica';
      classe = 'tec-prio-badge-critica';
      icone = '🔴';
    } else if (score >= 40 || (relevanciaProvaPerc >= 20 && percResolvido < 75)) {
      nivel = 'alta';
      label = 'P2: Alta';
      classe = 'tec-prio-badge-alta';
      icone = '🟠';
    } else if (score >= 20 || percResolvido < 85) {
      nivel = 'media';
      label = 'P3: Média';
      classe = 'tec-prio-badge-media';
      icone = '🟡';
    }

    return {
      grupo,
      peso,
      questoesProva,
      totalPontosGrupo,
      relevanciaProvaPerc: Math.round(relevanciaProvaPerc),
      percResolvido: Math.round(percResolvido),
      score,
      nivel,
      label,
      classe,
      icone
    };
  }

  // -------------------------------------------------------------
  // REQUISITO 1: INJEÇÃO DOS BADGES NAS SUBPASTAS E CADERNOS
  // -------------------------------------------------------------
  function rastrearEInjetarBadgesSubpastas() {
    const concurso = obterConcursoAtivo();
    if (!concurso) return;

    if (!concurso.subpastasDisponiveis) concurso.subpastasDisponiveis = [];

    // Estratégia 1: Procura elementos com link "(Expandir)" ou "(Retrair)" conforme screenshot do usuário
    const expandirLinks = Array.from(document.querySelectorAll('a, button, span')).filter(el => {
      const t = el.textContent.trim();
      return t === '(Expandir)' || t === '(Retrair)' || t.includes('Expandir');
    });

    expandirLinks.forEach(expEl => {
      // O elemento pai ou a linha correspondente
      const row = expEl.closest('li, tr, .row, div[class*="item"], div[class*="pasta"]') || expEl.parentElement;
      if (!row || row.querySelector('.tec-prio-row-wrapper')) return;

      // Extrai o nome da subpasta (geralmente texto imediatamente anterior ao "(Expandir)")
      let nomeSubpasta = '';
      if (expEl.previousSibling && expEl.previousSibling.textContent) {
        nomeSubpasta = expEl.previousSibling.textContent.trim();
      }
      if (!nomeSubpasta || nomeSubpasta.length < 3) {
        // Tenta pegar o texto dos irmãos anteriores
        const parentText = expEl.parentElement.textContent;
        nomeSubpasta = parentText.split('(Expandir)')[0].split('(Retrair)')[0].trim();
      }

      // Limpa ícones ou números
      nomeSubpasta = nomeSubpasta.replace(/^[\s\uFEFF\xA0\u200B\uF000-\uF8FF]+/, '').trim();
      if (!nomeSubpasta || nomeSubpasta.length < 2) return;

      // Registra a subpasta nas disponíveis do concurso se ainda não constar
      if (!concurso.subpastasDisponiveis.includes(nomeSubpasta)) {
        concurso.subpastasDisponiveis.push(nomeSubpasta);
        salvarEstado();
      }

      // Cria container de badges
      const wrapper = document.createElement('span');
      wrapper.className = 'tec-prio-row-wrapper';

      const grupo = encontrarGrupoDaSubpasta(concurso, nomeSubpasta);
      if (grupo) {
        const progresso = (concurso.subpastasProgresso && concurso.subpastasProgresso[nomeSubpasta]) || 0;
        const prio = calcularPrioridade(concurso, nomeSubpasta, progresso);

        wrapper.innerHTML = `
          <span class="tec-prio-badge ${prio.classe}" title="Prioridade calculada com base no edital e progresso">
            ${prio.icone} ${prio.label} (${prio.totalPontosGrupo} pts)
          </span>
          <span class="tec-prio-group-tag" title="Grupo da prova">🏷️ ${grupo.nome}</span>
          <span class="tec-prio-mini-progress" title="Progresso já resolvido: ${prio.percResolvido}%">
            <span class="tec-prio-mini-bar-bg">
              <span class="tec-prio-mini-bar-fill" style="width: ${prio.percResolvido}%;"></span>
            </span>
            <span>${prio.percResolvido}%</span>
          </span>
        `;
      } else {
        // Subpasta ainda não vinculada a nenhum grupo
        wrapper.innerHTML = `
          <span class="tec-prio-badge tec-prio-badge-unassigned" title="Clique para vincular esta subpasta a um grupo do edital">
            ➕ Sem Grupo (Definir)
          </span>
        `;
        wrapper.querySelector('.tec-prio-badge-unassigned')?.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          abrirModalPriorizador();
        });
      }

      // Insere o badge imediatamente após o link de expandir
      if (expEl.nextSibling) {
        expEl.parentNode.insertBefore(wrapper, expEl.nextSibling);
      } else {
        expEl.parentNode.appendChild(wrapper);
      }
    });

    // Estratégia 2: Links diretos de cadernos na página
    const cadernoLinks = document.querySelectorAll('a[href*="/cadernos/"]');
    cadernoLinks.forEach(link => {
      if (link.closest('.tec-prio-row-wrapper') || link.querySelector('.tec-prio-badge') || link.parentElement?.querySelector('.tec-prio-row-wrapper')) return;

      const nomeCaderno = link.textContent.trim();
      if (!nomeCaderno || nomeCaderno.length < 3) return;

      const grupo = encontrarGrupoDaSubpasta(concurso, nomeCaderno);
      if (grupo) {
        const progresso = (concurso.subpastasProgresso && concurso.subpastasProgresso[nomeCaderno]) || 0;
        const prio = calcularPrioridade(concurso, nomeCaderno, progresso);

        const badgeWrapper = document.createElement('span');
        badgeWrapper.className = 'tec-prio-row-wrapper';
        badgeWrapper.innerHTML = `
          <span class="tec-prio-badge ${prio.classe}">
            ${prio.icone} ${prio.label}
          </span>
        `;
        link.parentNode.insertBefore(badgeWrapper, link.nextSibling);
      }
    });
  }

  // -------------------------------------------------------------
  // ORDENAÇÃO NA PÁGINA (SUBPASTAS POR CRITICIDADE & CADERNOS POR TEMAS)
  // -------------------------------------------------------------

  /**
   * Encontra o elemento que representa a LINHA COMPLETA da subpasta,
   * garantindo que abranja o ícone de pasta, título, quantidade de cadernos e links de ação.
   */
  function encontrarLinhaCompletaSubpasta(expEl) {
    if (!expEl) return null;

    let curr = expEl.parentElement;
    let melhorCandidato = null;

    while (curr && curr !== document.body) {
      const parent = curr.parentElement;
      if (!parent) break;

      // Conta quantos links de expandir/retrair existem no curr e no parent
      const expandirNoCurr = Array.from(curr.querySelectorAll('a, button, span')).filter(el => {
        const t = el.textContent.trim();
        return t === '(Expandir)' || t === '(Retrair)';
      });

      const expandirNoParent = Array.from(parent.querySelectorAll('a, button, span')).filter(el => {
        const t = el.textContent.trim();
        return t === '(Expandir)' || t === '(Retrair)';
      });

      // Se o elemento atual tem 1 expandir, mas o pai tem múltiplos (> 1),
      // curr é EXATAMENTE a linha individual da subpasta na lista!
      if (expandirNoCurr.length === 1 && expandirNoParent.length > 1) {
        melhorCandidato = curr;
        break;
      }

      // Se for uma tag de linha clássica
      if (curr.tagName === 'TR' || curr.tagName === 'LI') {
        melhorCandidato = curr;
        break;
      }

      // Se contiver a contagem de cadernos e botão de desempenho
      const txt = curr.textContent || '';
      if (txt.includes('cadernos') && (txt.includes('Carregar desempenho') || txt.includes('desempenho'))) {
        melhorCandidato = curr;
        if (expandirNoParent.length > 1) {
          break;
        }
      }

      curr = parent;
    }

    return melhorCandidato || expEl.closest('tr, li, .row, div[class*="item"]') || expEl.parentElement;
  }

  function reordenarSubpastasPorCriticidade(ativar = true) {
    const concurso = obterConcursoAtivo();
    if (!concurso) return;

    // Encontra os links de expandir para identificar cada subpasta
    const expandirLinks = Array.from(document.querySelectorAll('a, button, span')).filter(el => {
      const t = el.textContent.trim();
      return (t === '(Expandir)' || t === '(Retrair)') && !el.closest('#tec-prio-modal');
    });

    if (expandirLinks.length === 0) return;

    const subpastaRows = [];
    let parentContainer = null;

    expandirLinks.forEach(expEl => {
      // Localiza a linha completa (nunca apenas uma célula interna)
      const row = encontrarLinhaCompletaSubpasta(expEl);
      if (!row) return;

      if (!parentContainer && row.parentElement) {
        parentContainer = row.parentElement;
      }

      let nomeSubpasta = '';
      if (expEl.previousSibling && expEl.previousSibling.textContent) {
        nomeSubpasta = expEl.previousSibling.textContent.trim();
      }
      if (!nomeSubpasta || nomeSubpasta.length < 3) {
        const parentText = expEl.parentElement ? expEl.parentElement.textContent : '';
        nomeSubpasta = parentText.split('(Expandir)')[0].split('(Retrair)')[0].trim();
      }
      if (!nomeSubpasta || nomeSubpasta.length < 3) {
        const rowText = row.textContent || '';
        nomeSubpasta = rowText.split('(Expandir)')[0].split('(Retrair)')[0].trim();
      }
      nomeSubpasta = nomeSubpasta.replace(/^[\s\uFEFF\xA0\u200B\uF000-\uF8FF]+/, '').trim();
      nomeSubpasta = nomeSubpasta.replace(/^#\d+\s*/, '').trim();

      // Extrai quantidade de cadernos da linha
      let qtdCadernos = 0;
      const cadMatch = (row.textContent || '').match(/(\d+)\s+cadernos/i);
      if (cadMatch) {
        qtdCadernos = parseInt(cadMatch[1], 10);
      }

      const progresso = (concurso.subpastasProgresso && concurso.subpastasProgresso[nomeSubpasta]) || 0;
      const prio = calcularPrioridade(concurso, nomeSubpasta, progresso);

      // Identifica container filho com cadernos (se já estiver expandido no DOM)
      let containerFilho = null;
      if (row.nextElementSibling && (
        row.nextElementSibling.classList.contains('subpasta-itens') ||
        row.nextElementSibling.querySelector('a[href*="/cadernos/"]') ||
        row.nextElementSibling.getAttribute('ng-show')?.includes('expandido')
      )) {
        containerFilho = row.nextElementSibling;
      }

      if (!subpastaRows.some(s => s.row === row)) {
        subpastaRows.push({
          row,
          containerFilho,
          nomeSubpasta,
          qtdCadernos,
          prio,
          ordemOriginalIndex: subpastaRows.length
        });
      }
    });

    if (subpastaRows.length === 0 || !parentContainer) return;

    if (subpastasOrdemOriginal.length === 0 || subpastasOrdemOriginal.length !== subpastaRows.length) {
      subpastasOrdemOriginal = [...subpastaRows];
    }

    if (ativar) {
      ordemCriticidadeAtiva = true;

      // Ordena por critérios estritos e determinísticos
      subpastaRows.sort((a, b) => {
        // 1. Maior score de prioridade
        if (b.prio.score !== a.prio.score) {
          return b.prio.score - a.prio.score;
        }
        // 2. Quem tem grupo configurado primeiro
        const gA = a.prio.grupo ? 1 : 0;
        const gB = b.prio.grupo ? 1 : 0;
        if (gB !== gA) return gB - gA;

        // 3. Menor porcentagem resolvida primeiro
        if (a.prio.percResolvido !== b.prio.percResolvido) {
          return a.prio.percResolvido - b.prio.percResolvido;
        }
        // 4. Quantidade de cadernos (maior primeiro)
        if (b.qtdCadernos !== a.qtdCadernos) {
          return b.qtdCadernos - a.qtdCadernos;
        }
        // 5. Ordem alfabética
        return a.nomeSubpasta.localeCompare(b.nomeSubpasta);
      });

      // Pausa o observer durante as manipulações no DOM para evitar loops e repaints
      if (observer) observer.disconnect();

      // Reanexa os nós inteiros no parentContainer na nova ordem
      subpastaRows.forEach((item, index) => {
        parentContainer.appendChild(item.row);
        if (item.containerFilho) {
          parentContainer.appendChild(item.containerFilho);
        }

        // Adiciona ou atualiza badge de ranking (#1, #2, #3...)
        let rankBadge = item.row.querySelector('.tec-prio-rank-pill');
        if (!rankBadge) {
          rankBadge = document.createElement('span');
          rankBadge.className = 'tec-prio-rank-pill';
          const target = item.row.querySelector('.tec-prio-row-wrapper') || item.row.querySelector('a, button, span') || item.row;
          target.prepend(rankBadge);
        }
        rankBadge.innerHTML = `#${index + 1}`;
        rankBadge.style.display = 'inline-block';

        // Ordena também os cadernos dentro desta subpasta pelos temas mais relevantes
        reordenarCadernosDaSubpasta(item.row, item.containerFilho, item.nomeSubpasta);
      });

      if (observer) {
        observer.observe(document.body, { childList: true, subtree: true });
      }
    } else {
      ordemCriticidadeAtiva = false;

      if (observer) observer.disconnect();

      // Restaura ordem original
      subpastasOrdemOriginal.forEach(item => {
        parentContainer.appendChild(item.row);
        if (item.containerFilho) {
          parentContainer.appendChild(item.containerFilho);
        }
        const rankBadge = item.row.querySelector('.tec-prio-rank-pill');
        if (rankBadge) rankBadge.style.display = 'none';
      });

      if (observer) {
        observer.observe(document.body, { childList: true, subtree: true });
      }
    }
  }

  function reordenarCadernosDaSubpasta(row, containerFilho, nomeSubpasta) {
    const container = containerFilho || row;
    if (!container) return;

    const concurso = obterConcursoAtivo();
    if (!concurso) return;

    // Procura cadernos no container
    const cadernoLinks = Array.from(container.querySelectorAll('a[href*="/cadernos/"]'));
    if (cadernoLinks.length <= 1) return;

    const cadernos = [];
    cadernoLinks.forEach(link => {
      // Sobe até a linha completa do caderno
      let cadernoRow = link;
      while (cadernoRow && cadernoRow.parentElement && cadernoRow.parentElement !== container) {
        if (cadernoRow.parentElement.querySelectorAll('a[href*="/cadernos/"]').length > 1) {
          break;
        }
        cadernoRow = cadernoRow.parentElement;
      }

      const nomeCaderno = link.textContent.trim();
      const analise = (concurso.cadernosAnalise && concurso.cadernosAnalise[nomeCaderno]) || null;
      let relevanciaScore = 0;
      let topAssuntoNome = '';
      let topAssuntoPerc = 0;

      if (analise && analise.topAssuntos && analise.topAssuntos.length > 0) {
        topAssuntoNome = analise.topAssuntos[0].nome;
        topAssuntoPerc = analise.topAssuntos[0].perc;

        const totalQ = analise.totalQuestoes || 1;
        const resolvQ = analise.questoesResolvidas || 0;
        const percResolv = Math.min(100, Math.round((resolvQ / totalQ) * 100));

        // Quanto maior a incidência do tema e menor a % resolvida, maior a relevância para estudar agora
        relevanciaScore = topAssuntoPerc * Math.max(0.2, 1 - (percResolv / 100) * 0.8);
      } else {
        relevanciaScore = 1;
      }

      if (!cadernos.some(c => c.cadernoRow === cadernoRow)) {
        cadernos.push({
          link,
          cadernoRow,
          nomeCaderno,
          relevanciaScore,
          topAssuntoNome,
          topAssuntoPerc
        });
      }
    });

    if (cadernos.length <= 1) return;

    // Ordena por relevância do tema decrescente
    cadernos.sort((a, b) => b.relevanciaScore - a.relevanciaScore);

    const parent = cadernos[0].cadernoRow.parentElement;
    if (!parent) return;

    cadernos.forEach((c, idx) => {
      parent.appendChild(c.cadernoRow);

      let relBadge = c.cadernoRow.querySelector('.tec-prio-tema-relevante-badge');
      if (c.topAssuntoPerc > 0) {
        if (!relBadge) {
          relBadge = document.createElement('span');
          relBadge.className = 'tec-prio-tema-relevante-badge';
          c.link.parentNode.insertBefore(relBadge, c.link.nextSibling);
        }
        if (idx === 0) {
          relBadge.className = 'tec-prio-tema-relevante-badge tec-prio-tema-top';
          relBadge.innerHTML = `🔥 Top Tema: ${c.topAssuntoNome} (${c.topAssuntoPerc}%)`;
        } else {
          relBadge.className = 'tec-prio-tema-relevante-badge';
          relBadge.innerHTML = `📌 ${c.topAssuntoNome} (${c.topAssuntoPerc}%)`;
        }
      }
    });
  }

  function injetarBotaoOrdenacaoNaPagina() {
    // 1. Procura o link específico de "Último acesso" ou "Criação do caderno" ou "Nome"
    const linksOrdenacao = Array.from(document.querySelectorAll('a, span')).filter(el => {
      const t = el.textContent.trim();
      return (t === 'Último acesso' || t === 'Criação do caderno' || t === 'Nome') &&
             el.parentElement && el.parentElement.textContent.includes('Ordenar por:') &&
             !el.closest('#tec-prio-modal');
    });

    let targetEl = null;
    if (linksOrdenacao.length > 0) {
      // Pega o último link (ex.: "Último acesso") e insere logo após ele no mesmo container inline
      const ultimo = linksOrdenacao[linksOrdenacao.length - 1];
      targetEl = ultimo.parentElement;
    } else {
      // Fallback: busca elemento pequeno com 'Ordenar por:'
      const elements = Array.from(document.querySelectorAll('div, p, span')).filter(el => {
        return el.textContent.includes('Ordenar por:') && 
               el.textContent.includes('Nome') &&
               !el.closest('#tec-prio-modal') &&
               el.children.length > 0 &&
               el.children.length < 8 &&
               el.clientHeight < 80;
      });
      if (elements.length > 0) {
        elements.sort((a, b) => a.textContent.length - b.textContent.length);
        targetEl = elements[0];
      }
    }

    if (!targetEl) return;

    let containerBtn = document.getElementById('tec-prio-container-ordenacao');
    let linkBtn = document.getElementById('tec-prio-btn-ordenar-criticidade');

    if (!containerBtn || !linkBtn || !targetEl.contains(containerBtn)) {
      if (containerBtn && !targetEl.contains(containerBtn)) {
        containerBtn.remove();
      }

      containerBtn = document.createElement('span');
      containerBtn.id = 'tec-prio-container-ordenacao';
      containerBtn.style.marginLeft = '8px';
      containerBtn.innerHTML = `
        • <a href="javascript:void(0)" id="tec-prio-btn-ordenar-criticidade" class="tec-prio-link-ordenar ${ordemCriticidadeAtiva ? 'tec-prio-link-ordenar-ativo' : ''}" title="Reorganiza as subpastas por criticidade do edital e cadernos pelos temas mais frequentes">
          🎯 <strong>Criticidade do Edital</strong> <span class="tec-prio-tag-ordem-status">${ordemCriticidadeAtiva ? '(Ativo ✓)' : ''}</span>
        </a>
      `;
      targetEl.appendChild(containerBtn);

      linkBtn = document.getElementById('tec-prio-btn-ordenar-criticidade');
      linkBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        ordemCriticidadeAtiva = !ordemCriticidadeAtiva;
        reordenarSubpastasPorCriticidade(ordemCriticidadeAtiva);
        atualizarBotaoOrdenacaoUI();
      });
    } else {
      // O botão já existe no lugar certo: apenas atualiza a interface sem recriar o nó
      atualizarBotaoOrdenacaoUI();
    }
  }

  function atualizarBotaoOrdenacaoUI() {
    const linkBtn = document.getElementById('tec-prio-btn-ordenar-criticidade');
    if (!linkBtn) return;
    if (ordemCriticidadeAtiva) {
      linkBtn.classList.add('tec-prio-link-ordenar-ativo');
      const tag = linkBtn.querySelector('.tec-prio-tag-ordem-status');
      if (tag) tag.textContent = '(Ativo ✓)';
    } else {
      linkBtn.classList.remove('tec-prio-link-ordenar-ativo');
      const tag = linkBtn.querySelector('.tec-prio-tag-ordem-status');
      if (tag) tag.textContent = '';
    }
  }

  // -------------------------------------------------------------
  // REQUISITO 2: ANÁLISE AUTOMÁTICA DE ÍNDICES E PROGRESSO
  // -------------------------------------------------------------
  async function analisarTodosOsIndicesAutomaticamente() {
    if (isAnalyzing) return;
    isAnalyzing = true;

    const concurso = obterConcursoAtivo();
    if (!concurso) {
      alert('Nenhum concurso ativo selecionado.');
      isAnalyzing = false;
      return;
    }

    // Cria overlay de progresso
    let overlay = document.getElementById('tec-prio-progress-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'tec-prio-progress-overlay';
      overlay.className = 'tec-prio-progress-overlay';
      overlay.innerHTML = `
        <div class="tec-prio-progress-box">
          <div class="tec-prio-progress-title">
            <span>⚡ Análise Automática de Índices e Desempenho</span>
          </div>
          <div class="tec-prio-progress-bar-container">
            <div class="tec-prio-progress-bar-fill" id="tec-prio-prog-fill" style="width: 0%;"></div>
          </div>
          <div class="tec-prio-progress-status" id="tec-prio-prog-status">
            Iniciando mapeamento de cadernos...
          </div>
          <div class="tec-prio-progress-details" id="tec-prio-prog-details"></div>
          <div style="display: flex; justify-content: center;">
            <button class="tec-prio-btn tec-prio-btn-secondary" id="tec-prio-cancelar-analise-btn">
              Cancelar
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    }

    const fillEl = document.getElementById('tec-prio-prog-fill');
    const statusEl = document.getElementById('tec-prio-prog-status');
    const detailsEl = document.getElementById('tec-prio-prog-details');
    let cancelou = false;

    document.getElementById('tec-prio-cancelar-analise-btn')?.addEventListener('click', () => {
      cancelou = true;
      overlay.remove();
      isAnalyzing = false;
    });

    const log = (msg) => {
      if (detailsEl) {
        detailsEl.innerHTML = `<div>• ${msg}</div>` + detailsEl.innerHTML;
      }
    };

    try {
      // 1. Busca lista de pastas do usuário
      statusEl.textContent = 'Buscando pastas no TEC Concursos...';
      const respPastas = await fetch('/api/pastas-cadernos', { credentials: 'include' });
      if (!respPastas.ok) throw new Error('Não foi possível acessar /api/pastas-cadernos');
      const dataPastas = await respPastas.json();
      const pastas = dataPastas.pastas || [];

      const nomeAlvo = normalizarTexto(concurso.nome);
      const pastaHit = pastas.find(p => normalizarTexto(p.nome) === nomeAlvo || normalizarTexto(p.nome).includes(nomeAlvo));

      if (!pastaHit) {
        throw new Error(`Pasta "${concurso.nome}" não localizada na sua conta do TEC.`);
      }

      log(`Pasta "${pastaHit.nome}" localizada (ID: ${pastaHit.id})`);

      // 2. Busca progresso geral da pasta
      try {
        const respProg = await fetch(`/api/pastas-cadernos/${pastaHit.id}/progresso`, { credentials: 'include' });
        if (respProg.ok) {
          const dataProg = await respProg.json();
          const p = dataProg.progresso;
          if (p && p.numeroTotalQuestoes) {
            log(`Progresso da pasta: ${p.numeroQuestoesResolvidas}/${p.numeroTotalQuestoes} questões resolvidas (${Math.round((p.numeroQuestoesResolvidas / p.numeroTotalQuestoes) * 100)}%)`);
          }
        }
      } catch (e) {}

      // 3. Busca lista de itens e subpastas
      statusEl.textContent = 'Buscando subpastas e cadernos...';
      const respItens = await fetch(`/api/pastas-cadernos/${pastaHit.id}/itens`, { credentials: 'include' });
      const dataItens = await respItens.json();
      const itens = dataItens.itens || [];

      // Mapeia cadernos a analisar
      const cadernosParaAnalisar = [];

      for (const item of itens) {
        if (item.subpasta) {
          // É uma subpasta: busca os cadernos dela
          log(`Buscando cadernos da subpasta: ${item.nome}`);
          const respSubItens = await fetch(`/api/pastas-cadernos/${pastaHit.id}/subpastas/${item.id}/itens`, { credentials: 'include' });
          if (respSubItens.ok) {
            const dataSub = await respSubItens.json();
            (dataSub.itens || []).forEach(cad => {
              cadernosParaAnalisar.push({
                cadernoId: cad.id,
                cadernoNome: cad.nome,
                subpastaNome: item.nome,
                qtdQuestoes: cad.quantidadeItens || 0
              });
            });
          }
        } else {
          // É um caderno na raiz da pasta
          cadernosParaAnalisar.push({
            cadernoId: item.id,
            cadernoNome: item.nome,
            subpastaNome: 'Geral',
            qtdQuestoes: item.quantidadeItens || 0
          });
        }
      }

      log(`Total de cadernos para análise: ${cadernosParaAnalisar.length}`);

      if (cadernosParaAnalisar.length === 0) {
        statusEl.textContent = 'Nenhum caderno encontrado para análise.';
        setTimeout(() => overlay.remove(), 2000);
        isAnalyzing = false;
        return;
      }

      // 4. Itera em cada caderno obtendo o Índice e Resumo
      if (!concurso.cadernosAnalise) concurso.cadernosAnalise = {};
      if (!concurso.subpastasProgresso) concurso.subpastasProgresso = {};

      let processados = 0;
      for (const cad of cadernosParaAnalisar) {
        if (cancelou) break;

        processados++;
        const percBar = Math.round((processados / cadernosParaAnalisar.length) * 100);
        fillEl.style.width = `${percBar}%`;
        statusEl.textContent = `Analisando caderno ${processados} de ${cadernosParaAnalisar.length}: "${cad.cadernoNome}"...`;

        try {
          // A. Obtém índice via API
          let assuntosTree = [];
          const respIndice = await fetch(`/api/cadernos/${cad.cadernoId}/carregar-indice?orderBy=MATERIA`, { credentials: 'include' });
          if (respIndice.ok) {
            assuntosTree = await respIndice.json();
          }

          // B. Obtém resumo/desempenho
          let totalQuestoes = cad.qtdQuestoes || 0;
          let questoesResolvidas = 0;

          const respResumo = await fetch(`/api/cadernos/${cad.cadernoId}/resumo`, { credentials: 'include' });
          if (respResumo.ok) {
            const dataResumo = await respResumo.json();
            if (dataResumo.numeroTotalQuestoes) totalQuestoes = dataResumo.numeroTotalQuestoes;
            if (dataResumo.numeroQuestoesResolvidas) questoesResolvidas = dataResumo.numeroQuestoesResolvidas;
          }

          // Extrai tópicos mais cobrados do índice
          const topTopics = extrairTopAssuntosDaArvore(assuntosTree, totalQuestoes);

          concurso.cadernosAnalise[cad.cadernoNome] = {
            cadernoId: cad.cadernoId,
            subpasta: cad.subpastaNome,
            totalQuestoes,
            questoesResolvidas,
            dataAnalise: new Date().toLocaleDateString('pt-BR'),
            topAssuntos: topTopics
          };

          // Atualiza progresso da subpasta
          const percResolvido = totalQuestoes > 0 ? Math.round((questoesResolvidas / totalQuestoes) * 100) : 0;
          concurso.subpastasProgresso[cad.subpastaNome] = percResolvido;

          log(`✓ ${cad.cadernoNome}: ${questoesResolvidas}/${totalQuestoes} resolvidas (${percResolvido}%)`);
        } catch (errCaderno) {
          log(`⚠️ Erro ao analisar ${cad.cadernoNome}: ${errCaderno.message}`);
        }

        // Delay amigável para não sobrecarregar
        await new Promise(r => setTimeout(r, 200));
      }

      await salvarEstado();
      statusEl.textContent = '🎉 Análise concluída com sucesso!';
      fillEl.style.width = '100%';
      log('Todas as subpastas e cadernos foram atualizados!');

      setTimeout(() => {
        overlay.remove();
        isAnalyzing = false;
        // Atualiza os badges na tela
        rastrearEInjetarBadgesSubpastas();
      }, 1500);

    } catch (err) {
      console.error(err);
      statusEl.textContent = `Erro: ${err.message}`;
      log(`Falha: ${err.message}`);
      isAnalyzing = false;
    }
  }

  function extrairTopAssuntosDaArvore(nos, totalCaderno = 1) {
    const lista = [];

    function percorrer(node) {
      if (!node) return;
      const qtd = Number(node.contagem || node.numeroQuestoes || 0);
      const nome = node.nome || node.descricao || '';

      if (qtd > 0 && nome) {
        const perc = totalCaderno > 0 ? Math.round((qtd / totalCaderno) * 1000) / 10 : 0;
        lista.push({ nome, qtd, perc });
      }

      if (Array.isArray(node.subTree)) {
        node.subTree.forEach(percorrer);
      }
    }

    if (Array.isArray(nos)) nos.forEach(percorrer);
    
    // Ordena pelo maior volume
    return lista
      .filter(i => i.perc < 99) // Remove a matéria raiz que tem 100%
      .sort((a, b) => b.qtd - a.qtd)
      .slice(0, 5);
  }

  // -------------------------------------------------------------
  // REQUISITO 3: VINCULAÇÃO DINÂMICA DE SUBPASTAS (DRAG & DROP)
  // -------------------------------------------------------------
  function renderizarSecaoSubpastasEGrupos() {
    const concurso = obterConcursoAtivo();
    if (!concurso) return;

    if (!concurso.subpastasDisponiveis) concurso.subpastasDisponiveis = [];

    // Coleta subpastas já vinculadas a algum grupo
    const subpastasVinculadas = new Set();
    (concurso.grupos || []).forEach(grp => {
      (grp.subpastas || []).forEach(sub => subpastasVinculadas.add(sub));
    });

    // Subpastas não vinculadas
    const naoVinculadas = concurso.subpastasDisponiveis.filter(s => !subpastasVinculadas.has(s));

    // 1. Renderiza o Pool de Subpastas Não Vinculadas
    const poolContainer = document.getElementById('tec-prio-unassigned-pool');
    const badgeQtdNaoVinc = document.getElementById('tec-prio-unassigned-count');
    
    if (badgeQtdNaoVinc) badgeQtdNaoVinc.textContent = naoVinculadas.length;

    if (poolContainer) {
      poolContainer.innerHTML = '';

      if (naoVinculadas.length === 0) {
        poolContainer.innerHTML = '<div class="tec-prio-dropzone-empty">Todas as subpastas encontradas já foram vinculadas aos grupos! 🎉</div>';
      } else {
        naoVinculadas.forEach(sub => {
          const chip = criarChipSubpasta(sub, null);
          poolContainer.appendChild(chip);
        });
      }

      // Configura zona de soltura para o pool (arrastar de volta para desvincular)
      configurarDropZone(poolContainer, null);
    }

    // 2. Renderiza os Grupos do Edital
    const gruposContainer = document.getElementById('tec-prio-lista-grupos');
    if (!gruposContainer) return;

    if (!concurso.grupos || concurso.grupos.length === 0) {
      gruposContainer.innerHTML = '<div style="color: #64748b; font-size: 13px; padding: 12px; background: #f8fafc; border-radius: 6px;">Nenhum grupo configurado ainda. Adicione acima os grupos da sua prova (ex: Conhecimentos Básicos, Específicos).</div>';
      return;
    }

    gruposContainer.innerHTML = concurso.grupos.map((grp, gIdx) => {
      const pontosTotal = grp.questoesProva * grp.peso;
      return `
        <div class="tec-prio-group-card" data-group-index="${gIdx}">
          <div class="tec-prio-group-header">
            <div class="tec-prio-group-title">
              <span>🏷️ ${grp.nome}</span>
              <span class="tec-prio-badge tec-prio-badge-alta" style="margin: 0;">
                ${grp.questoesProva} questões × peso ${grp.peso} = <strong>${pontosTotal} pontos</strong>
              </span>
            </div>
            <div style="display: flex; gap: 8px;">
              <button class="tec-prio-btn tec-prio-btn-secondary" style="font-size: 11px; padding: 4px 8px;" data-bulk-add="${gIdx}" title="Adicionar várias subpastas de uma vez">
                ➕ Adicionar em Massa
              </button>
              <button class="tec-prio-btn tec-prio-btn-danger" style="font-size: 11px; padding: 4px 8px;" data-remove-grp="${gIdx}">
                Excluir
              </button>
            </div>
          </div>

          <div style="font-size: 12px; color: #475569; margin-top: 4px;">
            Arraste subpastas aqui ou use os seletores:
          </div>

          <!-- Zona de Soltura do Grupo -->
          <div class="tec-prio-dropzone" id="tec-prio-dropzone-${gIdx}" data-group-index="${gIdx}">
            <!-- Chips inseridos via JS -->
          </div>
        </div>
      `;
    }).join('');

    // Preenche as dropzones de cada grupo e anexa eventos
    concurso.grupos.forEach((grp, gIdx) => {
      const dropzone = document.getElementById(`tec-prio-dropzone-${gIdx}`);
      if (!dropzone) return;

      if (!grp.subpastas || grp.subpastas.length === 0) {
        dropzone.innerHTML = '<div class="tec-prio-dropzone-empty">Arraste uma subpasta para cá para vinculá-la a este grupo</div>';
      } else {
        grp.subpastas.forEach(sub => {
          const chip = criarChipSubpasta(sub, gIdx);
          dropzone.appendChild(chip);
        });
      }

      configurarDropZone(dropzone, gIdx);
    });

    // Eventos de excluir grupo
    gruposContainer.querySelectorAll('[data-remove-grp]').forEach(btn => {
      btn.addEventListener('click', () => {
        const gIdx = parseInt(btn.getAttribute('data-remove-grp'), 10);
        if (confirm(`Deseja excluir o grupo "${concurso.grupos[gIdx].nome}"? As subpastas voltarão para o pool disponível.`)) {
          concurso.grupos.splice(gIdx, 1);
          salvarEstado().then(() => {
            renderizarSecaoSubpastasEGrupos();
            renderizarMatrizPrioridades();
            rastrearEInjetarBadgesSubpastas();
          });
        }
      });
    });

    // Evento de adição em massa
    gruposContainer.querySelectorAll('[data-bulk-add]').forEach(btn => {
      btn.addEventListener('click', () => {
        const gIdx = parseInt(btn.getAttribute('data-bulk-add'), 10);
        abrirDialogAdicaoEmMassa(gIdx);
      });
    });
  }

  // Cria o elemento visual de uma subpasta com suporte a Drag & Drop e Dropdown de Ações
  function criarChipSubpasta(nomeSubpasta, groupIndex = null) {
    const chip = document.createElement('div');
    chip.className = 'tec-prio-draggable-chip';
    chip.setAttribute('draggable', 'true');
    chip.setAttribute('data-subpasta', nomeSubpasta);

    const concurso = obterConcursoAtivo();
    const outrosGrupos = (concurso.grupos || []).map((g, idx) => ({ nome: g.nome, idx })).filter(g => g.idx !== groupIndex);

    let selectOptionsHtml = '<option value="">Mover para...</option>';
    if (groupIndex !== null) {
      selectOptionsHtml += '<option value="unassign">✖ Desvincular</option>';
    }
    outrosGrupos.forEach(og => {
      selectOptionsHtml += `<option value="${og.idx}">${og.nome}</option>`;
    });

    chip.innerHTML = `
      <span>📁 ${nomeSubpasta}</span>
      <div class="tec-prio-chip-actions">
        <select class="tec-prio-chip-btn tec-prio-chip-select" title="Mover rapidamente para outro grupo">
          ${selectOptionsHtml}
        </select>
        ${groupIndex !== null ? `<span class="tec-prio-chip-btn tec-prio-chip-remove" title="Remover deste grupo">&times;</span>` : ''}
      </div>
    `;

    // Drag start
    chip.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', JSON.stringify({
        subpasta: nomeSubpasta,
        fromGroup: groupIndex
      }));
      chip.classList.add('tec-prio-dragging');
    });

    chip.addEventListener('dragend', () => {
      chip.classList.remove('tec-prio-dragging');
    });

    // Dropdown change
    chip.querySelector('.tec-prio-chip-select')?.addEventListener('change', (e) => {
      const val = e.target.value;
      if (!val) return;

      moverSubpasta(nomeSubpasta, groupIndex, val === 'unassign' ? null : parseInt(val, 10));
    });

    // Botão de remover (X)
    chip.querySelector('.tec-prio-chip-remove')?.addEventListener('click', (e) => {
      e.stopPropagation();
      moverSubpasta(nomeSubpasta, groupIndex, null);
    });

    return chip;
  }

  // Configura uma zona de soltura (drop zone)
  function configurarDropZone(dropzoneEl, targetGroupIndex) {
    dropzoneEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzoneEl.classList.add('tec-prio-drag-over');
    });

    dropzoneEl.addEventListener('dragleave', () => {
      dropzoneEl.classList.remove('tec-prio-drag-over');
    });

    dropzoneEl.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzoneEl.classList.remove('tec-prio-drag-over');

      try {
        const raw = e.dataTransfer.getData('text/plain');
        if (!raw) return;
        const data = JSON.parse(raw);
        moverSubpasta(data.subpasta, data.fromGroup, targetGroupIndex);
      } catch (err) {
        console.error('Erro no drop:', err);
      }
    });
  }

  // Move uma subpasta entre grupos ou desvincula
  function moverSubpasta(nomeSubpasta, fromGroupIndex, toGroupIndex) {
    const concurso = obterConcursoAtivo();
    if (!concurso) return;

    // 1. Remove do grupo de origem (se houver)
    if (fromGroupIndex !== null && concurso.grupos[fromGroupIndex]) {
      const arr = concurso.grupos[fromGroupIndex].subpastas || [];
      const idx = arr.indexOf(nomeSubpasta);
      if (idx !== -1) arr.splice(idx, 1);
    }

    // 2. Se o destino for outro grupo, adiciona nele
    if (toGroupIndex !== null && concurso.grupos[toGroupIndex]) {
      if (!concurso.grupos[toGroupIndex].subpastas) concurso.grupos[toGroupIndex].subpastas = [];
      if (!concurso.grupos[toGroupIndex].subpastas.includes(nomeSubpasta)) {
        concurso.grupos[toGroupIndex].subpastas.push(nomeSubpasta);
      }
    }

    salvarEstado().then(() => {
      renderizarSecaoSubpastasEGrupos();
      renderizarMatrizPrioridades();
      rastrearEInjetarBadgesSubpastas();
    });
  }

  // Modal de adição em massa com checkboxes
  function abrirDialogAdicaoEmMassa(groupIndex) {
    const concurso = obterConcursoAtivo();
    const grp = concurso.grupos[groupIndex];
    if (!grp) return;

    // Subpastas vinculadas em qualquer grupo
    const vinculadas = new Set();
    (concurso.grupos || []).forEach(g => {
      (g.subpastas || []).forEach(s => vinculadas.add(s));
    });

    const disponiveis = (concurso.subpastasDisponiveis || []).filter(s => !vinculadas.has(s));

    if (disponiveis.length === 0) {
      alert('Não há subpastas disponíveis sem grupo para vincular.');
      return;
    }

    const checklistHtml = disponiveis.map(s => `
      <label style="display: flex; align-items: center; gap: 8px; padding: 6px 0; font-size: 13px; cursor: pointer; border-bottom: 1px solid #f1f5f9;">
        <input type="checkbox" value="${s}" checked>
        <span>📁 ${s}</span>
      </label>
    `).join('');

    const modalDiv = document.createElement('div');
    modalDiv.className = 'tec-prio-progress-overlay';
    modalDiv.innerHTML = `
      <div class="tec-prio-progress-box" style="text-align: left; max-height: 80vh;">
        <h4 style="margin: 0; font-size: 16px; color: #0f172a;">Vincular ao Grupo: ${grp.nome}</h4>
        <p style="font-size: 12px; color: #64748b; margin: 4px 0 10px 0;">Selecione as subpastas que deseja adicionar a este grupo:</p>
        <div style="max-height: 300px; overflow-y: auto; padding: 8px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px;">
          ${checklistHtml}
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px;">
          <button class="tec-prio-btn tec-prio-btn-secondary" id="tec-prio-bulk-cancelar">Cancelar</button>
          <button class="tec-prio-btn tec-prio-btn-primary" id="tec-prio-bulk-salvar">Adicionar Selecionadas</button>
        </div>
      </div>
    `;

    document.body.appendChild(modalDiv);

    modalDiv.querySelector('#tec-prio-bulk-cancelar')?.addEventListener('click', () => modalDiv.remove());
    modalDiv.querySelector('#tec-prio-bulk-salvar')?.addEventListener('click', () => {
      const checkedBoxes = modalDiv.querySelectorAll('input[type="checkbox"]:checked');
      if (!grp.subpastas) grp.subpastas = [];

      checkedBoxes.forEach(cb => {
        if (!grp.subpastas.includes(cb.value)) {
          grp.subpastas.push(cb.value);
        }
      });

      salvarEstado().then(() => {
        modalDiv.remove();
        renderizarSecaoSubpastasEGrupos();
        renderizarMatrizPrioridades();
        rastrearEInjetarBadgesSubpastas();
      });
    });
  }

  // -------------------------------------------------------------
  // ESTRUTURA DO MODAL PRINCIPAL
  // -------------------------------------------------------------
  function criarModalEstrutura() {
    if (document.getElementById('tec-prio-modal')) return;

    const overlay = document.createElement('div');
    overlay.id = 'tec-prio-modal';
    overlay.className = 'tec-prio-modal-overlay';

    overlay.innerHTML = `
      <div class="tec-prio-modal-container">
        <!-- Header -->
        <div class="tec-prio-modal-header">
          <div class="tec-prio-modal-header-title">
            <span style="font-size: 24px;">🎯</span>
            <div>
              <h3>Priorizador Inteligente de Questões</h3>
              <span style="font-size: 12px; color: #64748b;">Estratégia de Edital, Pesos e Resolução Guiada</span>
            </div>
          </div>
          <button class="tec-prio-modal-close" id="tec-prio-modal-close-btn">&times;</button>
        </div>

        <!-- Abas -->
        <div class="tec-prio-modal-nav">
          <button class="tec-prio-nav-btn tec-prio-nav-active" data-tab="tab-grupos">⚖️ Grupos & Subpastas (Arrastar)</button>
          <button class="tec-prio-nav-btn" data-tab="tab-matriz">📊 Matriz de Priorização</button>
          <button class="tec-prio-nav-btn" data-tab="tab-raio-x">🔥 O Que Mais Cai (Índices)</button>
          <button class="tec-prio-nav-btn" data-tab="tab-config">⚙️ Backup & Ajustes</button>
        </div>

        <!-- Corpo das Abas -->
        <div class="tec-prio-modal-body">
          <!-- ABA 1: Grupos & Subpastas -->
          <div class="tec-prio-tab-content tec-prio-tab-active" id="tab-grupos">
            <div class="tec-prio-form-row">
              <div class="tec-prio-form-group" style="flex: 2;">
                <label class="tec-prio-label">Concurso / Pasta Ativa</label>
                <div style="display: flex; gap: 8px;">
                  <select class="tec-prio-select" id="tec-prio-select-concurso" style="flex: 1;"></select>
                  <button class="tec-prio-btn tec-prio-btn-secondary" id="tec-prio-novo-concurso-btn">➕ Novo</button>
                  <button class="tec-prio-btn tec-prio-btn-success" id="tec-prio-auto-analise-btn" title="Analisa automaticamente os índices e porcentagens de todos os cadernos">
                    ⚡ Analisar Todos os Cadernos Automaticamente
                  </button>
                </div>
              </div>
            </div>

            <!-- Pool de Subpastas Disponíveis (Não Vinculadas) -->
            <div class="tec-prio-unassigned-box">
              <div class="tec-prio-unassigned-header">
                <div class="tec-prio-unassigned-title">
                  <span>📂 Subpastas Disponíveis no Concurso</span>
                  <span class="tec-prio-badge tec-prio-badge-media" id="tec-prio-unassigned-count">0</span>
                  <span style="font-size: 11px; font-weight: normal; color: #64748b;">(Arraste para os grupos abaixo ou clique em "Mover para...")</span>
                </div>
                <button class="tec-prio-btn tec-prio-btn-secondary" id="tec-prio-detectar-subpastas-btn" style="font-size: 11px; padding: 4px 8px;">
                  🔍 Rastrear da Página
                </button>
              </div>
              <div class="tec-prio-unassigned-pool" id="tec-prio-unassigned-pool"></div>
            </div>

            <!-- Formulário de Novo Grupo -->
            <div style="border-top: 1px solid #e2e8f0; padding-top: 14px; margin-top: 14px;">
              <h4 style="margin: 0 0 10px 0; font-size: 14px; color: #0f172a;">➕ Criar Novo Grupo de Disciplinas da Prova</h4>
              <div class="tec-prio-form-row">
                <div class="tec-prio-form-group" style="flex: 2;">
                  <label class="tec-prio-label">Nome do Grupo</label>
                  <input type="text" class="tec-prio-input" id="tec-prio-input-grupo-nome" placeholder="Ex: Específicas Bloco 1">
                </div>
                <div class="tec-prio-form-group" style="flex: 1;">
                  <label class="tec-prio-label">Questões na Prova</label>
                  <input type="number" class="tec-prio-input" id="tec-prio-input-grupo-qtd" min="1" max="300" value="50">
                </div>
                <div class="tec-prio-form-group" style="flex: 1;">
                  <label class="tec-prio-label">Peso por Questão</label>
                  <input type="number" class="tec-prio-input" id="tec-prio-input-grupo-peso" min="0.5" max="10" step="0.5" value="2.0">
                </div>
                <div style="display: flex; align-items: flex-end;">
                  <button class="tec-prio-btn tec-prio-btn-primary" id="tec-prio-adicionar-grupo-btn">Salvar Grupo</button>
                </div>
              </div>
            </div>

            <!-- Lista de Grupos com Dropzones -->
            <h4 style="margin: 18px 0 10px 0; font-size: 14px; color: #0f172a;">Grupos Configurados (Zonas de Vinculação)</h4>
            <div id="tec-prio-lista-grupos"></div>
          </div>

          <!-- ABA 2: Matriz de Priorização -->
          <div class="tec-prio-tab-content" id="tab-matriz">
            <p style="font-size: 13px; color: #64748b; margin-top: 0;">
              A matriz calcula automaticamente a prioridade com base nos <strong>pontos em jogo na prova</strong> e no <strong>percentual já resolvido</strong>.
            </p>
            <table class="tec-prio-table">
              <thead>
                <tr>
                  <th>Prioridade</th>
                  <th>Subpasta / Caderno</th>
                  <th>Grupo do Edital</th>
                  <th>Qtd Prova × Peso</th>
                  <th>Pontos na Prova</th>
                  <th>% Resolvido</th>
                  <th>Score Urgência</th>
                </tr>
              </thead>
              <tbody id="tec-prio-matriz-tbody"></tbody>
            </table>
          </div>

          <!-- ABA 3: Raio-X do Índice -->
          <div class="tec-prio-tab-content" id="tab-raio-x">
            <div class="tec-prio-raiox-controls">
              <div class="tec-prio-raiox-filters">
                <div class="tec-prio-raiox-filter-item">
                  <label class="tec-prio-raiox-filter-label">📁 Filtrar Subpasta:</label>
                  <select class="tec-prio-select" id="tec-prio-raiox-filtro-subpasta" style="padding: 6px 10px; font-size: 12px; max-width: 280px;">
                    <option value="TODAS">Todas as Subpastas</option>
                  </select>
                </div>
                <div class="tec-prio-raiox-filter-item">
                  <label class="tec-prio-raiox-filter-label">🔃 Ordenar por:</label>
                  <select class="tec-prio-select" id="tec-prio-raiox-ordem" style="padding: 6px 10px; font-size: 12px;">
                    <option value="prioridade_desc">🔴 Maior Prioridade (Score de Urgência)</option>
                    <option value="prioridade_asc">🟢 Menor Prioridade</option>
                    <option value="incidencia_desc">🔥 Maior Incidência (% Mais Cobrado)</option>
                    <option value="questoes_desc">📊 Mais Questões no Caderno</option>
                    <option value="nome_asc">🔤 Nome do Caderno (A-Z)</option>
                  </select>
                </div>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <input type="text" class="tec-prio-input" id="tec-prio-raiox-busca" placeholder="🔍 Buscar assunto ou caderno..." style="padding: 6px 10px; font-size: 12px; width: 210px;">
                <button class="tec-prio-btn tec-prio-btn-success" id="tec-prio-raiox-reanalisar-btn" style="font-size: 12px; padding: 6px 12px;" title="Disparar análise automática em segundo plano">
                  ⚡ Analisar Cadernos
                </button>
              </div>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
              <span style="font-size: 12px; color: #64748b;" id="tec-prio-raiox-contagem">
                Análise dos tópicos e assuntos mais cobrados pela banca examinadora:
              </span>
            </div>

            <div id="tec-prio-historico-indices"></div>
          </div>

          <!-- ABA 4: Configurações & Backup -->
          <div class="tec-prio-tab-content" id="tab-config">
            <h4 style="margin: 0 0 10px 0; font-size: 14px; color: #0f172a;">Exportar / Importar Configurações</h4>
            <p style="font-size: 13px; color: #64748b;">
              Faça backup das suas regras de edital ou compartilhe com outros concurseiros.
            </p>
            <div style="display: flex; gap: 12px; margin-bottom: 20px;">
              <button class="tec-prio-btn tec-prio-btn-secondary" id="tec-prio-exportar-btn">📤 Exportar Backup (JSON)</button>
              <label class="tec-prio-btn tec-prio-btn-secondary" style="margin: 0; cursor: pointer;">
                📥 Importar Backup (JSON)
                <input type="file" id="tec-prio-importar-file" accept=".json" style="display: none;">
              </label>
              <button class="tec-prio-btn tec-prio-btn-danger" id="tec-prio-resetar-btn">🗑️ Restaurar Padrões</button>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="tec-prio-modal-footer">
          <span style="font-size: 12px; color: #64748b;">
            💡 Os badges são atualizados instantaneamente nas subpastas e cadernos da página.
          </span>
          <button class="tec-prio-btn tec-prio-btn-primary" id="tec-prio-modal-fechar-baixo-btn">Concluir</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Navegação de Abas
    overlay.querySelectorAll('.tec-prio-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        overlay.querySelectorAll('.tec-prio-nav-btn').forEach(b => b.classList.remove('tec-prio-nav-active'));
        overlay.querySelectorAll('.tec-prio-tab-content').forEach(c => c.classList.remove('tec-prio-tab-active'));

        btn.classList.add('tec-prio-nav-active');
        const targetTab = btn.getAttribute('data-tab');
        document.getElementById(targetTab)?.classList.add('tec-prio-tab-active');

        if (targetTab === 'tab-grupos') renderizarSecaoSubpastasEGrupos();
        if (targetTab === 'tab-matriz') renderizarMatrizPrioridades();
        if (targetTab === 'tab-raio-x') renderizarHistoricoIndices();
      });
    });

    // Fechar Modal
    const fechar = () => overlay.classList.remove('tec-prio-active');
    document.getElementById('tec-prio-modal-close-btn')?.addEventListener('click', fechar);
    document.getElementById('tec-prio-modal-fechar-baixo-btn')?.addEventListener('click', fechar);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) fechar();
    });

    // Concurso change
    document.getElementById('tec-prio-select-concurso')?.addEventListener('change', (e) => {
      appState.concursoAtivo = e.target.value;
      salvarEstado().then(() => {
        renderizarSecaoSubpastasEGrupos();
        renderizarMatrizPrioridades();
        rastrearEInjetarBadgesSubpastas();
      });
    });

    // Novo Concurso
    document.getElementById('tec-prio-novo-concurso-btn')?.addEventListener('click', () => {
      const nome = prompt('Digite o nome do novo Concurso / Pasta:');
      if (nome && nome.trim()) {
        const key = nome.trim();
        if (!appState.concursos[key]) {
          appState.concursos[key] = {
            id: normalizarTexto(key),
            nome: key,
            subpastasDisponiveis: [],
            grupos: [],
            subpastasProgresso: {},
            cadernosAnalise: {}
          };
          appState.concursoAtivo = key;
          salvarEstado().then(() => {
            popularSelectConcursos();
            renderizarSecaoSubpastasEGrupos();
          });
        }
      }
    });

    // Análise Automática Button
    document.getElementById('tec-prio-auto-analise-btn')?.addEventListener('click', () => {
      fechar();
      analisarTodosOsIndicesAutomaticamente();
    });

    // Rastrear subpastas da página atual
    document.getElementById('tec-prio-detectar-subpastas-btn')?.addEventListener('click', () => {
      rastrearEInjetarBadgesSubpastas();
      renderizarSecaoSubpastasEGrupos();
      alert('Subpastas rastreadas com sucesso da página atual!');
    });

    // Criar Grupo
    document.getElementById('tec-prio-adicionar-grupo-btn')?.addEventListener('click', () => {
      const nomeInput = document.getElementById('tec-prio-input-grupo-nome');
      const qtdInput = document.getElementById('tec-prio-input-grupo-qtd');
      const pesoInput = document.getElementById('tec-prio-input-grupo-peso');

      const nome = nomeInput.value.trim();
      const questoes = parseInt(qtdInput.value, 10) || 50;
      const peso = parseFloat(pesoInput.value) || 1.0;

      if (!nome) {
        alert('Informe o nome do grupo.');
        return;
      }

      const concurso = obterConcursoAtivo();
      if (concurso) {
        if (!concurso.grupos) concurso.grupos = [];
        concurso.grupos.push({
          id: 'grp_' + Date.now(),
          nome,
          questoesProva: questoes,
          peso,
          subpastas: []
        });

        nomeInput.value = '';
        salvarEstado().then(() => {
          renderizarSecaoSubpastasEGrupos();
          renderizarMatrizPrioridades();
        });
      }
    });

    // Backup
    document.getElementById('tec-prio-exportar-btn')?.addEventListener('click', () => {
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(appState, null, 2));
      const dlAnchor = document.createElement('a');
      dlAnchor.setAttribute('href', dataStr);
      dlAnchor.setAttribute('download', `tec_priorizador_${normalizarTexto(appState.concursoAtivo || 'backup')}.json`);
      dlAnchor.click();
    });

    document.getElementById('tec-prio-importar-file')?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (evt) => {
          try {
            const parsed = JSON.parse(evt.target.result);
            if (parsed.concursos) {
              appState = parsed;
              salvarEstado().then(() => {
                popularSelectConcursos();
                renderizarSecaoSubpastasEGrupos();
                alert('Backup restaurado!');
              });
            }
          } catch (err) {
            alert('Arquivo JSON inválido.');
          }
        };
        reader.readAsText(file);
      }
    });

    document.getElementById('tec-prio-resetar-btn')?.addEventListener('click', () => {
      if (confirm('Restaurar dados padrões?')) {
        appState = JSON.parse(JSON.stringify(DEFAULT_STATE));
        salvarEstado().then(() => {
          popularSelectConcursos();
          renderizarSecaoSubpastasEGrupos();
        });
      }
    });
  }

  function popularSelectConcursos() {
    const sel = document.getElementById('tec-prio-select-concurso');
    if (!sel || !appState) return;

    sel.innerHTML = '';
    Object.keys(appState.concursos).forEach(key => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = appState.concursos[key].nome;
      if (key === appState.concursoAtivo) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function renderizarMatrizPrioridades() {
    const tbody = document.getElementById('tec-prio-matriz-tbody');
    if (!tbody) return;

    const concurso = obterConcursoAtivo();
    if (!concurso) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #64748b;">Nenhum concurso ativo.</td></tr>';
      return;
    }

    const subpastas = [];
    (concurso.grupos || []).forEach(grp => {
      (grp.subpastas || []).forEach(sub => {
        const progresso = (concurso.subpastasProgresso && concurso.subpastasProgresso[sub]) || 0;
        const prio = calcularPrioridade(concurso, sub, progresso);
        subpastas.push({ subpasta: sub, prio });
      });
    });

    subpastas.sort((a, b) => b.prio.score - a.prio.score);

    if (subpastas.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #64748b; padding: 20px;">Nenhuma subpasta vinculada aos grupos. Vincule arrastando na primeira aba.</td></tr>';
      return;
    }

    tbody.innerHTML = subpastas.map(item => `
      <tr>
        <td>
          <span class="tec-prio-badge ${item.prio.classe}">
            ${item.prio.icone} ${item.prio.label}
          </span>
        </td>
        <td><strong>📁 ${item.subpasta}</strong></td>
        <td><span class="tec-prio-group-tag">${item.prio.grupo ? item.prio.grupo.nome : '-'}</span></td>
        <td>${item.prio.questoesProva}q × ${item.prio.peso}</td>
        <td><strong>${item.prio.totalPontosGrupo} pts</strong> (${item.prio.relevanciaProvaPerc}%)</td>
        <td>
          <div style="display: flex; align-items: center; gap: 8px;">
            <input type="number" min="0" max="100" value="${item.prio.percResolvido}" class="tec-prio-input" style="width: 60px; padding: 4px;" data-progresso-sub="${item.subpasta}">
            <span>%</span>
          </div>
        </td>
        <td><strong style="color: #0284c7; font-size: 14px;">${item.prio.score}</strong></td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-progresso-sub]').forEach(input => {
      input.addEventListener('change', (e) => {
        const subName = e.target.getAttribute('data-progresso-sub');
        const val = Math.min(100, Math.max(0, parseInt(e.target.value, 10) || 0));
        if (!concurso.subpastasProgresso) concurso.subpastasProgresso = {};
        concurso.subpastasProgresso[subName] = val;
        salvarEstado().then(() => {
          renderizarMatrizPrioridades();
          rastrearEInjetarBadgesSubpastas();
        });
      });
    });
  }

  let raioxEventosConectados = false;

  function renderizarHistoricoIndices(repopularFiltro = true) {
    const container = document.getElementById('tec-prio-historico-indices');
    if (!container) return;

    const concurso = obterConcursoAtivo();
    const selectSubpasta = document.getElementById('tec-prio-raiox-filtro-subpasta');
    const selectOrdem = document.getElementById('tec-prio-raiox-ordem');
    const inputBusca = document.getElementById('tec-prio-raiox-busca');
    const contagemEl = document.getElementById('tec-prio-raiox-contagem');

    if (!concurso || !concurso.cadernosAnalise || Object.keys(concurso.cadernosAnalise).length === 0) {
      container.innerHTML = `
        <div style="color: #64748b; font-size: 13px; padding: 24px; background: #f8fafc; border-radius: 8px; border: 1px dashed #cbd5e1; text-align: center;">
          <p style="margin-bottom: 8px; font-weight: 600;">Nenhum caderno analisado ainda para este concurso.</p>
          <span style="font-size: 12px; color: #94a3b8;">
            Clique no botão <strong>"⚡ Analisar Cadernos"</strong> acima para varrer os índices e mapear os tópicos mais frequentes automaticamente!
          </span>
        </div>
      `;
      if (contagemEl) contagemEl.textContent = 'Nenhum caderno analisado.';
      return;
    }

    // Coleta todas as subpastas presentes nos cadernos analisados
    const todasSubpastas = new Set();
    Object.values(concurso.cadernosAnalise).forEach(data => {
      if (data.subpasta) todasSubpastas.add(data.subpasta);
    });
    // Adiciona também as subpastas cadastradas no concurso
    (concurso.subpastasDisponiveis || []).forEach(s => todasSubpastas.add(s));

    // Popula o select de subpastas se repopularFiltro for true ou se ainda estiver vazio
    if (repopularFiltro && selectSubpasta) {
      const valorAtual = selectSubpasta.value || 'TODAS';
      selectSubpasta.innerHTML = '<option value="TODAS">📁 Todas as Subpastas</option>';
      Array.from(todasSubpastas).sort().forEach(sub => {
        const opt = document.createElement('option');
        opt.value = sub;
        opt.textContent = `📁 ${sub}`;
        if (sub === valorAtual) opt.selected = true;
        selectSubpasta.appendChild(opt);
      });
    }

    // Lê os filtros atuais
    const filtroSubpasta = selectSubpasta?.value || 'TODAS';
    const ordem = selectOrdem?.value || 'prioridade_desc';
    const busca = (inputBusca?.value || '').trim().toLowerCase();

    // Mapeia os cadernos calculando a prioridade de cada um
    const listaCadernos = Object.entries(concurso.cadernosAnalise).map(([nomeCaderno, data]) => {
      const subpastaNome = data.subpasta || 'Geral';
      const totalQtd = data.totalQuestoes || 0;
      const resolvQtd = data.questoesResolvidas || 0;
      const progresso = (concurso.subpastasProgresso && concurso.subpastasProgresso[subpastaNome] !== undefined)
        ? concurso.subpastasProgresso[subpastaNome]
        : (totalQtd > 0 ? Math.round((resolvQtd / totalQtd) * 100) : 0);

      const prio = calcularPrioridade(concurso, subpastaNome, progresso);
      const topAssuntos = Array.isArray(data.topAssuntos) ? data.topAssuntos : [];
      const maxIncidencia = topAssuntos.length > 0 ? Math.max(...topAssuntos.map(t => Number(t.perc) || 0)) : 0;

      return {
        nomeCaderno,
        data,
        subpastaNome,
        progresso,
        prio,
        maxIncidencia,
        totalQtd,
        resolvQtd,
        topAssuntos
      };
    });

    // Filtra por Subpasta
    let filtrados = listaCadernos;
    if (filtroSubpasta !== 'TODAS') {
      const alvoNorm = normalizarTexto(filtroSubpasta);
      filtrados = filtrados.filter(item => normalizarTexto(item.subpastaNome) === alvoNorm || normalizarTexto(item.subpastaNome).includes(alvoNorm));
    }

    // Filtra por termo de busca
    if (busca) {
      filtrados = filtrados.filter(item => {
        const nomeMatch = item.nomeCaderno.toLowerCase().includes(busca);
        const subMatch = item.subpastaNome.toLowerCase().includes(busca);
        const topicMatch = item.topAssuntos.some(a => a.nome && a.nome.toLowerCase().includes(busca));
        return nomeMatch || subMatch || topicMatch;
      });
    }

    // Ordenação
    filtrados.sort((a, b) => {
      if (ordem === 'prioridade_desc') return b.prio.score - a.prio.score;
      if (ordem === 'prioridade_asc') return a.prio.score - b.prio.score;
      if (ordem === 'incidencia_desc') return b.maxIncidencia - a.maxIncidencia;
      if (ordem === 'questoes_desc') return b.totalQtd - a.totalQtd;
      if (ordem === 'nome_asc') return a.nomeCaderno.localeCompare(b.nomeCaderno);
      return b.prio.score - a.prio.score;
    });

    // Atualiza contador
    if (contagemEl) {
      contagemEl.innerHTML = `Exibindo <strong>${filtrados.length}</strong> de ${listaCadernos.length} cadernos analisados • Ordenados por: <strong>${selectOrdem?.options[selectOrdem.selectedIndex]?.text || 'Prioridade'}</strong>`;
    }

    if (filtrados.length === 0) {
      container.innerHTML = `
        <div style="color: #64748b; font-size: 13px; padding: 24px; background: #f8fafc; border-radius: 8px; border: 1px dashed #cbd5e1; text-align: center;">
          Nenhum caderno encontrado para a subpasta <strong>"${filtroSubpasta}"</strong> ${busca ? `ou com a busca "${busca}"` : ''}.
        </div>
      `;
      return;
    }

    // Renderiza cada Card
    container.innerHTML = filtrados.map(item => {
      const topTopicsHtml = item.topAssuntos.map((top, idx) => {
        let badgeHtml = '';
        if (top.perc >= 15 || idx === 0) {
          badgeHtml = `<span class="tec-prio-tree-badge tec-prio-tree-badge-hot1">🔥 Top #${idx + 1} (${top.perc}%)</span>`;
        } else if (top.perc >= 8) {
          badgeHtml = `<span class="tec-prio-tree-badge tec-prio-tree-badge-hot2">⚡ Muito Cobrado (${top.perc}%)</span>`;
        } else {
          badgeHtml = `<span class="tec-prio-tree-badge tec-prio-tree-badge-medium">📌 Relevante (${top.perc}%)</span>`;
        }

        return `
          <div class="tec-prio-raiox-topic-item">
            <div class="tec-prio-raiox-topic-left">
              ${badgeHtml}
              <span class="tec-prio-raiox-topic-name" title="${top.nome}">${top.nome}</span>
            </div>
            <div class="tec-prio-raiox-topic-right">
              <span style="font-weight: 700; color: #1e293b;">${top.qtd} questões</span>
              <span style="color: #64748b; font-size: 11px;">(${top.perc}% do caderno)</span>
              <div style="width: 60px; height: 6px; background: #e2e8f0; border-radius: 3px; overflow: hidden;">
                <div style="width: ${Math.min(100, top.perc * 2.5)}%; height: 100%; background: linear-gradient(90deg, #f97316 0%, #ef4444 100%);"></div>
              </div>
            </div>
          </div>
        `;
      }).join('');

      return `
        <div class="tec-prio-raiox-card tec-prio-raiox-card-${item.prio.nivel}">
          <div class="tec-prio-raiox-card-header">
            <div class="tec-prio-raiox-card-title">
              <span class="tec-prio-badge ${item.prio.classe}">${item.prio.icone} ${item.prio.label} (Score: ${item.prio.score})</span>
              <span>📖 ${item.nomeCaderno}</span>
            </div>
            <div class="tec-prio-raiox-card-meta">
              <span class="tec-prio-group-tag">📁 ${item.subpastaNome}</span>
              <span class="tec-prio-group-tag" style="background: #f1f5f9; color: #334155; border-color: #cbd5e1;">🏷️ ${item.prio.grupo ? item.prio.grupo.nome : 'Sem Grupo'}</span>
              <span><strong>${item.resolvQtd}</strong> / ${item.totalQtd} resolvidas (${item.progresso}%)</span>
            </div>
          </div>

          <div style="font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 6px;">
            Top Assuntos Mais Cobrados neste caderno:
          </div>
          <div class="tec-prio-raiox-topics-list">
            ${topTopicsHtml || '<div style="color: #94a3b8; font-size: 12px; font-style: italic;">Nenhum tópico detalhado no índice.</div>'}
          </div>
        </div>
      `;
    }).join('');

    // Conecta eventos de filtro apenas uma vez
    if (!raioxEventosConectados) {
      raioxEventosConectados = true;

      selectSubpasta?.addEventListener('change', () => renderizarHistoricoIndices(false));
      selectOrdem?.addEventListener('change', () => renderizarHistoricoIndices(false));
      inputBusca?.addEventListener('input', () => renderizarHistoricoIndices(false));

      document.getElementById('tec-prio-raiox-reanalisar-btn')?.addEventListener('click', () => {
        const overlayModal = document.getElementById('tec-prio-modal');
        if (overlayModal) overlayModal.classList.remove('tec-prio-active');
        analisarTodosOsIndicesAutomaticamente();
      });
    }
  }

  function injetarBotaoFlutuante() {
    if (document.getElementById('tec-prio-launcher')) return;

    const btn = document.createElement('div');
    btn.id = 'tec-prio-launcher';
    btn.className = 'tec-prio-launcher-btn';
    btn.setAttribute('title', 'Abrir Painel de Priorização do Edital');

    const concurso = obterConcursoAtivo();
    const nomeConcurso = concurso ? concurso.nome : 'Configurar Edital';

    btn.innerHTML = `
      <span>🎯</span>
      <span>Priorizador: <strong>${nomeConcurso}</strong></span>
      <span class="tec-prio-launcher-badge">Edital</span>
    `;

    btn.addEventListener('click', abrirModalPriorizador);
    document.body.appendChild(btn);
  }

  function abrirModalPriorizador() {
    criarModalEstrutura();
    popularSelectConcursos();
    renderizarSecaoSubpastasEGrupos();
    renderizarMatrizPrioridades();
    document.getElementById('tec-prio-modal')?.classList.add('tec-prio-active');
  }

  function executarCicloDeVerificacao() {
    // Garante remoção completa do banner inferior/superior confuso
    document.getElementById('tec-prio-context-banner')?.remove();
    document.querySelectorAll('.tec-prio-context-banner').forEach(el => el.remove());

    injetarBotaoFlutuante();
    rastrearEInjetarBadgesSubpastas();
    injetarBotaoOrdenacaoNaPagina();
  }

  async function iniciar() {
    await carregarEstado();
    executarCicloDeVerificacao();

    if (observer) observer.disconnect();
    observer = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        setTimeout(executarCicloDeVerificacao, 300);
      } else {
        if (!iniciar.timer) {
          iniciar.timer = setTimeout(() => {
            executarCicloDeVerificacao();
            iniciar.timer = null;
          }, 500);
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})();
