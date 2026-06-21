# Prontuário de Geriatria — CEMPRE / HSE-PE

Site para gerenciar pacientes, evoluções diárias e documentos (receitas, exames, vacinação).
Os dados são salvos em uma planilha do Google Sheets, através de uma API feita em Google Apps Script.

## Antes de publicar

A URL da API já está configurada em `src/config.js`. Se você precisar trocá-la no futuro
(por exemplo, se reimplantar o Apps Script e gerar uma nova URL), edite esse arquivo.

## Como publicar no Vercel (passo a passo)

### 1. Criar conta no Vercel
Acesse **vercel.com** e clique em "Sign Up". Você pode criar a conta com seu e-mail do Google
(mais simples) ou com GitHub.

### 2. Instalar a ferramenta de linha de comando do Vercel (opcional, mas recomendado)
Se você tiver o Node.js instalado no computador, abra um terminal e rode:
```
npm install -g vercel
```

### 3. Publicar
Dentro da pasta deste projeto (onde está este README), rode:
```
vercel
```
Siga as perguntas:
- "Set up and deploy?" → Yes
- "Which scope?" → escolha sua conta
- "Link to existing project?" → No
- "What's your project's name?" → pode aceitar o nome sugerido ou digitar outro
- "In which directory is your code located?" → aceite o padrão (.)

Ao final, o Vercel vai te dar um link público, algo como:
```
https://prontuario-geriatria-cempre.vercel.app
```

Esse é o link que você vai usar para acessar o prontuário de qualquer navegador.

### 4. Publicações futuras
Toda vez que quiser atualizar o site (por exemplo, se eu te mandar uma nova versão do código),
basta substituir os arquivos na pasta e rodar `vercel --prod` novamente dentro da pasta.

## Alternativa sem linha de comando (mais simples para quem nunca usou terminal)

1. Acesse **vercel.com** e crie a conta.
2. Clique em "Add New..." → "Project".
3. Escolha "Deploy without Git" ou arraste a pasta do projeto direto na área indicada
   (o Vercel aceita arrastar uma pasta zipada ou conectar a um repositório GitHub).
4. Se for pedido um "Framework Preset", escolha **Vite**.
5. Clique em "Deploy".

## Estrutura do projeto

```
index.html          → página HTML principal, com os estilos visuais
src/main.jsx         → ponto de entrada do React
src/App.jsx          → todo o código do prontuário (abas, formulários, documentos)
src/api.js           → funções que conversam com a API do Google Apps Script
src/config.js        → URL da API (trocar aqui se precisar)
```

## Sobre os dados

Todos os pacientes ficam salvos na planilha do Google Sheets vinculada ao seu Apps Script.
Você pode abrir essa planilha a qualquer momento no Google Drive para ver os dados brutos
(em formato JSON dentro de cada linha) — embora o uso normal seja sempre através do site.

**Importante**: como o Apps Script atual está implantado como "Qualquer pessoa pode acessar",
qualquer pessoa que descobrir a URL da API ou o link do site pode ler/editar os dados. Para um
uso pessoal isso é aceitável, mas evite compartilhar a URL do site ou da API publicamente.
