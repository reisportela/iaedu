# Publicar a extensao VSIX com GitHub Actions

Este guia explica o que deve ser feito no GitHub para disponibilizar a extensao
IAEDU como ficheiro `.vsix`, usando o workflow ja existente neste repositorio:

```text
.github/workflows/build-vsix.yml
```

O objetivo e simples: cada nova versao da extensao deve ser publicada como uma
GitHub Release, com o ficheiro `iaedu-agent-<version>.vsix` anexado a essa
release.

## O que o workflow ja faz

O workflow `Build VSIX` e executado automaticamente em cinco situacoes:

- quando ha um `pull_request`;
- quando ha um `push` para `main`;
- quando e criado um tag com o formato `v*`;
- quando uma GitHub Release e publicada;
- quando e executado manualmente em `Actions > Build VSIX > Run workflow`.

Em cada execucao, o workflow:

1. instala o Node.js;
2. instala as dependencias com `npm ci`;
3. executa os testes com `npm run test`;
4. cria o pacote com `npm run package`;
5. disponibiliza o `.vsix` como artefacto do workflow.

Quando a execucao foi iniciada pela publicacao de uma GitHub Release, o workflow
tambem anexa automaticamente o ficheiro `.vsix` a essa release.

Ao publicar uma Release com um tag novo, pode ver mais do que uma execucao do
workflow: uma associada ao novo tag e outra associada a publicacao da Release.
A execucao que anexa o `.vsix` a Release e a execucao iniciada pelo evento
`release`.

## Antes de publicar no GitHub

No computador local, confirme que esta a trabalhar neste repositorio:

```bash
cd /home/mangelo/Documents/GitHub/iaedu
```

Antes de fazer `push`, faca a verificacao normal:

```bash
git status --short --branch
npm run compile
npm run test
npm run package
```

Confirme tambem que:

- a versao em `package.json` e `package-lock.json` corresponde a versao que vai
  publicar;
- o ficheiro `.vsix` gerado localmente nao foi adicionado ao Git;
- nao existem ficheiros locais sensiveis preparados para commit;
- `.env`, chaves de API, endpoints reais, `channel_id`, dados locais e outputs
  gerados nao entram no repositorio.

## Configuracao necessaria no GitHub

No GitHub, abra o repositorio e confirme:

1. `Settings > Actions > General`
2. Em `Actions permissions`, as GitHub Actions devem estar permitidas.
3. Em `Workflow permissions`, o `GITHUB_TOKEN` deve ter permissao de escrita
   para que o workflow consiga anexar o `.vsix` a uma Release.

O workflow deste repositorio ja declara:

```yaml
permissions:
  contents: write
```

Essa permissao e necessaria para o passo que faz upload do `.vsix` para a
GitHub Release.

## Fluxo recomendado para publicar uma nova versao

1. Atualize a versao da extensao em `package.json`.
2. Atualize o `package-lock.json`, se necessario.
3. Confirme localmente que `npm run compile`, `npm run test` e
   `npm run package` passam.
4. Faca commit das alteracoes.
5. Faca `push` para `main`.
6. No GitHub, abra a pagina `Releases`.
7. Escolha `Draft a new release`.
8. Crie um novo tag com o formato `v<version>`.
9. O tag deve corresponder a versao em `package.json`.
10. Escreva notas de release curtas e claras.
11. Publique a release.
12. Abra `Actions > Build VSIX` e aguarde ate a execucao terminar com sucesso.
13. Volte a pagina da Release e confirme que existe um anexo com o formato
    `iaedu-agent-<version>.vsix`.
14. Descarregue o `.vsix` da Release e teste a instalacao num VS Code limpo ou
    num perfil separado.

Depois destes passos, a Release passa a ser o ponto publico recomendado para
partilhar a extensao com alunos, professores ou outros utilizadores.

## Testar o workflow sem publicar uma Release

Para testar apenas a compilacao e a criacao do `.vsix` no GitHub:

1. Abra `Actions`.
2. Escolha o workflow `Build VSIX`.
3. Escolha `Run workflow`.
4. Aguarde ate terminar.
5. Abra a execucao concluida.
6. Descarregue o artefacto `iaedu-agent-vsix`.

Este metodo e util para verificacao interna, mas nao e o melhor metodo para
partilhar publicamente a extensao. Para partilha publica, prefira uma GitHub
Release com o `.vsix` anexado.

## Se o `.vsix` nao aparecer na Release

Verifique:

- se a Release foi efetivamente publicada e nao ficou apenas em rascunho;
- se o workflow `Build VSIX` terminou com sucesso;
- se a execucao foi iniciada pelo evento `release`;
- se as permissoes de Actions permitem escrita em `contents`;
- se o passo `Attach VSIX to GitHub Release` foi executado.

Como solucao manual:

1. abra a execucao do workflow em `Actions`;
2. descarregue o artefacto `iaedu-agent-vsix`;
3. extraia o `.vsix`, se necessario;
4. edite a GitHub Release;
5. anexe manualmente o ficheiro `iaedu-agent-<version>.vsix`.

## Problemas comuns

Se o workflow falhar em `npm ci`, normalmente existe um problema com
`package-lock.json` ou com as dependencias declaradas.

Se falhar em `npm run test`, corrija os testes antes de publicar a Release.

Se falhar em `npm run package`, verifique a configuracao do `vsce`, o
`package.json` e os ficheiros incluidos ou excluidos por `.vscodeignore`.

Se a Release mostrar uma versao errada, confirme que:

- `package.json` tem a versao certa;
- `package-lock.json` foi atualizado;
- o tag foi criado com a versao certa;
- nao esta a reutilizar um tag antigo.

Evite apagar e recriar releases sem necessidade. Para uma nova versao da
extensao, o mais claro e criar uma nova Release com um novo tag.

## Checklist final antes de partilhar

Antes de enviar o link da Release a outras pessoas, confirme:

- a Release tem o `.vsix` anexado;
- o nome do ficheiro segue o formato `iaedu-agent-<version>.vsix`;
- a versao do tag corresponde a versao em `package.json`;
- o README esta atualizado;
- nao foram publicados ficheiros sensiveis;
- a extensao instala corretamente no VS Code;
- as instrucoes de configuracao da extensao estao claras para novos
  utilizadores.
