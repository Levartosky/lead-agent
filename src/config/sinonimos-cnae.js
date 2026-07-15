// Sinônimos: termo coloquial digitado pelo usuário → raiz que precisa aparecer
// literalmente (após normalizar: maiúsculo, sem acento) dentro do texto de
// `cnaes.descricao` para o match funcionar — ver `expandirTermos` em
// src/tools/receita.js.
//
// SINONIMOS_VALIDADOS: conferidos manualmente contra o banco real em
// 2026-07-13 (ver CONTEXTO.md, seção 5). Não alterar sem revalidar.
//
// SINONIMOS_NOVOS_PENDENTE_VALIDACAO: mapeados a partir da nomenclatura
// oficial do CNAE 2.3 para a história 3.3 (expansão do dicionário), mas
// SEM confirmação contra o banco real — data/receita.db não estava disponível
// localmente ao escrever este arquivo. Antes de considerar a história 3.3
// concluída, rodar `npm run validar-sinonimos` numa máquina com o banco e
// corrigir qualquer raiz sem correspondência.

const SINONIMOS_VALIDADOS = {
  DENTISTA:       'ODONTOL',
  DENTISTAS:      'ODONTOL',
  DENTAL:         'ODONTOL',
  ODONTOLOGO:     'ODONTOL',
  MEDICO:         'MEDIC',
  MEDICOS:        'MEDIC',
  HOSPITAL:       'HOSPIT',
  CLINICA:        'CLINIC',
  ADVOGADO:       'ADVOCA',
  ADVOGADOS:      'ADVOCA',
  ADVOCACIA:      'ADVOCA',
  CONTADOR:       'CONTAB',
  CONTABILIDADE:  'CONTAB',
  ACADEMIA:       'CONDICIONAMENTO FISICO',
  ACADEMIAS:      'CONDICIONAMENTO FISICO',
  FARMACIA:       'FARMAC',
  SUPERMERCADO:   'SUPERM',
  PADARIA:        'PADARI',
  MECANICO:       'MANUTENC',
  ELETRICISTA:    'ELETRIC',
  ENGENHEIRO:     'ENGENH',
  ARQUITETO:      'ARQUIT',
  PSICOLOGO:      'PSICOL',
  NUTRICIONISTA:  'NUTRIC',
  FISIOTERAPEUTA: 'FISIOTE',
  VETERINARIO:    'VETERIN',
};

// Confiança alta (nomenclatura CNAE inequívoca) mas ainda não conferida linha
// a linha contra o banco. Nichos citados explicitamente no backlog (3.3):
// petshop, salão de beleza, imobiliária, restaurante, oficina, escola,
// transportadora — mais outros nichos B2B comuns.
const SINONIMOS_NOVOS_PENDENTE_VALIDACAO = {
  PETSHOP:        'ANIMAIS DE ESTIMACAO',
  PET:            'ANIMAIS DE ESTIMACAO',
  SALAO:          'CABELEIREIR',
  CABELEIREIRO:   'CABELEIREIR',
  CABELEIREIRA:   'CABELEIREIR',
  BELEZA:         'BELEZA',
  ESTETICA:       'ESTETICA',
  IMOBILIARIA:    'IMOVEIS',
  IMOVEIS:        'IMOVEIS',
  RESTAURANTE:    'RESTAURANTES',
  PIZZARIA:       'RESTAURANTES',
  LANCHONETE:     'LANCHONETE',
  BAR:            'BARES',
  BARES:          'BARES',
  OFICINA:        'MANUTENC',
  // baixa confiança: descrições oficiais de nível fundamental/médio usam a
  // palavra "Educação", não "Ensino" — revisar com atenção na validação
  ESCOLA:         'EDUCACAO',
  COLEGIO:        'EDUCACAO',
  IDIOMAS:        'IDIOMAS',
  TRANSPORTADORA: 'TRANSPORTE',
  HOTEL:          'HOTEIS',
  POUSADA:        'HOTEIS',
  CONSTRUTORA:    'CONSTRUCAO DE EDIFICIOS',
  SEGURADORA:     'SEGUROS',
  SEGUROS:        'SEGUROS',
  PUBLICIDADE:    'PUBLICIDADE',
  MARKETING:      'PUBLICIDADE',
  OTICA:          'OPTICA',
  JOALHERIA:      'JOALHERIA',
  PAPELARIA:      'PAPELARIA',
  LIVRARIA:       'LIVROS',
  FLORICULTURA:   'FLORES',
  LAVANDERIA:     'LAVANDERIA',
  PANIFICADORA:   'PADARI',
  SORVETERIA:     'SORVETES',
  AUTOESCOLA:     'CONDUCAO DE VEICULOS',
  SEGURANCA:      'VIGILANCIA',
  VIGILANCIA:     'VIGILANCIA',
  GRAFICA:        'IMPRESSAO',
  CONFEITARIA:    'CONFEITARIA',
  DOCERIA:        'CONFEITARIA',
  AUTOPECAS:      'PECAS E ACESSORIOS',
  MOVEIS:         'MOVEIS',
  TATUAGEM:       'TATUAGEM',
  DESIGNER:       'DESIGN',
  CONSULTORIA:    'CONSULTORIA EM GESTAO',
  FUNERARIA:      'FUNERARI',
};

module.exports = {
  SINONIMOS: { ...SINONIMOS_VALIDADOS, ...SINONIMOS_NOVOS_PENDENTE_VALIDACAO },
  SINONIMOS_VALIDADOS,
  SINONIMOS_NOVOS_PENDENTE_VALIDACAO,
};
