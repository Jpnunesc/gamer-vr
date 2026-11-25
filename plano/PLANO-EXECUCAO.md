# Plano de execução — Vice City Web em VR

Data: 10/11/2026. Destinatário: Claude responsável pela implementação.

Este documento é uma proposta de engenharia, não uma implementação validada. A evidência da investigação está em [ANALISE-TECNICA.md](./ANALISE-TECNICA.md). Instruções de início estão em [PROMPT-PARA-CLAUDE.md](./PROMPT-PARA-CLAUDE.md).

## 1. Resultado esperado e limites

Adaptar a base do jogo de `https://gta.rabisco.net/` para uma experiência WebXR de primeira pessoa, com profundidade estereoscópica e cabeça rastreada. Primeiro alvo: PS VR2 conectado ao PC por adaptador e SteamVR/OpenXR. Requisito explícito do usuário: jogar usando o headset junto com teclado e mouse, além de poder escolher os controles VR. Continuar oferecendo modo desktop para desenvolvimento e regressão.

Visualização e entrada são escolhas independentes. São obrigatórios os modos: monitor + teclado/mouse; headset VR + teclado/mouse; headset VR + controles VR. No modo headset + teclado/mouse, o jogo deve funcionar sem exigir controles Sense ativos durante a partida. Eventuais exigências de controles na configuração inicial do runtime são externas ao jogo e precisam ser verificadas separadamente.

Primeira entrega jogável: carregar uma partida, caminhar por um trecho urbano, olhar e inclinar a cabeça, entrar em um carro, dirigir em primeira pessoa, sair, testar uma arma e salvar/carregar. Validar esse fluxo no headset tanto com teclado/mouse quanto com os dois controles VR. Priorizar headset + teclado/mouse para o primeiro percurso integrado. Preservar os sistemas existentes, sem prometer validação de toda a campanha.

Uma tela virtual com o canvas do jogo pode servir para menus/cutscenes. Ela não satisfaz o requisito de gameplay VR. O mundo precisa ser renderizado a partir das poses de cada olho.

Fora desta execução: plataforma multijogos, contas, pagamentos, multiplayer, catálogo, launcher genérico, recriação de toda a engine em JavaScript, cidade nova, distribuição pública dos assets e suporte universal a headsets. Não alterar o site de terceiros. Desenvolver uma cópia local independente.

## 2. Decisão sobre a base

Ordem de preferência:

1. Se o usuário disponibilizar o código do port Rabisco, identificar seu commit, submódulos e build e trabalhar nessa base.
2. Na ausência dele, começar pelo `origami-ltd/wasm-revc` na revisão citada no relatório, com seus submódulos fixados. Registrar que os patches particulares do Rabisco não estão presentes.
3. Se essa revisão não compilar, investigar dependências/toolchain e uma revisão pública alternativa; registrar diferenças antes de mudar de base. Não afirmar equivalência com o site.

O padrão, enquanto não houver outra informação, é que o usuário possui somente o link. Não depender de obter todo o código por decompilação do WASM nem usar os servidores do Rabisco como CDN. É possível começar o diagnóstico WebXR e a preparação do build sem os dados comerciais.

Se a integração com a engine se mostrar inviável, entregar evidência e opções: continuar o port com estimativa revisada ou construir um jogo original menor inspirado no gênero. A segunda opção muda o objetivo e não deve ocorrer silenciosamente.

## 3. Arquitetura proposta

```text
Página do jogo: iniciar, diagnóstico, carregar dados, modo desktop/VR
                            |
        Sessão WebXR + entrada teclado/mouse ou controles XR
                            |
             Ponte JS/TypeScript ↔ C++/WASM
           poses, ações, câmera, métricas, ciclo de vida
                            |
            Engine reVC: mundo, física, IA, missões
                            |
                librw/WebGL2 adaptado para XR
                            |
             framebuffer XR + vistas de cada olho

Dados locais → FS/streaming da engine     Saves → armazenamento local
```

Preservar C++/WASM, librw e WebGL2. Usar TypeScript para os módulos WebXR se compatível com o shell escolhido. Three.js é opcional para um diagnóstico isolado; não transplantar a campanha para a biblioteca de modelos.

Manter um contexto gráfico principal. Um renderer auxiliar compartilhando o mesmo contexto só é aceitável com restauração explícita de estado e justificativa. Não começar migrando para WebGPU ou adicionando uma segunda engine de física.

Organização sugerida, ajustável à base real:

```text
docs/                 auditoria, decisões, testes, estado e configuração
web/src/xr/           sessão, poses, input, diagnóstico e preferências
web/src/input/        ações comuns, teclado/mouse, seleção de dispositivo
web/src/engine/       ponte com WASM e lifecycle
src/xr/               integração nativa, câmera, ações e modos
vendor/librw/         patch pequeno e rastreável no backend gráfico
tests/                matemática, integração e regressões selecionadas
scripts/              build reproduzível, servidor e verificação
local-game-data/      instalação do usuário; ignorada pelo Git
```

Evitar abstrações da futura plataforma. Apenas manter o jogo inicializável, pausável e descartável sem depender de uma conta.

## 4. Contrato proposto da ponte

Os nomes abaixo são novos contratos a implementar, não exports encontrados no site. Definir versão, unidades, alinhamento, dono da memória, duração dos buffers e erros antes de codificar.

| Operação conceitual | Responsabilidade |
|---|---|
| `xrSetMode(enabled)` | Alternar propriedade do loop/câmera e restaurar o modo desktop. |
| `xrSubmitInput(input)` | Entregar ações da fonte selecionada (teclado/mouse ou controles XR) e poses válidas, mantendo a cabeça independente da fonte de ações. |
| `gameAdvance(dt)` | Avançar simulação em passos compatíveis com a engine. |
| `gamePrepareFrame()` | Preparar estado compartilhado que não deve avançar por olho. |
| `xrRenderView(view)` | Desenhar o mundo usando view/projection/viewport fornecidos. |
| `xrGetAnchor()` | Obter origem e orientação de locomoção, a pé ou no veículo. |
| `xrGetTelemetry()` | Expor tempos, contadores, estado do jogador e falhas. |
| `xrResetInput()` | Neutralizar ações após pausa, desconexão ou encerramento. |

Usar buffers tipados pré-alocados. Recriar views JavaScript se a memória WASM crescer. Não serializar matrizes por JSON por olho nem presumir que um `WebGLFramebuffer` seja um inteiro C++.

O alvo gráfico XR deve atravessar uma integração explícita com Emscripten/librw no mesmo contexto. Registrar ou vincular o objeto adequadamente e sincronizar caches de estado. Não usar o framebuffer opaco fora do callback e da sessão a que pertence.

## 5. Regras técnicas que orientam todas as fases

### Renderização e tempo

- Durante VR, a apresentação deve acompanhar `XRSession.requestAnimationFrame`; suspender o agendamento concorrente do desktop. Ao sair, restaurar exatamente um loop. [Referência](https://developer.mozilla.org/en-US/docs/Web/API/XRSession/requestAnimationFrame).
- Um passo de simulação não pode ocorrer uma vez para cada olho. Renderizar N vistas a partir do mesmo estado. Auditar efeitos que modificam estado dentro de funções de desenho.
- Identificar a cadência de simulação estável da base antes de fixar um passo. Usar acumulador com limite de recuperação, sem mudar arbitrariamente física de 30/60 para 90/120 Hz. Interpolar apresentação quando necessário; aplicar a pose da cabeça atual em cada quadro XR.
- Usar as projeções assimétricas e viewports fornecidos pelo runtime; não inventar IPD ou FOV. A camada gráfica precisa respeitar framebuffer, projeção e viewport externos. [Referência](https://developer.mozilla.org/en-US/docs/Web/API/XRWebGLLayer).
- Auditar limpeza de buffers e scissor para que desenhar um olho não apague o outro. Tratar passes de reflexão/offscreen separadamente: o override XR só vale no alvo principal apropriado.
- Culling, transparências, água, partículas e LOD devem considerar as duas vistas. Uma lista calculada apenas para a câmera desktop pode fazer objetos desaparecerem em um olho.
- Preparar o contexto para XR e tratar possível perda/restauração de contexto. [Referência](https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/makeXRCompatible).

### Espaço, cabeça e corpo

- Documentar transformação entre coordenadas WebXR e da engine, incluindo eixos, handedness, escala em metros e ordem de matrizes. Testar com pontos conhecidos e uma grade de um metro.
- Compor origem do jogador/veículo, rotação artificial e pose física. Separar orientação da cabeça, direção do corpo e direção da arma.
- Preferir `local-floor` quando disponível, com fallback `local` e altura calibrada. Não somar altura de piso e altura dos olhos duas vezes. Recentrar ajusta a origem virtual, não o rastreamento físico.
- Ocultar cabeça/partes do personagem que invadam a câmera. Não depender de alterar apenas o near plane.
- Primeira versão voltada a uso sentado ou em pé no lugar, com inclinação física pequena. Definir comportamento ao atravessar parede com a cabeça: aviso/fade e tratamento coerente da colisão; evitar arrastar a câmera contra o movimento real.

### Entrada e conforto

- Separar `displayMode` (desktop/VR) de `inputMode` (teclado/mouse ou controles VR). Escolher VR não pode selecionar controles VR obrigatoriamente. A pose da cabeça permanece ativa em ambos os modos de entrada enquanto a sessão XR existir.
- Normalizar dispositivos em ações comuns: mover, girar, mirar, disparar, interagir, recarregar, trocar arma, dirigir, pausar e navegar no menu. A engine recebe uma única fonte de ações de gameplay por vez. Evitar que eventos nativos SDL e a ponte nova apliquem o mesmo teclado/mouse duas vezes.
- Ler `session.inputSources`, `handedness`, `gripSpace`, `targetRaySpace` e `gamepad` de cada fonte. Controles XR não devem ser procurados somente em `navigator.getGamepads()`. [Referência](https://developer.mozilla.org/en-US/docs/Web/API/XRInputSource/gamepad).
- Resolver perfis e semântica de ações. Validar comprimento dos arrays, mapeamento `xr-standard` e recursos ausentes; não presumir índices de um controle Xbox. [Referência](https://github.com/immersive-web/webxr-gamepads-module/blob/main/gamepads-module-explainer.md).
- No modo controles VR: analógico esquerdo move; direito gira em incrementos de 30° com histerese; mão dominante aponta e dispara. Interação, recarga e pausa devem ser configuráveis e acessíveis em menu XR. Não depender do botão de sistema do headset.
- No carro: analógico para direção e ações contextuais para acelerar/frear. Controles mudam de contexto de maneira explícita; disparo não pode permanecer acionado ao entrar no carro.
- Desativar head bob, tremor forçado, roll de câmera e motion blur em VR inicialmente. Rotação contínua, direção pela cabeça e vinheta ficam como opções.
- Transições de entrada/saída de veículo usam fade curto e origem calibrada. Cutscenes podem aparecer em painel virtual estável; retornar ao mundo sem salto inesperado.
- Menus e HUD precisam existir dentro da composição XR. Não assumir que HTML sobre o canvas aparecerá no headset. Usar texto/painéis 3D ou textura renderizada, com interação por raio dos controles ou cursor virtual e navegação por teclado.
- Perda de foco, sessão encerrada, `visibilitychange` e perda de rastreamento da cabeça zeram ações. Desconexão de controles neutraliza ações quando eles forem a fonte ativa; controles inativos não devem interromper uma partida com teclado/mouse. Pausar simulação quando apropriado, mantendo apresentação XR responsiva.

### Headset com teclado e mouse — requisito obrigatório

O usuário pode jogar sentado, usando o headset para visão estereoscópica e rastreamento 6DoF, com as mãos no teclado e no mouse. Não requer rastreamento de mãos nem simulação de controles Sense.

Mapeamento inicial proposto, remapeável:

| Ação | Headset + teclado/mouse |
|---|---|
| Caminhar | WASD relativo à orientação de locomoção/corpo; olhar para o lado não redireciona o movimento por padrão |
| Olhar e inclinar | Movimento real da cabeça, sempre preservado |
| Girar e mirar | Mouse horizontal gira a orientação virtual em yaw; vertical eleva/abaixa a mira da arma, sem impor pitch ou roll à cabeça |
| Giro em incrementos | Q/E, como alternativa configurável ao giro contínuo do mouse |
| Disparar / mirar | Botões esquerdo / direito do mouse |
| Recarregar / trocar arma | R / roda do mouse ou teclas numéricas, conforme armas suportadas |
| Interagir e entrar/sair do carro | F |
| Dirigir | W/S para acelerar/frear ou ré conforme lógica nativa; A/D para esterçar; espaço para freio de mão |
| Pausar / recentrar | P / C; não depender exclusivamente de Esc, que pode ser usado pelo navegador/runtime |
| Navegar no menu XR | Setas, Enter e Backspace; também cursor virtual com mouse |

No carro, o mouse não deve esterçar nem girar a origem da câmera para fora do banco. A cabeça controla o olhar; definir o uso contextual do mouse sem alterar a direção do veículo. No desktop, manter o comportamento convencional de câmera com mouse.

A mira em VR deve corresponder a um raio 3D de gameplay. Projetar o indicador em cada olho, preservando convergência e oclusão, em vez de fixar uma cruz 2D diferente em cada tela. A arma virtual pode seguir a orientação de mira do mouse sem depender de pose de controlador. Documentar a composição corpo → mira e corpo → cabeça para permitir olhar em uma direção e mirar em outra.

Tratar captura de mouse, foco e recuperação como parte de F1: verificar movimentos relativos e Pointer Lock durante a sessão imersiva no navegador/runtime alvo. Pedir captura por gesto explícito quando necessário, tratar liberação/negação e oferecer instrução visível no headset. Não presumir compatibilidade dessa combinação sem teste. Se houver limitação, registrar uma alternativa testada ou o impedimento; substituir silenciosamente por mira apenas pela cabeça não aprova o requisito teclado/mouse.

Disponibilizar seleção explícita de entrada antes de entrar em VR e dentro do menu XR, acessível por qualquer um dos modos. Salvar a preferência. Troca de entrada não encerra a sessão XR nem reinicia a partida: neutralizar a fonte anterior, descartar deltas acumulados e exigir estado neutro da nova fonte antes de aceitar ações. Não alternar automaticamente por ruído dos analógicos ou pequeno movimento do mouse. Sem controles conectados, permitir iniciar e continuar com teclado/mouse.

## 6. Etapas e critérios de aprovação

### F0 — Base, inventário e reprodução

Dependência: nenhuma.

1. Ler o relatório técnico; identificar código disponível e termos de cada componente. Registrar origem/commit/licenças em `docs/SOURCES.md`. Não publicar dados do usuário.
2. Fixar reVC, librw e toolchain. Usar WSL2 ou ambiente reproduzível equivalente se o build exigir ferramentas Unix. Não usar dependências flutuantes.
3. Mapear loop, câmera, desenho, input, saves e streaming, com arquivo/símbolo real. Confirmar o que mudou em relação à revisão investigada.
4. Compilar e servir o jogo desktop. Selecionar arquivos clássicos locais por um fluxo suportado; não usar dados da Definitive Edition como substituição silenciosa.
5. Registrar percurso de referência: iniciar, mover, entrar/sair de veículo, pausar e salvar/carregar.

Entregas: `docs/BASELINE.md`, `docs/SOURCES.md`, script de build, instruções locais e baseline executável.

Aprovação: build limpo reproduzível e percurso desktop documentado com dados reais. Sem dados locais, marcar gameplay pendente; compilação e diagnóstico XR podem continuar.

### F1 — Diagnóstico WebXR independente

Dependência: pode avançar enquanto F0 prepara a engine.

1. Criar página pequena com grade, cubos, indicadores de mão e painel de diagnóstico. Usar geometria própria.
2. Detectar contexto seguro, `navigator.xr`, suporte a `immersive-vr`, WebGL2, isolamento e entrada disponível. Solicitar sessão somente por ação do usuário; tratar negação e recursos ausentes. [Referência](https://developer.mozilla.org/en-US/docs/Web/API/XRSystem/requestSession).
3. Implementar entrar/sair/reentrar, referência de espaço, pose nula, perda de foco e desligamento de controles.
4. Registrar navegador, runtime, GPU informada pelo usuário, perfis, cadência observada e resolução. Evitar prometer suporte com base apenas na marca do headset.
5. Incluir modo headset + teclado/mouse desde o diagnóstico. Testar foco, captura/movimento relativo do mouse, teclas, menu XR e sessão sem fontes de controle XR. A ausência de controles não pode bloquear a inicialização do jogo nesse modo.

Entregas: diagnóstico e `docs/XR-COMPATIBILITY.md`.

Aprovação antes do headset: lifecycle, ações dos dois modos de entrada e matrizes testados com emulação/mocks, identificados como tais. Aprovação física: profundidade, escala, teclado/mouse durante sessão imersiva, controles VR e três ciclos de entrada/saída no PS VR2 real. Validar o modo teclado/mouse com controles XR ausentes ou inativos durante o jogo.

### F2 — Prova de renderização estereoscópica na engine

Dependências: F0 compilável e infraestrutura F1. Maior risco técnico; executar antes de adaptar combate ou produzir conteúdo.

1. Extrair atualização, preparação e desenho do loop sem quebrar o desktop.
2. Criar ponte versionada e override de câmera/projeção/alvo no librw. Auditar caches de framebuffer e matrizes no backend.
3. Primeiro desenhar geometria de diagnóstico pelo backend nativo; depois um trecho real do mundo com simulação pausada.
4. Renderizar cada vista XR com transformações corretas. Exibir contadores separados de atualizações e vistas.
5. Testar recenter, escala, inclinação da cabeça, clipping, restauração desktop e perda de contexto.
6. Inspecionar culling e efeitos que dependem de câmera única. Desligar temporariamente um efeito defeituoso somente com registro explícito.

Entregas: prova estéreo, patch de renderer e `docs/STEREO-SPIKE.md` com capturas, condições e problemas.

Aprovação: duas imagens distintas da mesma cena, parallax esperado, câmera 6DoF e nenhuma atualização duplicada de física/áudio. Captura lado a lado é diagnóstico; aprovação perceptual exige headset.

Ponto de decisão: reservar inicialmente 2–3 dias de trabalho técnico para identificar o mecanismo e os obstáculos, não para prometer solução. Se ainda não houver acesso funcional a projeção/framebuffer/loop, registrar o obstáculo concreto e revisar a estimativa antes de avançar gameplay.

### F3 — Caminhada em primeira pessoa

Dependência: F2 tecnicamente aprovada.

1. Ancorar a câmera no jogador com altura configurável, orientação desacoplada e partes do corpo ocultadas.
2. Encaminhar movimento para colisão e física nativas; implementar primeiro WASD/mouse no headset, depois analógicos VR, usando as mesmas ações de gameplay. Implementar snap turn e preferências de conforto sem sobrescrever a pose da cabeça.
3. Integrar som posicional à posição/orientação da cabeça quando o backend permitir, sem atualizar áudio por olho.
4. Tratar escadas, paredes, interiores, pausa, carregamento e respawn. Adaptar listener de áudio e efeitos visuais necessários.

Entregas: passeio VR por percurso curto e `docs/WALKING-TEST.md`.

Aprovação: dez minutos de percurso definido em cada modo de entrada no headset, sem teleportes involuntários, input preso ou alteração indevida da velocidade da simulação. Olhar lateralmente mantém o movimento de WASD relativo ao corpo no perfil padrão. Registrar conforto observado pelo usuário, sem alegar ausência universal de enjoo.

### F4 — Controles, arma e interface

Dependência: F3.

1. Renderizar representações simples das mãos/controladores. Modelos detalhados e IK completo ficam para depois.
2. Separar mira da cabeça e do corpo. No modo controles VR, origem/direção do tiro acompanham a mão dominante; no modo teclado/mouse, a arma virtual segue a mira comandada pelo mouse. Colisão, dano, munição e cadência continuam sob controle da engine em ambos.
3. Entregar uma arma funcional primeiro; verificar obstrução por parede e convergência entre visual, mira e ponto de impacto.
4. Criar pausa, recenter, conforto, vida/munição e objetivo dentro de VR. Garantir botões legíveis e navegação sem tirar o headset.
5. Testar canhoto, ausência de haptics, desconexão e troca de perfil. Vibração é opcional por capacidade.
6. Permitir operar todos os menus XR e mudar de entrada com teclado/mouse, sem pegar os controles VR. Testar troca de fonte com gatilho, tecla ou botão do mouse pressionado e exigir liberação antes de reativar ações.

Entregas: combate básico e UI utilizável.

Aprovação: nos dois modos, apontar para um lado enquanto olha para outro; o disparo segue a arma. Sem tiros através da parede por deslocamento da origem, duplicação de dano ou ação presa. Menu e troca de entrada funcionam dentro do headset sem reiniciar a partida.

### F5 — Veículos, continuidade e saves

Dependências: F3 e integração de ações de F4.

1. Implementar entrada/saída e câmera no banco do motorista. Separar direção do carro, cabeça e origem sentada.
2. Corrigir visibilidade de interior, painel e superfícies próximas. Um veículo validado é suficiente para o primeiro marco; outros entram numa matriz de cobertura.
3. Definir estabilidade de horizonte e limites de conforto em curvas/colisões; manter orientação da cabeça livre.
4. Tratar morte, prisão, cutscenes e retorno à partida. Usar painel virtual para trechos cuja câmera dirigida não foi adaptada.
5. Preservar slots nativos; guardar configurações XR separadamente e implementar exportação/importação de saves com validação. Flush deve terminar antes de confirmar salvamento.

Entregas: percurso a pé → dirigir → sair → salvar → recarregar e relatório de cobertura.

Aprovação: três ciclos completos com cada modo de entrada no headset, sem câmera fora do carro, controles herdados do contexto anterior ou regressão de save. Testar teclado/mouse → controles VR → teclado/mouse durante a mesma partida, incluindo transição a pé/veículo. Registrar que campanha e veículos não testados continuam pendentes.

### F6 — Streaming, desempenho e validação PS VR2

Dependências: F2 em diante; instrumentar cedo, concluir após F5 e chegada do adaptador.

1. Medir CPU, GPU quando a API permitir, cadência, long tasks, memória e I/O. Separar tempo por quadro XR de taxa de simulação.
2. Revisar leituras síncronas e esperas em memória compartilhada. Prefetch do percurso pode ajudar a prova inicial, mas não resolve exploração arbitrária. Tratar cache frio, atraso, cancelamento e retorno de dados.
3. Carregamentos obrigatórios devem levar a uma apresentação XR estável, quando necessário; evitar bloquear a thread que entrega os quadros. Não retornar buffers incompletos à engine.
4. Ajustar resolução, LOD, distância e efeitos com evidência. Foveação só se exposta pelo runtime; não depender de rastreamento ocular do PS VR2 no PC.
5. Validar uma configuração concreta: notebook/GPU/driver, navegador, SteamVR, resolução e taxa do headset. Testar primeiro o diagnóstico F1 e depois o jogo.

Meta inicial: 90 Hz no PS VR2, se a configuração oferecer esse modo, com orçamento de 11,1 ms por quadro apresentado, incluindo as duas vistas. Para 120 Hz o orçamento é 8,3 ms; 120 Hz não é requisito inicial. Esses valores são metas, não resultados observados.

Critério proposto de desempenho: percurso de cinco minutos, cache frio e quente separados; pelo menos 95% dos intervalos de apresentação dentro de 1,2× o período-alvo, sem bloqueios de aplicação acima de 50 ms durante exploração estabilizada. Registrar também p99, resolução e reprojeção indicada pelo runtime. Não chamar FPS do canvas de FPS do headset. Ajustar qualidade e repetir só se houver mudança ou falha.

Entregas: `docs/PERFORMANCE.md` e `docs/HARDWARE-VALIDATION.md` com resultados reais, inclusive falhas.

Aprovação: PS VR2 físico percorre o fluxo completo com teclado/mouse e com controles VR; entrada, estabilidade, saves e desempenho satisfazem os critérios acordados. Registrar especificamente captura do mouse e foco durante VR. Sem headset, status máximo é “pronto para validação física”.

### F7 — Empacotamento do jogo

Dependência: F6 ou entrega explicitamente marcada como experimental.

1. Documentar iniciar, compilar, selecionar dados, restaurar save e solucionar falhas conhecidas.
2. Validar no servidor final HTTPS, isolamento, WASM MIME, cache e Range se o transporte adotado depender disso. Para desenvolvimento no mesmo PC, usar localhost; acesso por outro aparelho na rede exige configuração segura apropriada.
3. Garantir inicialização repetível, encerramento limpo e ausência de dependência de uma futura plataforma.
4. Registrar arquivos próprios e de terceiros; distribuir apenas o pacote permitido para o caso de uso, mantendo dados comerciais locais.

Aprovação: outra instalação de desenvolvimento reproduz o build seguindo o README; os requisitos pendentes ficam explícitos. Publicação comercial/plataforma não faz parte desta fase.

## 7. Compatibilidade por níveis

“Qualquer óculos” é uma intenção de expansão, não um critério que possa ser garantido agora. WebXR é a interface comum; navegador, runtime, controles, memória e GPU determinam o suporte efetivo.

| Alvo | Plano | Estado inicial |
|---|---|---|
| Desktop sem VR | Desenvolvimento e regressão | A implementar/medir |
| PS VR2 + PC + SteamVR/OpenXR | Alvo de aprovação inicial | A validar fisicamente |
| Outros headsets PCVR com WebXR disponível | Reusar sessão e ações; testar perfis | Compatibilidade candidata |
| Headsets standalone, como Quest | Perfil de desempenho próprio e teste de memória/streaming | Adiado; não presumir equivalência ao PC |
| PS5 diretamente | Não é alvo deste projeto web | Fora do escopo |

Não exigir recursos específicos como eye tracking, gatilhos adaptativos ou rastreamento de mãos. Eles não podem ser dependências do fluxo principal. A Sony lista limitações do PS VR2 no PC em seu [suporte oficial](https://www.playstation.com/pt-br/support/hardware/psvr2/).

## 8. Testes que realmente reduzem risco

| Teste | Falha que deve detectar |
|---|---|
| Matrizes com pontos e rotações conhecidos | Eixo invertido, escala errada, altura/IPD duplicados |
| Uma atualização + N vistas | Física, áudio, partículas ou temporizadores avançando por olho |
| Caminho determinístico com cadências de render diferentes | Velocidade do jogo dependente dos Hz do headset |
| Framebuffers/viewport e captura de cada olho | Olho apagado, projeção simétrica indevida, clipping divergente |
| Dois controles com perfis variados e pose ausente | Mapeamento errado e botões presos |
| Headset + teclado/mouse, sem fontes de controle XR | Dependência indevida dos Sense e perda de entrada durante sessão imersiva |
| Cabeça girando durante WASD e mira pelo mouse | Movimento redirecionado involuntariamente e pose da cabeça sobrescrita |
| Captura do mouse perdida, foco recuperado e tecla mantida | Deltas acumulados, giros inesperados e ações presas |
| Trocar teclado/mouse ↔ controles VR na mesma partida | Input duplicado, disparo herdado e reinicialização indevida da sessão |
| Menus, arma e direção com cada fonte de entrada | Funções acessíveis somente com controles VR |
| Entrar/sair/reentrar XR três vezes | Loops duplicados, câmera não restaurada, recursos vazando |
| Cache frio, rede atrasada e leitura cancelada | Congelamento XR, corrupção de arquivo e uso após descarte |
| Salvar, fechar, reabrir e importar | Perda de progresso ou confirmação antes do flush |
| Percurso desktop antes/depois | Regressão fora do modo VR |
| Sessão física no PS VR2 | Problemas de conforto, rastreamento e desempenho invisíveis em mocks |

Automatizar matemática, transições, contadores e invariantes; usar browser automation para menus e regressão desktop quando aplicável. Emulação XR ajuda o desenvolvimento, mas não prova funcionamento dos Sense, profundidade percebida ou latência no headset.

## 9. Aproveitamento da semana de espera

Agenda indicativa, ajustada após F0. Não é promessa de port completo em sete dias.

| Janela | Trabalho prioritário | Resultado desejado |
|---|---|---|
| Dias 1–2 | F0 e F1 | Build identificado, baseline desktop e diagnóstico XR |
| Dias 3–5 | F2 | Prova estéreo na engine ou obstáculo documentado |
| Dias 6–7 | Consolidar F2; iniciar F3 se aprovado | Primeira pessoa testável e roteiro para headset |
| Adaptador chegou | Diagnóstico físico, depois prova na engine | Confirmar cadeia PCVR antes de ampliar gameplay |
| Depois | F3–F7 por critérios, não por calendário | Primeiro fluxo jogável validado |

Se os dados não estiverem disponíveis, continuar build, matemática, lifecycle, testes e cena de diagnóstico. Se o hardware falhar, separar configuração PCVR de defeito do jogo. Não gastar a semana criando catálogo, login ou acabamento visual antes de provar o renderer.

## 10. Forma de execução e conclusão

Cada etapa deve registrar objetivo, arquivos alterados, comandos executados, resultado observado e pendências. Usar commits pequenos quando houver repositório, preservando trabalho existente. Manter `docs/STATUS.md` para o próximo turno do Claude.

Estados permitidos: não iniciado, em execução, concluído tecnicamente, pendente de hardware/dados, validado fisicamente. Não converter pendências em sucesso para encerrar uma etapa.

O primeiro marco completo exige o fluxo de gameplay em primeira pessoa com dois olhos e cabeça rastreada, veículo, arma, interface e saves no PS VR2, validado tanto com teclado/mouse quanto com controles VR reais. O modo headset + teclado/mouse é obrigatório e independente da presença de controles XR durante o jogo. O diagnóstico de cubos, um vídeo estéreo ou uma tela virtual isolada não encerram esse objetivo.
