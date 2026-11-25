# Prompt para iniciar o desenvolvimento

Copie o texto abaixo para o Claude com acesso à pasta de documentos e a um ambiente de desenvolvimento local.

---

Quero desenvolver uma adaptação experimental do jogo de https://gta.rabisco.net/ para WebXR em primeira pessoa. Meu primeiro alvo é PS VR2 conectado ao PC com adaptador, SteamVR e OpenXR. O adaptador chega em aproximadamente uma semana. A plataforma para hospedar vários jogos será feita depois; agora foque exclusivamente no jogo.

Requisito obrigatório: quero usar o headset VR junto com teclado e mouse para jogar, e também poder escolher os controles VR. Implemente três combinações: monitor + teclado/mouse; headset + teclado/mouse; headset + controles VR. No headset com teclado/mouse, mantenha visão estereoscópica e rastreamento da cabeça, sem exigir controles Sense ativos durante a partida. A escolha da entrada deve ser independente da escolha da visualização.

Priorize headset + teclado/mouse no primeiro percurso integrado: WASD move, mouse controla giro horizontal e mira, botões disparam/miram, F interage e entra/sai de veículos. Não sobrescreva pitch/roll rastreados da cabeça com o mouse. Menus, direção, armas e saves devem ser acessíveis sem pegar controles VR. Use as regras detalhadas do plano para câmera, contexto do veículo, remapeamento e conforto.

Centralize ações para evitar entrada duplicada entre SDL e a ponte nova. Permita alternar explicitamente teclado/mouse e controles VR na mesma partida, neutralizando comandos antigos sem reiniciar a sessão. Valide captura do mouse e foco durante WebXR desde F1; não declare esse modo pronto apenas por funcionar no monitor ou no emulador.

Leia integralmente estes arquivos, nesta ordem:

1. `C:\Projects\Pessoais\vr-vice-city-plano\ANALISE-TECNICA.md`
2. `C:\Projects\Pessoais\vr-vice-city-plano\PLANO-EXECUCAO.md`

Eles contêm uma investigação real de recursos públicos e do projeto-base, mas não uma compilação nem um teste físico. Diferencie fatos observados, hipóteses e decisões propostas.

Comece a implementação pelas fases F0 e F1. Crie um diretório de projeto separado dos documentos, sem sobrescrever projetos existentes. Identifique a base disponível; na ausência do código privado do Rabisco, investigue `origami-ltd/wasm-revc` no commit documentado e fixe os submódulos/toolchain. Não presuma que a versão pública inclui todos os patches do site. Leia as instruções do repositório antes de modificá-lo.

Registre origem e termos dos componentes. O conjunto não tem uma licença MIT uniforme. Use arquivos de uma instalação clássica fornecida por mim; mantenha-os fora do Git. Não use o site Rabisco como CDN nem baixe seu acervo para redistribuição. Se faltar código ou dados, informe exatamente o necessário e continue as partes independentes, especialmente diagnóstico XR, build e testes de matemática.

Priorize a prova F2 antes de combate, veículos e acabamento: precisamos separar simulação e desenho e adaptar a renderização nativa para o framebuffer e as projeções WebXR. Não substitua o jogo por um clone visual em Three.js nem considere um canvas exibido numa tela virtual como gameplay VR concluído. Three.js pode ser usado apenas num diagnóstico independente se isso ajudar.

Implemente em etapas pequenas, preserve o modo desktop e registre os testes executados em `docs/STATUS.md`. Os nomes de API sugeridos no plano são contratos novos a criar, não funções que já existem. Verifique os arquivos e símbolos reais antes de alterar.

Trabalhe com autonomia nas decisões técnicas reversíveis. Prossiga pelas fases cujas dependências estiverem satisfeitas; não pare após apresentar outro plano. Se uma mudança exigir trocar o objetivo por um jogo original ou por uma aplicação nativa, apresente a evidência antes de mudar de direção.

Até o headset chegar, use diagnóstico desktop, testes automatizados e emulação identificada como tal. Nunca declare PS VR2 validado com base apenas em mocks. Quando o equipamento estiver disponível, siga a matriz de testes físicos e documente hardware, navegador, runtime, resolução e desempenho.

A primeira entrega desta rodada deve incluir projeto inicial, build reproduzível ou impedimento concreto documentado, página de diagnóstico WebXR, mapa dos pontos de integração na engine e próximos passos de F2. Depois continue o plano até o limite permitido pelas dependências reais.
