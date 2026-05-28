# IAEDU Agent para VS Code

Esta extensão liga o IAEDU ao Visual Studio Code. Em vez de usar apenas a IA no
navegador, passa a poder conversar com o IAEDU dentro do ambiente onde lê,
escreve, programa e organiza os seus ficheiros de trabalho.

A extensão é útil para alunos, professores e investigadores que querem usar o
IAEDU com documentos, código, scripts, apontamentos, relatórios, exercícios ou
projetos locais.

Autor: Miguel Portela, Universidade do Minho
<miguel.portela@eeg.uminho.pt>.

Este repositório não inclui endpoints, `channel_id`, chaves API, configurações
institucionais, dados de alunos, dados de investigação ou resultados locais.

## Em Poucas Palavras

Se já usou IA no navegador, esta extensão acrescenta três vantagens principais:

- Contexto local: pode pedir ajuda sobre o ficheiro que está aberto no VS Code,
  ou sobre texto selecionado, sem copiar e colar tudo manualmente.
- Trabalho por projeto: cada pasta pode ter instruções próprias num ficheiro
  `IAEDU.md`, para orientar respostas, estilo, regras de trabalho e cuidados
  com dados.
- Agente assistido: no modo `agent`, o IAEDU pode propor alterações a ficheiros
  ou comandos de validação. A extensão aplica essas ações apenas dentro da pasta
  aberta e com regras de segurança.

## O Que É O VS Code?

Visual Studio Code, ou VS Code, é um editor gratuito da Microsoft. É muito usado
para programar, mas também serve para escrever Markdown, LaTeX, relatórios,
scripts de Stata/R/Python/Julia, ficheiros de configuração e documentação.

Pense no VS Code como uma secretária de trabalho para projetos:

- abre uma pasta inteira, não apenas um ficheiro;
- mostra ficheiros, subpastas e histórico do projeto;
- tem terminal integrado;
- permite instalar extensões;
- torna mais fácil trabalhar com IA sobre ficheiros reais do projeto.

Página oficial de instalação:

```text
https://code.visualstudio.com/Download
```

Depois de instalar, abra o VS Code e escolha `File > Open Folder...` para abrir
a pasta do projeto em que quer trabalhar.

## O Que É Um Agente?

Neste contexto, um agente é uma forma de usar IA com mais contexto e mais
capacidade de ajudar no fluxo de trabalho. Um chatbot no navegador responde ao
que escreve na caixa de texto. Um agente dentro do VS Code pode também receber
contexto do projeto aberto, do ficheiro atual e de instruções locais.

Um agente pode ajudar a:

- explicar código, texto, tabelas ou erros;
- rever um relatório ou script;
- propor um plano antes de alterar ficheiros;
- sugerir pequenas alterações;
- gerar ou completar scripts;
- propor comandos de teste, compilação ou validação;
- manter uma conversa associada a um projeto.

Importante: esta extensão não dá liberdade total à IA para mexer no computador.
Quando há ações locais, elas passam por regras de segurança. A extensão bloqueia
ações fora da pasta aberta e restringe comandos destrutivos ou sensíveis.

## O Que Esta Extensão Faz

- Abre um painel IAEDU na barra lateral do VS Code.
- Envia perguntas para a API `agent-chat` do IAEDU.
- Mostra respostas em streaming.
- Renderiza Markdown e expressões matemáticas em LaTeX.
- Pode incluir o ficheiro ativo ou texto selecionado como contexto.
- Lê automaticamente um `IAEDU.md` na raiz da pasta aberta, se existir.
- Permite guardar vários perfis de modelo/agente IAEDU.
- Mantém histórico local de conversas por perfil.
- Permite começar uma conversa nova com novo `thread_id`.
- Tem três modos: `ask`, `plan` e `agent`.
- No modo `agent`, apresenta ações locais propostas e aplica-as só quando passam
  nas regras de segurança da extensão.

## Pré-Requisitos

Para usar a extensão:

- VS Code 1.100.0 ou mais recente.
- Acesso institucional ao IAEDU.
- Dados API do modelo ou agente IAEDU que pretende usar:
  - endpoint;
  - API key;
  - `channel_id`.

Para desenvolver ou compilar a extensão a partir do código:

- Node.js e npm.
- Git.
- Comando `code` disponível no terminal, se quiser instalar o VSIX pela linha de
  comando.

## Instalar O VS Code

1. Vá a:

   ```text
   https://code.visualstudio.com/Download
   ```

2. Escolha o instalador para o seu sistema operativo.
3. Instale normalmente.
4. Abra o VS Code.
5. Abra uma pasta de trabalho com `File > Open Folder...`.

Quem nunca usou VS Code pode começar com uma pasta simples, por exemplo uma
pasta com um relatório, scripts e dados de exemplo.

## Instalar Esta Extensão

O caminho recomendado para utilizadores finais é instalar o ficheiro `.vsix`
publicado na página de releases do GitHub.

1. Abra a página do repositório no GitHub.
2. Vá a `Releases` e escolha a versão mais recente.

   ![Latest release link](images/latest.png)

3. Descarregue o ficheiro:

   ```text
   iaedu-agent-<versao>.vsix
   ```

4. Abra o VS Code.
5. Abra a Paleta de Comandos (`Command Palette`):

   ```text
   View > Command Palette...
   ```

6. Execute:

   ```text
   Extensions: Install from VSIX...
   ```

7. Escolha o ficheiro `.vsix` descarregado.
8. Recarregue o VS Code se for pedido.

Para confirmar a instalação, abra a vista de extensões e procure `IAEDU Agent`.
Se usar terminal, também pode verificar com:

```bash
code --list-extensions --show-versions | grep -i iaedu
```

O resultado deve incluir algo semelhante a:

```text
iaedu-community.iaedu-agent@<versao>
```

## Obter Os Dados API No IAEDU

A extensão precisa de dados API do IAEDU. Estes dados não vêm no repositório e
não devem ser partilhados publicamente.

1. Aceda a <https://www.iaedu.pt/> ou <https://chat.iaedu.pt/>.
2. Entre com credenciais institucionais.

   ![IAEDU login](images/entrar.png)

3. Escolha o modelo ou agente IAEDU que pretende usar.

   ![Available IAEDU models](images/modelos.png)

4. Para usar agentes, crie ou configure um agente no IAEDU. A configuração do
   agente no IAEDU define o seu objetivo, instruções, modelo e eventuais
   ficheiros de conhecimento.

5. Abra a informação API do modelo ou agente.

   ![API link in IAEDU](images/api.png)

6. Guarde estes três elementos:

   - endpoint;
   - API key;
   - `channel_id`.

   ![IAEDU API details](images/api_details.png)

A disponibilidade da API pode depender do modelo, do agente e da política
institucional. A extensão apenas usa os dados que o utilizador introduz
localmente.

## Configurar A Extensão

Depois de instalar, crie pelo menos um perfil de modelo. Um perfil diz à
extensão que endpoint, chave e canal deve usar.

1. Abra o painel IAEDU na barra lateral do VS Code.

   ![IAEDU extension icon](images/icon.png)

   Também pode usar:

   ```text
   IAEDU: Open Chat
   ```

2. Clique em `config` ou `sign in`.

   ![IAEDU main menu](images/main_menu.png)

3. Adicione ou edite um perfil.

   ![IAEDU model settings](images/settings.png)

4. Preencha:

   - Model name: nome local, por exemplo `IAEDU default model`;
   - Endpoint: endpoint `agent-chat` do IAEDU;
   - API key: chave API;
   - Channel ID: `channel_id`.

5. Guarde.
6. Escolha o perfil no seletor de modelos do painel.

O botão `send` só fica ativo quando o perfil tem endpoint, API key e
`channel_id`.

## Usar No Dia A Dia

1. Abra uma pasta no VS Code.
2. Abra o painel IAEDU.
3. Escolha o modelo.
4. Escreva a pergunta.
5. Escolha o modo:
   - `ask`: perguntar e receber resposta;
   - `plan`: pedir análise e plano sem ações locais;
   - `agent`: permitir propostas de ações locais controladas.
6. Opcionalmente ative `active file` para incluir o ficheiro aberto.
7. Clique em `send`.

Para perguntar sobre texto selecionado:

```text
IAEDU: Ask About Selection
```

Para perguntar sobre o ficheiro ativo:

```text
IAEDU: Ask About Active File
```

O painel também inclui:

- seletor de conversas guardadas;
- `save chat`, para guardar a conversa atual;
- `new chat`, para começar uma conversa nova;
- `stop`, para cancelar uma resposta em curso;
- botão de cópia nas respostas do assistente.

## Exemplos De Uso

Alunos podem usar a extensão para:

- pedir explicações sobre código ou texto;
- rever uma secção de relatório;
- perceber erros em scripts;
- transformar apontamentos em estrutura de relatório;
- preparar perguntas para discussão com o professor.

Professores podem usar a extensão para:

- rever materiais de aula;
- testar exemplos de código;
- gerar exercícios iniciais;
- comparar versões de um texto;
- construir feedback estruturado;
- trabalhar com scripts e documentação sem sair do projeto.

Investigadores podem usar a extensão para:

- documentar fluxos de trabalho;
- rever scripts Stata/R/Python/Julia;
- pedir planos de validação;
- explorar erros de execução;
- trabalhar com Markdown, Quarto, LaTeX e código no mesmo espaço.

## Modos Da Extensão

### `ask`

Use para perguntas normais. A extensão pode enviar contexto local, mas instrui o
IAEDU a não propor ações executáveis.

### `plan`

Use quando quer análise, diagnóstico ou plano de trabalho antes de alterar
ficheiros. É o modo adequado para pedir: "analisa este problema e diz-me como
proceder".

### `agent`

Use quando quer que o IAEDU possa propor alterações a ficheiros ou comandos de
validação. As ações aparecem no painel e só são aplicadas se passarem nos
guardrails, isto é, nas regras de segurança da extensão. Algumas ações simples e
seguras podem ser aplicadas com `auto-accept`, se essa opção estiver ativa.

## Conversas E Histórico

A extensão usa `thread_id` para manter continuidade de conversa com o IAEDU.
Cada perfil de modelo tem a sua conversa ativa.

O histórico local é guardado no estado da área de trabalho do VS Code, não em
ficheiros do repositório. A extensão mantém:

- até 30 conversas;
- até 80 mensagens por conversa;
- títulos derivados da primeira pergunta;
- truncagem de mensagens demasiado longas.

`new chat` cria uma conversa vazia com novo `thread_id`. Não apaga
automaticamente as conversas anteriores.

## Instruções Do Projeto Com `IAEDU.md`

Se a pasta aberta no VS Code tiver um ficheiro `IAEDU.md` na raiz, a extensão
inclui esse ficheiro automaticamente em cada pedido.

Use `IAEDU.md` para instruções como:

- língua preferida;
- estilo de resposta;
- regras do projeto;
- cuidados com dados;
- convenções de código;
- critérios de revisão.

Exemplo simples:

```markdown
# IAEDU.md

Responde em português europeu.
Sê claro e rigoroso.
Não inventes resultados empíricos.
Quando analisares código, distingue erros, riscos e sugestões.
```

Não coloque API keys, endpoints, `channel_id`, dados pessoais, dados de alunos
ou dados sensíveis neste ficheiro.

## Onde Ficam Guardadas As Configurações?

Por defeito, os perfis de modelo ficam num ficheiro local fora do repositório:

```text
~/.secrets/IAEDU.md
```

O caminho pode ser alterado com a definição:

```text
iaedu.modelConfigPath
```

Exemplo do ficheiro de perfis:

```text
Model_Name=IAEDU default model
Endpoint=https://api.iaedu.pt/agent-chat/...
API_KEY=your-api-key
Channel_ID=your-channel-id
```

A extensão também pode guardar chaves no VS Code SecretStorage como apoio local.
Não deve guardar credenciais em `.vscode/settings.json`, no README, em
capturas de ecrã ou no repositório.

## Comandos Principais

| Comando | Para que serve |
| --- | --- |
| `IAEDU: Open Chat` | Abre o painel IAEDU. |
| `IAEDU: Sign In / Configure API` | Cria ou edita um perfil. |
| `IAEDU: Select Model` | Escolhe o perfil ativo. |
| `IAEDU: Load Models from Config File` | Recarrega perfis de `~/.secrets/IAEDU.md`. |
| `IAEDU: Save Models to Config File` | Guarda perfis no ficheiro local. |
| `IAEDU: Set Endpoint` | Atualiza o endpoint do perfil ativo. |
| `IAEDU: Set API Key` | Atualiza a API key do perfil ativo. |
| `IAEDU: Set Channel ID` | Atualiza o `channel_id` do perfil ativo. |
| `IAEDU: Start New Thread` | Começa uma conversa nova. |
| `IAEDU: Sign Out` | Desliga a área de trabalho e limpa chaves locais do SecretStorage. |

## Que Informação É Enviada Ao IAEDU?

Cada pedido envia:

- `channel_id` do perfil ativo;
- `thread_id` da conversa atual;
- `user_info`, por defeito `{"source":"vscode-extension"}`;
- a pergunta do utilizador;
- contexto opcional do ficheiro ativo ou seleção;
- instruções de `IAEDU.md`, se existir.

O limite de contexto local é controlado por:

```text
iaedu.maxContextChars
```

Textos muito longos são truncados no meio.

## Segurança E Regras De Segurança

A extensão foi desenhada para ser conservadora.

No modo `agent`, as ações locais têm de ficar dentro da pasta aberta no VS Code.
A extensão bloqueia ou pede revisão para ações sensíveis.

O `auto-accept` só existe no modo `agent` e só aceita ações de baixo risco,
como:

- pequenas escritas ou acrescentos em ficheiros de texto;
- substituição de uma seleção não vazia;
- comandos comuns de teste ou build;
- scripts locais Python/R/Julia/Stata;
- comandos Stata batch sobre ficheiros `.do`.

A extensão bloqueia padrões como:

- escrever fora da pasta aberta;
- mexer em `.git` ou `.ssh`;
- comandos com `sudo`;
- gestores de pacotes do sistema;
- `git push`;
- `git reset --hard`;
- `git clean -f`;
- pipes, redirects e padrões difíceis de auditar;
- `curl ... | sh` ou equivalente.

## Matemática E Markdown

As respostas suportam Markdown e expressões matemáticas em LaTeX, incluindo:

- `$x^2 + y^2 = z^2$`
- `\(x^2 + y^2 = z^2\)`
- `$$\int_0^1 x^2\,dx = \frac{1}{3}$$`
- `\[\int_0^1 x^2\,dx = \frac{1}{3}\]`

Expressões dentro de blocos de código não são renderizadas como matemática.

## Resolução De Problemas

### O botão `send` está desligado

Verifique se o perfil ativo tem endpoint, API key e `channel_id`.

### Editei `~/.secrets/IAEDU.md` manualmente

Execute:

```text
IAEDU: Load Models from Config File
```

### A resposta dá erro de API

Confirme endpoint, API key, `channel_id` e disponibilidade API do modelo ou
agente no IAEDU. Os detalhes técnicos aparecem no canal de saída
`IAEDU Agent`.

### O modo `agent` não aplicou uma ação

Provavelmente a ação foi bloqueada pelas regras de segurança. Reveja a mensagem
no painel e, se necessário, aplique manualmente depois de confirmar que é
seguro.

### Instalei uma versão nova mas continuo a ver a antiga

Reinstale o `.vsix` e recarregue a janela do VS Code. Se estiver a desenvolver a
extensão, recompile, reempacote e reinstale:

```bash
npm run compile
npm run test
npm run package
code --install-extension iaedu-agent-*.vsix --force
```

## Para Desenvolvedores

Para trabalhar no código da extensão:

```bash
git clone https://github.com/reisportela/iaedu.git
cd iaedu
npm install
npm run compile
npm run test
npm run package
```

No VS Code, também pode abrir este repositório e carregar em `F5` para lançar
um Extension Development Host.

Alterações ao README entram no VSIX. Depois de alterar documentação destinada a
utilizadores, volte a executar:

```bash
npm run compile
npm run test
npm run package
```

Antes de publicar, confirme que o VSIX não inclui `.env`, `IAEDU.md`,
credenciais, dados locais, resultados gerados, logs, scripts de teste locais ou
ficheiros de investigação.

## Conteúdo Do Repositório

- `src/`: código TypeScript da extensão.
- `media/`: JavaScript, CSS e ícones do webview.
- `test/`: testes de comportamento.
- `.vscodeignore`: ficheiros excluídos do VSIX.
- `.env.example`: exemplo sem credenciais reais.
- `LICENSE`: licença MIT.

## Notas De Privacidade

- Não faça commit de `.env`.
- Não faça commit de endpoints reais, API keys ou `channel_id`.
- Não inclua credenciais em capturas de ecrã, testes, fixtures, README ou
  releases.
- Não faça commit de dados de alunos, dados de investigação, resultados locais,
  logs ou respostas IAEDU geradas localmente.
- Trate `~/.secrets/IAEDU.md` como ficheiro local de credenciais.
- Use `IAEDU.md` apenas para instruções do projeto, não para segredos.

## Licença

Este projeto é distribuído sob licença MIT. Ver `LICENSE`.
