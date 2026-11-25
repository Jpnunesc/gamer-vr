# Análise técnica de gta.rabisco.net

Inspeção em 10/11/2026. Objetivo: orientar uma adaptação experimental para VR em primeira pessoa, inicialmente PS VR2 conectado ao PC. Este relatório registra leitura de recursos públicos e inspeção de código-fonte do projeto-base. Não houve compilação, execução interativa do jogo, inspeção visual em headset nem auditoria completa da engine.

## Conclusão

A rota tecnicamente indicada é modificar e recompilar a engine reVC/wasm-revc, integrando WebXR ao renderizador. A viabilidade ainda depende de reproduzir o build, separar atualização e desenho, entregar imagens estereoscópicas e medir o hardware real.

O arquivo de jogo compilado não é uma API pronta para VR. Os recursos públicos permitem entender o carregamento e identificar a base, mas não demonstram acesso ao código exato das modificações de produção.

## Evidências observadas diretamente

| Recurso | Observação | Consequência |
|---|---|---|
| [Página inicial](https://gta.rabisco.net/) | Canvas e módulos `/play/menu.js` e `/play/entry.js`. | A página HTML é a apresentação do jogo. |
| [entry.js](https://gta.rabisco.net/play/entry.js) | Importa `classic.js` depois de clicar em Jogar. | Preservar inicialização explícita. |
| [classic.js](https://gta.rabisco.net/play/classic.js) | Importa `createReVC` e `ArchiveStreamer`; usa manifesto de instalação e funções nativas. | O jogo depende de WASM, carregador e arquivos de dados. |
| Mesmo carregador | Monta `IDBFS` em `/gtavc/userfiles`, executa `syncfs` e verifica `crossOriginIsolated`/`SharedArrayBuffer`. | Preservar saves e configurar isolamento na hospedagem local. |
| [menu.js](https://gta.rabisco.net/play/menu.js) | Usa `navigator.getGamepads()` e controles com mapeamento `standard`. | Essa entrada não substitui a leitura dos controles via WebXR. |
| [Glue JavaScript da engine](https://gta.rabisco.net/assets/classic/engine/reVC.js) | Expõe símbolos como `_VicePlayerX`, `_VicePlayerInVehicle`, `_VicePresentedFrames`, `_ViceSetResolution` e `_ViceViewerCamera`. | Há instrumentação e funções de visualizador, mas os nomes não provam uma interface de câmera VR para a campanha. |
| Mesmo glue | A busca por `requestSession`, `XRWebGLLayer`, `navigator.xr` e `immersive-vr` não encontrou ocorrências. | Não foi identificada uma integração WebXR pronta nos recursos inspecionados. Não equivale a prova sobre todo o site. |
| [version.json](https://gta.rabisco.net/version.json) | Informa commit e hash de build; a resposta trouxe COOP `same-origin` e COEP `require-corp`. | Registrar identidade do build e reproduzir requisitos de servidor. Cabeçalhos desse recurso isolado não comprovam toda a cadeia. |

Identidade publicada observada:

```text
commit: ef5fc7ea9beed863101518e3edbae0e9a558d818
buildSha256: 9f07155145386fd02fe106aa5de77c24f944ced78c36c3474f143a9f0db4f0eb
```

Esses valores foram lidos do manifesto público, não recalculados a partir do build completo. Não foram baixados arquivos de mapas, texturas, músicas ou o binário WASM para esta análise.

## O que o autor documenta

O [estudo técnico do port](https://gta.rabisco.net/como-foi-feito.html) distingue duas rotas: o jogo clássico baseado em reVC Web/WASM e uma prévia de modelos em Three.js. Identifica a revisão-base `acde392e0ba582156fcf516dbaeb73b73adebb3e`, com mudanças locais, e descreve WebGL2 e arquivos carregados por demanda. Isso orienta a investigação; não comprova que o repositório público reproduz integralmente a produção.

## Pontos de intervenção confirmados no projeto-base

Foi possível consultar a árvore e arquivos da revisão citada em [origami-ltd/wasm-revc](https://github.com/origami-ltd/wasm-revc/tree/acde392e0ba582156fcf516dbaeb73b73adebb3e).

| Arquivo na revisão | Evidência | Trabalho proposto |
|---|---|---|
| `scripts/build-web.sh` | Configuração com Emscripten, CMake e Ninja. | Fixar toolchain e reproduzir build antes de modificar. |
| `src/core/main.cpp` | `Idle` reúne `CTimer::Update`, `CGame::Process`, áudio e desenho; chama `RenderScene`, efeitos e HUD. | Separar simulação, preparação e renderização de cada vista. |
| `src/core/Camera.h` | Declara câmera nativa, matriz e modos de primeira pessoa. | Criar override XR explícito; modos existentes são referências, não VR completo. |
| `src/skel/sdl2/sdl2.cpp` | Despacha o loop e contém controle de cadência e funções de diagnóstico. | Transferir propriedade do agendamento durante a sessão XR. |
| `.gitmodules` e árvore Git | `vendor/librw` aponta para `origami-ltd/librw`, commit `ac6b902bc0a16950a7ac63ca7b2702e13b598af9`. | Fixar também a revisão do renderizador. |
| [librw: `src/gl/gl3device.cpp`](https://github.com/origami-ltd/librw/blob/ac6b902bc0a16950a7ac63ca7b2702e13b598af9/src/gl/gl3device.cpp) | Controla framebuffer, viewport, projeção, limpeza e apresentação. | Integrar alvo XR e projeções assimétricas sem o backend sobrescrevê-los. |

Os diretórios de input, jogador e armas constam da árvore; o plano exige aprofundar seus fluxos antes de alterá-los. Esta inspeção não rastreou toda a lógica de combate, veículos ou missões.

## Código, dados e origem

O [README](https://github.com/origami-ltd/wasm-revc/blob/acde392e0ba582156fcf516dbaeb73b73adebb3e/README.md) e o [LICENSE.md](https://github.com/origami-ltd/wasm-revc/blob/acde392e0ba582156fcf516dbaeb73b73adebb3e/LICENSE.md) distinguem os termos do port, da lógica reVC e das dependências. O arquivo de licença do port apresenta MIT-PoU, com condições adicionais de registro e crédito; não tratar o conjunto como MIT simples. O repositório-base adota arquivos do jogo fornecidos pelo jogador.

O plano usa instalação local própria, mantém dados fora do Git e registra a origem das dependências. Uma futura publicação da plataforma precisa resolver separadamente os termos de distribuição. A leitura do site não demonstra autorização para redistribuir seu acervo. Nenhum registro externo, contato ou publicação foi realizado nesta análise.

## Lacunas que continuam abertas

- Requisito acrescentado pelo usuário: headset + teclado/mouse e headset + controles VR. O plano cobre ambos; captura de mouse, foco e operação sem fontes de controle XR ainda precisam ser testados na sessão imersiva real. Isso é uma exigência do novo projeto, não uma capacidade constatada no site analisado.
- Disponibilidade do código exato do port Rabisco e de seus patches.
- Build reproduzível da revisão-base e dos submódulos com toolchain disponível.
- Edição e localização dos arquivos clássicos que serão usados nos testes.
- Modelo do notebook, GPU, conexão de vídeo e desempenho.
- Funcionamento da cadeia navegador → OpenXR/SteamVR → PS VR2 nessa máquina.
- Compatibilidade estereoscópica dos efeitos, culling, interiores e veículos.
- Campanha completa e suporte a outros headsets.

## Referências para a implementação

- [WebXR: exemplos do grupo Immersive Web](https://immersive-web.github.io/webxr-samples/).
- [Sessão imersiva e recursos opcionais](https://developer.mozilla.org/en-US/docs/Web/API/XRSystem/requestSession).
- [Framebuffer e viewport XR](https://developer.mozilla.org/en-US/docs/Web/API/XRWebGLLayer).
- [Loop da sessão XR](https://developer.mozilla.org/en-US/docs/Web/API/XRSession/requestAnimationFrame).
- [Compatibilização do contexto WebGL](https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/makeXRCompatible).
- [Controles em XRInputSource](https://developer.mozilla.org/en-US/docs/Web/API/XRInputSource/gamepad).
- [Mapeamento xr-standard](https://github.com/immersive-web/webxr-gamepads-module/blob/main/gamepads-module-explainer.md).
- [Isolamento entre origens](https://developer.mozilla.org/en-US/docs/Web/API/Window/crossOriginIsolated).
- [Loop e ambiente Emscripten](https://emscripten.org/docs/porting/emscripten-runtime-environment.html).
- [Preparação do PS VR2 no PC](https://www.playstation.com/pt-br/support/hardware/psvr2/).
