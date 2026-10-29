# Duoline + MyMemory

Site de tradução bilíngue com interface minimalista e servidor Node.js. Usa a API pública MyMemory Translation API, sem chave e sem instalação de outro serviço.

## Executar no Windows

1. Instale o Node.js 18 ou superior: https://nodejs.org/pt-br/download
2. Extraia todos os arquivos do ZIP para uma pasta.
3. Dê dois cliques em `INICIAR_DUOLINE.bat`.
4. Abra `http://localhost:3000`. Mantenha a janela do servidor aberta.

Não é necessário executar `npm install` nem instalar o LibreTranslate. O servidor usa apenas módulos nativos do Node.js.

## Limites gratuitos do MyMemory

Segundo a página oficial de limites, a utilização anônima é limitada a **5.000 caracteres por dia**. Informar um e-mail válido no parâmetro `de` aumenta a cota publicada para **50.000 caracteres por dia**. A API limita cada segmento de texto a **500 bytes**; o Duoline divide linhas muito longas em trechos menores. Consulte os limites e os termos atualizados: https://mymemory.translated.net/doc/usagelimits.php e https://mymemory.translated.net/terms-and-conditions.

A cota é compartilhada conforme as regras do serviço e pode mudar. A tradução pode falhar se a API estiver indisponível ou a cota diária acabar. A qualidade varia de acordo com o idioma e com o texto.

## Usar e-mail (opcional) para solicitar cota maior

O projeto inicia sem e-mail, sem chave e sem pagamento. Se decidir incluir um e-mail válido, abra o PowerShell na pasta do projeto e execute:

```powershell
$env:MYMEMORY_EMAIL="seu-email@exemplo.com"
node server.js
```

Use um e-mail que você tenha autorização para fornecer; ele será enviado ao MyMemory como parâmetro de contato. Não precisa preencher essa variável para testar a API.

## Desempenho

- Solicitações são feitas com até 4 chamadas simultâneas, em vez de esperar cada linha terminar uma após outra.
- Trechos repetidos no mesmo texto são traduzidos apenas uma vez.
- Um cache em memória reaproveita até 500 traduções recentes enquanto o servidor estiver aberto.
- A API pública ainda pode responder lentamente ou limitar requisições; paralelismo reduz esperas, mas não garante tempo fixo.

## Recursos

- Interface adaptável para computador e celular, tema escuro e claro
- Idioma de origem e destino selecionáveis
- Original e tradução pareados linha por linha
- Botão de copiar o resultado
- Logo incluída
- A chave de API não é necessária
