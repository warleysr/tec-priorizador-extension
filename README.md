# 🎯 TEC Concursos — Priorizador Inteligente de Estudos (v1.1.0)

Extensão para Google Chrome (Manifest V3) criada para o **TEC Concursos** para priorizar o estudo de cadernos e subpastas com base no edital, pesos da prova, percentual de resolução e análise automática dos índices ("o que mais cai").

---

## 🚀 Novidades da Versão 1.1.0

1. **Badges de Prioridade Direto nas Subpastas e Cadernos**:
   - Cada linha de subpasta no TEC (ex.: `Administração Pública e Fundamentos...`, `ENGENHARIA DE DADOS...`) exibe instantaneamente o selo de prioridade:
     - 🔴 **P1: Crítica** (Matéria com alto peso e poucas questões resolvidas).
     - 🟠 **P2: Alta Prioridade**
     - 🟡 **P3: Média Prioridade**
     - 🟢 **P4: Baixa Prioridade / Concluído**
   - Exibe os pontos da matéria na prova, grupo vinculado e mini barra com % resolvido.
   - Subpastas ainda não vinculadas exibem `➕ Sem Grupo (Definir)`, permitindo vinculá-las com 1 clique!

2. **Análise Automática de Índices em Segundo Plano**:
   - Não é mais necessário abrir a aba "Índice" manualmente caderno por caderno!
   - Clique no botão **"⚡ Analisar Todos os Cadernos Automaticamente"**:
     - O sistema consulta via API interna do TEC (`/api/cadernos/{id}/carregar-indice` e `/api/cadernos/{id}/resumo`) usando seus cookies de sessão ativos.
     - Mapeia todos os cadernos da pasta, calcula questões resolvidas, percentual de conclusão e os tópicos mais cobrados pela banca.
     - Apresenta barra de progresso em tempo real durante a varredura.

3. **Vinculação Dinâmica por Drag & Drop (Arrastar e Soltar)**:
   - Chega de digitar nomes longos manualmente!
   - A extensão rastreia todas as subpastas da sua tela e as coloca no painel **"📂 Subpastas Disponíveis no Concurso"**.
   - **Arraste e solte** qualquer subpasta diretamente para a caixa do grupo desejado (ex.: *Conhecimentos Específicos* ou *Conhecimentos Básicos*).
   - Botão **"➕ Adicionar em Massa"** em cada grupo para marcar caixas de seleção e adicionar dezenas de matérias de uma só vez.
   - Seletor rápido em cada chip para mover ou desvincular.

4. **Filtro por Subpasta e Ordenação por Prioridade na aba "O Que Mais Cai"**:
   - Seletor para **filtrar apenas a subpasta desejada** (ex.: focar somente em *Administração Pública*, *Auditoria*, etc.) ou visualizar todas.
   - Ordenação dinâmica por:
     - 🔴 **Maior Prioridade (Score de Urgência)**: cadernos com maior impacto na prova e menor progresso resolvido vêm primeiro.
     - 🔥 **Maior Incidência (% Mais Cobrado)**: cadernos cujos tópicos principais concentram a maior fatia de questões.
     - 📊 **Mais Questões no Caderno**.
     - 🔤 **Nome do Caderno (A-Z)**.
   - Campo de busca em tempo real para encontrar assuntos e palavras-chave instantaneamente.

5. **Ordenação Direto na Página: Subpastas por Criticidade e Cadernos por Relevância**:
   - Novo botão injetado junto à barra de ordenação do TEC:  
     `• 🎯 Criticidade do Edital`.
   - **Reorganiza fisicamente na tela** as subpastas:
     - 🔴 **P1: Crítica** vai para o topo absoluto da sua tela.
     - 🟠 **P2: Alta**, 🟡 **P3: Média** e 🟢 **P4: Baixa** na sequência.
     - Numeração de ranking `#1`, `#2`, `#3`... em cada subpasta.
   - **Reorganiza os cadernos dentro de cada subpasta**:
     - Ao expandir uma subpasta, os cadernos são ordenados automaticamente pelos **temas mais frequentes** identificados na análise dos índices.
     - O caderno com o tema mais crítico e menos resolvido recebe o destaque: `🔥 Top Tema: [Assunto] (X%)`.

---

## 📦 Como Atualizar / Instalar no Google Chrome

1. Abra o Chrome e vá em:
   ```text
   chrome://extensions
   ```
2. Ative a chave **"Modo do desenvolvedor"** no canto superior direito.
3. Se você já havia carregado a extensão anteriormente, basta clicar no ícone de **atualizar (🔄)** no card da extensão.
4. Se for a primeira vez:
   - Clique em **"Carregar sem compactação"** (*Load unpacked*).
   - Selecione a pasta:
     ```text
     C:\Users\safe\.gemini\antigravity\scratch\tec-priorizador-extension
     ```
5. Recarregue a página do [TEC Concursos](https://www.tecconcursos.com.br/questoes/pastas).

---

## 📖 Como Usar no Dia a Dia

1. Abra a pasta do seu concurso no TEC Concursos (ex.: **CGU**).
2. As subpastas na tela já serão detectadas automaticamente.
3. Clique no botão flutuante **"🎯 Priorizador: CGU"** no canto superior direito:
   - Na primeira aba, arraste as subpastas disponíveis para os grupos correspondentes (*Específicas*, *Básicas*, etc.).
   - Defina a quantidade de questões esperadas na prova e o peso de cada grupo.
   - Clique em **"⚡ Analisar Todos os Cadernos Automaticamente"** para calcular o progresso e os tópicos mais cobrados de todos os cadernos de uma só vez.
4. Ao fechar o modal, a página do TEC exibirá os indicadores de prioridade e progresso em cada subpasta.
